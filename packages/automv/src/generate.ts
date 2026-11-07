/**
 * Gerar meu AMV — atribuição de cenas a trechos da música, com regras por estilo.
 * Determinístico para a mesma `seed`. Saída: Commands comuns (tudo editável depois),
 * cada clipe com `origin: 'ai'` e um `reason` legível.
 */
import type { Cue, EpisodeAnalysis, MusicAnalysis, Shot, SpeechSegment } from '@amv/analysis';
import { newId, type Clip, type Command, type EffectInstance, type Project, type Track } from '@amv/project';
import { styleDef, type StyleDef, type StyleId } from './styles.js';

export interface EpisodeInput {
  assetId: string;
  name: string;
  analysis: EpisodeAnalysis;
  hasAudio: boolean;
}

export interface MusicInput {
  assetId: string;
  name: string;
  analysis: MusicAnalysis;
}

export interface GenerateOptions {
  style: StyleId;
  /** 0 suave … 3 extremamente intensa. */
  intensity: 0 | 1 | 2 | 3;
  /** Duração desejada (s). */
  durationS: number;
  /** Onde começa na música (s). null = automático (o drop cai em ~40% do vídeo). */
  musicStartS: number | null;
  /** Letra com tempo (para o estilo "letra" e legendas da música). */
  lyrics?: Cue[];
  useSpeech: boolean;
  useEffects: boolean;
  showText: boolean;
  /** Episódios/cenas proibidos (assetId ou `${assetId}@${startS}`). */
  exclude?: string[];
  seed: number;
}

export interface GenerateResult {
  commands: Command[];
  summary: { clips: number; cuts: number; speech: string | null; musicRange: [number, number]; drop: number | null };
  warnings: string[];
}

interface Slot {
  startS: number; // tempo da timeline
  endS: number;
  energy: number;
  section: string;
  isDrop: boolean;
  /** Palavra da letra que entra neste corte (estilo letra). */
  word?: string;
}

const S = 1_000_000;
const us = (s: number) => Math.round(s * S);

function rng(seed: number) {
  let x = (seed * 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function energyAt(m: MusicAnalysis, t: number): number {
  const i = Math.min(m.energy.length - 1, Math.max(0, Math.floor(t / m.energyStepS)));
  return m.energy[i] ?? 0;
}

function sectionAt(m: MusicAnalysis, t: number) {
  return m.sections.find((s) => t >= s.startS && t < s.endS) ?? m.sections.at(-1);
}

/** Escolhe o trecho da música: o drop principal cai em ~40% do vídeo, começando num compasso. */
export function chooseMusicRange(m: MusicAnalysis, durationS: number, startS: number | null): [number, number] {
  const D = Math.min(durationS, m.durationS);
  let s0 = startS ?? 0;
  if (startS === null && m.drops.length) {
    s0 = Math.max(0, m.drops[0]! - 0.4 * D);
    const db = m.downbeats.filter((d) => d <= s0).at(-1);
    if (db !== undefined) s0 = db;
  }
  s0 = Math.max(0, Math.min(s0, m.durationS - D));
  return [s0, s0 + D];
}

/** Divide o trecho da música em cortes nas batidas, mais curtos quanto mais energia. */
export function makeSlots(m: MusicAnalysis, range: [number, number], style: StyleDef, intensity: number, lyrics?: Cue[]): Slot[] {
  const [a, b] = range;
  const drop = m.drops.find((d) => d > a + 1 && d < b - 1) ?? null;
  // estilo letra com letra: um corte por palavra (palavras distribuídas na duração da linha)
  if (style.id === 'letra' && lyrics?.length) {
    const words: { t: number; w: string }[] = [];
    for (const c of lyrics) {
      if (!Number.isFinite(c.startS) || c.endS <= a || c.startS >= b) continue;
      const ws = c.text.replace(/\n/g, ' ').split(/\s+/).filter(Boolean);
      const step = (c.endS - c.startS) / Math.max(1, ws.length);
      ws.forEach((w, i) => words.push({ t: c.startS + i * step, w }));
    }
    if (words.length >= 2) {
      const slots: Slot[] = [];
      if (words[0]!.t > a + 0.2) slots.push({ startS: 0, endS: words[0]!.t - a, energy: energyAt(m, a), section: 'intro', isDrop: false });
      let lastEnd = a;
      words.forEach((w, i) => {
        // palavra fica no máximo ~1,5 s; depois da última, volta a cortar na batida
        const end = Math.min(b, words[i + 1]?.t ?? w.t + 1.5, w.t + 1.5);
        if (end - w.t < 0.12) return;
        slots.push({ startS: w.t - a, endS: end - a, energy: energyAt(m, w.t), section: sectionAt(m, w.t)?.label ?? '', isDrop: drop !== null && Math.abs(w.t - drop) < 0.15, word: w.w });
        lastEnd = end;
      });
      if (lastEnd < b - 0.3) {
        for (const sl of makeSlots(m, [lastEnd, b], style, intensity)) slots.push({ ...sl, startS: sl.startS + (lastEnd - a), endS: sl.endS + (lastEnd - a) });
      }
      return slots;
    }
  }
  const beats = m.beats.filter((t) => t >= a - 0.01 && t <= b + 0.01);
  const grid = beats.length >= 4 ? beats : Array.from({ length: Math.ceil((b - a) / 0.5) + 1 }, (_, i) => a + i * 0.5);
  const speedUp = [1.6, 1.25, 1, 0.75][intensity]!;
  const slots: Slot[] = [];
  let i = 0;
  let cur = a;
  while (cur < b - 0.05) {
    const e = energyAt(m, cur);
    const lvl = e < 0.35 ? 0 : e < 0.7 ? 1 : 2;
    let n = Math.max(1, Math.round(style.beatsPerCut[lvl]! * speedUp));
    // não atravessa o drop: o drop sempre abre um corte novo
    let next = grid[Math.min(grid.length - 1, i + n)] ?? b;
    if (drop !== null && cur < drop - 0.05 && next > drop + 0.05) {
      next = drop;
      n = grid.findIndex((g) => Math.abs(g - drop) < 0.05) - i;
    }
    if (next - cur < style.minCutS) {
      // junta com o próximo grupo de batidas
      n += Math.max(1, Math.round(style.beatsPerCut[lvl]! * speedUp));
      next = grid[Math.min(grid.length - 1, i + n)] ?? b;
    }
    if (next <= cur + 0.05 || i + n >= grid.length - 1) next = b;
    slots.push({ startS: cur - a, endS: Math.min(b, next) - a, energy: e, section: sectionAt(m, cur)?.label ?? '', isDrop: drop !== null && Math.abs(cur - drop) < 0.06 });
    i = grid.findIndex((g) => g >= next - 0.01);
    if (i < 0) break;
    cur = next;
  }
  return slots.filter((s) => s.endS - s.startS > 0.05);
}

interface Candidate {
  ep: EpisodeInput;
  shot: Shot;
  id: string;
}

/** Fala marcante para antes do drop: curta, com impacto alto. */
export function pickSpeech(eps: EpisodeInput[], maxS: number, exclude: Set<string>): { ep: EpisodeInput; s: SpeechSegment } | null {
  let best: { ep: EpisodeInput; s: SpeechSegment; score: number } | null = null;
  for (const ep of eps) {
    if (!ep.hasAudio || exclude.has(ep.assetId)) continue;
    for (const s of ep.analysis.speech) {
      const d = s.endS - s.startS;
      if (d < 0.6 || d > maxS) continue;
      const score = s.impact + (s.kind === 'grito' ? 0.3 : 0) + (s.text ? 0.1 : 0) - Math.abs(d - 2) * 0.05;
      if (!best || score > best.score) best = { ep, s, score };
    }
  }
  return best;
}

function findTracks(p: Project) {
  const visual = p.tracks.filter((t) => t.kind === 'video');
  const v1 = visual.at(-1);
  const text = p.tracks.find((t) => t.kind === 'text');
  const music = p.tracks.find((t) => t.kind === 'audio' && t.role === 'music') ?? p.tracks.find((t) => t.kind === 'audio');
  const voice = p.tracks.find((t) => t.kind === 'audio' && t.role === 'voice') ?? p.tracks.filter((t) => t.kind === 'audio')[1];
  return { v1, text, music, voice };
}

function baseClip(trackId: string, assetId: string | null, startS: number, durS: number, srcIn: number, reason: string, extra: Partial<Clip> = {}): Clip {
  return {
    id: newId('clp'),
    trackId,
    assetId,
    timelineStartUs: us(startS),
    durationUs: Math.max(1000, us(durS)),
    sourceInUs: us(srcIn),
    sourceOutUs: us(srcIn) + Math.max(1000, us(durS)),
    speed: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, streamIndex: null },
    effects: [],
    transitionIn: null,
    keyframes: {},
    text: null,
    origin: 'ai',
    reason,
    confidence: null,
    label: null,
    ...extra,
  };
}

function fx(effect: string, params: Record<string, number>): EffectInstance {
  return { id: newId('fx'), effect, enabled: true, params };
}

function gradeFx(grade: StyleDef['grade']): EffectInstance[] {
  if (grade === 'bw') return [fx('color', { brightness: 0, contrast: 1.15, saturation: 0 })];
  if (grade === 'warm') return [fx('color', { brightness: 0.02, contrast: 1.08, saturation: 1.15 }), fx('vignette', { strength: 0.35 })];
  if (grade === 'punchy') return [fx('color', { brightness: 0, contrast: 1.12, saturation: 1.25 })];
  return [];
}

function textClip(trackId: string, startS: number, durS: number, text: string, H: number, kind: 'word' | 'line', reason: string): Clip {
  const word = kind === 'word';
  return baseClip(trackId, null, startS, durS, 0, reason, {
    transform: { x: 0, y: word ? 0 : Math.round(H * 0.36), scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    text: {
      text: word ? text.toUpperCase() : text,
      font: word ? 'Georgia' : 'Manrope Variable',
      size: Math.round(H * (word ? 0.12 : 0.045)),
      color: '#ffffff',
      outlineColor: '#000000',
      outlineWidth: word ? 2 : 3,
      shadow: true,
      animationIn: word ? 'pop' : 'fade',
      animationOut: word ? null : 'fade',
    },
  });
}

/** Gera a montagem. Não mexe em nada: devolve os comandos para aplicar (um único desfazer). */
export function generateAmv(project: Project, music: MusicInput, episodes: EpisodeInput[], opts: GenerateOptions): GenerateResult {
  const style = styleDef(opts.style);
  const warnings: string[] = [];
  const rand = rng(opts.seed);
  const { v1, text, music: musicTrack, voice } = findTracks(project);
  if (!v1 || !musicTrack) throw new Error('o projeto precisa de uma trilha de vídeo e uma de música');
  const H = project.settings.height;
  const exclude = new Set(opts.exclude ?? []);
  const m = music.analysis;
  const range = chooseMusicRange(m, opts.durationS, opts.musicStartS);
  const D = range[1] - range[0];
  const dropAbs = m.drops.find((d) => d > range[0] + 1 && d < range[1] - 1) ?? null;
  const dropT = dropAbs === null ? null : dropAbs - range[0];
  if (dropT === null) warnings.push('A música não tem um drop claro nesse trecho: a montagem segue a energia da música.');
  if (opts.style === 'letra' && !opts.lyrics?.length) warnings.push('Sem a letra com tempo (LRC), o estilo "letra" corta na batida mas não escreve as palavras. Importe a letra em Legendas.');

  const cmds: Command[] = [];
  // limpa as trilhas que a geração preenche (o projeto anterior fica salvo como versão pelo app)
  const filled = new Set([v1.id, musicTrack.id, voice?.id, text?.id].filter(Boolean) as string[]);
  for (const c of project.clips) if (filled.has(c.trackId)) cmds.push({ type: 'clip.remove', clipId: c.id });

  // ---------------------------------------------------------------- música
  const fadeOut = Math.min(2, D * 0.08);
  const musicClip = baseClip(musicTrack.id, music.assetId, 0, D, range[0], `Trecho ${fmt(range[0])}–${fmt(range[1])} de ${music.name}${dropT !== null ? `: drop em ${fmt(dropT)} do vídeo` : ''}`, {
    audio: { gainDb: opts.style === 'discurso' ? -14 : 0, fadeInUs: range[0] > 0.5 ? us(0.3) : 0, fadeOutUs: us(fadeOut), pitchSemitones: 0, streamIndex: null },
  });

  // ---------------------------------------------------------------- fala antes do drop
  let speechUsed: { ep: EpisodeInput; s: SpeechSegment; atS: number } | null = null;
  if (opts.useSpeech && style.speechBeforeDrop && voice && dropT !== null) {
    const pick = pickSpeech(episodes, Math.min(4, dropT - 0.2), exclude);
    if (pick) {
      const len = pick.s.endS - pick.s.startS;
      speechUsed = { ep: pick.ep, s: pick.s, atS: dropT - len };
      // abaixa a música durante a fala e volta no drop
      const a = speechUsed.atS;
      musicClip.keyframes['audio.gainDb'] = [
        { atUs: us(Math.max(0, a - 0.35)), value: 0, easing: 'linear' },
        { atUs: us(a), value: -16, easing: 'linear' },
        { atUs: us(dropT - 0.06), value: -16, easing: 'linear' },
        { atUs: us(dropT), value: 0, easing: 'linear' },
      ];
    } else warnings.push('Nenhuma fala marcante encontrada nos episódios (legendas embutidas ajudam muito).');
  }
  cmds.push({ type: 'clip.add', clip: musicClip });

  // ---------------------------------------------------------------- estilo discurso: as falas são a espinha
  const used = new Set<string>();
  let clipsMade = 0;
  if (opts.style === 'discurso' && voice) {
    const lines = episodes
      .filter((e) => e.hasAudio && !exclude.has(e.assetId))
      .flatMap((ep) => ep.analysis.speech.map((s) => ({ ep, s })))
      .filter((x) => x.s.endS - x.s.startS >= 0.8 && x.s.endS - x.s.startS <= 6)
      .sort((x, y) => y.s.impact - x.s.impact + (rand() - 0.5) * 0.1);
    let t = 0.4;
    const chosen: typeof lines = [];
    for (const l of lines) {
      if (t >= D - 0.8) break;
      const len = l.s.endS - l.s.startS;
      if (t + len > D) continue;
      chosen.push(l);
      t += len + 0.35;
    }
    if (!chosen.length) warnings.push('O estilo discurso precisa de falas: importe episódios com legenda ou com falas claras.');
    t = 0.4;
    for (const { ep, s } of chosen) {
      const len = s.endS - s.startS;
      const reason = `Fala ${s.text ? `"${s.text.replace(/\n/g, ' ')}" ` : ''}de ${ep.name} ${fmt(s.startS)} (impacto ${s.impact.toFixed(2)})`;
      cmds.push({ type: 'clip.add', clip: baseClip(v1.id, ep.assetId, t, len + 0.35, s.startS, reason, { effects: [...gradeFx(style.grade)] }) });
      cmds.push({ type: 'clip.add', clip: baseClip(voice.id, ep.assetId, t, len, s.startS, reason, { audio: { gainDb: 2, fadeInUs: us(0.05), fadeOutUs: us(0.1), pitchSemitones: 0, streamIndex: null } }) });
      if (opts.showText && text && s.text) {
        // legenda em pedaços de até 3 palavras, no ritmo da fala
        const words = s.text.replace(/\n/g, ' ').split(/\s+/);
        const groups: string[] = [];
        for (let i = 0; i < words.length; i += 3) groups.push(words.slice(i, i + 3).join(' '));
        const step = len / groups.length;
        groups.forEach((g, i) => cmds.push({ type: 'clip.add', clip: textClip(text.id, t + i * step, step, g, H, 'line', 'Legenda da fala') }));
      }
      used.add(`${ep.assetId}@${s.startS}`);
      clipsMade++;
      t += len + 0.35;
    }
    return { commands: cmds, summary: { clips: clipsMade, cuts: clipsMade, speech: chosen[0]?.s.text ?? null, musicRange: range, drop: dropT }, warnings };
  }

  // ---------------------------------------------------------------- cortes na batida
  const REPEAT_WARNING = 'Poucas cenas para o tamanho do vídeo: algumas se repetem. Importe mais episódios.';
  const slots = makeSlots(m, range, style, opts.intensity, opts.lyrics);
  const candidates: Candidate[] = [];
  for (const ep of episodes) {
    if (exclude.has(ep.assetId)) continue;
    for (const shot of ep.analysis.shots) {
      const id = `${ep.assetId}@${shot.startS}`;
      if (exclude.has(id) || shot.endS - shot.startS < 0.25 || shot.tags.includes('escura')) continue;
      candidates.push({ ep, shot, id });
    }
  }
  if (!candidates.length) {
    warnings.push('Nenhuma cena analisada ainda: espere a análise dos episódios terminar.');
    return { commands: cmds, summary: { clips: 0, cuts: 0, speech: null, musicRange: range, drop: dropT }, warnings };
  }
  const [lowI, highI] = style.targetIntensity;
  const boost = [-0.1, 0, 0.05, 0.1][opts.intensity]!;
  let prev: Candidate | null = null;
  let prevSrcEnd = 0;
  // o trecho da fala (até o drop) é da imagem de quem fala: corta o que encostar nele
  const visualSlots: Slot[] = [];
  for (const sl of slots) {
    if (!speechUsed || sl.endS <= speechUsed.atS + 0.01 || sl.startS >= dropT! - 0.01) visualSlots.push(sl);
    else if (sl.startS < speechUsed.atS - 0.2) visualSlots.push({ ...sl, endS: speechUsed.atS });
  }

  // cenas curtas demais para um slot longo (intro lenta, episódio com cortes rápidos):
  // divide o slot na batida mais perto do meio, para nunca deixar buraco
  const longest = Math.max(...candidates.map((c) => c.shot.endS - c.shot.startS));
  const fitSlots: Slot[] = [];
  const splitFit = (sl: Slot) => {
    const len = sl.endS - sl.startS;
    if (len * 0.6 <= longest || len < 0.5) return void fitSlots.push(sl);
    const mid = (sl.startS + sl.endS) / 2;
    let cut = mid;
    let bestD = Infinity;
    for (const mb of m.beats) {
      const b = mb - range[0];
      if (b <= sl.startS + 0.25 || b >= sl.endS - 0.25) continue;
      const d = Math.abs(b - mid);
      if (d < bestD) [bestD, cut] = [d, b];
    }
    splitFit({ ...sl, endS: cut });
    splitFit({ ...sl, startS: cut, isDrop: false, word: undefined });
  };
  for (const sl of visualSlots) splitFit(sl);

  for (const sl of fitSlots) {
    const len = sl.endS - sl.startS;
    const target = Math.min(1, Math.max(0, lowI + (highI - lowI) * sl.energy + boost + (sl.isDrop ? 0.15 : 0)));
    let best: { c: Candidate; score: number; srcIn: number } | null = null;
    for (const c of candidates) {
      if (used.has(c.id)) continue;
      const shotLen = c.shot.endS - c.shot.startS;
      // dá para usar câmera lenta até 0,6× se a cena for um pouco curta
      if (shotLen < len * 0.6) continue;
      let score = 1 - Math.abs(target - c.shot.intensity) * 1.6;
      if (sl.isDrop && c.shot.tags.includes('impacto')) score += 0.5;
      if (sl.energy > 0.7 && c.shot.tags.includes('ação')) score += 0.15;
      if (sl.energy < 0.35 && c.shot.tags.includes('calma')) score += 0.2;
      if (c.shot.tags.includes('fala') && style.id !== 'discurso') score -= 0.08;
      if (prev && prev.ep.assetId === c.ep.assetId) {
        score -= 0.12;
        // narrativa: andar para frente no mesmo episódio é bom; voltar é ruim
        if (c.shot.startS < prevSrcEnd) score -= 0.15 * style.narrative;
        else score += 0.1 * style.narrative;
      }
      score += (rand() - 0.5) * 0.12;
      if (!best || score > best.score) {
        // trecho dentro da cena: evita o primeiro quadro (corte) e pega o miolo
        const room = Math.max(0, shotLen - len);
        const srcIn = c.shot.startS + Math.min(0.12, room) + room * 0.25 * rand();
        best = { c, score, srcIn };
      }
    }
    if (!best) {
      // acabaram as cenas novas: reaproveita (evita a anterior quando há outra opção)
      if (!warnings.includes(REPEAT_WARNING)) warnings.push(REPEAT_WARNING);
      used.clear();
      const fits = candidates.filter((x) => x.shot.endS - x.shot.startS >= len * 0.6);
      const c = fits.find((x) => x.id !== prev?.id) ?? fits[0];
      if (!c) continue;
      // outro pedaço da mesma cena, para não parecer congelado
      const room = Math.max(0, c.shot.endS - c.shot.startS - len);
      best = { c, score: 0, srcIn: c.shot.startS + room * rand() };
    }
    const { c } = best;
    const shotLen = c.shot.endS - c.shot.startS;
    const speed = shotLen >= len ? 1 : Math.max(0.6, shotLen / len);
    const srcLen = len * speed;
    const effects: EffectInstance[] = [...gradeFx(style.grade)];
    const fxOn = opts.useEffects && style.impactFx > 0;
    if (fxOn && sl.isDrop) {
      effects.push(fx('flash', { duration: 0.2, white: 1, strength: 1 }), fx('shake', { intensity: 22, frequency: 14, duration: 0.45 }));
    } else if (fxOn && sl.energy > 0.7 && c.shot.tags.includes('impacto') && rand() < 0.45 * style.impactFx) {
      effects.push(fx('shake', { intensity: 14, frequency: 12, duration: Math.min(0.35, len) }));
    } else if (fxOn && sl.energy > 0.55 && len >= 0.8 && rand() < 0.3 * style.impactFx) {
      effects.push(fx('zoom', { from: 1, to: 1.15, ease: 1 }));
    }
    const transition = style.transition === 'dissolve' && clipsMade > 0 ? { transition: 'dissolve', durationUs: us(Math.min(0.6, len / 3)), params: {} } : null;
    const why = [
      sl.isDrop ? `Drop em ${fmt(sl.startS)}` : `${sl.section || 'trecho'} (energia ${sl.energy.toFixed(2)})`,
      `cena de ${c.shot.tags.join('/') || 'intensidade'} ${c.shot.intensity.toFixed(2)}`,
      `${c.ep.name} ${fmt(c.shot.startS)}`,
      speed < 1 ? `câmera lenta ${speed.toFixed(2)}×` : null,
    ]
      .filter(Boolean)
      .join(' — ');
    const clip = baseClip(v1.id, c.ep.assetId, sl.startS, len, best.srcIn, why, { speed, sourceOutUs: us(best.srcIn) + us(srcLen), effects, transitionIn: transition, confidence: Math.max(0, Math.min(1, best.score)) });
    clip.sourceOutUs = clip.sourceInUs + Math.round(clip.durationUs * speed);
    cmds.push({ type: 'clip.add', clip });
    if (opts.showText && text && sl.word) cmds.push({ type: 'clip.add', clip: textClip(text.id, sl.startS, len, sl.word, H, 'word', 'Palavra da letra') });
    used.add(c.id);
    prev = c;
    prevSrcEnd = best.srcIn + srcLen;
    clipsMade++;
  }

  // ---------------------------------------------------------------- fala + imagem do personagem antes do drop
  if (speechUsed && voice && dropT !== null) {
    const { ep, s, atS } = speechUsed;
    const len = dropT - atS;
    const reason = `Fala marcante antes do drop: ${s.text ? `"${s.text.replace(/\n/g, ' ')}"` : s.kind} — ${ep.name} ${fmt(s.startS)}; música abaixada durante a fala`;
    cmds.push({ type: 'clip.add', clip: baseClip(v1.id, ep.assetId, atS, len, s.startS, reason, { effects: gradeFx(style.grade) }) });
    cmds.push({ type: 'clip.add', clip: baseClip(voice.id, ep.assetId, atS, len, s.startS, reason, { audio: { gainDb: 3, fadeInUs: us(0.05), fadeOutUs: us(0.08), pitchSemitones: 0, streamIndex: null } }) });
    if (opts.showText && text && s.text && style.subtitles !== 'none') cmds.push({ type: 'clip.add', clip: textClip(text.id, atS, len, s.text, H, 'line', 'Legenda da fala') });
    clipsMade++;
  }

  // legenda da música (se tiver a letra e o estilo não for "letra")
  if (opts.showText && text && opts.lyrics?.length && style.id !== 'letra' && style.subtitles !== 'none') {
    for (const c of opts.lyrics) {
      if (!Number.isFinite(c.startS) || c.endS <= range[0] || c.startS >= range[1]) continue;
      const a = Math.max(0, c.startS - range[0]);
      const b = Math.min(D, c.endS - range[0]);
      if (speechUsed && a < dropT! && b > speechUsed.atS) continue;
      cmds.push({ type: 'clip.add', clip: textClip(text.id, a, b - a, c.text, H, 'line', 'Letra da música') });
    }
  }

  return {
    commands: cmds,
    summary: { clips: clipsMade, cuts: Math.max(0, clipsMade - 1), speech: speechUsed?.s.text ?? (speechUsed ? speechUsed.s.kind : null), musicRange: range, drop: dropT },
    warnings: [...new Set(warnings)],
  };
}

export type { Track };
