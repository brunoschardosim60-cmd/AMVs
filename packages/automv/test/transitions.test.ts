import { describe, expect, it } from 'vitest';
import { LOCAL_VISION_VERSION, type LocalVisualFeatures, type Shot, type ShotVision } from '@amv/analysis';
import { chooseSceneTransition } from '../src/transitions.js';

function shot(overrides: Partial<Shot> = {}): Shot {
  return {
    startS: 0,
    endS: 2,
    motion: 0.5,
    loud: 0.5,
    intensity: 0.5,
    brightness: 0.5,
    tags: [],
    line: null,
    peakS: 1,
    ...overrides,
  };
}

function localMotion(directionDeg: number, speed: number): LocalVisualFeatures {
  return {
    version: LOCAL_VISION_VERSION,
    samples: 3,
    lumaGrid: [],
    edgeGrid: [],
    colorHistogram: [],
    brightness: 0.5,
    saturation: 0.4,
    entropy: 0.6,
    edgeDensity: 0.3,
    centerOfVisualMass: [0.5, 0.5],
    temporalMotion: 0.4,
    globalShift: [0, 0],
    globalMotion: speed,
    motionEvents: [{
      startS: 0,
      endS: 1,
      cameraMotion: 'pan-horizontal',
      directionDeg,
      speed,
      scaleSpeed: 0,
      confidence: 0.9,
      subjectMotion: { directionDeg: null, speed: 0, confidence: 0 },
      apparentScaleChange: 'none',
      abruptFramingChange: false,
    }],
    motionConfidence: 0.9,
    fingerprint: `motion-${directionDeg}-${speed}`,
    sceneType: 'action',
    sceneTypeConfidence: 0.9,
  };
}

function vision(overrides: Partial<ShotVision> = {}): ShotVision {
  return { characters: [], fight: true, note: '', confidence: 0.9, ...overrides };
}

describe('escolha contextual de transição', () => {
  it('mantém corte seco quando a duração disponível é curta', () => {
    const result = chooseSceneTransition({
      outgoing: { shot: shot() },
      incoming: { shot: shot() },
      musicEnergy: 0.9,
      isDrop: true,
      durationS: 0.15,
      direction: 'hype',
      style: 'hype',
    });
    expect(result.transition).toBeNull();
    expect(result.reason).toContain('duração curta');
  });

  it('só usa whip pan em continuação confiável de ação e movimento alinhado', () => {
    const result = chooseSceneTransition({
      outgoing: {
        shot: shot({ tags: ['ação'] }),
        local: localMotion(12, 0.08),
        vision: vision({ characters: ['Asta'], action: 'combate' }),
      },
      incoming: {
        shot: shot({ tags: ['ação'] }),
        local: localMotion(18, 0.07),
        vision: vision({ characters: ['asta'], action: 'combate' }),
      },
      musicEnergy: 0.8,
      isDrop: false,
      durationS: 0.8,
      direction: 'hype',
      style: 'hype',
    });
    expect(result.transition?.transition).toBe('whip_pan');
  });

  it('usa corte em ação para continuidade com movimento menos rápido', () => {
    const result = chooseSceneTransition({
      outgoing: {
        shot: shot({ tags: ['ação'] }),
        local: localMotion(10, 0.04),
        vision: vision({ characters: ['Asta'], action: 'combate' }),
      },
      incoming: {
        shot: shot({ tags: ['ação'] }),
        local: localMotion(14, 0.04),
        vision: vision({ characters: ['Asta'], action: 'combate' }),
      },
      musicEnergy: 0.5,
      isDrop: false,
      durationS: 0.8,
      direction: 'balanced',
      style: 'hype',
    });
    expect(result.transition?.transition).toBe('cut_on_action');
    expect(result.transition?.durationUs).toBe(0);
  });

  it('não presume continuidade quando o movimento tem baixa confiança', () => {
    const outgoing = localMotion(10, 0.08);
    const incoming = localMotion(14, 0.08);
    outgoing.motionEvents[0]!.confidence = 0.35;
    incoming.motionEvents[0]!.confidence = 0.35;
    const result = chooseSceneTransition({
      outgoing: { shot: shot({ tags: ['ação'] }), local: outgoing, vision: vision({ characters: ['Asta'], action: 'combate' }) },
      incoming: { shot: shot({ tags: ['ação'] }), local: incoming, vision: vision({ characters: ['Asta'], action: 'combate' }) },
      musicEnergy: 0.8,
      isDrop: false,
      durationS: 0.8,
      direction: 'balanced',
      style: 'hype',
    });
    expect(result.transition).toBeNull();
  });

  it('usa match cut somente com composição/evidência visual comparável', () => {
    const features = localMotion(0, 0);
    features.lumaGrid = Array.from({ length: 64 }, (_, index) => index / 64);
    features.edgeGrid = Array.from({ length: 16 }, (_, index) => index / 16);
    const result = chooseSceneTransition({
      outgoing: { shot: shot(), local: features },
      incoming: { shot: shot(), local: structuredClone(features) },
      musicEnergy: 0.7,
      isDrop: false,
      durationS: 0.6,
      direction: 'balanced',
      style: 'hype',
    });
    expect(result.transition?.transition).toBe('match_cut');
    expect(result.transition?.durationUs).toBe(0);
  });

  it('não infere match cut só de histograma de cor ou luminosidade', () => {
    const outgoing = localMotion(0, 0);
    const incoming = structuredClone(outgoing);
    outgoing.samples = incoming.samples = 3;
    outgoing.lumaGrid = Array.from({ length: 64 }, () => 0.1);
    incoming.lumaGrid = Array.from({ length: 64 }, () => 0.9);
    outgoing.edgeGrid = Array.from({ length: 16 }, () => 0);
    incoming.edgeGrid = Array.from({ length: 16 }, () => 1);
    outgoing.colorHistogram = incoming.colorHistogram = Array.from({ length: 12 }, () => 1);
    const result = chooseSceneTransition({
      outgoing: { shot: shot(), local: outgoing },
      incoming: { shot: shot(), local: incoming },
      musicEnergy: 0.5,
      isDrop: false,
      durationS: 0.8,
      direction: 'balanced',
      style: 'hype',
    });
    expect(result.transition).toBeNull();
  });

  it('separa cenas de luminosidade diferente em trecho calmo cinematográfico', () => {
    const result = chooseSceneTransition({
      outgoing: { shot: shot({ brightness: 0.8, intensity: 0.2 }) },
      incoming: { shot: shot({ brightness: 0.3, intensity: 0.2 }) },
      musicEnergy: 0.2,
      isDrop: false,
      durationS: 1.2,
      direction: 'cinematic',
      style: 'superacao',
    });
    expect(result.transition?.transition).toBe('dip_black');
  });

  it('prefere corte seco a dissolve em estilo hype sem evidência de continuidade', () => {
    const result = chooseSceneTransition({
      outgoing: { shot: shot({ intensity: 0.2 }) },
      incoming: { shot: shot({ intensity: 0.2 }) },
      musicEnergy: 0.2,
      isDrop: false,
      durationS: 1.2,
      direction: 'hype',
      style: 'hype',
    });
    expect(result.transition).toBeNull();
  });

  it('permite dissolve em planos calmos longos no estilo emocional, não no hype', () => {
    const input = {
      outgoing: { shot: shot({ intensity: 0.2, tags: ['calma'] }) },
      incoming: { shot: shot({ intensity: 0.2, tags: ['calma'] }) },
      musicEnergy: 0.25,
      isDrop: false,
      durationS: 1.2,
      direction: 'balanced' as const,
    };
    expect(chooseSceneTransition({ ...input, style: 'emocional' }).transition?.transition).toBe('dissolve');
    expect(chooseSceneTransition({ ...input, style: 'hype' }).transition).toBeNull();
  });
});
