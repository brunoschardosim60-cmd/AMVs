#!/usr/bin/env node
/**
 * Prepara uma versão nova: atualiza a versão em todos os lugares, confere o
 * CHANGELOG, cria o commit e a tag. O push da tag dispara o workflow Release.
 * Uso: node scripts/release.mjs 0.2.0 [--push]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('uso: node scripts/release.mjs <x.y.z> [--push]');
  process.exit(1);
}
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`\n## ${version}\n`)) {
  console.error(`CHANGELOG.md não tem a seção "## ${version}". Escreva as notas antes.`);
  process.exit(1);
}

const edit = (rel, fn) => {
  const p = join(root, rel);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};
edit('apps/desktop/src-tauri/tauri.conf.json', (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit('apps/desktop/package.json', (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit('apps/desktop/src-tauri/Cargo.toml', (s) => s.replace(/^version = "[^"]+"/m, `version = "${version}"`));

const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'inherit' });
git('add', '-A');
git('commit', '-m', `release: v${version}`);
git('tag', '-a', `v${version}`, '-m', `AMV Studio ${version}`);
if (process.argv.includes('--push')) {
  git('push');
  git('push', 'origin', `v${version}`);
}
console.log(`v${version} pronta${process.argv.includes('--push') ? ' e enviada' : '. Envie com: git push && git push origin v' + version}`);
