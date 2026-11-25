import { impactScore, type SpeechSegment } from '@amv/analysis';
import { translateLinesWithFallback, type TranslateResult } from '@amv/assistant';
import { joinPath } from '@amv/media';
import type { Asset } from '@amv/project';
import type { Platform, SpeechTranscript } from '../platform/types';
import { isLocal, loadAiSettings, secretName } from './aiSettings';

export type TranscriptionStage = 'extracting' | 'preparing' | 'transcribing';

export interface TranscribeMediaOptions {
  model?: string;
  language?: string;
  vadFilter?: boolean;
  useCache?: boolean;
  signal: AbortSignal;
  onProgress?: (info: { stage: TranscriptionStage; progress: number; duration: number }) => void;
}

/** Extrai palavras com tempo de uma transcrição Whisper, com divisão proporcional se `words[]` vier vazio. */
export function extractTranscriptWords(transcript: SpeechTranscript): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const segment of transcript.segments) {
    const words = (segment.words ?? []).filter((word) => word.text.trim() && word.end > word.start);
    if (words.length) {
      out.push(...words);
    } else if (segment.text.trim() && segment.end > segment.start) {
      const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
      const step = (segment.end - segment.start) / Math.max(1, tokens.length);
      tokens.forEach((tok, idx) => {
        out.push({ start: segment.start + idx * step, end: segment.start + (idx + 1) * step, text: tok });
      });
    }
  }
  return out;
}

/** Combina segmentos transcritos com as falas já detectadas no episódio sem perder gritos ou loudness. */
export function mergeSpeechSegments(
  existing: SpeechSegment[],
  transcript: SpeechTranscript,
  fallbackLanguage: string | null,
): SpeechSegment[] {
  const spoken = transcript.segments
    .map((segment) => ({ ...segment, text: segment.text.replace(/\s+/g, ' ').trim() }))
    .filter((segment) => segment.text.length >= 2 && segment.end - segment.start >= 0.35 && segment.end > segment.start);
  const consumed = new Set<number>();
  const recognized: SpeechSegment[] = spoken.map((segment) => {
    let bestIndex = -1;
    let bestOverlap = 0;
    existing.forEach((speech, index) => {
      const overlap = Math.max(0, Math.min(speech.endS, segment.end) - Math.max(speech.startS, segment.start));
      const shorter = Math.max(0.1, Math.min(speech.endS - speech.startS, segment.end - segment.start));
      const ratio = overlap / shorter;
      if (ratio > bestOverlap) {
        bestOverlap = ratio;
        bestIndex = index;
      }
    });
    const previous = bestOverlap >= 0.2 && bestIndex >= 0 ? existing[bestIndex] : undefined;
    if (previous) consumed.add(bestIndex);
    const sourceLanguage = transcript.language ?? fallbackLanguage ?? previous?.language ?? null;
    return {
      startS: segment.start,
      endS: segment.end,
      kind: previous?.kind ?? 'fala',
      confidence: Math.max(previous?.confidence ?? 0, 0.55),
      text: segment.text,
      language: sourceLanguage,
      impact: Math.max(previous?.impact ?? 0, impactScore(segment.text)),
      ...(previous?.loudnessDb !== undefined ? { loudnessDb: previous.loudnessDb } : {}),
    };
  });
  const untouched = existing.filter((_, index) => !consumed.has(index));
  const sorted = [...untouched, ...recognized].sort((left, right) => left.startS - right.startS);
  const coalesced: SpeechSegment[] = [];
  for (const next of sorted) {
    const prev = coalesced.at(-1);
    if (
      prev
      && prev.text?.trim()
      && next.text?.trim()
      && next.startS - prev.endS >= -0.05
      && next.startS - prev.endS <= 1.1
      && next.endS - prev.startS <= 4.2
      && (!prev.language || !next.language || prev.language === next.language)
    ) {
      const mergedText = `${prev.text.trim()} ${next.text.trim()}`.replace(/\s+/g, ' ').trim();
      coalesced[coalesced.length - 1] = {
        ...prev,
        endS: Math.max(prev.endS, next.endS),
        kind: prev.kind === 'grito' || next.kind === 'grito' ? 'grito' : prev.kind,
        confidence: Math.max(prev.confidence, next.confidence),
        text: mergedText,
        language: prev.language ?? next.language ?? null,
        impact: Math.max(prev.impact, next.impact, impactScore(mergedText)),
      };
    } else {
      coalesced.push(next);
    }
  }
  return coalesced;
}

function isValidTranscript(data: unknown): data is SpeechTranscript {
  const cached = data as SpeechTranscript | null;
  return (
    !!cached
    && typeof cached.duration === 'number'
    && Array.isArray(cached.segments)
    && cached.segments.every((segment) =>
      Number.isFinite(segment.start)
      && Number.isFinite(segment.end)
      && typeof segment.text === 'string'
      && Array.isArray(segment.words)
      && segment.words.every((word) =>
        Number.isFinite(word.start) && Number.isFinite(word.end) && typeof word.text === 'string',
      ),
    )
  );
}

/** Extrai o áudio mono 16 kHz via FFmpeg e transcreve localmente no sidecar Whisper com cache versionado (`v2`). */
export async function transcribeMediaAsset(
  platform: Platform,
  asset: Asset,
  audioIndex: number,
  options: TranscribeMediaOptions,
): Promise<SpeechTranscript> {
  if (asset.status === 'missing') throw new Error(`O arquivo ${asset.name} está ausente. Relocalize-o antes de transcrever.`);
  const model = options.model ?? 'small';
  const vadFilter = options.vadFilter ?? true;
  const useCache = options.useCache ?? true;
  const duration = (asset.probe?.durationUs ?? 0) / 1_000_000;
  const cacheDir = joinPath(await platform.cacheDir(), 'transcription');
  await platform.fs.mkdir(cacheDir);
  const cacheKey = (asset.hash || asset.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const audioPath = joinPath(cacheDir, `${cacheKey}-stream-${audioIndex}.wav`);
  const langTag = options.language ? `-${options.language}` : '';
  const transcriptPath = joinPath(
    cacheDir,
    `${cacheKey}-stream-${audioIndex}-${model}${langTag}-${vadFilter ? 'v2' : 'novad-v2'}.json`,
  );
  let partialPath: string | null = null;

  try {
    if (useCache && (await platform.fs.exists(transcriptPath))) {
      try {
        const cached = JSON.parse(new TextDecoder().decode(await platform.fs.readFile(transcriptPath))) as unknown;
        if (isValidTranscript(cached)) {
          if (options.signal.aborted) throw new DOMException('transcrição cancelada', 'AbortError');
          options.onProgress?.({ stage: 'transcribing', progress: cached.duration || duration || 1, duration: cached.duration || duration || 1 });
          return cached;
        }
        await platform.fs.remove(transcriptPath);
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;
        try {
          await platform.fs.remove(transcriptPath);
        } catch {}
      }
    }

    if (!(await platform.fs.exists(audioPath)) || (await platform.fs.size(audioPath)) <= 44) {
      partialPath = `${audioPath}.partial`;
      if (await platform.fs.exists(partialPath)) await platform.fs.remove(partialPath);
      options.onProgress?.({ stage: 'extracting', progress: 0, duration });
      let progressOutput = '';
      const vocalFilterArgs = !vadFilter
        ? ['-af', 'pan=mono|c0=0.5*c0+0.5*c1,highpass=f=135,lowpass=f=6800,acompressor=threshold=-18dB:ratio=3:attack=5:release=50']
        : [];
      const extracted = await platform.runner.run(
        'ffmpeg',
        [
          '-y', '-hide_banner', '-v', 'error', '-i', asset.path, '-map', `0:${audioIndex}`,
          '-vn', ...vocalFilterArgs, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-progress', 'pipe:1', '-nostats', '-f', 'wav', partialPath,
        ],
        {
          signal: options.signal,
          onStdout: (chunk) => {
            progressOutput = (progressOutput + chunk).slice(-4096);
            for (const line of progressOutput.split(/\r?\n/)) {
              const match = /^out_time_us=(\d+)/.exec(line);
              if (match) options.onProgress?.({ stage: 'extracting', progress: Number(match[1]) / 1e6, duration });
            }
          },
        },
      );
      if (options.signal.aborted) throw new DOMException('transcrição cancelada', 'AbortError');
      if (extracted.code !== 0) {
        throw new Error(`FFmpeg não conseguiu extrair a faixa ${audioIndex}: ${extracted.stderr.trim() || `código ${extracted.code}`}`);
      }
      if (!(await platform.fs.exists(partialPath)) || (await platform.fs.size(partialPath)) <= 44) {
        throw new Error('FFmpeg não gerou um WAV válido para transcrição.');
      }
      await platform.fs.rename(partialPath, audioPath);
      partialPath = null;
    }

    if (options.signal.aborted) throw new DOMException('transcrição cancelada', 'AbortError');
    const connection = await platform.analyzer.start();
    if (options.signal.aborted) throw new DOMException('transcrição cancelada', 'AbortError');

    const transcript = await platform.analyzer.transcribe(
      connection,
      { path: audioPath, model, vadFilter, ...(options.language ? { language: options.language } : {}) },
      {
        signal: options.signal,
        onProgress: (job) => {
          options.onProgress?.({
            stage: job.status === 'queued' || job.progress === 0 ? 'preparing' : 'transcribing',
            progress: job.progress,
            duration: job.duration || duration,
          });
        },
      },
    );
    if (options.signal.aborted) throw new DOMException('transcrição cancelada', 'AbortError');

    const transcriptPartialPath = `${transcriptPath}.partial`;
    let transcriptCached = false;
    try {
      await platform.fs.writeFile(transcriptPartialPath, new TextEncoder().encode(JSON.stringify(transcript)));
      await platform.fs.rename(transcriptPartialPath, transcriptPath);
      transcriptCached = true;
    } catch (cacheError) {
      try {
        if (await platform.fs.exists(transcriptPartialPath)) await platform.fs.remove(transcriptPartialPath);
      } catch {}
      console.warn('Não foi possível guardar a transcrição em cache:', cacheError);
    }
    if (transcriptCached) {
      try {
        if (await platform.fs.exists(audioPath)) await platform.fs.remove(audioPath);
      } catch {}
    }
    return transcript;
  } finally {
    if (partialPath && (await platform.fs.exists(partialPath))) {
      try {
        await platform.fs.remove(partialPath);
      } catch {}
    }
  }
}

/**
 * Transcreve rapidamente apenas uma janela curta (`startS..endS`, ex.: 2–5 s) de um episódio.
 * Ideal para garantir legenda nas falas selecionadas em episódios longos (24 min) sem esperar
 * a transcrição integral do arquivo inteiro.
 */
export async function transcribeAudioSlice(
  platform: Platform,
  asset: Asset,
  audioIndex: number,
  startS: number,
  endS: number,
  options: { model?: string; language?: string; signal: AbortSignal },
): Promise<{ text: string; language: string | null } | null> {
  if (asset.status === 'missing' || endS <= startS) return null;
  const padStart = Math.max(0, startS - 0.25);
  const padDur = Math.max(0.5, Math.min(12, endS - padStart + 0.3));
  const cacheDir = joinPath(await platform.cacheDir(), 'transcription-slices');
  await platform.fs.mkdir(cacheDir);
  const cacheKey = (asset.hash || asset.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const sliceKey = `${cacheKey}-s${audioIndex}-${Math.round(padStart * 100)}-${Math.round(padDur * 100)}`;
  const jsonPath = joinPath(cacheDir, `${sliceKey}.json`);
  const wavPath = joinPath(cacheDir, `${sliceKey}.wav`);
  try {
    if (await platform.fs.exists(jsonPath)) {
      try {
        const cached = JSON.parse(new TextDecoder().decode(await platform.fs.readFile(jsonPath))) as { text?: string; language?: string | null };
        if (cached && typeof cached.text === 'string' && cached.text.trim()) {
          return { text: cached.text.trim(), language: cached.language ?? null };
        }
      } catch {}
    }
    const extracted = await platform.runner.run(
      'ffmpeg',
      [
        '-y', '-hide_banner', '-v', 'error',
        '-ss', padStart.toFixed(3),
        '-t', padDur.toFixed(3),
        '-i', asset.path,
        '-map', `0:${audioIndex}`,
        '-vn',
        '-af', 'pan=mono|c0=0.5*c0+0.5*c1,highpass=f=120,lowpass=f=7200',
        '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', wavPath,
      ],
      { signal: options.signal },
    );
    if (options.signal.aborted) throw new DOMException('transcrição cancelada', 'AbortError');
    if (extracted.code !== 0 || !(await platform.fs.exists(wavPath)) || (await platform.fs.size(wavPath)) <= 44) return null;
    const connection = await platform.analyzer.start();
    const transcript = await platform.analyzer.transcribe(
      connection,
      { path: wavPath, model: options.model ?? 'small', vadFilter: false, ...(options.language ? { language: options.language } : {}) },
      { signal: options.signal },
    );
    const joined = transcript.segments.map((seg) => seg.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (!joined) return null;
    const out = { text: joined, language: transcript.language ?? null };
    try {
      await platform.fs.writeFile(jsonPath, new TextEncoder().encode(JSON.stringify(out)));
    } catch {}
    return out;
  } finally {
    try {
      if (await platform.fs.exists(wavPath)) await platform.fs.remove(wavPath);
    } catch {}
  }
}

const TRANSLATE_CACHE_MAX = 5000;
let diskCacheLoaded = false;
const diskTranslateCache = new Map<string, string>();

async function ensureDiskTranslateCache(platform: Platform): Promise<void> {
  if (diskCacheLoaded) return;
  diskCacheLoaded = true;
  try {
    const file = joinPath(await platform.dataDir(), 'translate-cache.json');
    if (!(await platform.fs.exists(file))) return;
    const raw = JSON.parse(new TextDecoder().decode(await platform.fs.readFile(file))) as Record<string, unknown>;
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && v.trim()) diskTranslateCache.set(k, v);
      }
    }
  } catch {
    // cache corrompido ou inacessível é ignorado silenciosamente
  }
}

async function persistDiskTranslateCache(platform: Platform): Promise<void> {
  try {
    const dir = await platform.dataDir();
    await platform.fs.mkdir(dir);
    while (diskTranslateCache.size > TRANSLATE_CACHE_MAX) {
      const oldest = diskTranslateCache.keys().next().value;
      if (oldest === undefined) break;
      diskTranslateCache.delete(oldest);
    }
    const obj = Object.fromEntries(diskTranslateCache.entries());
    await platform.fs.writeFile(
      joinPath(dir, 'translate-cache.json'),
      new TextEncoder().encode(JSON.stringify(obj)),
    );
  } catch {
    // falha ao gravar cache não deve interromper a tradução
  }
}

/** Traduz textos usando o provedor configurado (se ativo), cache persistente local e fallback gratuito sem chave. */
export async function translateTextsAuto(
  platform: Platform,
  lines: string[],
  targetLanguage: string,
  options: { sourceLanguage?: string | null; batchSize?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<TranslateResult & { usedFallback: boolean }> {
  if (!lines.length) return { translations: [], failed: 0, usage: { input: 0, output: 0 }, usedFallback: false };
  await ensureDiskTranslateCache(platform);
  const langKey = targetLanguage.trim().toLowerCase();
  const out: (string | null)[] = lines.map(() => null);
  const missingIndices: number[] = [];
  const missingLines: string[] = [];
  lines.forEach((line, idx) => {
    const cleaned = line.replace(/\s*\n\s*/g, ' ').trim();
    if (!cleaned) {
      out[idx] = '';
      return;
    }
    const cached = diskTranslateCache.get(`${langKey}|${cleaned}`);
    if (cached !== undefined) {
      out[idx] = cached;
      return;
    }
    missingIndices.push(idx);
    missingLines.push(line);
  });
  if (!missingLines.length) {
    options.onProgress?.(lines.length, lines.length);
    return { translations: out, failed: 0, usage: { input: 0, output: 0 }, usedFallback: false };
  }
  const settings = await loadAiSettings(platform);
  const canUseConfigured = settings.enabled && (isLocal(settings) || settings.allowExternal);
  const key = canUseConfigured && settings.provider.needsKey
    ? await platform.secrets.get(secretName(settings.presetId))
    : null;
  const cfg = canUseConfigured && (!settings.provider.needsKey || !!key) ? settings.provider : null;
  const cachedCount = lines.length - missingLines.length;
  const result = await translateLinesWithFallback(cfg, key, platform.http, missingLines, {
    target: targetLanguage,
    source: options.sourceLanguage,
    batchSize: options.batchSize ?? 14,
    signal: options.signal,
    onProgress: options.onProgress
      ? (done) => options.onProgress?.(Math.min(lines.length, cachedCount + done), lines.length)
      : undefined,
  });
  let dirty = false;
  missingIndices.forEach((origIdx, k) => {
    const val = result.translations[k] ?? null;
    out[origIdx] = val;
    const cleaned = missingLines[k]!.replace(/\s*\n\s*/g, ' ').trim();
    if (val && val.trim() && cleaned) {
      diskTranslateCache.set(`${langKey}|${cleaned}`, val.trim());
      dirty = true;
    }
  });
  if (dirty) void persistDiskTranslateCache(platform);
  return { translations: out, failed: result.failed, usage: result.usage, usedFallback: !cfg };
}
