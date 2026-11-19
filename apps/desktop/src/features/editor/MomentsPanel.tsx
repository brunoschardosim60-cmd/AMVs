import { pickAudioStreamByLanguage, type Shot, type ShotTag, type SpeechSegment } from '@amv/analysis';
import { clipEndUs, insertAsset, type Asset, type Command } from '@amv/project';
import { subtitleClip, textTracks } from '@amv/subtitles';
import { Check, Languages, Loader2, Maximize2, Megaphone, MessageSquareQuote, Mic, Pause, Play, Plus, RotateCcw, Scissors, Volume2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { ProjectSession } from '../../core/session';
import { mergeSpeechSegments, transcribeMediaAsset, translateTextsAuto } from '../../core/transcription';
import { useApp, useSessionVersion } from '../../store';
import { Dialog } from '../../ui/controls';
import { useEditor } from './editorStore';
import { useStrip } from './mediaCache';
import { canPlayOriginalDirectly } from './Preview';

const TAGS: { id: ShotTag; label: string }[] = [
  { id: 'impacto', label: 'Impacto' },
  { id: 'ação', label: 'Ação' },
  { id: 'grito', label: 'Grito' },
  { id: 'fala', label: 'Fala' },
  { id: 'calma', label: 'Calma' },
  { id: 'clarão', label: 'Clarão' },
];

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Arrasto de um trecho (cena ou fala) para a timeline, preservando cliques sem arrasto. */
function useRangeDrag() {
  const setAssetDrag = useEditor((s) => s.setAssetDrag);
  const didDrag = useRef(false);
  const start = (e: RPointerEvent, asset: Asset, a: number, b: number, label: string, line: string | null) => {
    didDrag.current = false;
    if (e.button !== 0 || asset.status === 'missing') return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
      didDrag.current = true;
      window.removeEventListener('pointermove', onMove);
      setAssetDrag({ assetId: asset.id, label, x: ev.clientX, y: ev.clientY, sourceInUs: Math.round(a * 1e6), sourceOutUs: Math.round(b * 1e6), line });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', onMove), { once: true });
  };
  return { start, consumeDrag: () => { const was = didDrag.current; didDrag.current = false; return was; } };
}

function ShotThumb({ session, asset, shot }: { session: ProjectSession; asset: Asset; shot: Shot }) {
  const platform = useApp((s) => s.platform)!;
  const strip = useStrip(platform, session, asset.id);
  if (!strip) return <span className="h-9 w-16 shrink-0 rounded-[3px] bg-raised" />;
  const { plan, url } = strip;
  const W = 64;
  const H = (plan.tileHeight / plan.tileWidth) * W;
  const idx = Math.min(plan.count - 1, Math.floor((shot.startS + shot.endS) / 2 / plan.intervalS));
  return (
    <span
      className="block h-9 w-16 shrink-0 overflow-hidden rounded-[3px] bg-black"
      style={{
        backgroundImage: `url("${url}")`,
        backgroundSize: `${plan.cols * W}px ${plan.rows * H}px`,
        backgroundPosition: `-${(idx % plan.cols) * W}px -${Math.floor(idx / plan.cols) * H}px`,
      }}
    />
  );
}

/** Player de prévia com vídeo e som para assistir/ouvir um trecho antes de usar na timeline. */
export function ClipRangePreview({
  session,
  asset,
  startS,
  endS,
  title,
  subtitleText,
  autoPlay = false,
  onAdjustRange,
  onAdd,
  addLabel = 'Adicionar na timeline',
  onClose,
}: {
  session: ProjectSession;
  asset: Asset;
  startS: number;
  endS: number;
  title?: string;
  subtitleText?: string | null;
  autoPlay?: boolean;
  onAdjustRange?: (next: { inS: number; outS: number }) => void;
  onAdd?: () => void;
  addLabel?: string;
  onClose?: () => void;
}) {
  const platform = useApp((s) => s.platform)!;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [currentS, setCurrentS] = useState(startS);
  const proxyPath = session.assetRuntime(asset.id).artifacts?.proxyPath;
  const mediaPath = asset.status === 'missing'
    ? null
    : canPlayOriginalDirectly(asset)
      ? asset.path
      : (proxyPath ?? asset.path);
  const mediaUrl = mediaPath ? platform.fileUrl(mediaPath) : null;
  const assetMaxS = asset.probe?.durationUs ? asset.probe.durationUs / 1_000_000 : Math.max(endS + 30, 3600);
  const tailPadS = endS - startS < 2.2 ? 0.35 : 0.1;
  const playEndS = Math.min(assetMaxS, endS + tailPadS);

  useEffect(() => {
    setCurrentS(startS);
    const video = videoRef.current;
    if (!video || !mediaUrl) return;
    const seekAndPlay = () => {
      video.currentTime = startS;
      if (autoPlay && !expanded) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };
    if (video.readyState >= 1) {
      seekAndPlay();
    }
  }, [asset.id, startS, endS, mediaUrl, autoPlay, expanded]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (!continuous && (video.currentTime < startS - 0.15 || video.currentTime >= playEndS - 0.05)) {
      video.currentTime = startS;
    }
    void video.play().catch(() => undefined);
  };

  const replay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = startS;
    setCurrentS(startS);
    void video.play().catch(() => undefined);
  };

  const sliderMin = continuous ? 0 : startS;
  const sliderMax = continuous ? assetMaxS : Math.max(startS + 0.1, playEndS);
  const clampedCurrent = Math.max(sliderMin, Math.min(sliderMax, currentS));

  if (!mediaUrl) {
    return (
      <div className="grid aspect-video place-items-center rounded-md bg-base px-2 text-center text-2xs text-muted">
        Arquivo ausente; relocalize a mídia para assistir à prévia.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1.5 rounded-md border border-line-soft bg-base p-1.5">
        {(title || onClose) && (
          <div className="flex items-center gap-1">
            <Volume2 size={12} className="shrink-0 text-violet-strong" />
            <span className="min-w-0 flex-1 truncate text-2xs font-medium text-ink-soft">{title ?? asset.name}</span>
            <span className="tnum shrink-0 text-[10px] font-medium text-muted">
              {fmt(startS)}–{fmt(endS)} ({(endS - startS).toFixed(1)}s)
            </span>
            <button
              type="button"
              onClick={() => {
                videoRef.current?.pause();
                setExpanded(true);
              }}
              title="Ampliar prévia em tela grande"
              aria-label="Ampliar prévia"
              className="rounded p-0.5 text-muted hover:bg-raised hover:text-ink"
            >
              <Maximize2 size={12} />
            </button>
            {onClose && (
              <button type="button" onClick={onClose} title="Fechar prévia" className="rounded p-0.5 text-muted hover:bg-raised hover:text-ink">
                <X size={12} />
              </button>
            )}
          </div>
        )}
        <div className="relative overflow-hidden rounded bg-black">
          <video
            ref={videoRef}
            key={mediaUrl}
            src={mediaUrl}
            muted={false}
            playsInline
            preload="metadata"
            onClick={togglePlay}
            className="aspect-video w-full cursor-pointer bg-black object-contain"
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = startS;
              if (autoPlay && !expanded) void e.currentTarget.play().catch(() => undefined);
            }}
            onPlay={(e) => {
              setPlaying(true);
              if (!continuous && (e.currentTarget.currentTime < startS - 0.15 || e.currentTarget.currentTime >= playEndS - 0.05)) {
                e.currentTarget.currentTime = startS;
              }
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime;
              setCurrentS(t);
              if (!continuous && t >= playEndS) {
                e.currentTarget.pause();
              }
            }}
          />
          {subtitleText && (
            <div className="pointer-events-none absolute inset-x-2 bottom-2 flex justify-center">
              <span className="rounded bg-black/80 px-2 py-0.5 text-center text-[11px] font-semibold leading-snug text-white shadow">
                {subtitleText}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 px-0.5">
          <span className="tnum shrink-0 text-[10px] text-faint">{fmt(clampedCurrent)}</span>
          <input
            type="range"
            aria-label="Posição da prévia"
            className="h-1 min-w-0 flex-1 accent-violet"
            min={sliderMin}
            max={sliderMax}
            step={0.05}
            value={clampedCurrent}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCurrentS(v);
              if (videoRef.current) videoRef.current.currentTime = v;
            }}
          />
          <span className="tnum shrink-0 text-[10px] text-faint">{fmt(sliderMax)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex h-6 items-center gap-1 rounded border border-line bg-panel px-2 text-2xs text-ink-soft hover:bg-raised hover:text-ink"
          >
            {playing ? <Pause size={11} /> : <Play size={11} />}
            {playing ? 'Pausar' : 'Tocar'}
          </button>
          <button
            type="button"
            onClick={replay}
            title="Repetir do início do trecho"
            className="inline-flex h-6 items-center gap-1 rounded border border-line bg-panel px-1.5 text-2xs text-ink-soft hover:bg-raised hover:text-ink"
          >
            <RotateCcw size={11} />
          </button>
          <button
            type="button"
            aria-pressed={continuous}
            onClick={() => setContinuous((v) => !v)}
            title={continuous ? 'Tocando continuamente além do corte' : 'Pausa ao fim do trecho (clique para assistir contínuo)'}
            className={`inline-flex h-6 items-center rounded border px-1.5 text-[10px] ${continuous ? 'border-violet bg-violet/15 text-ink' : 'border-line bg-panel text-muted hover:text-ink'}`}
          >
            {continuous ? 'Contínuo' : 'Só trecho'}
          </button>
          {onAdjustRange && (
            <>
              <button
                type="button"
                title="Expandir 0,5 s antes"
                onClick={() => onAdjustRange({ inS: Math.max(0, Math.round((startS - 0.5) * 10) / 10), outS: endS })}
                className="inline-flex h-6 items-center rounded border border-line bg-panel px-1.5 text-[10px] text-muted hover:bg-raised hover:text-ink"
              >
                -0.5s
              </button>
              <button
                type="button"
                title="Expandir 1 s depois"
                onClick={() => onAdjustRange({ inS: startS, outS: Math.min(assetMaxS, Math.round((endS + 1) * 10) / 10) })}
                className="inline-flex h-6 items-center rounded border border-line bg-panel px-1.5 text-[10px] text-muted hover:bg-raised hover:text-ink"
              >
                +1s
              </button>
            </>
          )}
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="ml-auto inline-flex h-6 items-center gap-1 rounded bg-violet px-2 text-2xs font-medium text-white hover:bg-violet-strong"
            >
              <Plus size={11} />
              {addLabel}
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <Dialog title={title ?? asset.name} width="w-[820px]" onClose={() => setExpanded(false)}>
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-md bg-black">
              <video
                src={mediaUrl}
                controls
                autoPlay
                playsInline
                preload="metadata"
                className="aspect-video w-full bg-black object-contain"
                onLoadedMetadata={(e) => {
                  e.currentTarget.currentTime = startS;
                }}
              />
              {subtitleText && (
                <div className="pointer-events-none absolute inset-x-4 bottom-12 flex justify-center">
                  <span className="rounded bg-black/80 px-3 py-1 text-center text-sm font-semibold text-white shadow">
                    {subtitleText}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span className="tnum">Trecho: {fmt(startS)}–{fmt(endS)} ({(endS - startS).toFixed(1)}s)</span>
              {onAdjustRange && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onAdjustRange({ inS: Math.max(0, Math.round((startS - 0.5) * 10) / 10), outS: endS })}
                    className="rounded border border-line bg-panel px-2 py-1 text-xs text-ink-soft hover:bg-raised"
                  >
                    Início -0.5s
                  </button>
                  <button
                    type="button"
                    onClick={() => onAdjustRange({ inS: startS, outS: Math.min(assetMaxS, Math.round((endS + 1) * 10) / 10) })}
                    className="rounded border border-line bg-panel px-2 py-1 text-xs text-ink-soft hover:bg-raised"
                  >
                    Fim +1s
                  </button>
                </div>
              )}
              {onAdd && (
                <button
                  type="button"
                  onClick={() => {
                    onAdd();
                    setExpanded(false);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded bg-violet px-3 text-xs font-medium text-white hover:bg-violet-strong"
                >
                  <Plus size={13} />
                  {addLabel}
                </button>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function ScenesPanel({ session }: { session: ProjectSession }) {
  useSessionVersion(session);
  const [tag, setTag] = useState<ShotTag | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ asset: Asset; shot: Shot; id: string } | null>(null);
  const [autoPlayPreview, setAutoPlayPreview] = useState(false);
  const [ranges, setRanges] = useState<Record<string, { inS: number; outS: number }>>({});
  const drag = useRangeDrag();
  const toast = useApp((s) => s.toast);
  const select = useEditor((s) => s.select);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const assets = session.project.assets.filter((a) => a.kind === 'video');
  const pending = assets.filter((a) => ['pending', 'running'].includes(session.assetRuntime(a.id).analysis ?? 'pending'));
  const shots = useMemo(() => {
    const all: { asset: Asset; shot: Shot }[] = [];
    for (const a of assets) for (const shot of session.assetRuntime(a.id).episode?.shots ?? []) all.push({ asset: a, shot });
    return all.filter((x) => (!tag || x.shot.tags.includes(tag)) && x.shot.endS - x.shot.startS >= 0.4).sort((x, y) => y.shot.intensity - x.shot.intensity).slice(0, 300);
  }, [assets, session, session.changes, tag]);
  const sceneId = (asset: Asset, shot: Shot) => `${asset.id}:${shot.startS}`;
  const selected = selectedIds.flatMap((id) => {
    const item = shots.find(({ asset, shot }) => sceneId(asset, shot) === id);
    return item ? [{ ...item, id, range: ranges[id] ?? { inS: item.shot.startS, outS: item.shot.endS } }] : [];
  });
  const active = selected.find((item) => item.id === activeId) ?? selected[0];
  const singlePreview = !selected.length && previewTarget
    ? { ...previewTarget, range: ranges[previewTarget.id] ?? { inS: previewTarget.shot.startS, outS: previewTarget.shot.endS } }
    : null;
  const inspectorItem = active ?? singlePreview;
  const canAdd = selected.length > 0 && selected.length === selectedIds.length && selected.every(({ asset, range }) => asset.status !== 'missing' && range.outS - range.inS >= 0.4);

  const openPreview = (asset: Asset, shot: Shot) => {
    const id = sceneId(asset, shot);
    setActiveId(id);
    setPreviewTarget({ asset, shot, id });
    setAutoPlayPreview(true);
    setRanges((current) => current[id] ? current : { ...current, [id]: { inS: shot.startS, outS: shot.endS } });
  };

  const toggleScene = (asset: Asset, shot: Shot) => {
    const id = sceneId(asset, shot);
    setActiveId(id);
    setPreviewTarget({ asset, shot, id });
    setAutoPlayPreview(false);
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
    setRanges((current) => current[id] ? current : { ...current, [id]: { inS: shot.startS, outS: shot.endS } });
  };

  const appendScenes = (items: { asset: Asset; range: { inS: number; outS: number } }[]) => {
    const track = session.project.tracks.find((item) => item.kind === 'video' && !item.locked);
    if (!track) {
      toast({ tone: 'warn', title: 'Não há trilha de vídeo disponível', body: 'Destrave uma trilha de vídeo para montar as cenas.' });
      return;
    }
    try {
      const firstStartUs = session.project.clips.filter((clip) => clip.trackId === track.id).reduce((endUs, clip) => Math.max(endUs, clipEndUs(clip)), 0);
      let startUs = firstStartUs;
      const commands = items.flatMap(({ asset, range }) => {
        const sourceInUs = Math.round(range.inS * 1_000_000);
        const sourceOutUs = Math.round(range.outS * 1_000_000);
        const batch = insertAsset(session.project, { assetId: asset.id, trackId: track.id, startUs, sourceInUs, sourceOutUs });
        startUs += sourceOutUs - sourceInUs;
        return batch;
      });
      const addedIds = commands.flatMap((command) => command.type === 'clip.add' ? [command.clip.id] : []);
      session.history.transaction(items.length === 1 ? 'Adicionar cena na timeline' : `Juntar ${items.length} cenas`, commands);
      select(addedIds);
      setPlayhead(firstStartUs);
      toast({
        tone: 'ok',
        title: items.length === 1 ? 'Cena adicionada à timeline' : `${items.length} cenas adicionadas em sequência`,
        body: 'Cada cena continua como um clipe editável. Use Ctrl+Z para desfazer.',
      });
      if (items.length > 1) {
        setSelectedIds([]);
        setActiveId(null);
      }
    } catch (error) {
      toast({ tone: 'warn', title: 'Não foi possível montar as cenas', body: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {TAGS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTag(tag === t.id ? null : t.id);
              setSelectedIds([]);
              setActiveId(null);
            }}
            className={`rounded-full border px-2 py-0.5 text-2xs ${tag === t.id ? 'border-violet bg-violet/15 text-ink' : 'border-line text-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {pending.length > 0 && (
        <p className="flex items-center gap-2 px-3 pb-2 text-2xs text-muted">
          <Loader2 size={12} className="animate-spin" /> Analisando {pending.length} episódio(s)…
        </p>
      )}
      {assets.length === 0 && <p className="px-3 text-xs leading-relaxed text-muted">Importe episódios: as melhores cenas de todos eles aparecem aqui, das mais intensas para as mais calmas.</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {shots.map(({ asset, shot }) => {
          const id = sceneId(asset, shot);
          const isPreviewing = inspectorItem?.id === id;
          return (
            <li key={id}>
              <div
                role="button"
                tabIndex={0}
                onPointerDown={(e) => drag.start(e, asset, shot.startS, shot.endS, `${asset.name} ${fmt(shot.startS)}`, shot.line)}
                onClick={() => { if (!drag.consumeDrag()) openPreview(asset, shot); }}
                onKeyDown={(e) => e.key === 'Enter' && openPreview(asset, shot)}
                title={`${asset.name} · ${fmt(shot.startS)}–${fmt(shot.endS)}${shot.line ? `\n"${shot.line}"` : ''}\nClique para assistir com áudio ou arraste para a timeline`}
                className={`flex cursor-grab items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-raised active:cursor-grabbing ${selectedIds.includes(id) || isPreviewing ? 'bg-violet/10' : ''}`}
              >
                <input
                  type="checkbox"
                  aria-label={`Selecionar cena de ${asset.name} em ${fmt(shot.startS)}`}
                  checked={selectedIds.includes(id)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleScene(asset, shot)}
                  className="shrink-0 accent-violet"
                />
                <ShotThumb session={session} asset={asset} shot={shot} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-base">
                      <span className="block h-full rounded-full bg-violet" style={{ width: `${shot.intensity * 100}%` }} />
                    </span>
                    <span className="tnum shrink-0 text-2xs font-semibold text-ink">
                      {fmt(shot.startS)} · {(shot.endS - shot.startS).toFixed(1)}s
                    </span>
                    <span className="truncate text-[10px] text-muted">{shot.tags.join(' · ') || 'cena'}</span>
                  </span>
                  <span className="block truncate text-[10px] text-faint">
                    {asset.name}
                  </span>
                  {shot.line && <span className="line-clamp-2 text-2xs text-muted italic">“{shot.line.replace(/\n/g, ' ')}”</span>}
                </span>
                <button
                  type="button"
                  aria-label={`Assistir prévia da cena de ${asset.name} em ${fmt(shot.startS)}`}
                  title="Assistir e ouvir prévia desta cena"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    openPreview(asset, shot);
                  }}
                  className={`grid size-6 shrink-0 place-items-center rounded border text-muted hover:border-violet hover:text-ink ${isPreviewing ? 'border-violet bg-violet/15 text-ink' : 'border-transparent bg-base/70'}`}
                >
                  <Play size={11} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {inspectorItem && (
        <div className="shrink-0 border-t border-line px-2 py-2 space-y-2">
          {selected.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-2xs font-medium text-ink">{selected.length} selecionada(s)</span>
              <button type="button" onClick={() => { setSelectedIds([]); setActiveId(null); }} className="inline-flex items-center gap-1 text-2xs text-muted hover:text-ink">
                <X size={12} /> Limpar
              </button>
            </div>
          )}
          <ClipRangePreview
            session={session}
            asset={inspectorItem.asset}
            startS={inspectorItem.range.inS}
            endS={inspectorItem.range.outS}
            title={inspectorItem.asset.name}
            subtitleText={inspectorItem.shot.line}
            autoPlay={autoPlayPreview}
            onAdjustRange={(next) => setRanges((current) => ({ ...current, [inspectorItem.id]: next }))}
            onAdd={selected.length === 0 ? () => appendScenes([{ asset: inspectorItem.asset, range: inspectorItem.range }]) : undefined}
            addLabel="Na timeline"
            onClose={selected.length === 0 ? () => setPreviewTarget(null) : undefined}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-2xs text-muted">
              Início (s)
              <input
                type="number"
                aria-label="Início do trecho em segundos"
                className="mt-0.5 h-7 w-full rounded border border-line bg-panel px-1.5 text-xs text-ink"
                min={0}
                max={inspectorItem.range.outS - 0.3}
                step="0.1"
                value={inspectorItem.range.inS}
                onChange={(e) => {
                  if (e.target.value === '') return;
                  const value = Number(e.target.value);
                  if (!Number.isFinite(value)) return;
                  setRanges((current) => ({ ...current, [inspectorItem.id]: { ...inspectorItem.range, inS: Math.max(0, Math.min(value, inspectorItem.range.outS - 0.3)) } }));
                }}
              />
            </label>
            <label className="text-2xs text-muted">
              Fim (s)
              <input
                type="number"
                aria-label="Fim do trecho em segundos"
                className="mt-0.5 h-7 w-full rounded border border-line bg-panel px-1.5 text-xs text-ink"
                min={inspectorItem.range.inS + 0.3}
                max={inspectorItem.asset.probe?.durationUs ? inspectorItem.asset.probe.durationUs / 1_000_000 : 3600}
                step="0.1"
                value={inspectorItem.range.outS}
                onChange={(e) => {
                  if (e.target.value === '') return;
                  const value = Number(e.target.value);
                  if (!Number.isFinite(value)) return;
                  const maxDur = inspectorItem.asset.probe?.durationUs ? inspectorItem.asset.probe.durationUs / 1_000_000 : 3600;
                  setRanges((current) => ({ ...current, [inspectorItem.id]: { ...inspectorItem.range, outS: Math.min(maxDur, Math.max(value, inspectorItem.range.inS + 0.3)) } }));
                }}
              />
            </label>
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => appendScenes(selected)}
              disabled={!canAdd}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-control bg-violet px-2 text-xs font-medium text-white hover:bg-violet-strong disabled:cursor-not-allowed disabled:opacity-50"
              title="Acrescenta os trechos em sequência no fim da trilha de vídeo; cada um permanece editável"
            >
              <Scissors size={13} /> <Check size={13} /> Juntar e adicionar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function LinesPanel({ session }: { session: ProjectSession }) {
  useSessionVersion(session);
  const platform = useApp((s) => s.platform);
  const toast = useApp((s) => s.toast);
  const select = useEditor((s) => s.select);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const drag = useRangeDrag();
  const [onlyImpact, setOnlyImpact] = useState(false);
  const [activeSpeechKey, setActiveSpeechKey] = useState<string | null>(null);
  const [autoPlaySpeech, setAutoPlaySpeech] = useState(false);
  const [speechRanges, setSpeechRanges] = useState<Record<string, { inS: number; outS: number }>>({});
  const assets = session.project.assets.filter((a) => a.kind === 'video');
  const [speechAssetId, setSpeechAssetId] = useState(assets[0]?.id ?? '');
  const [progress, setProgress] = useState<{ label: string; fraction: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const targetAssetId = assets.some((a) => a.id === speechAssetId) ? speechAssetId : (assets[0]?.id ?? '');

  const lines = useMemo(() => {
    const coalesced: { asset: Asset; s: SpeechSegment }[] = [];
    for (const a of assets) {
      const ordered = [...(session.assetRuntime(a.id).episode?.speech ?? [])].sort((x, y) => x.startS - y.startS);
      for (const seg of ordered) {
        const prev = coalesced.at(-1);
        if (
          prev
          && prev.asset.id === a.id
          && seg.startS - prev.s.endS <= 0.85
          && seg.endS - prev.s.startS <= 4.5
          && (prev.s.endS - prev.s.startS < 1.8 || !prev.s.text?.trim() || !seg.text?.trim())
        ) {
          const mergedText = [prev.s.text?.trim(), seg.text?.trim()].filter(Boolean).join(' ').trim();
          prev.s = {
            ...prev.s,
            endS: Math.max(prev.s.endS, seg.endS),
            kind: prev.s.kind === 'grito' || seg.kind === 'grito' ? 'grito' : prev.s.kind,
            impact: Math.max(prev.s.impact, seg.impact),
            confidence: Math.max(prev.s.confidence, seg.confidence),
            ...(mergedText ? { text: mergedText } : {}),
            language: prev.s.language ?? seg.language ?? null,
          };
        } else {
          coalesced.push({ asset: a, s: { ...seg } });
        }
      }
    }
    const list = onlyImpact ? coalesced.filter((x) => x.s.impact >= 0.55 || x.s.kind === 'grito') : coalesced;
    return list.sort((x, y) => (onlyImpact ? y.s.impact - x.s.impact : 0)).slice(0, 400);
  }, [assets, session, session.changes, onlyImpact]);

  const activeItem = activeSpeechKey
    ? lines.find(({ asset, s }) => `${asset.id}-${s.startS}` === activeSpeechKey) ?? null
    : null;
  const activeSpeechRange = activeItem && activeSpeechKey
    ? (speechRanges[activeSpeechKey] ?? { inS: Math.max(0, activeItem.s.startS - 0.2), outS: activeItem.s.endS + 0.4 })
    : null;

  const missingOrForeign = lines.some(({ s }) => !s.text?.trim() || (s.language && !s.language.toLowerCase().startsWith('pt')));

  const transcribeAndTranslateAll = async () => {
    if (!platform || progress) return;
    const asset = assets.find((item) => item.id === targetAssetId);
    if (!asset) return;
    const streams = asset.probe?.audio ?? [];
    const audioIndex = pickAudioStreamByLanguage(streams, 'original') ?? streams[0]?.index;
    if (audioIndex === undefined) {
      toast({ tone: 'error', title: 'O episódio não tem faixa de áudio', body: 'Não foi possível extrair áudio para transcrição.' });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const ep = session.assetRuntime(asset.id).episode;
      const fallbackLang = streams.find((s) => s.index === audioIndex)?.language ?? null;
      setProgress({ label: 'Transcrevendo falas do episódio…', fraction: 0.15 });
      const transcript = await transcribeMediaAsset(platform, asset, audioIndex, {
        model: 'small',
        vadFilter: true,
        signal: controller.signal,
        onProgress: ({ stage, progress: p, duration }) => {
          const frac = duration > 0 ? Math.min(0.7, (p / duration) * 0.7) : 0.35;
          setProgress({
            label: stage === 'extracting' ? 'Extraindo áudio…' : stage === 'preparing' ? 'Carregando modelo Whisper…' : 'Transcrevendo falas…',
            fraction: Math.max(0.08, frac),
          });
        },
      });
      const merged = mergeSpeechSegments(ep?.speech ?? [], transcript, fallbackLang);
      const needsTranslation = merged
        .map((seg, index) => ({ seg, index }))
        .filter(({ seg }) => !!seg.text?.trim() && !(seg.language ?? '').toLowerCase().startsWith('pt'));
      let updatedSpeech = merged;
      let translatedCount = 0;
      if (needsTranslation.length) {
        setProgress({ label: `Traduzindo ${needsTranslation.length} fala(s) para PT-BR…`, fraction: 0.75 });
        const tr = await translateTextsAuto(
          platform,
          needsTranslation.map(({ seg }) => seg.text!),
          'português brasileiro',
          {
            sourceLanguage: transcript.language,
            signal: controller.signal,
            onProgress: (done, total) => setProgress({
              label: `Traduzindo falas (${done}/${total})…`,
              fraction: 0.75 + 0.23 * (done / Math.max(1, total)),
            }),
          },
        );
        const byIndex = new Map<number, string>();
        tr.translations.forEach((value, idx) => {
          if (value?.trim()) {
            byIndex.set(needsTranslation[idx]!.index, value.trim());
            translatedCount++;
          }
        });
        updatedSpeech = merged.map((seg, idx) =>
          byIndex.has(idx) ? { ...seg, text: byIndex.get(idx)!, language: 'pt-BR' } : seg,
        );
      }
      await session.updateEpisodeSpeech(asset.id, updatedSpeech);
      toast({
        tone: 'ok',
        title: `${updatedSpeech.filter((s) => !!s.text?.trim()).length} falas atualizadas`,
        body: translatedCount
          ? `${translatedCount} fala(s) transcritas e traduzidas para Português (Brasil).`
          : 'Transcrição concluída e salva no episódio.',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        toast({ tone: 'info', title: 'Transcrição cancelada' });
      } else {
        toast({ tone: 'error', title: 'Não foi possível transcrever/traduzir falas', body: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  const addSpeechToTimeline = (asset: Asset, s: SpeechSegment, customRange?: { inS: number; outS: number }) => {
    const voiceTrack = session.project.tracks.find((t) => t.kind === 'audio' && t.role === 'voice' && !t.locked)
      ?? session.project.tracks.find((t) => t.kind === 'audio' && !t.locked);
    if (!voiceTrack) {
      toast({ tone: 'warn', title: 'Sem trilha de áudio disponível', body: 'Destrave a trilha Vozes para adicionar a fala.' });
      return;
    }
    try {
      const startUs = session.project.clips
        .filter((clip) => clip.trackId === voiceTrack.id)
        .reduce((endUs, clip) => Math.max(endUs, clipEndUs(clip)), 0);
      const sourceInS = customRange ? customRange.inS : Math.max(0, s.startS - 0.1);
      const sourceOutS = customRange ? customRange.outS : s.endS + 0.15;
      const sourceInUs = Math.round(sourceInS * 1_000_000);
      const sourceOutUs = Math.round(sourceOutS * 1_000_000);
      const cmds: Command[] = insertAsset(session.project, {
        assetId: asset.id,
        trackId: voiceTrack.id,
        startUs,
        sourceInUs,
        sourceOutUs,
      });
      const addedClipIds = cmds.flatMap((c) => (c.type === 'clip.add' ? [c.clip.id] : []));
      const subTrack = textTracks(session.project).find((t) => !t.locked);
      if (subTrack && s.text?.trim()) {
        const sub = subtitleClip(
          session.project,
          subTrack.id,
          startUs,
          sourceOutUs - sourceInUs,
          s.text.trim(),
          'anime-dialogue',
          'Fala do episódio',
        );
        cmds.push({ type: 'clip.add', clip: sub });
        addedClipIds.push(sub.id);
      }
      session.history.transaction('Adicionar fala à timeline', cmds);
      select(addedClipIds);
      setPlayhead(startUs);
      toast({ tone: 'ok', title: 'Fala adicionada à timeline', body: subTrack && s.text?.trim() ? 'Áudio na trilha Vozes e legenda sincronizada.' : 'Áudio inserido na trilha Vozes.' });
    } catch (error) {
      toast({ tone: 'warn', title: 'Não foi possível adicionar a fala', body: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {assets.length > 0 && (missingOrForeign || lines.length === 0 || progress) && (
        <div className="mx-2 mb-2 space-y-1.5 rounded-control border border-violet/30 bg-violet/5 p-2">
          {assets.length > 1 && (
            <select
              className="h-7 w-full rounded-control border border-line bg-base px-1.5 text-2xs text-ink"
              value={targetAssetId}
              onChange={(e) => setSpeechAssetId(e.target.value)}
              disabled={!!progress}
              aria-label="Episódio para transcrever falas"
            >
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1">
            {progress ? (
              <>
                <Loader2 size={12} className="shrink-0 animate-spin text-violet-strong" />
                <span className="min-w-0 flex-1 truncate text-2xs text-ink-soft">{progress.label}</span>
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted hover:text-ink"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void transcribeAndTranslateAll()}
                className="flex h-7 w-full items-center justify-center gap-1.5 rounded-control bg-violet/90 px-2 text-2xs font-medium text-white hover:bg-violet"
              >
                <Mic size={12} />
                <Languages size={12} />
                Transcrever e traduzir falas (PT-BR)
              </button>
            )}
          </div>
          {progress && (
            <progress className="h-1 w-full accent-violet" max={1} value={progress.fraction} />
          )}
        </div>
      )}
      <label className="flex items-center gap-2 px-3 pb-2 text-2xs text-muted">
        <input type="checkbox" className="accent-violet" checked={onlyImpact} onChange={(e) => setOnlyImpact(e.target.checked)} />
        Só frases marcantes e gritos
      </label>
      {assets.length > 0 && lines.length === 0 && (
        <p className="px-3 text-xs text-muted">
          Nenhuma fala encontrada ainda. Use o botão acima para transcrever e traduzir o áudio do episódio para PT-BR.
        </p>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {lines.map(({ asset, s }) => {
          const key = `${asset.id}-${s.startS}`;
          const isActive = activeSpeechKey === key;
          return (
            <li key={key}>
              <div
                role="button"
                tabIndex={0}
                onPointerDown={(e) => drag.start(e, asset, Math.max(0, s.startS - 0.1), s.endS + 0.15, s.text ? `"${s.text.slice(0, 30)}"` : `${s.kind} ${fmt(s.startS)}`, s.text)}
                onClick={() => {
                  if (!drag.consumeDrag()) {
                    setActiveSpeechKey(key);
                    setAutoPlaySpeech(true);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setActiveSpeechKey(key);
                    setAutoPlaySpeech(true);
                  }
                }}
                title={`${asset.name} · ${fmt(s.startS)} — clique para assistir e ouvir ou arraste para a trilha Vozes`}
                className={`flex cursor-grab items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-raised active:cursor-grabbing ${isActive ? 'bg-violet/10' : ''}`}
              >
                {s.kind === 'grito' ? <Megaphone size={14} className="mt-0.5 shrink-0 text-warn" /> : <MessageSquareQuote size={14} className="mt-0.5 shrink-0 text-azure" />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[10px] text-muted">
                    <span className="tnum shrink-0 font-semibold text-ink">
                      {fmt(s.startS)} · {(s.endS - s.startS).toFixed(1)}s{s.impact >= 0.55 ? ' · marcante' : ''}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-faint">{asset.name}</span>
                  </span>
                  <span className="line-clamp-3 text-xs text-ink-soft">
                    {s.text ? s.text.replace(/\n/g, ' ') : s.kind === 'grito' ? 'Grito' : 'Fala (clique em Transcrever acima para gerar legenda PT-BR)'}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Ouvir fala de ${asset.name} em ${fmt(s.startS)}`}
                  title="Assistir e ouvir esta fala"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSpeechKey(key);
                    setAutoPlaySpeech(true);
                  }}
                  className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded border text-muted hover:border-violet hover:text-ink ${isActive ? 'border-violet bg-violet/15 text-ink' : 'border-transparent bg-base/70'}`}
                >
                  <Play size={11} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {activeItem && activeSpeechRange && activeSpeechKey && (
        <div className="shrink-0 border-t border-line px-2 py-2">
          <ClipRangePreview
            session={session}
            asset={activeItem.asset}
            startS={activeSpeechRange.inS}
            endS={activeSpeechRange.outS}
            title={activeItem.asset.name}
            subtitleText={activeItem.s.text}
            autoPlay={autoPlaySpeech}
            onAdjustRange={(next) => setSpeechRanges((current) => ({ ...current, [activeSpeechKey]: next }))}
            onAdd={() => addSpeechToTimeline(activeItem.asset, activeItem.s, activeSpeechRange)}
            addLabel="Na timeline"
            onClose={() => setActiveSpeechKey(null)}
          />
        </div>
      )}
    </div>
  );
}
