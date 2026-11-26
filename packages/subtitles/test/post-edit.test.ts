import { describe, expect, it } from 'vitest';
import { applyCommand, createProject, findOverlaps } from '@amv/project';
import {
  copyClipStyleToSubtitles,
  explodeSubtitlesToWords,
  formatSubtitlesForBulkEdit,
  insertBlankSubtitleAt,
  mergeSubtitlesIntoPhrase,
  patchSubtitlesStyle,
  placeCues,
  replaceSubtitlesTextBulk,
  separateLyricsAndDialogueTracks,
  splitSubtitleAt,
  subtitleClips,
  transformSubtitlesCase,
} from '../src/index.js';

const S = 1_000_000;

describe('controles pós-geração de legendas e letras', () => {
  it('explode frase em palavras cinéticas e junta novamente em frase única com 1 desfazer', () => {
    let project = createProject({ name: 'sub-post' });
    const trackId = project.tracks.find((t) => t.kind === 'text')!.id;
    const cmds = placeCues(
      project,
      [{ startS: 1, endS: 3, text: 'Eu nunca vou desistir' }],
      { trackId, offsetUs: 0, look: 'anime-impact' },
    );
    project = applyCommand(project, { type: 'batch', commands: cmds }).project;
    const original = subtitleClips(project, trackId)[0]!;

    const exploded = explodeSubtitlesToWords(project, [original.id], { maxWordsPerChunk: 1, beatsS: [1.5, 2.0, 2.5] });
    expect(exploded.createdCount).toBe(4);
    project = applyCommand(project, { type: 'batch', commands: exploded.commands }).project;
    expect(findOverlaps(project)).toEqual([]);
    const words = subtitleClips(project, trackId);
    expect(words.map((w) => w.text?.text)).toEqual(['EU', 'NUNCA', 'VOU', 'DESISTIR']);

    const merged = mergeSubtitlesIntoPhrase(project, words.map((w) => w.id));
    expect(merged.mergedClipId).not.toBeNull();
    project = applyCommand(project, { type: 'batch', commands: merged.commands }).project;
    const afterMerge = subtitleClips(project, trackId);
    expect(afterMerge).toHaveLength(1);
    expect(afterMerge[0]!.text?.text).toBe('EU NUNCA VOU DESISTIR');
    expect(afterMerge[0]!.durationUs).toBe(2 * S);
  });

  it('divide legenda no cursor, edita letra inteira em lote e altera caixa/estilo sem perder propriedades', () => {
    let project = createProject({ name: 'sub-bulk' });
    const trackId = project.tracks.find((t) => t.kind === 'text')!.id;
    project = applyCommand(project, {
      type: 'batch',
      commands: placeCues(
        project,
        [
          { startS: 0, endS: 2, text: 'Primeira linha aqui' },
          { startS: 2.5, endS: 4.5, text: 'Segunda linha agora' },
        ],
        { trackId, offsetUs: 0, look: 'lyrics-cinematic' },
      ),
    }).project;

    const first = subtitleClips(project, trackId)[0]!;
    const split = splitSubtitleAt(project, first.id, 1 * S);
    project = applyCommand(project, { type: 'batch', commands: split.commands }).project;
    expect(subtitleClips(project, trackId)).toHaveLength(3);

    const formatted = formatSubtitlesForBulkEdit(subtitleClips(project, trackId));
    expect(formatted.split('\n')).toHaveLength(3);

    const bulk = replaceSubtitlesTextBulk(project, trackId, 'Verso um\nVerso dois\nVerso três\nVerso extra');
    expect(bulk.updated).toBe(3);
    expect(bulk.added).toBe(1);
    project = applyCommand(project, { type: 'batch', commands: bulk.commands }).project;
    expect(subtitleClips(project, trackId).map((c) => c.text?.text)).toEqual([
      'Verso um',
      'Verso dois',
      'Verso três',
      'Verso extra',
    ]);

    const ids = subtitleClips(project, trackId).map((c) => c.id);
    project = applyCommand(project, { type: 'batch', commands: transformSubtitlesCase(project, ids, 'upper') }).project;
    project = applyCommand(project, {
      type: 'batch',
      commands: patchSubtitlesStyle(project, ids, { font: 'Bebas Neue', zone: 'top', color: '#00f0ff' }),
    }).project;
    const styled = subtitleClips(project, trackId);
    expect(styled[0]!.text?.text).toBe('VERSO UM');
    expect(styled[0]!.text?.font).toBe('Bebas Neue');
    expect(styled[0]!.text?.color).toBe('#00f0ff');
    expect(styled[0]!.transform.y).toBeLessThan(0);

    // Copiar estilo de uma legenda para outra e inserir nova no cursor
    const inserted = insertBlankSubtitleAt(project, trackId, 10 * S, 'legenda', 'Final épico');
    project = applyCommand(project, { type: 'batch', commands: inserted.commands }).project;
    project = applyCommand(project, {
      type: 'batch',
      commands: copyClipStyleToSubtitles(project, styled[0]!.id, [inserted.clipId]),
    }).project;
    const finalClip = project.clips.find((c) => c.id === inserted.clipId)!;
    expect(finalClip.text?.font).toBe('Bebas Neue');
    expect(finalClip.text?.text).toBe('Final épico');
  });

  it('separa letras da música e legendas de fala em duas trilhas independentes', () => {
    let project = createProject({ name: 'sub-sep' });
    const trackId = project.tracks.find((t) => t.kind === 'text')!.id;
    project = applyCommand(project, {
      type: 'batch',
      commands: placeCues(
        project,
        [
          { startS: 0, endS: 2, text: 'RISE ABOVE THE STORM' },
          { startS: 3, endS: 5, text: 'Eu vou proteger meus amigos!' },
        ],
        { trackId, offsetUs: 0, look: 'anime-impact' },
      ),
    }).project;
    const [lyric, speech] = subtitleClips(project, trackId);
    project = applyCommand(project, {
      type: 'batch',
      commands: [
        { type: 'clip.update', clipId: lyric!.id, patch: { reason: 'Letra da música' } },
        { type: 'clip.update', clipId: speech!.id, patch: { reason: 'Legenda da fala' } },
      ],
    }).project;

    const sep = separateLyricsAndDialogueTracks(project);
    expect(sep.movedCount).toBe(1);
    expect(sep.dialogueTrackId).not.toBeNull();
    project = applyCommand(project, { type: 'batch', commands: sep.commands }).project;
    expect(subtitleClips(project, trackId)).toHaveLength(1);
    expect(subtitleClips(project, sep.dialogueTrackId!)).toHaveLength(1);
  });
});
