from playwright.sync_api import sync_playwright
import sys, json
def open_app(p, w=1440, h=900):
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': w, 'height': h})
    logs = []
    pg.on('console', lambda m: logs.append((m.type, m.text)) if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: logs.append(('pageerror', str(e))))
    pg.goto('http://localhost:1430/dev/harness.html')
    pg.wait_for_timeout(1500)
    return b, pg, logs
if __name__ == '__main__':
    with sync_playwright() as p:
        b, pg, logs = open_app(p)
        pg.screenshot(path='/tmp/shots/home.png')
        print(pg.inner_text('body')[:600])
        print('LOGS', logs[:10])
        b.close()

def new_project(pg, name='Teste'):
    pg.get_by_role('button', name='Novo projeto').first.click()
    pg.wait_for_timeout(300)
    pg.get_by_label('Nome').fill(name)
    pg.get_by_role('button', name='Criar e escolher onde salvar').click()
    pg.wait_for_timeout(2000)

def import_media(pg, paths, wait_s=300):
    pg.evaluate("paths => { window.__dialogs = { pickMedia: paths } }", paths)
    pg.get_by_role('button', name='Importar').first.click()
    pg.wait_for_timeout(1500)
    for _ in range(wait_s):
        txt = pg.inner_text('body')
        if 'Mídia pronta para edição' in txt or 'Nenhuma tarefa em andamento' in txt:
            pg.wait_for_timeout(1500)
            return
        pg.wait_for_timeout(1000)
    raise RuntimeError('importação não terminou')

def setup_media(pg, wait_analysis=True, paths=None):
    new_project(pg)
    import_media(pg, paths or ['/tmp/media/episodio.mp4', '/tmp/media/musica_128bpm.mp3'])
    if wait_analysis:
        # espera a sessão ter a análise do episódio E da música (não depende de texto na tela)
        for _ in range(240):
            ok = pg.evaluate("""() => { const s = window.__useApp.getState().session; if (!s) return false;
              const a = s.project.assets.filter(x => !x.tags.includes('sfx'));
              return a.length > 0 && a.every(x => x.kind === 'video' ? !!s.assetRuntime(x.id).episode : x.kind === 'audio' ? !!s.assetRuntime(x.id).music : true); }""")
            if ok: break
            pg.wait_for_timeout(1000)
        pg.wait_for_timeout(500)
