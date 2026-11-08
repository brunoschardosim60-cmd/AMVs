from audit import *  # noqa
import sys
W,H = int(sys.argv[1]), int(sys.argv[2])
def tab(pg, n): pg.get_by_label('Mídia do projeto').get_by_role('tab', name=n).click(); pg.wait_for_timeout(500)
with sync_playwright() as p:
    b, pg, logs = open_app(p, W, H)
    new_project(pg)
    audit(pg,'projeto vazio')
    import_media(pg, ['/tmp/media/episodio.mp4','/tmp/media/musica_128bpm.mp3'])
    for _ in range(100):
        if 'Analisando' not in pg.inner_text('body'): break
        pg.wait_for_timeout(2000)
    audit(pg,'com mídia')
    for t in ['Cenas','Falas','Legendas','Mídia']:
        tab(pg,t); audit(pg, f'aba {t}')
    pg.get_by_role('button', name='Gerar meu AMV').click(); pg.wait_for_timeout(600)
    pg.get_by_role('button', name='Gerar', exact=True).click(); pg.wait_for_timeout(2500)
    pg.get_by_role('button', name='Editar na timeline').click(); pg.wait_for_timeout(600)
    audit(pg,'após gerar')
    pg.get_by_role('button', name='Assistente', exact=False).first.click(); pg.wait_for_timeout(500)
    audit(pg,'assistente aberto')
    pg.get_by_role('button', name='Minimizar assistente').click(); pg.wait_for_timeout(300)
    audit(pg,'assistente minimizado (bolinha)')
    pg.get_by_role('button', name='Abrir assistente').click(); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='Fechar assistente').click(); pg.wait_for_timeout(300)
    audit(pg,'assistente fechado')
    # clique num clipe da timeline
    pg.mouse.click(int(W*0.40), int(H*0.80)); pg.wait_for_timeout(500)
    audit(pg,'clipe selecionado'); pg.screenshot(path=f'/tmp/shots/sel_{W}.png')
    pg.get_by_role('button', name='Exportar', exact=False).first.click(); pg.wait_for_timeout(700)
    pg.screenshot(path=f'/tmp/shots/export_{W}.png')
    print('Exportar dialog:', pg.inner_text('[role=dialog]')[:200].replace('\n',' | ') if pg.locator('[role=dialog]').count() else 'sem diálogo')
    print('LOGS', logs[:8])
    b.close()
