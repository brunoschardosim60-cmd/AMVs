import { CancelledError, joinPath, ProgressParser, ToolError, type FileSystem, type ProcessRunner } from '@amv/media';
import { aggregateColorGrade, clipRamps, colorGradeCube, isColorGradeNeutral, parseRational, type Clip, type Project } from '@amv/project';
import { audioArgs, measureAudioQuality, type AudioQualityMetrics } from './audio.js';
import { planWindows } from './plan.js';
import { resolveVideoEncoder, windowArgs, type AssetSource, type ResolvedVideoEncoder, type VideoEncoding } from './video.js';

export interface ExportSettings {
  width: number;
  height: number;
  enc: VideoEncoding;
  audioBitrateK: number;
  container?: 'mp4' | 'mkv' | 'mov';
  fps?: { num: number; den: number };
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
  logPath: string;
  durationUs: number;
  frames: number;
  windows: number;
  audioMetrics: AudioQualityMetrics;
  validation: ExportValidation;
}

export interface ExportValidation {
  durationUs: number;
  width: number | null;
  height: number | null;
  fps: { num: number; den: number } | null;
  videoCodec: string | null;
  frames: number;
  audioStreams: number;
  audioSyncDifferenceUs: number;
  blackIntervals: { startUs: number; endUs: number }[];
  warnings: string[];
}

export class RenderError extends Error {
  constructor(message: string, public readonly logPath?: string, options?: ErrorOptions) {
    super(message, options);
  }
}

async function promoteValidatedOutput(env: RenderEnv, temporary: string, output: string): Promise<void> {
  const backup = `${output}.backup`;
  if (await env.fs.exists(backup)) await env.fs.remove(backup);
  const hadPreviousOutput = await env.fs.exists(output);
  if (hadPreviousOutput) await env.fs.rename(output, backup);
  try {
    await env.fs.rename(temporary, output);
  } catch (error) {
    if (hadPreviousOutput) {
      try {
        await env.fs.rename(backup, output);
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], `Não foi possível instalar o render validado nem restaurar o arquivo anterior ${backup}.`);
      }
    }
    throw error;
  }
  if (hadPreviousOutput) await env.fs.remove(backup);
}

/** Mídias que faltam no disco: o render não começa sem elas. */
export function missingForRender(project: Project): string[] {
  const used = new Set(project.clips.map((c) => c.assetId).filter(Boolean));
  return project.assets.filter((a) => used.has(a.id) && a.status === 'missing').map((a) => a.name);
}

async function run(
  env: RenderEnv,
  args: string[],
  signal: AbortSignal | undefined,
  onTimeUs?: (us: number) => void,
  onLog?: (chunk: string) => void,
): Promise<void> {
  const parser = onTimeUs ? new ProgressParser((u) => onTimeUs(u.outTimeUs)) : null;
  const r = await env.runner.run('ffmpeg', args, {
    signal,
    onStdout: parser ? (c) => parser.feed(c) : undefined,
    onStderr: onLog,
  });
  if (signal?.aborted) throw new CancelledError();
  if (r.code !== 0) throw new ToolError('ffmpeg', r.code, r.stderr);
}

function rationalDistance(a: { num: number; den: number }, b: { num: number; den: number }): number {
  return Math.abs(a.num / a.den - b.num / b.den);
}

interface OutputStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
  nb_read_frames?: string;
}

function blackIntervals(stderr: string): ExportValidation['blackIntervals'] {
  const intervals: ExportValidation['blackIntervals'] = [];
  const expression = /black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g;
  for (const match of stderr.matchAll(expression)) {
    intervals.push({ startUs: Math.round(Number(match[1]) * 1e6), endUs: Math.round(Number(match[2]) * 1e6) });
  }
  return intervals;
}

function expectedBlackIntervals(windows: ReturnType<typeof planWindows>['windows']): { startUs: number; endUs: number }[] {
  const expected = windows
    .filter((window) => window.layers.length === 0)
    .map((window) => ({ startUs: window.startUs, endUs: window.startUs + window.durUs }));
  const seen = new Set<string>();
  for (const window of windows) {
    for (const layer of window.layers) {
      if (seen.has(layer.clip.id)) continue;
      seen.add(layer.clip.id);
      for (const ramp of clipRamps(layer.clip, layer.clip.durationUs / 1e6)) {
        if (ramp.target !== 'overlay' || ramp.white || Math.max(ramp.from, ramp.to) < 0.98) continue;
        const startUs = layer.clip.timelineStartUs + Math.round(ramp.startS * 1e6);
        expected.push({ startUs, endUs: startUs + Math.round(ramp.durS * 1e6) });
      }
    }
  }
  return expected.sort((a, b) => a.startUs - b.startUs);
}

function isExpectedBlack(
  detected: { startUs: number; endUs: number },
  expected: { startUs: number; endUs: number }[],
  frameDurationUs: number,
): boolean {
  let cursor = detected.startUs;
  const endUs = detected.endUs;
  while (cursor < endUs) {
    const interval = expected.find((item) => item.startUs <= cursor + frameDurationUs && item.endUs + frameDurationUs > cursor);
    if (!interval) return false;
    cursor = Math.max(cursor + 1, interval.endUs + frameDurationUs);
  }
  return true;
}

async function validateVideoOutput(
  project: Project,
  env: RenderEnv,
  path: string,
  settings: ExportSettings,
  expectedDurationUs: number,
  expectedFrames: number,
  expectedFps: { num: number; den: number },
  windows: ReturnType<typeof planWindows>['windows'],
  signal: AbortSignal | undefined,
  onLog: (chunk: string) => void,
  onProgress: (progress: RenderProgress) => void,
): Promise<ExportValidation> {
  const probe = await env.runner.run('ffprobe', [
    '-v', 'error', '-count_frames',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,duration,nb_read_frames',
    '-of', 'json', path,
  ], { signal });
  if (signal?.aborted) throw new CancelledError();
  if (probe.code !== 0) throw new RenderError(`FFprobe não conseguiu ler o arquivo final: ${probe.stderr.trim() || `código ${probe.code}`}`);

  let info: { format?: { duration?: string }; streams?: OutputStream[] };
  try {
    info = JSON.parse(probe.stdout) as typeof info;
  } catch (error) {
    throw new RenderError('FFprobe retornou dados inválidos para o arquivo final', undefined, { cause: error });
  }
  const streams = info.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.filter((stream) => stream.codec_type === 'audio');
  if (!video) throw new RenderError('Validação: o arquivo final não contém vídeo.');
  if (audio.length !== 1) throw new RenderError(`Validação: esperado um stream de áudio mixado; encontrados ${audio.length}.`);

  const durationUs = Math.round(Number(info.format?.duration ?? 0) * 1e6);
  const frameCount = Number(video.nb_read_frames ?? 0);
  const outputFps = parseRational(video.avg_frame_rate ?? '');
  if (!Number.isFinite(durationUs) || durationUs <= 0) throw new RenderError('Validação: duração final inválida.');
  if (Math.abs(durationUs - expectedDurationUs) > 250_000) {
    throw new RenderError(`Validação: duração final (${(durationUs / 1e6).toFixed(2)} s) difere da timeline (${(expectedDurationUs / 1e6).toFixed(2)} s).`);
  }
  if (video.width !== settings.width || video.height !== settings.height) {
    throw new RenderError(`Validação: resolução final ${video.width}×${video.height}, esperada ${settings.width}×${settings.height}.`);
  }
  if (!outputFps || rationalDistance(outputFps, expectedFps) > 0.02) {
    throw new RenderError(`Validação: FPS final (${video.avg_frame_rate ?? 'indisponível'}) diferente do solicitado (${expectedFps.num}/${expectedFps.den}).`);
  }
  if (frameCount !== expectedFrames) {
    throw new RenderError(`Validação: foram decodificados ${frameCount} quadros; esperados ${expectedFrames}.`);
  }
  const expectedCodec = settings.enc.codec === 'h265' ? 'hevc' : settings.enc.codec === 'h264' ? 'h264' : 'prores';
  if (video.codec_name !== expectedCodec) {
    throw new RenderError(`Validação: codec final ${video.codec_name ?? 'desconhecido'}, esperado ${expectedCodec}.`);
  }

  const videoDurationUs = Math.round(Number(video.duration ?? info.format?.duration ?? 0) * 1e6);
  const audioDurationUs = Math.round(Number(audio[0]?.duration ?? info.format?.duration ?? 0) * 1e6);
  const audioSyncDifferenceUs = Math.abs(videoDurationUs - audioDurationUs);
  if (audioSyncDifferenceUs > 250_000) {
    throw new RenderError(`Validação: áudio e vídeo diferem em ${(audioSyncDifferenceUs / 1e6).toFixed(3)} s.`);
  }

  onProgress({ fraction: 0.985, stage: 'verify', detail: 'Decodificando áudio e vídeo para conferir integridade' });
  await run(env, [
    '-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', path,
    '-map', '0:v:0', '-map', '0:a:0', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-',
  ], signal, (us) => onProgress({
    fraction: 0.985 + 0.007 * Math.min(1, us / expectedDurationUs),
    stage: 'verify',
    detail: 'Decodificando áudio e vídeo para conferir integridade',
  }), onLog);

  onProgress({ fraction: 0.992, stage: 'verify', detail: 'Procurando trechos totalmente pretos' });
  const blackResult = await env.runner.run('ffmpeg', [
    '-hide_banner', '-nostdin', '-v', 'info', '-i', path,
    '-vf', 'blackdetect=d=0.1:pix_th=0.02', '-an', '-f', 'null', '-',
  ], { signal });
  if (signal?.aborted) throw new CancelledError();
  if (blackResult.code !== 0) throw new RenderError(`Não foi possível verificar frames pretos: ${blackResult.stderr.trim()}`);
  const intervals = blackIntervals(blackResult.stderr);
  const expected = expectedBlackIntervals(windows);
  const unexpected = intervals.filter((interval) => !isExpectedBlack(interval, expected, 1e6 * expectedFps.den / expectedFps.num));
  const warnings = unexpected.length
    ? [`Foram detectados ${unexpected.length} trechos totalmente pretos fora de gaps/fades intencionais; revise os timestamps: ${unexpected.map((item) => `${(item.startUs / 1e6).toFixed(2)}–${(item.endUs / 1e6).toFixed(2)} s`).join(', ')}.`]
    : [];
  onLog(`\nValidação concluída: ${frameCount} frames, ${settings.width}x${settings.height}, ${outputFps.num}/${outputFps.den} fps, áudio sincronizado (${audioSyncDifferenceUs} us).`);
  return {
    durationUs,
    width: video.width!,
    height: video.height!,
    fps: outputFps,
    videoCodec: video.codec_name!,
    frames: frameCount,
    audioStreams: audio.length,
    audioSyncDifferenceUs,
    blackIntervals: intervals,
    warnings,
  };
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
  const fps = settings.fps ?? project.settings.fps;
  const plan = planWindows(project, fps);
  if (plan.totalFrames <= 0) throw new RenderError('a timeline está vazia');

  const container = settings.container ?? (settings.enc.codec === 'prores' ? 'mov' : 'mp4');
  if (settings.enc.codec === 'prores' && container !== 'mov') throw new RenderError('ProRes exige o contêiner MOV.');
  const outputExt = settings.audioOnly ? 'wav' : container;
  const logPath = `${output}.log`;
  const tmpOut = `${output}.part.${outputExt}`;
  await env.fs.mkdir(env.workDir);
  const W = settings.width;
  const H = settings.height;
  const D = plan.durationUs;
  const totalVideoUs = plan.windows.reduce((a, w) => a + w.durUs, 0) || 1;
  const wAudio = settings.audioOnly ? 0.9 : 0.12;
  const wVideo = settings.audioOnly ? 0 : 0.83;
  let logText = `AMV Studio export log\nOutput: ${output}\nStarted: ${new Date().toISOString()}\nSettings: ${JSON.stringify({ ...settings, fps, container })}\n`;
  const log = (line: string) => {
    logText = `${logText}${line}\n`.slice(-500_000);
  };
  const onStderr = (chunk: string) => {
    logText = `${logText}${chunk}`.slice(-500_000);
  };
  const logFile = async () => env.fs.writeFile(logPath, new TextEncoder().encode(logText));
  let failure: unknown;
  let selectedEncoder: ResolvedVideoEncoder | null = null;
  let currentStage: RenderProgress['stage'] = 'audio';
  const requestedAutomaticEncoder = settings.enc.encoder === 'auto';

  try {
    const backupPath = `${output}.backup`;
    if (await env.fs.exists(backupPath)) {
      if (await env.fs.exists(output)) await env.fs.remove(backupPath);
      else await env.fs.rename(backupPath, output);
    }
    if (await env.fs.exists(tmpOut)) await env.fs.remove(tmpOut);
    if (!settings.audioOnly) {
      log('Checking FFmpeg encoder availability');
      selectedEncoder = await resolveVideoEncoder(env.runner, settings.enc);
      settings = { ...settings, enc: { ...settings.enc, encoder: selectedEncoder, container } };
      log(`Selected encoder: ${selectedEncoder}`);
    }

    // 1) áudio
    currentStage = 'audio';
    const audioPath = joinPath(env.workDir, 'audio.wav');
    onProgress({ fraction: 0, stage: 'audio', detail: 'Mixando o áudio' });
    log('Mixing audio timeline');
    await run(
      env,
      audioArgs({ project, durationUs: D, sampleRate: project.settings.sampleRate, output: audioPath, source: env.source }),
      signal,
      (us) => onProgress({ fraction: wAudio * Math.min(1, us / D), stage: 'audio', detail: 'Mixando o áudio' }),
      onStderr,
    );

    if (settings.audioOnly) {
      const audioMetrics = await measureAudioQuality(env.runner, audioPath);
      const validationProbe = await env.runner.run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', audioPath], { signal });
      if (signal?.aborted) throw new CancelledError();
      if (validationProbe.code !== 0) throw new RenderError(`A mixagem WAV não pôde ser validada: ${validationProbe.stderr.trim()}`);
      const audioInfo = JSON.parse(validationProbe.stdout) as { format?: { duration?: string }; streams?: OutputStream[] };
      const audioStreams = (audioInfo.streams ?? []).filter((stream) => stream.codec_type === 'audio');
      const durationUs = Math.round(Number(audioInfo.format?.duration ?? 0) * 1e6);
      if (audioStreams.length !== 1 || Math.abs(durationUs - D) > 250_000) throw new RenderError('Validação: mixagem WAV ausente ou com duração incompatível.');
      await run(env, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', audioPath, '-map', '0:a:0', '-f', 'null', '-'], signal, undefined, onStderr);
      await env.fs.rename(audioPath, tmpOut);
      const validation: ExportValidation = {
        durationUs, width: null, height: null, fps: null, videoCodec: null, frames: 0,
        audioStreams: 1, audioSyncDifferenceUs: 0, blackIntervals: [], warnings: [],
      };
      log(`Validation passed: audio-only WAV, duration ${durationUs} us`);
      await logFile();
      await promoteValidatedOutput(env, tmpOut, output);
      onProgress({ fraction: 1, stage: 'verify', detail: 'Arquivo validado' });
      return { output, logPath, durationUs: D, frames: 0, windows: 0, audioMetrics, validation };
    }

    const colorLuts = new Map<string, string>();
    const colorLutByClip = new Map<string, string>();
    let lutIndex = 0;
    for (const clip of project.clips) {
      if (clip.text || !clip.assetId) continue;
      const track = project.tracks.find((item) => item.id === clip.trackId);
      if (track?.kind !== 'video') continue;
      const grade = aggregateColorGrade(clip.effects);
      if (isColorGradeNeutral(grade)) continue;
      const key = JSON.stringify(grade);
      let path = colorLuts.get(key);
      if (!path) {
        path = joinPath(env.workDir, `grade-${String(lutIndex++).padStart(4, '0')}.cube`);
        await env.fs.writeFile(path, new TextEncoder().encode(colorGradeCube(grade)));
        colorLuts.set(key, path);
      }
      colorLutByClip.set(clip.id, path);
    }

    // 2) vídeo, janela a janela
    currentStage = 'video';
    const ext = container;
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
        colorLutPath: (c) => colorLutByClip.get(c.id) ?? null,
      });
      const detail = `Renderizando trecho ${w.index + 1} de ${plan.windows.length}`;
      await run(
        env,
        job.args,
        signal,
        (us) => onProgress({ fraction: wAudio + wVideo * Math.min(1, (doneUs + Math.min(us, w.durUs)) / totalVideoUs), stage: 'video', detail }),
        onStderr,
      );
      doneUs += w.durUs;
      segs.push(seg);
      onProgress({ fraction: wAudio + wVideo * (doneUs / totalVideoUs), stage: 'video', detail });
    }

    // 3) junta sem recodificar + áudio
    currentStage = 'mux';
    onProgress({ fraction: wAudio + wVideo, stage: 'mux', detail: 'Juntando vídeo e áudio' });
    const list = joinPath(env.workDir, 'lista.txt');
    const esc = (p: string) => p.replace(/\\/g, '/').replace(/'/g, "'\\''");
    await env.fs.writeFile(list, new TextEncoder().encode(segs.map((s) => `file '${esc(s)}'`).join('\n') + '\n'));
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
        ...(container === 'mp4' ? ['-movflags', '+faststart'] : []),
        '-progress', 'pipe:1', '-nostats',
        '-loglevel', 'error',
        tmpOut,
      ],
      signal,
      (us) => onProgress({ fraction: wAudio + wVideo + 0.03 * Math.min(1, us / D), stage: 'mux', detail: 'Muxando vídeo e áudio' }),
      onStderr,
    );

    currentStage = 'verify';
    const validation = await validateVideoOutput(project, env, tmpOut, settings, D, plan.totalFrames, fps, plan.windows, signal, onStderr, onProgress);
    const audioMetrics = await measureAudioQuality(env.runner, tmpOut);
    for (const warning of validation.warnings) log(`WARNING: ${warning}`);
    log(`Validated temporary output: ${JSON.stringify(validation)}`);
    await logFile();
    await promoteValidatedOutput(env, tmpOut, output);
    onProgress({ fraction: 1, stage: 'verify', detail: 'Arquivo validado e salvo' });
    return { output, logPath, durationUs: validation.durationUs, frames: validation.frames, windows: plan.windows.length, audioMetrics, validation };
  } catch (error) {
    if (
      requestedAutomaticEncoder
      && selectedEncoder !== null
      && selectedEncoder !== 'cpu'
      && (currentStage === 'video' || currentStage === 'mux')
      && error instanceof ToolError
      && !signal?.aborted
    ) {
      log(`Hardware encoder ${selectedEncoder} failed during ${currentStage}; retrying the complete export on CPU.`);
      await logFile();
      if (await env.fs.exists(tmpOut)) await env.fs.remove(tmpOut);
      const hardwareLog = logText;
      const fallbackResult = await renderProject(project, output, {
        ...settings,
        enc: { ...settings.enc, encoder: 'cpu' },
      }, {
        ...env,
        workDir: `${env.workDir}-cpu-fallback`,
      }, onProgress, signal);
      const fallbackLog = new TextDecoder().decode(await env.fs.readFile(fallbackResult.logPath));
      await env.fs.writeFile(fallbackResult.logPath, new TextEncoder().encode(`${hardwareLog}\nCPU fallback attempt:\n${fallbackLog}`.slice(-500_000)));
      return fallbackResult;
    }
    failure = error;
    log(`\nEXPORT FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    try {
      await logFile();
      if (await env.fs.exists(tmpOut)) await env.fs.remove(tmpOut);
    } catch (logError) {
      throw new AggregateError([error, logError], `A exportação falhou e não foi possível salvar/remover seus arquivos temporários. Erro original: ${error instanceof Error ? error.message : String(error)}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CancelledError) {
      error.logPath = logPath;
      error.message = `${message}. Log detalhado: ${logPath}`;
      throw error;
    }
    const reported = new RenderError(`${message}\nLog detalhado: ${logPath}`, logPath, { cause: error });
    throw reported;
  } finally {
    try {
      await env.fs.remove(env.workDir);
    } catch (cleanupError) {
      if (failure) throw new AggregateError([failure, cleanupError], `A exportação terminou com erro e a limpeza dos temporários também falhou.`);
      throw new RenderError(`A exportação terminou, mas não foi possível remover temporários em ${env.workDir}.`, logPath, { cause: cleanupError });
    }
  }
}
