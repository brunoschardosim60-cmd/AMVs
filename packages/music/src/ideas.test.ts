import { describe, expect, it } from 'vitest';
import { guessTheme, ideaFromOEmbed, ideaMatchesTrack, oembedUrl, parseMediaLink, upsertIdea } from './ideas';

describe('music ideas from links', () => {
  it('recognizes YouTube and Spotify links', () => {
    expect(parseMediaLink('https://youtu.be/dQw4w9WgXcQ?t=3')).toMatchObject({ service: 'youtube', kind: 'video', id: 'dQw4w9WgXcQ' });
    expect(parseMediaLink('youtube.com/shorts/dQw4w9WgXcQ')!.id).toBe('dQw4w9WgXcQ');
    expect(parseMediaLink('https://music.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG')!.kind).toBe('playlist');
    expect(parseMediaLink('https://open.spotify.com/intl-pt/track/4cOdK2wGLETKBW3PvgPWqT?si=x')).toMatchObject({ service: 'spotify', kind: 'track', url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' });
    expect(parseMediaLink('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')!.kind).toBe('playlist');
  });

  it('rejects other sites and malformed ids', () => {
    expect(parseMediaLink('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseMediaLink('https://youtu.be/curto')).toBeNull();
    expect(parseMediaLink('https://open.spotify.com/artist/4cOdK2wGLETKBW3PvgPWqT')).toBeNull();
  });

  it('builds the public oEmbed address', () => {
    expect(oembedUrl(parseMediaLink('https://youtu.be/dQw4w9WgXcQ')!)).toBe('https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ');
  });

  it('requires a title and keeps only https thumbnails', () => {
    const link = parseMediaLink('https://youtu.be/dQw4w9WgXcQ')!;
    expect(() => ideaFromOEmbed(link, {})).toThrow();
    const idea = ideaFromOEmbed(link, { title: 'Unstoppable Hero', author_name: 'X', thumbnail_url: 'http://insecure/x.jpg' }, 1);
    expect(idea).toMatchObject({ title: 'Unstoppable Hero', author: 'X', thumbnail: null, theme: 'motivacao' });
  });

  it('guesses mood only from obvious words', () => {
    expect(guessTheme('Lonely Tears')).toBe('emocional');
    expect(guessTheme('Song 2')).toBeNull();
  });

  it('matches a library track ignoring video noise', () => {
    expect(ideaMatchesTrack({ title: 'Linkin Park - Numb (Official Music Video) [4K]' }, 'Numb')).toBe(true);
    expect(ideaMatchesTrack({ title: 'Numb' }, 'Faint')).toBe(false);
  });

  it('does not duplicate the same link', () => {
    const link = parseMediaLink('https://youtu.be/dQw4w9WgXcQ')!;
    const a = ideaFromOEmbed(link, { title: 'A' }, 1);
    const b = ideaFromOEmbed(link, { title: 'A2' }, 2);
    expect(upsertIdea([a], b)).toEqual([b]);
  });
});
