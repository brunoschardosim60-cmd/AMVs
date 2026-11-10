/**
 * Motor de preview. Lê o projeto, mantém um elemento de mídia por clipe perto do
 * playhead, sincroniza com o relógio da timeline e compõe o quadro num <canvas>.
 *
 * O preview usa os PROXIES (H.264 leve). É "melhor esforço": a exportação (Fase 3)
 * usa os originais e é exata. O tempo do projeto é sempre a fonte da verdade.
 */
import { drawTextLayer } from './textLayer';
import { clipEndUs, evalClipLook, projectDurationUs, transitionUnderlay, type Clip, type ClipLook, type Project, type Track } from '@amv/project';

export interface MediaSource {
  /** URL do proxy de vídeo (vídeos) ou do arquivo/proxy de áudio. */
  videoUrl(assetId: string): string | null;
  audioUrl(assetId: string): string | null;
  imageUrl(assetId: string): string | null;
}

interface Slot {
  clipId: string;
  el: HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
  kind: 'video' | 'audio' | 'image';
  url: string;
  lastUsed: number;
  sourceNode: MediaElementAudioSourceNode | null;
  gainNode: GainNode | null;
}

/** Margem para pré-carregar o próximo clipe antes de ele começar. */
const PRELOAD_US = 2_000_000;
/** Diferença tolerada entre o vídeo e o relógio antes de corrigir, tocando. */
const DRIFT_PLAYING_S = 0.12;
/** Pausado: busca o quadro exato se estiver a mais de meio quadro. */
const DRIFT_PAUSED_S = 0.02;
/**
 * Poucos elementos de mídia vivos: cada um mantém uma conexão aberta com o proxy, e o
 * WebView2 só abre ~6 por endereço. Com 24 vivos, os novos ficavam esperando e o preview preto.
 */
const MAX_SLOTS = 6;
/** Elemento fora do playhead há mais que isso é fechado (libera a conexão). */
const IDLE_RELEASE_MS = 1500;

export function sourceTimeS(clip: Clip, atUs: number): number {
  return (clip.sourceInUs + (atUs - clip.timelineStartUs) * clip.speed) / 1e6;
}

export function activeClips(project: Project, atUs: number, track: Track): Clip | null {
  for (const c of project.clips) {
    if (c.trackId === track.id && atUs >= c.timelineStartUs && atUs < clipEndUs(c)) return c;
  }
  return null;
}

/** Ganho linear de um clipe de áudio no instante, incluindo fades e ganho da trilha. */
export function clipVolume(clip: Clip, track: Track, atUs: number, anySolo: boolean): number {
  if (track.muted || (anySolo && !track.solo)) return 0;
  const db = clip.audio.gainDb + track.gainDb + keyframeGainDb(clip, atUs - clip.timelineStartUs);
  let v = Math.pow(10, db / 20);
  const into = atUs - clip.timelineStartUs;
  const left = clipEndUs(clip) - atUs;
  if (clip.audio.fadeInUs > 0 && into < clip.audio.fadeInUs) v *= into / clip.audio.fadeInUs;
  if (clip.audio.fadeOutUs > 0 && left < clip.audio.fadeOutUs) v *= left / clip.audio.fadeOutUs;
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
  private ctx: CanvasRenderingContext2D | null = null;
  private audioContext: AudioContext | null = null;
  private audioLimiter: DynamicsCompressorNode | null = null;
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
  }

  setProject(p: Project): void {
    this.project = p;
    // libera elementos de clipes que deixaram de existir
    const ids = new Set(p.clips.map((c) => c.id));
    for (const [id, s] of this.slots) {
      if (!ids.has(id)) {
        this.release(s);
        this.slots.delete(id);
      }
    }
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
  }

  play(): void {
    if (this.playing) return;
    const end = projectDurationUs(this.project);
    if (end > 0 && this.pausedAtUs >= end) this.pausedAtUs = 0;
    this.playing = true;
    this.clockStartUs = this.pausedAtUs;
    this.clockStartPerf = performance.now();
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAtUs = this.timeUs;
    this.playing = false;
    for (const s of this.slots.values()) if (s.kind !== 'image') (s.el as HTMLMediaElement).pause();
    this.suspendAudioContext();
  }

  // ------------------------------------------------------------ elementos

  private slotFor(clip: Clip, kind: Slot['kind']): Slot | null {
    const existing = this.slots.get(clip.id);
    const url =
      kind === 'video' ? this.media.videoUrl(clip.assetId!) : kind === 'audio' ? this.media.audioUrl(clip.assetId!) : this.media.imageUrl(clip.assetId!);
    if (!url) return null;
    if (existing && existing.url === url && existing.kind === kind) {
      existing.lastUsed = performance.now();
      return existing;
    }
    if (existing) this.release(existing);
    // reaproveita um elemento da mesma mídia que não está em uso neste quadro (mesmo episódio = mesmo proxy)
    for (const [id, s] of this.slots) {
      if (s.url === url && s.kind === kind && !this.frameUsed.has(id)) {
        this.slots.delete(id);
        s.clipId = clip.id;
        s.lastUsed = performance.now();
        this.slots.set(clip.id, s);
        return s;
      }
    }
    let el: Slot['el'];
    if (kind === 'image') {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      el = img;
    } else {
      const m = document.createElement(kind === 'video' ? 'video' : 'audio');
      m.preload = 'auto';
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
      const slot: Slot = { clipId: clip.id, el, kind, url, lastUsed: performance.now(), sourceNode, gainNode };
      this.slots.set(clip.id, slot);
      this.evict();
      return slot;
    }
    const slot: Slot = { clipId: clip.id, el, kind, url, lastUsed: performance.now(), sourceNode: null, gainNode: null };
    this.slots.set(clip.id, slot);
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
    limiter.threshold.value = -0.3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
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

  private release(s: Slot): void {
    s.sourceNode?.disconnect();
    s.gainNode?.disconnect();
    if (s.kind !== 'image') {
      const m = s.el as HTMLMediaElement;
      m.pause();
      m.removeAttribute('src');
      m.load();
    }
  }

  private evict(): void {
    if (this.slots.size <= MAX_SLOTS) return;
    const sorted = [...this.slots.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    for (const s of sorted.slice(0, this.slots.size - MAX_SLOTS)) {
      this.release(s);
      this.slots.delete(s.clipId);
    }
  }

  private syncMedia(m: HTMLMediaElement, clip: Clip, atUs: number, volume: number | null, gainNode: GainNode | null = null): void {
    const target = sourceTimeS(clip, atUs);
    if (volume !== null) {
      const context = this.audioContext;
      if (!gainNode || !context) {
        this.reportAudioError(new Error('O clipe de áudio não tem um caminho de ganho ativo.'), 'Áudio do preview indisponível');
        m.volume = 0;
      } else {
        m.volume = 1;
        gainNode.gain.setTargetAtTime(volume, context.currentTime, 0.015);
      }
    }
    if (this.playing) {
      if (this.audioContext?.state === 'suspended') {
        void this.audioContext.resume().catch((error: unknown) => this.reportAudioError(error, 'Não foi possível iniciar o áudio do preview'));
      }
      if (m.playbackRate !== clip.speed) m.playbackRate = clip.speed;
      if (Math.abs(m.currentTime - target) > DRIFT_PLAYING_S && m.readyState >= 1) m.currentTime = target;
      if (m.paused) {
        void m.play().catch((error: unknown) => {
          if (volume !== null) this.reportAudioError(error, 'Não foi possível reproduzir o áudio do preview');
        });
      }
    } else {
      if (!m.paused) m.pause();
      if (Math.abs(m.currentTime - target) > DRIFT_PAUSED_S && !m.seeking && m.readyState >= 1) m.currentTime = target;
    }
  }

  // ------------------------------------------------------------ quadro

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const t = this.timeUs;
    const end = projectDurationUs(this.project);
    if (this.playing && end > 0 && t >= end) {
      this.pause();
      this.pausedAtUs = end;
      for (const l of this.endListeners) l();
    }
    this.renderAt(Math.min(t, end || t));
    for (const l of this.listeners) l(this.timeUs);
  };

  /** Clipes que já pegaram um elemento neste quadro (não podem ser reaproveitados). */
  private frameUsed = new Set<string>();

  private renderAt(t: number): void {
    const ctx = this.ctx;
    const p = this.project;
    const used = new Set<string>();
    this.frameUsed = used;
    const anySolo = p.tracks.some((x) => x.solo);

    // áudio: todas as trilhas de áudio
    for (const track of p.tracks) {
      if (track.kind !== 'audio') continue;
      for (const c of p.clips) {
        if (c.trackId !== track.id || !c.assetId) continue;
        const near = t >= c.timelineStartUs - PRELOAD_US && t < clipEndUs(c);
        if (!near) continue;
        const slot = this.slotFor(c, 'audio');
        if (!slot) continue;
        used.add(c.id);
        const m = slot.el as HTMLMediaElement;
        if (t >= c.timelineStartUs) this.syncMedia(m, c, t, clipVolume(c, track, t, anySolo), slot.gainNode);
        else {
          // pré-carregado: parado no primeiro quadro
          if (!m.paused) m.pause();
          const first = c.sourceInUs / 1e6;
          if (Math.abs(m.currentTime - first) > 0.05 && m.readyState >= 1 && !m.seeking) m.currentTime = first;
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
        const look = evalClipLook(c, localS, c.durationUs / 1e6);
        // transição de entrada: o clipe anterior continua por baixo (origem segue além do fim)
        if (active && c.transitionIn && localS < c.transitionIn.durationUs / 1e6) {
          const under = transitionUnderlay(trackClips, c);
          if (under) {
            const ulook = evalClipLook(under, (t - under.timelineStartUs) / 1e6, under.durationUs / 1e6);
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
    const asset = this.project.assets.find((a) => a.id === c.assetId);
    if (!asset) return;
    const kind = asset.kind === 'image' ? 'image' : 'video';
    const slot = this.slotFor(c, kind);
    if (!slot) {
      if (active) this.drawPlaceholder(ctx, 'Preparando proxy…');
      return;
    }
    used.add(c.id);
    if (kind === 'video') {
      const v = slot.el as HTMLVideoElement;
      if (active) this.syncMedia(v, c, t, null);
      else {
        if (!v.paused) v.pause();
        const first = c.sourceInUs / 1e6;
        if (Math.abs(v.currentTime - first) > 0.05 && v.readyState >= 1 && !v.seeking) v.currentTime = first;
      }
      if (active && v.readyState >= 2) this.drawMedia(ctx, v, v.videoWidth, v.videoHeight, c, k, look);
    } else if (active) {
      const img = slot.el as HTMLImageElement;
      if (img.complete && img.naturalWidth) this.drawMedia(ctx, img, img.naturalWidth, img.naturalHeight, c, k, look);
    }
  }

  private drawMedia(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, c: Clip, k: number, look: ClipLook): void {
    if (!sw || !sh || look.alpha <= 0) return;
    const P = this.project.settings;
    const tr = c.transform;
    const crop = tr.crop;
    let cw = sw * (1 - crop.left - crop.right);
    let ch = sh * (1 - crop.top - crop.bottom);
    if (cw <= 0 || ch <= 0) return;
    let sx = sw * crop.left;
    let sy = sh * crop.top;
    // encaixa (contain) no quadro do projeto, depois aplica escala/posição/rotação
    const fit = Math.min(P.width / cw, P.height / ch);
    const w = cw * fit * tr.scale;
    const h = ch * fit * tr.scale;
    // zoom = recorte central ampliado (igual ao zoompan da exportação)
    if (look.zoom > 1) {
      const nw = cw / look.zoom;
      const nh = ch / look.zoom;
      sx += (cw - nw) / 2;
      sy += (ch - nh) / 2;
      cw = nw;
      ch = nh;
    }
    ctx.save();
    ctx.globalAlpha = look.alpha;
    const filters: string[] = [];
    if (look.blur > 0) filters.push(`blur(${look.blur * k}px)`);
    if (look.brightness) filters.push(`brightness(${1 + look.brightness})`);
    if (look.contrast !== 1) filters.push(`contrast(${look.contrast})`);
    if (look.saturation !== 1) filters.push(`saturate(${look.saturation})`);
    if (filters.length) ctx.filter = filters.join(' ');
    ctx.translate((P.width / 2 + tr.x + look.dx) * k, (P.height / 2 + tr.y + look.dy) * k);
    if (tr.rotation) ctx.rotate((tr.rotation * Math.PI) / 180);
    if (look.rgbSplit > 0) {
      // canais deslocados: vermelho para um lado, azul para o outro
      const off = look.rgbSplit * k;
      ctx.drawImage(src, sx, sy, cw, ch, (-w / 2) * k, (-h / 2) * k, w * k, h * k);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = look.alpha * 0.35;
      ctx.drawImage(src, sx, sy, cw, ch, (-w / 2) * k - off, (-h / 2) * k, w * k, h * k);
      ctx.drawImage(src, sx, sy, cw, ch, (-w / 2) * k + off, (-h / 2) * k, w * k, h * k);
    } else {
      ctx.drawImage(src, sx, sy, cw, ch, (-w / 2) * k, (-h / 2) * k, w * k, h * k);
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
    drawTextLayer(ctx, c, this.project.settings.width, this.project.settings.height, k, look, localS);
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
