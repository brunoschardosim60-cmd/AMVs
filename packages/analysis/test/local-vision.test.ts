import { describe, expect, it } from 'vitest';
import {
  analyzeLocalVisualFrames,
  findSimilarVisualScenes,
  inferLocalSceneType,
  selectLocalVisionTargets,
  visualSimilarity,
  type RgbFrame,
  type Shot,
} from '../src/index.js';

function frame(draw: (x: number, y: number) => [number, number, number], width = 64, height = 36): RgbFrame {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(draw(x, y), (y * width + x) * 3);
  }
  return { width, height, data };
}

const blank = (color: [number, number, number]) => frame(() => color);
const centeredShape = (color: [number, number, number]) => frame((x, y) =>
  x >= 23 && x < 41 && y >= 7 && y < 29 ? color : [12, 12, 12],
);
const texturedFrame = () => frame((x, y) => {
  const cellX = Math.floor(x / 3);
  const cellY = Math.floor(y / 3);
  let value = (cellX * 374761393 + cellY * 668265263) | 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  const gray = 30 + ((value ^ (value >>> 16)) & 0xBF);
  return [gray, gray, gray];
}, 96, 54);
function translate(source: RgbFrame, dx: number, dy: number): RgbFrame {
  return frame((x, y) => {
    const sx = Math.max(0, Math.min(source.width - 1, x - dx));
    const sy = Math.max(0, Math.min(source.height - 1, y - dy));
    const offset = (sy * source.width + sx) * 3;
    return [source.data[offset]!, source.data[offset + 1]!, source.data[offset + 2]!];
  }, source.width, source.height);
}
function zoom(source: RgbFrame, scale: number): RgbFrame {
  const cx = (source.width - 1) / 2;
  const cy = (source.height - 1) / 2;
  return frame((x, y) => {
    const rawX = Math.round(cx + (x - cx) / scale);
    const rawY = Math.round(cy + (y - cy) / scale);
    if (rawX < 0 || rawX >= source.width || rawY < 0 || rawY >= source.height) return [0, 0, 0];
    const sx = rawX;
    const sy = rawY;
    const offset = (sy * source.width + sx) * 3;
    return [source.data[offset]!, source.data[offset + 1]!, source.data[offset + 2]!];
  }, source.width, source.height);
}
function rotate(source: RgbFrame, angle: number): RgbFrame {
  const cx = (source.width - 1) / 2;
  const cy = (source.height - 1) / 2;
  return frame((x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const sx = Math.max(0, Math.min(source.width - 1, Math.round(cx + dx * Math.cos(angle) + dy * Math.sin(angle))));
    const sy = Math.max(0, Math.min(source.height - 1, Math.round(cy - dx * Math.sin(angle) + dy * Math.cos(angle))));
    const offset = (sy * source.width + sx) * 3;
    return [source.data[offset]!, source.data[offset + 1]!, source.data[offset + 2]!];
  }, source.width, source.height);
}
function movingSubject(offsetX: number): RgbFrame {
  return frame((x, y) => {
    const cellX = Math.floor(x / 3);
    const cellY = Math.floor(y / 3);
    let background = Math.imul(cellX * 374761393 + cellY * 668265263, 1274126177);
    background ^= background >>> 16;
    const bg = 24 + (background & 31);
    const inside = x >= 30 + offsetX && x < 63 + offsetX && y >= 15 && y < 39;
    if (!inside) return [bg, bg, bg];
    let foreground = Math.imul(Math.floor((x - offsetX) / 3) * 374761393 + cellY * 668265263, 1274126177);
    foreground ^= foreground >>> 16;
    const pattern = 130 + (foreground & 95);
    return [pattern, pattern, pattern];
  }, 96, 54);
}
const shot = (overrides: Partial<Shot> = {}): Shot => ({
  startS: 0,
  endS: 2,
  motion: 0.1,
  loud: 0.1,
  intensity: 0.2,
  brightness: 0.5,
  tags: [],
  line: null,
  peakS: 1,
  ...overrides,
});

describe('análise visual local', () => {
  it('extrai estrutura espacial, composição e métricas sem depender de cor isolada', () => {
    const shape = analyzeLocalVisualFrames([centeredShape([240, 240, 240])], shot());
    const flat = analyzeLocalVisualFrames([blank([12, 12, 12])], shot());

    expect(shape.local.lumaGrid).toHaveLength(64);
    expect(shape.local.edgeGrid).toHaveLength(16);
    expect(shape.local.colorHistogram).toHaveLength(12);
    expect(shape.local.dominantColors).toHaveLength(2);
    expect(shape.local.fingerprint).not.toBe(flat.local.fingerprint);
    expect(visualSimilarity(shape.local, flat.local)).toBeLessThan(0.9);
    expect(shape.local.centerOfVisualMass[0]).toBeGreaterThan(0.35);
    expect(shape.local.centerOfVisualMass[0]).toBeLessThan(0.65);
  });

  it('usa sequência temporal para detectar movimento de enquadramento', () => {
    const left = frame((x, y) => x >= 12 && x < 26 && y >= 10 && y < 26 ? [240, 240, 240] : [12, 12, 12]);
    const right = frame((x, y) => x >= 28 && x < 42 && y >= 10 && y < 26 ? [240, 240, 240] : [12, 12, 12]);
    const result = analyzeLocalVisualFrames([left, right], shot({ motion: 0.4, intensity: 0.45 }));

    expect(result.local.samples).toBe(2);
    expect(result.local.temporalMotion).toBeGreaterThan(0);
    expect(result.local.globalMotion).toBeGreaterThan(0);
    expect(result.local.globalShift[0]).not.toBe(0);
  });

  it('classifica pan, zoom aparente e quadro estático com confiança suficiente', () => {
    const still = texturedFrame();
    const pan = analyzeLocalVisualFrames([still, translate(still, 9, 0)], shot(), {}, [1, 2]).local.motionEvents[0]!;
    const tilt = analyzeLocalVisualFrames([still, translate(still, 0, 9)], shot(), {}, [1, 2]).local.motionEvents[0]!;
    const zoomIn = analyzeLocalVisualFrames([still, zoom(still, 1.3)], shot(), {}, [1, 2]).local.motionEvents[0]!;
    const zoomOut = analyzeLocalVisualFrames([still, zoom(still, 0.65)], shot(), {}, [1, 2]).local.motionEvents[0]!;
    const rotation = analyzeLocalVisualFrames([still, rotate(still, Math.PI / 12)], shot(), {}, [1, 2]).local.motionEvents[0]!;
    const staticEvent = analyzeLocalVisualFrames([still, still], shot(), {}, [1, 2]).local.motionEvents[0]!;

    expect(pan.cameraMotion, JSON.stringify(pan)).toBe('pan-horizontal');
    expect(pan.confidence).toBeGreaterThanOrEqual(0.6);
    expect(pan.directionDeg).not.toBeNull();
    expect(pan.abruptFramingChange).toBe(true);
    expect(tilt.cameraMotion).toBe('pan-vertical');
    expect(zoomIn.cameraMotion).toBe('zoom-in');
    expect(zoomIn.apparentScaleChange).toBe('in');
    expect(zoomOut.cameraMotion, JSON.stringify(zoomOut)).toBe('zoom-out');
    expect(zoomOut.apparentScaleChange).toBe('out');
    expect(rotation.cameraMotion).toBe('rotation');
    expect(staticEvent.cameraMotion).toBe('static');
    expect(staticEvent.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('não inventa movimento quando os quadros não têm textura rastreável', () => {
    const result = analyzeLocalVisualFrames([blank([30, 30, 30]), blank([30, 30, 30])], shot(), {}, [0, 1]).local;

    expect(result.motionEvents[0]?.cameraMotion).toBe('unknown');
    expect(result.motionEvents[0]?.confidence).toBeLessThan(0.6);
  });

  it('separa movimento localizado de câmera estática sem afirmar identidade', () => {
    const result = analyzeLocalVisualFrames([movingSubject(0), movingSubject(9)], shot(), {}, [1, 2]).local.motionEvents[0]!;

    expect(result.cameraMotion).toBe('static');
    expect(result.subjectMotion.speed).toBeGreaterThan(0);
    expect(result.subjectMotion.confidence).toBeGreaterThan(0);
  });

  it('distingue cenas parecidas por estrutura, sem agrupar só pela intensidade', () => {
    const a = analyzeLocalVisualFrames([centeredShape([240, 240, 240])], shot()).local;
    const repeated = analyzeLocalVisualFrames([centeredShape([220, 220, 220])], shot()).local;
    const otherComposition = analyzeLocalVisualFrames([
      frame((x, y) => (x < 18 && y < 18) || (x >= 46 && y >= 18) ? [240, 240, 240] : [12, 12, 12]),
    ], shot()).local;
    const matches = findSimilarVisualScenes([
      { key: 'a', features: a },
      { key: 'same', features: repeated },
      { key: 'different', features: otherComposition },
    ], 0.9);

    expect(visualSimilarity(a, repeated)).toBeGreaterThan(0.9);
    expect(matches.a?.map((match) => match.key)).toContain('same');
    expect(matches.a?.map((match) => match.key)).not.toContain('different');
  });

  it('classifica ação, diálogo, tensão, contemplação e reação com confiança moderada', () => {
    expect(inferLocalSceneType(shot({ motion: 0.8, intensity: 0.8, tags: ['ação'] })).type).toBe('action');
    expect(inferLocalSceneType(shot(), { dialogue: true }).type).toBe('dialogue');
    expect(inferLocalSceneType(shot({ motion: 0.4, brightness: 0.1 }), { nextMotion: 0.8 }).type).toBe('tension');
    expect(inferLocalSceneType(shot()).type).toBe('contemplation');
    expect(inferLocalSceneType(shot({ motion: 0.1 }), { previousMotion: 0.8 }).type).toBe('reaction');
  });

  it('seleciona cenas por novidade local e não repete o que já está no cache', () => {
    const shots = [shot({ startS: 0, endS: 1 }), shot({ startS: 2, endS: 4, intensity: 0.9, motion: 0.9 })];
    const episode = { version: 'e3', durationS: 5, shots, sequences: [], speech: [], subtitles: [], intensityCurve: [], curveStepS: 1 };
    const cached = {
      t0: {
        characters: [],
        fight: false,
        note: '',
        local: analyzeLocalVisualFrames([centeredShape([240, 240, 240])], shots[0]!).local,
      },
    };

    expect(selectLocalVisionTargets(episode, cached, 'all').map((target) => target.startS)).toEqual([2]);
    expect(selectLocalVisionTargets(episode, cached, 'all', 0)).toEqual([]);
  });
});
