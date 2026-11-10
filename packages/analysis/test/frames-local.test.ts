import { describe, expect, it } from 'vitest';
import type { ProcessRunner, RunOptions, RunResult, Tool } from '@amv/media';
import { grabFrameRgb } from '../src/frames.js';

class RgbRunner implements ProcessRunner {
  args: string[] = [];

  async run(tool: Tool, args: string[], options: RunOptions = {}): Promise<RunResult> {
    expect(tool).toBe('ffmpeg');
    this.args = args;
    options.onStdoutBytes?.(new Uint8Array(160 * 90 * 3).fill(127));
    return { code: 0, stdout: '', stderr: '' };
  }
}

describe('extração RGB para visão local', () => {
  it('retorna quadro reduzido diretamente em pixels e não inicia outro processo', async () => {
    const runner = new RgbRunner();
    const frame = await grabFrameRgb(runner, 'episode.mkv', 12.345, 160);

    expect(frame).toMatchObject({ width: 160, height: 90 });
    expect(frame.data.length).toBe(160 * 90 * 3);
    expect(runner.args).toContain('12.345');
    expect(runner.args).toContain('rawvideo');
    expect(runner.args).toContain('rgb24');
  });

  it('respeita cancelamento antes de devolver os bytes', async () => {
    const runner = new RgbRunner();
    const controller = new AbortController();
    controller.abort();

    await expect(grabFrameRgb(runner, 'episode.mkv', 1, 160, controller.signal)).rejects.toMatchObject({ name: 'CancelledError' });
  });
});
