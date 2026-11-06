#!/usr/bin/env node
/**
 * Coloca o FFmpeg/FFprobe em apps/desktop/src-tauri/binaries com o nome que o
 * Tauri exige para sidecars: ffmpeg-<target-triple>[.exe].
 *
 * - Windows: baixa o build GPL win64 do BtbN/FFmpeg-Builds (release "latest" do
 *   GitHub) e confere o SHA-256 com o checksums.sha256 da mesma release.
 * - Linux/macOS (desenvolvimento): copia o ffmpeg/ffprobe instalados no sistema.
 *
 * Uso: node scripts/fetch-ffmpeg.mjs [--target <triple>]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const binDir = join(root, 'apps', 'desktop', 'src-tauri', 'binaries');
mkdirSync(binDir, { recursive: true });

const argTarget = process.argv.indexOf('--target');
const target =
  argTarget > 0
    ? process.argv[argTarget + 1]
    : execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/host: (\S+)/)[1];
const isWindows = target.includes('windows');
const ext = isWindows ? '.exe' : '';
const dest = (tool) => join(binDir, `${tool}-${target}${ext}`);

if (existsSync(dest('ffmpeg')) && existsSync(dest('ffprobe')) && !process.argv.includes('--force')) {
  console.log(`FFmpeg já presente para ${target}`);
  process.exit(0);
}

async function get(url, asJson = false) {
  const headers = { 'User-Agent': 'amv-studio-build' };
  if (process.env.GITHUB_TOKEN && url.startsWith('https://api.github.com')) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(url, { headers, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} em ${url}`);
  return asJson ? r.json() : Buffer.from(await r.arrayBuffer());
}

function findFile(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    } else if (e.name === name) return p;
  }
  return null;
}

if (isWindows) {
  const release = await get('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest', true);
  const zips = release.assets
    .map((a) => ({ a, m: a.name.match(/^ffmpeg-n(\d+)\.(\d+)(?:\.(\d+))?-latest-win64-gpl-[\d.]+\.zip$/) }))
    .filter((x) => x.m)
    .sort((x, y) => Number(y.m[1]) - Number(x.m[1]) || Number(y.m[2]) - Number(x.m[2]));
  if (!zips.length) throw new Error('nenhum build win64 GPL encontrado na release');
  const asset = zips[0].a;
  const sums = release.assets.find((a) => a.name === 'checksums.sha256');
  if (!sums) throw new Error('release sem checksums.sha256');
  console.log(`Baixando ${asset.name} (${(asset.size / 1e6).toFixed(0)} MB) da release ${release.tag_name}`);
  const zip = await get(asset.browser_download_url);
  const expected = (await get(sums.browser_download_url)).toString('utf8').split('\n').find((l) => l.trim().endsWith(asset.name))?.split(/\s+/)[0];
  const actual = createHash('sha256').update(zip).digest('hex');
  if (!expected || expected !== actual) throw new Error(`checksum não confere para ${asset.name}`);
  const work = mkdtempSync(join(tmpdir(), 'ffmpeg-'));
  const zipPath = join(work, asset.name);
  writeFileSync(zipPath, zip);
  // tar do Windows 10+ (bsdtar) extrai zip
  execFileSync('tar', ['-xf', zipPath, '-C', work], { stdio: 'inherit' });
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const f = findFile(work, `${tool}.exe`);
    if (!f) throw new Error(`${tool}.exe não encontrado no zip`);
    copyFileSync(f, dest(tool));
  }
  writeFileSync(join(binDir, 'FFMPEG-SOURCE.txt'), `${asset.name}\nrelease ${release.tag_name}\nsha256 ${actual}\n`);
  rmSync(work, { recursive: true, force: true });
} else {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const which = execFileSync('which', [tool], { encoding: 'utf8' }).trim();
    if (!which) throw new Error(`${tool} não está instalado no sistema`);
    copyFileSync(which, dest(tool));
    chmodSync(dest(tool), 0o755);
  }
}
for (const tool of ['ffmpeg', 'ffprobe']) {
  const out = execFileSync(dest(tool), ['-version'], { encoding: 'utf8' }).split('\n')[0];
  console.log(`✓ ${tool}-${target}${ext} (${(statSync(dest(tool)).size / 1e6).toFixed(1)} MB): ${out}`);
}
