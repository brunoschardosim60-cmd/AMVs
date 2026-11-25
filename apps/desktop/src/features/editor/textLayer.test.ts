import { describe, expect, it } from 'vitest';
import { createProject, evalClipLook, type TextWordTiming } from '@amv/project';
import { subtitleClip, cuesForClip, editSubtitleTextManually } from '@amv/subtitles';
import { drawTextLayer, splitOverlongText, splitTimedText, textIsAnimated } from './textLayer.js';
import { clampTimelineHeight } from './editorLayout.js';

const timing = (text: string, startUs: number): TextWordTiming => ({
  text,
  startUs,
  endUs: startUs + 200_000,
  source: 'ass',
  confidence: 1,
  uncertain: false,
  color: null,
  scale: null,
  offsetX: null,
  offsetY: null,
  weight: null,
  syllables: [],
});

describe('segmentos de texto cronometrados', () => {
  it('mantém segmentos ASS contíguos em escrita sem espaços', () => {
    expect(splitTimedText('夢をつかめ', [timing('夢を', 0), timing('つかめ', 200_000)])).toEqual([
      { text: '夢を', timingIndex: 0 },
      { text: 'つかめ', timingIndex: 1 },
    ]);
  });
  it('preserva pontuação junto da sílaba que recebeu o tempo ASS', () => {
    expect(splitTimedText('vencer!', [timing('ven', 0), timing('cer!', 200_000)])).toEqual([
      { text: 'ven', timingIndex: 0 },
      { text: 'cer!', timingIndex: 1 },
    ]);
  });
  it('não força timestamps quando os segmentos não correspondem ao texto', () => {
    expect(splitTimedText('texto atual', [timing('texto antigo', 0)])).toBeNull();
  });
  it('quebra texto japonês sem espaços dentro da largura disponível', () => {
    expect(splitOverlongText('夢をつかめ', 2, (value) => Array.from(value).length)).toEqual(['夢を', 'つか', 'め']);
  });
  it('preserva um sinal combinante junto ao grafema', () => {
    const wrapped = splitOverlongText('がき', 1, (value) => Array.from(value).length);
    expect(wrapped.join('')).toBe('がき');
    expect(wrapped).toEqual(['が', 'き']);
  });
  it('preserva tokens curtos e devolve o texto completo se a largura for inválida', () => {
    expect(splitOverlongText('AMV', 4, (value) => value.length)).toEqual(['AMV']);
    expect(splitOverlongText('AMV', 0, (value) => value.length)).toEqual(['AMV']);
  });
});

describe('subtitle preview/export parity', () => {
  it('keeps timed Japanese parts after applying uppercase impact styling', () => {
    const words = ['Go', '未来'].map((text) => timing(text, 0));
    expect(splitTimedText('GO未来', words)).toEqual([{ text: 'GO', timingIndex: 0 }, { text: '未来', timingIndex: 1 }]);
  });
  it('applies output scaling once and advances whitespace once', () => {
    const project = createProject({ name: 'Text' });
    const clip = subtitleClip(project, 'text', 0, 3e6, 'Hello world', 'legenda');
    if (!clip.text) throw new Error('Missing text');
    clip.text.animationIn = null;
    const positions: number[] = [];
    const fonts: string[] = [];
    const ctx = { canvas: { width: 960, height: 540 }, font: '', globalAlpha: 1, save() {}, restore() {}, translate() {}, rotate() {}, measureText: (text: string) => ({ width: text.length * 10 }), fillText(_text: string, x: number) { positions.push(x); fonts.push(this.font); }, strokeText() {} };
    drawTextLayer(ctx as unknown as CanvasRenderingContext2D, clip, 1920, 1080, 0.5, evalClipLook(clip, 1, 3), 1);
    expect(fonts[0]).toContain(`${clip.text.size * 0.5}px`);
    expect((positions[1] ?? 0) - (positions[0] ?? 0)).toBe(60);
  });
  it('exports opacity keyframes as animation', () => {
    const clip = subtitleClip(createProject({ name: 'Opacity' }), 'text', 0, 3e6, 'Hello', 'legenda');
    clip.keyframes['transform.opacity'] = [{ atUs: 0, value: 0, easing: 'linear' }, { atUs: 1e6, value: 1, easing: 'linear' }];
    expect(textIsAnimated(clip)).toBe(true);
  });
  it('applies half opacity once rather than squaring it', () => {
    const clip = subtitleClip(createProject({ name: 'Alpha' }), 'text', 0, 3e6, 'Hello', 'legenda');
    if (!clip.text) throw new Error('Missing text');
    clip.text.animationIn = null;
    clip.transform.opacity = 0.5;
    const ctx = { canvas: { width: 960, height: 540 }, globalAlpha: 1, save() {}, restore() {}, translate() {}, rotate() {}, measureText: (text: string) => ({ width: text.length * 10 }), fillText() {}, strokeText() {} };
    drawTextLayer(ctx as unknown as CanvasRenderingContext2D, clip, 1920, 1080, 0.5, evalClipLook(clip, 1, 3), 1);
    expect(ctx.globalAlpha).toBe(0.5);
  });
  it('maps lyrics through trimming, speed and reverse rather than an offset', () => {
    const clip = subtitleClip(createProject({ name: 'Mapping' }), 'music', 5e6, 4e6, 'Music', 'legenda');
    Object.assign(clip, { sourceInUs: 10e6, sourceOutUs: 18e6, speed: 2 });
    expect(cuesForClip(clip, [{ startS: 12, endS: 14, text: 'Line' }])[0]).toMatchObject({ startS: 6, endS: 7 });
    clip.reverse = true;
    expect(cuesForClip(clip, [{ startS: 12, endS: 14, text: 'Line' }])[0]).toMatchObject({ startS: 7, endS: 8 });
  });
  it('manual edits preserve the original and invalidate stale karaoke timing', () => {
    const clip = subtitleClip(createProject({ name: 'Manual' }), 'text', 0, 3e6, 'Original', 'legenda');
    if (!clip.text) throw new Error('Missing text');
    const edited = editSubtitleTextManually(clip.text, 'Edited');
    expect(edited.textSource).toBe('manual');
    expect(edited.original).toBe('Original');
    expect(edited.wordTimings).toEqual([]);
  });
  it('keeps a preview area when the workspace shrinks', () => {
    expect(clampTimelineHeight(500, 600)).toBe(320);
    expect(clampTimelineHeight(500, 300)).toBe(96);
  });
  it('renders pro typography effects (3D extrude, RGB split, outer outline, hero word, hollow video-blend, estimateTextBounds)', () => {
    const project = createProject({ name: 'ProText' });
    const clip = subtitleClip(project, 'text', 0, 2e6, 'Nunca vou recuar', 'anime-impact');
    expect(clip.text?.font).toBe('Russo One');
    expect(clip.text?.heroFont).toBe('Permanent Marker');
    expect(clip.text?.heroWord).toBe(true);
    expect(clip.text?.extrudeDepth).toBeGreaterThan(0);
    expect(textIsAnimated(clip)).toBe(true);
    const fontsUsed: string[] = [];
    const strokes: string[] = [];
    const ctx = {
      canvas: { width: 1920, height: 1080 },
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      measureText: (text: string) => ({ width: text.length * 14 }),
      fillText() { fontsUsed.push(this.font); },
      strokeText() { strokes.push(String(this.strokeStyle)); },
    };
    drawTextLayer(ctx as unknown as CanvasRenderingContext2D, clip, 1920, 1080, 1, evalClipLook(clip, 0.1, 2), 0.1);
    expect(fontsUsed.some((f) => f.includes('Russo One'))).toBe(true);
    expect(fontsUsed.some((f) => f.includes('Permanent Marker'))).toBe(true);
    expect(strokes).toContain('#ff3355');

    const blendClip = subtitleClip(project, 'text', 0, 2e6, 'Pele clara', 'anime-blend');
    expect(blendClip.blendMode).toBe('difference');
    expect(blendClip.text?.fillStyle).toBe('hollow');
    expect(blendClip.text?.heroItalic).toBe(true);
    drawTextLayer(ctx as unknown as CanvasRenderingContext2D, blendClip, 1920, 1080, 1, evalClipLook(blendClip, 0.2, 2), 0.2);
    expect(fontsUsed.some((f) => f.includes('italic') && f.includes('Playfair Display Variable'))).toBe(true);
  });
});
