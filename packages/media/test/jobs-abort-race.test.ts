import { describe, expect, it } from 'vitest';
import { CancelledError, JobQueue } from '../src/index.js';

describe('JobQueue — cancelamento seguido de reenfileiramento imediato', () => {
  it('não reaproveita um job em execução que já recebeu abort (corrida undo + redo)', async () => {
    const queue = new JobQueue(2);
    let markStarted!: () => void;
    const firstStarted = new Promise<void>((r) => {
      markStarted = r;
    });
    let releaseFirst!: () => void;
    let runs = 0;

    const first = queue.enqueue({
      key: 'proxy:hash123',
      kind: 'proxy',
      label: 'Proxy 1',
      assetId: 'ast_1',
      run: ({ signal }) =>
        new Promise<string>((resolve, reject) => {
          runs++;
          markStarted();
          releaseFirst = () => {
            if (signal.aborted) reject(new CancelledError());
            else resolve('first-ok');
          };
        }),
    });

    await firstStarted;

    // Cancela o asset enquanto o 1º processo do FFmpeg ainda está em status 'running'
    queue.cancelAsset('ast_1');

    // Reenfileira imediatamente a mesma chave (como em redo() logo após undo())
    const second = queue.enqueue({
      key: 'proxy:hash123',
      kind: 'proxy',
      label: 'Proxy 2',
      assetId: 'ast_1',
      run: async ({ signal }) => {
        runs++;
        if (signal.aborted) throw new CancelledError();
        return 'second-ok';
      },
    });

    expect(second.id).not.toBe(first.id);
    releaseFirst();

    await expect(first.promise).rejects.toBeInstanceOf(CancelledError);
    await expect(second.promise).resolves.toBe('second-ok');
    expect(runs).toBe(2);
  });
});
