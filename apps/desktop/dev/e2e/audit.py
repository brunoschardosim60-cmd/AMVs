from h import *
AUDIT = """() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width>2 && r.height>2 && cs.visibility!=='hidden' && cs.display!=='none' && r.bottom>0 && r.right>0 && r.top<innerHeight && r.left<innerWidth; };
  const label = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || e.tagName).trim().replace(/\\s+/g,' ').slice(0,40);
  const out = [];
  for (const e of document.querySelectorAll('button, [role=button], [role=tab], a[href], input, select, textarea, [role=separator]')) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    // ponto central, limitado ao pedaço visível
    const x = Math.min(innerWidth-1, Math.max(0, r.left + r.width/2));
    const y = Math.min(innerHeight-1, Math.max(0, r.top + r.height/2));
    const top = document.elementFromPoint(x, y);
    if (!top) { out.push({kind:'sem elemento', el: label(e)}); continue; }
    if (e.contains(top) || top.contains(e)) {
      if (e.disabled) out.push({kind:'desabilitado', el: label(e), title: e.title || ''});
      continue;
    }
    const cover = top.closest('[role=dialog],aside,nav,header,footer') || top;
    out.push({kind:'COBERTO', el: label(e), por: (top.getAttribute('aria-label') || top.className.toString().slice(0,50) || top.tagName), tag: top.tagName, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]});
  }
  return out; }"""
def audit(pg, tag):
    res = pg.evaluate(AUDIT)
    bad = [r for r in res if r['kind'] in ('COBERTO','sem elemento')]
    dis = [r for r in res if r['kind']=='desabilitado']
    print(f'[{tag}] {len(res)} problemas: {len(bad)} cobertos, {len(dis)} desabilitados')
    for r in bad: print('   COBERTO:', r)
    for r in dis[:6]: print('   desab:', r['el'], '|', r.get('title',''))
