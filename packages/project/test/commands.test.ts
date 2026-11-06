import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError, ProjectHistory, findOverlaps, projectDurationUs } from '../src/index.js';
import { audioAsset, baseProject, clip, track, videoAsset } from './helpers.js';

function setup() {
  let p = baseProject();
  const v = videoAsset();
  const a = audioAsset();
  p = applyCommand(p, { type: 'asset.add', asset: v }).project;
  p = applyCommand(p, { type: 'asset.add', asset: a }).project;
  return { p, v, a, v1: track(p, 'V1'), music: track(p, 'Música'), text: track(p, 'Legendas') };
}

describe('comandos', () => {
  it('todo comando seguido do inverso devolve o projeto original', () => {
    const { p, v, a, v1, music } = setup();
    const c1 = clip(v1.id, v.id);
    const withClip = applyCommand(p, { type: 'clip.add', clip: c1 }).project;

    const cases = [
      { type: 'project.rename', name: 'Outro' },
      { type: 'settings.update', patch: { width: 1080, height: 1920 } },
      { type: 'clip.add', clip: clip(music.id, a.id) },
      { type: 'clip.update', clipId: c1.id, patch: { timelineStartUs: 5_000_000, speed: 2 } },
      { type: 'clip.remove', clipId: c1.id },
      { type: 'asset.update', assetId: v.id, patch: { status: 'missing' } },
      { type: 'asset.remove', assetId: v.id },
      { type: 'track.update', trackId: v1.id, patch: { muted: true, name: 'Principal' } },
      { type: 'track.remove', trackId: v1.id },
      {
        type: 'marker.add',
        marker: { id: 'mk1', kind: 'drop', atUs: 70_000_000, durationUs: 0, label: 'Drop', color: null, origin: 'ai', confidence: 0.8 },
      },
    ] as const;

    for (const cmd of cases) {
      const r = applyCommand(withClip, cmd);
      const back = applyCommand(r.project, r.inverse).project;
      expect(back, cmd.type).toEqual(withClip);
    }
  });

  it('remover mídia remove os clipes dela, e o undo devolve tudo na mesma posição', () => {
    const { p, v, a, v1, music } = setup();
    const h = new ProjectHistory(p);
    h.execute({ type: 'clip.add', clip: clip(v1.id, v.id, { id: 'c1' }) });
    h.execute({ type: 'clip.add', clip: clip(music.id, a.id, { id: 'c2' }) });
    h.execute({ type: 'clip.add', clip: clip(v1.id, v.id, { id: 'c3', timelineStartUs: 4_000_000 }) });
    const before = h.project;

    h.execute({ type: 'asset.remove', assetId: v.id });
    expect(h.project.clips.map((c) => c.id)).toEqual(['c2']);

    h.undo();
    expect(h.project).toEqual(before);
  });

  it('batch é atômico: se um comando falha, nada muda', () => {
    const { p, v, v1 } = setup();
    const ok = clip(v1.id, v.id, { id: 'ok' });
    expect(() =>
      applyCommand(p, {
        type: 'batch',
        commands: [{ type: 'clip.add', clip: ok }, { type: 'clip.remove', clipId: 'nao-existe' }],
      }),
    ).toThrow(CommandError);
    expect(p.clips).toHaveLength(0);
  });

  it('valida regras: trilha travada, tipo de trilha, ids duplicados e trechos inválidos', () => {
    const { p, v, a, v1, music, text } = setup();
    expect(() => applyCommand(p, { type: 'clip.add', clip: clip(v1.id, a.id) })).toThrow(/áudio não pode/);
    expect(() => applyCommand(p, { type: 'clip.add', clip: clip(text.id, v.id) })).toThrow(/texto/);
    expect(() =>
      applyCommand(p, { type: 'clip.add', clip: clip(v1.id, v.id, { sourceInUs: 5, sourceOutUs: 1 }) }),
    ).toThrow();
    expect(() => applyCommand(p, { type: 'clip.add', clip: clip(v1.id, v.id, { durationUs: 1.5 }) })).toThrow();

    const locked = applyCommand(p, { type: 'track.update', trackId: music.id, patch: { locked: true } }).project;
    expect(() => applyCommand(locked, { type: 'clip.add', clip: clip(music.id, a.id) })).toThrow(/travada/);

    const c = clip(v1.id, v.id, { id: 'x' });
    const once = applyCommand(p, { type: 'clip.add', clip: c }).project;
    expect(() => applyCommand(once, { type: 'clip.add', clip: c })).toThrow(/já existe/);
  });

  it('o projeto original nunca é mutado', () => {
    const { p, v, v1 } = setup();
    const snapshot = structuredClone(p);
    applyCommand(p, { type: 'clip.add', clip: clip(v1.id, v.id) });
    applyCommand(p, { type: 'track.update', trackId: v1.id, patch: { hidden: true } });
    expect(p).toEqual(snapshot);
  });
});

describe('histórico', () => {
  it('undo/redo, rótulos, transação e estado "modificado"', () => {
    const { p, v, v1 } = setup();
    const h = new ProjectHistory(p);
    expect(h.canUndo).toBe(false);
    expect(h.dirty).toBe(false);

    h.transaction('Montagem da IA', [
      { type: 'clip.add', clip: clip(v1.id, v.id, { id: 'a', timelineStartUs: 0 }) },
      { type: 'clip.add', clip: clip(v1.id, v.id, { id: 'b', timelineStartUs: 2_000_000 }) },
    ]);
    expect(h.project.clips).toHaveLength(2);
    expect(h.undoLabel).toBe('Montagem da IA');
    expect(h.dirty).toBe(true);

    h.undo();
    expect(h.project.clips).toHaveLength(0);
    expect(h.redoLabel).toBe('Montagem da IA');

    h.redo();
    expect(h.project.clips).toHaveLength(2);
    h.markSaved();
    expect(h.dirty).toBe(false);

    h.execute({ type: 'clip.update', clipId: 'a', patch: { durationUs: 1_000_000 } });
    expect(h.canRedo).toBe(false);
    expect(projectDurationUs(h.project)).toBe(4_000_000);
    expect(findOverlaps(h.project)).toEqual([]);
  });

  it('comando inválido não entra no histórico', () => {
    const { p } = setup();
    const h = new ProjectHistory(p);
    expect(() => h.execute({ type: 'clip.remove', clipId: 'nada' })).toThrow();
    expect(h.canUndo).toBe(false);
    expect(h.version).toBe(0);
  });

  it('respeita o limite de passos', () => {
    const { p } = setup();
    const h = new ProjectHistory(p, { limit: 3 });
    for (let i = 0; i < 5; i++) h.execute({ type: 'project.rename', name: `n${i}` });
    let undos = 0;
    while (h.canUndo) {
      h.undo();
      undos++;
    }
    expect(undos).toBe(3);
    expect(h.project.name).toBe('n1');
  });
});

describe('mudanças do sistema', () => {
  it('applySystem não cria undo nem marca como modificado', () => {
    let p = baseProject();
    const v = videoAsset({ status: 'processing' });
    p = applyCommand(p, { type: 'asset.add', asset: v }).project;
    const h = new ProjectHistory(p);
    h.applySystem({ type: 'asset.update', assetId: v.id, patch: { status: 'ok' } });
    expect(h.project.assets[0]!.status).toBe('ok');
    expect(h.canUndo).toBe(false);
    expect(h.dirty).toBe(false);
    h.markUnsaved();
    expect(h.dirty).toBe(true);
  });
});
