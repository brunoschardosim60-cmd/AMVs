import { describe, expect, it } from 'vitest';
import { applyCommand, clipEndUs, createProject, findOverlaps, type Asset, type Clip, type Project } from '@amv/project';
import { cuesForClip, normalizeCues, placeCues, pullClipSubtitles, readability, restyleSubtitles, shiftSubtitles, subtitleClips, toLrc, toVtt, trackCues } from '../src/index.js';

const S = 1_000_000;
function project(): Project {
  let p = createProject({ name: 't', settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 } } });
  const a: Asset = { id: 'ep', name: 'ep', path: '/ep', hash: 'h', kind: 'video', status: 'ok', error: null, importedAt: '', tags: [], favorite: false, probe: null };
  p = applyCommand(p, { type: 'asset.add', asset: a }).project;
  return p;
}
const apply = (p: Project, commands: Parameters<typeof applyCommand>[1][]) => applyCommand(p, { type: 'batch', commands }).project;
const textTrack = (p: Project) => p.tracks.find((t) => t.kind === 'text')!.id;

describe('legendas na timeline', () => {
  it('normaliza: ordena, tira vazias e corta sobreposição', () => {
    const n = normalizeCues([
      { startS: 5, endS: 7, text: 'b' },
      { startS: 1, endS: 6, text: 'a' },
      { startS: 8, endS: 9, text: '  ' },
    ]);
    expect(n).toEqual([{ startS: 1, endS: 5, text: 'a' }, { startS: 5, endS: 7, text: 'b' }]);
  });

  it('coloca com deslocamento e substitui o que já estava no trecho', () => {
    let p = project();
    const tr = textTrack(p);
    p = apply(p, placeCues(p, [{ startS: 0, endS: 2, text: 'velha' }, { startS: 10, endS: 11, text: 'fica' }], { trackId: tr, offsetUs: 0, look: 'legenda' }));
    p = apply(p, placeCues(p, [{ startS: 0, endS: 1, text: 'um' }, { startS: 1, endS: 2.5, text: 'dois' }], { trackId: tr, offsetUs: 1 * S, look: 'karaoke' }));
    const texts = subtitleClips(p, tr).map((c) => [c.timelineStartUs / S, clipEndUs(c) / S, c.text!.text]);
    expect(texts).toEqual([[0, 1, 'velha'], [1, 2, 'um'], [2, 3.5, 'dois'], [10, 11, 'fica']]);
    expect(findOverlaps(p)).toEqual([]);
  });

  it('falas do episódio caem no lugar certo do clipe, inclusive em câmera lenta', () => {
    const clip = { timelineStartUs: 10 * S, sourceInUs: 100 * S, sourceOutUs: 104 * S, speed: 0.5 } as Clip;
    const cues = cuesForClip(clip, [
      { startS: 99, endS: 101, text: 'corta o começo' },
      { startS: 102, endS: 103, text: 'meio' },
      { startS: 110, endS: 111, text: 'fora' },
    ]);
    expect(cues).toEqual([
      { startS: 10, endS: 12, text: 'corta o começo' },
      { startS: 14, endS: 16, text: 'meio' },
    ]);
  });

  it('puxa as legendas dos clipes selecionados', () => {
    let p = project();
    const v1 = p.tracks.find((t) => t.name === 'V1')!.id;
    const mk = (id: string, at: number, src: number): Clip => ({
      id, trackId: v1, assetId: 'ep', timelineStartUs: at * S, durationUs: 2 * S, sourceInUs: src * S, sourceOutUs: (src + 2) * S, speed: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
      audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, streamIndex: null }, effects: [], transitionIn: null, keyframes: {}, text: null, origin: 'user', reason: null, confidence: null, label: null,
    });
    p = apply(p, [{ type: 'clip.add', clip: mk('a', 0, 50) }, { type: 'clip.add', clip: mk('b', 2, 20) }]);
    const cues = new Map([['ep', [{ startS: 20.5, endS: 21.5, text: 'Eu não vou perder!' }, { startS: 51, endS: 53, text: 'Agora!' }]]]);
    const r = pullClipSubtitles(p, p.clips, cues, textTrack(p), 'destaque');
    expect(r.count).toBe(2);
    p = apply(p, r.commands);
    expect(trackCues(p, textTrack(p))).toEqual([
      { startS: 1, endS: 2, text: 'Agora!' },
      { startS: 2.5, endS: 3.5, text: 'Eu não vou perder!' },
    ]);
  });

  it('deslocar nunca passa do zero; restilizar mantém o texto', () => {
    let p = project();
    const tr = textTrack(p);
    p = apply(p, placeCues(p, [{ startS: 0.3, endS: 1, text: 'a' }, { startS: 1, endS: 2, text: 'b' }], { trackId: tr, offsetUs: 0, look: 'legenda' }));
    const ids = subtitleClips(p, tr).map((c) => c.id);
    p = apply(p, shiftSubtitles(p, ids, -1 * S));
    expect(subtitleClips(p, tr).map((c) => c.timelineStartUs)).toEqual([0, 0.7 * S]);
    p = apply(p, shiftSubtitles(p, ids, 0.5 * S));
    expect(subtitleClips(p, tr)[0]!.timelineStartUs).toBe(0.5 * S);
    p = apply(p, restyleSubtitles(p, ids, 'palavra'));
    expect(subtitleClips(p, tr).map((c) => c.text!.text)).toEqual(['A', 'B']);
    expect(subtitleClips(p, tr)[0]!.text!.size).toBe(Math.round(1080 * 0.12));
  });

  it('exporta LRC e VTT; avisa legenda rápida demais', () => {
    const cues = [{ startS: 61.5, endS: 63, text: 'linha um' }];
    expect(toLrc(cues)).toBe('[01:01.50]linha um\n');
    expect(toVtt(cues)).toBe('WEBVTT\n\n00:01:01.500 --> 00:01:03.000\nlinha um\n');
    expect(readability('uma frase bem comprida para meio segundo', 0.5)).toMatch(/rápido/);
    expect(readability('ok', 1)).toBeNull();
  });
});
