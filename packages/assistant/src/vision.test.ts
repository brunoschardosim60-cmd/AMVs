import { describe, expect, it } from 'vitest';
import { labelScenes } from './vision';
import type { FetchLike } from './providers';

describe('semantic vision roundtrip', () => {
  it('preserves framing, faces and expressions returned by the configured model', async () => {
    const fetch: FetchLike = async () => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify([{ i: 1, characters: ['garoto'], fight: false, sceneType: 'reaction', framing: 'close-up', framingConfidence: 0.9, faceCount: 1, expressions: [{ label: 'tristeza', confidence: 0.8 }], confidence: 0.85, note: 'olhar triste' }]) } }] }) });
    const result = await labelScenes({ name: 'Ollama', kind: 'openai', needsKey: false, model: 'local-vision', baseUrl: 'http://localhost:11434/v1' }, null, fetch, [{ id: 't0', jpegBase64: 'ZmFrZQ==' }]);
    expect(result.labels.t0).toMatchObject({ sceneType: 'reaction', sceneTypeConfidence: 0.85, framing: 'close-up', framingConfidence: 0.9, faceCount: 1, expressions: [{ label: 'tristeza', confidence: 0.8 }] });
  });
});