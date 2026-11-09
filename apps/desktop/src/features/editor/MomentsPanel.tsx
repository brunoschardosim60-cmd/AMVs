import type { Shot, ShotTag, SpeechSegment } from '@amv/analysis';
import { clipEndUs, insertAsset, type Asset } from '@amv/project';
import { Check, Loader2, Megaphone, MessageSquareQuote, Scissors, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { useEditor } from './editorStore';
import { useStrip } from './mediaCache';

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

/** Arrasto de um trecho (cena ou fala) para a timeline. */
function useRangeDrag() {
  const setAssetDrag = useEditor((s) => s.setAssetDrag);
  return (e: RPointerEvent, asset: Asset, a: number, b: number, label: string, line: string | null) => {
    if (e.button !== 0 || asset.status === 'missing') return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
      window.removeEventListener('pointermove', onMove);
      setAssetDrag({ assetId: asset.id, label, x: ev.clientX, y: ev.clientY, sourceInUs: Math.round(a * 1e6), sourceOutUs: Math.round(b * 1e6), line });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', onMove), { once: true });
  };
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

function SceneReview({ session, asset, startS, endS }: { session: ProjectSession; asset: Asset; startS: number; endS: number }) {
  const platform = useApp((s) => s.platform)!;
  const videoRef = useRef<HTMLVideoElement>(null);
  const proxyPath = session.assetRuntime(asset.id).artifacts?.proxyPath;

  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState >= 1) {
      video.pause();
      video.currentTime = startS;
    }
  }, [startS, proxyPath]);

  if (!proxyPath) {
    return <div className="grid aspect-video place-items-center rounded-md bg-base px-2 text-center text-2xs text-muted">Preparando prévia da cena…</div>;
  }
  return (
    <video
      ref={videoRef}
      key={proxyPath}
      src={platform.fileUrl(proxyPath)}
      muted
      playsInline
      controls
      preload="metadata"
      className="aspect-video w-full rounded-md bg-black object-contain"
      onLoadedMetadata={(e) => { e.currentTarget.currentTime = startS; }}
      onTimeUpdate={(e) => {
        if (e.currentTarget.currentTime >= endS) e.currentTarget.pause();
      }}
    />
  );
}

export function ScenesPanel({ session }: { session: ProjectSession }) {
  const [tag, setTag] = useState<ShotTag | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ranges, setRanges] = useState<Record<string, { inS: number; outS: number }>>({});
  const drag = useRangeDrag();
  const toast = useApp((s) => s.toast);
  const select = useEditor((s) => s.select);
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
  const canAdd = selected.length > 0 && selected.length === selectedIds.length && selected.every(({ asset, range }) => asset.status !== 'missing' && range.outS - range.inS >= 0.4);

  const toggleScene = (asset: Asset, shot: Shot) => {
    const id = sceneId(asset, shot);
    setActiveId(id);
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
    setRanges((current) => current[id] ? current : { ...current, [id]: { inS: shot.startS, outS: shot.endS } });
  };

  const addSelected = () => {
    const track = session.project.tracks.find((item) => item.kind === 'video' && !item.locked);
    if (!track) {
      toast({ tone: 'warn', title: 'Não há trilha de vídeo disponível', body: 'Destrave uma trilha de vídeo para montar as cenas.' });
      return;
    }
    try {
      let startUs = session.project.clips.filter((clip) => clip.trackId === track.id).reduce((endUs, clip) => Math.max(endUs, clipEndUs(clip)), 0);
      const commands = selected.flatMap(({ asset, range }) => {
        const sourceInUs = Math.round(range.inS * 1_000_000);
        const sourceOutUs = Math.round(range.outS * 1_000_000);
        const batch = insertAsset(session.project, { assetId: asset.id, trackId: track.id, startUs, sourceInUs, sourceOutUs });
        startUs += sourceOutUs - sourceInUs;
        return batch;
      });
      const addedIds = commands.flatMap((command) => command.type === 'clip.add' ? [command.clip.id] : []);
      session.history.transaction(`Juntar ${selected.length} cenas`, commands);
      select(addedIds);
      toast({ tone: 'ok', title: `${selected.length} cenas adicionadas em sequência`, body: 'Cada cena continua como um clipe editável. Use Ctrl+Z para desfazer o conjunto.' });
      setSelectedIds([]);
      setActiveId(null);
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
        {shots.map(({ asset, shot }) => (
          <li key={sceneId(asset, shot)}>
            <div
              role="button"
              tabIndex={0}
              onPointerDown={(e) => drag(e, asset, shot.startS, shot.endS, `${asset.name} ${fmt(shot.startS)}`, shot.line)}
              onKeyDown={(e) => e.key === 'Enter' && toggleScene(asset, shot)}
              title={`${asset.name} · ${fmt(shot.startS)}–${fmt(shot.endS)}${shot.line ? `\n"${shot.line}"` : ''}\nArraste para a timeline ou marque para montar em sequência`}
              className={`flex cursor-grab items-center gap-2 rounded-md px-1.5 py-1 hover:bg-raised active:cursor-grabbing ${selectedIds.includes(sceneId(asset, shot)) ? 'bg-violet/10' : ''}`}
            >
              <input
                type="checkbox"
                aria-label={`Selecionar cena de ${asset.name} em ${fmt(shot.startS)}`}
                checked={selectedIds.includes(sceneId(asset, shot))}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleScene(asset, shot)}
                className="shrink-0 accent-violet"
              />
              <ShotThumb session={session} asset={asset} shot={shot} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="h-1 w-10 overflow-hidden rounded-full bg-base">
                    <span className="block h-full rounded-full bg-violet" style={{ width: `${shot.intensity * 100}%` }} />
                  </span>
                  <span className="truncate text-2xs text-muted">{shot.tags.join(' · ') || 'cena'}</span>
                </span>
                <span className="tnum block truncate text-2xs text-ink-soft">
                  {asset.name} · {fmt(shot.startS)} · {(shot.endS - shot.startS).toFixed(1)} s
                </span>
                {shot.line && <span className="block truncate text-2xs text-faint italic">“{shot.line.replace(/\n/g, ' ')}”</span>}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {selected.length > 0 && (
        <div className="shrink-0 border-t border-line px-2 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-2xs font-medium text-ink">{selected.length} selecionada(s)</span>
            <button type="button" onClick={() => { setSelectedIds([]); setActiveId(null); }} className="inline-flex items-center gap-1 text-2xs text-muted hover:text-ink">
              <X size={12} /> Limpar
            </button>
          </div>
          {active && (
            <div className="mb-2 rounded-md bg-base p-1.5">
              <p className="mb-1 truncate text-2xs text-muted">Ajustar trecho · {active.asset.name}</p>
              <SceneReview session={session} asset={active.asset} startS={active.range.inS} endS={active.range.outS} />
              <div className="grid grid-cols-2 gap-1.5">
                <label className="text-2xs text-muted">
                  Início (s)
                  <input
                    type="number"
                    aria-label="Início do trecho em segundos"
                    className="mt-0.5 h-7 w-full rounded border border-line bg-panel px-1.5 text-xs text-ink"
                    min={active.shot.startS}
                    max={active.range.outS - 0.4}
                    step="0.1"
                    value={active.range.inS}
                    onChange={(e) => {
                      if (e.target.value === '') return;
                      const value = Number(e.target.value);
                      if (!Number.isFinite(value)) return;
                      setRanges((current) => ({ ...current, [active.id]: { ...active.range, inS: Math.max(active.shot.startS, Math.min(value, active.range.outS - 0.4)) } }));
                    }}
                  />
                </label>
                <label className="text-2xs text-muted">
                  Fim (s)
                  <input
                    type="number"
                    aria-label="Fim do trecho em segundos"
                    className="mt-0.5 h-7 w-full rounded border border-line bg-panel px-1.5 text-xs text-ink"
                    min={active.range.inS + 0.4}
                    max={active.shot.endS}
                    step="0.1"
                    value={active.range.outS}
                    onChange={(e) => {
                      if (e.target.value === '') return;
                      const value = Number(e.target.value);
                      if (!Number.isFinite(value)) return;
                      setRanges((current) => ({ ...current, [active.id]: { ...active.range, outS: Math.min(active.shot.endS, Math.max(value, active.range.inS + 0.4)) } }));
                    }}
                  />
                </label>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={addSelected}
            disabled={!canAdd}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-control bg-violet px-2 text-xs font-medium text-white hover:bg-violet-strong disabled:cursor-not-allowed disabled:opacity-50"
            title="Acrescenta os trechos em sequência no fim da trilha de vídeo; cada um permanece editável"
          >
            <Scissors size={13} /> <Check size={13} /> Juntar e adicionar
          </button>
        </div>
      )}
    </div>
  );
}

export function LinesPanel({ session }: { session: ProjectSession }) {
  const drag = useRangeDrag();
  const [onlyImpact, setOnlyImpact] = useState(false);
  const assets = session.project.assets.filter((a) => a.kind === 'video');
  const lines = useMemo(() => {
    const all: { asset: Asset; s: SpeechSegment }[] = [];
    for (const a of assets) for (const s of session.assetRuntime(a.id).episode?.speech ?? []) all.push({ asset: a, s });
    const list = onlyImpact ? all.filter((x) => x.s.impact >= 0.55 || x.s.kind === 'grito') : all;
    return list.sort((x, y) => (onlyImpact ? y.s.impact - x.s.impact : 0)).slice(0, 400);
  }, [assets, session, session.changes, onlyImpact]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="flex items-center gap-2 px-3 pb-2 text-2xs text-muted">
        <input type="checkbox" className="accent-violet" checked={onlyImpact} onChange={(e) => setOnlyImpact(e.target.checked)} />
        Só frases marcantes e gritos
      </label>
      {assets.length > 0 && lines.length === 0 && <p className="px-3 text-xs text-muted">Nenhuma fala encontrada ainda. Episódios com legenda embutida dão o texto de cada fala.</p>}
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {lines.map(({ asset, s }) => (
          <li key={`${asset.id}-${s.startS}`}>
            <div
              role="button"
              tabIndex={0}
              onPointerDown={(e) => drag(e, asset, Math.max(0, s.startS - 0.1), s.endS + 0.15, s.text ? `"${s.text.slice(0, 30)}"` : `${s.kind} ${fmt(s.startS)}`, s.text)}
              title={`${asset.name} · ${fmt(s.startS)} — arraste para a trilha Vozes`}
              className="flex cursor-grab items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-raised active:cursor-grabbing"
            >
              {s.kind === 'grito' ? <Megaphone size={14} className="mt-0.5 shrink-0 text-warn" /> : <MessageSquareQuote size={14} className="mt-0.5 shrink-0 text-azure" />}
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-ink">{s.text ? s.text.replace(/\n/g, ' ') : s.kind === 'grito' ? 'Grito' : 'Fala (sem legenda)'}</span>
                <span className="tnum block text-2xs text-muted">
                  {asset.name} · {fmt(s.startS)} · {(s.endS - s.startS).toFixed(1)} s{s.impact >= 0.55 ? ' · marcante' : ''}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
