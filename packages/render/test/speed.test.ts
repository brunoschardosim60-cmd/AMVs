import { describe, expect, it } from 'vitest';
import { createProject, type Clip, type Project } from '@amv/project';
import { audioArgs } from '../src/audio.js';

const S = 1_000_000;

function projectWithSpeedCurve(pitchMode: Clip['audio']['pitchMode']): Project {
  const project = createProject({ name: 'speed-test' });
  const track = project.tracks.find((item) => item.kind === 'audio');
  if (!track) throw new Error('trilha de áudio padrão ausente');
  const clip: Clip = {
    id: 'speed-clip',
    trackId: track.id,
    assetId: 'audio-asset',
    timelineStartUs: 0,
    durationUs: 4 * S,
    sourceInUs: 0,
    sourceOutUs: 4 * S,
    speed: 1,
    reverse: false,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    blendMode: 'normal',
    mask: 'none',
    groupId: null,
    audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode, streamIndex: null },
    effects: [],
    transitionIn: null,
    keyframes: { speed: [
      { atUs: 0, value: 0.5, easing: 'linear' },
      { atUs: 4 * S, value: 1.5, easing: 'linear' },
    ] },
    text: null,
    origin: 'user',
    reason: null,
    confidence: null,
    label: null,
  };
  const asset: Project['assets'][number] = {
    id: 'audio-asset',
    name: 'tone.wav',
    path: 'tone.wav',
    hash: 'test',
    kind: 'audio',
    probe: null,
    status: 'ok',
    error: null,
    importedAt: '',
    tags: [],
    favorite: false,
  };
  return { ...project, clips: [clip], assets: [asset] };
}

function graphFor(pitchMode: Clip['audio']['pitchMode']): string {
  const args = audioArgs({
    project: projectWithSpeedCurve(pitchMode),
    durationUs: 4 * S,
    sampleRate: 48_000,
    output: 'mix.wav',
    source: () => ({ path: 'tone.wav', kind: 'audio', width: 0, height: 0, audioStreams: [0] }),
  });
  const index = args.indexOf('-filter_complex');
  if (index < 0 || !args[index + 1]) throw new Error('filter_complex da mixagem ausente');
  return args[index + 1]!;
}

describe('exportação da curva de velocidade no áudio', () => {
  it('segmenta ramps para variar o tempo em vez de colapsar a curva na velocidade média', () => {
    const graph = graphFor('preserve');
    expect(graph).toContain('concat=n=');
    expect(graph.match(/atempo=/g)?.length ?? 0).toBeGreaterThan(2);
    expect(graph).not.toContain('asetrate=');
  });

  it('acompanha o pitch quando essa opção é escolhida', () => {
    expect(graphFor('follow')).toContain('asetrate=');
  });
});
