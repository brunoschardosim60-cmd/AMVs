/**
 * Motor de preview. Lê o projeto, mantém um elemento de mídia por clipe perto do
 * playhead, sincroniza com o relógio da timeline e compõe o quadro num <canvas>.
 *
 * O preview usa os PROXIES (H.264 leve). É "melhor esforço": a exportação (Fase 3)
 * usa os originais e é exata. O tempo do projeto é sempre a fonte da verdade.
 */
import { clipEndUs, projectDurationUs, type Clip, type Project, type Track } from '@amv/project';

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
}

/** Margem para pré-carregar o próximo clipe antes de ele começar. */
const PRELOAD_US = 2_000_000;
/** Diferença tolerada entre o vídeo e o relógio antes de corrigir, tocando. */
const DRIFT_PLAYING_S = 0.12;
/** Pausado: busca o quadro exato se estiver a mais de meio quadro. */
const DRIFT_PAUSED_S = 0.02;
const MAX_SLOTS = 24;

export function sourceTimeS(clip: Clip, atUs: number): number {
  return (clip.sourceInUs + (atUs - clip.timelineStartUs) * clip.speed) / 1e6;
}

export function activeClips(project: Project, atUs: number, track: Track): Clip | null {
  for (const c of project.clips) {
    if (c.trackId === track.id && atUs >= c.timelineStartUs && atUs < clipEndUs(c)) return c;
  }
  return null;
}

/** Ganho efetivo (0..1) de um clipe de áudio no instante, com fades. */
export function clipVolume(clip: Clip, track: Track, atUs: number, anySolo: boolean): number {
  if (track.muted || (anySolo && !track.solo)) return 0;
  const db = clip.audio.gainDb + track.gainDb;
  let v = Math.pow(10, db / 20);
  const into = atUs - clip.timelineStartUs;
  const left = clipEndUs(clip) - atUs;
  if (clip.audio.fadeInUs > 0 && into < clip.audio.fadeInUs) v *= into / clip.audio.fadeInUs;
  if (clip.audio.fadeOutUs > 0 && left < clip.audio.fadeOutUs) v *= left / clip.audio.fadeOutUs;
  // elementos de mídia só aceitam 0..1; ganho acima de 0 dB fica para o mixer (Fase 3)
  return Math.max(0, Math.min(1, v));
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
  private listeners = new Set<(us: number) => void>();
  private endListeners = new Set<() => void>();

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
      }
      m.src = url;
      el = m;
    }
    const slot: Slot = { clipId: clip.id, el, kind, url, lastUsed: performance.now() };
    this.slots.set(clip.id, slot);
    this.evict();
    return slot;
  }

  private release(s: Slot): void {
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

  private syncMedia(m: HTMLMediaElement, clip: Clip, atUs: number, volume: number | null): void {
    const target = sourceTimeS(clip, atUs);
    if (volume !== null) m.volume = volume;
    if (this.playing) {
      if (m.playbackRate !== clip.speed) m.playbackRate = clip.speed;
      if (Math.abs(m.currentTime - target) > DRIFT_PLAYING_S && m.readyState >= 1) m.currentTime = target;
      if (m.paused) void m.play().catch(() => undefined);
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

  private renderAt(t: number): void {
    const ctx = this.ctx;
    const p = this.project;
    const used = new Set<string>();
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
        if (t >= c.timelineStartUs) this.syncMedia(m, c, t, clipVolume(c, track, t, anySolo));
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
      for (const c of p.clips) {
        if (c.trackId !== track.id) continue;
        const near = t >= c.timelineStartUs - PRELOAD_US && t < clipEndUs(c);
        if (!near) continue;
        const active = t >= c.timelineStartUs;
        if (c.text) {
          if (active) this.drawText(ctx, c, k);
          continue;
        }
        if (!c.assetId) continue;
        const asset = p.assets.find((a) => a.id === c.assetId);
        if (!asset) continue;
        const kind = asset.kind === 'image' ? 'image' : 'video';
        const slot = this.slotFor(c, kind);
        if (!slot) {
          if (active) this.drawPlaceholder(ctx, 'Preparando proxy…');
          continue;
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
          if (active && v.readyState >= 2) this.drawMedia(ctx, v, v.videoWidth, v.videoHeight, c, k);
        } else if (active) {
          const img = slot.el as HTMLImageElement;
          if (img.complete && img.naturalWidth) this.drawMedia(ctx, img, img.naturalWidth, img.naturalHeight, c, k);
        }
      }
    }

    // pausa o que não está mais perto do playhead
    for (const [id, s] of this.slots) {
      if (!used.has(id) && s.kind !== 'image') {
        const m = s.el as HTMLMediaElement;
        if (!m.paused) m.pause();
      }
    }
  }

  private drawMedia(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, c: Clip, k: number): void {
    if (!sw || !sh) return;
    const P = this.project.settings;
    const tr = c.transform;
    const crop = tr.crop;
    const cw = sw * (1 - crop.left - crop.right);
    const ch = sh * (1 - crop.top - crop.bottom);
    if (cw <= 0 || ch <= 0) return;
    // encaixa (contain) no quadro do projeto, depois aplica escala/posição/rotação
    const fit = Math.min(P.width / cw, P.height / ch);
    const w = cw * fit * tr.scale;
    const h = ch * fit * tr.scale;
    ctx.save();
    ctx.globalAlpha = tr.opacity;
    ctx.translate((P.width / 2 + tr.x) * k, (P.height / 2 + tr.y) * k);
    if (tr.rotation) ctx.rotate((tr.rotation * Math.PI) / 180);
    ctx.drawImage(src, sw * crop.left, sh * crop.top, cw, ch, (-w / 2) * k, (-h / 2) * k, w * k, h * k);
    ctx.restore();
  }

  private drawText(ctx: CanvasRenderingContext2D, c: Clip, k: number): void {
    const P = this.project.settings;
    const t = c.text!;
    ctx.save();
    ctx.globalAlpha = c.transform.opacity;
    ctx.translate((P.width / 2 + c.transform.x) * k, (P.height / 2 + c.transform.y) * k);
    ctx.font = `600 ${t.size * c.transform.scale * k}px ${t.font}, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (t.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,.7)';
      ctx.shadowBlur = 8 * k;
    }
    if (t.outlineColor && t.outlineWidth) {
      ctx.lineWidth = t.outlineWidth * 2 * k;
      ctx.strokeStyle = t.outlineColor;
      ctx.strokeText(t.text, 0, 0);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, 0, 0);
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
