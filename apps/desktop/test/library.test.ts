import { copyFileSync, mkdirSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recommend } from '@amv/music';
import { MusicLibrary } from '../src/core/library';
import { nodePlatform } from './node-platform';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/generated');
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'amv-lib-'));
  mkdirSync(join(root, 'musicas', 'sub'), { recursive: true });
  copyFileSync(join(FIX, 'click_120bpm.wav'), join(root, 'musicas', 'click.wav'));
  copyFileSync(join(FIX, 'musica_capa.mp3'), join(root, 'musicas', 'sub', 'capa.mp3'));
  copyFileSync(join(FIX, 'imagem.png'), join(root, 'musicas', 'nao.png'));
});
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

async function settled(l: MusicLibrary) {
  for (let i = 0; i < 600 && l.lib.tracks.some((t) => t.status === 'analyzing'); i++) await new Promise((r) => setTimeout(r, 25));
}

describe('biblioteca de músicas', () => {
  it('importa pasta, analisa, guarda, detecta duplicata e arquivo sumido', async () => {
    const p = nodePlatform(root);
    const lib = new MusicLibrary(p);
    const r = await lib.add([join(root, 'musicas')]);
    expect(r).toEqual({ added: 2, duplicates: 0, skipped: 0 });
    await settled(lib);
    const click = lib.lib.tracks.find((t) => t.name === 'click.wav')!;
    expect(click.status).toBe('ok');
    expect(Math.abs(click.summary!.bpm - 120)).toBeLessThan(2);
    await lib.correctTempo(click.id, 'double');
    expect(Math.abs(click.summary!.bpm - 240)).toBeLessThan(4);
    await lib.setManualTempo(click.id, 100, 0.2);
    expect(Math.abs(click.summary!.bpm - 100)).toBeLessThan(0.01);
    expect((await lib.analysis(click.id))!.beats[0]).toBeCloseTo(0.2);
    expect((await lib.add([join(root, 'musicas', 'click.wav')])).duplicates).toBe(1);

    const pl = lib.createPlaylist('Luta', [click.id]);
    lib.update([click.id], { favorite: true, emotion: 'luta' });
    await lib.flush();

    renameSync(join(root, 'musicas', 'click.wav'), join(root, 'click-movido.wav'));
    const lib2 = new MusicLibrary(p);
    await lib2.load();
    const c2 = lib2.track(click.id)!;
    expect(c2.status).toBe('missing');
    expect(c2.favorite).toBe(true);
    expect(lib2.lib.playlists[0]!.name).toBe(pl.name);
    // reimportar o arquivo movido religa a mesma faixa
    await lib2.add([join(root, 'click-movido.wav')]);
    expect(lib2.track(click.id)!.status).toBe('ok');
    expect(lib2.track(click.id)!.path).toBe(join(root, 'click-movido.wav'));
    // análise completa vem do cache, sem rodar de novo
    const restored = (await lib2.analysis(click.id))!;
    expect(restored.beats.length).toBeGreaterThan(5);
    expect(Math.abs(restored.bpm - 100)).toBeLessThan(0.01);
    expect(restored.beats[0]).toBeCloseTo(0.2);
    expect(recommend(lib2.lib, 'luta').map((x) => x.track.id)).toContain(click.id);
  });
});
