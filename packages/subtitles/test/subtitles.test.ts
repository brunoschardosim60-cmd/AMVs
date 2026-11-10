import { describe, expect, it } from 'vitest';
import { applyCommand, clipEndUs, createProject, findOverlaps, type Asset, type Clip, type Project } from '@amv/project';
import { alignUntimedLyrics, applyTranslation, editSubtitleTextManually, langLabel, originalText, restoreOriginals, selectSubtitleTextVariant, SUBTITLE_LANGS, cuesForClip, normalizeCues, placeCues, pullClipSubtitles, readability, restyleSubtitles, shiftSubtitles, subtitleClips, toLrc, toVtt, trackCues } from '../src/index.js';

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
  it('alinha linhas de letra com palavras transcritas, reportando linhas incertas e ausentes', () => {
    const result = alignUntimedLyrics('Quando eu cair\nvou me levantar\nlinha que não existe', [
      { start: 1, end: 1.2, text: 'Quando' },
      { start: 1.2, end: 1.4, text: 'eu' },
      { start: 1.4, end: 1.6, text: 'caí' },
      { start: 2, end: 2.2, text: 'vou' },
      { start: 2.2, end: 2.4, text: 'me' },
      { start: 2.4, end: 2.8, text: 'levantar' },
    ]);
    expect(result).toMatchObject({
      cues: [
        { startS: 1, endS: 1.6, text: 'Quando eu cair' },
        { startS: 2, endS: 2.8, text: 'vou me levantar' },
      ],
      matched: 2,
      uncertain: 1,
      unmatched: 1,
    });
    expect(result.cues[0]?.words?.map((word) => [word.text, word.startS, word.endS, word.source])).toEqual([
      ['Quando', 1, 1.2, 'whisper'],
      ['eu', 1.2, 1.4, 'whisper'],
      ['caí', 1.4, 1.6, 'whisper'],
    ]);
  });

  it('alinha letra japonesa caractere a caractere sem confundir linhas repetidas fora de ordem', () => {
    const result = alignUntimedLyrics('夢を\nつかめ\n夢を', [
      { start: 1, end: 1.8, text: '夢 を' },
      { start: 3, end: 3.8, text: 'つかめ' },
      { start: 5, end: 5.8, text: '夢 を' },
    ]);
    expect(result.cues.map((cue) => [cue.startS, cue.endS, cue.text])).toEqual([
      [1, 1.8, '夢を'],
      [3, 3.8, 'つかめ'],
      [5, 5.8, '夢を'],
    ]);
    expect(result.unmatched).toBe(0);
  });

  it('não força alinhar uma letra que não se parece com a transcrição', () => {
    const result = alignUntimedLyrics('Essa letra é diferente', [{ start: 4, end: 5, text: 'palavras aleatórias' }]);
    expect(result.cues).toEqual([]);
    expect(result.unmatched).toBe(1);
  });

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

  it('conserva os timestamps e a origem das palavras como dados relativos ao clipe', () => {
    let p = project();
    const commands = placeCues(p, [{
      startS: 2,
      endS: 3,
      text: 'Eu vou',
      words: [
        { startS: 2, endS: 2.4, text: 'Eu', source: 'ass', confidence: 1 },
        { startS: 2.4, endS: 2.8, text: 'vou', source: 'whisper', confidence: 0.9 },
      ],
    }], { trackId: textTrack(p), offsetUs: S, look: 'lyrics-cinematic' });
    p = apply(p, commands);
    const created = subtitleClips(p, textTrack(p))[0]!;
    expect(created.timelineStartUs).toBe(3 * S);
    expect(created.text?.timingPrecision).toBe('word');
    expect(created.text?.wordTimings.map(({ text, startUs, endUs, source }) => [text, startUs, endUs, source])).toEqual([
      ['Eu', 0, 0.4 * S, 'ass'],
      ['vou', 0.4 * S, 0.8 * S, 'whisper'],
    ]);
  });

  it('preserva tempos silábicos confiáveis ASS e mantém a evidência de origem', () => {
    let p = project();
    p = apply(p, placeCues(p, [{
      startS: 2,
      endS: 3,
      text: 'vencer',
      words: [{
        startS: 2,
        endS: 2.5,
        text: 'vencer',
        source: 'ass',
        confidence: 1,
        syllables: [
          { text: 'ven', startS: 2, endS: 2.2, source: 'ass', confidence: 1 },
          { text: 'cer', startS: 2.2, endS: 2.5, source: 'ass', confidence: 1 },
        ],
      }],
    }], { trackId: textTrack(p), offsetUs: S, look: 'section-chorus' }));
    const created = subtitleClips(p, textTrack(p))[0]!;
    expect(created.text?.section).toBe('chorus');
    expect(created.text?.wordTimings[0]).toMatchObject({
      source: 'ass',
      confidence: 1,
      syllables: [
        { text: 'ven', startUs: 0, endUs: 200_000, source: 'ass', confidence: 1 },
        { text: 'cer', startUs: 200_000, endUs: 500_000, source: 'ass', confidence: 1 },
      ],
    });
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
      id, trackId: v1, assetId: 'ep', timelineStartUs: at * S, durationUs: 2 * S, sourceInUs: src * S, sourceOutUs: (src + 2) * S, speed: 1, reverse: false,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } }, blendMode: 'normal', mask: 'none', groupId: null,
      audio: { gainDb: 0, fadeInUs: 0, fadeOutUs: 0, pitchSemitones: 0, pitchMode: 'preserve', streamIndex: null }, effects: [], transitionIn: null, keyframes: {}, text: null, origin: 'user', reason: null, confidence: null, label: null,
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

describe('idioma das legendas', () => {
  const setup = () => {
    let p = project();
    const tr = textTrack(p);
    p = apply(p, placeCues(p, [{ startS: 0, endS: 2, text: 'Eu vou vencer!' }, { startS: 3, endS: 5, text: 'Não desisto' }], { trackId: tr, offsetUs: 0, look: 'legenda' }));
    return { p, tr };
  };

  it('traduz guardando o original; um desfazer só; tempo e estilo intactos', () => {
    const { p, tr } = setup();
    const before = subtitleClips(p, tr);
    const out = apply(p, applyTranslation(before, ['I will win!', 'I won’t give up'], 'en'));
    const after = subtitleClips(out, tr);
    expect(after.map((c) => c.text!.text)).toEqual(['I will win!', 'I won’t give up']);
    expect(after.map((c) => originalText(c))).toEqual(['Eu vou vencer!', 'Não desisto']);
    expect(after.every((c) => c.text!.lang === 'en')).toBe(true);
    expect(after.map((c) => [c.timelineStartUs, c.durationUs, c.text!.size])).toEqual(before.map((c) => [c.timelineStartUs, c.durationUs, c.text!.size]));
    expect(trackCues(out, tr).map((c) => c.text)).toEqual(['I will win!', 'I won’t give up']); // exportar sai no idioma novo
  });

  it('trocar de idioma parte do original, não da tradução anterior', () => {
    const { p, tr } = setup();
    let out = apply(p, applyTranslation(subtitleClips(p, tr), ['I will win!', 'x'], 'en'));
    out = apply(out, applyTranslation(subtitleClips(out, tr), ['¡Voy a ganar!', 'y'], 'es'));
    const c = subtitleClips(out, tr)[0]!;
    expect(c.text).toMatchObject({
      text: '¡Voy a ganar!',
      original: 'Eu vou vencer!',
      lang: 'es',
      textSource: 'translation',
      translations: { en: 'I will win!', es: '¡Voy a ganar!' },
    });
  });

  it('mantém original, traduções e edição manual como variantes independentes', () => {
    const { p, tr } = setup();
    let out = apply(p, applyTranslation(subtitleClips(p, tr), ['I will win!', null], 'en'));
    let clip = subtitleClips(out, tr)[0]!;
    const manual = editSubtitleTextManually({
      ...clip.text!,
      wordTimings: [{ text: 'I', startUs: 0, endUs: 100_000, source: 'manual', confidence: 1, uncertain: false, syllables: [] }],
      timingPrecision: 'word',
    }, 'Eu vou vencer!');
    expect(manual.wordTimings).toEqual([]);
    expect(manual.timingPrecision).toBe('segment');
    out = apply(out, [{ type: 'clip.update', clipId: clip.id, patch: { text: manual } }]);
    clip = subtitleClips(out, tr)[0]!;
    expect(clip.text).toMatchObject({
      text: 'Eu vou vencer!',
      original: 'Eu vou vencer!',
      manualText: 'Eu vou vencer!',
      translations: { en: 'I will win!' },
      textSource: 'manual',
    });
    const english = selectSubtitleTextVariant(clip.text!, { type: 'translation', lang: 'en' });
    expect(english).toMatchObject({ text: 'I will win!', textSource: 'translation', lang: 'en' });
    const original = selectSubtitleTextVariant(english, { type: 'original' });
    expect(original).toMatchObject({ text: 'Eu vou vencer!', textSource: 'original' });
    const manualAgain = selectSubtitleTextVariant(original, { type: 'manual' });
    expect(manualAgain).toMatchObject({ text: 'Eu vou vencer!', textSource: 'manual' });
  });

  it('linha que falhou (null) ou vazia mantém o texto', () => {
    const { p, tr } = setup();
    const out = apply(p, applyTranslation(subtitleClips(p, tr), [null, '  '], 'en'));
    expect(subtitleClips(out, tr).map((c) => c.text!.text)).toEqual(['Eu vou vencer!', 'Não desisto']);
    expect(applyTranslation(subtitleClips(p, tr), [null, null], 'en')).toEqual([]);
  });

  it('voltar ao original preserva as variantes traduzidas', () => {
    const { p, tr } = setup();
    const t = apply(p, applyTranslation(subtitleClips(p, tr), ['a', 'b'], 'en'));
    const back = apply(t, restoreOriginals(subtitleClips(t, tr)));
    const c = subtitleClips(back, tr)[0]!;
    expect(c.text!.text).toBe('Eu vou vencer!');
    expect(c.text!.original).toBe('Eu vou vencer!');
    expect(c.text!.lang).toBeUndefined();
    expect(c.text!.translations).toEqual({ en: 'a' });
    expect(c.text!.textSource).toBe('original');
    expect(restoreOriginals(subtitleClips(p, tr))).toEqual([]); // nada traduzido: nada a fazer
  });

  it('lista de idiomas', () => {
    expect(SUBTITLE_LANGS.map((l) => l.code)).toEqual(expect.arrayContaining(['pt-BR', 'en', 'es', 'ja']));
    expect(langLabel('en')).toBe('Inglês');
    expect(langLabel('xx')).toBe('xx');
  });
});
