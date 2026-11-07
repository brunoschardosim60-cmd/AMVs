import { displayTitle } from '@amv/music';
import { Pause, Play, SkipBack, SkipForward, Volume2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useApp, useLibraryVersion } from '../../store';
import { useEditor } from '../editor/editorStore';

interface PlayerState {
  trackId: string | null;
  queue: string[];
  playing: boolean;
  positionS: number;
  durationS: number;
  volume: number;
  /** Pedido de pulo (o elemento <audio> aplica). */
  seekTo: number | null;
  /** Repetir um trecho (ex.: uma seção). */
  loop: [number, number] | null;
  play(id: string, queue?: string[], atS?: number): void;
  toggle(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(s: number): void;
  setLoop(l: [number, number] | null): void;
  setVolume(v: number): void;
  close(): void;
  _tick(pos: number, dur: number): void;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  trackId: null,
  queue: [],
  playing: false,
  positionS: 0,
  durationS: 0,
  volume: 0.9,
  seekTo: null,
  loop: null,
  play(id, queue, atS) {
    useEditor.getState().setPlaying(false); // um áudio por vez
    set({ trackId: id, queue: queue ?? get().queue, playing: true, seekTo: atS ?? 0, positionS: atS ?? 0, loop: null });
    useApp.getState().library?.played(id);
  },
  toggle() {
    if (!get().trackId) return;
    if (!get().playing) useEditor.getState().setPlaying(false);
    set({ playing: !get().playing });
  },
  pause() {
    set({ playing: false });
  },
  next() {
    const { queue, trackId } = get();
    const i = trackId ? queue.indexOf(trackId) : -1;
    const n = queue[i + 1];
    if (n) get().play(n);
    else set({ playing: false });
  },
  prev() {
    const { queue, trackId, positionS } = get();
    if (positionS > 3) return get().seek(0);
    const i = trackId ? queue.indexOf(trackId) : -1;
    const p = queue[i - 1];
    if (p) get().play(p);
    else get().seek(0);
  },
  seek(s) {
    set({ seekTo: Math.max(0, s), positionS: Math.max(0, s) });
  },
  setLoop(l) {
    set({ loop: l });
    if (l) get().seek(l[0]);
  },
  setVolume(v) {
    set({ volume: Math.max(0, Math.min(1, v)) });
  },
  close() {
    set({ trackId: null, playing: false, loop: null });
  },
  _tick(positionS, durationS) {
    set({ positionS, durationS });
  },
}));

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Barra do player no rodapé: continua tocando ao trocar de tela. */
export function PlayerBar() {
  const { platform, library, toast } = useApp();
  useLibraryVersion(library);
  const st = usePlayer();
  const audio = useRef<HTMLAudioElement>(null);
  const track = st.trackId ? library?.track(st.trackId) : undefined;
  const editorPlaying = useEditor((s) => s.playing);

  // o preview do editor começou a tocar: pausa a música
  useEffect(() => {
    if (editorPlaying && usePlayer.getState().playing) usePlayer.getState().pause();
  }, [editorPlaying]);

  useEffect(() => {
    const a = audio.current;
    if (!a || !track || !platform) return;
    const src = platform.fileUrl(track.path);
    if (a.dataset.src !== src) {
      a.dataset.src = src;
      a.src = src;
    }
  }, [track, platform]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.volume = st.volume;
    if (st.seekTo !== null) {
      a.currentTime = st.seekTo;
      usePlayer.setState({ seekTo: null });
    }
    if (st.playing && a.paused) a.play().catch((e: Error) => {
      if (e.name === 'AbortError') return; // trocou de música no meio
      usePlayer.getState().pause();
      // formato não suportado: o onError do <audio> já avisa
      if (e.name === 'NotSupportedError') return;
      toast({ tone: 'error', title: 'Não deu para tocar a música', body: e.message });
    });
    if (!st.playing && !a.paused) a.pause();
  }, [st.playing, st.seekTo, st.volume, st.trackId, toast]);

  if (!track) return <audio ref={audio} hidden />;
  const loop = st.loop;
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-t border-line bg-panel px-3">
      <audio
        ref={audio}
        hidden
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (loop && a.currentTime >= loop[1]) a.currentTime = loop[0];
          usePlayer.getState()._tick(a.currentTime, a.duration || track.durationS);
        }}
        onEnded={() => usePlayer.getState().next()}
        onError={() => {
          usePlayer.getState().pause();
          toast({ tone: 'error', title: 'Formato não suportado pelo player', body: `${track.name} — a análise e o uso no projeto continuam funcionando.` });
        }}
      />
      <div className="flex items-center gap-0.5">
        <button type="button" aria-label="Anterior" className="rounded p-1.5 text-muted hover:text-ink" onClick={st.prev}>
          <SkipBack size={15} />
        </button>
        <button type="button" aria-label={st.playing ? 'Pausar' : 'Tocar'} className="grid size-8 place-items-center rounded-full bg-ink text-base hover:bg-white" onClick={st.toggle}>
          {st.playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>
        <button type="button" aria-label="Próxima" className="rounded p-1.5 text-muted hover:text-ink" onClick={st.next}>
          <SkipForward size={15} />
        </button>
      </div>
      <div className="w-56 min-w-0">
        <p className="truncate text-xs font-semibold">{displayTitle(track)}</p>
        <p className="truncate text-2xs text-muted">
          {track.artist ?? 'Artista desconhecido'}
          {track.summary ? ` · ${Math.round(track.summary.bpm)} BPM` : ''}
          {loop ? ` · repetindo ${mmss(loop[0])}–${mmss(loop[1])}` : ''}
        </p>
      </div>
      <span className="tnum w-10 text-right text-2xs text-muted">{mmss(st.positionS)}</span>
      <input
        type="range"
        aria-label="Posição"
        className="h-1 min-w-0 flex-1 accent-violet"
        min={0}
        max={Math.max(1, st.durationS || track.durationS)}
        step={0.1}
        value={st.positionS}
        onChange={(e) => st.seek(Number(e.target.value))}
      />
      <span className="tnum w-10 text-2xs text-muted">{mmss(st.durationS || track.durationS)}</span>
      {loop && (
        <button type="button" className="rounded border border-line px-1.5 py-0.5 text-2xs text-muted hover:text-ink" onClick={() => st.setLoop(null)}>
          sem repetir
        </button>
      )}
      <Volume2 size={14} className="text-muted" />
      <input type="range" aria-label="Volume" className="h-1 w-20 accent-violet" min={0} max={1} step={0.01} value={st.volume} onChange={(e) => st.setVolume(Number(e.target.value))} />
      <button type="button" aria-label="Fechar player" className="rounded p-1 text-muted hover:text-ink" onClick={st.close}>
        <X size={14} />
      </button>
    </div>
  );
}
