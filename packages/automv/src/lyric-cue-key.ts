import type { Cue } from '@amv/analysis';

/** Chave canônica compartilhada pelo matcher e pelo planejador de slots. */
export function lyricCueKey(cue: Pick<Cue, 'startS' | 'endS' | 'text'>): string {
  const text = cue.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return Math.round(cue.startS * 100) + ':' + Math.round(cue.endS * 100) + ':' + (hash >>> 0).toString(36);
}
