import { describe, expect, it } from 'vitest';
import type { ProcessRunner } from '@amv/media';
import { AssetSchema, ClipSchema, createProject, TextContentSchema } from '@amv/project';
import { planWindows } from '../src/plan.js';
import { availableHardwareEncoders, encodingArgs, resolveVideoEncoder, type VideoEncoding } from '../src/video.js';

const fps = { num: 30000, den: 1001 };

describe('codificação de vídeo', () => {
  it('gera argumentos de CRF e bitrate para CPU sem presumir encoder de hardware', () => {
    const crf = encodingArgs({ codec: 'h264', quality: 1, encoder: 'cpu', crf: 19 }, fps);
    expect(crf).toContain('libx264');
    expect(crf).toContain('19');
    expect(crf).toContain('60'); // GOP de aproximadamente dois segundos a 29,97 fps

    const bitrate = encodingArgs({
      codec: 'h265', quality: 0, encoder: 'cpu', rateControl: 'bitrate', bitrateK: 4200,
    }, fps);
    expect(bitrate).toContain('libx265');
    expect(bitrate).toContain('4200k');
    expect(bitrate).toContain('hvc1');
    expect(bitrate).not.toContain('-crf');
  });

  it('automaticamente escolhe somente um encoder de hardware que passe no teste curto', async () => {
    const calls: string[] = [];
    const runner: ProcessRunner = {
      run: async (_tool, args) => {
        calls.push(args.join(' '));
        if (args.includes('-encoders')) return {
          code: 0, stdout: ' V..... h264_amf AMD AMF H.264\n V..... h264_nvenc NVIDIA NVENC H.264\n', stderr: '',
        };
        if (args.includes('h264_amf')) return { code: 1, stdout: '', stderr: 'AMF initialization failed' };
        if (args.includes('h264_nvenc')) return { code: 0, stdout: '', stderr: '' };
        return { code: 1, stdout: '', stderr: 'unexpected command' };
      },
    };
    const encoding: VideoEncoding = { codec: 'h264', quality: 0, encoder: 'auto' };
    await expect(availableHardwareEncoders(runner, 'h264')).resolves.toEqual(['nvenc']);
    await expect(resolveVideoEncoder(runner, encoding)).resolves.toBe('nvenc');
    expect(calls.some((call) => call.includes('h264_amf'))).toBe(true);
    expect(calls.some((call) => call.includes('h264_nvenc'))).toBe(true);
  });

  it('faz fallback para CPU quando o build ou driver não oferece hardware testado', async () => {
    const runner: ProcessRunner = {
      run: async () => ({ code: 0, stdout: ' V..... libx264 H.264\n', stderr: '' }),
    };
    await expect(resolveVideoEncoder(runner, { codec: 'h264', quality: 1, encoder: 'auto' })).resolves.toBe('cpu');
    await expect(resolveVideoEncoder(runner, { codec: 'h264', quality: 1, encoder: 'amf' })).rejects.toThrow(/não está disponível ou falhou no teste/);
  });

  it('ordena texto com behindCutout=true entre V1 e V2 (texto atrás do personagem)', () => {
    const project = createProject({ name: 'DepthText' });
    const v1 = project.tracks.find((t) => t.name === 'V1')!;
    const v2 = project.tracks.find((t) => t.name === 'V2')!;
    const textTrack = project.tracks.find((t) => t.kind === 'text')!;
    project.assets.push(AssetSchema.parse({
      id: 'ep1', name: 'ep1', path: 'ep1.mp4', hash: 'ep1', kind: 'video', status: 'ok', importedAt: '', tags: [], favorite: false, error: null,
      probe: { container: 'mp4', durationUs: 5_000_000, sizeBytes: 1, bitRate: null, video: { codec: 'h264', profile: null, width: 1920, height: 1080, pixFmt: 'yuv420p', bitDepth: 8, fps: { num: 30, den: 1 }, avgFps: null, vfr: false, frameCount: 150 }, audio: [], subtitles: [], tags: {} },
    }));
    project.clips.push(
      ClipSchema.parse({ id: 'c-v1', trackId: v1.id, assetId: 'ep1', timelineStartUs: 0, durationUs: 1_000_000, sourceInUs: 0, sourceOutUs: 1_000_000 }),
      ClipSchema.parse({ id: 'c-v2', trackId: v2.id, assetId: 'ep1', timelineStartUs: 0, durationUs: 1_000_000, sourceInUs: 0, sourceOutUs: 1_000_000, mask: 'subject-focus' }),
      ClipSchema.parse({ id: 'c-txt', trackId: textTrack.id, assetId: null, timelineStartUs: 0, durationUs: 1_000_000, sourceInUs: 0, sourceOutUs: 1_000_000, text: TextContentSchema.parse({ text: 'DROP', behindCutout: true }) }),
    );
    const { windows } = planWindows(project);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.layers.map((l) => l.clip.id)).toEqual(['c-v1', 'c-txt', 'c-v2']);
  });
});
