import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  clearRange,
  clipsOnTrack,
  copyClips,
  deleteClips,
  duplicateClips,
  EditError,
  findOverlaps,
  findSnap,
  insertAsset,
  moveClips,
  pasteClips,
  ProjectHistory,
  snapPoints,
  splitAllAt,
  splitClip,
  sourceTimeAt,
  trimBounds,
  trimClip,
  type Command,
  type Project,
} from '../src/index.js';
import { audioAsset, baseProject, track, videoAsset } from './helpers.js';

const S = 1_000_000;

function apply(p: Project, cmds: Command[]): Project {
  return applyCommand(p, { type: 'batch', commands: cmds }).project;
}

/** Projeto com um episódio de 10 min e uma música de 3 min. */
function setup() {
  let p = baseProject();
  const ep = videoAsset({
    id: 'ep',
    probe: {
      container: 'matroska', durationUs: 600 * S, sizeBytes: 1, bitRate: null,
      video: { codec: 'hevc', profile: null, width: 1920, height: 1080, pixFmt: null, bitDepth: 8, fps: { num: 24000, den: 1001 }, avgFps: null, vfr: false, frameCount: null },
      audio: [], subtitles: [], tags: {},
    },
  });
  const mus = audioAsset({
    id: 'mus',
    probe: { container: 'flac', durationUs: 180 * S, sizeBytes: 1, bitRate: null, video: null, audio: [], subtitles: [], tags: {} },
  });
  const img = videoAsset({ id: 'img', kind: 'image', name: 'logo.png', hash: 'v1:img', probe: null });
  p = apply(p, [{ type: 'asset.add', asset: ep }, { type: 'asset.add', asset: mus }, { type: 'asset.add', asset: img }]);
  return { p, v1: track(p, 'V1').id, v2: track(p, 'V2').id, music: track(p, 'Música').id, text: track(p, 'Legendas').id };
}

/** Coloca o trecho [srcIn, srcIn+dur) do episódio em V1 a partir de `at`. */
function place(p: Project, trackId: string, at: number, dur: number, srcIn = 0, id?: string): Project {
  return apply(p, insertAsset(p, { assetId: 'ep', trackId, startUs: at, sourceInUs: srcIn, sourceOutUs: srcIn + dur, clipId: id }));
}

const layout = (p: Project, trackId: string) =>
  clipsOnTrack(p, trackId).map((c) => [c.timelineStartUs / S, c.durationUs / S, c.sourceInUs / S]);

describe('inserir mídia', () => {
  it('trecho escolhido, mídia inteira e imagem com 3 s', () => {
    const { p, v1, music } = setup();
    const a = place(p, v1, 5 * S, 2 * S, 100 * S, 'a');
    expect(a.clips[0]).toMatchObject({ timelineStartUs: 5 * S, durationUs: 2 * S, sourceInUs: 100 * S, sourceOutUs: 102 * S, label: 'ep01.mkv' });
    const b = apply(a, insertAsset(a, { assetId: 'mus', trackId: music, startUs: 0 }));
    expect(b.clips.find((c) => c.assetId === 'mus')!.durationUs).toBe(180 * S);
    const c = apply(b, insertAsset(b, { assetId: 'img', trackId: v1, startUs: 20 * S }));
    expect(c.clips.find((x) => x.assetId === 'img')!.durationUs).toBe(3 * S);
  });

  it('recusa tipo errado de trilha, trilha travada e mídia ausente', () => {
    const { p, v1, music, text } = setup();
    expect(() => insertAsset(p, { assetId: 'mus', trackId: v1, startUs: 0 })).toThrow(EditError);
    expect(() => insertAsset(p, { assetId: 'img', trackId: music, startUs: 0 })).toThrow(EditError);
    expect(() => insertAsset(p, { assetId: 'ep', trackId: text, startUs: 0 })).toThrow(EditError);
    const locked = apply(p, [{ type: 'track.update', trackId: v1, patch: { locked: true } }]);
    expect(() => insertAsset(locked, { assetId: 'ep', trackId: v1, startUs: 0 })).toThrow(/travada/);
    const missing = apply(p, [{ type: 'asset.update', assetId: 'ep', patch: { status: 'missing' } }]);
    expect(() => insertAsset(missing, { assetId: 'ep', trackId: v1, startUs: 0 })).toThrow(/não foi encontrada/);
  });

  it('inserir por cima sobrescreve o que estava embaixo', () => {
    const { p, v1 } = setup();
    let q = place(p, v1, 0, 10 * S, 0);
    q = place(q, v1, 4 * S, 2 * S, 300 * S);
    expect(layout(q, v1)).toEqual([
      [0, 4, 0],
      [4, 2, 300],
      [6, 4, 6],
    ]);
    expect(findOverlaps(q)).toEqual([]);
  });
});

describe('dividir', () => {
  it('divide preservando o trecho de origem e repartindo keyframes', () => {
    const { p, v1 } = setup();
    let q = place(p, v1, 10 * S, 4 * S, 100 * S, 'x');
    q = apply(q, [{ type: 'clip.update', clipId: 'x', patch: { keyframes: { 'transform.scale': [{ atUs: 0, value: 1, easing: 'linear' }, { atUs: 3 * S, value: 2, easing: 'linear' }] } } }]);
    q = apply(q, splitClip(q, 'x', 11 * S, 'y'));
    expect(layout(q, v1)).toEqual([
      [10, 1, 100],
      [11, 3, 101],
    ]);
    const [l, r] = clipsOnTrack(q, v1);
    expect(l!.sourceOutUs).toBe(101 * S);
    expect(l!.keyframes['transform.scale']).toEqual([
      { atUs: 0, value: 1, easing: 'linear' },
      { atUs: S, value: 4 / 3, easing: 'linear' },
    ]);
    expect(r!.keyframes['transform.scale']).toEqual([
      { atUs: 0, value: 4 / 3, easing: 'linear' },
      { atUs: 2 * S, value: 2, easing: 'linear' },
      { atUs: 3 * S, value: 2, easing: 'linear' },
    ]);
  });

  it('divide uma curva de velocidade sem alterar o mapeamento de origem', () => {
    const { p, v1 } = setup();
    let q = place(p, v1, 0, 4 * S, 100 * S, 'ramp');
    q = apply(q, [{ type: 'clip.update', clipId: 'ramp', patch: { keyframes: { speed: [
      { atUs: 0, value: 0.5, easing: 'linear' },
      { atUs: 4 * S, value: 1.5, easing: 'linear' },
    ] } } }]);
    const original = q.clips[0]!;
    q = apply(q, splitClip(q, 'ramp', 2 * S, 'ramp-right'));
    const [left, right] = clipsOnTrack(q, v1);
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    for (const localUs of [0, S / 2, S, 3 * S / 2]) {
      expect(sourceTimeAt(left!, localUs)).toBeCloseTo(sourceTimeAt(original, localUs), -2);
    }
    for (const localUs of [0, S / 2, S, 2 * S - 1]) {
      expect(sourceTimeAt(right!, localUs)).toBeCloseTo(sourceTimeAt(original, 2 * S + localUs), -2);
    }
  });

  it('respeita velocidade: a 2x, 1 s de timeline = 2 s de origem', () => {
    const { p, v1 } = setup();
    let q = place(p, v1, 0, 4 * S, 0, 'x');
    q = apply(q, [{ type: 'clip.update', clipId: 'x', patch: { speed: 2, durationUs: 2 * S } }]);
    q = apply(q, splitClip(q, 'x', 1 * S));
    expect(layout(q, v1)).toEqual([
      [0, 1, 0],
      [1, 1, 2],
    ]);
  });

  it('não divide na borda; "dividir tudo" pega todas as trilhas destravadas', () => {
    const { p, v1, v2 } = setup();
    let q = place(p, v1, 0, 4 * S, 0, 'x');
    expect(splitClip(q, 'x', 0)).toEqual([]);
    expect(splitClip(q, 'x', 4 * S)).toEqual([]);
    q = place(q, v2, 1 * S, 4 * S, 50 * S);
    const r = apply(q, splitAllAt(q, 2 * S));
    expect(r.clips).toHaveLength(4);
    const locked = apply(q, [{ type: 'track.update', trackId: v2, patch: { locked: true } }]);
    expect(apply(locked, splitAllAt(locked, 2 * S)).clips).toHaveLength(3);
  });
});

describe('aparar', () => {
  it('limitado pela mídia de origem e pelos vizinhos', () => {
    const { p, v1 } = setup();
    let q = place(p, v1, 10 * S, 2 * S, 5 * S, 'x');
    q = place(q, v1, 14 * S, 2 * S, 0, 'n');
    expect(trimBounds(q, 'x', 'start')).toEqual({ min: 5 * S, max: 12 * S - 1000 });
    expect(trimBounds(q, 'x', 'end')).toEqual({ min: 10 * S + 1000, max: 14 * S });

    // puxar o início para antes do possível para em 5 s (origem começa em 0)
    const a = apply(q, trimClip(q, 'x', 'start', 0));
    expect(a.clips.find((c) => c.id === 'x')).toMatchObject({ timelineStartUs: 5 * S, durationUs: 7 * S, sourceInUs: 0 });
    // estender o fim encosta no vizinho
    const b = apply(q, trimClip(q, 'x', 'end', 99 * S));
    expect(b.clips.find((c) => c.id === 'x')).toMatchObject({ durationUs: 4 * S, sourceOutUs: 9 * S });
  });

  it('não passa do fim da mídia', () => {
    const { p, v1 } = setup();
    const q = place(p, v1, 0, 2 * S, 598 * S, 'x');
    expect(trimBounds(q, 'x', 'end').max).toBe(2 * S);
  });
});

describe('mover', () => {
  it('move entre trilhas e sobrescreve o destino', () => {
    const { p, v1, v2 } = setup();
    let q = place(p, v1, 0, 4 * S, 0, 'a');
    q = place(q, v2, 0, 10 * S, 100 * S, 'b');
    q = apply(q, moveClips(q, [{ clipId: 'a', trackId: v2, startUs: 3 * S }]));
    expect(layout(q, v1)).toEqual([]);
    expect(layout(q, v2)).toEqual([
      [0, 3, 100],
      [3, 4, 0],
      [7, 3, 107],
    ]);
  });

  it('grupo: mantém o espaçamento e não corta os próprios clipes', () => {
    const { p, v1 } = setup();
    let q = place(p, v1, 0, 2 * S, 0, 'a');
    q = place(q, v1, 2 * S, 2 * S, 10 * S, 'b');
    q = apply(q, moveClips(q, [
      { clipId: 'a', trackId: v1, startUs: 1 * S },
      { clipId: 'b', trackId: v1, startUs: 3 * S },
    ]));
    expect(layout(q, v1)).toEqual([
      [1, 2, 0],
      [3, 2, 10],
    ]);
  });

  it('grupo sobre o MESMO clipe de destino não quebra', () => {
    const { p, v1, v2 } = setup();
    let q = place(p, v2, 0, 20 * S, 0, 'base');
    q = place(q, v1, 0, 1 * S, 100 * S, 'a');
    q = place(q, v1, 5 * S, 1 * S, 200 * S, 'b');
    q = apply(q, moveClips(q, [
      { clipId: 'a', trackId: v2, startUs: 2 * S },
      { clipId: 'b', trackId: v2, startUs: 7 * S },
    ]));
    expect(layout(q, v2)).toEqual([
      [0, 2, 0],
      [2, 1, 100],
      [3, 4, 3],
      [7, 1, 200],
      [8, 12, 8],
    ]);
    expect(findOverlaps(q)).toEqual([]);
  });

  it('recusa trilha errada, travada ou tempo negativo', () => {
    const { p, v1, music } = setup();
    const q = place(p, v1, 0, 2 * S, 0, 'a');
    // o episódio de teste não tem faixa de áudio: não pode ir para trilha de áudio
    expect(() => moveClips(q, [{ clipId: 'a', trackId: music, startUs: 0 }])).toThrow(EditError);
    const comAudio = apply(q, [{ type: 'asset.update', assetId: 'ep', patch: { probe: { ...q.assets[0]!.probe!, audio: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: null, language: 'jpn', title: null }] } } }]);
    expect(() => moveClips(comAudio, [{ clipId: 'a', trackId: music, startUs: 0 }])).not.toThrow();
    expect(() => moveClips(q, [{ clipId: 'a', trackId: v1, startUs: -5 }])).toThrow(/antes do zero/);
  });

  it('um gesto inteiro é um único desfazer', () => {
    const { p, v1, v2 } = setup();
    let q = place(p, v1, 0, 4 * S, 0, 'a');
    q = place(q, v2, 0, 10 * S, 100 * S, 'b');
    const h = new ProjectHistory(q);
    h.transaction('Mover clipe', moveClips(q, [{ clipId: 'a', trackId: v2, startUs: 3 * S }]));
    h.undo();
    expect(h.project).toEqual(q);
  });
});

describe('excluir, copiar, colar e duplicar', () => {
  it('excluir com e sem fechar o buraco', () => {
    const { p, v1 } = setup();
    let q = place(p, v1, 0, 2 * S, 0, 'a');
    q = place(q, v1, 2 * S, 3 * S, 10 * S, 'b');
    q = place(q, v1, 5 * S, 1 * S, 20 * S, 'c');
    expect(layout(apply(q, deleteClips(q, ['b'])), v1)).toEqual([
      [0, 2, 0],
      [5, 1, 20],
    ]);
    expect(layout(apply(q, deleteClips(q, ['b'], true)), v1)).toEqual([
      [0, 2, 0],
      [2, 1, 20],
    ]);
  });

  it('colar no playhead mantém espaçamento e gera ids novos', () => {
    const { p, v1, v2 } = setup();
    let q = place(p, v1, 1 * S, 1 * S, 0, 'a');
    q = place(q, v2, 2 * S, 1 * S, 5 * S, 'b');
    const data = copyClips(q, ['a', 'b']);
    const { commands, newIds } = pasteClips(q, data, 10 * S);
    q = apply(q, commands);
    expect(newIds).toHaveLength(2);
    expect(newIds).not.toContain('a');
    expect(layout(q, v1).at(-1)).toEqual([10, 1, 0]);
    expect(layout(q, v2).at(-1)).toEqual([11, 1, 5]);
  });

  it('colar um grupo cria uma associação independente e não herda grupo ao copiar um único membro', () => {
    const { p, v1, v2 } = setup();
    let q = place(p, v1, 0, S, 0, 'a');
    q = place(q, v2, S, S, 5 * S, 'b');
    q = apply(q, [
      { type: 'clip.update', clipId: 'a', patch: { groupId: 'original-group' } },
      { type: 'clip.update', clipId: 'b', patch: { groupId: 'original-group' } },
    ]);

    const copy = pasteClips(q, copyClips(q, ['a', 'b']), 10 * S);
    q = apply(q, copy.commands);
    const groupedCopies = copy.newIds.map((id) => q.clips.find((clip) => clip.id === id)!);
    expect(groupedCopies[0]!.groupId).not.toBe('original-group');
    expect(groupedCopies[0]!.groupId).toBe(groupedCopies[1]!.groupId);
    expect(q.clips.find((clip) => clip.id === 'a')!.groupId).toBe('original-group');

    const singleCopy = pasteClips(q, copyClips(q, ['a']), 20 * S);
    const afterSingleCopy = apply(q, singleCopy.commands);
    expect(afterSingleCopy.clips.find((clip) => clip.id === singleCopy.newIds[0])!.groupId).toBeNull();
  });

  it('duplicar coloca logo depois da seleção', () => {
    const { p, v1 } = setup();
    let q = place(p, v1, 0, 2 * S, 0, 'a');
    q = place(q, v1, 2 * S, 1 * S, 50 * S, 'b');
    q = apply(q, duplicateClips(q, ['a', 'b']).commands);
    expect(layout(q, v1)).toEqual([
      [0, 2, 0],
      [2, 1, 50],
      [3, 2, 0],
      [5, 1, 50],
    ]);
  });

  it('clearRange no meio de um clipe deixa cabeça e cauda corretas', () => {
    const { p, v1 } = setup();
    const q = place(p, v1, 0, 10 * S, 0, 'a');
    const r = apply(q, clearRange(q, v1, 3 * S, 5 * S));
    expect(layout(r, v1)).toEqual([
      [0, 3, 0],
      [5, 5, 5],
    ]);
  });

  it('clearRange preserva origem, reverse e keyframes de velocidade nas partes restantes', () => {
    const { p, v1 } = setup();
    let q = place(p, v1, 0, 4 * S, 100 * S, 'reverse-ramp');
    q = apply(q, [{ type: 'clip.update', clipId: 'reverse-ramp', patch: {
      reverse: true,
      keyframes: { speed: [
        { atUs: 0, value: 1, easing: 'linear' },
        { atUs: 2 * S, value: 0, easing: 'hold' },
        { atUs: 3 * S, value: 0, easing: 'linear' },
        { atUs: 4 * S, value: 1, easing: 'linear' },
      ] },
    } }]);
    const original = q.clips[0]!;
    q = apply(q, clearRange(q, v1, S, 3 * S));
    const [head, tail] = clipsOnTrack(q, v1);
    expect(head).toMatchObject({ sourceInUs: 102.4 * S, sourceOutUs: 104 * S, reverse: true });
    expect(tail).toMatchObject({ timelineStartUs: 3 * S, sourceInUs: 100 * S, sourceOutUs: 100.8 * S, reverse: true });
    expect(head!.keyframes.speed).toHaveLength(2);
    expect(tail!.keyframes.speed).toHaveLength(2);
    expect(sourceTimeAt(head!, S / 2)).toBeCloseTo(sourceTimeAt(original, S / 2), -2);
    expect(sourceTimeAt(tail!, S / 2)).toBeCloseTo(sourceTimeAt(original, 3 * S + S / 2), -2);
  });
});

describe('encaixe', () => {
  it('encaixa a borda mais próxima dentro do limite', () => {
    const { p, v1 } = setup();
    let q = place(p, v1, 0, 2 * S, 0, 'a');
    q = apply(q, [{ type: 'marker.add', marker: { id: 'drop', kind: 'drop', atUs: 70 * S, durationUs: 0, label: 'Drop', color: null, origin: 'user', confidence: null } }]);
    const pts = snapPoints(q, 30 * S);
    // clipe arrastado de 69,9 s a 71,9 s: o início encaixa no drop
    expect(findSnap([69_900_000, 71_900_000], pts, 200_000)).toMatchObject({ deltaUs: 100_000, point: { kind: 'marker' } });
    // fim do clipe arrastado perto do fim de "a"
    expect(findSnap([1_050_000, 2_050_000], pts, 100_000)).toMatchObject({ deltaUs: -50_000, point: { kind: 'clip' } });
    expect(findSnap([50 * S], pts, 0.1 * S)).toBeNull();
    // o próprio clipe não é ponto de encaixe dele mesmo
    expect(snapPoints(q, 0, new Set(['a'])).some((x) => x.atUs === 2 * S)).toBe(false);
  });
});

import { defaultScale, fillScale } from '../src/edit.js';
import { createProject } from '../src/factory.js';
describe('encaixar × preencher', () => {
  const asset = (w: number, h: number) => ({ id: 'a', name: 'a', path: '', hash: '', kind: 'video' as const, status: 'ok' as const, error: null, importedAt: '', tags: [], favorite: false, probe: { container: '', durationUs: 1, sizeBytes: 1, bitRate: null, video: { codec: 'h264', profile: null, width: w, height: h, pixFmt: null, bitDepth: 8, fps: null, avgFps: null, vfr: false, frameCount: null }, audio: [], subtitles: [], tags: {} } });
  const proj = (w: number, h: number) => createProject({ name: 't', settings: { width: w, height: h, fps: { num: 30, den: 1 } } });
  it('episódio 16:9 num projeto vertical entra preenchendo (sem faixas pretas)', () => {
    expect(fillScale(proj(1080, 1920), asset(1920, 1080))).toBeCloseTo((1920 / 1080) / (1080 / 1920), 3);
    expect(defaultScale(proj(1080, 1920), asset(1920, 1080))).toBeGreaterThan(3);
    expect(defaultScale(proj(1080, 1080), asset(1920, 1080))).toBeCloseTo(1920 / 1080, 3);
  });
  it('mesmo formato (ou parecido) continua encaixado', () => {
    expect(defaultScale(proj(1920, 1080), asset(1920, 1080))).toBe(1);
    expect(defaultScale(proj(1920, 1080), asset(1440, 1080))).toBe(1);
  });
});
