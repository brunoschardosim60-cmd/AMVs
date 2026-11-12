/**
 * Motor de preview. Lê o projeto, mantém um elemento de mídia por clipe perto do
 * playhead, sincroniza com o relógio da timeline e compõe o quadro num <canvas>.
 *
 * O preview usa os PROXIES (H.264 leve). É "melhor esforço": a exportação (Fase 3)
 * usa os originais e é exata. O tempo do projeto é sempre a fonte da verdade.
 */
import { drawTextLayer } from './textLayer';
import { aggregateColorGrade, applyWhipPan, automaticDuckingGain, clipEndUs, createColorGradeLut, evalClipLook, evaluateKeyframes, isColorGradeNeutral, projectDurationUs, sampleColorGradeLut, sourceTimeAt, speedAt, transitionUnderlay, type Clip, type ClipLook, type ColorGradeLut, type Project, type Track } from '@amv/project';

export interface MediaSource {
  /** URL do proxy de vídeo (vídeos) ou do arquivo/proxy de áudio. */
  videoUrl(assetId: string): string | null;
  audioUrl(assetId: string, streamIndex?: number | null): string | null;
  imageUrl(assetId: string): string | null;
}

interface Slot {
  slotKey: string;
  clipId: string;
  el: HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
  kind: 'video' | 'audio' | 'image';
  url: string;
  lastUsed: number;
  sourceNode: MediaElementAudioSourceNode | null;
  gainNode: GainNode | null;
  needsSeek: boolean;
  lastSeekAtMs: number;
  lastGain: number | null;
  lastFrame: HTMLCanvasElement | null;
}

/** Margem para pré-carregar o próximo clipe antes de ele começar. */
const PRELOAD_US = 2_000_000;
/** Corrige desvios visuais grandes sem seeks frequentes durante a reprodução. */
const DRIFT_PLAYING_S = 0.6;
/** Pausado: limite de desvio para re-seek. */
const DRIFT_PAUSED_S = 0.08;
const PLAYING_SEEK_COOLDOWN_MS = 750;
const PAUSED_SEEK_COOLDOWN_MS = 250;
const PLAYHEAD_UPDATE_MS = 50;

export function shouldHardSeekMedia(
  kind: 'video' | 'audio',
  driftS: number,
  state: { playing: boolean; seeking: boolean; readyState: number; needsSeek: boolean; sinceLastSeekMs: number },
): boolean {
  if (state.seeking || state.readyState < 1) return false;
  if (state.needsSeek) return true;
  if (!state.playing) {
    return Math.abs(driftS) > DRIFT_PAUSED_S && state.sinceLastSeekMs >= PAUSED_SEEK_COOLDOWN_MS;
  }
  return kind === 'video'
    && Math.abs(driftS) > DRIFT_PLAYING_S
    && state.sinceLastSeekMs >= PLAYING_SEEK_COOLDOWN_MS;
}
/**
 * Elementos de mídia vivos: mantém uma conexão por clipe ativo/próximo.
 */
const MAX_SLOTS = 8;
/** Elemento fora do playhead há mais que isso é fechado (libera a conexão). */
const IDLE_RELEASE_MS = 1500;

function canvasBlendMode(mode: Clip['blendMode']): GlobalCompositeOperation {
  return mode === 'addition' ? 'lighter' : mode === 'normal' ? 'source-over' : mode;
}

function clipMask(ctx: CanvasRenderingContext2D, mask: Clip['mask'], x: number, y: number, width: number, height: number): void {
  if (mask === 'none') return;
  ctx.beginPath();
  if (mask === 'circle') ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  else if (mask === 'left') ctx.rect(x, y, width / 2, height);
  else if (mask === 'right') ctx.rect(x + width / 2, y, width / 2, height);
  else if (mask === 'top') ctx.rect(x, y, width, height / 2);
  else ctx.rect(x, y + height / 2, width, height / 2);
  ctx.clip();
}

class ColorGradeGpu {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly sourceTexture: WebGLTexture;
  private readonly lutTextures = new Map<string, WebGLTexture>();

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, program: WebGLProgram, sourceTexture: WebGLTexture) {
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.sourceTexture = sourceTexture;
  }

  static create(): ColorGradeGpu | null {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      out vec2 uv;
      void main() {
        vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
        uv = p * 0.5 + 0.5;
        gl_Position = vec4(p, 0.0, 1.0);
      }`);
    const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      uniform sampler2D frameTexture;
      uniform sampler3D gradeTexture;
      uniform float gradeSize;
      in vec2 uv;
      out vec4 color;
      void main() {
        vec4 source = texture(frameTexture, uv);
        vec3 lutCoord = (clamp(source.rgb, 0.0, 1.0) * (gradeSize - 1.0) + 0.5) / gradeSize;
        color = vec4(texture(gradeTexture, lutCoord).rgb, source.a);
      }`);
    if (!vertex || !fragment) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    const sourceTexture = gl.createTexture();
    if (!sourceTexture) return null;
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return new ColorGradeGpu(canvas, gl, program, sourceTexture);
  }

  apply(source: HTMLCanvasElement, key: string, lut: ColorGradeLut): HTMLCanvasElement | null {
    const gl = this.gl;
    if (gl.isContextLost()) return null;
    if (this.canvas.width !== source.width) this.canvas.width = source.width;
    if (this.canvas.height !== source.height) this.canvas.height = source.height;
    gl.viewport(0, 0, source.width, source.height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

    let lutTexture = this.lutTextures.get(key);
    if (!lutTexture) {
      lutTexture = gl.createTexture() ?? undefined;
      if (!lutTexture) return null;
      const bytes = new Uint8Array(lut.size * lut.size * lut.size * 4);
      for (let source = 0, target = 0; source < lut.data.length; source += 3, target += 4) {
        bytes[target] = Math.round(lut.data[source]! * 255);
        bytes[target + 1] = Math.round(lut.data[source + 1]! * 255);
        bytes[target + 2] = Math.round(lut.data[source + 2]! * 255);
        bytes[target + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lutTexture);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      this.lutTextures.set(key, lutTexture);
      if (this.lutTextures.size > 32) {
        const oldest = this.lutTextures.keys().next().value!;
        gl.deleteTexture(this.lutTextures.get(oldest)!);
        this.lutTextures.delete(oldest);
      }
    } else {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lutTexture);
    }

    gl.uniform1i(gl.getUniformLocation(this.program, 'frameTexture'), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'gradeTexture'), 1);
    gl.uniform1f(gl.getUniformLocation(this.program, 'gradeSize'), lut.size);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
}

export function sourceTimeS(clip: Clip, atUs: number): number {
  return sourceTimeAt(clip, atUs - clip.timelineStartUs) / 1e6;
}

export function activeClips(project: Project, atUs: number, track: Track): Clip | null {
  for (const c of project.clips) {
    if (c.trackId === track.id && atUs >= c.timelineStartUs && atUs < clipEndUs(c)) return c;
  }
  return null;
}

/** Ganho linear de um clipe de áudio no instante, incluindo fades e ganho da trilha. */
export function clipVolume(clip: Clip, track: Track, atUs: number, anySolo: boolean, project?: Project): number {
  if (track.muted || (anySolo && !track.solo)) return 0;
  const db = clip.audio.gainDb + track.gainDb + keyframeGainDb(clip, atUs - clip.timelineStartUs);
  let v = Math.pow(10, db / 20);
  const into = atUs - clip.timelineStartUs;
  const left = clipEndUs(clip) - atUs;
  if (clip.audio.fadeInUs > 0 && into < clip.audio.fadeInUs) v *= into / clip.audio.fadeInUs;
  if (clip.audio.fadeOutUs > 0 && left < clip.audio.fadeOutUs) v *= left / clip.audio.fadeOutUs;
  if (project) v *= automaticDuckingGain(project, track.id, atUs, clip);
  return Math.max(0, v);
}

/** Ganho extra (dB) dos keyframes "audio.gainDb" no tempo local — interpolação linear em amplitude, como no render. */
export function keyframeGainDb(clip: Clip, localUs: number): number {
  const kf = clip.keyframes['audio.gainDb'];
  if (!kf || !kf.length) return 0;
  const pts = [...kf].sort((a, b) => a.atUs - b.atUs);
  const lin = (db: number) => Math.pow(10, db / 20);
  if (localUs <= pts[0]!.atUs) return pts[0]!.value;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (localUs < b.atUs) {
      const x = (localUs - a.atUs) / (b.atUs - a.atUs);
      return 20 * Math.log10(Math.max(1e-6, lin(a.value) + (lin(b.value) - lin(a.value)) * x));
    }
  }
  return pts.at(-1)!.value;
}

export class Player {
  private project: Project;
  private slots = new Map<string, Slot>();
  private raf = 0;
  private playing = false;
  private clockStartUs = 0;
  private clockStartPerf = 0;
  private pausedAtUs = 0;
  private lastRenderAtMs = 0;
  private lastNotifyAtMs = 0;
  private ctx: CanvasRenderingContext2D | null = null;
  private colorBuffer: HTMLCanvasElement | null = null;
  private readonly colorLuts = new Map<string, ColorGradeLut>();
  private colorGradeGpu: ColorGradeGpu | null | undefined;
  private audioContext: AudioContext | null = null;
  private audioLimiter: DynamicsCompressorNode | null = null;
  private audioResume: Promise<void> | null = null;
  private listeners = new Set<(us: number) => void>();
  private endListeners = new Set<() => void>();
  private audioErrorListeners = new Set<(error: Error) => void>();
  private reportedAudioErrors = new Set<string>();

  constructor(
    project: Project,
    private readonly media: MediaSource,
  ) {
    this.project = project;
  }

  attach(canvas: HTMLCanvasElement): void {
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.loop();
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const s of this.slots.values()) this.release(s);
    this.slots.clear();
    this.ctx = null;
    this.lastRenderAtMs = 0;
    this.lastNotifyAtMs = 0;
  }

  setProject(p: Project): void {
    if (this.project === p) return;
    this.project = p;
    if (this.audioLimiter) {
      this.audioLimiter.threshold.value = p.audioMix.limiterCeilingDb;
      this.audioLimiter.ratio.value = p.audioMix.limiterEnabled ? 20 : 1;
    }
    // libera elementos de clipes que deixaram de existir
    const ids = new Set(p.clips.map((c) => c.id));
    for (const [id, s] of this.slots) {
      if (!ids.has(s.clipId)) {
        this.release(s);
        this.slots.delete(id);
      }
    }
    this.colorLuts.clear();
    if (!this.playing) {
      for (const slot of this.slots.values()) {
        if (slot.kind !== 'image') slot.needsSeek = true;
      }
    }
    this.lastRenderAtMs = 0;
  }

  onTime(l: (us: number) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onEnded(l: () => void): () => void {
    this.endListeners.add(l);
    return () => this.endListeners.delete(l);
  }

  onAudioError(l: (error: Error) => void): () => void {
    this.audioErrorListeners.add(l);
    return () => this.audioErrorListeners.delete(l);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get timeUs(): number {
    if (!this.playing) return this.pausedAtUs;
    return Math.round(this.clockStartUs + (performance.now() - this.clockStartPerf) * 1000);
  }

  seek(us: number): void {
    const t = Math.max(0, Math.round(us));
    if (this.playing) {
      this.clockStartUs = t;
      this.clockStartPerf = performance.now();
    } else {
      this.pausedAtUs = t;
    }
    for (const slot of this.slots.values()) if (slot.kind !== 'image') slot.needsSeek = true;
  }

  play(): void {
    if (this.playing) return;
    const end = projectDurationUs(this.project);
    if (end > 0 && this.pausedAtUs >= end) this.pausedAtUs = 0;
    this.playing = true;
    this.clockStartUs = this.pausedAtUs;
    this.clockStartPerf = performance.now();
    for (const slot of this.slots.values()) if (slot.kind !== 'image') slot.needsSeek = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAtUs = this.timeUs;
    this.playing = false;
    for (const s of this.slots.values()) if (s.kind !== 'image') (s.el as HTMLMediaElement).pause();
    this.suspendAudioContext();
  }

  // ------------------------------------------------------------ elementos

  private slotFor(clip: Clip, kind: Slot['kind'], slotKey = `${kind}:${clip.id}`): Slot | null {
    const existing = this.slots.get(slotKey);
    const url =
      kind === 'video' ? this.media.videoUrl(clip.assetId!) :
      kind === 'audio' ? this.media.audioUrl(clip.assetId!, clip.audio.streamIndex) :
      this.media.imageUrl(clip.assetId!);
    if (!url) {
      if (kind === 'audio') {
        this.reportAudioError(new Error('A faixa escolhida ainda não tem um proxy de áudio pronto.'), 'Áudio do preview indisponível');
      }
      return null;
    }
    if (existing && existing.url === url && existing.kind === kind) {
      existing.lastUsed = performance.now();
      return existing;
    }
    if (existing) this.release(existing);
    // reaproveita um elemento da mesma mídia que não está em uso neste quadro (mesmo episódio = mesmo proxy)
    for (const [id, s] of this.slots) {
      if (s.url === url && s.kind === kind && !this.frameUsed.has(id)) {
        this.slots.delete(id);
        const clipChanged = s.clipId !== clip.id;
        s.clipId = clip.id;
        s.lastUsed = performance.now();
        s.slotKey = slotKey;
        if (clipChanged) s.needsSeek = true;
        this.slots.set(slotKey, s);
        return s;
      }
    }
    let el: Slot['el'];
    if (kind === 'image') {
      const img = new Image();
      img.decoding = 'async';
      img.crossOrigin = 'anonymous';
      img.src = url;
      el = img;
    } else {
      const m = document.createElement(kind === 'video' ? 'video' : 'audio');
      m.preload = 'auto';
      m.crossOrigin = 'anonymous';
      if (m instanceof HTMLVideoElement) {
        m.muted = true; // vídeo nas trilhas de vídeo é só imagem; o som vem das trilhas de áudio
        m.playsInline = true;
      } else {
        m.volume = 1;
      }
      let sourceNode: MediaElementAudioSourceNode | null = null;
      let gainNode: GainNode | null = null;
      if (kind === 'audio') {
        try {
          ({ sourceNode, gainNode } = this.connectAudio(m));
        } catch (error) {
          this.reportAudioError(error, 'Não foi possível preparar o áudio do preview');
          return null;
        }
      }
      m.src = url;
      el = m;
      const slot: Slot = { slotKey, clipId: clip.id, el, kind, url, lastUsed: performance.now(), sourceNode, gainNode, needsSeek: true, lastSeekAtMs: 0, lastGain: null, lastFrame: null };
      this.slots.set(slotKey, slot);
      this.evict();
      return slot;
    }
    const slot: Slot = { slotKey, clipId: clip.id, el, kind, url, lastUsed: performance.now(), sourceNode: null, gainNode: null, needsSeek: true, lastSeekAtMs: 0, lastGain: null, lastFrame: null };
    this.slots.set(slotKey, slot);
    this.evict();
    return slot;
  }

  private connectAudio(element: HTMLMediaElement): { sourceNode: MediaElementAudioSourceNode; gainNode: GainNode } {
    const context = this.ensureAudioContext();
    const limiter = this.audioLimiter;
    if (!limiter) throw new Error('O limitador do preview não foi inicializado.');
    const sourceNode = context.createMediaElementSource(element);
    const gainNode = context.createGain();
    try {
      sourceNode.connect(gainNode);
      gainNode.connect(limiter);
    } catch (error) {
      sourceNode.disconnect();
      gainNode.disconnect();
      throw error;
    }
    return { sourceNode, gainNode };
  }

  private ensureAudioContext(): AudioContext {
    if (this.audioContext && this.audioLimiter) return this.audioContext;
    const context = new AudioContext();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = this.project.audioMix.limiterCeilingDb;
    limiter.knee.value = 0;
    limiter.ratio.value = this.project.audioMix.limiterEnabled ? 20 : 1;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.05;
    limiter.connect(context.destination);
    this.audioContext = context;
    this.audioLimiter = limiter;
    return context;
  }

  private reportAudioError(error: unknown, context: string): void {
    const detail = error instanceof Error ? error.message : String(error);
    const message = `${context}: ${detail}`;
    if (this.reportedAudioErrors.has(message)) return;
    this.reportedAudioErrors.add(message);
    const report = new Error(message);
    console.error(report);
    for (const listener of this.audioErrorListeners) listener(report);
  }

  private suspendAudioContext(): void {
    const context = this.audioContext;
    if (context?.state === 'running') {
      void context.suspend().catch((error: unknown) => this.reportAudioError(error, 'Não foi possível pausar o áudio do preview'));
    }
  }

  private resumeAudioContext(): void {
    const context = this.audioContext;
    if (context?.state !== 'suspended' || this.audioResume) return;
    const resume = context.resume();
    this.audioResume = resume;
    void resume
      .catch((error: unknown) => this.reportAudioError(error, 'Não foi possível iniciar o áudio do preview'))
      .finally(() => {
        if (this.audioResume === resume) this.audioResume = null;
      });
  }

  private release(s: Slot): void {
    s.sourceNode?.disconnect();
    s.gainNode?.disconnect();
    if (s.kind !== 'image') {
      const m = s.el as HTMLMediaElement;
      m.pause();
      m.removeAttribute('src');
      m.load();
    }
    if (s.lastFrame) {
      s.lastFrame.width = 0;
      s.lastFrame.height = 0;
      s.lastFrame = null;
    }
  }

  private evict(): void {
    if (this.slots.size <= MAX_SLOTS) return;
    const candidates = [...this.slots.values()]
      .filter((s) => !this.frameUsed.has(s.slotKey))
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const toRemove = this.slots.size - MAX_SLOTS;
    for (const s of candidates.slice(0, toRemove)) {
      this.release(s);
      this.slots.delete(s.slotKey);
    }
  }

  private syncMedia(m: HTMLMediaElement, clip: Clip, atUs: number, volume: number | null, slot: Slot, kind: 'video' | 'audio'): void {
    const target = sourceTimeS(clip, atUs);
    if (volume !== null) {
      const context = this.audioContext;
      if (!slot.gainNode || !context) {
        this.reportAudioError(new Error('O clipe de áudio não tem um caminho de ganho ativo.'), 'Áudio do preview indisponível');
        m.volume = 0;
      } else {
        m.volume = 1;
        const gain = clip.reverse ? 0 : volume;
        if (slot.lastGain === null || Math.abs(slot.lastGain - gain) >= 0.005) {
          slot.gainNode.gain.setTargetAtTime(gain, context.currentTime, 0.015);
          slot.lastGain = gain;
        }
      }
    }
    m.preservesPitch = clip.audio.pitchMode === 'preserve';
    const playbackRate = speedAt(clip, atUs - clip.timelineStartUs);
    const drift = m.currentTime - target;
    if (clip.reverse || playbackRate <= 0.001) {
      if (!m.paused) m.pause();
      if (!m.seeking && m.readyState >= 1 && (slot.needsSeek || Math.abs(drift) > 0.015)) {
        m.currentTime = target;
        slot.needsSeek = false;
        slot.lastSeekAtMs = performance.now();
      }
      return;
    }
    if (this.playing) {
      this.resumeAudioContext();
      if (m.playbackRate !== playbackRate) m.playbackRate = playbackRate;
      const now = performance.now();
      if (shouldHardSeekMedia(kind, drift, {
        playing: true,
        seeking: m.seeking,
        readyState: m.readyState,
        needsSeek: slot.needsSeek,
        sinceLastSeekMs: now - slot.lastSeekAtMs,
      })) {
        m.currentTime = target;
        slot.needsSeek = false;
        slot.lastSeekAtMs = now;
      }
      if (m.paused) {
        void m.play().catch((error: unknown) => {
          if (volume !== null) this.reportAudioError(error, 'Não foi possível reproduzir o áudio do preview');
        });
      }
    } else {
      if (!m.paused) m.pause();
      if (shouldHardSeekMedia(kind, drift, {
        playing: false,
        seeking: m.seeking,
        readyState: m.readyState,
        needsSeek: slot.needsSeek,
        sinceLastSeekMs: performance.now() - slot.lastSeekAtMs,
      })) {
        m.currentTime = target;
        slot.needsSeek = false;
        slot.lastSeekAtMs = performance.now();
      }
    }
  }

  // ------------------------------------------------------------ quadro

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const t = this.timeUs;
    const end = projectDurationUs(this.project);
    if (this.playing && end > 0 && t >= end) {
      this.pause();
      this.pausedAtUs = end;
      for (const l of this.endListeners) l();
    }
    const fps = this.project.settings.fps.num / this.project.settings.fps.den;
    const frameIntervalMs = 1000 / Math.min(30, Math.max(12, fps));
    if (now - this.lastRenderAtMs >= frameIntervalMs) {
      this.lastRenderAtMs = now;
      this.renderAt(Math.min(t, end || t));
    }
    if (this.playing && now - this.lastNotifyAtMs >= PLAYHEAD_UPDATE_MS) {
      this.lastNotifyAtMs = now;
      for (const l of this.listeners) l(this.timeUs);
    }
  };

  /** Clipes que já pegaram um elemento neste quadro (não podem ser reaproveitados). */
  private frameUsed = new Set<string>();

  private renderAt(t: number): void {
    const ctx = this.ctx;
    const p = this.project;
    const used = new Set<string>();
    this.frameUsed = used;
    const mixTracks = p.tracks.filter((track) => track.kind === 'audio' || (track.kind === 'video' && p.audioMix.includeVideoAudio));
    const anySolo = mixTracks.some((track) => track.solo);

    // áudio: todas as trilhas de áudio
    for (const track of p.tracks) {
      if (track.kind !== 'audio') continue;
      const trackClips = p.clips.filter((c) => c.trackId === track.id && c.assetId);
      const nextAudio = trackClips
        .filter((c) => c.timelineStartUs > t && c.timelineStartUs - PRELOAD_US <= t)
        .sort((a, b) => a.timelineStartUs - b.timelineStartUs)[0];
      for (const c of trackClips) {
        const near = (t >= c.timelineStartUs && t < clipEndUs(c)) || c === nextAudio;
        if (!near) continue;
        const slot = this.slotFor(c, 'audio');
        if (!slot) continue;
        used.add(slot.slotKey);
        const m = slot.el as HTMLMediaElement;
        if (t >= c.timelineStartUs) this.syncMedia(m, c, t, clipVolume(c, track, t, anySolo, this.project), slot, 'audio');
        else {
          // pré-carregado: parado no primeiro quadro
          if (!m.paused) m.pause();
          const first = sourceTimeS(c, c.timelineStartUs);
          if (Math.abs(m.currentTime - first) > 0.05 && m.readyState >= 1 && !m.seeking) m.currentTime = first;
        }
      }
    }

    if (p.audioMix.includeVideoAudio) {
      for (const track of p.tracks) {
        if (track.kind !== 'video' || track.muted || (anySolo && !track.solo)) continue;
        const audioTrack: Track = { ...track, kind: 'audio', role: 'voice' };
        for (const c of p.clips) {
          if (c.trackId !== track.id || !c.assetId) continue;
          // Só processa áudio embutido para clipe ativo com volume audível
          if (t < c.timelineStartUs || t >= clipEndUs(c)) continue;
          const vol = clipVolume(c, audioTrack, t, anySolo, this.project);
          if (vol <= 0.003) continue;
          const asset = p.assets.find((item) => item.id === c.assetId);
          if (!asset?.probe?.audio.length) continue;
          const slot = this.slotFor(c, 'audio', `embedded-audio:${c.id}`);
          if (!slot) continue;
          used.add(slot.slotKey);
          const media = slot.el as HTMLMediaElement;
          this.syncMedia(media, c, t, vol, slot, 'audio');
        }
      }
    }

    if (!ctx) return;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.fillStyle = p.settings.background;
    ctx.fillRect(0, 0, W, H);
    const k = W / p.settings.width; // escala projeto → canvas

    // vídeo: de baixo para cima (a última trilha de vídeo da lista é a de baixo)
    const visual = p.tracks.filter((x) => x.kind !== 'audio');
    for (let i = visual.length - 1; i >= 0; i--) {
      const track = visual[i]!;
      if (track.hidden) continue;
      const trackClips = p.clips.filter((c) => c.trackId === track.id);
      // pré-carrega só o PRÓXIMO clipe da trilha (com cortes rápidos, seriam vários)
      const next = trackClips.filter((c) => c.timelineStartUs > t && c.timelineStartUs - PRELOAD_US <= t).sort((a, b) => a.timelineStartUs - b.timelineStartUs)[0];
      for (const c of trackClips) {
        const near = (t >= c.timelineStartUs && t < clipEndUs(c)) || c === next;
        if (!near) continue;
        const active = t >= c.timelineStartUs;
        const localS = (t - c.timelineStartUs) / 1e6;
        let look = evalClipLook(c, localS, c.durationUs / 1e6);
        // transição de entrada: o clipe anterior continua por baixo (origem segue além do fim)
        if (active && c.transitionIn && localS < c.transitionIn.durationUs / 1e6) {
          look = applyWhipPan(look, c.transitionIn, localS, false, p.settings.width);
          const under = transitionUnderlay(trackClips, c);
          if (under) {
            let ulook = evalClipLook(under, (t - under.timelineStartUs) / 1e6, under.durationUs / 1e6);
            ulook = applyWhipPan(ulook, c.transitionIn, localS, true, p.settings.width);
            ulook.overlays = [];
            this.drawClip(ctx, under, t, ulook, k, used, true);
          }
        }
        if (c.text) {
          if (active) {
            this.drawText(ctx, c, k, look, localS);
            this.drawOverlays(ctx, look);
          }
          continue;
        }
        this.drawClip(ctx, c, t, look, k, used, active);
        if (active) this.drawOverlays(ctx, look);
      }
    }

    // pausa o que não está mais perto do playhead; fecha o que ficou parado (libera a conexão)
    const now = performance.now();
    for (const [id, s] of this.slots) {
      if (used.has(id) || s.kind === 'image') continue;
      const m = s.el as HTMLMediaElement;
      if (!m.paused) m.pause();
      if (now - s.lastUsed > IDLE_RELEASE_MS) {
        this.release(s);
        this.slots.delete(id);
      }
    }
  }

  /** Sincroniza (ou pré-carrega) e desenha um clipe de vídeo/imagem. */
  private drawClip(ctx: CanvasRenderingContext2D, c: Clip, t: number, look: ClipLook, k: number, used: Set<string>, active: boolean): void {
    if (!c.assetId) return;
    const localS = (t - c.timelineStartUs) / 1e6;
    const asset = this.project.assets.find((a) => a.id === c.assetId);
    if (!asset) return;
    const kind = asset.kind === 'image' ? 'image' : 'video';
    const slot = this.slotFor(c, kind);
    if (!slot) {
      if (active) this.drawPlaceholder(ctx, 'Preparando proxy…');
      return;
    }
    used.add(slot.slotKey);
    if (kind === 'video') {
      const v = slot.el as HTMLVideoElement;
      if (active) this.syncMedia(v, c, t, null, slot, 'video');
      else {
        if (!v.paused) v.pause();
        const first = sourceTimeS(c, c.timelineStartUs);
        if (Math.abs(v.currentTime - first) > 0.05 && v.readyState >= 1 && !v.seeking) v.currentTime = first;
      }
      if (active && v.readyState >= 2 && v.videoWidth && v.videoHeight) {
        if (!v.seeking && (!slot.lastFrame || !this.playing)) {
          slot.lastFrame ??= document.createElement('canvas');
          if (slot.lastFrame.width !== v.videoWidth) slot.lastFrame.width = v.videoWidth;
          if (slot.lastFrame.height !== v.videoHeight) slot.lastFrame.height = v.videoHeight;
          slot.lastFrame.getContext('2d')?.drawImage(v, 0, 0);
        }
        this.drawMedia(ctx, v, v.videoWidth, v.videoHeight, c, k, look, localS);
      } else if (active && slot.lastFrame?.width && slot.lastFrame.height) {
        this.drawMedia(ctx, slot.lastFrame, slot.lastFrame.width, slot.lastFrame.height, c, k, look, localS);
      } else if (active) {
        this.drawPlaceholder(ctx, 'Carregando quadro…');
      }
    } else if (active) {
      const img = slot.el as HTMLImageElement;
      if (img.complete && img.naturalWidth) this.drawMedia(ctx, img, img.naturalWidth, img.naturalHeight, c, k, look, localS);
    }
  }

  private drawMedia(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, c: Clip, k: number, look: ClipLook, localS: number): void {
    if (!sw || !sh || look.alpha <= 0) return;
    const P = this.project.settings;
    const tr = c.transform;
    const localUs = Math.round(localS * 1e6);
    const x = evaluateKeyframes(c.keyframes['transform.x'], localUs, tr.x);
    const y = evaluateKeyframes(c.keyframes['transform.y'], localUs, tr.y);
    const scale = evaluateKeyframes(c.keyframes['transform.scale'], localUs, tr.scale);
    const rotation = evaluateKeyframes(c.keyframes['transform.rotation'], localUs, tr.rotation);
    const opacity = evaluateKeyframes(c.keyframes['transform.opacity'], localUs, tr.opacity);
    const crop = tr.crop;
    let cw = sw * (1 - crop.left - crop.right);
    let ch = sh * (1 - crop.top - crop.bottom);
    if (cw <= 0 || ch <= 0) return;
    let sx = sw * crop.left;
    let sy = sh * crop.top;
    // encaixa (contain) no quadro do projeto, depois aplica escala/posição/rotação
    const fit = Math.min(P.width / cw, P.height / ch);
    const w = cw * fit * scale;
    const h = ch * fit * scale;
    // zoom = recorte central ampliado (igual ao zoompan da exportação)
    if (look.zoom > 1) {
      const nw = cw / look.zoom;
      const nh = ch / look.zoom;
      sx += (cw - nw) / 2;
      sy += (ch - nh) / 2;
      cw = nw;
      ch = nh;
    }
    let drawable: CanvasImageSource = src;
    const grade = aggregateColorGrade(c.effects);
    const filters: string[] = [];
    if (!isColorGradeNeutral(grade)) {
      const isSimple = grade.temperature === 0 && grade.tint === 0 && grade.shadows === 0 && grade.midtones === 0 && grade.highlights === 0;
      if (isSimple) {
        if (grade.brightness || grade.exposure) filters.push(`brightness(${Math.max(0, 1 + grade.brightness + grade.exposure)})`);
        if (grade.contrast !== 1) filters.push(`contrast(${Math.max(0, grade.contrast)})`);
        if (grade.saturation !== 1) filters.push(`saturate(${Math.max(0, grade.saturation)})`);
        if (grade.hue) filters.push(`hue-rotate(${grade.hue}deg)`);
        drawable = src;
      } else {
        const gradeKey = JSON.stringify(grade);
        let lut = this.colorLuts.get(gradeKey);
        if (!lut) {
          lut = createColorGradeLut(grade);
          this.colorLuts.set(gradeKey, lut);
          if (this.colorLuts.size > 64) this.colorLuts.delete(this.colorLuts.keys().next().value!);
        }
        this.colorBuffer ??= document.createElement('canvas');
        const buffer = this.colorBuffer;
        const bufferWidth = Math.max(1, Math.round(w * k));
        const bufferHeight = Math.max(1, Math.round(h * k));
        if (buffer.width !== bufferWidth) buffer.width = bufferWidth;
        if (buffer.height !== bufferHeight) buffer.height = bufferHeight;
        const bufferContext = buffer.getContext('2d');
        if (bufferContext) {
          bufferContext.drawImage(src, sx, sy, cw, ch, 0, 0, bufferWidth, bufferHeight);
          if (this.colorGradeGpu === undefined) {
            this.colorGradeGpu = ColorGradeGpu.create();
            if (!this.colorGradeGpu) console.warn('WebGL2 indisponível para o color grade; usando processamento GPU 2D.');
          }
          const gpuOutput = this.colorGradeGpu?.apply(buffer, gradeKey, lut);
          if (gpuOutput) {
            drawable = gpuOutput;
            sx = 0;
            sy = 0;
            cw = bufferWidth;
            ch = bufferHeight;
          } else {
            if (grade.brightness || grade.exposure) filters.push(`brightness(${Math.max(0, 1 + grade.brightness + grade.exposure)})`);
            if (grade.contrast !== 1) filters.push(`contrast(${Math.max(0, grade.contrast)})`);
            if (grade.saturation !== 1) filters.push(`saturate(${Math.max(0, grade.saturation)})`);
            if (grade.hue) filters.push(`hue-rotate(${grade.hue}deg)`);
            drawable = src;
          }
        }
      }
    }
    ctx.save();
    ctx.globalAlpha = look.alpha * Math.max(0, Math.min(1, opacity));
    ctx.globalCompositeOperation = canvasBlendMode(c.blendMode);
    if (look.blur > 0) filters.push(`blur(${look.blur * k}px)`);
    if (filters.length) ctx.filter = filters.join(' ');
    ctx.translate((P.width / 2 + x + look.dx) * k, (P.height / 2 + y + look.dy) * k);
    if (rotation) ctx.rotate((rotation * Math.PI) / 180);
    clipMask(ctx, c.mask, -w * k / 2, -h * k / 2, w * k, h * k);
    if (look.rgbSplit > 0) {
      // canais deslocados: vermelho para um lado, azul para o outro
      const off = look.rgbSplit * k;
      ctx.drawImage(drawable, sx, sy, cw, ch, (-w / 2) * k, (-h / 2) * k, w * k, h * k);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = look.alpha * 0.35;
      ctx.drawImage(drawable, sx, sy, cw, ch, (-w / 2) * k - off, (-h / 2) * k, w * k, h * k);
      ctx.drawImage(drawable, sx, sy, cw, ch, (-w / 2) * k + off, (-h / 2) * k, w * k, h * k);
    } else {
      ctx.drawImage(drawable, sx, sy, cw, ch, (-w / 2) * k, (-h / 2) * k, w * k, h * k);
    }
    ctx.restore();
    if (look.vignette > 0) {
      const W = ctx.canvas.width;
      const H = ctx.canvas.height;
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, look.vignette)})`);
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /** Camadas de cor (clarão, fades, mergulho) por cima — mesmas rampas da exportação. */
  private drawOverlays(ctx: CanvasRenderingContext2D, look: ClipLook): void {
    for (const o of look.overlays) {
      ctx.save();
      ctx.globalAlpha = o.alpha;
      ctx.fillStyle = o.white ? '#ffffff' : '#000000';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }
  }

  private drawText(ctx: CanvasRenderingContext2D, c: Clip, k: number, look: ClipLook, localS: number): void {
    ctx.save();
    ctx.globalCompositeOperation = canvasBlendMode(c.blendMode);
    clipMask(ctx, c.mask, 0, 0, ctx.canvas.width, ctx.canvas.height);
    drawTextLayer(ctx, c, this.project.settings.width, this.project.settings.height, k, look, localS);
    ctx.restore();
  }

  private drawPlaceholder(ctx: CanvasRenderingContext2D, text: string): void {
    ctx.save();
    ctx.fillStyle = '#8d91a2';
    ctx.font = `500 ${Math.max(12, ctx.canvas.height / 24)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(text, ctx.canvas.width / 2, ctx.canvas.height / 2);
    ctx.restore();
  }
}
