import { describe, expect, it } from 'vitest';
import type { ProcessRunner } from '@amv/media';
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
});
