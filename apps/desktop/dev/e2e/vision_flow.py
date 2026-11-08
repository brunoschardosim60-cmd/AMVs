from audit import *  # noqa
import base64, urllib.request, json as J
def rpc(method, *args):
    r = urllib.request.urlopen(urllib.request.Request('http://localhost:1421/rpc', data=J.dumps({'method':method,'args':list(args)}).encode()))
    return J.loads(r.read())
with sync_playwright() as p:
    b, pg, logs = open_app(p, 1440, 900)
    setup_media(pg)
    # configura a IA falsa (local, habilitada) como o app faz: ia.json na pasta de dados
    cfg = {'enabled': True, 'presetId': 'compat', 'provider': {'name':'Falso','kind':'openai','baseUrl':'http://localhost:1421/fake-llm/v1','model':'fake-vision','needsKey':False}, 'allowExternal': False, 'usage': {'input':0,'output':0}}
    rpc('writeFile', '/tmp/amv-harness/data/ia.json', base64.b64encode(J.dumps(cfg).encode()).decode())
    pg.get_by_role('button', name='Gerar meu AMV', exact=True).click(); pg.wait_for_timeout(800)
    dlg = pg.locator('[role=dialog]')
    print('antes:', [l for l in dlg.inner_text().split('\n') if 'imagens' in l or 'Personagens' in l])
    pg.wait_for_timeout(1500)
    t=dlg.inner_text(); i=t.find('Personagens'); print('DIAG:', repr(t[i:i+260]))
    dlg.get_by_role('button', name='Analisar cenas com IA').click()
    for i in range(90):
        pg.wait_for_timeout(1000)
        t = dlg.inner_text()
        if 'Analisando' not in t and i>2: break
    print('depois:', [l for l in dlg.inner_text().split('\n') if 'Guerreiro' in l or 'Vilão' in l or 'imagens' in l][:5])
    print('chamadas ao modelo falso:', J.loads(urllib.request.urlopen('http://localhost:1421/fake-llm/calls').read()))
    pg.screenshot(path='/tmp/shots/vision_dialog.png')
    # escolhe um personagem e gera
    dlg.get_by_role('button', name='Guerreiro laranja').click(); pg.wait_for_timeout(500)
    print('plano:', [l for l in dlg.inner_text().split('\n') if 'Só cenas' in l or 'Poucas' in l])
    dlg.get_by_role('button', name='Gerar', exact=True).click(); pg.wait_for_timeout(4000)
    res = pg.locator('[role=dialog]').inner_text()
    print('RESULTADO:', [l for l in res.split('\n') if 'cenas' in l or 'Só achei' in l][:3])
    st = pg.evaluate("""() => { const s = window.__useApp.getState().session; const p = s.project; const v1 = p.tracks.find(t=>t.name==='V1').id;
      const clips = p.clips.filter(c=>c.trackId===v1); const withW = clips.filter(c=>(c.reason||'').includes('com Guerreiro laranja')).length;
      const other = clips.filter(c=>(c.reason||'').includes('Vilão roxo')).length; return {v1: clips.length, comLaranja: withW, comRoxo: other}; }""")
    print('clipes V1:', st)
    print('LOGS', logs[:6]); b.close()
