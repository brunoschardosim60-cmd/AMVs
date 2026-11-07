import { CancelledError, joinPath, ProgressParser, ToolError, type FileSystem, type ProcessRunner } from '@amv/media';
import type { Clip, Project } from '@amv/project';
import { audioArgs } from './audio.js';
import { planWindows } from './plan.js';
import { windowArgs, type AssetSource, type VideoEncoding } from './video.js';

export interface ExportSettings {
  width: number;
  height: number;
  enc: VideoEncoding;
  audioBitrateK: number;
  /** Só áudio (WAV) — para mandar a mixagem para outro programa. */
  audioOnly?: boolean;
}

export interface RenderEnv {
  runner: ProcessRunner;
  fs: FileSystem;
  /** Pasta temporária exclusiva deste render (é apagada no fim). */
  workDir: string;
  source(assetId: string): (AssetSource & { audioStreams: number[] }) | null;
  /**
   * Desenha o texto (mesmo desenho do preview) em PNG(s) W×H dentro de `dir`.
   * Devolve o caminho (padrão `%05d` se for sequência) ou null para pular.
   */
  textImage(clip: Clip, width: number, height: number, dir: string, fps: { num: number; den: number }): Promise<{ path: string; sequence: boolean } | null>;
}

export interface RenderProgress {
  fraction: number;
  stage: 'audio' | 'video' | 'mux' | 'verify';
  detail: string;
}

export interface RenderResult {
  output: string;
  durationUs: number;
  frames: number;
  windows: number;
}

export class RenderError extends Error {}

/** Mídias que faltam no disco: o render não começa sem elas. */
export function missingForRender(project: Project): string[] {
  const used = new Set(project.clips.map((c) => c.assetId).filter(Boolean));
  return project.assets.filter((a) => used.has(a.id) && a.status === 'missing').map((a) => a.name);
}

async function run(env: RenderEnv, args: string[], signal: AbortSignal | undefined, onTimeUs?: (us: number) => void): Promise<void> {
  const parser = onTimeUs ? new ProgressParser((u) => onTimeUs(u.outTimeUs)) : null;
  const r = await env.runner.run('ffmpeg', args, { signal, onStdout: parser ? (c) => parser.feed(c) : undefined });
  if (signal?.aborted) throw new CancelledError();
  if (r.code !== 0) throw new ToolError('ffmpeg', r.code, r.stderr);
}

/**
 * Exporta o projeto. Etapas: 1) mixa o áudio; 2) renderiza cada janela de vídeo;
 * 3) junta os pedaços sem recodificar e coloca o áudio; 4) confere o arquivo final.
 */
export async function renderProject(
  project: Project,
  output: string,
  settings: ExportSettings,
  env: RenderEnv,
  onProgress: (p: RenderProgress) => void,
  signal?: AbortSignal,
): Promise<RenderResult> {
  const missing = missingForRender(project);
  if (missing.length) throw new RenderError(`faltam arquivos: ${missing.join(', ')}. Localize-os antes de exportar.`);
  const fps = project.settings.fps;
  const plan = planWindows(project, fps);
  if (plan.totalFrames <= 0) throw new RenderError('a timeline está vazia');

  await env.fs.mkdir(env.workDir);
  const W = settings.width;
  const H = settings.height;
  const D = plan.durationUs;
  const totalVideoUs = plan.windows.reduce((a, w) => a + w.durUs, 0) || 1;
  const wAudio = settings.audioOnly ? 0.9 : 0.12;
  const wVideo = settings.audioOnly ? 0 : 0.83;

  try {
    // 1) áudio
    const audioPath = joinPath(env.workDir, 'audio.wav');
    onProgress({ fraction: 0, stage: 'audio', detail: 'Mixando o áudio' });
    await run(env, audioArgs({ project, durationUs: D, sampleRate: project.settings.sampleRate, output: audioPath, source: env.source }), signal, (us) =>
      onProgress({ fraction: wAudio * Math.min(1, us / D), stage: 'audio', detail: 'Mixando o áudio' }),
    );

    if (settings.audioOnly) {
      await env.fs.rename(audioPath, output);
      onProgress({ fraction: 1, stage: 'verify', detail: 'Pronto' });
      return { output, durationUs: D, frames: 0, windows: 0 };
    }

    // 2) vídeo, janela a janela
    const ext = settings.enc.codec === 'prores' ? 'mov' : 'mp4';
    const segs: string[] = [];
    let doneUs = 0;
    const textCache = new Map<string, { path: string; sequence: boolean } | null>();
    for (const w of plan.windows) {
      if (signal?.aborted) throw new CancelledError();
      const seg = joinPath(env.workDir, `seg${String(w.index).padStart(5, '0')}.${ext}`);
      for (const l of w.layers) {
        if (!l.clip.text || textCache.has(l.clip.id)) continue;
        onProgress({ fraction: wAudio + wVideo * (doneUs / totalVideoUs), stage: 'video', detail: 'Desenhando textos' });
        const dir = joinPath(env.workDir, `text-${l.clip.id}`);
        await env.fs.mkdir(dir);
        textCache.set(l.clip.id, await env.textImage(l.clip, W, H, dir, fps));
      }
      const job = windowArgs({
        project,
        window: w,
        fps,
        width: W,
        height: H,
        enc: settings.enc,
        output: seg,
        source: env.source,
        textImage: (c) => textCache.get(c.id) ?? null,
      });
      const detail = `Renderizando trecho ${w.index + 1} de ${plan.windows.length}`;
      await run(env, job.args, signal, (us) =>
        onProgress({ fraction: wAudio + wVideo * Math.min(1, (doneUs + Math.min(us, w.durUs)) / totalVideoUs), stage: 'video', detail }),
      );
      doneUs += w.durUs;
      segs.push(seg);
      onProgress({ fraction: wAudio + wVideo * (doneUs / totalVideoUs), stage: 'video', detail });
    }

    // 3) junta sem recodificar + áudio
    onProgress({ fraction: wAudio + wVideo, stage: 'mux', detail: 'Juntando vídeo e áudio' });
    const list = joinPath(env.workDir, 'lista.txt');
    const esc = (p: string) => p.replace(/\\/g, '/').replace(/'/g, "'\\''");
    await env.fs.writeFile(list, new TextEncoder().encode(segs.map((s) => `file '${esc(s)}'`).join('\n') + '\n'));
    const tmpOut = `${output}.part.${ext}`;
    const audioCodec = settings.enc.codec === 'prores' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', `${settings.audioBitrateK}k`];
    await run(
      env,
      [
        '-hide_banner', '-nostdin', '-y',
        '-f', 'concat', '-safe', '0', '-i', list,
        '-i', audioPath,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', ...audioCodec,
        '-t', String(D / 1e6),
        ...(ext === 'mp4' ? ['-movflags', '+faststart'] : []),
        '-loglevel', 'error',
        tmpOut,
      ],
      signal,
    );
    if (await env.fs.exists(output)) await env.fs.remove(output);
    await env.fs.rename(tmpOut, output);

    // 4) confere
    onProgress({ fraction: 0.98, stage: 'verify', detail: 'Conferindo o arquivo' });
    const pr = await env.runner.run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', output]);
    if (pr.code !== 0) throw new RenderError('o arquivo final não pôde ser lido');
    const info = JSON.parse(pr.stdout) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
    const got = Number(info.format?.duration ?? 0) * 1e6;
    if (!info.streams?.some((s) => s.codec_type === 'video')) throw new RenderError('o arquivo final ficou sem vídeo');
    if (Math.abs(got - D) > 0.25e6) throw new RenderError(`duração final (${(got / 1e6).toFixed(2)} s) diferente da timeline (${(D / 1e6).toFixed(2)} s)`);
    onProgress({ fraction: 1, stage: 'verify', detail: 'Pronto' });
    return { output, durationUs: D, frames: plan.totalFrames, windows: plan.windows.length };
  } finally {
    await env.fs.remove(env.workDir).catch(() => undefined);
  }
}
