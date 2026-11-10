import { describe, expect, it } from 'vitest';
import { applyCommand, automaticDuckingGain, automaticDuckingExpression } from '../src/index.js';
import { audioAsset, baseProject, clip, track } from './helpers.js';

describe('mixagem de áudio', () => {
  it('faz ducking suave sobre a música ao redor de clipes de voz audíveis', () => {
    let project = baseProject();
    const music = track(project, 'Música');
    const voice = track(project, 'Vozes');
    const asset = audioAsset();
    project = applyCommand(project, { type: 'asset.add', asset }).project;
    project = applyCommand(project, { type: 'clip.add', clip: clip(music.id, asset.id, { timelineStartUs: 1_000_000, durationUs: 3_000_000 }) }).project;
    project = applyCommand(project, { type: 'clip.add', clip: clip(voice.id, asset.id, { timelineStartUs: 2_000_000, durationUs: 1_000_000 }) }).project;

    expect(automaticDuckingGain(project, music.id, 1_900_000)).toBeCloseTo(1);
    expect(automaticDuckingGain(project, music.id, 2_000_000)).toBeCloseTo(10 ** (-12 / 20));
    expect(automaticDuckingGain(project, music.id, 3_000_000)).toBeCloseTo(10 ** (-12 / 20));
    expect(automaticDuckingGain(project, music.id, 3_350_000)).toBeCloseTo(1);
    expect(automaticDuckingExpression(project, music.id, 1_000_000)).toContain('min(1,');

    project = applyCommand(project, { type: 'track.update', trackId: voice.id, patch: { muted: true } }).project;
    expect(automaticDuckingGain(project, music.id, 2_500_000)).toBeCloseTo(1);
  });

  it('persiste as opções e desfaz a mudança de mixagem com o comando inverso', () => {
    const project = baseProject();
    const result = applyCommand(project, { type: 'audioMix.update', patch: { normalization: 'ebu-r128', targetLufs: -12, duckingEnabled: false } });
    expect(result.project.audioMix).toMatchObject({ normalization: 'ebu-r128', targetLufs: -12, duckingEnabled: false });
    expect(applyCommand(result.project, result.inverse).project.audioMix).toEqual(project.audioMix);
  });
});
