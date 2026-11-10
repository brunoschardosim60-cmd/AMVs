import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

  it('adiciona efeitos sobrepostos com direitos e desfaz cada inserção sem apagar o original', async () => {
    const s = await ProjectSession.create(nodePlatform(root), join(root, 'sound-design'), 'Sound design', {});
    const path = join(media, 'tom.flac');
    const rights = { origin: 'Biblioteca de testes', license: 'CC BY 4.0', attribution: 'Artista de teste' };

    await s.addSoundToTimeline({ path, name: 'Impacto', rights, startUs: 0 });
    await s.addSoundToTimeline({ path, name: 'Impacto', rights, startUs: 250_000 });

    expect(s.project.assets).toHaveLength(1);
    expect(s.project.assets[0]?.rights).toEqual(rights);
    expect(s.project.clips).toHaveLength(2);
    expect(s.project.clips.every((clip) => clip.trackId === s.project.tracks.find((track) => track.role === 'sfx')?.id)).toBe(true);

    s.undo();
    expect(s.project.clips).toHaveLength(1);
    s.undo();
    expect(s.project.clips).toHaveLength(0);
    expect(s.project.assets).toHaveLength(0);
    expect(await nodePlatform(root).fs.exists(path)).toBe(true);
    s.dispose();
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

  it('cria backup antes de substituir e restaura a versão anterior', async () => {
    const p = nodePlatform(root);
    const s = await ProjectSession.create(p, join(root, 'backup'), 'Original', {});
    const original = readFileSync(s.path, 'utf8');
    s.execute({ type: 'project.rename', name: 'Atualizado' });
    await s.save();

    const backups = await s.listBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatchObject({ valid: true });
    expect(Number.isNaN(Date.parse(backups[0]!.createdAt))).toBe(false);
    expect(readFileSync(backups[0]!.path, 'utf8')).toBe(original);
    await s.save();
    expect(await s.listBackups()).toHaveLength(1);

    await s.restoreBackup(backups[0]!.path);
    expect(s.project.name).toBe('Original');
    expect(s.dirty).toBe(true);
    s.undo();
    expect(s.project.name).toBe('Atualizado');
    s.redo();
    expect(s.project.name).toBe('Original');
    await s.save();
    expect((await ProjectSession.open(p, s.path)).session?.project.name).toBe('Original');
    s.dispose();
  });

  it('preserva o projeto anterior se faltar espaço durante a gravação', async () => {
    const p = nodePlatform(root);
    const s = await ProjectSession.create(p, join(root, 'no-space'), 'Antes', {});
    const original = readFileSync(s.path, 'utf8');
    s.execute({ type: 'project.rename', name: 'Depois' });
    const fs = p.fs;
    p.fs = {
      ...fs,
      async writeFile(path, data) {
        if (path === `${s.path}.transaction.tmp`) throw new Error('ENOSPC: no space left on device');
        await fs.writeFile(path, data);
      },
    };

    await expect(s.save()).rejects.toThrow(/ENOSPC/);
    expect(readFileSync(s.path, 'utf8')).toBe(original);
    expect(s.dirty).toBe(true);
    p.fs = fs;
    s.dispose();
  });

  it('recupera o arquivo íntegro se o app encerrar entre renomear e promover o temporário', async () => {
    const p = nodePlatform(root);
    const path = join(root, 'crash.amvproj');
    const s = await ProjectSession.create(p, path, 'Seguro', {});
    const original = readFileSync(path);
    s.dispose();
    rmSync(path);
    writeFileSync(`${path}.transaction.old`, original);
    writeFileSync(`${path}.transaction.tmp`, '{"partial":');

    const { session, result } = await ProjectSession.open(p, path);
    expect(result).toMatchObject({ ok: true, recovered: false });
    expect(session?.project.name).toBe('Seguro');
    expect(await p.fs.exists(`${path}.transaction.old`)).toBe(false);
    expect(await p.fs.exists(`${path}.transaction.tmp`)).toBe(false);
    session?.dispose();
  });

  it('duplica um projeto sem alterar o original', async () => {
    const p = nodePlatform(root);
    const original = await ProjectSession.create(p, join(root, 'original'), 'Original', { width: 1920, height: 1080 });
    const originalId = original.project.id;
    original.execute({ type: 'project.rename', name: 'Original atualizado' });
    await original.save();
    const duplicate = await original.duplicateTo(join(root, 'copia'), 'Cópia');

    expect(await p.fs.exists(original.path)).toBe(true);
    expect(duplicate.project).toMatchObject({
      name: 'Cópia',
      settings: { width: 1920, height: 1080 },
      schemaVersion: original.project.schemaVersion,
    });
    expect(duplicate.project.id).not.toBe(originalId);
    expect(await duplicate.listBackups()).toHaveLength(1);
    original.dispose();
    duplicate.dispose();
  });

  it('arquiva movendo o projeto e mantendo-o íntegro no destino', async () => {
    const p = nodePlatform(root);
    const session = await ProjectSession.create(p, join(root, 'ativo'), 'Para arquivar', { width: 1080, height: 1920 });
    session.execute({ type: 'project.rename', name: 'Para arquivar atualizado' });
    await session.save();
    const projectId = session.project.id;
    await session.archiveTo(join(root, 'arquivado'));

    expect(session.path).toBe(join(root, 'arquivado.amvproj'));
    expect(await p.fs.exists(join(root, 'ativo.amvproj'))).toBe(false);
    expect(await session.listBackups()).toHaveLength(1);
    const opened = await ProjectSession.open(p, session.path);
    expect(opened.result).toMatchObject({ ok: true, missing: 0 });
    expect(opened.session?.project).toMatchObject({ id: projectId, name: 'Para arquivar atualizado' });
    opened.session?.dispose();
    session.dispose();
  });

  it('cancela arquivamento se o destino ficar sem espaço, sem alterar a origem', async () => {
    const p = nodePlatform(root);
    const session = await ProjectSession.create(p, join(root, 'seguro'), 'Seguro', {});
    const destination = join(root, 'sem-espaco');
    const fs = p.fs;
    p.fs = {
      ...fs,
      async writeFile(path, data) {
        if (path === `${destination}.amvproj.transaction.tmp`) throw new Error('ENOSPC: no space left on device');
        await fs.writeFile(path, data);
      },
    };

    await expect(session.archiveTo(destination)).rejects.toThrow(/ENOSPC/);
    expect(await p.fs.exists(session.path)).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(await p.fs.readFile(session.path))).name).toBe('Seguro');
    expect(session.path).toBe(join(root, 'seguro.amvproj'));
    expect(await p.fs.exists(`${destination}.amvproj`)).toBe(false);
    p.fs = fs;
    session.dispose();
  });

  it('valida dependências e lista as mídias registradas no projeto', async () => {
    const p = nodePlatform(root);
    const s = await ProjectSession.create(p, join(root, 'deps'), 'Dependências', {});
    await s.importFiles([join(media, 'tom.flac')]);
    const report = await s.validateDependencies();
    expect(report.valid).toBe(true);
    expect(report.mediaUsage).toHaveLength(1);
    expect(report.mediaUsage[0]).toMatchObject({ path: join(media, 'tom.flac'), missing: false, clipIds: [] });
    s.dispose();
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
    const dependencyReport = await reopened.validateDependencies();
    expect(dependencyReport.valid).toBe(false);
    expect(dependencyReport.missingAssets).toHaveLength(2);

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
    s.dispose();
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
    s.execute({ type: 'project.rename', name: 'Alterado depois do snapshot' });
    s.execute({ type: 'settings.update', patch: { width: 640, height: 360 } });
    s.execute({ type: 'audioMix.update', patch: { targetLufs: -9 } });
    s.history.transaction('Gerar 2', run(2).commands);
    expect(s.project.clips.map((c) => c.id).sort()).not.toEqual(first);
    await s.restoreVersion(vid!);
    expect(s.project.clips.map((c) => c.id).sort()).toEqual(first);
    expect(s.project.name).toBe('Gen');
    expect(s.project.settings.width).toBe(1920);
    expect(s.project.audioMix.targetLufs).toBe(-14);
    s.undo();
    expect(s.project.clips.map((c) => c.id).sort()).not.toEqual(first);
    expect(s.project.name).toBe('Alterado depois do snapshot');
    expect(s.project.settings.width).toBe(640);
    expect(s.project.audioMix.targetLufs).toBe(-9);
    s.dispose();
  });
});

describe('aviso à interface', () => {
  it('o número que a tela lê não muda no meio da renderização, só quando a tela é avisada', async () => {
    const s = await ProjectSession.create(nodePlatform(root), join(root, 'ui'), 'UI', {});
    await new Promise((r) => setTimeout(r, 5));
    let calls = 0;
    s.subscribe(() => calls++);
    const before = s.changes;
    for (let i = 0; i < 50; i++) s.execute({ type: 'project.rename', name: `Nome ${i}` });
    expect(s.changes).toBe(before); // estável enquanto o React desenha
    await new Promise((r) => setTimeout(r, 5));
    expect(s.changes).toBeGreaterThan(before);
    expect(calls).toBe(1); // 50 mudanças = 1 aviso
    s.dispose();
  });
});
