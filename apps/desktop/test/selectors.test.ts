import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : /\.tsx?$/.test(f) ? [join(d, f)] : []));

it('seletores do Zustand não criam função/objeto/lista nova (isso trava a tela com o erro #185)', () => {
  const bad: string[] = [];
  for (const f of files(SRC)) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/use(App|Editor|Player)\(\(\w+\) => (\(|\{|\[|new )/.test(line)) bad.push(`${f.slice(SRC.length)}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(bad).toEqual([]);
});
