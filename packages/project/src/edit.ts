/**
 * Operações de edição da timeline. Cada função lê o projeto e devolve uma lista
 * de Commands (nunca muta nada); a UI aplica com `history.transaction`, então
 * cada gesto vira UM passo de desfazer.
 *
 * Modelo de sobreposição: "sobrescrever" (como Premiere/Resolve). Colocar um
 * clipe por cima de outros na mesma trilha apara, divide ou remove o que estava
 * embaixo naquele trecho.
 */
import { applyCommand, type Command } from './commands.js';
import { newId } from './factory.js';
import { speedAt, sourceTimeAt } from './speed.js';
import { evaluateKeyframes, orderedKeyframes } from './keyframes.js';
import type { Asset, Clip, Project, Track } from './schema.js';
import { clipEndUs } from './timeline.js';
import type { Us } from './time.js';

export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

/** Duração mínima de um clipe na timeline (1 ms). */
export const MIN_CLIP_US = 1000;

function getClip(project: Project, id: string): Clip {
  const c = project.clips.find((x) => x.id === id);
  if (!c) throw new EditError(`clipe não encontrado: ${id}`);
  return c;
}

function getTrack(project: Project, id: string): Track {
  const t = project.tracks.find((x) => x.id === id);
  if (!t) throw new EditError(`trilha não encontrada: ${id}`);
  return t;
}

function assertEditable(track: Track): void {
  if (track.locked) throw new EditError(`a trilha "${track.name}" está travada`);
}

function sourceRange(clip: Clip, fromUs: Us, toUs: Us): Pick<Clip, 'sourceInUs' | 'sourceOutUs'> {
  const from = sourceTimeAt(clip, fromUs);
  const to = sourceTimeAt(clip, toUs);
  return clip.reverse
    ? { sourceInUs: to, sourceOutUs: from }
    : { sourceInUs: from, sourceOutUs: to };
}

export function sliceClipKeyframes(clip: Clip, fromUs: Us, toUs: Us): Clip['keyframes'] {
  if (fromUs < 0 || toUs < fromUs) {
    throw new EditError('o intervalo de quadros-chave é inválido');
  }
  const sliced: Clip['keyframes'] = {};
  for (const [path, keyframes] of Object.entries(clip.keyframes)) {
    const ordered = orderedKeyframes(keyframes);
    if (!ordered.length) continue;
    const exactStart = ordered.find((frame) => frame.atUs === fromUs);
    const exactEnd = ordered.find((frame) => frame.atUs === toUs);
    const endEasing = exactEnd?.easing ?? ordered.find((frame) => frame.atUs > toUs)?.easing ?? ordered.at(-1)!.easing;
    sliced[path] = [
      { atUs: 0, value: evaluateKeyframes(ordered, fromUs, ordered[0]!.value), easing: exactStart?.easing ?? 'linear' },
      ...ordered
        .filter((frame) => frame.atUs > fromUs && frame.atUs < toUs)
        .map((frame) => ({ ...frame, atUs: frame.atUs - fromUs })),
      { atUs: toUs - fromUs, value: evaluateKeyframes(ordered, toUs, ordered.at(-1)!.value), easing: endEasing },
    ];
  }
  return sliced;
}

/** Duração máxima da mídia de origem (null = sem limite, ex.: imagem ou texto). */
export function sourceDurationUs(project: Project, clip: Clip): Us | null {
  if (!clip.assetId) return null;
  const asset = project.assets.find((a) => a.id === clip.assetId);
  if (!asset || asset.kind === 'image') return null;
  return asset.probe?.durationUs ?? null;
}

// ---------------------------------------------------------------- dividir

/**
 * Divide um clipe em `atUs` (tempo da timeline). A parte da esquerda mantém o id;
 * a da direita ganha um id novo. Efeitos e ajustes são copiados; a transição de
 * entrada fica só na primeira parte; keyframes são repartidos pelo tempo.
 */
export function splitClip(project: Project, clipId: string, atUs: Us, newClipId = newId('clp')): Command[] {
  const c = getClip(project, clipId);
  assertEditable(getTrack(project, c.trackId));
  const offset = atUs - c.timelineStartUs;
  if (offset < MIN_CLIP_US || c.durationUs - offset < MIN_CLIP_US) return [];

  const leftKf = sliceClipKeyframes(c, 0, offset);
  const rightKf = sliceClipKeyframes(c, offset, c.durationUs);
  const right: Clip = {
    ...structuredClone(c),
    id: newClipId,
    timelineStartUs: atUs,
    durationUs: c.durationUs - offset,
    ...sourceRange(c, offset, c.durationUs),
    transitionIn: null,
    keyframes: rightKf,
    effects: c.effects.map((e) => ({ ...structuredClone(e), id: newId('fx') })),
    audio: { ...c.audio, fadeInUs: 0 },
  };
  const index = project.clips.findIndex((x) => x.id === c.id);
  return [
    {
      type: 'clip.update',
      clipId: c.id,
      patch: {
        durationUs: offset,
        ...sourceRange(c, 0, offset),
        keyframes: leftKf,
        audio: { ...c.audio, fadeOutUs: 0 },
      },
    },
    { type: 'clip.add', clip: right, index: index + 1 },
  ];
}

/** Divide todos os clipes (de trilhas destravadas) que passam pelo instante. */
export function splitAllAt(project: Project, atUs: Us, onlyClipIds?: string[]): Command[] {
  const out: Command[] = [];
  for (const c of project.clips) {
    if (onlyClipIds && !onlyClipIds.includes(c.id)) continue;
    const t = project.tracks.find((x) => x.id === c.trackId);
    if (!t || t.locked) continue;
    if (atUs > c.timelineStartUs && atUs < clipEndUs(c)) out.push(...splitClip(project, c.id, atUs));
  }
  return out;
}

// ---------------------------------------------------------------- abrir espaço

/**
 * Comandos que liberam o intervalo [start, end) na trilha, aparando, dividindo
 * ou removendo clipes que estão nele. `ignore` = clipes que estão sendo movidos.
 */
export function clearRange(project: Project, trackId: string, start: Us, end: Us, ignore: Set<string> = new Set()): Command[] {
  if (end <= start) return [];
  assertEditable(getTrack(project, trackId));
  const out: Command[] = [];
  for (const c of project.clips) {
    if (c.trackId !== trackId || ignore.has(c.id)) continue;
    const cs = c.timelineStartUs;
    const ce = clipEndUs(c);
    if (ce <= start || cs >= end) continue;

    if (cs >= start && ce <= end) {
      out.push({ type: 'clip.remove', clipId: c.id });
    } else if (cs < start && ce > end) {
      // o intervalo fica no meio do clipe: divide em dois e tira o miolo
      const tailOffset = end - cs;
      const rightId = newId('clp');
      const tailRange = sourceRange(c, tailOffset, c.durationUs);
      const tail: Clip = {
        ...structuredClone(c),
        id: rightId,
        timelineStartUs: end,
        durationUs: ce - end,
        ...tailRange,
        transitionIn: null,
        keyframes: sliceClipKeyframes(c, tailOffset, c.durationUs),
        effects: c.effects.map((e) => ({ ...structuredClone(e), id: newId('fx') })),
        audio: { ...c.audio, fadeInUs: 0 },
      };
      const keep = start - cs;
      out.push(
        { type: 'clip.update', clipId: c.id, patch: { durationUs: keep, ...sourceRange(c, 0, keep), keyframes: sliceClipKeyframes(c, 0, keep), audio: { ...c.audio, fadeOutUs: 0 } } },
        { type: 'clip.add', clip: tail },
      );
    } else if (cs < start) {
      // sobra a cabeça
      const keep = start - cs;
      out.push({ type: 'clip.update', clipId: c.id, patch: { durationUs: keep, ...sourceRange(c, 0, keep), keyframes: sliceClipKeyframes(c, 0, keep) } });
    } else {
      // sobra a cauda
      const cut = end - cs;
      const range = sourceRange(c, cut, c.durationUs);
      out.push({
        type: 'clip.update',
        clipId: c.id,
        patch: { timelineStartUs: end, durationUs: ce - end, ...range, keyframes: sliceClipKeyframes(c, cut, c.durationUs), transitionIn: null },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- mover

export interface MoveTarget {
  clipId: string;
  trackId: string;
  startUs: Us;
}

function trackKindAccepts(track: Track, clip: Clip, project: Project): boolean {
  if (track.kind === 'text') return !!clip.text;
  if (clip.text) return false;
  const asset = project.assets.find((a) => a.id === clip.assetId);
  if (!asset) return false;
  if (track.kind === 'video') return asset.kind !== 'audio';
  // trilha de áudio aceita vídeo (usa a fala/som do episódio), desde que ele tenha áudio
  if (asset.kind === 'image') return false;
  return !asset.probe || asset.probe.audio.length > 0 || asset.kind === 'audio';
}

/**
 * Move clipes (juntos, como um grupo) para novos lugares, sobrescrevendo o que
 * estiver embaixo. Recusa se algum destino for trilha travada ou de tipo errado.
 */
export function moveClips(project: Project, targets: MoveTarget[]): Command[] {
  const moving = new Set(targets.map((t) => t.clipId));
  for (const t of targets) {
    const c = getClip(project, t.clipId);
    assertEditable(getTrack(project, c.trackId));
    const dest = getTrack(project, t.trackId);
    assertEditable(dest);
    if (!trackKindAccepts(dest, c, project)) throw new EditError(`"${c.label ?? 'clipe'}" não pode ir para a trilha ${dest.name}`);
    if (t.startUs < 0) throw new EditError('um clipe não pode começar antes do zero');
  }
  // os próprios clipes do grupo não podem se sobrepor no destino
  const byTrack = new Map<string, { s: Us; e: Us }[]>();
  for (const t of targets) {
    const c = getClip(project, t.clipId);
    const list = byTrack.get(t.trackId) ?? [];
    list.push({ s: t.startUs, e: t.startUs + c.durationUs });
    byTrack.set(t.trackId, list);
  }
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 1; i < list.length; i++) if (list[i]!.s < list[i - 1]!.e) throw new EditError('os clipes movidos ficariam um sobre o outro');
  }

  // libera o espaço de cada destino em sequência, sempre sobre o estado já ajustado
  // (dois destinos na mesma trilha podem cortar o mesmo clipe)
  const out: Command[] = [];
  let current = project;
  for (const t of targets) {
    const c = getClip(project, t.clipId);
    const cmds = clearRange(current, t.trackId, t.startUs, t.startUs + c.durationUs, moving);
    for (const cmd of cmds) current = applyCommand(current, cmd).project;
    out.push(...cmds);
  }
  for (const t of targets) {
    const c = getClip(project, t.clipId);
    if (c.trackId === t.trackId && c.timelineStartUs === t.startUs) continue;
    out.push({ type: 'clip.update', clipId: c.id, patch: { trackId: t.trackId, timelineStartUs: t.startUs } });
  }
  return out;
}

// ---------------------------------------------------------------- aparar

export type Edge = 'start' | 'end';

/** Limites possíveis de um aparo, considerando mídia de origem e vizinhos. */
export function trimBounds(project: Project, clipId: string, edge: Edge): { min: Us; max: Us } {
  const c = getClip(project, clipId);
  const neighbors = project.clips.filter((x) => x.trackId === c.trackId && x.id !== c.id);
  const end = clipEndUs(c);
  const srcDur = sourceDurationUs(project, c);
  if (edge === 'start') {
    const prevEnd = Math.max(0, ...neighbors.filter((n) => clipEndUs(n) <= c.timelineStartUs).map(clipEndUs));
    // quanto dá para estender para a esquerda sem passar do começo da origem
    const sourceStart = c.reverse ? (srcDur ?? c.sourceOutUs) - c.sourceOutUs : c.sourceInUs;
    const startSpeed = speedAt(c, 0);
    const bySource = startSpeed <= 0 ? 0 : c.timelineStartUs - Math.floor(sourceStart / startSpeed);
    return { min: Math.max(prevEnd, bySource, 0), max: end - MIN_CLIP_US };
  }
  const nextStart = Math.min(Infinity, ...neighbors.filter((n) => n.timelineStartUs >= end).map((n) => n.timelineStartUs));
  const sourceRemaining = srcDur === null ? Infinity : c.reverse ? c.sourceInUs : srcDur - c.sourceOutUs;
  const endSpeed = speedAt(c, c.durationUs);
  const bySource = sourceRemaining === Infinity || endSpeed <= 0
    ? Infinity
    : c.timelineStartUs + c.durationUs + Math.floor(sourceRemaining / endSpeed);
  return { min: c.timelineStartUs + MIN_CLIP_US, max: Math.min(nextStart, bySource) };
}

/** Move a borda do clipe para `toUs` (timeline), limitado por `trimBounds`. */
export function trimClip(project: Project, clipId: string, edge: Edge, toUs: Us): Command[] {
  const c = getClip(project, clipId);
  assertEditable(getTrack(project, c.trackId));
  const { min, max } = trimBounds(project, clipId, edge);
  const to = Math.round(Math.min(max, Math.max(min, toUs)));
  if (edge === 'start') {
    const delta = to - c.timelineStartUs;
    if (!delta) return [];
    const durationUs = c.durationUs - delta;
    const sourceStart = delta < 0
      ? sourceTimeAt(c, 0) + (c.reverse ? 1 : -1) * -delta * speedAt(c, 0)
      : sourceTimeAt(c, delta);
    const range = delta < 0
      ? c.reverse
        ? { sourceInUs: c.sourceInUs, sourceOutUs: sourceStart }
        : { sourceInUs: Math.max(0, sourceStart), sourceOutUs: c.sourceOutUs }
      : sourceRange(c, delta, c.durationUs);
    const keyframes = delta < 0
      ? Object.fromEntries(Object.entries(sliceClipKeyframes(c, 0, c.durationUs)).map(([path, frames]) => [
        path,
        [
          { atUs: 0, value: frames[0]!.value, easing: 'linear' as const },
          ...frames.map((frame) => ({ ...frame, atUs: frame.atUs - delta })),
        ],
      ]))
      : sliceClipKeyframes(c, delta, c.durationUs);
    return [
      {
        type: 'clip.update',
        clipId,
        patch: {
          timelineStartUs: to,
          durationUs,
          ...range,
          keyframes,
        },
      },
    ];
  }
  const dur = to - c.timelineStartUs;
  if (dur === c.durationUs) return [];
  const range = sourceRange(c, 0, dur);
  return [{
    type: 'clip.update',
    clipId,
    patch: {
      durationUs: dur,
      ...range,
      keyframes: sliceClipKeyframes(c, 0, dur),
    },
  }];
}

// ---------------------------------------------------------------- excluir

export function deleteClips(project: Project, ids: string[], ripple = false): Command[] {
  const out: Command[] = [];
  const removed = ids.map((id) => getClip(project, id));
  for (const c of removed) {
    assertEditable(getTrack(project, c.trackId));
    out.push({ type: 'clip.remove', clipId: c.id });
  }
  if (!ripple) return out;
  // fechar o buraco: puxa para a esquerda o que vem depois, trilha por trilha
  const tracks = new Set(removed.map((c) => c.trackId));
  for (const trackId of tracks) {
    const gaps = removed.filter((c) => c.trackId === trackId).map((c) => ({ s: c.timelineStartUs, d: c.durationUs }));
    for (const other of project.clips) {
      if (other.trackId !== trackId || ids.includes(other.id)) continue;
      const shift = gaps.filter((g) => g.s < other.timelineStartUs).reduce((acc, g) => acc + g.d, 0);
      if (shift) out.push({ type: 'clip.update', clipId: other.id, patch: { timelineStartUs: other.timelineStartUs - shift } });
    }
  }
  return out;
}

// ---------------------------------------------------------------- copiar e colar

export interface ClipboardData {
  clips: Clip[];
  /** Início do clipe mais à esquerda, para colar relativo ao playhead. */
  originUs: Us;
}

export function copyClips(project: Project, ids: string[]): ClipboardData {
  const clips = ids.map((id) => structuredClone(getClip(project, id)));
  return { clips, originUs: Math.min(...clips.map((c) => c.timelineStartUs)) };
}

/**
 * Cola em `atUs`, mantendo o espaçamento e as trilhas de origem (se ainda
 * existirem e estiverem destravadas). Sobrescreve o que estiver embaixo.
 */
export function pasteClips(project: Project, data: ClipboardData, atUs: Us): { commands: Command[]; newIds: string[] } {
  const commands: Command[] = [];
  const newIds: string[] = [];
  let current = project;
  const eligible = data.clips.filter((src) => {
    const track = project.tracks.find((t) => t.id === src.trackId);
    return !!track && !track.locked && (!src.assetId || project.assets.some((a) => a.id === src.assetId));
  });
  const groupCounts = new Map<string, number>();
  for (const src of eligible) {
    if (src.groupId) groupCounts.set(src.groupId, (groupCounts.get(src.groupId) ?? 0) + 1);
  }
  const copiedGroupIds = new Map(
    [...groupCounts]
      .filter(([, count]) => count > 1)
      .map(([groupId]) => [groupId, newId('grp')]),
  );
  const push = (cmds: Command[]) => {
    for (const c of cmds) current = applyCommand(current, c).project;
    commands.push(...cmds);
  };
  for (const src of eligible) {
    const track = project.tracks.find((t) => t.id === src.trackId);
    if (!track) continue;
    const start = atUs + (src.timelineStartUs - data.originUs);
    const id = newId('clp');
    push(clearRange(current, track.id, start, start + src.durationUs));
    push([
      {
        type: 'clip.add',
        clip: { ...structuredClone(src), id, timelineStartUs: start, groupId: src.groupId ? copiedGroupIds.get(src.groupId) ?? null : null, effects: src.effects.map((e) => ({ ...e, id: newId('fx') })), origin: 'user' },
      },
    ]);
    newIds.push(id);
  }
  return { commands, newIds };
}

/** Duplica logo depois do fim da seleção. */
export function duplicateClips(project: Project, ids: string[]): { commands: Command[]; newIds: string[] } {
  const data = copyClips(project, ids);
  const end = Math.max(...data.clips.map(clipEndUs));
  return pasteClips(project, data, end);
}

// ---------------------------------------------------------------- inserir mídia

/**
 * Escala que faz a mídia PREENCHER o quadro do projeto (corta as sobras), partindo do
 * "encaixar" que o preview e a exportação usam (escala 1 = encaixar inteiro).
 */
export function fillScale(project: Project, asset: Asset): number {
  const v = asset.probe?.video;
  if (!v?.width || !v.height) return 1;
  const P = project.settings;
  const contain = Math.min(P.width / v.width, P.height / v.height);
  const cover = Math.max(P.width / v.width, P.height / v.height);
  return Math.round((cover / contain) * 10000) / 10000;
}

/**
 * Escala inicial de um clipe: se o formato for diferente do projeto (episódio horizontal
 * num projeto vertical ou quadrado), já entra preenchendo — senão sobram faixas pretas enormes.
 */
export function defaultScale(project: Project, asset: Asset): number {
  const v = asset.probe?.video;
  if (!v?.width || !v.height) return 1;
  const P = project.settings;
  const orient = (w: number, h: number) => (w > h * 1.05 ? 'h' : h > w * 1.05 ? 'v' : 'q');
  return orient(P.width, P.height) !== orient(v.width, v.height) ? fillScale(project, asset) : 1;
}

export interface InsertOptions {
  assetId: string;
  trackId: string;
  startUs: Us;
  /** Trecho da origem; padrão = mídia inteira (imagens: 3 s). */
  sourceInUs?: Us;
  sourceOutUs?: Us;
  clipId?: string;
}

export const IMAGE_DEFAULT_US = 3_000_000;

export function insertAsset(project: Project, o: InsertOptions): Command[] {
  const asset = project.assets.find((a) => a.id === o.assetId);
  if (!asset) throw new EditError('mídia não encontrada');
  if (asset.status === 'missing') throw new EditError(`${asset.name} não foi encontrada no disco`);
  const track = getTrack(project, o.trackId);
  assertEditable(track);
  const full = asset.kind === 'image' ? IMAGE_DEFAULT_US : (asset.probe?.durationUs ?? 0);
  const sIn = o.sourceInUs ?? 0;
  const sOut = o.sourceOutUs ?? full;
  const dur = sOut - sIn;
  if (dur < MIN_CLIP_US) throw new EditError('trecho curto demais');
  const clip: Clip = {
    id: o.clipId ?? newId('clp'),
    trackId: track.id,
    assetId: asset.id,
    timelineStartUs: Math.max(0, Math.round(o.startUs)),
    durationUs: dur,
    sourceInUs: sIn,
    sourceOutUs: sOut,
    speed: 1,
    reverse: false,
    transform: { x: 0, y: 0, scale: track.kind === 'video' ? defaultScale(project, asset) : 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    blendMode: 'normal',
    mask: 'none',
    groupId: null,
    audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null },
    effects: [],
    transitionIn: null,
    keyframes: {},
    text: null,
    origin: 'user',
    reason: null,
    confidence: null,
    label: asset.name,
  };
  if (!trackKindAccepts(track, clip, project)) throw new EditError(`${asset.name} não pode ir para a trilha ${track.name}`);
  return [...clearRange(project, track.id, clip.timelineStartUs, clip.timelineStartUs + dur), { type: 'clip.add', clip }];
}

// ---------------------------------------------------------------- encaixe (snapping)

export interface SnapPoint {
  atUs: Us;
  kind: 'clip' | 'playhead' | 'marker' | 'zero';
}

export function snapPoints(project: Project, playheadUs: Us, exclude: Set<string> = new Set()): SnapPoint[] {
  const pts: SnapPoint[] = [{ atUs: 0, kind: 'zero' }, { atUs: playheadUs, kind: 'playhead' }];
  for (const c of project.clips) {
    if (exclude.has(c.id)) continue;
    pts.push({ atUs: c.timelineStartUs, kind: 'clip' }, { atUs: clipEndUs(c), kind: 'clip' });
  }
  for (const m of project.markers) pts.push({ atUs: m.atUs, kind: 'marker' });
  return pts;
}

/**
 * Procura o ponto de encaixe mais perto de qualquer uma das `edges` (ex.: início
 * e fim do clipe arrastado). Devolve o deslocamento a aplicar, ou null.
 */
export function findSnap(edges: Us[], points: SnapPoint[], thresholdUs: Us): { deltaUs: Us; point: SnapPoint } | null {
  let best: { deltaUs: Us; point: SnapPoint } | null = null;
  for (const e of edges) {
    for (const p of points) {
      const d = p.atUs - e;
      if (Math.abs(d) <= thresholdUs && (!best || Math.abs(d) < Math.abs(best.deltaUs))) best = { deltaUs: d, point: p };
    }
  }
  return best;
}
