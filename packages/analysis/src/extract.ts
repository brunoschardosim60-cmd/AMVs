/** Extração com FFmpeg: PCM, estatísticas por quadro e legendas embutidas. */
import { CancelledError, ToolError, type ProcessRunner } from '@amv/media';
import type { ProbeInfo } from '@amv/project';
import { analyzeMusic, type MusicAnalysis } from './music.js';
import { buildEpisodeAnalysis, detectSpeech, voiceFeatures, type EpisodeAnalysis, type FrameStat } from './episode.js';
import { decodeSubtitleBytes, parseAss, parseSrt, type Cue } from './subtitles.js';

export type Report = (fraction: number, detail?: string) => void;

/** Decodifica o áudio para PCM float mono. Memória: ~88 KB/s a 22 kHz (4 min ≈ 21 MB). */
export async function decodePcm(runner: ProcessRunner, path: string, sampleRate: number, signal?: AbortSignal, streamIndex: number | null = null, onProgress?: (s: number) => void): Promise<Float32Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const r = await runner.run(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path, '-map', streamIndex === null ? '0:a:0' : `0:${streamIndex}`, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'],
    {
      signal,
      onStdoutBytes: (b) => {
        chunks.push(b.slice());
        total += b.length;
        onProgress?.(total / 4 / sampleRate);
      },
    },
  );
  if (signal?.aborted) throw new CancelledError();
  if (r.code !== 0) throw new ToolError('ffmpeg', r.code, r.stderr);
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  const n = Math.floor(total / 4);
  return new Float32Array(all.buffer, 0, n).slice();
}

/** Estatísticas por quadro numa resolução minúscula (rápido mesmo com episódio inteiro). */
export async function frameStats(runner: ProcessRunner, path: string, durationS: number, signal?: AbortSignal, onProgress?: Report): Promise<FrameStat[]> {
  const frames: FrameStat[] = [];
  let cur: Partial<FrameStat> = {};
  let buf = '';
  const flush = () => {
    if (cur.t !== undefined) frames.push({ t: cur.t, scene: cur.scene ?? 0, ydif: cur.ydif ?? 0, yavg: cur.yavg ?? 0 });
    cur = {};
  };
  const r = await runner.run(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path, '-an', '-sn', '-vf', "scale=96:54,select='gte(scene\\,0)',signalstats,metadata=mode=print:file=-", '-f', 'null', '-'],
    {
      signal,
      onStdout: (chunk) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line.startsWith('frame:')) {
            flush();
            const m = line.match(/pts_time:([\d.]+)/);
            cur.t = m ? Number(m[1]) : 0;
            if (frames.length % 200 === 0) onProgress?.(Math.min(1, cur.t / Math.max(1, durationS)));
          } else if (line.startsWith('lavfi.scene_score=')) cur.scene = Number(line.split('=')[1]);
          else if (line.startsWith('lavfi.signalstats.YDIF=')) cur.ydif = Number(line.split('=')[1]);
          else if (line.startsWith('lavfi.signalstats.YAVG=')) cur.yavg = Number(line.split('=')[1]);
        }
      },
    },
  );
  flush();
  if (signal?.aborted) throw new CancelledError();
  if (r.code !== 0) throw new ToolError('ffmpeg', r.code, r.stderr);
  return frames;
}

/** Lê a primeira legenda de TEXTO do arquivo (ASS/SRT/WebVTT). Legendas em imagem (PGS) são ignoradas. */
export async function embeddedSubtitles(runner: ProcessRunner, path: string, probe: ProbeInfo, preferLang = ['por', 'pt', 'eng', 'en'], signal?: AbortSignal): Promise<Cue[]> {
  const textCodecs = ['ass', 'ssa', 'subrip', 'srt', 'webvtt', 'mov_text', 'text'];
  const subs = probe.subtitles.filter((s) => textCodecs.includes(s.codec));
  if (!subs.length) return [];
  const pick = preferLang.map((l) => subs.find((s) => s.language === l)).find(Boolean) ?? subs[0]!;
  const asAss = pick.codec === 'ass' || pick.codec === 'ssa';
  const chunks: Uint8Array[] = [];
  const r = await runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path, '-map', `0:${pick.index}`, '-f', asAss ? 'ass' : 'srt', 'pipe:1'], {
    signal,
    onStdoutBytes: (b) => chunks.push(b.slice()),
  });
  if (r.code !== 0) return [];
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const all = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  const text = decodeSubtitleBytes(all);
  return asAss ? parseAss(text) : parseSrt(text);
}

export async function analyzeMusicFile(runner: ProcessRunner, path: string, durationS: number, report: Report, signal?: AbortSignal): Promise<MusicAnalysis> {
  const SR = 22050;
  report(0, 'Lendo o áudio');
  const pcm = await decodePcm(runner, path, SR, signal, null, (s) => report(0.6 * Math.min(1, s / Math.max(1, durationS)), 'Lendo o áudio'));
  report(0.65, 'Procurando batidas e o drop');
  const a = analyzeMusic(pcm, SR);
  report(1);
  return a;
}

/**
 * Analisa um episódio. `videoPath` pode ser o proxy (decodifica muito mais rápido que o original).
 * O áudio e as legendas vêm do original.
 */
export async function analyzeEpisodeFile(runner: ProcessRunner, originalPath: string, videoPath: string, probe: ProbeInfo, report: Report, signal?: AbortSignal): Promise<EpisodeAnalysis> {
  const durationS = probe.durationUs / 1e6;
  report(0, 'Lendo legendas');
  const subtitles = await embeddedSubtitles(runner, originalPath, probe, undefined, signal).catch(() => []);
  let feat = { t: [] as number[], db: [] as number[], voiceRatio: [] as number[] };
  if (probe.audio.length) {
    report(0.03, 'Ouvindo falas e gritos');
    const SR = 16000;
    const pcm = await decodePcm(runner, originalPath, SR, signal, null, (s) => report(0.03 + 0.25 * Math.min(1, s / Math.max(1, durationS)), 'Ouvindo falas e gritos'));
    feat = voiceFeatures(pcm, SR);
  }
  const speech = detectSpeech(feat, subtitles);
  report(0.3, 'Procurando cortes e ação');
  const frames = await frameStats(runner, videoPath, durationS, signal, (f) => report(0.3 + 0.68 * f, 'Procurando cortes e ação'));
  const a = buildEpisodeAnalysis(frames, durationS, feat, speech, subtitles);
  report(1);
  return a;
}
