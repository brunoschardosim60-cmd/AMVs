import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autosavePath, ProjectSession } from '../src/core/session';
import { loadRecents, sortRecents, updateRecent } from '../src/core/recents';
import { nodePlatform } from './node-platform';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/generated');
let root: string;
let media: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'amv-session-'));
  media = join(root, 'midia');
  mkdirSync(media);
  for (const f of ['hevc10_23976.mkv', 'tom.flac', 'imagem.png', 'musica_capa.mp3']) copyFileSync(join(FIX, f), join(media, f));
});
afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

async function waitProcessed(s: ProjectSession) {
  for (let i = 0; i < 400; i++) {
    if (s.project.assets.every((a) => a.status !== 'processing')) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('processamento não terminou');
}

describe('sessão do projeto', () => {
  it('cria, importa, salva e reabre exatamente igual', async () => {
    const p = nodePlatform(root);
    const s = await ProjectSession.create(p, join(root, 'Meu AMV'), 'Meu AMV', { width: 1080, height: 1920, fps: { num: 60, den: 1 } });
    expect(s.path).toBe(join(root, 'Meu AMV.amvproj'));
    expect(s.dirty).toBe(false);

    const report = await s.importFiles([
      join(media, 'hevc10_23976.mkv'),
      join(media, 'tom.flac'),
      join(media, 'imagem.png'),
      join(media, 'leia-me.txt'),
      join(media, 'musica_capa.mp3'),
    ]);
    expect(report.imported).toHaveLength(4);
    expect(report.skipped).toEqual([{ path: join(media, 'leia-me.txt'), reason: 'formato não suportado' }]);
    expect(s.project.assets.map((a) => a.kind)).toEqual(['video', 'audio', 'image', 'audio']);
    expect(s.history.undoLabel).toBe('Importar 4 arquivos');
    expect(s.dirty).toBe(true);

    await waitProcessed(s);
    expect(s.project.assets.every((a) => a.status === 'ok')).toBe(true);
    const video = s.project.assets[0]!;
    expect(s.assetRuntime(video.id).artifacts?.proxyPath).toBeTruthy();
    expect(s.assetRuntime(video.id).warnings.join()).toMatch(/10-bit/);

    // importar o mesmo arquivo de novo não duplica
    const again = await s.importFiles([join(media, 'tom.flac')]);
    expect(again.skipped[0]!.reason).toMatch(/já está no projeto/);

    await s.save();
    expect(s.dirty).toBe(false);
    const saved = s.project;
    s.dispose();

    const { session, result } = await ProjectSession.open(p, s.path);
    expect(result).toEqual({ ok: true, recovered: false, missing: 0 });
    await waitProcessed(session!);
    expect({ ...session!.project, updatedAt: '' }).toEqual({ ...saved, updatedAt: '' });
    expect(session!.dirty).toBe(false);
    // tudo vem do cache: nenhum job de proxy novo
    expect(session!.queue.list().filter((j) => j.kind === 'proxy')).toEqual([]);

    // a miniatura entra nos recentes de forma assíncrona: espera até 5 s (CI do Windows é mais lento)
    let recents = await loadRecents(p);
    for (let i = 0; i < 100 && !recents[0]?.posterPath; i++) {
      await new Promise((r) => setTimeout(r, 50));
      recents = await loadRecents(p);
    }
    expect(recents[0]).toMatchObject({ name: 'Meu AMV', assetCount: 4 });
    expect(recents[0]!.posterPath).toBeTruthy();
  });

  it('undo da importação cancela jobs; redo reprocessa', async () => {
    const s = await ProjectSession.create(nodePlatform(root), join(root, 'a'), 'A', {});
    await s.importFiles([join(media, 'hevc10_23976.mkv')]);
    s.undo();
    expect(s.project.assets).toHaveLength(0);
    s.redo();
    await waitProcessed(s);
    expect(s.project.assets[0]!.status).toBe('ok');
  });

  it('autosave e recuperação', async () => {
    const p = nodePlatform(root);
    const s = await ProjectSession.create(p, join(root, 'b'), 'B', {});
    expect(await s.autosave()).toBe(false); // nada mudou
    s.execute({ type: 'project.rename', name: 'B editado' });
    expect(await s.autosave()).toBe(true);
    expect(await s.autosave()).toBe(false); // nada novo desde o último
    expect(await ProjectSession.hasRecovery(p, s.path)).toBe(true);

    // simula queda do app: abre de novo, preferindo o autosave
    const { session, result } = await ProjectSession.open(p, s.path, true);
    expect(result).toMatchObject({ ok: true, recovered: true });
    expect(session!.project.name).toBe('B editado');
    expect(session!.dirty).toBe(true);

    await session!.save();
    expect(await p.fs.exists(autosavePath(s.path))).toBe(false);
    expect(await ProjectSession.hasRecovery(p, s.path)).toBe(false);
  });

  it('mídia movida aparece como ausente e é relocalizada pela pasta', async () => {
    const p = nodePlatform(root);
    const s = await ProjectSession.create(p, join(root, 'c'), 'C', {});
    await s.importFiles([join(media, 'hevc10_23976.mkv'), join(media, 'tom.flac')]);
    await waitProcessed(s);
    await s.save();
    s.dispose();

    const moved = join(root, 'HD externo', 'Animes', 'temporada 1');
    mkdirSync(moved, { recursive: true });
    renameSync(join(media, 'hevc10_23976.mkv'), join(moved, 'ep01-renomeado.mkv'));
    renameSync(join(media, 'tom.flac'), join(moved, 'tom.flac'));
    copyFileSync(join(FIX, 'h264_30fps.mp4'), join(moved, 'outro.mp4'));

    const { session } = await ProjectSession.open(p, s.path);
    const reopened = session!;
    expect(reopened.project.assets.map((a) => a.status)).toEqual(['missing', 'missing']);
    expect(reopened.dirty).toBe(false);

    const r = await reopened.relocateFromFolder(join(root, 'HD externo'));
    expect(r).toEqual({ found: 2, stillMissing: 0 });
    await waitProcessed(reopened);
    expect(reopened.project.assets.map((a) => a.status)).toEqual(['ok', 'ok']);
    expect(reopened.project.assets[0]!.path).toBe(join(moved, 'ep01-renomeado.mkv'));
    expect(reopened.history.undoLabel).toBe('Localizar 2 mídia(s)');
    reopened.dispose(); // para a análise (no Windows o FFmpeg prende o arquivo)
  });

  it('relocalizar manualmente confere se é o mesmo arquivo', async () => {
    const p = nodePlatform(root);
    const s = await ProjectSession.create(p, join(root, 'd'), 'D', {});
    await s.importFiles([join(media, 'tom.flac')]);
    const id = s.project.assets[0]!.id;
    expect(await s.relocate(id, join(media, 'musica_capa.mp3'))).toBe('mismatch');
    expect(s.project.assets[0]!.path).toBe(join(media, 'tom.flac'));
    expect(await s.relocate(id, join(media, 'musica_capa.mp3'), true)).toBe('ok');
    expect(s.project.assets[0]!.name).toBe('musica_capa.mp3');
    await waitProcessed(s);
  });

  it('erro de leitura de projeto é claro', async () => {
    const p = nodePlatform(root);
    const bad = join(root, 'ruim.amvproj');
    await p.fs.writeFile(bad, new TextEncoder().encode('{"schemaVersion": 1}'));
    const { session, result } = await ProjectSession.open(p, bad);
    expect(session).toBeNull();
    expect(result).toMatchObject({ ok: false, error: 'o projeto tem dados inválidos' });
    const gone = await ProjectSession.open(p, join(root, 'nao-existe.amvproj'));
    expect(gone.result).toMatchObject({ ok: false, error: 'o arquivo do projeto não existe mais' });
  });

  it('recentes: favoritos primeiro', async () => {
    const p = nodePlatform(root);
    const a = await ProjectSession.create(p, join(root, 'x'), 'X', {});
    await ProjectSession.create(p, join(root, 'y'), 'Y', {});
    await updateRecent(p, a.path, { favorite: true });
    expect(sortRecents(await loadRecents(p)).map((r) => r.name)).toEqual(['X', 'Y']);
  });
});

describe('recentes sob concorrência', () => {
  it('gravações simultâneas não perdem entradas', async () => {
    const { rememberRecent, updateRecent } = await import('../src/core/recents');
    const p = nodePlatform(root);
    const base = { name: 'P', openedAt: new Date().toISOString(), durationUs: 0, assetCount: 0, posterPath: null };
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => [
        rememberRecent(p, { ...base, path: `/p/${i}.amvproj`, name: `P${i}` }),
        updateRecent(p, `/p/${i}.amvproj`, { posterPath: `/c/${i}.jpg` }),
      ]).flat(),
    );
    const list = await loadRecents(p);
    expect(list).toHaveLength(20);
    expect(list.every((r) => r.posterPath)).toBe(true);
  });
});

describe('análise automática', () => {
  it('analisa música e episódio depois de importar, e reaproveita o cache', async () => {
    const p = nodePlatform(root);
    const s = await ProjectSession.create(p, join(root, 'an'), 'An', {});
    copyFileSync(join(FIX, 'click_120bpm.wav'), join(media, 'click.wav'));
    await s.importFiles([join(media, 'click.wav'), join(media, 'hevc10_23976.mkv')]);
    const done = async () => {
      for (let i = 0; i < 600; i++) {
        if (s.project.assets.every((a) => ['done', 'error'].includes(s.assetRuntime(a.id).analysis ?? ''))) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error('análise não terminou');
    };
    await done();
    const [music, ep] = s.project.assets;
    expect(Math.abs(s.assetRuntime(music!.id).music!.bpm - 120)).toBeLessThan(2);
    expect(s.assetRuntime(ep!.id).episode!.subtitles[0]?.text).toBe('Eu não vou perder!');
    await s.save();
    s.dispose();
    const { session } = await ProjectSession.open(p, s.path);
    for (let i = 0; i < 400 && session!.project.assets.some((a) => session!.assetRuntime(a.id).analysis !== 'done'); i++) await new Promise((r) => setTimeout(r, 25));
    expect(session!.queue.list().filter((j) => j.kind === 'analysis')).toEqual([]);
    expect(session!.assetRuntime(music!.id).music).toBeTruthy();
  });
});

describe('gerar AMV e versões', () => {
  it('gera com mídia analisada, guarda a anterior como versão e volta para ela', async () => {
    const { generateAmv } = await import('@amv/automv');
    const p = nodePlatform(root);
    const s = await ProjectSession.create(p, join(root, 'gen'), 'Gen', {});
    copyFileSync(join(FIX, 'click_120bpm.wav'), join(media, 'click.wav'));
    await s.importFiles([join(media, 'click.wav'), join(media, 'hevc10_23976.mkv')]);
    for (let i = 0; i < 600 && s.project.assets.some((a) => !['done', 'error'].includes(s.assetRuntime(a.id).analysis ?? '')); i++) await new Promise((r) => setTimeout(r, 25));
    const [m, e] = s.project.assets;
    const opts = { style: 'hype' as const, intensity: 2 as const, durationS: 8, musicStartS: null, useSpeech: true, useEffects: true, showText: true, seed: 1 };
    const run = (seed: number) =>
      generateAmv(s.project, { assetId: m!.id, name: m!.name, analysis: s.assetRuntime(m!.id).music! }, [{ assetId: e!.id, name: e!.name, analysis: s.assetRuntime(e!.id).episode!, hasAudio: true }], { ...opts, seed });
    const r1 = run(1); 
    s.history.transaction("Gerar", r1.commands);
    expect(s.project.clips.length).toBeGreaterThan(2);
    const first = s.project.clips.map((c) => c.id).sort();
    const vid = await s.saveVersion('Primeira');
    expect(vid).toBeTruthy();
    s.history.transaction('Gerar 2', run(2).commands);
    expect(s.project.clips.map((c) => c.id).sort()).not.toEqual(first);
    await s.restoreVersion(vid!);
    expect(s.project.clips.map((c) => c.id).sort()).toEqual(first);
    s.undo();
    expect(s.project.clips.map((c) => c.id).sort()).not.toEqual(first);
    s.dispose();
  });
});
