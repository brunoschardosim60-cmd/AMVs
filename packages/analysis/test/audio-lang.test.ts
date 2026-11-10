import { describe, expect, it } from 'vitest';
import { languageFamily, pickAudioStreamByLanguage } from '../src/audio-lang.js';

describe('idioma de faixas de áudio', () => {
  it('prioriza o título legível quando contradiz a tag do contêiner', () => {
    const streams = [
      { index: 1, language: 'jpn', title: 'English Dub' },
      { index: 2, language: 'jpn', title: 'Japanese Original' },
    ];

    expect(pickAudioStreamByLanguage(streams, 'original')).toBe(2);
    expect(pickAudioStreamByLanguage(streams, 'pt')).toBeNull();
    expect(languageFamily('English Dub')).toBe('en');
    expect(languageFamily('Português (Brasil)')).toBe('pt');
  });

  it('reconhece códigos e nomes comuns sem inferir idioma desconhecido', () => {
    expect(languageFamily('jpn')).toBe('ja');
    expect(languageFamily('pt-BR')).toBe('pt');
    expect(languageFamily('und')).toBeNull();
  });
});
