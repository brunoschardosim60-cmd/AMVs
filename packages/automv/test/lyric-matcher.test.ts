import { describe, expect, it } from 'vitest';
import type { Cue, Shot, ShotVision } from '@amv/analysis';
import { lyricCueKey } from '../src/lyric-cue-key.js';
import { matchLyricsSemantics } from '../src/lyric-matcher.js';
import type { Candidate, EpisodeInput } from '../src/generate.js';

function createCandidate(id: string, shotOverrides: Partial<Shot> = {}, speechText?: string): Candidate {
  const shot: Shot = {
    startS: 10,
    endS: 13,
    motion: 0.5,
    loud: 0.5,
    intensity: 0.6,
    brightness: 0.5,
    tags: ['ação'],
    line: null,
    peakS: 11.5,
    ...shotOverrides,
  };
  const ep: EpisodeInput = {
    assetId: 'ep1',
    name: 'Episode 01.mkv',
    hasAudio: true,
    analysis: {
      version: 'e2',
      durationS: 100,
      shots: [shot],
      sequences: [],
      subtitles: [],
      intensityCurve: [],
      curveStepS: 1,
      speech: speechText
        ? [{ startS: 10.2, endS: 12.0, kind: 'fala', confidence: 0.9, text: speechText, impact: 0.8 }]
        : [],
    },
  };
  return {
    id, assetId: ep.assetId, ep, shot, seq: 'ep1#seq1',
    sequenceOrder: 0, episodeOrder: 0,
    sourceStartS: shot.startS, sourceEndS: shot.endS,
  };
}

describe('matchLyricsSemantics', () => {
  it('usa a mesma chave de cue que o planejador de slots', () => {
    const cue: Cue = { startS: 15.123, endS: 18.456, text: '  LUTA   interior  ' };
    const normalized: Cue = { ...cue, text: 'luta interior' };
    expect(lyricCueKey(cue)).toBe(lyricCueKey(normalized));
    const matches = matchLyricsSemantics([cue], [createCandidate('candidate', { tags: ['ação', 'impacto'] })]);
    expect(matches.candidate?.[lyricCueKey(cue)]).toBeDefined();
  });

  it('detecta combate com ação visual confiável', () => {
    const candidate = createCandidate('fight', { tags: ['ação', 'impacto'] });
    const vision: ShotVision = { characters: ['Zoro'], fight: true, action: 'combate', confidence: 0.9, note: '' };
    const cue: Cue = { startS: 15, endS: 18, text: 'Fight until the enemy falls down and bleed!' };
    const match = matchLyricsSemantics([cue], [candidate], () => vision).fight?.[lyricCueKey(cue)];
    expect(match?.score).toBeGreaterThanOrEqual(0.8);
    expect(match?.reason).toContain('combate');
  });

  it('associa escuridão com baixa luminância local', () => {
    const candidate = createCandidate('dark', { brightness: 0.25 });
    const cue: Cue = { startS: 5, endS: 8, text: 'Lost in the shadows and endless dark night' };
    const match = matchLyricsSemantics([cue], [candidate]).dark?.[lyricCueKey(cue)];
    expect(match?.score).toBeGreaterThanOrEqual(0.7);
    expect(match?.reason).toContain('luminância');
  });

  it('associa luz com brilho medido, não com uma tag genérica de impacto', () => {
    const cue: Cue = { startS: 25, endS: 28, text: 'A shining star of light will guide the way' };
    const bright = createCandidate('bright', { brightness: 0.85 });
    expect(matchLyricsSemantics([cue], [bright]).bright?.[lyricCueKey(cue)]?.score).toBeGreaterThan(0.7);
    const impactOnly = createCandidate('impact', { brightness: 0.5, tags: ['impacto'] });
    expect(matchLyricsSemantics([cue], [impactOnly]).impact).toBeUndefined();
  });

  it('não confunde plano fechado com tristeza', () => {
    const candidate = createCandidate('closeup', { tags: ['ação'] });
    const vision: ShotVision = { characters: [], fight: false, note: '', framing: 'close-up', confidence: 0.9 };
    const cue: Cue = { startS: 1, endS: 3, text: 'Pain inside my heart' };
    expect(matchLyricsSemantics([cue], [candidate], () => vision).closeup).toBeUndefined();
  });

  it('exige emoção visual confiável para determinar superação', () => {
    const candidate = createCandidate('determined', { tags: ['calma'] });
    const cue: Cue = { startS: 30, endS: 33, text: 'Unleash your true power and rise as a champion' };
    const reliable: ShotVision = { characters: [], fight: false, note: '', emotion: 'determinação', confidence: 0.9 };
    const uncertain: ShotVision = { characters: [], fight: false, note: '', emotion: 'determinação', confidence: 0.3 };
    expect(matchLyricsSemantics([cue], [candidate], () => reliable).determined?.[lyricCueKey(cue)]?.score).toBe(0.88);
    expect(matchLyricsSemantics([cue], [candidate], () => uncertain).determined).toBeUndefined();
  });

  it('não trata movimento rápido como prova de fogo', () => {
    const candidate = createCandidate('fire', { motion: 0.95, tags: ['ação', 'impacto'] });
    const cue: Cue = { startS: 4, endS: 6, text: 'Fire in inferno' };
    expect(matchLyricsSemantics([cue], [candidate]).fire).toBeUndefined();
    const vision: ShotVision = { characters: [], fight: false, note: 'Chamas e explosão no cenário', confidence: 0.9 };
    expect(matchLyricsSemantics([cue], [candidate], () => vision).fire?.[lyricCueKey(cue)]?.score).toBe(0.78);
  });

  it('usa fala reconhecida sem alegar identidade do falante', () => {
    const candidate = createCandidate('speech', { intensity: 0.8, motion: 0.7 }, 'Eu nunca vou me render, tenho o poder!');
    const cue: Cue = { startS: 30, endS: 33, text: 'Unleash your true power and rise as a champion' };
    const match = matchLyricsSemantics([cue], [candidate]).speech?.[lyricCueKey(cue)];
    expect(match?.score).toBe(0.58);
    expect(match?.reason).toContain('sem identificar quem fala');
  });

  it('preserva a justificativa visual mais forte quando a fala também confirma o tema', () => {
    const candidate = createCandidate('visual-and-speech', { intensity: 0.8, motion: 0.7 }, 'Eu tenho o poder para vencer!');
    const cue: Cue = { startS: 30, endS: 33, text: 'Unleash your true power and rise as a champion' };
    const vision: ShotVision = { characters: [], fight: false, note: '', emotion: 'determinação', confidence: 0.9 };
    const match = matchLyricsSemantics([cue], [candidate], () => vision)['visual-and-speech']?.[lyricCueKey(cue)];
    expect(match?.score).toBe(0.88);
    expect(match?.reason).toContain('emoção de determinação');
    expect(match?.reason).toContain('fala reconhecida');
  });

  it('não confunde o drop musical com uma queda física ou cena de movimento', () => {
    const candidate = createCandidate('musical-drop', { motion: 0.95, tags: ['calma'] });
    const cue: Cue = { startS: 20, endS: 23, text: 'Wait for the drop tonight' };
    expect(matchLyricsSemantics([cue], [candidate])['musical-drop']).toBeUndefined();
  });

  it('não faz correspondência por substring dentro de outra palavra', () => {
    const candidate = createCandidate('false-positive', { tags: ['ação', 'impacto'] });
    const cue: Cue = { startS: 2, endS: 4, text: 'This shit moves forward' };
    expect(matchLyricsSemantics([cue], [candidate])['false-positive']).toBeUndefined();
  });

  it('ignora versos sem tema conhecido ou candidatos sem evidência', () => {
    const candidate = createCandidate('calm', { brightness: 0.5, intensity: 0.3, motion: 0.2, tags: ['calma'] });
    const cue: Cue = { startS: 1, endS: 4, text: 'Walking down the peaceful quiet street' };
    expect(matchLyricsSemantics([cue], [candidate]).calm).toBeUndefined();
  });
});
