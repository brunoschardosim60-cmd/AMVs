// Ponte de desenvolvimento: deixa o app rodar num navegador comum (Playwright) com
// arquivos e FFmpeg REAIS. Só para testar a interface; não faz parte do app instalado.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, open, access } from 'node:fs/promises';
import { dirname } from 'node:path';

const PORT = Number(process.env.BRIDGE_PORT ?? 1421);
const MIME = { mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', png: 'image/png', jpg: 'image/jpeg' };

const runProcess = (tool, args) =>
  new Promise((resolve) => {
    const p = spawn(tool, args);
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err = (err + d).slice(-64000)));
    p.on('error', (e) => resolve({ code: null, stdout: '', stderr: String(e) }));
    p.on('close', (code) => resolve({ code, stdout: Buffer.concat(out).toString('base64'), stderr: err }));
  });

const rpc = {
  exists: async (p) => access(p).then(() => true, () => false),
  mkdir: (p) => mkdir(p, { recursive: true }),
  writeFile: (p, b64) => mkdir(dirname(p), { recursive: true }).then(() => writeFile(p, Buffer.from(b64, 'base64'))),
  readFile: async (p) => (await readFile(p)).toString('base64'),
  rename: (a, b) => rename(a, b),
  remove: (p) => rm(p, { recursive: true, force: true }),
  readDir: (p) => readdir(p),
  size: async (p) => (await stat(p)).size,
  readRange: async (p, off, len) => {
    const fh = await open(p, 'r');
    try {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, off);
      return buf.subarray(0, bytesRead).toString('base64');
    } finally {
      await fh.close();
    }
  },
  run: (tool, args) => runProcess(tool, args),
  listFiles: async (dir, depth) => {
    const out = [];
    const walk = async (d, lvl) => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) { if (lvl < depth) await walk(p, lvl + 1); } else out.push(p);
      }
    };
    await walk(dir, 0);
    return out;
  },
};

createServer(async (req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/rpc') {
      let body = '';
      for await (const c of req) body += c;
      const { method, args } = JSON.parse(body);
      const result = await rpc[method](...args);
      return res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ result: result ?? null }));
    }
    // Modelo de visão FALSO (compatível com OpenAI) para testar a análise de cenas sem gastar nada:
    // rotula cada imagem pela paridade da soma dos bytes (determinístico) e marca 1 de cada 5 como "não é luta".
    if (url.pathname === '/fake-llm/v1/chat/completions') {
      let body = '';
      for await (const c of req) body += c;
      const j = JSON.parse(body);
      const content = j.messages.at(-1).content;
      const imgs = Array.isArray(content) ? content.filter((c) => c.type === 'image_url') : [];
      globalThis.__fakeCalls = (globalThis.__fakeCalls ?? 0) + 1;
      const out = imgs.map((im, k) => {
        const b = Buffer.from(im.image_url.url.split(',')[1], 'base64');
        let sum = 0; for (let i = 0; i < b.length; i += 7) sum += b[i];
        return { i: k + 1, characters: [sum % 2 ? 'Guerreiro laranja' : 'Vilão roxo'], fight: (sum % 5) !== 0, note: 'cena de teste' };
      });
      return res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 50 * imgs.length, completion_tokens: 15 * imgs.length } }));
    }
    if (url.pathname === '/fake-llm/calls') return res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ calls: globalThis.__fakeCalls ?? 0 }));
    if (url.pathname === '/file') {
      const p = url.searchParams.get('path');
      const st = await stat(p);
      const type = MIME[p.split('.').pop().toLowerCase()] ?? 'application/octet-stream';
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
      if (range) {
        const a = range[1] ? Number(range[1]) : 0;
        const b = range[2] ? Number(range[2]) : st.size - 1;
        res.writeHead(206, { ...cors, 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${st.size}`, 'content-length': b - a + 1 });
        return createReadStream(p, { start: a, end: b }).pipe(res);
      }
      res.writeHead(200, { ...cors, 'content-type': type, 'accept-ranges': 'bytes', 'content-length': st.size });
      return createReadStream(p).pipe(res);
    }
    res.writeHead(404, cors).end();
  } catch (e) {
    res.writeHead(500, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e?.message ?? e) }));
  }
}).listen(PORT, () => console.log(`ponte em http://localhost:${PORT}`));
