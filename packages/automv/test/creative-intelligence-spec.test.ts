import { describe, expect, it } from 'vitest';
import {
  analyzeEpisodeScenes,
  analyzeMusicUnderstanding,
  CreativeAnalysisCache,
  shotKey,
  type Cue,
  type EpisodeAnalysis,
  type EpisodeVision,
  type MusicAnalysis,
} from '@amv/analysis';
import { applyCommand, clipEndUs, createProject, type Asset, type Project } from '@amv/project';
import {
  advanceNarrativeMemory,
  buildCreativeDirectionPlan,
  createInitialNarrativeMemory,
  evaluateContinuityRelation,
  evaluateGlobalAmvQuality,
  evaluateSemanticAlignment,
  explainEditorialDecision,
  findAlternativeScenesForPhrase,
  generateAmv,
  generateBestAmv,
  prepareCreativeDirectionSession,
  rankScenesForMusicEvent,
  solveGlobalEditorialDecisions,
  type EditorialDecision,
  type EpisodeInput,
} from '../src/index.js';

const S = 1_000_000;

function makeAsset(id: string, kind: Asset['kind'], hash: string, durationS: number): Asset {
  return {
    id,
    name: `${id}.${kind === 'video' ? 'mkv' : 'm4a'}`,
    path: `/media/${id}.${kind === 'video' ? 'mkv' : 'm4a'}`,
    hash,
    kind,
    status: 'ok',
    error: null,
    importedAt: '2026-01-01T00:00:00.000Z',
    tags: [],
    favorite: false,
    probe: {
      container: kind === 'video' ? 'matroska' : 'mp4',
      durationUs: durationS * S,
      sizeBytes: 1024,
      bitRate: 1000,
      video: kind === 'video'
        ? {
            codec: 'h264',
            profile: 'High',
            width: 1920,
            height: 1080,
            pixFmt: 'yuv420p',
            bitDepth: 8,
            fps: { num: 24, den: 1 },
            avgFps: { num: 24, den: 1 },
            vfr: false,
            frameCount: durationS * 24,
          }
        : null,
      audio: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: 'stereo', language: 'jpn', title: null }],
      subtitles: [],
      tags: {},
    },
  };
}

function buildMultiEpisodeFixture() {
  let project: Project = createProject({
    name: 'Spec A-L Suite',
    settings: { width: 1920, height: 1080, fps: { num: 24, den: 1 } },
  });
  for (const a of [
    makeAsset('mus1', 'audio', 'hash-music-main', 32),
    makeAsset('ep1', 'video', 'hash-ep-01', 90),
    makeAsset('ep2', 'video', 'hash-ep-02', 90),
    makeAsset('ep3', 'video', 'hash-ep-03', 90),
  ]) {
    project = applyCommand(project, { type: 'asset.add', asset: a }).project;
  }

  const makeEp = (id: string, name: string, idx: number): EpisodeInput => {
    const extraFightShots = Array.from({ length: 6 }, (_, k) => {
      const s = 51 + k * 3.5;
      return {
        startS: s,
        endS: s + 3.2,
        motion: 0.68 + (k % 3) * 0.08,
        loud: 0.72,
        intensity: 0.74 + (k % 3) * 0.07,
        brightness: 0.52,
        tags: (k % 2 === 0 ? ['ação', 'impacto'] : ['ação']) as EpisodeAnalysis['shots'][number]['tags'],
        line: null,
        peakS: Number((s + 0.04).toFixed(2)),
      };
    });
    const analysis: EpisodeAnalysis = {
      version: 'e4',
      durationS: 90,
      shots: [
        { startS: 4, endS: 9.5, motion: 0.12, loud: 0.25, intensity: 0.24, brightness: 0.48, tags: ['calma'], line: idx === 0 ? 'Lembro daquela promessa na infância.' : null, peakS: 6.2 },
        { startS: 14, endS: 19, motion: 0.25, loud: 0.55, intensity: 0.54, brightness: 0.46, tags: ['fala'], line: idx === 0 ? 'Mesmo ferido, eu nunca vou desistir dessa promessa!' : 'Prepare-se!', peakS: 16.5 },
        { startS: 28, endS: 33, motion: 0.72, loud: 0.75, intensity: 0.78, brightness: 0.52, tags: ['ação'], line: null, peakS: 28.04 },
        { startS: 45, endS: 50, motion: 0.86, loud: 0.9, intensity: 0.91, brightness: 0.56, tags: ['ação', 'impacto', 'clarão'], line: null, peakS: 45.04 },
        ...extraFightShots,
        { startS: 74, endS: 80, motion: idx === 2 ? 0.9 : 0.2, loud: idx === 2 ? 0.94 : 0.3, intensity: idx === 2 ? 0.95 : 0.35, brightness: idx === 2 ? 0.58 : 0.38, tags: idx === 2 ? ['ação', 'impacto', 'clarão'] : ['calma'], line: null, peakS: 74.04 },
      ],
      sequences: [
        { id: 's140', startS: 14, endS: 72, kind: 'luta', intensity: 0.8, peak: 0.91, shotCount: 9 },
      ],
      speech: idx === 0
        ? [
            { startS: 4.3, endS: 8.8, kind: 'fala', confidence: 0.92, text: 'Lembro daquela promessa na infância.', impact: 0.62 },
            { startS: 14.2, endS: 18.4, kind: 'fala', confidence: 0.95, text: 'Mesmo ferido, eu nunca vou desistir dessa promessa!', impact: 0.88 },
          ]
        : [],
      subtitles: [],
      intensityCurve: [],
      curveStepS: 1,
    };

    const vision: EpisodeVision = {
      version: 'v2',
      model: 'spec-vlm',
      shots: {
        [shotKey(4)]: {
          characters: ['Shin'],
          fight: false,
          note: idx === 0 ? 'Flashback de infância olhando o céu ao pôr do sol em despedida' : 'Paisagem silenciosa contemplativa',
          emotion: 'tristeza',
          action: 'contemplação',
          confidence: 0.9,
          framing: 'wide',
        },
        [shotKey(14)]: {
          characters: ['Shin'],
          fight: true,
          note: idx === 0
            ? 'Personagem ferido e ajoelhado encarando o rival com olhar de determinação'
            : 'Postura de preparação empunhando a espada',
          emotion: 'determinação',
          action: 'preparação',
          confidence: 0.91,
          framing: 'close-up',
        },
        [shotKey(28)]: {
          characters: ['Shin'],
          fight: true,
          note: 'Ataque veloz de espada avançando da esquerda para a direita',
          emotion: 'determinação',
          action: 'combate',
          confidence: 0.9,
          framing: 'medium',
          local: {
            version: 3,
            samples: 2,
            lumaGrid: Array(64).fill(0.5),
            edgeGrid: Array(16).fill(0.4),
            colorHistogram: Array(12).fill(0.25),
            dominantColors: ['#fb923c'],
            brightness: 0.52,
            saturation: 0.6,
            entropy: 0.68,
            edgeDensity: 0.18,
            centerOfVisualMass: [0.5, 0.5],
            temporalMotion: 0.64,
            globalShift: [0.1, 0],
            globalMotion: 0.65,
            motionEvents: [{
              startS: 28.2,
              endS: 32,
              cameraMotion: 'pan-horizontal',
              directionDeg: 6,
              speed: 0.55,
              scaleSpeed: 0,
              confidence: 0.88,
              subjectMotion: { directionDeg: 6, speed: 0.6, confidence: 0.86 },
              apparentScaleChange: 'none',
              abruptFramingChange: false,
            }],
            motionConfidence: 0.88,
            fingerprint: `fp-${id}-28`,
            sceneType: 'action',
            sceneTypeConfidence: 0.88,
          },
        },
        [shotKey(45)]: {
          characters: ['Shin', 'Raizen'],
          fight: true,
          note: 'Golpe de espada em chamas com explosão de fogo e contra-ataque direto',
          emotion: 'raiva',
          action: 'combate',
          confidence: 0.93,
          framing: 'close-up',
          local: {
            version: 3,
            samples: 2,
            lumaGrid: Array(64).fill(0.6),
            edgeGrid: Array(16).fill(0.5),
            colorHistogram: Array(12).fill(0.25),
            dominantColors: ['#ef4444', '#f97316'],
            brightness: 0.62,
            saturation: 0.72,
            entropy: 0.74,
            edgeDensity: 0.22,
            centerOfVisualMass: [0.5, 0.5],
            temporalMotion: 0.78,
            globalShift: [0, 0],
            globalMotion: 0.75,
            motionEvents: [{
              startS: 45.2,
              endS: 49,
              cameraMotion: 'zoom-in',
              directionDeg: null,
              speed: 0.5,
              scaleSpeed: 0.22,
              confidence: 0.9,
              subjectMotion: { directionDeg: null, speed: 0.5, confidence: 0.85 },
              apparentScaleChange: 'in',
              abruptFramingChange: false,
            }],
            motionConfidence: 0.9,
            fingerprint: `fp-${id}-45`,
            sceneType: 'action',
            sceneTypeConfidence: 0.92,
          },
        },
        [shotKey(74)]: {
          characters: idx === 2 ? ['Shin', 'Raizen'] : ['Shin'],
          fight: idx === 2,
          note: idx === 2
            ? 'Revelação e transformação suprema no confronto final do episódio 3'
            : 'Herói caído derrotado na chuva escura após a batalha',
          emotion: idx === 2 ? 'determinação' : 'tristeza',
          action: idx === 2 ? 'combate' : 'reação',
          confidence: 0.92,
          framing: 'close-up',
        },
      },
    };

    return {
      assetId: id,
      name,
      analysis,
      hasAudio: true,
      sourceFps: { num: 24, den: 1 },
      variableFrameRate: false,
      vision,
    };
  };

  const episodes = [
    makeEp('ep1', 'Episódio 01', 0),
    makeEp('ep2', 'Episódio 02', 1),
    makeEp('ep3', 'Episódio 03', 2),
  ];

  const bpm = 128;
  const period = 60 / bpm;
  const beats = Array.from({ length: 68 }, (_, i) => Number((i * period).toFixed(3)));
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const musicAnalysis: MusicAnalysis = {
    version: 'm6',
    durationS: 32,
    bpm,
    bpmConfidence: 0.92,
    beats,
    downbeats,
    energy: Array.from({ length: 128 }, (_, i) => {
      const t = i * 0.25;
      return t < 8 ? 0.24 : t < 16 ? 0.52 : t < 26 ? 0.9 : 0.28;
    }),
    energyStepS: 0.25,
    sections: [
      { startS: 0, endS: 8, label: 'intro', energy: 0.24 },
      { startS: 8, endS: 16, label: 'pré-refrão', energy: 0.52 },
      { startS: 16, endS: 26, label: 'drop', energy: 0.9 },
      { startS: 26, endS: 32, label: 'final', energy: 0.28 },
    ],
    drops: [16],
    events: [
      { atS: 8, type: 'growth', durationS: 8, confidence: 0.85, strength: 0.45 },
      { atS: 16, type: 'drop', confidence: 0.94, strength: 0.7 },
      { atS: 27, type: 'pause', durationS: 1.4, confidence: 0.8, strength: 0.8 },
    ],
    intensity: 76,
    loudnessDb: -11.5,
    meter: 4,
  };

  const lyrics: Cue[] = [
    { startS: 1.0, endS: 6.5, text: 'Sozinho lembrando o passado distante em despedida' },
    { startS: 9.0, endS: 14.5, text: 'Mesmo sangrando eu vou continuar de pé' },
    {
      startS: 16.2,
      endS: 23.5,
      text: 'Minha espada em chamas corta na batalha!',
      words: [{ text: 'espada', startS: 17.1, endS: 17.6, source: 'lrc', confidence: 0.96 }],
    },
    { startS: 24.0, endS: 28.0, text: 'A vitória e a glória brilham no topo da coroa' },
  ];

  return {
    project,
    episodes,
    music: { assetId: 'mus1', name: 'mus1.m4a', analysis: musicAnalysis },
    lyrics,
  };
}

describe('Suíte Obrigatória Completa — AMV Creative Intelligence (Testes A a L + 3 Cenários)', () => {
  it('cobre integralmente os Casos A, B, C, D, E, F, G, H, I, J, K e L com determinismo', () => {
    const { project, episodes, music, lyrics } = buildMultiEpisodeFixture();
    const cache = new CreativeAnalysisCache();

    const session = prepareCreativeDirectionSession({
      project,
      music,
      episodes,
      options: {
        style: 'superacao',
        intensity: 2,
        durationS: 32,
        musicStartS: 0,
        lyrics,
        useSpeech: true,
        organizationMode: 'free',
      },
      cache,
    });

    // Teste A — Narrativa não linear (3 episódios: abre pelo clímax tardio, volta à origem e culmina no clímax)
    expect(session.plan.narrativeModel).toBe('climax_opening');
    expect(session.plan.openingSelection?.isLateEpisodeHook).toBe(true);
    expect(session.plan.narrativeBeats[0]?.nonLinearFunction).toBe('cold_open_climax');
    expect(session.plan.narrativeBeats[1]?.nonLinearFunction).toBe('origin_flashback');

    // Teste B — Correspondência letra-imagem literal + palavra-chave
    const swordEv = session.musicUnderstanding.events.find((e) => e.lyrics?.includes('espada em chamas'))!;
    const rankedSword = rankScenesForMusicEvent(swordEv, session.scenes);
    expect(rankedSword[0]?.alignmentType).toBe('literal');
    expect(rankedSword[0]?.score).toBeGreaterThan(85);

    // Teste C — Correspondência contextual (sem palavra idêntica na cena)
    const resistEv = session.musicUnderstanding.events.find((e) => e.lyrics?.includes('continuar de pé'))!;
    const kneelingScene = session.scenes.find((s) => s.sceneId === 'ep1@14')!;
    const ctxAlign = evaluateSemanticAlignment(resistEv, kneelingScene);
    expect(['contextual', 'metaphorical']).toContain(ctxAlign.alignmentType);
    expect(ctxAlign.score).toBeGreaterThan(80);

    // Teste D & E — Combate coerente entre episódios vs combate incoerente
    const prepEp1 = session.scenes.find((s) => s.sceneId === 'ep1@14')!;
    const atkEp2 = session.scenes.find((s) => s.sceneId === 'ep2@28')!;
    const impEp3 = session.scenes.find((s) => s.sceneId === 'ep3@45')!;
    let mem = createInitialNarrativeMemory();
    mem = advanceNarrativeMemory(mem, prepEp1);
    const coherentRel1 = evaluateContinuityRelation(prepEp1, atkEp2, mem);
    mem = advanceNarrativeMemory(mem, atkEp2);
    const coherentRel2 = evaluateContinuityRelation(atkEp2, impEp3, mem);
    expect(coherentRel1.crossEpisode).toBe(true);
    expect(coherentRel1.continuityScore).toBeGreaterThanOrEqual(80);
    expect(coherentRel2.continuityScore).toBeGreaterThanOrEqual(80);

    const incoherentRel = evaluateContinuityRelation(
      { ...impEp3, movement: { ...impEp3.movement, direction: 'left-to-right', directionDeg: 5 } },
      {
        ...atkEp2,
        sceneId: 'ep2@99',
        sequenceId: 'ep2#otherFight',
        characterNames: ['Desconhecido'],
        actionPhase: 'impact',
        movement: { ...atkEp2.movement, direction: 'right-to-left', directionDeg: 180 },
      },
    );
    expect(incoherentRel.continuityScore).toBeLessThan(35);
    expect(incoherentRel.rejected).toBe(true);

    // Teste F — Música instrumental (zero semântica de letra inventada)
    const instUnderstanding = analyzeMusicUnderstanding(music.analysis, { isInstrumental: true });
    expect(instUnderstanding.archetype).toBe('instrumental');
    expect(instUnderstanding.lyricInterpretations).toHaveLength(0);
    expect(instUnderstanding.events.every((e) => e.lyrics === null && e.semanticMeaning === null)).toBe(true);

    // Teste G — Música híbrida (troca dinâmica de estratégia por seção)
    expect(session.musicUnderstanding.archetype).toBe('hybrid');
    expect(session.musicUnderstanding.sectionProfiles[0]?.strategy).toBe('cinematic_breathing');
    expect(session.musicUnderstanding.sectionProfiles[2]?.strategy).toBe('impact_choreography');

    // Teste H — Continuidade de fala (fala essencial completa sem corte abrupto)
    expect(session.solution.audioMap.essentialSpeechCount).toBeGreaterThanOrEqual(1);
    expect(session.solution.audioMap.interruptedSpeechCount).toBe(0);

    // Teste I — Contraste intencional (vitória na letra sobre derrota na imagem)
    const victoryEv = session.musicUnderstanding.events.find((e) => e.lyrics?.includes('vitória e a glória'))!;
    const defeatScene = session.scenes.find((s) => s.sceneId === 'ep1@74')!;
    const contrastAlign = evaluateSemanticAlignment(victoryEv, defeatScene, { allowIntentionalContrast: true });
    expect(contrastAlign.alignmentType).toBe('intentional_contrast');
    expect(contrastAlign.score).toBeGreaterThanOrEqual(75);

    // Teste J — Respiração cinematográfica (sustenta planos longos em trechos emocionais/pausas)
    expect(session.solution.decisions.some((d) => d.isBreathingHold && d.endTime - d.startTime >= 3)).toBe(true);

    // Teste K — Qualidade global independente (aprova plano coeso e reprova sequência confusa)
    expect(session.qualityReview.overallScore).toBeGreaterThanOrEqual(72);
    const badDecisions: EditorialDecision[] = session.solution.decisions.map((d, i) => ({
      ...d,
      selectedSceneId: i % 2 === 0 ? 'ep1@4' : 'ep3@45',
      endTime: i === session.solution.decisions.length - 1 ? d.startTime + 0.3 : d.endTime,
    }));
    const badGlobal = evaluateGlobalAmvQuality({
      decisions: badDecisions,
      scenes: session.scenes,
      plan: session.plan,
      musicUnderstanding: session.musicUnderstanding,
    });
    expect(badGlobal.overallScore).toBeLessThan(session.qualityReview.overallScore - 12);
    expect(badGlobal.findings.length).toBeGreaterThan(0);

    // Teste L — Reaproveitamento de cache entre múltiplos projetos compartilhando os mesmos hashes de mídia
    let secondProject = createProject({
      name: 'Segundo Projeto Reusando Cache',
      settings: { width: 1920, height: 1080, fps: { num: 24, den: 1 } },
    });
    for (const a of [
      makeAsset('p2-mus', 'audio', 'hash-music-main', 32),
      makeAsset('p2-ep1', 'video', 'hash-ep-01', 90),
    ]) {
      secondProject = applyCommand(secondProject, { type: 'asset.add', asset: a }).project;
    }
    const statsBefore = cache.getStats();
    const secondSession = prepareCreativeDirectionSession({
      project: secondProject,
      music: { assetId: 'p2-mus', name: 'mus.m4a', analysis: music.analysis },
      episodes: [{ ...episodes[0]!, assetId: 'p2-ep1' }],
      options: {
        style: 'superacao',
        intensity: 2,
        durationS: 32,
        musicStartS: 0,
        lyrics,
        useSpeech: true,
        organizationMode: 'free',
      },
      cache,
    });
    const statsAfter = cache.getStats();
    expect(statsAfter.visualHits).toBeGreaterThan(statsBefore.visualHits);
    expect(statsAfter.musicHits).toBeGreaterThan(statsBefore.musicHits);
    expect(secondSession.scenes[0]?.assetId).toBe('p2-ep1');

    // Consultas editoriais obrigatórias da Seção 13
    const whyAnswer = explainEditorialDecision(session.solution.decisions[0]!, session.scenes[0]);
    expect(whyAnswer).toContain('Relação musical:');
    const betterForPhrase = findAlternativeScenesForPhrase({
      phraseText: 'minha espada em chamas',
      scenes: session.scenes,
    });
    expect(betterForPhrase.length).toBeGreaterThan(0);
  });

  it('valida na prática os 3 cenários completos de AMV (1. Combate, 2. Narrativo c/ letras e diálogos, 3. Emocional com respiração)', () => {
    const { project, episodes, music, lyrics } = buildMultiEpisodeFixture();
    const scenarios = [
      { name: 'Combate', style: 'hype' as const, org: 'narrative' as const, useLyrics: false, useSpeech: true },
      { name: 'Narrativo não linear c/ letras e diálogos', style: 'superacao' as const, org: 'free' as const, useLyrics: true, useSpeech: true },
      { name: 'Emocional c/ respiração longa', style: 'emocional' as const, org: 'free' as const, useLyrics: true, useSpeech: false },
    ];

    for (const sc of scenarios) {
      const creativeSession = prepareCreativeDirectionSession({
        project,
        music,
        episodes,
        options: {
          style: sc.style,
          intensity: sc.style === 'emocional' ? 1 : 2,
          durationS: 24,
          musicStartS: 0,
          lyrics: sc.useLyrics ? lyrics : undefined,
          useSpeech: sc.useSpeech,
          organizationMode: sc.org,
        },
      });

      const tournament = generateBestAmv({
        project,
        music,
        episodes,
        options: {
          style: sc.style,
          intensity: sc.style === 'emocional' ? 1 : 2,
          durationS: 24,
          musicStartS: 0,
          lyrics: sc.useLyrics ? lyrics : undefined,
          useSpeech: sc.useSpeech,
          voiceMoments: sc.useSpeech ? 1 : 0,
          useEffects: true,
          showText: sc.useLyrics || sc.useSpeech,
          seed: 42,
          organizationMode: sc.org,
          creativeSession,
        },
        candidateCount: 3,
      });

      const finalProject = applyCommand(project, {
        type: 'batch',
        label: `Cenário ${sc.name}`,
        commands: tournament.winner.review.commands,
      }).project;

      const v1Id = finalProject.tracks.find((t) => t.name === 'V1')!.id;
      const v1Clips = finalProject.clips
        .filter((c) => c.trackId === v1Id)
        .sort((a, b) => a.timelineStartUs - b.timelineStartUs);

      expect(v1Clips.length).toBeGreaterThanOrEqual(3);
      expect(v1Clips.every((c) => Boolean(c.reason && c.reason.length > 10))).toBe(true);
      // Zero sobreposição na trilha V1
      for (let i = 1; i < v1Clips.length; i++) {
        expect(v1Clips[i]!.timelineStartUs).toBeGreaterThanOrEqual(clipEndUs(v1Clips[i - 1]!));
      }
      expect(tournament.winner.score.total).toBeGreaterThanOrEqual(70);
      expect(creativeSession.qualityReview.overallScore).toBeGreaterThanOrEqual(70);
    }

    // Verifica que travas do Creative Direction Preview (ex.: forçar abertura do Ep 3) são honradas no generateAmv
    const forced = generateAmv(project, music, episodes, {
      style: 'superacao',
      intensity: 2,
      durationS: 16,
      musicStartS: 0,
      useSpeech: false,
      useEffects: true,
      showText: false,
      seed: 1,
      organizationMode: 'free',
      creativeOverrides: {
        narrativeModel: 'climax_opening',
        openingSceneId: 'ep3@74',
      },
    });
    const v1Id = project.tracks.find((t) => t.name === 'V1')!.id;
    const firstAddedVideo = forced.commands
      .flatMap((c) => (c.type === 'clip.add' && c.clip.trackId === v1Id ? [c.clip] : []))
      .sort((a, b) => a.timelineStartUs - b.timelineStartUs)[0]!;
    expect(firstAddedVideo.assetId).toBe('ep3');
  });
});
