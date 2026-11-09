import { describe, expect, it } from 'vitest';
import type { EpisodeAnalysis, MusicAnalysis, Shot } from '@amv/analysis';
import { applyCommand, clipEndUs, createProject, findOverlaps, type Asset, type Clip, type Project } from '@amv/project';
import { chooseMusicRange, generateAmv, lyricCueKey, makeSlots, recommendStyle, styleDef, type EpisodeInput, type GenerateOptions, type MusicInput } from '../src/index.js';

const S = 1_000_000;

/** Música de 90 s, 120 BPM; calma até 40 s, drop em 40 s. */
function music(): MusicInput {
  const beats = Array.from({ length: 180 }, (_, i) => i * 0.5);
  const energy = Array.from({ length: 360 }, (_, i) => (i * 0.25 < 40 ? 0.25 : 0.9));
  const analysis: MusicAnalysis = {
    version: 'm1', durationS: 90, bpm: 120, bpmConfidence: 0.9, beats, downbeats: beats.filter((_, i) => i % 4 === 0),
    energy, energyStepS: 0.25,
    sections: [
      { startS: 0, endS: 40, label: 'intro', energy: 0.25 },
      { startS: 40, endS: 90, label: 'drop', energy: 0.9 },
    ],
    drops: [40], intensity: 70, loudnessDb: -12,
  };
  return { assetId: 'mus', name: 'musica.mp3', analysis };
}

function episode(id: string, n: number, seedShift: number): EpisodeInput {
  const shots: Shot[] = [];
  for (let i = 0; i < n; i++) {
    const intensity = ((i * 37 + seedShift) % 100) / 100;
    shots.push({
      startS: i * 4, endS: i * 4 + 3.5, motion: intensity, loud: intensity, intensity, brightness: 0.5,
      tags: intensity > 0.8 ? ['ação', 'impacto'] : intensity < 0.2 ? ['calma'] : ['ação'], line: null, peakS: i * 4 + 1.5,
    });
  }
  const analysis: EpisodeAnalysis = {
    version: 'e2', durationS: n * 4, shots, sequences: [], subtitles: [], intensityCurve: [], curveStepS: 1,
    speech: [
      { startS: 21, endS: 23.2, kind: 'grito', confidence: 0.9, text: 'Eu não vou desistir!', impact: 0.95 },
      { startS: 50, endS: 54, kind: 'fala', confidence: 0.9, text: 'Hoje o tempo está bom para passear no parque', impact: 0.2 },
      { startS: 70, endS: 71.5, kind: 'fala', confidence: 0.9, text: 'Vamos!', impact: 0.7 },
    ],
  };
  return { assetId: id, name: `${id}.mkv`, analysis, hasAudio: true };
}

function project(): Project {
  let p = createProject({ name: 't', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 } } });
  const asset = (id: string, kind: Asset['kind'], dur: number): Asset => ({
    id, name: id, path: `/m/${id}`, hash: id, kind, status: 'ok', error: null, importedAt: '', tags: [], favorite: false,
    probe: { container: 'x', durationUs: dur * S, sizeBytes: 1, bitRate: null, video: kind === 'video' ? { codec: 'h264', profile: null, width: 1920, height: 1080, pixFmt: null, bitDepth: 8, fps: { num: 24, den: 1 }, avgFps: null, vfr: false, frameCount: null } : null, audio: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: null, language: null, title: null }], subtitles: [], tags: {} },
  });
  for (const a of [asset('mus', 'audio', 90), asset('ep1', 'video', 600), asset('ep2', 'video', 600)]) p = applyCommand(p, { type: 'asset.add', asset: a }).project;
  return p;
}

// testes legados rodam no modo misturar (o comportamento de antes das lutas)
const base: GenerateOptions = { style: 'hype', intensity: 2, durationS: 60, musicStartS: null, useSpeech: true, useEffects: true, showText: true, seed: 1, focus: 'mix', hitSync: false };

function run(opts: Partial<GenerateOptions> = {}) {
  const p = project();
  const r = generateAmv(p, music(), [episode('ep1', 150, 3), episode('ep2', 150, 51)], { ...base, ...opts });
  const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
  const track = (name: string) => out.tracks.find((t) => t.name === name)!.id;
  const on = (name: string) => out.clips.filter((c) => c.trackId === track(name)).sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  return { r, out, on };
}

describe('trecho da música', () => {
  it('drop cai em ~40% do vídeo, começando num compasso', () => {
    const [a, b] = chooseMusicRange(music().analysis, 60, null);
    expect(b - a).toBe(60);
    expect(a).toBe(16);
    expect((40 - a) / 60).toBeCloseTo(0.4, 1);
  });

  it('cortes ficam mais rápidos depois do drop e nunca atravessam o drop', () => {
    const slots = makeSlots(music().analysis, [16, 76], styleDef('hype'), 2);
    const before = slots.filter((s) => s.endS <= 24);
    const after = slots.filter((s) => s.startS >= 24);
    const avg = (xs: typeof slots) => xs.reduce((a, s) => a + s.endS - s.startS, 0) / xs.length;
    expect(avg(before)).toBeGreaterThan(avg(after) * 2);
    expect(slots.some((s) => s.isDrop && Math.abs(s.startS - 24) < 0.01)).toBe(true);
    expect(slots.every((s) => !(s.startS < 23.95 && s.endS > 24.05))).toBe(true);
  });

  it('estilo Impacto rápido corta em meia batida na parte mais intensa', () => {
    const slots = makeSlots(music().analysis, [40, 50], styleDef('rapido'), 2);
    expect(slots.length).toBeGreaterThan(18);
    for (const slot of slots) if (slot.startS >= 2) expect(slot.endS - slot.startS).toBeCloseTo(0.25);
  });

  it('recomenda letra quando uma letra sincronizada foi carregada', () => {
    expect(recommendStyle([episode('ep1', 60, 3)], music().analysis, true).style).toBe('letra');
  });

  it('recomenda cortes rápidos quando música e cenas têm energia de ação', () => {
    const energetic = music().analysis;
    energetic.bpm = 160;
    energetic.intensity = 92;
    const action = episode('ep1', 60, 31);
    action.analysis.shots = action.analysis.shots.map((shot) => ({ ...shot, tags: ['ação', 'impacto'] }));
    expect(recommendStyle([action], energetic, false).style).toBe('rapido');
  });

  it('ajuste fino desloca batidas e drop sem mover o áudio', () => {
    const slots = makeSlots(music().analysis, [16, 76], styleDef('hype'), 2, undefined, 0.08);
    expect(slots.some((s) => s.isDrop && Math.abs(s.startS - 24.08) < 0.01)).toBe(true);
    expect(run({ beatOffsetMs: 80 }).r.summary.drop).toBeCloseTo(24.08);
    expect(run().r.summary.musicRange).toEqual(run({ beatOffsetMs: 80 }).r.summary.musicRange);
  });

  it('abre um corte na transição de seção mesmo quando não coincide com o drop', () => {
    const analysis = music().analysis;
    analysis.sections = [
      { startS: 0, endS: 39.25, label: 'intro', energy: 0.25 },
      { startS: 39.25, endS: 40, label: 'pré-refrão', energy: 0.6 },
      { startS: 40, endS: 90, label: 'drop', energy: 0.9 },
    ];
    const slots = makeSlots(analysis, [16, 76], styleDef('hype'), 2);
    expect(slots.some((slot) => Math.abs(slot.endS - 23.25) < 0.01)).toBe(true);
    expect(slots.some((slot) => Math.abs(slot.startS - 23.25) < 0.01)).toBe(true);
  });
});

describe('gerar AMV — hype', () => {
  it('monta vídeo inteiro, sem sobreposição, na batida, com motivo em cada clipe', () => {
    const { r, out, on } = run();
    const v1 = on('V1');
    expect(findOverlaps(out)).toEqual([]);
    expect(v1.length).toBeGreaterThan(40);
    // cobre o vídeo do começo ao fim
    expect(v1[0]!.timelineStartUs).toBe(0);
    expect(clipEndUs(v1.at(-1)!)).toBeGreaterThanOrEqual(59.9 * S);
    // todo corte cai numa batida (meio segundo), menos a imagem da fala, que termina no drop
    const speechStart = on('Vozes')[0]!.timelineStartUs;
    for (const c of v1) if (c.timelineStartUs !== speechStart) expect((c.timelineStartUs / S) % 0.5).toBeCloseTo(0, 5);
    // sem buracos na trilha de vídeo
    for (let i = 1; i < v1.length; i++) expect(v1[i]!.timelineStartUs).toBe(clipEndUs(v1[i - 1]!));
    expect(v1.every((c) => c.origin === 'ai' && c.reason)).toBe(true);
    // nenhuma cena repetida
    expect(new Set(v1.map((c) => `${c.assetId}@${c.sourceInUs}`)).size).toBe(v1.length);
    // usa os dois episódios
    expect(new Set(v1.map((c) => c.assetId)).size).toBe(2);
    expect(r.summary.drop).toBe(24);
  });

  it('drop: cena de impacto com clarão e tremida', () => {
    const { on } = run();
    const drop = on('V1').find((c) => c.timelineStartUs === 24 * S)!;
    expect(drop.reason).toMatch(/Drop em 0:24/);
    expect(drop.effects.map((e) => e.effect)).toEqual(expect.arrayContaining(['flash', 'shake']));
    expect(drop.reason).toMatch(/impacto/);
  });

  it('fala marcante termina exatamente no drop, com a imagem do personagem e a música abaixada', () => {
    const { on, r } = run();
    const voice = on('Vozes');
    expect(voice).toHaveLength(1);
    expect(clipEndUs(voice[0]!)).toBe(24 * S);
    expect(voice[0]!.sourceInUs).toBe(21 * S); // o grito "Eu não vou desistir!"
    const pic = on('V1').find((c) => c.timelineStartUs === voice[0]!.timelineStartUs)!;
    expect(pic.sourceInUs).toBe(21 * S);
    expect(pic.assetId).toBe(voice[0]!.assetId);
    const m = on('Música')[0]!;
    expect(m.keyframes['audio.gainDb']!.map((k) => k.value)).toEqual([0, -16, -16, 0]);
    expect(on('Legendas').map((c) => c.text?.text).join(' ')).toContain('Eu não vou desistir!');
    expect(r.summary.speech).toBe('Eu não vou desistir!');
  });

  it('mesma semente = mesma montagem; outra semente = outra montagem', () => {
    const strip = (cs: Clip[]) => cs.map((c) => [c.assetId, c.sourceInUs, c.timelineStartUs]);
    const a = run({ seed: 7 }).on('V1');
    const b = run({ seed: 7 }).on('V1');
    const c = run({ seed: 8 }).on('V1');
    expect(strip(a)).toEqual(strip(b));
    expect(strip(a)).not.toEqual(strip(c));
  });

  it('sem efeitos e sem fala quando desligados; episódio excluído não entra', () => {
    const { on } = run({ useEffects: false, useSpeech: false, exclude: ['ep2'] });
    expect(on('Vozes')).toHaveLength(0);
    expect(on('V1').some((c) => c.effects.some((e) => ['flash', 'shake', 'zoom'].includes(e.effect)))).toBe(false);
    expect(new Set(on('V1').map((c) => c.assetId))).toEqual(new Set(['ep1']));
  });

  it('substitui a montagem anterior (um único desfazer no app)', () => {
    const first = run().out;
    const r2 = generateAmv(first, music(), [episode('ep1', 150, 3)], { ...base, seed: 2 });
    const out2 = applyCommand(first, { type: 'batch', commands: r2.commands }).project;
    expect(findOverlaps(out2)).toEqual([]);
    expect(out2.clips.every((c) => c.origin === 'ai')).toBe(true);
  });
});

describe('outros estilos', () => {
  it('aumenta a tipografia de falas mais impactantes', () => {
    const { on } = run({ style: 'hype', voiceMoments: 3 });
    const speechCaptions = on('Legendas').filter((clip) => clip.reason === 'Legenda da fala');
    expect(speechCaptions.length).toBeGreaterThan(0);
    expect(Math.max(...speechCaptions.map((clip) => clip.text!.size))).toBeGreaterThan(Math.min(...speechCaptions.map((clip) => clip.text!.size)));
  });

  it('emocional: poucos cortes longos com dissolver', () => {
    const { on } = run({ style: 'emocional' });
    const v1 = on('V1');
    expect(v1.length).toBeLessThan(25);
    expect(v1.slice(1).every((c) => c.transitionIn?.transition === 'dissolve')).toBe(true);
  });

  it('letra: uma palavra por corte quando há a letra com tempo', () => {
    const lyrics = [
      { startS: 16, endS: 18, text: 'never gonna stop' },
      { startS: 18, endS: 20, text: 'arise again' },
    ];
    const { on } = run({ style: 'letra', lyrics });
    const words = on('Legendas').map((c) => c.text?.text);
    expect(words.slice(0, 5)).toEqual(['NEVER', 'GONNA', 'STOP', 'ARISE', 'AGAIN']);
    const wordClips = on('Legendas');
    // cada palavra começa exatamente num corte de vídeo
    const cuts = new Set(on('V1').map((c) => c.timelineStartUs));
    expect(wordClips.every((w) => cuts.has(w.timelineStartUs))).toBe(true);
  });

  it('legendas de música entram na batida próxima, são animadas e quebradas em frases curtas', () => {
    const lyrics = [{ startS: 30.04, endS: 33.04, text: 'Here we are beneath the moonlight tonight' }];
    const { on } = run({ style: 'hype', lyrics, useSpeech: false });
    const captions = on('Legendas').filter((clip) => clip.reason === 'Letra da música');
    expect(captions.length).toBeGreaterThan(1);
    expect(captions[0]!.timelineStartUs).toBe(14 * S);
    expect(captions.every((clip) => clip.text?.animationIn === 'pop' && clip.text.animationOut === 'fade')).toBe(true);
    expect(captions.every((clip) => clip.text?.color === '#fff0a6')).toBe(true);
    expect(captions.every((clip) => (clip.text?.text.split(' ').length ?? 0) <= 4)).toBe(true);
  });

  it('usa correspondências semânticas aprovadas na escolha da cena e preserva o motivo no clipe', () => {
    const cue = { startS: 2, endS: 4, text: 'Ninguém sabe o que há dentro de mim' };
    const matches = Object.fromEntries(
      ['ep1', 'ep2'].flatMap((assetId) =>
        episode(assetId, 150, 3).analysis.shots.map((shot) => [
          `${assetId}@${shot.startS}`,
          {
            [lyricCueKey(cue)]: {
              score: assetId === 'ep1' && shot.startS === 120 ? 1 : 0.05,
              reason: assetId === 'ep1' && shot.startS === 120 ? 'a força interior aparece como uma explosão de energia' : 'sentido distante da letra',
            },
          },
        ]),
      ),
    );
    const { on } = run({ style: 'hype', durationS: 10, musicStartS: 0, lyrics: [cue], lyricSceneMatches: matches, useSpeech: false });
    const lyricScene = on('V1').find((clip) => clip.timelineStartUs === 2 * S)!;
    expect(lyricScene.assetId).toBe('ep1');
    expect(lyricScene.sourceInUs / S).toBeGreaterThanOrEqual(120);
    expect(lyricScene.sourceInUs / S).toBeLessThan(123.5);
    expect(lyricScene.reason).toContain('combina com a letra');
    expect(on('Legendas').some((clip) => clip.reason?.includes('a força interior aparece'))).toBe(true);
  });

  it('omite letra sobre o drop e realça a palavra que cai no impacto', () => {
    const hype = run({
      style: 'hype',
      useSpeech: false,
      lyrics: [{ startS: 39.5, endS: 40.5, text: 'lyrics over drop' }],
    });
    expect(hype.r.warnings.some((warning) => warning.includes('omitido'))).toBe(true);
    expect(hype.on('Legendas').some((clip) => clip.reason === 'Letra da música')).toBe(false);

    const lyrics = [{ startS: 40, endS: 42, text: 'rise above' }];
    const letter = run({ style: 'letra', lyrics, useSpeech: false });
    const dropWord = letter.on('Legendas').find((clip) => clip.timelineStartUs === 24 * S)!;
    expect(dropWord.text?.text).toBe('RISE');
    expect(dropWord.text?.color).toBe('#fff0a6');
    expect(dropWord.text?.animationIn).toBe('pop');
    expect(dropWord.text?.animationOut).toBe('fade');
  });

  it('discurso: as falas viram a espinha, com legenda em pedaços e preto e branco', () => {
    const { on } = run({ style: 'discurso', durationS: 20 });
    expect(on('Vozes').length).toBeGreaterThan(0);
    expect(on('Música')[0]!.audio.gainDb).toBe(-14);
    expect(on('V1').every((c) => c.effects.some((e) => e.effect === 'color' && e.params.saturation === 0))).toBe(true);
    expect(on('Legendas').every((c) => (c.text?.text.split(' ').length ?? 0) <= 3)).toBe(true);
  });
});

describe('poucas cenas', () => {
  it('uma cena só: ainda preenche o vídeo inteiro, avisando uma vez', () => {
    const p = project();
    const r = generateAmv(p, music(), [episode('ep1', 1, 90)], { ...base, durationS: 10, useSpeech: false });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const v1 = out.clips.filter((c) => c.trackId === out.tracks.find((t) => t.name === 'V1')!.id).sort((a, b) => a.timelineStartUs - b.timelineStartUs);
    expect(v1.length).toBeGreaterThan(3);
    expect(clipEndUs(v1.at(-1)!)).toBeGreaterThanOrEqual(9.9 * S);
    for (let i = 1; i < v1.length; i++) expect(v1[i]!.timelineStartUs).toBe(clipEndUs(v1[i - 1]!));
    expect(r.warnings.filter((w) => w.includes('repetem'))).toHaveLength(1);
  });
});

describe('cenas curtas', () => {
  it('slots longos da intro são divididos na batida: sem buraco antes do drop', () => {
    const p = project();
    const ep = episode('ep1', 40, 5);
    ep.analysis.shots = ep.analysis.shots.map((sh) => ({ ...sh, endS: sh.startS + 1.2 }));
    const r = generateAmv(p, music(), [ep], { ...base, style: 'emocional', durationS: 30, useSpeech: false });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const v1 = out.clips.filter((c) => c.trackId === out.tracks.find((t) => t.name === 'V1')!.id).sort((a, b) => a.timelineStartUs - b.timelineStartUs);
    expect(v1[0]!.timelineStartUs).toBe(0);
    for (let i = 1; i < v1.length; i++) expect(v1[i]!.timelineStartUs).toBe(clipEndUs(v1[i - 1]!));
    expect(clipEndUs(v1.at(-1)!)).toBeGreaterThanOrEqual(29.9 * S);
    for (const c of v1) expect((c.timelineStartUs / S) % 0.5).toBeCloseTo(0, 5);
  });
});

describe('formato do projeto', () => {
  it('projeto vertical: cenas do episódio horizontal preenchem o quadro', () => {
    let p = project();
    p = applyCommand(p, { type: 'settings.update', patch: { width: 1080, height: 1920 } }).project;
    const r = generateAmv(p, music(), [episode('ep1', 150, 3)], { ...base, durationS: 10, useSpeech: false });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const v1 = out.tracks.find((t) => t.name === 'V1')!.id;
    const scales = new Set(out.clips.filter((c) => c.trackId === v1).map((c) => c.transform.scale));
    expect([...scales]).toEqual([Math.round(((1920 / 1080) / (1080 / 1920)) * 10000) / 10000]);
  });
});
