import { describe, expect, it } from 'vitest';
import { getAnalysisReadiness } from '../src/features/automv/analysis-readiness.js';

describe('gate de análise da geração', () => {
  it('só libera quando todos os arquivos selecionados têm análise', () => {
    expect(getAnalysisReadiness([
      { id: 'episode-ready', name: 'episódio 1', ready: true },
      { id: 'episode-pending', name: 'episódio 2', ready: false },
      { id: 'music-ready', name: 'música', ready: true },
    ])).toMatchObject({
      pending: [{ id: 'episode-pending' }],
      failed: [],
      canGenerate: false,
    });
  });

  it('expõe falhas para retry e não trata cache/erro como análise pronta', () => {
    expect(getAnalysisReadiness([
      { id: 'episode-failed', name: 'episódio', ready: false, error: 'FFmpeg indisponível' },
      { id: 'music-ready', name: 'música', ready: true },
    ])).toMatchObject({
      pending: [],
      failed: [{ id: 'episode-failed', error: 'FFmpeg indisponível' }],
      canGenerate: false,
    });
  });

  it('permite a geração após desmarcar arquivos não prontos', () => {
    expect(getAnalysisReadiness([
      { id: 'episode-ready', name: 'episódio', ready: true },
      { id: 'music-ready', name: 'música', ready: true },
    ]).canGenerate).toBe(true);
    expect(getAnalysisReadiness([]).canGenerate).toBe(false);
  });
});
