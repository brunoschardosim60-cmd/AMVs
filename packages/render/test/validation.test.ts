import { describe, expect, it } from 'vitest';
import { parseFreezeIntervals } from '../src/render.js';

describe('detecção de quadros congelados', () => {
  it('converte eventos freezedetect em microssegundos', () => {
    const log = [
      '[Parsed_freezedetect_0] lavfi.freezedetect.freeze_start: 1.250000',
      '[Parsed_freezedetect_0] lavfi.freezedetect.freeze_duration: 2.750000',
      '[Parsed_freezedetect_0] lavfi.freezedetect.freeze_end: 4.000000',
      '[Parsed_freezedetect_0] lavfi.freezedetect.freeze_start: 8.000000',
      '[Parsed_freezedetect_0] lavfi.freezedetect.freeze_duration: 3.000000',
      '[Parsed_freezedetect_0] lavfi.freezedetect.freeze_end: 11.000000',
    ].join('\n');

    expect(parseFreezeIntervals(log)).toEqual([
      { startUs: 1_250_000, endUs: 4_000_000 },
      { startUs: 8_000_000, endUs: 11_000_000 },
    ]);
  });

  it('aceita evento final com duração, mas sem freeze_end', () => {
    const log = [
      'freeze_start: 5.000000',
      'freeze_duration: 2.500000',
    ].join('\n');

    expect(parseFreezeIntervals(log)).toEqual([{ startUs: 5_000_000, endUs: 7_500_000 }]);
  });

  it('ignora eventos incompletos ou inválidos', () => {
    expect(parseFreezeIntervals('freeze_start: 4.000000\n')).toEqual([]);
    expect(parseFreezeIntervals('sem evento de congelamento')).toEqual([]);
    expect(parseFreezeIntervals('freeze_start: NaN\nfreeze_end: 8.000000')).toEqual([]);
  });
});
