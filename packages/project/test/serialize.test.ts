import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  matchMissingAssets,
  migrate,
  parseProject,
  partialHash,
  serializeProject,
} from '../src/index.js';
import { audioAsset, baseProject, clip, track, videoAsset } from './helpers.js';

function richProject() {
  let p = baseProject();
  const v = videoAsset({
    probe: {
      container: 'matroska,webm',
      durationUs: 1_420_000_000,
      sizeBytes: 1_500_000_000,
      bitRate: 8_000_000,
      video: {
        codec: 'hevc', profile: 'Main 10', width: 1920, height: 1080, pixFmt: 'yuv420p10le', bitDepth: 10,
        fps: { num: 24000, den: 1001 }, avgFps: { num: 24000, den: 1001 }, vfr: false, frameCount: null,
      },
      audio: [{ index: 1, codec: 'aac', sampleRate: 48000, channels: 2, channelLayout: 'stereo', language: 'jpn', title: null }],
      subtitles: [{ index: 2, codec: 'ass', language: 'por', title: 'Português' }],
      tags: { title: 'Episódio 1' },
    },
  });
  const a = audioAsset();
  p = applyCommand(p, { type: 'asset.add', asset: v }).project;
  p = applyCommand(p, { type: 'asset.add', asset: a }).project;
  p = applyCommand(p, {
    type: 'clip.add',
    clip: clip(track(p, 'V1').id, v.id, {
      origin: 'ai', reason: 'Drop — cena de intensidade 0.91', confidence: 0.91,
      keyframes: { 'transform.scale': [{ atUs: 0, value: 1, easing: 'linear' }, { atUs: 500_000, value: 1.2, easing: 'ease-out' }] },
      effects: [{ id: 'fx1', effect: 'flash_white', enabled: true, params: { intensity: 0.8 } }],
    }),
  }).project;
  p = applyCommand(p, {
    type: 'clip.add',
    clip: clip(track(p, 'Legendas').id, '', {
      assetId: null,
      text: { text: 'Eu não vou perder!', font: 'Inter', size: 72, color: '#fff', outlineColor: '#000', outlineWidth: 4, shadow: true, animationIn: null, animationOut: null },
    }),
  }).project;
  return p;
}

describe('serialização', () => {
  it('round-trip: salvar e abrir devolve exatamente o mesmo projeto', () => {
    const p = richProject();
    const text = serializeProject(p);
    const r = parseProject(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project).toEqual(p);
    expect(serializeProject(r.project)).toBe(text);
  });

  it('rejeita JSON inválido, versão futura e referências quebradas com mensagem clara', () => {
    expect(parseProject('{oops')).toMatchObject({ ok: false, error: 'o arquivo não é um JSON válido' });

    const future = { ...richProject(), schemaVersion: 99 };
    const r1 = parseProject(JSON.stringify(future));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/versão mais nova/);

    const broken = richProject();
    broken.clips[0]!.trackId = 'trilha-fantasma';
    const r2 = parseProject(JSON.stringify(broken));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.details.join()).toMatch(/trilha inexistente/);

    const badTime = richProject() as unknown as { clips: { timelineStartUs: number }[] };
    badTime.clips[0]!.timelineStartUs = 1.5;
    expect(parseProject(JSON.stringify(badTime)).ok).toBe(false);
  });

  it('migrações rodam em sequência', () => {
    const migrations = {
      1: (r: Record<string, unknown>) => ({ ...r, a: 1 }),
      2: (r: Record<string, unknown>) => ({ ...r, b: (r.a as number) + 1 }),
    };
    expect(migrate({ schemaVersion: 1 }, 3, migrations)).toEqual({ schemaVersion: 3, a: 1, b: 2 });
    expect(() => migrate({ schemaVersion: 1 }, 4, migrations)).toThrow(/não há migração do formato 3/);
  });
});

describe('hash parcial e relocalização', () => {
  const makeReader = (data: Uint8Array) => async (o: number, l: number) => data.slice(o, o + l);

  it('é estável, depende do conteúdo e do tamanho', async () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    const h1 = await partialHash(big.length, makeReader(big));
    const h2 = await partialHash(big.length, makeReader(big.slice()));
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^v1:[0-9a-f]{64}$/);

    const changedTail = big.slice();
    changedTail[changedTail.length - 1] = 7;
    expect(await partialHash(changedTail.length, makeReader(changedTail))).not.toBe(h1);

    const small = new Uint8Array([1, 2, 3]);
    expect(await partialHash(3, makeReader(small))).toMatch(/^v1:/);
    expect(await partialHash(0, makeReader(new Uint8Array()))).toMatch(/^v1:/);
  });

  it('casa mídia ausente pelo hash, preferindo o mesmo nome', () => {
    const missing = [
      { id: 'a1', hash: 'v1:x', path: 'C:\\Animes\\ep01.mkv' },
      { id: 'a2', hash: 'v1:y', path: '/m/musica.flac' },
      { id: 'a3', hash: 'v1:z', path: '/m/nada.mp4' },
    ];
    const found = matchMissingAssets(missing, [
      { path: 'D:/novo/copia.mkv', name: 'copia.mkv', hash: 'v1:x' },
      { path: 'D:/novo/ep01.mkv', name: 'ep01.mkv', hash: 'v1:x' },
      { path: 'D:/novo/m.flac', name: 'm.flac', hash: 'v1:y' },
    ]);
    expect(found.get('a1')).toBe('D:/novo/ep01.mkv');
    expect(found.get('a2')).toBe('D:/novo/m.flac');
    expect(found.has('a3')).toBe(false);
  });
});
