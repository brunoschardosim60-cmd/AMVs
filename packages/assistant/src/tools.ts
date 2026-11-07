import type { EpisodeAnalysis, MusicAnalysis, Shot } from '@amv/analysis';
import { generateAmv, STYLES, type StyleId } from '@amv/automv';
import { applyCommand, clipEndUs, newId, splitClip, type Clip, type Command, type EffectInstance, type Project } from '@amv/project';
import type { ChangeItem, ChangeSet } from './changeset.js';

const S = 1_000_000;
const us = (s: number) => Math.round(s * S);
export const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** Tudo que o assistente pode ler. Montado pelo app a cada pergunta. */
export interface AssistantContext {
  project: Project;
  selection: string[];
  playheadUs: number;
  music: Map<string, MusicAnalysis>;
  episodes: Map<string, EpisodeAnalysis>;
}

// ------------------------------------------------------------------ leitura

function trackName(p: Project, id: string) {
  return p.tracks.find((t) => t.id === id)?.name ?? '?';
}
function assetName(p: Project, id: string | null) {
  return id ? (p.assets.find((a) => a.id === id)?.name ?? '?') : 'texto';
}

export function musicOnTimeline(ctx: AssistantContext): { clip: Clip; a: MusicAnalysis } | null {
  const mt = ctx.project.tracks.find((t) => t.role === 'music');
  const clip = mt ? ctx.project.clips.filter((c) => c.trackId === mt.id && c.assetId).sort((a, b) => a.timelineStartUs - b.timelineStartUs)[0] : undefined;
  const a = clip?.assetId ? ctx.music.get(clip.assetId) : undefined;
  return clip && a ? { clip, a } : null;
}

/** Tempo da música → tempo da timeline. */
function musicToTimeline(clip: Clip, s: number): number {
  return clip.timelineStartUs / S + (s - clip.sourceInUs / S) / clip.speed;
}

export function beatsOnTimeline(ctx: AssistantContext): { beats: number[]; drops: number[] } {
  const m = musicOnTimeline(ctx);
  if (!m) return { beats: [], drops: [] };
  const end = clipEndUs(m.clip) / S;
  const map = (xs: number[]) => xs.map((x) => musicToTimeline(m.clip, x)).filter((x) => x >= m.clip.timelineStartUs / S - 1e-6 && x <= end);
  return { beats: map(m.a.beats), drops: map(m.a.drops) };
}

function clipLine(p: Project, c: Clip, i: number): string {
  const what = c.text ? `texto "${c.text.text.slice(0, 40)}"` : `${assetName(p, c.assetId)} ${mmss(c.sourceInUs / S)}`;
  return `#${i} [${c.id}] ${trackName(p, c.trackId)} ${mmss(c.timelineStartUs / S)}–${mmss(clipEndUs(c) / S)} ${what}${c.speed !== 1 ? ` vel ${c.speed}` : ''}${c.effects.length ? ` efeitos: ${c.effects.map((e) => e.effect).join(',')}` : ''}${c.origin === 'ai' ? ' (IA)' : ''}`;
}

/** Resumo compacto do projeto para o modelo (nunca o JSON inteiro). */
export function projectSummary(ctx: AssistantContext, maxClips = 60): string {
  const p = ctx.project;
  const lines: string[] = [];
  lines.push(`Projeto "${p.name}", ${p.settings.width}x${p.settings.height}. Playhead em ${mmss(ctx.playheadUs / S)}.`);
  lines.push(`Mídias: ${p.assets.map((a) => `${a.name} (${a.kind}${a.probe ? `, ${Math.round(a.probe.durationUs / S)} s` : ''})`).join('; ') || 'nenhuma'}.`);
  for (const [id, m] of ctx.music) lines.push(`Música ${assetName(p, id)}: ${Math.round(m.bpm)} BPM, intensidade ${m.intensity}, drops em ${m.drops.map((d) => mmss(d)).join(', ') || 'nenhum'}, seções: ${m.sections.map((s) => `${s.label} ${mmss(s.startS)}`).join(', ')}.`);
  for (const [id, e] of ctx.episodes) {
    const top = [...e.shots].sort((a, b) => b.intensity - a.intensity).slice(0, 3);
    const shouts = e.speech.filter((s) => s.kind === 'grito').length;
    lines.push(`Episódio ${assetName(p, id)}: ${e.shots.length} cenas, ${e.speech.length} falas (${shouts} gritos), ${e.subtitles.length} legendas; cenas mais fortes em ${top.map((s) => mmss(s.startS)).join(', ')}.`);
  }
  const clips = [...p.clips].sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  lines.push(`Timeline: ${clips.length} clipes.`);
  clips.slice(0, maxClips).forEach((c, i) => lines.push(clipLine(p, c, i)));
  if (clips.length > maxClips) lines.push(`… mais ${clips.length - maxClips} clipes.`);
  if (ctx.selection.length) lines.push(`Selecionados: ${ctx.selection.join(', ')}.`);
  return lines.join('\n');
}

export interface SceneHit {
  assetId: string;
  episode: string;
  startS: number;
  endS: number;
  intensity: number;
  tags: string[];
  line: string | null;
}

export function findScenes(ctx: AssistantContext, f: { tag?: string; minIntensity?: number; assetId?: string; limit?: number }): SceneHit[] {
  const out: SceneHit[] = [];
  for (const [id, e] of ctx.episodes) {
    if (f.assetId && f.assetId !== id) continue;
    for (const s of e.shots) {
      if (f.tag && !s.tags.includes(f.tag as Shot['tags'][number])) continue;
      if (f.minIntensity !== undefined && s.intensity < f.minIntensity) continue;
      out.push({ assetId: id, episode: assetName(ctx.project, id), startS: s.startS, endS: s.endS, intensity: s.intensity, tags: s.tags, line: s.line });
    }
  }
  return out.sort((a, b) => b.intensity - a.intensity).slice(0, f.limit ?? 10);
}

export function findLines(ctx: AssistantContext, f: { kind?: 'fala' | 'grito'; text?: string; limit?: number }) {
  const out: { assetId: string; episode: string; startS: number; endS: number; kind: string; text: string | null; impact: number }[] = [];
  for (const [id, e] of ctx.episodes) {
    for (const s of e.speech) {
      if (f.kind && s.kind !== f.kind) continue;
      if (f.text && !(s.text ?? '').toLowerCase().includes(f.text.toLowerCase())) continue;
      out.push({ assetId: id, episode: assetName(ctx.project, id), startS: s.startS, endS: s.endS, kind: s.kind, text: s.text, impact: s.impact });
    }
  }
  return out.sort((a, b) => b.impact - a.impact).slice(0, f.limit ?? 10);
}

// ------------------------------------------------------------------ pontos fracos (sem IA)

export interface Finding {
  atS: number;
  severity: 'alta' | 'média' | 'baixa';
  text: string;
  clipId: string | null;
}

export function findWeakPoints(ctx: AssistantContext): Finding[] {
  const p = ctx.project;
  const out: Finding[] = [];
  const v = p.tracks.filter((t) => t.kind === 'video').map((t) => t.id);
  const vclips = p.clips.filter((c) => v.includes(c.trackId) && c.assetId).sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  if (!vclips.length) return [{ atS: 0, severity: 'alta', text: 'A timeline está sem vídeo. Use "Gerar meu AMV" ou arraste cenas da aba Cenas.', clipId: null }];
  const { beats, drops } = beatsOnTimeline(ctx);
  // corte fora da batida
  if (beats.length) {
    for (const c of vclips.slice(1)) {
      const t = c.timelineStartUs / S;
      const d = Math.min(...beats.map((b) => Math.abs(b - t)));
      if (d > 0.06 && d < 0.3) out.push({ atS: t, severity: d > 0.15 ? 'média' : 'baixa', text: `Corte ${Math.round(d * 1000)} ms fora da batida`, clipId: c.id });
    }
  } else out.push({ atS: 0, severity: 'média', text: 'Não há música analisada na trilha de música: os cortes não têm batida para seguir.', clipId: null });
  // cena repetida
  const seen = new Map<string, Clip>();
  for (const c of vclips) {
    const key = `${c.assetId}@${Math.round(c.sourceInUs / 500_000)}`;
    const prev = seen.get(key);
    if (prev) out.push({ atS: c.timelineStartUs / S, severity: 'média', text: `Cena repetida (já aparece em ${mmss(prev.timelineStartUs / S)})`, clipId: c.id });
    else seen.set(key, c);
  }
  // drop sem cena forte
  const m = musicOnTimeline(ctx);
  for (const d of drops) {
    const c = vclips.find((x) => x.timelineStartUs / S <= d + 0.01 && clipEndUs(x) / S > d + 0.01);
    if (!c) continue;
    const ep = c.assetId ? ctx.episodes.get(c.assetId) : undefined;
    const shot = ep?.shots.find((s) => s.startS <= c.sourceInUs / S + 0.05 && s.endS > c.sourceInUs / S);
    if (shot && shot.intensity < 0.6) out.push({ atS: d, severity: 'alta', text: `No drop (${mmss(d)}) a cena é fraca (intensidade ${shot.intensity.toFixed(2)}). Coloque uma cena de impacto.`, clipId: c.id });
    if (Math.abs(c.timelineStartUs / S - d) > 0.08) out.push({ atS: d, severity: 'alta', text: `Não há corte exatamente no drop (${mmss(d)}).`, clipId: c.id });
  }
  // trecho longo sem corte numa parte forte
  if (m) {
    for (const c of vclips) {
      const len = c.durationUs / S;
      const mid = (c.timelineStartUs + c.durationUs / 2) / S;
      const ms = c.sourceInUs / S;
      const musicT = m.clip.sourceInUs / S + (mid - m.clip.timelineStartUs / S) * m.clip.speed;
      const ei = Math.floor(musicT / m.a.energyStepS);
      const e = m.a.energy[ei] ?? 0;
      if (len > 3 && e > 0.7) out.push({ atS: c.timelineStartUs / S, severity: 'média', text: `Clipe de ${len.toFixed(1)} s numa parte forte da música: corte mais rápido aqui.`, clipId: c.id });
      void ms;
    }
  }
  // buraco no vídeo
  for (let i = 1; i < vclips.length; i++) {
    const gap = (vclips[i]!.timelineStartUs - clipEndUs(vclips[i - 1]!)) / S;
    if (gap > 0.05) out.push({ atS: clipEndUs(vclips[i - 1]!) / S, severity: 'alta', text: `Tela preta de ${gap.toFixed(1)} s`, clipId: null });
  }
  const rank = { alta: 0, média: 1, baixa: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.atS - b.atS);
}

// ------------------------------------------------------------------ propostas

function item(kind: ChangeItem['kind'], label: string, atUs: number | null, commands: Command[], dependsOn: string[] = []): ChangeItem {
  return { id: newId('chg'), kind, label, atUs, commands, dependsOn };
}

function fx(effect: string, params: Record<string, number>): EffectInstance {
  return { id: newId('fx'), effect, enabled: true, params };
}

/** Clipes alvo: selecionados, senão o que está no playhead. */
export function targetClips(ctx: AssistantContext, ids?: string[]): Clip[] {
  const p = ctx.project;
  const v = new Set(p.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
  const want = ids?.length ? ids : ctx.selection;
  const sel = p.clips.filter((c) => want.includes(c.id) && v.has(c.trackId));
  if (sel.length) return sel;
  return p.clips.filter((c) => v.has(c.trackId) && c.timelineStartUs <= ctx.playheadUs && clipEndUs(c) > ctx.playheadUs);
}

export function proposeReplaceScene(ctx: AssistantContext, args: { clipIds?: string[]; tag?: string; stronger?: boolean }): ChangeSet | string {
  const clips = targetClips(ctx, args.clipIds);
  if (!clips.length) return 'Selecione um clipe de vídeo (ou deixe o playhead em cima dele).';
  const used = new Set(ctx.project.clips.map((c) => `${c.assetId}@${Math.round(c.sourceInUs / 500_000)}`));
  const items: ChangeItem[] = [];
  for (const c of clips) {
    const len = c.durationUs / S;
    const curEp = c.assetId ? ctx.episodes.get(c.assetId) : undefined;
    const cur = curEp?.shots.find((s) => s.startS <= c.sourceInUs / S + 0.05 && s.endS > c.sourceInUs / S);
    // cena um pouco curta: entra em câmera lenta (até 0,6×)
    const pool = findScenes(ctx, { tag: args.tag, limit: 400 }).filter((s) => s.endS - s.startS >= len * Math.min(c.speed, 1) * 0.6 && !used.has(`${s.assetId}@${Math.round(s.startS * 2)}`) && !(s.assetId === c.assetId && Math.abs(s.startS - c.sourceInUs / S) < 0.5));
    const want = args.stronger ? 1 : (cur?.intensity ?? 0.6);
    const pick = pool.sort((a, b) => Math.abs(a.intensity - want) - Math.abs(b.intensity - want))[0];
    if (!pick) continue;
    used.add(`${pick.assetId}@${Math.round(pick.startS * 2)}`);
    const shotLen = pick.endS - pick.startS;
    const speed = Math.min(c.speed, shotLen / len);
    const srcIn = us(pick.startS + Math.max(0, Math.min(0.1, shotLen - len * speed)));
    items.push(item('modify', `Trocar cena em ${mmss(c.timelineStartUs / S)}: ${pick.episode} ${mmss(pick.startS)} (${pick.tags.join('/') || 'cena'}, intensidade ${pick.intensity.toFixed(2)})${speed < c.speed ? `, câmera lenta ${speed.toFixed(2)}×` : ''}`, c.timelineStartUs, [
      { type: 'clip.update', clipId: c.id, patch: { assetId: pick.assetId, speed, sourceInUs: srcIn, sourceOutUs: srcIn + Math.round(c.durationUs * speed), origin: 'ai', reason: `Trocada pela IA: ${pick.tags.join('/') || 'cena'} ${pick.intensity.toFixed(2)} — ${pick.episode} ${mmss(pick.startS)}` } },
    ]));
  }
  if (!items.length) return 'Não achei outra cena que caiba nesse tamanho. Importe mais episódios ou encurte o clipe.';
  return { id: newId('cs'), title: 'Trocar cena', reason: args.stronger ? 'Cenas mais fortes no lugar' : 'Outras cenas com energia parecida', items };
}

export function proposeAddEffect(ctx: AssistantContext, args: { effect: 'flash' | 'shake' | 'zoom' | 'rgb_split' | 'blur'; clipIds?: string[]; onBeats?: boolean }): ChangeSet | string {
  const clips = targetClips(ctx, args.clipIds);
  const p = ctx.project;
  const params: Record<string, Record<string, number>> = {
    flash: { duration: 0.2, white: 1, strength: 1 },
    shake: { intensity: 18, frequency: 13, duration: 0.4 },
    zoom: { from: 1, to: 1.18, ease: 1 },
    rgb_split: { amount: 10, duration: 0.3 },
    blur: { radius: 8 },
  };
  let list = clips;
  if (args.onBeats && !args.clipIds?.length && !ctx.selection.length) {
    // nas batidas fortes: clipes que começam num downbeat de energia alta
    const m = musicOnTimeline(ctx);
    if (!m) return 'Coloque uma música analisada na trilha de música primeiro.';
    const down = new Set(m.a.downbeats.map((d) => Math.round(musicToTimeline(m.clip, d) * 10)));
    const v = new Set(p.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
    list = p.clips.filter((c) => v.has(c.trackId) && down.has(Math.round((c.timelineStartUs / S) * 10)));
  }
  list = list.filter((c) => !c.effects.some((e) => e.effect === args.effect));
  if (!list.length) return 'Nenhum clipe para receber o efeito (selecione clipes ou coloque o playhead em um).';
  const names: Record<string, string> = { flash: 'clarão', shake: 'tremida', zoom: 'zoom', rgb_split: 'separação RGB', blur: 'desfoque' };
  return {
    id: newId('cs'),
    title: `Adicionar ${names[args.effect]}`,
    reason: args.onBeats ? 'Nos cortes que caem nas batidas fortes' : 'Nos clipes escolhidos',
    items: list.map((c) => item('modify', `${names[args.effect]} no clipe de ${mmss(c.timelineStartUs / S)}`, c.timelineStartUs, [{ type: 'clip.update', clipId: c.id, patch: { effects: [...c.effects, fx(args.effect, params[args.effect]!)] } }])),
  };
}

/** Corta os clipes nas batidas para ficar mais rápido (num trecho ou nos selecionados). */
export function proposeFasterCuts(ctx: AssistantContext, args: { beatsPerCut?: number; fromS?: number; toS?: number }): ChangeSet | string {
  const { beats } = beatsOnTimeline(ctx);
  if (!beats.length) return 'Preciso de uma música analisada na trilha de música para cortar na batida.';
  const per = Math.max(1, Math.round(args.beatsPerCut ?? 2));
  const sel = targetClips(ctx);
  const from = args.fromS ?? (ctx.selection.length ? Math.min(...sel.map((c) => c.timelineStartUs / S)) : 0);
  const to = args.toS ?? (ctx.selection.length ? Math.max(...sel.map((c) => clipEndUs(c) / S)) : Infinity);
  const v = new Set(ctx.project.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
  let p = ctx.project;
  const items: ChangeItem[] = [];
  const clips = p.clips.filter((c) => v.has(c.trackId) && c.assetId && clipEndUs(c) / S > from && c.timelineStartUs / S < to);
  for (const c of clips) {
    const a = c.timelineStartUs / S;
    const b = clipEndUs(c) / S;
    const inner = beats.filter((x) => x > a + 0.2 && x < b - 0.2 && x >= from && x <= to);
    const cuts = inner.filter((_, i) => (i + 1) % per === 0);
    if (!cuts.length) continue;
    const cmds: Command[] = [];
    let cur = c.id;
    for (const t of cuts) {
      const nid = newId('clp');
      const split = splitClip(p, cur, us(t), nid);
      p = applyAllSafe(p, split);
      cmds.push(...split);
      cur = nid;
    }
    items.push(item('modify', `Cortar o clipe de ${mmss(a)} em ${cuts.length + 1} na batida`, c.timelineStartUs, cmds));
  }
  if (!items.length) return 'Os clipes desse trecho já estão curtos (um corte a cada ' + per + ' batida(s) ou menos).';
  return { id: newId('cs'), title: 'Cortes mais rápidos', reason: `Um corte a cada ${per} batida(s)`, items };
}

function applyAllSafe(p: Project, cmds: Command[]): Project {
  return applyCommand(p, { type: 'batch', commands: cmds }).project;
}

export function proposeRemove(ctx: AssistantContext, args: { clipIds: string[] }): ChangeSet | string {
  const clips = ctx.project.clips.filter((c) => args.clipIds.includes(c.id));
  if (!clips.length) return 'Não achei esses clipes.';
  return { id: newId('cs'), title: 'Remover clipes', reason: 'Pedido', items: clips.map((c) => item('remove', `Remover clipe de ${mmss(c.timelineStartUs / S)} (${assetName(ctx.project, c.assetId)})`, c.timelineStartUs, [{ type: 'clip.remove', clipId: c.id }])) };
}

export function proposeGenerate(ctx: AssistantContext, args: { style: StyleId; intensity?: number; durationS?: number; seed?: number }): ChangeSet | string {
  const p = ctx.project;
  const musicAsset = [...ctx.music.keys()][0];
  if (!musicAsset) return 'Importe uma música (e espere a análise) antes.';
  const eps = [...ctx.episodes.entries()];
  if (!eps.length) return 'Importe pelo menos um episódio (e espere a análise) antes.';
  const style = STYLES.find((s) => s.id === args.style) ? args.style : 'hype';
  const r = generateAmv(
    p,
    { assetId: musicAsset, name: assetName(p, musicAsset), analysis: ctx.music.get(musicAsset)! },
    eps.map(([id, a]) => ({ assetId: id, name: assetName(p, id), analysis: a, hasAudio: (p.assets.find((x) => x.id === id)?.probe?.audio.length ?? 0) > 0 })),
    { style, intensity: Math.max(0, Math.min(3, Math.round(args.intensity ?? 2))) as 0 | 1 | 2 | 3, durationS: args.durationS ?? 30, musicStartS: null, useSpeech: true, useEffects: true, showText: true, seed: args.seed ?? 1 },
  );
  return {
    id: newId('cs'),
    title: `Montagem ${STYLES.find((s) => s.id === style)!.label}`,
    reason: `${r.summary.clips} cenas, ${r.summary.cuts} cortes${r.summary.speech ? `, fala "${r.summary.speech}" antes do drop` : ''}. ${r.warnings.join(' ')}`,
    items: [item('add', `Substituir a timeline por uma montagem nova (${r.summary.clips} cenas)`, 0, r.commands)],
  };
}

export function proposeSpeechBeforeDrop(ctx: AssistantContext, args: { text?: string }): ChangeSet | string {
  const { drops } = beatsOnTimeline(ctx);
  if (!drops.length) return 'A música da timeline não tem drop detectado.';
  const lines = findLines(ctx, { text: args.text, limit: 20 }).filter((l) => l.endS - l.startS <= 3.5 && l.endS - l.startS >= 0.5);
  const line = lines[0];
  if (!line) return args.text ? `Não achei a fala "${args.text}" nas legendas/áudio dos episódios.` : 'Não achei falas marcantes curtas nos episódios.';
  const p = ctx.project;
  const voice = p.tracks.find((t) => t.role === 'voice');
  const text = p.tracks.find((t) => t.kind === 'text');
  if (!voice) return 'O projeto não tem trilha de vozes.';
  const drop = drops[0]!;
  const len = line.endS - line.startS;
  const at = Math.max(0, drop - len);
  const busy = p.clips.some((c) => c.trackId === voice.id && c.timelineStartUs / S < drop && clipEndUs(c) / S > at);
  if (busy) return 'Já tem uma fala na trilha de vozes antes do drop. Remova ou mova ela primeiro.';
  const vclip: Clip = {
    id: newId('clp'), trackId: voice.id, assetId: line.assetId, timelineStartUs: us(at), durationUs: us(len), sourceInUs: us(line.startS), sourceOutUs: us(line.startS) + us(len), speed: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    audio: { gainDb: 2, fadeInUs: 30_000, fadeOutUs: 60_000, pitchSemitones: 0, streamIndex: null }, effects: [], transitionIn: null, keyframes: {}, text: null,
    origin: 'ai', reason: `Fala marcante (${line.kind}, impacto ${line.impact.toFixed(2)}) — ${line.episode} ${mmss(line.startS)}`, confidence: line.impact, label: null,
  };
  const a = item('add', `Fala "${line.text ?? line.kind}" de ${line.episode} terminando no drop (${mmss(drop)})`, us(at), [{ type: 'clip.add', clip: vclip }]);
  const items = [a];
  if (text && line.text && !p.clips.some((c) => c.trackId === text.id && c.timelineStartUs / S < drop && clipEndUs(c) / S > at)) {
    const H = p.settings.height;
    const tclip: Clip = { ...vclip, id: newId('clp'), trackId: text.id, assetId: null, sourceInUs: 0, sourceOutUs: us(len), audio: { ...vclip.audio, gainDb: 0 }, transform: { ...vclip.transform, y: Math.round(H * 0.36) }, text: { text: line.text, font: 'Manrope Variable', size: Math.round(H * 0.05), color: '#ffffff', outlineColor: '#000000', outlineWidth: 3, shadow: true, animationIn: 'fade', animationOut: 'fade' }, reason: 'Legenda da fala' };
    items.push(item('add', `Legenda "${line.text}"`, us(at), [{ type: 'clip.add', clip: tclip }], [a.id]));
  }
  // abaixa a música durante a fala
  const m = musicOnTimeline(ctx);
  if (m && !m.clip.keyframes['audio.gainDb']?.length) {
    const rel = (t: number) => Math.max(0, us(t) - m.clip.timelineStartUs);
    items.push(item('modify', 'Abaixar a música durante a fala (−14 dB)', us(at), [{ type: 'clip.update', clipId: m.clip.id, patch: { keyframes: { ...m.clip.keyframes, 'audio.gainDb': [{ atUs: rel(at - 0.15), value: 0, easing: 'linear' }, { atUs: rel(at), value: -14, easing: 'linear' }, { atUs: rel(drop - 0.05), value: -14, easing: 'linear' }, { atUs: rel(drop), value: 0, easing: 'linear' }] } } }], [a.id]));
  }
  return { id: newId('cs'), title: 'Fala antes do drop', reason: `"${line.text ?? line.kind}" é curta e forte (impacto ${line.impact.toFixed(2)})`, items };
}

// ------------------------------------------------------------------ ideias (sem IA)

export function ideas(ctx: AssistantContext): string[] {
  const out: string[] = [];
  const shouts = findLines(ctx, { kind: 'grito', limit: 3 });
  for (const s of shouts) out.push(`Grito forte em ${s.episode} ${mmss(s.startS)}${s.text ? `: "${s.text}"` : ''} — ótimo para colocar logo antes do drop.`);
  const lines = findLines(ctx, { kind: 'fala', limit: 6 }).filter((l) => l.text && /[!?]/.test(l.text)).slice(0, 2);
  for (const l of lines) out.push(`Frase de impacto em ${l.episode} ${mmss(l.startS)}: "${l.text}" — vira legenda de destaque no meio do vídeo.`);
  const action = findScenes(ctx, { tag: 'impacto', limit: 3 });
  for (const a of action) out.push(`Cena de impacto em ${a.episode} ${mmss(a.startS)} (intensidade ${a.intensity.toFixed(2)}) — guarde para o drop.`);
  const calm = findScenes(ctx, { tag: 'calma', limit: 40 }).slice(-2);
  for (const c of calm) out.push(`Cena calma em ${c.episode} ${mmss(c.startS)} — boa para a introdução, antes da virada.`);
  if (ctx.episodes.size === 1) out.push('Com um episódio só as cenas se repetem rápido. Para superação, importe também o episódio da derrota e o da revanche (o "antes e depois" dá força à virada).');
  if (!ctx.music.size) out.push('Nenhuma música no projeto: vá em Músicas → Recomendadas e escolha pelo tema.');
  return out;
}
