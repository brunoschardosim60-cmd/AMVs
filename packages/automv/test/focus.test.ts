import { describe, expect, it } from 'vitest';
import { buildSequences, shotKey, type EpisodeAnalysis, type MusicAnalysis, type Shot, type SpeechSegment } from '@amv/analysis';
import { applyCommand, clipEndUs, createProject, findOverlaps, type Asset, type Clip, type Project } from '@amv/project';
import { chooseSequences, generateAmv, pickAudioStream, planFootage, suggestMusicRanges, type EpisodeInput, type GenerateOptions, type MusicInput } from '../src/index.js';

const S = 1_000_000;

/** Música de 90 s, 120 BPM; calma até 40 s, drop em 40 s (igual à do teste principal). */
function music(): MusicInput {
  const beats = Array.from({ length: 180 }, (_, i) => i * 0.5);
  const energy = Array.from({ length: 360 }, (_, i) => (i * 0.25 < 40 ? 0.25 : 0.9));
  const analysis: MusicAnalysis = {
    version: 'm2', durationS: 90, bpm: 120, bpmConfidence: 0.9, beats, downbeats: beats.filter((_, i) => i % 4 === 0), energy, energyStepS: 0.25,
    sections: [{ startS: 0, endS: 40, label: 'intro', energy: 0.25 }, { startS: 40, endS: 90, label: 'drop', energy: 0.9 }],
    drops: [40], intensity: 70, loudnessDb: -12,
  };
  return { assetId: 'mus', name: 'musica.mp3', analysis };
}

/** n planos de 1,5 s (como num anime de luta), colados, com golpe no meio de cada um. */
const LEN = 1.5;
function shots(t0: number, n: number, base: number, tag: Shot['tags'] = ['ação']): Shot[] {
  return Array.from({ length: n }, (_, i) => {
    const intensity = Math.min(1, base + ((i * 7) % 10) / 100);
    const a = t0 + i * LEN;
    return { startS: a, endS: a + LEN, motion: intensity, loud: intensity, intensity, brightness: 0.5, tags: intensity > 0.85 ? ([...tag, 'impacto'] as Shot['tags']) : tag, line: null, peakS: a + LEN / 2 };
  });
}

/** Episódio com duas lutas (A: 0–120 s, B: 150–270 s) separadas por 30 s de calma. */
function twoFights(id: string, baseA: number, baseB: number, speech: SpeechSegment[] = []): EpisodeInput {
  const all = [...shots(0, 80, baseA), ...shots(120, 20, 0.05, ['calma']), ...shots(150, 80, baseB)];
  const analysis: EpisodeAnalysis = { version: 'e2', durationS: 270, shots: all, sequences: buildSequences(all), subtitles: [], intensityCurve: [], curveStepS: 1, speech };
  return { assetId: id, name: `${id}.mkv`, analysis, hasAudio: true };
}

function project(): Project {
  let p = createProject({ name: 't', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 } } });
  const asset = (id: string, kind: Asset['kind'], dur: number): Asset => ({
    id, name: id, path: `/m/${id}`, hash: id, kind, status: 'ok', error: null, importedAt: '', tags: [], favorite: false,
    probe: { container: 'x', durationUs: dur * S, sizeBytes: 1, bitRate: null, video: kind === 'video' ? { codec: 'h264', profile: null, width: 1920, height: 1080, pixFmt: null, bitDepth: 8, fps: { num: 24, den: 1 }, avgFps: null, vfr: false, frameCount: null } : null, audio: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: null, language: null, title: null }], subtitles: [], tags: {} },
  });
  const sfx = (id: string, dur: number): Asset => ({ ...asset(id, 'audio', dur), tags: ['sfx'] });
  for (const a of [asset('mus', 'audio', 90), asset('ep1', 'video', 600), asset('ep2', 'video', 600), sfx('sfx-impact', 1.4), sfx('sfx-hit', 0.3), sfx('sfx-whoosh', 0.6), sfx('sfx-riser', 2)]) p = applyCommand(p, { type: 'asset.add', asset: a }).project;
  return p;
}

const base: GenerateOptions = { style: 'hype', intensity: 2, durationS: 60, musicStartS: null, useSpeech: false, useEffects: true, showText: false, seed: 1 };

function run(eps: EpisodeInput[], opts: Partial<GenerateOptions> = {}) {
  const p = project();
  const r = generateAmv(p, music(), eps, { ...base, ...opts });
  const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
  const track = (name: string) => out.tracks.find((t) => t.name === name)!.id;
  const on = (name: string) => out.clips.filter((c) => c.trackId === track(name)).sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  return { r, out, on };
}

const srcS = (c: Clip) => c.sourceInUs / S;
const inA = (c: Clip) => srcS(c) < 120;
const inB = (c: Clip) => srcS(c) >= 150;

describe('foco na luta', () => {
  it('detecta as duas lutas do episódio de teste', () => {
    const fights = twoFights('ep1', 0.6, 0.6).analysis.sequences.filter((s) => s.kind === 'luta');
    expect(fights).toHaveLength(2);
  });

  it('modo luta: todas as cenas saem de UMA luta só', () => {
    const { on } = run([twoFights('ep1', 0.6, 0.6)], { focus: 'fight' });
    const v1 = on('V1');
    expect(v1.length).toBeGreaterThan(15);
    const a = v1.filter(inA).length;
    const b = v1.filter(inB).length;
    expect(a === v1.length || b === v1.length, `A=${a} B=${b}`).toBe(true);
    expect(v1.some((c) => srcS(c) >= 120 && srcS(c) < 150)).toBe(false); // nem a cena calma do meio
  });

  it('controle: no modo misturar, as mesmas cenas vêm das duas lutas (o teste acima prova algo)', () => {
    const { on } = run([twoFights('ep1', 0.6, 0.6)], { focus: 'mix' });
    const v1 = on('V1');
    expect(v1.some(inA) && v1.some(inB)).toBe(true);
  });

  it('escolhe a luta mais forte; "Gerar outra versão" ainda vem de uma luta só', () => {
    const ep = twoFights('ep1', 0.5, 0.8);
    const pool = chooseSequences([ep], 30, {});
    expect(pool).toHaveLength(1);
    expect(pool[0]!.seq.startS).toBeGreaterThanOrEqual(150);
    for (const seed of [1, 2, 3, 4]) {
      const v1 = run([ep], { focus: 'fight', seed }).on('V1');
      expect(v1.every(inA) || v1.every(inB)).toBe(true);
    }
  });

  it('escolha manual da luta vale mais que a mais forte', () => {
    const ep = twoFights('ep1', 0.5, 0.8);
    const weaker = ep.analysis.sequences.find((s) => s.kind === 'luta' && s.startS < 100)!;
    const v1 = run([ep], { focus: 'fight', sequenceIds: [`ep1#${weaker.id}`] }).on('V1');
    expect(v1.every(inA)).toBe(true);
  });

  it('dentro da luta, anda para a frente no episódio (lê como uma luta só)', () => {
    const v1 = run([twoFights('ep1', 0.6, 0.6)], { focus: 'fight' }).on('V1');
    let forward = 0;
    for (let i = 1; i < v1.length; i++) if (v1[i]!.sourceInUs >= v1[i - 1]!.sourceInUs) forward++;
    expect(forward / (v1.length - 1)).toBeGreaterThan(0.7);
  });

  it('poucas cenas na luta forte: junta a próxima luta em vez de repetir cenas', () => {
    // luta A forte mas curta (12 cenas); luta B maior e um pouco mais fraca
    const all = [...shots(0, 12, 0.85), ...shots(40, 20, 0.05, ['calma']), ...shots(70, 80, 0.6)];
    const ep: EpisodeInput = { assetId: 'ep1', name: 'ep1.mkv', hasAudio: true, analysis: { version: 'e2', durationS: 200, shots: all, sequences: buildSequences(all), subtitles: [], intensityCurve: [], curveStepS: 1, speech: [] } };
    const pool = chooseSequences([ep], 30, { neededShots: 40 });
    expect(pool.length).toBe(2); // só a luta curta não dá 40 cortes
    const { r, on } = run([ep], { focus: 'fight' });
    expect(r.warnings.some((w) => w.includes('repetem'))).toBe(false);
    expect(new Set(on('V1').map((c) => `${c.assetId}@${c.sourceInUs}`)).size).toBe(on('V1').length);
  });

  it('com cenas de sobra, fica numa luta só (não junta outra à toa)', () => {
    const pool = chooseSequences([twoFights('ep1', 0.6, 0.6)], 30, { neededShots: 40 });
    expect(pool).toHaveLength(1);
  });

  it('sem nenhuma luta definida: cai no modo misturar e avisa', () => {
    const calm = [...shots(0, 30, 0.05, ['calma'])];
    const ep: EpisodeInput = { assetId: 'ep1', name: 'ep1.mkv', hasAudio: true, analysis: { version: 'e2', durationS: 90, shots: calm, sequences: buildSequences(calm), subtitles: [], intensityCurve: [], curveStepS: 1, speech: [] } };
    const plan = planFootage([ep], { ...base, focus: 'fight' });
    expect(plan.mode).toBe('mix');
    expect(plan.warnings.join(' ')).toMatch(/luta bem definida/);
    expect(run([ep], { focus: 'fight' }).on('V1').length).toBeGreaterThan(5);
  });

  it('análise antiga (sem sequences) não quebra', () => {
    const ep = twoFights('ep1', 0.6, 0.6);
    delete (ep.analysis as Partial<EpisodeAnalysis>).sequences;
    expect(() => run([ep], { focus: 'fight' })).not.toThrow();
  });

  it('vídeo sem buraco nem sobreposição', () => {
    const { out, on } = run([twoFights('ep1', 0.6, 0.6)], { focus: 'fight' });
    const v1 = on('V1');
    expect(findOverlaps(out)).toEqual([]);
    for (let i = 1; i < v1.length; i++) expect(v1[i]!.timelineStartUs).toBe(clipEndUs(v1[i - 1]!));
    expect(v1[0]!.timelineStartUs).toBe(0);
    expect(clipEndUs(v1.at(-1)!)).toBeGreaterThanOrEqual(59.9 * S);
  });
});

describe('golpe na batida', () => {
  const peakOffset = (c: Clip, ep: EpisodeInput) => {
    const sh = ep.analysis.shots.find((x) => srcS(c) >= x.startS - 1e-6 && srcS(c) < x.endS)!;
    return (sh.peakS - srcS(c)) / c.speed;
  };

  it('cena forte: o golpe cai logo depois do corte; no drop, quase junto', () => {
    const ep = twoFights('ep1', 0.7, 0.7);
    const { on, r } = run([ep], { focus: 'fight', hitSync: true });
    const v1 = on('V1');
    const synced = v1.filter((c) => c.reason?.includes('golpe na batida'));
    expect(synced.length).toBeGreaterThan(v1.length * 0.6);
    for (const c of synced) {
      const off = peakOffset(c, ep);
      expect(off).toBeGreaterThanOrEqual(0.03);
      expect(off).toBeLessThanOrEqual(0.13);
      // o corte continua na batida (meio segundo)
      expect((c.timelineStartUs / S) % 0.5).toBeCloseTo(0, 5);
    }
    const dropAt = r.summary.drop!;
    const drop = v1.find((c) => c.timelineStartUs === Math.round(dropAt * S))!;
    expect(drop.reason).toMatch(/Drop/);
    expect(drop.reason).toMatch(/golpe na batida/);
    expect(peakOffset(drop, ep)).toBeCloseTo(0.04, 2);
  });

  it('desligado: nenhum clipe diz que encaixou golpe', () => {
    const { on } = run([twoFights('ep1', 0.7, 0.7)], { focus: 'fight', hitSync: false });
    expect(on('V1').some((c) => c.reason?.includes('golpe na batida'))).toBe(false);
  });

  it('o trecho do clipe nunca sai da cena (não pega o quadro de outro corte)', () => {
    const ep = twoFights('ep1', 0.7, 0.7);
    for (const c of run([ep], { focus: 'fight' }).on('V1')) {
      const sh = ep.analysis.shots.find((x) => srcS(c) >= x.startS - 1e-6 && srcS(c) < x.endS)!;
      expect(c.sourceOutUs / S).toBeLessThanOrEqual(sh.endS + 1e-6);
    }
  });
});

describe('melhor trecho da música para as cenas', () => {
  /** 120 s: calma | drop 30 s (forte 0,9) | calma | drop 90 s (médio 0,6). */
  function longMusic(): MusicAnalysis {
    const beats = Array.from({ length: 240 }, (_, i) => i * 0.5);
    const energy = Array.from({ length: 480 }, (_, i) => {
      const t = i * 0.25;
      return t < 30 ? 0.2 : t < 60 ? 0.9 : t < 90 ? 0.2 : 0.6;
    });
    return { ...music().analysis, durationS: 120, beats, downbeats: beats.filter((_, i) => i % 4 === 0), energy, drops: [30, 90], sections: [{ startS: 0, endS: 30, label: 'intro', energy: 0.2 }, { startS: 30, endS: 60, label: 'drop', energy: 0.9 }, { startS: 60, endS: 90, label: 'ponte', energy: 0.2 }, { startS: 90, endS: 120, label: 'refrão', energy: 0.6 }] };
  }

  it('cenas fortíssimas → o drop forte; cenas medianas → o drop médio', () => {
    const high = { intensities: Array.from({ length: 40 }, (_, i) => 0.8 + (i % 10) / 100), lowI: 0.3, highI: 0.95 };
    const mid = { intensities: Array.from({ length: 40 }, (_, i) => 0.3 + (i % 10) / 50), lowI: 0.3, highI: 0.95 };
    const a = suggestMusicRanges(longMusic(), 30, high, 1)[0]!;
    const b = suggestMusicRanges(longMusic(), 30, mid, 1)[0]!;
    expect(a.startS).toBeGreaterThanOrEqual(14);
    expect(a.startS).toBeLessThanOrEqual(22);
    expect(b.startS).toBeGreaterThanOrEqual(74);
    expect(a.reasons.length).toBeGreaterThan(0);
  });

  it('devolve alternativas distintas, em ordem de nota, sem janelas quase iguais', () => {
    const r = suggestMusicRanges(longMusic(), 30, null, 3);
    expect(r.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < r.length; i++) expect(r[i]!.score).toBeLessThanOrEqual(r[i - 1]!.score);
    for (const x of r) for (const y of r) if (x !== y) expect(Math.abs(x.startS - y.startS)).toBeGreaterThanOrEqual(15);
  });

  it('o AMV gerado usa o trecho sugerido e continua com o drop em ~40%', () => {
    const { r } = run([twoFights('ep1', 0.8, 0.8)], { focus: 'fight' });
    expect(r.summary.drop).not.toBeNull();
    expect(r.summary.drop! / 60).toBeGreaterThan(0.25);
    expect(r.summary.drop! / 60).toBeLessThan(0.55);
  });

  it('trecho escolhido à mão é respeitado', () => {
    const { r } = run([twoFights('ep1', 0.8, 0.8)], { focus: 'fight', musicStartS: 4 });
    expect(r.summary.musicRange[0]).toBe(4);
  });
});

describe('falas intercaladas e música baixando', () => {
  const sp = (startS: number, endS: number, text: string, impact: number): SpeechSegment => ({ startS, endS, kind: 'fala', confidence: 0.9, text, impact });
  const withSpeech = () => twoFights('ep1', 0.7, 0.7, [sp(20, 22, 'Eu vou vencer!', 0.95), sp(30, 32, 'Não desisto!', 0.85), sp(45, 47, 'Protegerei todos!', 0.8), sp(60, 62.5, 'Chega de correr', 0.7)]);

  it('1 fala (padrão): só antes do drop, como antes', () => {
    const { on, r } = run([withSpeech()], { focus: 'fight', useSpeech: true });
    expect(on('Vozes')).toHaveLength(1);
    expect(clipEndUs(on('Vozes')[0]!)).toBe(Math.round(r.summary.drop! * S));
  });

  it('3 falas: uma antes do drop e duas no trecho calmo, com a música baixando em cada uma', () => {
    const { on, out, r } = run([withSpeech()], { focus: 'fight', useSpeech: true, voiceMoments: 3 });
    const dropS = r.summary.drop!;
    const voices = on('Vozes');
    expect(voices).toHaveLength(3);
    expect(findOverlaps(out)).toEqual([]);
    for (const v of voices) expect(v.timelineStartUs / S).toBeLessThan(dropS); // todas antes do drop (música calma)
    // falas separadas por pelo menos 1,5 s
    for (let i = 1; i < voices.length; i++) expect(voices[i]!.timelineStartUs - clipEndUs(voices[i - 1]!)).toBeGreaterThanOrEqual(1.5 * S);
    // a música abaixa 3 vezes, com keyframes em ordem
    const kf = on('Música')[0]!.keyframes['audio.gainDb']!;
    expect(kf.filter((k) => k.value === -16)).toHaveLength(6);
    for (let i = 1; i < kf.length; i++) expect(kf[i]!.atUs).toBeGreaterThan(kf[i - 1]!.atUs);
    // cada fala tem a imagem de quem fala
    const v1 = on('V1');
    for (const v of voices) expect(v1.some((c) => c.assetId === v.assetId && c.timelineStartUs <= v.timelineStartUs && clipEndUs(c) >= clipEndUs(v))).toBe(true);
    // e a trilha de vídeo continua sem buracos
    for (let i = 1; i < v1.length; i++) expect(v1[i]!.timelineStartUs).toBe(clipEndUs(v1[i - 1]!));
    expect(clipEndUs(v1.at(-1)!)).toBeGreaterThanOrEqual(59.9 * S);
  });

  it('pede mais falas do que cabem: faz as que cabem e avisa', () => {
    const { on, r } = run([withSpeech()], { focus: 'fight', useSpeech: true, voiceMoments: 5 });
    expect(on('Vozes').length).toBeLessThanOrEqual(5);
    if (on('Vozes').length < 5) expect(r.warnings.join(' ')).toMatch(/Só coube/);
  });

  it('falas de outro episódio (fora da luta escolhida) não entram', () => {
    const near = twoFights('ep1', 0.7, 0.7, [sp(20, 22, 'Eu vou vencer!', 0.5)]);
    const far = twoFights('ep2', 0.2, 0.2, [sp(80, 82, 'Fala de outra cena!', 0.99)]);
    const { on } = run([near, far], { focus: 'fight', useSpeech: true });
    expect(on('Vozes').every((v) => v.assetId === 'ep1')).toBe(true);
  });
});

describe('faixa de áudio da fala (japonês × português)', () => {
  const two = [{ index: 1, language: 'por', title: 'Dublado' }, { index: 2, language: 'jpn', title: null }];

  it('por padrão pega o áudio original (japonês), mesmo que a dublagem venha primeiro', () => {
    expect(pickAudioStream({ ...twoFights('e', 0.6, 0.6), audioStreams: two })).toBe(2);
    expect(pickAudioStream({ ...twoFights('e', 0.6, 0.6), audioStreams: two }, 'pt')).toBe(1);
  });

  it('uma faixa só ou sem idioma: deixa a padrão', () => {
    expect(pickAudioStream({ ...twoFights('e', 0.6, 0.6), audioStreams: [two[0]!] })).toBeNull();
    expect(pickAudioStream({ ...twoFights('e', 0.6, 0.6), audioStreams: [{ index: 1, language: null }, { index: 2, language: null }] })).toBe(1);
    expect(pickAudioStream(twoFights('e', 0.6, 0.6))).toBeNull();
  });

  it('o clipe de fala sai com a faixa certa', () => {
    const ep = { ...twoFights('ep1', 0.7, 0.7, [{ startS: 20, endS: 22, kind: 'fala' as const, confidence: 0.9, text: 'Vamos!', impact: 0.9 }]), audioStreams: two };
    expect(run([ep], { focus: 'fight', useSpeech: true }).on('Vozes')[0]!.audio.streamIndex).toBe(2);
    expect(run([ep], { focus: 'fight', useSpeech: true, voiceLang: 'pt' }).on('Vozes')[0]!.audio.streamIndex).toBe(1);
  });
});

describe('efeitos sonoros', () => {
  const sfxAssets = { impact: 'sfx-impact', hit: 'sfx-hit', whoosh: 'sfx-whoosh', riser: 'sfx-riser' };
  const ep = () => twoFights('ep1', 0.7, 0.7);
  const sp = (startS: number, endS: number): SpeechSegment => ({ startS, endS, kind: 'fala', confidence: 0.9, text: 'Vou vencer!', impact: 0.9 });

  it('impacto exatamente no drop e a subida termina nele', () => {
    const { r, on } = run([ep()], { sfxAssets });
    const fx = on('Efeitos');
    const drop = r.summary.drop!;
    const impact = fx.find((c) => c.assetId === 'sfx-impact')!;
    const riser = fx.find((c) => c.assetId === 'sfx-riser')!;
    expect(impact.timelineStartUs / S).toBeCloseTo(drop - 0.004, 3);
    expect(clipEndUs(riser)).toBe(impact.timelineStartUs); // a subida termina no instante em que o impacto começa (colados, sem sobrepor)
    expect(riser.audio.fadeInUs).toBeGreaterThan(0);
  });

  it('a trilha de efeitos não tem sobreposição, nem passa do fim do vídeo', () => {
    const { out, on } = run([ep()], { sfxAssets });
    expect(findOverlaps(out)).toEqual([]);
    for (const c of on('Efeitos')) expect(clipEndUs(c)).toBeLessThanOrEqual(60 * S + 1);
    expect(on('Efeitos').length).toBeGreaterThan(4);
  });

  it('golpes são seletivos (não metralhadora): espaçados e em número razoável', () => {
    const fx = run([ep()], { sfxAssets }).on('Efeitos').filter((c) => c.assetId === 'sfx-hit' || c.assetId === 'sfx-whoosh');
    expect(fx.length).toBeGreaterThan(3);
    expect(fx.length).toBeLessThan(60 / 1.6 + 1);
    for (let i = 1; i < fx.length; i++) expect(fx[i]!.timelineStartUs - fx[i - 1]!.timelineStartUs).toBeGreaterThanOrEqual(0.74 * S);
  });

  it('golpes e whoosh aparecem na luta, mais baixos que o impacto', () => {
    const { on } = run([ep()], { sfxAssets });
    const fx = on('Efeitos');
    expect(fx.some((c) => c.assetId === 'sfx-hit')).toBe(true);
    const gain = (id: string) => fx.find((c) => c.assetId === id)!.audio.gainDb;
    expect(gain('sfx-hit')).toBeLessThan(gain('sfx-impact'));
  });

  it('cada golpe sonoro cai no instante do golpe da imagem (não solto no vídeo)', () => {
    const e = ep();
    const { on } = run([e], { sfxAssets });
    const v1 = on('V1');
    for (const h of on('Efeitos').filter((c) => c.assetId === 'sfx-hit')) {
      const at = h.timelineStartUs / S + 0.004;
      const clip = v1.find((c) => c.timelineStartUs <= h.timelineStartUs + 1 && clipEndUs(c) > h.timelineStartUs)!;
      const sh = e.analysis.shots.find((x) => srcS(clip) >= x.startS - 1e-6 && srcS(clip) < x.endS)!;
      const peakAt = clip.timelineStartUs / S + (sh.peakS - srcS(clip)) / clip.speed;
      expect(Math.abs(at - peakAt)).toBeLessThan(0.01);
    }
  });

  it('com fala antes do drop: nenhum efeito por cima da fala e sem subida', () => {
    const e = twoFights('ep1', 0.7, 0.7, [sp(20, 22)]);
    const { on } = run([e], { sfxAssets, useSpeech: true });
    const voice = on('Vozes')[0]!;
    // tolerância de 20 ms: o impacto começa 4 ms antes do drop, onde a fala termina
    for (const c of on('Efeitos')) expect(c.timelineStartUs >= clipEndUs(voice) - 0.02 * S || clipEndUs(c) <= voice.timelineStartUs + 0.02 * S).toBe(true);
    expect(on('Efeitos').some((c) => c.assetId === 'sfx-riser')).toBe(false);
    expect(on('Efeitos').some((c) => c.assetId === 'sfx-impact')).toBe(true);
  });

  it('ligar os efeitos sonoros não muda a escolha das cenas (mesma semente = mesmos cortes)', () => {
    const key = (xs: Clip[]) => xs.map((c) => `${c.timelineStartUs}|${c.sourceInUs}|${c.durationUs}`);
    const a = run([ep()], { seed: 5 }).on('V1');
    const b = run([ep()], { seed: 5, sfxAssets }).on('V1');
    expect(key(b)).toEqual(key(a));
  });

  it('sem os efeitos (ou desligado): trilha vazia', () => {
    expect(run([ep()], {}).on('Efeitos')).toHaveLength(0);
    expect(run([ep()], { sfxAssets, useSfx: false }).on('Efeitos')).toHaveLength(0);
    expect(run([ep()], { sfxAssets: { impact: 'sfx-impact' } }).on('Efeitos').every((c) => c.assetId === 'sfx-impact')).toBe(true);
  });

  it('gerar de novo substitui os efeitos (não acumula)', () => {
    const p = project();
    const m = music();
    const eps = [ep()];
    const gen = (pr: Project, seed: number) => applyCommand(pr, { type: 'batch', commands: generateAmv(pr, m, eps, { ...base, seed, sfxAssets }).commands }).project;
    const once = gen(p, 1);
    const twice = gen(once, 2);
    const n = (pr: Project) => pr.clips.filter((c) => c.trackId === pr.tracks.find((t) => t.name === 'Efeitos')!.id).length;
    expect(n(twice)).toBeGreaterThan(4);
    expect(n(twice)).toBeLessThan(n(once) + 12);
    expect(findOverlaps(twice)).toEqual([]);
  });

  it('o resumo conta os efeitos', () => {
    expect(run([ep()], { sfxAssets }).r.summary.sfx).toBeGreaterThan(4);
    expect(run([ep()], {}).r.summary.sfx).toBe(0);
  });
});

describe('visão: personagens e cenas de luta', () => {
  /** Luta A (80 cenas): pares = Goku, ímpares = Vegeta; a cada 5ª cena "não é luta". Luta B sem rótulo. */
  function labelled(): EpisodeInput {
    const e = twoFights('ep1', 0.7, 0.7);
    const shotsA = e.analysis.shots.filter((x) => x.startS < 120);
    const vis: EpisodeInput['vision'] = { version: 'v1', model: 'teste', shots: {} };
    shotsA.forEach((sh, i) => {
      vis.shots[shotKey(sh.startS)] = { characters: i % 2 === 0 ? ['Goku'] : ['Vegeta'], fight: i % 5 !== 4, note: '' };
    });
    return { ...e, vision: vis };
  }
  const who = (e: EpisodeInput, c: Clip) => {
    const sh = e.analysis.shots.find((x) => srcS(c) >= x.startS - 1e-6 && srcS(c) < x.endS)!;
    return e.vision!.shots[shotKey(sh.startS)];
  };

  it('só cenas do personagem escolhido (sem diferenciar maiúscula/acento)', () => {
    const e = labelled();
    for (const name of ['Goku', 'goku', 'GOKU ']) {
      const v1 = run([e], { focus: 'fight', characters: [name], durationS: 30 }).on('V1');
      expect(v1.length).toBeGreaterThan(10);
      for (const c of v1) expect(who(e, c)?.characters).toContain('Goku');
    }
  });

  it('cenas sem análise não entram quando se pede um personagem', () => {
    const e = labelled();
    const v1 = run([e], { focus: 'fight', characters: ['Goku'], durationS: 30 }).on('V1');
    expect(v1.every((c) => srcS(c) < 120)).toBe(true); // a luta B não tem rótulo
  });

  it('o resumo de cada clipe diz com quem é a cena', () => {
    const v1 = run([labelled()], { focus: 'fight', characters: ['Vegeta'], durationS: 30 }).on('V1');
    expect(v1.filter((c) => c.reason?.includes('com Vegeta')).length).toBe(v1.length);
  });

  it('personagem sem cenas suficientes não recebe cenas de outros personagens', () => {
    const e = labelled();
    const { r, on } = run([e], { focus: 'fight', characters: ['Naruto'], durationS: 30 });
    expect(r.warnings.join(' ')).toMatch(/Mantive o filtro para não misturar personagens/);
    expect(on('V1')).toHaveLength(0);
    expect(planFootage([e], { ...base, characters: ['Naruto'], focus: 'fight' }).wanted).toEqual(new Set(['naruto']));
  });

  it('poucas cenas identificadas repetem apenas o personagem pedido', () => {
    const e = labelled();
    const vision = { ...e.vision!, shots: { ...e.vision!.shots } };
    for (const [key, label] of Object.entries(vision.shots)) {
      vision.shots[key] = { ...label, characters: [] };
    }
    const first = e.analysis.shots[0]!;
    vision.shots[shotKey(first.startS)] = { characters: ['Goku'], fight: true, note: '' };
    const filtered = { ...e, vision };
    const { r, on } = run([filtered], { focus: 'fight', characters: ['Goku'], durationS: 30 });
    expect(r.warnings.join(' ')).toMatch(/Mantive o filtro/);
    expect(on('V1').length).toBeGreaterThan(1);
    for (const clip of on('V1')) expect(who(filtered, clip)?.characters).toContain('Goku');
  });

  it('sem pedir personagem: cena que não é luta fica fora dos golpes fortes (depois do drop)', () => {
    const e = labelled();
    const { r, on } = run([e], { focus: 'fight', durationS: 30, seed: 3 });
    const after = on('V1').filter((c) => c.timelineStartUs / S >= r.summary.drop! + 0.5);
    const bad = after.filter((c) => who(e, c)?.fight === false);
    expect(after.length).toBeGreaterThan(10);
    expect(bad.length / after.length).toBeLessThan(0.1);
  });

  it('sem nenhuma análise de visão, o resultado é idêntico ao de antes (mesma semente)', () => {
    const plain = twoFights('ep1', 0.7, 0.7);
    const key = (xs: Clip[]) => xs.map((c) => `${c.timelineStartUs}|${c.sourceInUs}`);
    expect(key(run([{ ...plain, vision: { version: 'v1', model: 't', shots: {} } }], { seed: 4 }).on('V1'))).toEqual(key(run([plain], { seed: 4 }).on('V1')));
  });

  it('o vídeo continua sem buracos nem sobreposição com o filtro de personagem', () => {
    const { out, on } = run([labelled()], { focus: 'fight', characters: ['Goku'], durationS: 30 });
    const v1 = on('V1');
    expect(findOverlaps(out)).toEqual([]);
    for (let i = 1; i < v1.length; i++) expect(v1[i]!.timelineStartUs).toBe(clipEndUs(v1[i - 1]!));
  });
});
