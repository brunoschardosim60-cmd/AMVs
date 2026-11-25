import { describe, expect, it } from 'vitest';
import { shotKey, type EpisodeAnalysis, type MusicAnalysis, type Shot } from '@amv/analysis';
import { applyCommand, ClipSchema, clipEndUs, createProject, evaluateKeyframes, findOverlaps, type Asset, type Clip, type Project } from '@amv/project';
import { chooseMusicRange, generateAmv, lyricCueKey, makeSlots, recommendStyle, styleDef, type EpisodeInput, type GenerateOptions, type MusicInput, voiceGainDb, scoreSpeechCandidate } from '../src/index.js';

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

function run(opts: Partial<GenerateOptions> = {}, p = project()) {
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

  describe('Laboratório de Cenas', () => {
    it('exclui do Auto AMV uma cena marcada no projeto', () => {
      let p = project();
      const ep = episode('ep1', 150, 3);
      ep.analysis.shots[0]!.startS = 0.033333;
      const sceneKey = shotKey(ep.analysis.shots[0]!.startS);
      p = applyCommand(p, {
        type: 'project.sceneAnnotation.update',
        assetId: 'ep1',
        sceneKey,
        annotation: {
          assetId: 'ep1', sceneKey, favorite: false, marked: false, excludedFromAuto: true, tags: [],
        },
      }).project;
      const result = generateAmv(p, music(), [ep], {
        ...base, focus: 'mix', useSpeech: false, durationS: 10, musicStartS: 0,
      });
      const videoClips = result.commands.flatMap((command) =>
        command.type === 'clip.add' && command.clip.trackId === p.tracks.find((track) => track.name === 'V1')!.id
          ? [command.clip]
          : [],
      );
      expect(videoClips.length).toBeGreaterThan(0);
      expect(videoClips.some((clip) => clip.assetId === 'ep1' && clip.sourceInUs === 33_333)).toBe(false);
    });
  });

  describe('mixagem das faixas do episódio', () => {
    it('usa o idioma escolhido e evita duplicar a fala na camada visual', () => {
      const p = project();
      const ep = episode('ep1', 150, 3);
      ep.audioStreams = [
        { index: 1, language: 'eng', title: 'English' },
        { index: 2, language: 'jpn', title: 'Japanese' },
      ];
      const result = generateAmv(p, music(), [ep], {
        ...base,
        durationS: 60,
        musicStartS: 0,
        focus: 'mix',
        voiceLang: 'original',
        voiceMoments: 1,
      });
      const out = applyCommand(p, { type: 'batch', commands: result.commands }).project;
      const videoTrackId = out.tracks.find((item) => item.name === 'V1')!.id;
      const voiceTrackId = out.tracks.find((item) => item.name === 'Vozes')!.id;
      const video = out.clips.filter((clip) => clip.trackId === videoTrackId && clip.assetId === ep.assetId);
      const voices = out.clips.filter((clip) => clip.trackId === voiceTrackId);

      expect(voices.length).toBeGreaterThan(0);
      expect(voices.every((clip) => clip.audio.streamIndex === 2)).toBe(true);
      expect(video.some((clip) => clip.audio.streamIndex !== 2)).toBe(false);
      for (const voice of voices) {
        const picture = video.find((clip) =>
          clip.timelineStartUs < voice.timelineStartUs + voice.durationUs
          && clip.timelineStartUs + clip.durationUs > voice.timelineStartUs,
        );
        expect(picture?.audio.gainDb).toBe(-60);
      }
    });
  });
  describe('preservação de color grading', () => {
    it('mantém a correção manual das cenas ao regenerar a mesma região', () => {
      const p = project();
      const videoTrackId = p.tracks.find((track) => track.name === 'V1')!.id;
      const previous = ClipSchema.parse({
        id: 'graded-before-regeneration',
        trackId: videoTrackId,
        assetId: 'ep1',
        timelineStartUs: 0,
        durationUs: 5 * S,
        sourceInUs: 0,
        sourceOutUs: 5 * S,
        origin: 'ai',
        effects: [{ id: 'manual-grade', effect: 'color', enabled: true, params: { exposure: 0.25, temperature: 28, saturation: 0.9 } }],
      });
      const withPrevious = applyCommand(p, { type: 'clip.add', clip: previous }).project;
      const result = generateAmv(withPrevious, music(), [episode('ep1', 150, 3)], { ...base, useSpeech: false });
      const regenerated = applyCommand(withPrevious, { type: 'batch', commands: result.commands }).project;
      const firstVideoClip = regenerated.clips
        .filter((clip) => clip.trackId === videoTrackId)
        .sort((a, b) => a.timelineStartUs - b.timelineStartUs)[0]!;
      expect(firstVideoClip.effects.find((effect) => effect.effect === 'color')?.params).toMatchObject({
        exposure: 0.25,
        temperature: 28,
        saturation: 0.9,
      });
      expect(firstVideoClip.effects.find((effect) => effect.effect === 'color')?.id).not.toBe('manual-grade');
    });
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

  it('abre corte nas frases musicais mesmo quando o grid de batidas passaria direto', () => {
    const analysis = music().analysis;
    analysis.beats = Array.from({ length: 32 }, (_, index) => index * 0.5);
    analysis.downbeats = [0, 2, 4, 6, 8, 10, 12, 14];
    analysis.drops = [];
    analysis.sections = [{ startS: 0, endS: 16, label: 'verso', energy: 0.5 }];
    analysis.energy = Array(64).fill(0.5);
    const longCadence = { ...styleDef('hype'), beatsPerCut: [10, 10, 10] as [number, number, number] };
    const slots = makeSlots(analysis, [0, 16], longCadence, 2);

    expect(slots.some((slot) => Math.abs(slot.endS - 8) < 0.001)).toBe(true);
    expect(slots.some((slot) => Math.abs(slot.startS - 8) < 0.001 && slot.musicCue === 'início de frase musical')).toBe(true);
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

  it('varia a densidade por estilo e só aumenta cortes em acentos fortes', () => {
    const analysis = music().analysis;
    analysis.events = [
      { atS: 45.25, type: 'impact', confidence: 0.95, strength: 0.92, band: 'low' },
      { atS: 32, type: 'pause', confidence: 0.9, strength: 0.8, durationS: 4 },
      { atS: 16, type: 'growth', confidence: 0.9, strength: 0.4, durationS: 8 },
    ];
    const range: [number, number] = [16, 76];
    const hype = makeSlots(analysis, range, styleDef('hype'), 2);
    const emotional = makeSlots(analysis, range, styleDef('emocional'), 2);
    const weakAccent = makeSlots({
      ...analysis,
      events: analysis.events!.map((event) => ({ ...event, confidence: 0.2 })),
    }, range, styleDef('hype'), 2);
    expect(hype.some((slot) => Math.abs(slot.endS - 29.25) < 0.01)).toBe(true);
    expect(weakAccent.some((slot) => Math.abs(slot.endS - 29.25) < 0.01)).toBe(false);
    expect(hype.some((slot) => Math.abs(slot.startS - 29.25) < 0.01 && slot.musicCue?.includes('acento espectral'))).toBe(true);
    expect(hype.some((slot) => slot.startS >= 16 && slot.startS < 20 && slot.endS - slot.startS >= 0.9)).toBe(true);
    const avg = (slots: typeof hype) => slots.reduce((sum, slot) => sum + slot.endS - slot.startS, 0) / slots.length;
    expect(avg(emotional)).toBeGreaterThan(avg(hype));
    expect(hype.length).toBeLessThan(analysis.beats.filter((beat) => beat >= range[0] && beat <= range[1]).length);

  });
});

describe('qualidade editorial das falas', () => {
  const segment = (text: string, kind: 'fala' | 'grito', impact: number, duration = 2.2) => ({
    startS: 0, endS: duration, kind, confidence: 0.9, text, impact,
  });

  it('prioriza uma frase completa sobre um grito curto e genérico, mesmo com impacto menor', () => {
    const phrase = segment('Eu não vou desistir!', 'fala', 0.72);
    const shout = segment('Vamos!', 'grito', 1);
    expect(scoreSpeechCandidate(phrase)).toBeGreaterThan(scoreSpeechCandidate(shout));
  });

  it('não recompensa transcrição longa e pouco específica só pelo número de palavras', () => {
    const meaningful = segment('Eu vou proteger todos vocês!', 'fala', 0.7);
    const rambling = segment('Hoje o tempo está bom para passear no parque com meus amigos', 'fala', 0.95, 4);
    expect(scoreSpeechCandidate(meaningful)).toBeGreaterThan(scoreSpeechCandidate(rambling));
  });

  it('mantém gritos fortes elegíveis quando não há uma frase melhor', () => {
    const shout = segment('Eu não vou desistir!', 'grito', 0.95);
    const neutral = segment('A porta está aberta agora', 'fala', 0.3, 3);
    expect(scoreSpeechCandidate(shout)).toBeGreaterThan(scoreSpeechCandidate(neutral));
  });
});

describe('gerar AMV — hype', () => {
  it('avisa quando a pulsação não sustenta cortes precisos', () => {
    const uncertain = music();
    uncertain.analysis.bpmConfidence = 0.2;
    const result = generateAmv(project(), uncertain, [episode('ep1', 150, 3)], {
      ...base,
      useSpeech: false,
      voiceMoments: 0,
    });
    expect(result.warnings.some((warning) => warning.includes('Confiança baixa na pulsação'))).toBe(true);
  });

  it('não escolhe planos curtos que exigiriam ultrapassar a cena para preencher o slot', () => {
    const p = project();
    const ep = episode('ep1', 2, 0);
    ep.analysis.durationS = 8;
    ep.analysis.shots = [
      {
        startS: 0, endS: 0.25, motion: 1, loud: 1, intensity: 1, brightness: 0.5,
        tags: ['ação', 'impacto'], line: null, peakS: 0.2,
      },
      {
        startS: 4, endS: 7.5, motion: 0.8, loud: 0.8, intensity: 0.8, brightness: 0.5,
        tags: ['ação', 'impacto'], line: null, peakS: 5.5,
      },
    ];
    ep.analysis.sequences = [];
    const result = generateAmv(p, music(), [ep], {
      ...base, durationS: 2, musicStartS: 40, focus: 'mix', useSpeech: false, hitSync: false,
    });
    const videoTrackId = p.tracks.find((track) => track.name === 'V1')!.id;
    const clips = result.commands.flatMap((command) =>
      command.type === 'clip.add' && command.clip.trackId === videoTrackId ? [command.clip] : [],
    );

    expect(clips.length).toBeGreaterThan(0);
    expect(clips.every((clip) => clip.sourceInUs >= 4 * S && clip.sourceOutUs <= 7.5 * S)).toBe(true);
  });

  it('não mistura legenda de um idioma com a faixa de voz de outro antes do drop', () => {
    const p = project();
    const ep = episode('ep1', 30, 3);
    ep.audioStreams = [
      { index: 1, language: 'jpn', title: 'Japanese' },
      { index: 2, language: 'por', title: 'Português' },
    ];
    ep.analysis.speech = [
      { startS: 21, endS: 23.2, kind: 'grito', confidence: 0.9, text: 'Eu não vou desistir!', language: 'pt', impact: 1 },
    ];
    const result = generateAmv(p, music(), [ep], {
      ...base, durationS: 60, musicStartS: 16, voiceLang: 'original', voiceMoments: 1,
      focus: 'mix', useSpeech: true,
    });
    const voiceTrackId = p.tracks.find((track) => track.name === 'Vozes')!.id;
    const voiceClips = result.commands.flatMap((command) =>
      command.type === 'clip.add' && command.clip.trackId === voiceTrackId ? [command.clip] : [],
    );

    // Em anime legendado (áudio japonês + legenda em português), preserva a voz original e exibe a legenda.
    expect(voiceClips).toHaveLength(1);
    expect(voiceClips[0]!.audio.streamIndex).toBe(1);
    expect(result.warnings.some((warning) => warning.includes('Nenhuma fala marcante'))).toBe(false);
    const textTrackId = p.tracks.find((track) => track.kind === 'text')!.id;
    expect(result.commands.some((command) => command.type === 'clip.add' && command.clip.trackId === textTrackId && command.clip.text?.text === 'Eu não vou desistir!')).toBe(true);
  });

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

  it('drop: cena de impacto usa transição de clarão e efeito de tremida sem duplicar o flash', () => {
    const { on } = run();
    const drop = on('V1').find((c) => c.timelineStartUs === 24 * S)!;
    expect(drop.reason).toMatch(/Drop em 0:24/);
    expect(drop.transitionIn?.transition).toBe('flash');
    expect(drop.effects.map((e) => e.effect)).toContain('shake');
    expect(drop.effects.map((e) => e.effect)).not.toContain('flash');
    expect(drop.reason).toMatch(/impacto/);
  });

  it('constrói arcada narrativa explícita e usa a fase para justificar a cena', () => {
    const { r, on } = run();
    expect(r.summary.direction.map((beat) => beat.role)).toContain('opening');
    expect(r.summary.direction.map((beat) => beat.role)).toContain('climax');
    expect(on('V1')[0]?.reason).toMatch(/Abertura/);
    const earlyClip = on('V1').find((clip) => clip.timelineStartUs <= 10 * S && clipEndUs(clip) > 10 * S);
    expect(earlyClip?.reason).toMatch(/Abertura/);
    expect(on('V1').find((clip) => clip.timelineStartUs === 24 * S)?.reason).toMatch(/Clímax/);
    expect(on('V1')[0]?.reason).toMatch(/critérios:/);
    expect(on('V1')[0]?.confidence).toBeNull();
  });

  it('não descarta uma cena escura só pelo brilho', () => {
    const ep = episode('ep1', 1, 0);
    ep.analysis.shots[0]!.tags = ['escura'];
    const p = project();
    const r = generateAmv(p, music(), [ep], { ...base, focus: 'mix', useSpeech: false, durationS: 4, musicStartS: 0 });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const videoTrack = out.tracks.find((track) => track.name === 'V1')!;
    expect(out.clips.some((clip) => clip.trackId === videoTrack.id && clip.assetId === 'ep1')).toBe(true);
    expect(r.warnings.some((warning) => warning.includes('Nenhuma cena analisada'))).toBe(false);
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
    expect(m.audio.duckingMode).toBe('manual');
    expect(on('Legendas').map((c) => c.text?.text).join(' ')).toContain('Eu não vou desistir!');
    expect(r.summary.speech).toBe('Eu não vou desistir!');
  });

  it('usa os keyframes como automação final sem empilhar o ducking automático', () => {
    const configuredProject = applyCommand(project(), {
      type: 'audioMix.update',
      patch: { duckingAmountDb: 6 },
    }).project;
    const { on } = run({}, configuredProject);
    expect(on('Música')[0]!.keyframes['audio.gainDb']!.map((keyframe) => keyframe.value)).toEqual([0, -16, -16, 0]);
    expect(on('Música')[0]!.audio.duckingMode).toBe('manual');

    const duckingDisabledProject = applyCommand(project(), {
      type: 'audioMix.update',
      patch: { duckingEnabled: false },
    }).project;
    expect(run({}, duckingDisabledProject).on('Música')[0]!.keyframes['audio.gainDb']!.map((keyframe) => keyframe.value))
      .toEqual([0, -16, -16, 0]);
  });

  it('não abaixa a música quando a trilha de voz gerada está silenciada', () => {
    let p = project();
    const voice = p.tracks.find((track) => track.role === 'voice')!;
    p = applyCommand(p, { type: 'track.update', trackId: voice.id, patch: { muted: true } }).project;
    expect(run({}, p).on('Música')[0]!.keyframes['audio.gainDb']).toBeUndefined();
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

  it('emocional: poucos cortes longos e não inventa dissolves sem evidência visual', () => {
    const { on } = run({ style: 'emocional' });
    const v1 = on('V1');
    expect(v1.length).toBeLessThan(25);
    expect(v1.slice(1).some((c) => c.transitionIn?.transition === 'dissolve')).toBe(false);
    expect(v1.slice(1).every((c) => c.reason?.includes('corte seco') || c.transitionIn?.transition === 'flash')).toBe(true);
  });

  it('letra: cortes palavra a palavra só usam timestamps fornecidos', () => {
    const lyrics = [
      {
        startS: 16,
        endS: 18,
        text: 'never gonna stop',
        words: [
          { startS: 16, endS: 16.4, text: 'never', source: 'ass' as const },
          { startS: 16.4, endS: 17, text: 'gonna', source: 'ass' as const },
          { startS: 17, endS: 17.6, text: 'stop', source: 'ass' as const },
        ],
      },
      {
        startS: 18,
        endS: 20,
        text: 'arise again',
        words: [
          { startS: 18, endS: 18.7, text: 'arise', source: 'ass' as const },
          { startS: 18.7, endS: 19.2, text: 'again', source: 'ass' as const },
        ],
      },
    ];
    const { on } = run({ style: 'letra', lyrics });
    const words = on('Legendas').map((c) => c.text?.text);
    expect(words.slice(0, 5)).toEqual(['NEVER', 'GONNA', 'STOP', 'ARISE', 'AGAIN']);
    const wordClips = on('Legendas');
    // cada palavra começa exatamente num corte de vídeo
    const videoClips = on('V1').sort((left, right) => left.timelineStartUs - right.timelineStartUs);
    const cuts = new Set(videoClips.map((clip) => clip.timelineStartUs));
    expect(wordClips.every((w) => cuts.has(w.timelineStartUs))).toBe(true);
    expect(wordClips.every((clip) => clip.text?.timingPrecision === 'word')).toBe(true);
    // a pausa entre "stop" e "arise" permanece coberta por imagem, mesmo que o corte caia noutro ponto da grade
    expect(videoClips.some((clip) => clip.timelineStartUs <= 17.6 * S && clipEndUs(clip) > 17.6 * S)).toBe(true);
    expect(videoClips.some((clip) => clip.timelineStartUs < 18 * S && clipEndUs(clip) >= 18 * S)).toBe(true);
    for (let index = 1; index < videoClips.length; index++) {
      expect(videoClips[index]!.timelineStartUs).toBe(clipEndUs(videoClips[index - 1]!));
    }
  });

  it('letra: timings estimados/incertos ficam como frase; Whisper confiável pode sincronizar palavras', () => {
    const uncertainLyrics = [{
      startS: 16,
      endS: 18,
      text: 'never gonna stop',
      words: [
        { startS: 16, endS: 16.4, text: 'never', source: 'estimated' as const, confidence: 1 },
        { startS: 16.4, endS: 17, text: 'gonna', source: 'whisper' as const, confidence: 0.55, uncertain: true },
        { startS: 17, endS: 17.6, text: 'stop', source: 'whisper' as const, confidence: 0.75 },
      ],
    }];
    const uncertain = run({ style: 'letra', lyrics: uncertainLyrics, useSpeech: false });
    const phrase = uncertain.on('Legendas').find((clip) => clip.reason === 'Letra da música' && clip.text?.text === 'never gonna stop');
    expect(phrase).toBeDefined();
    expect(phrase!.text!.timingPrecision).toBe('segment');
    expect(uncertain.on('Legendas').some((clip) => clip.reason === 'Palavra da letra')).toBe(false);

    const reliableLyrics = [{
      ...uncertainLyrics[0]!,
      words: [
        { startS: 16, endS: 16.4, text: 'never', source: 'whisper' as const, confidence: 0.95 },
        { startS: 16.4, endS: 17, text: 'gonna', source: 'whisper' as const, confidence: 0.93 },
        { startS: 17, endS: 17.6, text: 'stop', source: 'whisper' as const, confidence: 0.96 },
      ],
    }];
    const reliable = run({ style: 'letra', lyrics: reliableLyrics, useSpeech: false });
    expect(reliable.on('Legendas').filter((clip) => clip.reason === 'Palavra da letra').length).toBeGreaterThan(0);
  });

  it('letra sem tempos por palavra fica como frase única e preserva o tempo cantado exato', () => {
    const lyrics = [{ startS: 30.04, endS: 33.04, text: 'Here we are beneath the moonlight tonight' }];
    const { on } = run({ style: 'hype', lyrics, useSpeech: false });
    const captions = on('Legendas').filter((clip) => clip.reason === 'Letra da música');
    expect(captions).toHaveLength(1);
    expect(captions[0]!.timelineStartUs).toBe(Math.round(14.04 * S));
    expect(captions.every((clip) => clip.text?.animationIn === 'pop' && clip.text.animationOut === 'fade')).toBe(true);
    expect(captions.every((clip) => clip.text?.color === '#fff0a6')).toBe(true);
    expect(captions[0]?.text?.text).toBe(lyrics[0]!.text);
    expect(captions[0]?.text?.timingPrecision).toBe('segment');
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

  it('letra sobre o drop preserva o tempo cantado exato sem ser apagada por impactos visuais', () => {
    // 39,5–40,5 s cruza o drop (24 s na timeline): mantém o tempo cantado exato (23,5–24,5 s)
    const overDrop = run({ style: 'hype', useSpeech: false, lyrics: [{ startS: 39.5, endS: 40.5, text: 'lyrics over drop' }] });
    const line = overDrop.on('Legendas').find((clip) => clip.reason === 'Letra da música');
    expect(line).toBeDefined();
    expect(line!.timelineStartUs).toBe(Math.round(23.5 * S));
    expect(line!.durationUs).toBe(S);

    // linha curta preservada exatamente no tempo cantado sem invadir a próxima
    const tight = run({
      style: 'hype',
      useSpeech: false,
      lyrics: [
        { startS: 39.9, endS: 40.1, text: 'curta' },
        { startS: 40.3, endS: 42, text: 'seguinte' },
      ],
    });
    expect(tight.on('Legendas').some((clip) => clip.text?.text === 'curta')).toBe(true);
    expect(tight.on('Legendas').some((clip) => clip.text?.text === 'seguinte')).toBe(true);

    const lyrics = [{
      startS: 40,
      endS: 42,
      text: 'rise above',
      words: [
        { startS: 40, endS: 40.5, text: 'rise', source: 'ass' as const },
        { startS: 40.5, endS: 41, text: 'above', source: 'ass' as const },
      ],
    }];
    const letter = run({ style: 'letra', lyrics, useSpeech: false });
    const dropWord = letter.on('Legendas').find((clip) => clip.timelineStartUs === 24 * S)!;
    expect(dropWord.text?.text).toBe('RISE');
    expect(dropWord.text?.color).toBe('#fff0a6');
    expect(dropWord.text?.animationIn).toBe('pop');
    expect(dropWord.text?.animationOut).toBe('fade');
  });

  it('discurso: as falas viram frases em unidade, mantêm ducking contínuo sem gangorra e indicam precisão por segmento', () => {
    const { on } = run({ style: 'discurso', durationS: 20 });
    expect(on('Vozes').length).toBeGreaterThan(0);
    expect(on('Música')[0]!.audio.gainDb).toBe(0);
    expect(on('Música')[0]!.audio.duckingMode).toBe('manual');
    expect(on('V1')[0]!.timelineStartUs).toBe(0);
    expect(on('V1')[0]!.audio.gainDb).toBe(-60);
    expect(on('Vozes')[0]!.timelineStartUs).toBe(0);
    expect(evaluateKeyframes(on('Música')[0]!.keyframes['audio.gainDb'], 0, 0)).toBe(-16);
    if (on('Vozes').length >= 2) {
      expect(evaluateKeyframes(on('Música')[0]!.keyframes['audio.gainDb'], clipEndUs(on('Vozes')[0]!) + 150_000, 0)).toBe(-16);
    }
    expect(evaluateKeyframes(
      on('Música')[0]!.keyframes['audio.gainDb'],
      clipEndUs(on('Vozes').at(-1)!) + 250_000,
      0,
    )).toBe(0);
    expect(on('V1').every((c) => c.effects.some((e) => e.effect === 'color' && e.params.saturation === 0))).toBe(true);
    expect(on('Legendas').every((c) => c.text?.timingPrecision === 'segment' && c.text.background === 'none')).toBe(true);
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

describe('ênfase de perfil criativo', () => {
  it('inclui a preferência emocional no motivo do clipe somente com análise confiável', () => {
    const p = project();
    const videoTrackId = p.tracks.find((track) => track.name === 'V1')!.id;
    const ep = episode('ep1', 1, 21);
    const key = shotKey(ep.analysis.shots[0]!.startS);
    const evidence = {
      characters: [],
      fight: false,
      note: '',
      confidence: 0.9,
      emotion: 'tristeza' as const,
    };
    ep.vision = { version: 'v2', model: 'test', shots: { [key]: evidence } };
    const options: GenerateOptions = {
      ...base,
      style: 'emocional',
      durationS: 2,
      musicStartS: 40,
      useSpeech: false,
      focus: 'mix',
      organizationMode: 'free',
      creativeEmphasis: { action: 50, emotion: 100, preferredEmotion: 'tristeza' },
    };
    const result = generateAmv(p, music(), [ep], options);
    const videoClip = result.commands.find((command) =>
      command.type === 'clip.add' && command.clip.trackId === videoTrackId,
    );

    expect(videoClip?.type).toBe('clip.add');
    if (videoClip?.type === 'clip.add') {
      expect(videoClip.clip.reason).toContain('emoção principal do perfil identificada com confiança (tristeza)');
    }

    ep.vision = { ...ep.vision, shots: { [key]: { ...evidence, confidence: 0.4 } } };
    const lowConfidenceResult = generateAmv(p, music(), [ep], options);
    const lowConfidenceClip = lowConfidenceResult.commands.find((command) =>
      command.type === 'clip.add' && command.clip.trackId === videoTrackId,
    );
    expect(lowConfidenceClip?.type).toBe('clip.add');
    if (lowConfidenceClip?.type === 'clip.add') {
      expect(lowConfidenceClip.clip.reason).not.toContain('emoção principal do perfil identificada');
    }
  });
});

describe('melhorias avançadas de AMV', () => {
  it('aplica recorte inteligente focado no personagem pelo centro de massa visual', () => {
    const p = project();
    const ep = episode('ep1', 30, 7);
    ep.analysis.shots[0]!.intensity = 0.95;
    ep.analysis.shots[0]!.tags = ['ação', 'impacto'];
    ep.analysis.shots[0]!.motion = 0.85;
    ep.analysis.shots[0]!.peakS = ep.analysis.shots[0]!.startS + 0.5;
    const key = shotKey(ep.analysis.shots[0]!.startS);
    ep.vision = {
      version: 'v2',
      model: 'teste',
      shots: {
        [key]: {
          characters: ['Goku'],
          action: 'combate',
          fight: true,
          note: 'Luta',
          confidence: 0.9,
          local: {
            version: 3 as const,
            samples: 5,
            lumaGrid: [],
            edgeGrid: [],
            colorHistogram: [],
            brightness: 0.5,
            saturation: 0.5,
            entropy: 0.5,
            edgeDensity: 0.5,
            centerOfVisualMass: [0.65, 0.4],
            temporalMotion: 0.7,
            globalShift: [0, 0],
            globalMotion: 0.5,
            motionEvents: [],
            motionConfidence: 0.8,
            fingerprint: 'fp',
            sceneType: 'action',
            sceneTypeConfidence: 0.9,
          },
        },
      },
    };

    const res = generateAmv(p, music(), [ep], { ...base, durationS: 10, musicStartS: 40 });
    const videoClips = res.commands.flatMap((c) =>
      c.type === 'clip.add' && c.clip.assetId === 'ep1' ? [c.clip] : [],
    );
    const framedClip = videoClips.find((c) => c.reason?.includes('recorte focado no personagem'));
    expect(framedClip).toBeDefined();
    expect(framedClip?.transform.scale).toBeGreaterThan(1);
    expect(framedClip?.transform.x).toBeLessThan(0); // compensa o deslocamento para a direita (0.65 > 0.5)
  });

  it('injeta tradução em português e estilo cinético em legendas de falas', () => {
    const p = project();
    const ep = episode('ep1', 30, 3);
    ep.analysis.subtitles = [
      { startS: 20.8, endS: 23.5, language: 'pt', text: 'Eu jamais vou me render!' },
    ];

    const res = generateAmv(p, music(), [ep], { ...base, durationS: 60, useSpeech: true, showText: true });
    const textTrackId = p.tracks.find((t) => t.kind === 'text')!.id;
    const textClips = res.commands.flatMap((c) =>
      c.type === 'clip.add' && c.clip.trackId === textTrackId ? [c.clip] : [],
    );
    const speechCaption = textClips.find((c) => c.reason?.includes('Legenda da fala'));
    expect(speechCaption).toBeDefined();
    expect(speechCaption?.text?.text).toBe('Eu jamais vou me render!');
    expect(speechCaption?.text?.translations.pt).toBe('Eu jamais vou me render!');
    expect(speechCaption?.text?.gradientStartColor).toBeDefined();
    expect(speechCaption?.text?.glowIntensity).toBeGreaterThan(0);
  });

  it('exibe a tradução automática da fala no idioma solicitado e preserva o original', () => {
    const p = project();
    const ep = episode('ep1', 30, 3);
    ep.analysis.speech = [
      { startS: 21, endS: 23.2, kind: 'fala', confidence: 0.9, text: 'I will never give up!', language: 'en', impact: 0.9 },
    ];
    const result = generateAmv(p, music(), [ep], {
      ...base,
      durationS: 60,
      musicStartS: 16,
      useSpeech: true,
      showText: true,
      voiceMoments: 1,
      speechTranslations: { 'ep1@21': 'Eu nunca vou desistir!' },
      speechTranslationLanguage: 'pt-BR',
    });
    const textTrackId = p.tracks.find((track) => track.kind === 'text')!.id;
    const caption = result.commands.find((command) =>
      command.type === 'clip.add'
        && command.clip.trackId === textTrackId
        && command.clip.reason === 'Legenda da fala',
    );
    expect(caption?.type).toBe('clip.add');
    if (caption?.type !== 'clip.add') throw new Error('Legenda traduzida não foi criada.');
    expect(caption.clip.text?.text).toBe('Eu nunca vou desistir!');
    expect(caption.clip.text?.original).toBe('I will never give up!');
    expect(caption.clip.text?.translations['pt-BR']).toBe('Eu nunca vou desistir!');
    expect(caption.clip.text?.lang).toBe('pt-BR');
  });

  it('aplica efeito de separação RGB (glitch) no drop com impacto visual', () => {
    const p = project();
    const ep = episode('ep1', 30, 3);
    const res = generateAmv(p, music(), [ep], { ...base, durationS: 60, style: 'hype', useEffects: true });
    const v1TrackId = p.tracks.find((t) => t.name === 'V1')!.id;
    const videoClips = res.commands.flatMap((c) =>
      c.type === 'clip.add' && c.clip.trackId === v1TrackId ? [c.clip] : [],
    );
    const dropClip = videoClips.find((c) => c.reason?.includes('Drop em'));
    expect(dropClip).toBeDefined();
    const hasRgbSplit = dropClip?.effects.some((fx) => fx.effect === 'rgb_split');
    expect(hasRgbSplit).toBe(true);
  });
});


describe('integração das melhorias do patch', () => {
  it('preenche slots sem cena planejada apenas com planos que respeitam o limite 0,6×', () => {
    const p = project();
    const ep = episode('ep1', 6, 3);
    const r = generateAmv(p, music(), [ep], {
      ...base, durationS: 60, musicStartS: 16, useSpeech: false,
      organizationMode: 'chronological', focus: 'mix',
    });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const trackId = out.tracks.find((track) => track.name === 'V1')!.id;
    const clips = out.clips.filter((clip) => clip.trackId === trackId)
      .sort((a, b) => a.timelineStartUs - b.timelineStartUs);
    expect(clips.length).toBeGreaterThan(6);
    expect(clips[0]!.timelineStartUs).toBeLessThanOrEqual(S / 30);
    for (let i = 1; i < clips.length; i++) {
      expect(Math.abs(clips[i]!.timelineStartUs - clipEndUs(clips[i - 1]!))).toBeLessThanOrEqual(S / 30);
    }
    expect(clipEndUs(clips[clips.length - 1]!)).toBeGreaterThanOrEqual(59 * S);
    for (const clip of clips) expect(clip.sourceOutUs).toBeLessThanOrEqual(24 * S);
  });

  it('preserva o tempo cantado exato de letras sobre o drop e de versos curtos', () => {
    const r = run({ style: 'hype', useSpeech: false, lyrics: [{ startS: 39.8, endS: 43, text: 'a letra continua durante o drop' }] });
    const line = r.on('Legendas').find((clip) => clip.reason === 'Letra da música');
    expect(line).toBeDefined();
    expect(line!.timelineStartUs).toBe(Math.round(23.8 * S));

    const lyrics = [
      { startS: 20, endS: 20.3, text: 'oi' },
      { startS: 21.5, endS: 23, text: 'segunda linha' },
    ];
    const lines = run({ style: 'hype', useSpeech: false, lyrics }).on('Legendas')
      .filter((clip) => clip.reason === 'Letra da música');
    const first = lines.find((clip) => clip.text?.text === 'oi');
    expect(first).toBeDefined();
    expect(first!.durationUs).toBe(Math.round(0.3 * S));
    const second = lines.find((clip) => clip.text?.text === 'segunda linha');
    if (second) expect(clipEndUs(first!)).toBeLessThanOrEqual(second.timelineStartUs + 1);
  });

  it('aplica estilo tipográfico anime escolhido (anime-neon / anime-gold-epic) nas letras geradas', () => {
    const r = run({
      style: 'hype',
      useSpeech: false,
      lyricStyle: 'anime-neon',
      lyrics: [{ startS: 20, endS: 22, text: 'Break the limits' }],
    });
    const caption = r.on('Legendas').find((clip) => clip.reason === 'Letra da música');
    expect(caption?.text?.text).toBe('BREAK THE LIMITS');
    expect(caption?.text?.fillStyle).toBe('linear-gradient');
    expect(caption?.text?.glowColor).toBe('#00d4ff');
    expect(caption?.text?.glowIntensity).toBeGreaterThanOrEqual(10);
  });

  it('não usa loudness da faixa japonesa para corrigir uma fala renderizada da faixa portuguesa', () => {
    const ep = episode('ep1', 30, 3);
    ep.audioStreams = [
      { index: 1, language: 'jpn', title: 'Japanese' },
      { index: 2, language: 'por', title: 'Português' },
    ];
    ep.analysis.speechAudioStreamIndex = 1;
    for (const speech of ep.analysis.speech) speech.loudnessDb = -8;
    const p = project();
    const portuguese = generateAmv(p, music(), [ep], {
      ...base, style: 'discurso', durationS: 20, musicStartS: 0,
      voiceLang: 'pt', useSpeech: true, showText: false,
    });
    const voiceTrackId = p.tracks.find((track) => track.name === 'Vozes')!.id;
    const ptClips = portuguese.commands.filter((command) =>
      command.type === 'clip.add' && command.clip.trackId === voiceTrackId,
    );
    expect(ptClips.length).toBeGreaterThan(0);
    expect(ptClips.every((command) => command.type === 'clip.add' && command.clip.audio.gainDb === 2)).toBe(true);

    const pOriginal = project();
    const originalVoiceTrackId = pOriginal.tracks.find((track) => track.name === 'Vozes')!.id;
    const original = generateAmv(pOriginal, music(), [ep], {
      ...base, style: 'discurso', durationS: 20, musicStartS: 0,
      voiceLang: 'original', useSpeech: true, showText: false,
    });
    const originalClips = original.commands.filter((command) =>
      command.type === 'clip.add' && command.clip.trackId === originalVoiceTrackId,
    );
    expect(originalClips.length).toBeGreaterThan(0);
    expect(originalClips.every((command) => command.type === 'clip.add' && command.clip.audio.gainDb === -2)).toBe(true);
  });

  it('voiceGainDb limita a correção e mantém o ganho antigo quando não há medição', () => {
    expect(voiceGainDb(2, undefined)).toBe(2);
    expect(voiceGainDb(2, -18)).toBe(2);
    expect(voiceGainDb(2, -10)).toBeLessThan(2);
    expect(voiceGainDb(2, -30)).toBe(6);
    expect(voiceGainDb(3, -2)).toBe(-1);
  });

  it('aplica movimento discreto em planos longos e respeita useEffects=false', () => {
    const animated = run({ useEffects: true, durationS: 40, useSpeech: false }).on('V1');
    expect(animated.some((clip) => (clip.keyframes['transform.scale']?.length ?? 0) >= 2)).toBe(true);
    const noEffects = run({ useEffects: false, durationS: 40, useSpeech: false }).on('V1');
    expect(noEffects.some((clip) => (clip.keyframes['transform.scale']?.length ?? 0) >= 2)).toBe(false);
  });

  it('snap dos slots mantém todos os cortes na grade de frames mesmo com BPM 138', () => {
    const m = music();
    const step = 60 / 138;
    const beats = Array.from({ length: 200 }, (_, i) => i * step);
    m.analysis = { ...m.analysis, bpm: 138, beats, downbeats: beats.filter((_, i) => i % 4 === 0) };
    const p = project();
    const r = generateAmv(p, m, [episode('ep1', 150, 3), episode('ep2', 150, 51)], {
      ...base, durationS: 30, musicStartS: 0, useSpeech: false,
    });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const trackId = out.tracks.find((track) => track.name === 'V1')!.id;
    const clips = out.clips.filter((clip) => clip.trackId === trackId);
    const frameUs = S / 30;
    expect(clips.length).toBeGreaterThan(10);
    for (const clip of clips) {
      expect(Math.abs(clip.timelineStartUs / frameUs - Math.round(clip.timelineStartUs / frameUs))).toBeLessThan(0.02);
    }
  });

  it('reserva cenas quase pretas e só as usa quando não há alternativa', () => {
    const ep = episode('ep1', 150, 3);
    ep.analysis.shots.forEach((shot, i) => {
      if (i % 2 === 0) { shot.brightness = 0.04; shot.tags = [...shot.tags, 'escura']; }
    });
    const p = project();
    const r = generateAmv(p, music(), [ep], { ...base, durationS: 30, musicStartS: 0, useSpeech: false, focus: 'mix' });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const trackId = out.tracks.find((track) => track.name === 'V1')!.id;
    const clips = out.clips.filter((clip) => clip.trackId === trackId);
    expect(clips.length).toBeGreaterThan(5);
    for (const clip of clips) expect(Math.floor(clip.sourceInUs / S / 4) % 2).toBe(1);

    const onlyDark = episode('ep2', 30, 9);
    onlyDark.analysis.shots.forEach((shot) => {
      shot.brightness = 0.04;
      shot.tags = [...shot.tags, 'escura'];
    });
    const fallback = generateAmv(project(), music(), [onlyDark], {
      ...base, durationS: 20, musicStartS: 0, useSpeech: false, focus: 'mix',
    });
    expect(fallback.summary.clips).toBeGreaterThan(0);
    expect(fallback.warnings.join(' ')).toMatch(/muito escuras/);
  });

  it('levanta discretamente exposição de cenas escuras utilizáveis', () => {
    const ep = episode('ep1', 150, 3);
    for (const shot of ep.analysis.shots) shot.brightness = 0.15;
    const p = project();
    const r = generateAmv(p, music(), [ep], { ...base, durationS: 20, musicStartS: 0, useSpeech: false, focus: 'mix' });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const trackId = out.tracks.find((track) => track.name === 'V1')!.id;
    const clips = out.clips.filter((clip) => clip.trackId === trackId);
    expect(clips.length).toBeGreaterThan(3);
    expect(clips.every((clip) => clip.effects.some((effect) =>
      effect.effect === 'color' && Number(effect.params.exposure ?? 0) > 0,
    ))).toBe(true);
  });

  it('exibe legenda PT embutida em anime com áudio japonês (não apaga legenda por idioma diferente)', () => {
    const ep = episode('ep1', 40, 3);
    ep.audioStreams = [{ index: 1, language: 'jpn', title: 'Japanese' }];
    ep.analysis.speech = [
      { startS: 12, endS: 14, kind: 'fala', confidence: 0.9, text: 'Eu vou superar meus limites!', language: 'por', impact: 0.95 },
    ];
    const p = project();
    const r = generateAmv(p, music(), [ep], {
      ...base, durationS: 60, musicStartS: 16, useSpeech: true, showText: true, voiceLang: 'original', voiceMoments: 1,
    });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const textTrack = out.tracks.find((t) => t.kind === 'text')!;
    const captions = out.clips.filter((c) => c.trackId === textTrack.id);
    expect(captions.some((c) => c.text?.text === 'Eu vou superar meus limites!')).toBe(true);
  });

  it('filtro de personagem e luta escolhida à mão nunca misturam falas de outro personagem ou outra luta', () => {
    const ep = episode('ep1', 100, 3);
    ep.analysis.sequences = [
      { id: 'f1', kind: 'luta', startS: 0, endS: 40, intensity: 0.8, peak: 0.9, shotCount: 10 },
      { id: 'f2', kind: 'luta', startS: 60, endS: 100, intensity: 0.85, peak: 0.95, shotCount: 10 },
    ];
    ep.analysis.speech = [
      { startS: 12, endS: 14, kind: 'fala', confidence: 0.9, text: 'Fala da Luta 1', language: 'por', impact: 0.6 },
      { startS: 72, endS: 74, kind: 'fala', confidence: 0.9, text: 'Fala da Luta 2', language: 'por', impact: 0.99 },
    ];
    ep.vision = {
      version: 'v2',
      model: 'test',
      shots: Object.fromEntries(ep.analysis.shots.map((sh) => [
        shotKey(sh.startS),
        {
          characters: sh.startS < 50 ? ['Naruto'] : ['Sasuke'],
          fight: true,
          action: 'combate' as const,
          confidence: 0.9,
          note: '',
        },
      ])),
    };
    const p = project();
    const r = generateAmv(p, music(), [ep], {
      ...base,
      durationS: 30,
      musicStartS: 20,
      focus: 'fight',
      sequenceIds: ['ep1#f1'],
      characters: ['Naruto'],
      useSpeech: true,
      showText: true,
      voiceMoments: 2,
    });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const v1 = out.tracks.find((t) => t.name === 'V1')!;
    const videoClips = out.clips.filter((c) => c.trackId === v1.id);
    expect(videoClips.length).toBeGreaterThan(0);
    // Nenhuma cena nem fala pode vazar da Luta 2 / Sasuke (>= 50s)
    expect(videoClips.every((c) => c.sourceInUs < 50 * S)).toBe(true);
    const textTrack = out.tracks.find((t) => t.kind === 'text')!;
    const captions = out.clips.filter((c) => c.trackId === textTrack.id);
    expect(captions.some((c) => c.text?.text === 'Fala da Luta 2')).toBe(false);
  });

  it('encaixa fala solicitada mesmo em música sem drop e de energia alta', () => {
    const ep = episode('ep1', 40, 3);
    ep.analysis.speech = [
      { startS: 10, endS: 12, kind: 'fala', confidence: 0.9, text: 'Não acabou ainda!', language: 'por', impact: 0.9 },
    ];
    const m = music();
    const highEnergyNoDrop: MusicInput = {
      ...m,
      analysis: {
        ...m.analysis,
        drops: [],
        energy: m.analysis.energy.map(() => 0.8),
      },
    };
    const p = project();
    const r = generateAmv(p, highEnergyNoDrop, [ep], {
      ...base, durationS: 20, musicStartS: 0, useSpeech: true, showText: true, voiceMoments: 1,
    });
    expect(r.summary.voices).toBe(1);
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const textTrack = out.tracks.find((t) => t.kind === 'text')!;
    expect(out.clips.some((c) => c.trackId === textTrack.id && c.text?.text === 'Não acabou ainda!')).toBe(true);
  });

  it('aplica tipografia anime nas falas escolhidas e encaixa múltiplas falas mesmo com energia alta', () => {
    const ep = episode('ep1', 60, 3);
    ep.analysis.speech = [
      { startS: 10, endS: 11.8, kind: 'fala', confidence: 0.9, text: 'Primeiro golpe!', language: 'por', impact: 0.9 },
      { startS: 22, endS: 23.6, kind: 'fala', confidence: 0.9, text: 'Agora vai começar!', language: 'por', impact: 0.85 },
    ];
    const m = music();
    const highEnergy: MusicInput = {
      ...m,
      analysis: {
        ...m.analysis,
        energy: m.analysis.energy.map(() => 0.82),
      },
    };
    const p = project();
    const r = generateAmv(p, highEnergy, [ep], {
      ...base,
      durationS: 30,
      musicStartS: 16,
      useSpeech: true,
      showText: true,
      voiceMoments: 2,
      lyricStyle: 'anime-impact',
    });
    expect(r.summary.voices).toBe(2);
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const textTrack = out.tracks.find((t) => t.kind === 'text')!;
    const captions = out.clips.filter((c) => c.trackId === textTrack.id);
    expect(captions).toHaveLength(2);
    expect(captions.every((c) => c.text?.text === c.text?.text.toUpperCase() && c.text?.highlightColor === '#ff5364')).toBe(true);
  });

  it('episódio longo com lutas e falas não cai automaticamente no estilo discurso', () => {
    const ep = episode('ep1', 360, 3); // 24 min
    ep.analysis.sequences = [{ id: 'f1', kind: 'luta', startS: 200, endS: 400, intensity: 0.9, peak: 0.95, shotCount: 40 }];
    ep.analysis.speech = Array.from({ length: 120 }, (_, i) => ({
      startS: i * 10 + 1,
      endS: i * 10 + 3,
      kind: 'fala' as const,
      confidence: 0.9,
      text: `Fala ${i}`,
      impact: 0.5,
    }));
    expect(recommendStyle([ep], music().analysis, false).style).not.toBe('discurso');
  });

  it('showSpeechCaptions=false oculta legenda das falas mantendo letra da música sem caixa preta', () => {
    const ep = episode('ep1', 40, 3);
    ep.analysis.speech = [{ startS: 10, endS: 12, kind: 'fala', confidence: 0.9, text: 'Fala com hardsub', impact: 0.95 }];
    const p = project();
    const r = generateAmv(p, music(), [ep], {
      ...base,
      durationS: 30,
      musicStartS: 16,
      useSpeech: true,
      showText: true,
      showSpeechCaptions: false,
      lyrics: [{ startS: 20, endS: 23, text: 'Cantar com estilo' }],
    });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const textTrack = out.tracks.find((t) => t.kind === 'text')!;
    const captions = out.clips.filter((c) => c.trackId === textTrack.id);
    expect(captions.some((c) => c.reason === 'Legenda da fala')).toBe(false);
    expect(captions.some((c) => c.text?.text === 'Cantar com estilo' && c.text.background === 'none')).toBe(true);
  });

  it('lyricDisplayMode=kinetic-words divide versos em explosões cinéticas de 1-2 palavras no centro com glow e pop', () => {
    const ep = episode('ep1', 40, 3);
    const p = project();
    const r = generateAmv(p, music(), [ep], {
      ...base,
      durationS: 30,
      musicStartS: 16,
      useSpeech: false,
      showText: true,
      lyricStyle: 'anime-impact',
      lyricDisplayMode: 'kinetic-words',
      lyrics: [{ startS: 20, endS: 22.4, text: 'Nunca vou desistir agora' }],
    });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const textTrack = out.tracks.find((t) => t.kind === 'text')!;
    const lyricClips = out.clips
      .filter((c) => c.trackId === textTrack.id)
      .sort((a, b) => a.timelineStartUs - b.timelineStartUs);
    expect(lyricClips.length).toBeGreaterThanOrEqual(2);
    expect(lyricClips.every((c) => c.transform.y === 0 && c.text?.background === 'none')).toBe(true);
    expect(lyricClips.every((c) => (c.text?.glowIntensity ?? 0) > 0)).toBe(true);
    expect(lyricClips.some((c) => (c.keyframes['transform.scale']?.length ?? 0) >= 2)).toBe(true);
    const combined = lyricClips.map((c) => c.text?.text).join(' ');
    expect(combined).toContain('DESISTIR');
  });

  it('speechVisualMode=voiceover narra por cima dos cortes de ação em V1 (antes e depois do drop) com tipografia por palavra', () => {
    const ep = episode('ep1', 120, 3);
    ep.analysis.speech = [
      { startS: 10, endS: 12, kind: 'fala', confidence: 0.9, text: 'Nunca vou recuar agora', language: 'por', impact: 0.92 },
      { startS: 30, endS: 32, kind: 'grito', confidence: 0.9, text: 'Hora de superar tudo', language: 'por', impact: 0.95 },
      { startS: 50, endS: 52, kind: 'fala', confidence: 0.9, text: 'Esse é meu limite', language: 'por', impact: 0.88 },
    ];
    const p = project();
    const r = generateAmv(p, music(), [ep], {
      ...base,
      durationS: 36,
      musicStartS: 16, // drop está em 40s (24s do vídeo)
      useSpeech: true,
      voiceMoments: 3,
      speechVisualMode: 'voiceover',
      showText: true,
      lyricStyle: 'anime-impact',
    });
    expect(r.summary.voices).toBe(3);
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    expect(findOverlaps(out)).toEqual([]);
    const v1 = out.clips.filter((c) => c.trackId === out.tracks.find((t) => t.name === 'V1')!.id);
    const voices = out.clips.filter((c) => c.trackId === out.tracks.find((t) => t.name === 'Vozes')!.id).sort((a, b) => a.timelineStartUs - b.timelineStartUs);
    const captions = out.clips.filter((c) => c.trackId === out.tracks.find((t) => t.kind === 'text')!.id);
    expect(voices).toHaveLength(3);
    // Nenhuma cena de V1 usa o motivo estático de fala; os cortes seguem a música do início ao fim.
    expect(v1.some((c) => c.reason?.includes('Fala marcante') || c.reason?.includes('Fala intercalada'))).toBe(false);
    expect(voices.some((v) => v.timelineStartUs / S >= r.summary.drop!)).toBe(true);
    expect(captions).toHaveLength(3);
    expect(captions.every((c) => c.text?.timingPrecision === 'word' && (c.text.wordTimings?.length ?? 0) >= 3 && c.text.wordAnimation === 'pop')).toBe(true);
  });

  it('diferencia visualmente letra da música e legenda de fala quando ambas aparecem no mesmo AMV', () => {
    const ep = episode('ep1', 120, 3);
    ep.analysis.speech = [
      { startS: 10, endS: 12, kind: 'fala', confidence: 0.92, text: 'Eu não vou perder aqui', language: 'por', impact: 0.95 },
    ];
    let p = project();
    for (const [sid, dur] of [['sfx-impact', 1.4], ['sfx-hit', 0.32], ['sfx-clash', 0.34], ['sfx-whoosh', 0.6], ['sfx-riser', 2]] as const) {
      p = applyCommand(p, {
        type: 'asset.add',
        asset: {
          id: sid, name: sid, path: `/m/${sid}`, hash: sid, kind: 'audio', status: 'ok', error: null, importedAt: '', tags: ['sfx'], favorite: false,
          probe: { container: 'wav', durationUs: Math.round(dur * S), sizeBytes: 1, bitRate: null, video: null, audio: [{ index: 0, codec: 'pcm_s16le', sampleRate: 48000, channels: 1, channelLayout: null, language: null, title: null }], subtitles: [], tags: {} },
        },
      }).project;
    }
    const r = generateAmv(p, music(), [ep], {
      ...base,
      hitSync: true,
      durationS: 20,
      musicStartS: 26, // drop em 40s (14s no vídeo)
      useSpeech: true,
      voiceMoments: 1,
      showText: true,
      lyricStyle: 'anime-impact',
      lyrics: [
        { startS: 28, endS: 30, text: 'Rise up into the fire' },
        { startS: 41, endS: 43, text: 'Never back down now' },
      ],
    });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const textTrack = out.tracks.find((t) => t.kind === 'text')!;
    const textClips = out.clips.filter((c) => c.trackId === textTrack.id);
    const speechClip = textClips.find((c) => /legenda da fala/i.test(c.reason ?? ''));
    const lyricClip = textClips.find((c) => /letra da música|palavra da letra/i.test(c.reason ?? ''));
    expect(speechClip).toBeDefined();
    expect(lyricClip).toBeDefined();
    // Fala e letra devem ter posição vertical, fonte, itálico e cor distintos (sem caixa preta feia)
    expect(speechClip!.transform.y).not.toBe(lyricClip!.transform.y);
    expect(speechClip!.text?.font).not.toBe(lyricClip!.text?.font);
    expect(speechClip!.text?.italic).toBe(true);
    expect(lyricClip!.text?.italic).toBe(false);
    expect(lyricClip!.text?.background).toBe('none');
  });

  it('subdivide planos longos para evitar repetir exatamente o mesmo recorte', () => {
    const ep: EpisodeInput = {
      assetId: 'ep1',
      name: 'ep1.mp4',
      hasAudio: true,
      analysis: {
        version: 'e4',
        durationS: 40,
        shots: [
          { startS: 0, endS: 12, intensity: 0.85, motion: 0.8, loud: 0.7, peakS: 6, brightness: 0.55, line: null, tags: ['ação', 'impacto'] },
          { startS: 12, endS: 24, intensity: 0.82, motion: 0.8, loud: 0.7, peakS: 18, brightness: 0.58, line: null, tags: ['ação', 'impacto'] },
          { startS: 24, endS: 36, intensity: 0.88, motion: 0.85, loud: 0.75, peakS: 30, brightness: 0.52, line: null, tags: ['ação', 'impacto'] },
        ],
        speech: [],
        subtitles: [],
        intensityCurve: [],
        curveStepS: 0.5,
        sequences: [{ id: 's1', kind: 'luta', startS: 0, endS: 36, intensity: 0.85, peak: 0.9, shotCount: 3 }],
      },
    };
    const p = project();
    const r = generateAmv(p, music(), [ep], {
      ...base,
      durationS: 12,
      musicStartS: 36,
      useSpeech: false,
      showText: false,
    });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const v1 = out.clips.filter((c) => c.trackId === out.tracks.find((t) => t.name === 'V1')!.id);
    const distinctStarts = new Set(v1.map((c) => Math.round(c.sourceInUs / 500_000)));
    expect(v1.length).toBeGreaterThanOrEqual(4);
    expect(distinctStarts.size).toBeGreaterThanOrEqual(4);
  });

  it('emite aviso quando a música tem andamento variável', () => {
    const m = music();
    m.analysis.tempoVariable = true;
    const r = generateAmv(project(), m, [episode('ep1', 120, 3)], { ...base, durationS: 10 });
    expect(r.warnings.some((w) => /andamento variável/i.test(w))).toBe(true);
  });

  it('aplica isolamento vocal + eco pré-drop na fala e cria destaque V2 com letra atrás no drop', () => {
    const ep = episode('ep1', 120, 3);
    ep.analysis.speech = [
      { startS: 10, endS: 12, kind: 'fala', confidence: 0.95, text: 'Agora tudo acaba aqui!', language: 'por', impact: 0.96 },
    ];
    let p = project();
    for (const [sid, dur] of [['sfx-impact', 1.4], ['sfx-hit', 0.32], ['sfx-clash', 0.34], ['sfx-whoosh', 0.6], ['sfx-riser', 2]] as const) {
      p = applyCommand(p, {
        type: 'asset.add',
        asset: {
          id: sid, name: sid, path: `/m/${sid}`, hash: sid, kind: 'audio', status: 'ok', error: null, importedAt: '', tags: ['sfx'], favorite: false,
          probe: { container: 'wav', durationUs: Math.round(dur * S), sizeBytes: 1, bitRate: null, video: null, audio: [{ index: 0, codec: 'pcm_s16le', sampleRate: 48000, channels: 1, channelLayout: null, language: null, title: null }], subtitles: [], tags: {} },
        },
      }).project;
    }
    const r = generateAmv(p, music(), [ep], {
      ...base,
      hitSync: true,
      durationS: 20,
      musicStartS: 26, // drop em 40s => 14s na timeline
      useSpeech: true,
      voiceMoments: 1,
      showText: true,
      useEffects: true,
      depthCutoutOnDrop: true,
      lyrics: [{ startS: 39.8, endS: 41.2, text: 'EXPLODE O LIMITE' }],
    });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const voiceTrack = out.tracks.find((t) => t.name === 'Vozes')!;
    const v2Track = out.tracks.find((t) => t.name === 'V2')!;
    const textTrack = out.tracks.find((t) => t.kind === 'text')!;
    const voiceClip = out.clips.find((c) => c.trackId === voiceTrack.id);
    const v2Clips = out.clips.filter((c) => c.trackId === v2Track.id);
    const behindLyric = out.clips.find((c) => c.trackId === textTrack.id && c.text?.behindCutout);

    expect(voiceClip?.audio.voiceIsolation).toBe(true);
    expect(voiceClip?.audio.echoTail).toBe(true);
    expect(v2Clips.length).toBeGreaterThanOrEqual(1);
    expect(v2Clips[0]!.mask).toBe('subject-focus');
    expect(behindLyric).toBeDefined();
  });

  it('sincroniza cores da tipografia com dominantColors da cena, mescla anime-blend, prioriza fala legendada, aplica fade_in/fade_out e sfxMode hits-only', () => {
    const ep = episode('ep1', 120, 2);
    ep.analysis.speech = [
      // Grito sem texto (ruído) com impacto alto vs fala real legendada: deve escolher a fala legendada
      { startS: 8, endS: 9.8, kind: 'grito', confidence: 0.98, text: null, impact: 0.99 },
      { startS: 12, endS: 14.2, kind: 'fala', confidence: 0.9, text: 'Esse golpe vai decidir tudo!', language: 'por', impact: 0.85 },
    ];
    for (const sh of ep.analysis.shots) {
      sh.tags = ['ação', 'impacto'];
      sh.motion = 0.82;
      sh.peakS = sh.startS;
    }
    const firstKey = shotKey(ep.analysis.shots[0]!.startS);
    ep.vision = {
      version: 'v2',
      model: 'local',
      shots: Object.fromEntries(
        ep.analysis.shots.slice(0, 25).map((sh) => [
          shotKey(sh.startS),
          {
            characters: ['Shinra'],
            action: 'combate' as const,
            fight: true,
            note: 'Fogo intenso',
            confidence: 0.9,
            local: {
              version: 3 as const,
              samples: 4,
              lumaGrid: [],
              edgeGrid: [],
              colorHistogram: [],
              dominantColors: ['#ff5500', '#221108'],
              brightness: 0.62,
              saturation: 0.78,
              entropy: 0.6,
              edgeDensity: 0.5,
              centerOfVisualMass: [0.5, 0.4],
              subjectFocus: [0.5, 0.36] as [number, number],
              subjectFocusConfidence: 0.85,
              temporalMotion: 0.8,
              globalShift: [0, 0] as [number, number],
              globalMotion: 0.5,
              motionEvents: [],
              motionConfidence: 0.8,
              fingerprint: firstKey,
              sceneType: 'action' as const,
              sceneTypeConfidence: 0.9,
            },
          },
        ]),
      ),
    };
    let p = project();
    for (const [sid, dur] of [['sfx-impact', 1.4], ['sfx-hit', 0.32], ['sfx-clash', 0.34], ['sfx-whoosh', 0.6], ['sfx-riser', 2]] as const) {
      p = applyCommand(p, {
        type: 'asset.add',
        asset: {
          id: sid, name: sid, path: `/m/${sid}`, hash: sid, kind: 'audio', status: 'ok', error: null, importedAt: '', tags: ['sfx'], favorite: false,
          probe: { container: 'wav', durationUs: Math.round(dur * S), sizeBytes: 1, bitRate: null, video: null, audio: [{ index: 0, codec: 'pcm_s16le', sampleRate: 48000, channels: 1, channelLayout: null, language: null, title: null }], subtitles: [], tags: {} },
        },
      }).project;
    }
    const r = generateAmv(p, music(), [ep], {
      ...base,
      hitSync: true,
      durationS: 20,
      musicStartS: 26,
      useSpeech: true,
      voiceMoments: 1,
      showText: true,
      showSpeechCaptions: true,
      useEffects: true,
      useSfx: true,
      sfxMode: 'hits-only',
      animeHitAudio: true,
      sfxAssets: { impact: 'sfx-impact', hit: 'sfx-hit', clash: 'sfx-clash', whoosh: 'sfx-whoosh', riser: 'sfx-riser' },
      lyricStyle: 'anime-blend',
      lyrics: [{ startS: 30, endS: 32, text: 'Chama imortal' }],
    });
    const out = applyCommand(p, { type: 'batch', commands: r.commands }).project;
    const v1Track = out.tracks.find((t) => t.name === 'V1')!;
    const textTrack = out.tracks.find((t) => t.kind === 'text')!;
    const sfxTrack = out.tracks.find((t) => t.name === 'Efeitos')!;
    const voiceTrack = out.tracks.find((t) => t.name === 'Vozes')!;

    const v1Clips = out.clips.filter((c) => c.trackId === v1Track.id).sort((a, b) => a.timelineStartUs - b.timelineStartUs);
    expect(v1Clips[0]!.effects.some((e) => e.effect === 'fade_in')).toBe(true);
    expect(v1Clips.at(-1)!.effects.some((e) => e.effect === 'fade_out')).toBe(true);

    const speechCap = out.clips.find((c) => c.trackId === textTrack.id && c.reason === 'Legenda da fala');
    expect(speechCap?.text?.text).toBe('Esse golpe vai decidir tudo!');
    expect(speechCap?.text?.background).toBe('none');

    const lyricCap = out.clips.find((c) => c.trackId === textTrack.id && /letra da música/i.test(c.reason ?? ''));
    expect(lyricCap?.blendMode).toBe('difference');
    expect(lyricCap?.text?.fillStyle).toBe('hollow');
    expect(lyricCap?.text?.glowColor).not.toBe('#ffffff'); // sincronizou com o laranja dominante da cena

    const sfxClips = out.clips.filter((c) => c.trackId === sfxTrack.id);
    expect(sfxClips.some((c) => c.assetId === 'sfx-whoosh' || c.assetId === 'sfx-riser')).toBe(false);
    expect(sfxClips.some((c) => c.assetId === 'sfx-hit' || c.assetId === 'sfx-clash')).toBe(true);
    const animeHitBursts = out.clips.filter((c) => c.trackId === voiceTrack.id && c.label === 'Golpe anime');
    expect(animeHitBursts.length).toBeGreaterThan(0);
  });
});
