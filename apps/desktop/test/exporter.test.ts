import { describe, expect, it } from 'vitest';
import { estimateOutputSize, OUTPUT_FRAME_RATES, outputSize } from '../src/core/exporter';
import { createProject } from '@amv/project';

describe('opções de exportação', () => {
  it('oferece FPS racionais, inclusive 23,976 sem aproximação decimal', () => {
    expect(OUTPUT_FRAME_RATES.find((rate) => rate.id === '23976')?.value).toEqual({ num: 24000, den: 1001 });
  });

  it('calcula dimensões pares para presets e estimativa de tamanho em intervalo', () => {
    const project = createProject({ name: 'export-test', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 } } });
    expect(outputSize(project, { id: '1080', label: '1080p', height: 1080 }).height).toBe(1080);
    const estimate = estimateOutputSize(60_000_000, 1920, 1080, 'h264', 192, 'bitrate', 8000, 18);
    expect(estimate.minBytes).toBeLessThan(estimate.maxBytes);
    expect(estimate.minBytes).toBeGreaterThan(40_000_000);
  });
});
