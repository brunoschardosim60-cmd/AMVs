import { describe, expect, it } from 'vitest';
import { applyCommand, AssetSchema, ClipSchema, createProject, ProjectHistory, type Clip, type Project } from '@amv/project';
import { prepareLocalizedRegeneration } from '../src/regenerate.js';

const S = 1_000_000;

function fixture() {
  let project: Project = createProject({ name: 'regeneration' });
  const videoTrack = project.tracks.find((track) => track.kind === 'video' && track.name === 'V1')!;
  const audioTrack = project.tracks.find((track) => track.role === 'music')!;
  const textTrack = project.tracks.find((track) => track.kind === 'text')!;
  const video = AssetSchema.parse({
    id: 'episode', name: 'episode', path: 'episode.mp4', hash: 'episode', kind: 'video', status: 'ok', importedAt: '', tags: [], favorite: false,
    probe: { container: 'mp4', durationUs: 30 * S, sizeBytes: 10, bitRate: null, video: null, audio: [], subtitles: [], tags: {} },
  });
  const audio = AssetSchema.parse({
    id: 'song', name: 'song', path: 'song.mp3', hash: 'song', kind: 'audio', status: 'ok', importedAt: '', tags: [], favorite: false,
    probe: { container: 'mp3', durationUs: 30 * S, sizeBytes: 10, bitRate: null, video: null, audio: [], subtitles: [], tags: {} },
  });
  project = applyCommand(project, { type: 'asset.add', asset: video }).project;
  project = applyCommand(project, { type: 'asset.add', asset: audio }).project;
  const clip = (id: string, trackId: string, assetId: string | null, start: number, duration: number, extra: Record<string, unknown> = {}) =>
    ClipSchema.parse({
      id, trackId, assetId, timelineStartUs: start * S, durationUs: duration * S, sourceInUs: start * S, sourceOutUs: (start + duration) * S,
      ...extra,
    });
  const selectedClip = clip('selected', videoTrack.id, video.id, 0, 10, {
    origin: 'user',
    transform: { x: 24, y: -8, scale: 1.2, rotation: 2, opacity: 0.9 },
    audio: { gainDb: -12, fadeInUs: 100_000, fadeOutUs: 300_000, pitchSemitones: 2 },
    effects: [{ id: 'manual-glow', effect: 'glow', enabled: true, params: { strength: 0.4 } }],
    keyframes: { 'transform.x': [{ atUs: 2 * S, value: 24, easing: 'linear' }, { atUs: 8 * S, value: 48, easing: 'ease-in' }] },
    transitionIn: { transition: 'dissolve', durationUs: S, params: {} },
  });
  const outsideClip = clip('outside', videoTrack.id, video.id, 12, 3, {
    origin: 'user',
    transform: { x: 9, y: 7, scale: 1.5, rotation: 0, opacity: 1 },
    effects: [{ id: 'outside-effect', effect: 'shake', enabled: true, params: { intensity: 3 } }],
    keyframes: { 'transform.y': [{ atUs: S, value: 7, easing: 'hold' }] },
  });
  const musicClip = clip('music', audioTrack.id, audio.id, 0, 20, {
    audio: { gainDb: -6, fadeInUs: 250_000, fadeOutUs: 500_000, pitchSemitones: 0 },
    keyframes: { 'audio.gainDb': [{ atUs: 5 * S, value: -16, easing: 'linear' }] },
  });
  const subtitle = clip('subtitle', textTrack.id, null, 2, 4, {
    text: { text: 'Não vou desistir' },
    origin: 'user',
    keyframes: { 'transform.opacity': [{ atUs: S, value: 0.5, easing: 'linear' }] },
  });
  for (const item of [selectedClip, outsideClip, musicClip, subtitle]) {
    project = applyCommand(project, { type: 'clip.add', clip: item }).project;
  }
  const generated = (id: string, start: number, duration: number): Clip => ClipSchema.parse({
    ...clip(id, videoTrack.id, video.id, start, duration, {
      origin: 'ai',
      reason: `cena regenerada ${id}`,
      effects: [{ id: `${id}-flash`, effect: 'flash', enabled: true, params: { strength: 1 } }],
    }),
    timelineStartUs: start * S,
  });
  return { project, videoTrackId: videoTrack.id, selectedClip, outsideClip, musicClip, subtitle, generated };
}

describe('regeneração localizada não destrutiva', () => {
  it('mantém sem alterações clipes, legendas e áudio fora da seleção e só substitui os clipes alvo', () => {
    const { project, videoTrackId, selectedClip, outsideClip, musicClip, subtitle, generated } = fixture();
    const proposal = prepareLocalizedRegeneration(project, [generated('new-a', 0, 4), generated('new-b', 4, 10)], {
      startUs: 0,
      endUs: 10 * S,
      trackId: videoTrackId,
      replaceClipIds: [selectedClip.id],
    });
    const next = applyCommand(project, { type: 'batch', commands: proposal.commands }).project;

    expect(next.clips.find((clip) => clip.id === outsideClip.id)).toEqual(outsideClip);
    expect(next.clips.find((clip) => clip.id === musicClip.id)).toEqual(musicClip);
    expect(next.clips.find((clip) => clip.id === subtitle.id)).toEqual(subtitle);
    expect(next.clips.some((clip) => clip.id === selectedClip.id)).toBe(false);
    expect(next.clips.filter((clip) => clip.origin === 'ai' && clip.trackId === videoTrackId)).toHaveLength(2);
    expect(proposal.replaced).toBe(1);
    expect(proposal.added).toBe(2);
  });

  it('conserva keyframes, transformações, áudio, efeitos e transição manual do clipe selecionado', () => {
    const { project, videoTrackId, selectedClip, generated } = fixture();
    const proposal = prepareLocalizedRegeneration(project, [generated('new', 0, 10)], {
      startUs: 0,
      endUs: 10 * S,
      trackId: videoTrackId,
      replaceClipIds: [selectedClip.id],
    });
    const replacement = applyCommand(project, { type: 'batch', commands: proposal.commands }).project.clips.find((clip) => clip.id === 'new')!;

    expect(replacement.transform).toEqual(selectedClip.transform);
    expect(replacement.audio).toEqual(selectedClip.audio);
    expect(replacement.effects.find((effect) => effect.effect === 'glow')?.params).toEqual({ strength: 0.4 });
    expect(replacement.keyframes['transform.x']).toEqual(selectedClip.keyframes['transform.x']);
    expect(replacement.transitionIn).toEqual(selectedClip.transitionIn);
    expect(replacement.effects.some((effect) => effect.effect === 'flash')).toBe(true);
  });

  it('preserva as partes externas e reparte corretamente os keyframes de um clipe selecionado na borda', () => {
    const { project, videoTrackId, generated } = fixture();
    const proposal = prepareLocalizedRegeneration(project, [generated('candidate', 0, 5)], {
      startUs: 3 * S,
      endUs: 8 * S,
      trackId: videoTrackId,
      replaceClipIds: ['selected'],
    });
    const next = applyCommand(project, { type: 'batch', commands: proposal.commands }).project;
    const fragments = next.clips.filter((clip) => clip.id === 'selected' || (clip.trackId === videoTrackId && clip.origin === 'user' && clip.timelineStartUs >= 8 * S));
    const left = next.clips.find((clip) => clip.id === 'selected')!;
    const right = fragments.find((clip) => clip.timelineStartUs === 8 * S)!;

    expect(left.durationUs).toBe(3 * S);
    expect(left.keyframes['transform.x']).toEqual([
      { atUs: 0, value: 24, easing: 'linear' },
      { atUs: 2 * S, value: 24, easing: 'linear' },
      { atUs: 3 * S, value: 24 + 24 / 36, easing: 'ease-in' },
    ]);
    expect(right.durationUs).toBe(2 * S);
    expect(right.sourceInUs).toBe(8 * S);
    expect(right.keyframes['transform.x']).toEqual([
      { atUs: 0, value: 48, easing: 'ease-in' },
      { atUs: 2 * S, value: 48, easing: 'ease-in' },
    ]);
    expect(next.clips.find((clip) => clip.id === 'candidate')?.timelineStartUs).toBe(3 * S);
  });

  it('não sobrepõe clipes de vídeo não selecionados dentro do intervalo', () => {
    const { project: baseProject, videoTrackId, generated } = fixture();
    const guard = ClipSchema.parse({
      id: 'unselected-anchor',
      trackId: videoTrackId,
      assetId: 'episode',
      timelineStartUs: 5 * S,
      durationUs: 2 * S,
      sourceInUs: 15 * S,
      sourceOutUs: 17 * S,
      origin: 'user',
    });
    const project = applyCommand(baseProject, { type: 'clip.add', clip: guard }).project;
    const proposal = prepareLocalizedRegeneration(project, [generated('candidate', 0, 10)], {
      startUs: 0,
      endUs: 10 * S,
      trackId: videoTrackId,
      replaceClipIds: ['selected'],
    });
    const next = applyCommand(project, { type: 'batch', commands: proposal.commands }).project;
    const generatedPieces = next.clips.filter((clip) => clip.origin === 'ai' && clip.trackId === videoTrackId);

    expect(next.clips.find((clip) => clip.id === guard.id)).toEqual(guard);
    expect(generatedPieces.map((clip) => [clip.timelineStartUs, clip.durationUs])).toEqual([[0, 5 * S], [7 * S, 3 * S]]);
  });

  it('mantém a cena original nos espaços que a geração não conseguiu preencher', () => {
    const { project, videoTrackId, generated } = fixture();
    const proposal = prepareLocalizedRegeneration(project, [generated('partial', 0, 4)], {
      startUs: 0,
      endUs: 10 * S,
      trackId: videoTrackId,
      replaceClipIds: ['selected'],
    });
    const next = applyCommand(project, { type: 'batch', commands: proposal.commands }).project;
    const retained = next.clips.find((clip) => clip.id === 'selected')!;

    expect(retained.timelineStartUs).toBe(4 * S);
    expect(retained.durationUs).toBe(6 * S);
    expect(retained.sourceInUs).toBe(4 * S);
    expect(retained.keyframes['transform.x']).toEqual([
      { atUs: 0, value: 24 + 24 / 9, easing: 'linear' },
      { atUs: 4 * S, value: 48, easing: 'ease-in' },
      { atUs: 6 * S, value: 48, easing: 'ease-in' },
    ]);
  });

  it('corta o trecho retido usando a curva de velocidade e mantém os keyframes da rampa', () => {
    const { project: baseProject, videoTrackId, generated } = fixture();
    const selected = baseProject.clips.find((clip) => clip.id === 'selected')!;
    const project = applyCommand(baseProject, {
      type: 'clip.update',
      clipId: selected.id,
      patch: {
        keyframes: { speed: [
          { atUs: 0, value: 0.5, easing: 'linear' },
          { atUs: 10 * S, value: 1.5, easing: 'linear' },
        ] },
      },
    }).project;
    const proposal = prepareLocalizedRegeneration(project, [generated('partial-ramp', 0, 4)], {
      startUs: 0,
      endUs: 10 * S,
      trackId: videoTrackId,
      replaceClipIds: ['selected'],
    });
    const next = applyCommand(project, { type: 'batch', commands: proposal.commands }).project;
    const retained = next.clips.find((clip) => clip.id === 'selected')!;

    expect(retained.sourceInUs).toBe(2_800_000);
    expect(retained.sourceOutUs).toBe(10 * S);
    expect(retained.keyframes.speed).toEqual([
      { atUs: 0, value: 0.9, easing: 'linear' },
      { atUs: 6 * S, value: 1.5, easing: 'linear' },
    ]);
  });

  it('preserva a transição manual no mesmo instante ao dividir a alternativa', () => {
    const { project: initialProject, videoTrackId, selectedClip, generated } = fixture();
    const baseProject = applyCommand(initialProject, { type: 'clip.remove', clipId: selectedClip.id }).project;
    const selected = ClipSchema.parse({
      id: 'transitioned',
      trackId: videoTrackId,
      assetId: 'episode',
      timelineStartUs: 3 * S,
      durationUs: 4 * S,
      sourceInUs: 3 * S,
      sourceOutUs: 7 * S,
      transitionIn: { transition: 'dissolve', durationUs: S, params: {} },
    });
    const project = applyCommand(baseProject, { type: 'clip.add', clip: selected }).project;
    const proposal = prepareLocalizedRegeneration(project, [generated('full-candidate', 0, 10)], {
      startUs: 0,
      endUs: 10 * S,
      trackId: videoTrackId,
      replaceClipIds: [selected.id],
    });
    const next = applyCommand(project, { type: 'batch', commands: proposal.commands }).project;
    const atTransition = next.clips.find((clip) => clip.timelineStartUs === 3 * S && clip.origin === 'ai')!;

    expect(atTransition.transitionIn).toEqual(selected.transitionIn);
  });

  it('falha antes de produzir uma transação se não há espaço sem substituir seleção de terceiros', () => {
    const { project: baseProject, videoTrackId, generated } = fixture();
    const guard = ClipSchema.parse({
      id: 'unselected-anchor',
      trackId: videoTrackId,
      assetId: 'episode',
      timelineStartUs: 0,
      durationUs: 10 * S,
      sourceInUs: 15 * S,
      sourceOutUs: 25 * S,
      origin: 'user',
    });
    const project = applyCommand(baseProject, { type: 'clip.add', clip: guard }).project;
    expect(() => prepareLocalizedRegeneration(project, [generated('candidate', 0, 10)], {
      startUs: 0,
      endUs: 10 * S,
      trackId: videoTrackId,
      replaceClipIds: ['selected'],
    })).toThrow(/Não há cenas candidatas/);
    expect(project.clips.find((clip) => clip.id === guard.id)).toEqual(guard);
  });

  it('aplica como um único passo de undo/redo e restaura a timeline exata', () => {
    const { project, videoTrackId, selectedClip, generated } = fixture();
    const proposal = prepareLocalizedRegeneration(project, [generated('reversible', 0, 10)], {
      startUs: 0,
      endUs: 10 * S,
      trackId: videoTrackId,
      replaceClipIds: [selectedClip.id],
    });
    const history = new ProjectHistory(project);
    history.transaction('Regenerar intervalo', proposal.commands);
    const after = history.project;

    expect(history.undo()).toEqual(project);
    expect(history.redo()).toEqual(after);
  });

  it('mantém a timeline original se um comando da transação falhar', () => {
    const { project, videoTrackId, selectedClip, generated } = fixture();
    const proposal = prepareLocalizedRegeneration(project, [generated('atomic', 0, 10)], {
      startUs: 0,
      endUs: 10 * S,
      trackId: videoTrackId,
      replaceClipIds: [selectedClip.id],
    });
    const history = new ProjectHistory(project);

    expect(() => history.transaction('Regeneração inválida', [
      ...proposal.commands,
      { type: 'clip.remove', clipId: 'missing-clip' },
    ])).toThrow(/clipe não encontrado/);
    expect(history.project).toBe(project);
    expect(history.version).toBe(0);
  });
});
