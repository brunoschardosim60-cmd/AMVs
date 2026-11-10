import { chat } from '@amv/assistant';
import { normLabel, SCENE_ACTIONS, SCENE_EMOTIONS, shotKey, type Shot, type ShotVision } from '@amv/analysis';
import { clipEndUs, insertAsset, type Asset, type SceneAnnotation } from '@amv/project';
import { Bookmark, Check, CircleSlash2, Clapperboard, Eye, Heart, Loader2, Search, Sparkles, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isLocal, loadAiSettings, secretName, type AiSettings } from '../../core/aiSettings';
import type { ProjectSession } from '../../core/session';
import { useApp, useSessionVersion } from '../../store';
import { Button, inputClass } from '../../ui/controls';
import { useEditor } from '../editor/editorStore';
import { useStrip } from '../editor/mediaCache';
import { FRAMINGS, parseSceneSearchFilters, SCENE_TYPES, type SceneSearchFilters } from './search';

type SceneEntry = {
  id: string;
  asset: Asset;
  shot: Shot;
  vision: ShotVision | null;
  annotation: SceneAnnotation | null;
  durationS: number;
};

const EMPTY_SEMANTIC: SceneSearchFilters = {
  character: null, action: null, emotion: null, framing: null, sceneType: null, text: null,
};

function timecode(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${String(Math.floor((seconds % 1) * 10))}`;
}

function percent(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

function SceneThumbnail({ session, asset, shot }: { session: ProjectSession; asset: Asset; shot: Shot }) {
  const platform = useApp((state) => state.platform)!;
  const strip = useStrip(platform, session, asset.id);
  if (!strip) return <span className="grid aspect-video w-full place-items-center rounded bg-raised text-faint"><Eye size={18} /></span>;
  const index = Math.min(strip.plan.count - 1, Math.floor(((shot.startS + shot.endS) / 2) / strip.plan.intervalS));
  const width = 128;
  const height = strip.plan.tileHeight * width / strip.plan.tileWidth;
  return (
    <span
      role="img"
      aria-label={`Miniatura aproximada em ${timecode((shot.startS + shot.endS) / 2)}`}
      className="block aspect-video w-full rounded bg-black"
      style={{
        backgroundImage: `url("${strip.url}")`,
        backgroundSize: `${strip.plan.cols * width}px ${strip.plan.rows * height}px`,
        backgroundPosition: `-${(index % strip.plan.cols) * width}px -${Math.floor(index / strip.plan.cols) * height}px`,
      }}
    />
  );
}

function Preview({ session, entry }: { session: ProjectSession; entry: SceneEntry | null }) {
  const platform = useApp((state) => state.platform)!;
  const video = useRef<HTMLVideoElement>(null);
  const proxyPath = entry ? session.assetRuntime(entry.asset.id).artifacts?.proxyPath : null;
  useEffect(() => {
    const element = video.current;
    if (element && entry && element.readyState >= 1) {
      element.pause();
      element.currentTime = entry.shot.startS;
    }
  }, [entry?.id, entry?.shot.startS, proxyPath]);
  if (!entry) return <div className="grid aspect-video place-items-center rounded-control bg-base text-xs text-muted">Selecione uma cena para ver a prévia.</div>;
  if (!proxyPath) return <div className="grid aspect-video place-items-center rounded-control bg-base px-5 text-center text-xs text-muted">Proxy de prévia indisponível. A biblioteca não abre o arquivo original diretamente.</div>;
  return (
    <video
      ref={video}
      key={`${proxyPath}:${entry.id}`}
      src={platform.fileUrl(proxyPath)}
      muted
      playsInline
      controls
      preload="metadata"
      className="aspect-video w-full rounded-control bg-black object-contain"
      onLoadedMetadata={(event) => { event.currentTarget.currentTime = entry.shot.startS; }}
      onTimeUpdate={(event) => {
        if (event.currentTarget.currentTime >= entry.shot.endS) event.currentTarget.pause();
      }}
    />
  );
}

function ResultCard({ session, entry, active, selected, onActivate, onSelect }: {
  session: ProjectSession;
  entry: SceneEntry;
  active: boolean;
  selected: boolean;
  onActivate: () => void;
  onSelect: () => void;
}) {
  const duration = entry.durationS;
  const durationTotal = Math.max(0.001, entry.asset.probe?.durationUs ? entry.asset.probe.durationUs / 1_000_000 : entry.shot.endS);
  return (
    <article
      className={`grid grid-cols-[150px_minmax(0,1fr)] gap-3 rounded-panel border p-2.5 ${active ? 'border-violet/60 bg-violet/5' : 'border-line bg-panel'}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 112px' }}
    >
      <button type="button" className="min-w-0 text-left" onClick={onActivate} aria-label={`Ver cena de ${entry.asset.name} em ${timecode(entry.shot.startS)}`}>
        <SceneThumbnail session={session} asset={entry.asset} shot={entry.shot} />
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-base" title={`Posição na linha temporal original: ${timecode(entry.shot.startS)} de ${timecode(durationTotal)}`}>
          <span className="block h-full rounded-full bg-violet" style={{ marginLeft: `${Math.min(99, entry.shot.startS / durationTotal * 100)}%`, width: `${Math.max(0.5, duration / durationTotal * 100)}%` }} />
        </span>
      </button>
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Selecionar cena ${entry.asset.name} ${timecode(entry.shot.startS)}`} className="mt-1 accent-violet" />
          <button type="button" className="min-w-0 flex-1 text-left" onClick={onActivate}>
            <span className="block truncate text-xs font-medium text-ink">{entry.asset.name}</span>
            <span className="tnum block text-2xs text-muted">{timecode(entry.shot.startS)}–{timecode(entry.shot.endS)} · {duration.toFixed(1)} s</span>
          </button>
          <span className="flex shrink-0 gap-1">
            {entry.annotation?.favorite && <Star size={13} className="fill-violet text-violet" aria-label="Favorita" />}
            {entry.annotation?.marked && <Bookmark size={13} className="text-azure" aria-label="Marcada" />}
            {entry.annotation?.excludedFromAuto && <CircleSlash2 size={13} className="text-warn" aria-label="Fora da seleção automática" />}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {entry.shot.tags.map((tag) => <span key={tag} className="rounded-full bg-raised px-1.5 py-0.5 text-2xs text-muted">{tag}</span>)}
          {entry.vision?.action && <span className="rounded-full bg-azure-deep px-1.5 py-0.5 text-2xs text-azure">{entry.vision.action}</span>}
          {entry.vision?.emotion && <span className="rounded-full bg-raised px-1.5 py-0.5 text-2xs text-ink-soft">{entry.vision.emotion}</span>}
          {entry.vision?.framing && entry.vision.framing !== 'unknown' && <span className="rounded-full bg-raised px-1.5 py-0.5 text-2xs text-ink-soft">{entry.vision.framing}</span>}
        </div>
        {entry.vision?.note && <p className="mt-1 truncate text-2xs text-ink-soft">{entry.vision.note}</p>}
      </div>
    </article>
  );
}

export function SceneLaboratory({ session }: { session: ProjectSession }) {
  const platform = useApp((state) => state.platform);
  const toast = useApp((state) => state.toast);
  const selectClips = useEditor((state) => state.select);
  useSessionVersion(session);
  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState<SceneSearchFilters>(EMPTY_SEMANTIC);
  const [action, setAction] = useState('');
  const [emotion, setEmotion] = useState('');
  const [framing, setFraming] = useState('');
  const [sceneType, setSceneType] = useState('');
  const [character, setCharacter] = useState('');
  const [minimumIntensity, setMinimumIntensity] = useState(0);
  const [minimumConfidence, setMinimumConfidence] = useState(0);
  const [minimumDuration, setMinimumDuration] = useState('');
  const [maximumDuration, setMaximumDuration] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [markedOnly, setMarkedOnly] = useState(false);
  const [includeExcluded, setIncludeExcluded] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [analysis, setAnalysis] = useState<{ label: string; done: number; total: number } | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const analysisAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (platform) void loadAiSettings(platform).then(setSettings);
  }, [platform]);
  useEffect(() => () => analysisAbort.current?.abort(), []);

  const entries = useMemo(() => {
    const annotations = new Map(session.project.sceneAnnotations.map((item) => [`${item.assetId}@${item.sceneKey}`, item]));
    const all: SceneEntry[] = [];
    for (const asset of session.project.assets.filter((item) => item.kind === 'video')) {
      const runtime = session.assetRuntime(asset.id);
      for (const shot of runtime.episode?.shots ?? []) {
        const key = shotKey(shot.startS);
        all.push({
          id: `${asset.id}@${key}`,
          asset,
          shot,
          vision: runtime.vision?.shots[key] ?? null,
          annotation: annotations.get(`${asset.id}@${key}`) ?? null,
          durationS: shot.endS - shot.startS,
        });
      }
    }
    return all.sort((a, b) => a.asset.name.localeCompare(b.asset.name) || a.shot.startS - b.shot.startS);
  }, [session, session.project.assets, session.project.sceneAnnotations, session.changes]);

  const characters = useMemo(() => [...new Set([
    ...entries.flatMap((entry) => entry.vision?.characters ?? []),
    ...session.project.characterLibrary.filter((profile) => profile.evidence.length).map((profile) => profile.name),
  ])].sort((a, b) => a.localeCompare(b)), [entries, session.project.characterLibrary]);
  const filters = {
    action: action || semantic.action || '',
    emotion: emotion || semantic.emotion || '',
    framing: framing || semantic.framing || '',
    sceneType: sceneType || semantic.sceneType || '',
    character: character || semantic.character || '',
  };
  const visible = useMemo(() => {
    const text = [query, semantic.text].filter(Boolean).join(' ').trim().toLocaleLowerCase();
    const normalizedText = normLabel(text);
    return entries.filter((entry) => {
      const confidence = entry.vision?.confidence ?? 0;
      const visionText = [
        entry.asset.name, entry.shot.tags.join(' '), entry.shot.line ?? '', entry.vision?.note ?? '',
        entry.vision?.characters.join(' ') ?? '', entry.annotation?.tags.join(' ') ?? '',
      ].join(' ');
      if (normalizedText && !normLabel(visionText).includes(normalizedText)) return false;
      if (filters.action && (confidence < Math.max(0.45, minimumConfidence) || entry.vision?.action !== filters.action)) return false;
      if (filters.emotion && (confidence < Math.max(0.45, minimumConfidence) || entry.vision?.emotion !== filters.emotion)) return false;
      if (filters.framing && ((entry.vision?.framingConfidence ?? 0) < Math.max(0.45, minimumConfidence) || entry.vision?.framing !== filters.framing)) return false;
      const sceneTypeConfidence = entry.vision?.sceneTypeConfidence ?? entry.vision?.confidence ?? 0;
      const actualSceneType = entry.vision?.sceneType ?? entry.vision?.local?.sceneType;
      if (filters.sceneType && (sceneTypeConfidence < Math.max(0.45, minimumConfidence) || actualSceneType !== filters.sceneType)) return false;
      if (filters.character) {
        const characterProfile = session.project.characterLibrary.find((profile) =>
          [profile.name, ...profile.aliases].some((name) => normLabel(name) === normLabel(filters.character)),
        );
        const labels = entry.vision?.characters ?? [];
        const matched = confidence >= Math.max(0.45, minimumConfidence)
          && labels.some((name) => normLabel(name) === normLabel(filters.character)
            || !!characterProfile && [characterProfile.name, ...characterProfile.aliases].some((alias) => normLabel(alias) === normLabel(name)));
        const confirmedEvidence = !!characterProfile?.confirmed
          && characterProfile.evidence.some((evidence) => evidence.assetId === entry.asset.id && evidence.sceneKey === shotKey(entry.shot.startS));
        if (!matched && !confirmedEvidence) return false;
      }
      if (entry.shot.intensity < minimumIntensity) return false;
      if (minimumDuration && entry.durationS < Number(minimumDuration)) return false;
      if (maximumDuration && entry.durationS > Number(maximumDuration)) return false;
      if (favoriteOnly && !entry.annotation?.favorite) return false;
      if (markedOnly && !entry.annotation?.marked) return false;
      if (!includeExcluded && entry.annotation?.excludedFromAuto) return false;
      return true;
    });
  }, [entries, query, semantic, filters.action, filters.emotion, filters.framing, filters.sceneType, filters.character, minimumIntensity, minimumConfidence, minimumDuration, maximumDuration, favoriteOnly, markedOnly, includeExcluded, session.project.characterLibrary]);
  const active = visible.find((entry) => entry.id === activeId) ?? visible[0] ?? null;
  const selected = selectedIds.flatMap((id) => {
    const entry = entries.find((item) => item.id === id);
    return entry ? [entry] : [];
  });
  const analysisTargets = session.project.assets.filter((asset) => asset.kind === 'video' && asset.status !== 'missing' && session.assetRuntime(asset.id).episode);
  const missingLocalCount = analysisTargets.reduce((sum, asset) => sum + session.localVisionTargets(asset.id, 'all').length, 0);
  const missingModelCount = analysisTargets.reduce((sum, asset) => sum + session.visionTargets(asset.id, 'all').length, 0);
  const modelAvailable = !!settings?.enabled && (isLocal(settings) || settings.allowExternal);

  const annotate = (entry: SceneEntry, patch: Partial<SceneAnnotation>) => {
    const current = entry.annotation ?? {
      assetId: entry.asset.id, sceneKey: shotKey(entry.shot.startS),
      favorite: false, marked: false, excludedFromAuto: false, tags: [],
    };
    const annotation = { ...current, ...patch };
    const isEmpty = !annotation.favorite && !annotation.marked && !annotation.excludedFromAuto && annotation.tags.length === 0;
    session.execute({
      type: 'project.sceneAnnotation.update',
      assetId: entry.asset.id,
      sceneKey: annotation.sceneKey,
      annotation: isEmpty ? null : annotation,
    }, 'Anotar cena');
  };

  const analyzeLocal = async () => {
    if (analysis) return;
    let done = 0;
    const total = missingLocalCount;
    const controller = new AbortController();
    analysisAbort.current = controller;
    try {
      for (const asset of analysisTargets) {
        if (!session.localVisionTargets(asset.id, 'all').length) continue;
        setAnalysis({ label: asset.name, done, total });
        const result = await session.runLocalVision(asset.id, {
          scope: 'all',
          signal: controller.signal,
          onProgress: (completed) => setAnalysis({ label: asset.name, done: done + completed, total }),
        });
        done += result.analyzed;
        if (controller.signal.aborted) break;
      }
      toast(controller.signal.aborted
        ? { tone: 'info', title: 'Análise local interrompida', body: `${done} cenas concluídas permanecem no cache e podem ser retomadas.` }
        : { tone: 'ok', title: `${done} cenas analisadas localmente`, body: 'Descritores de cor, composição e movimento foram armazenados no cache. Personagens, enquadramentos e emoções exigem modelo de visão.' });
    } catch (error) {
      toast(controller.signal.aborted
        ? { tone: 'info', title: 'Análise local interrompida', body: 'As cenas já concluídas permanecem no cache.' }
        : { tone: 'error', title: 'Falha na análise visual local', body: error instanceof Error ? error.message : String(error) });
    } finally {
      analysisAbort.current = null;
      setAnalysis(null);
    }
  };

  const analyzeWithModel = async () => {
    if (!platform || !settings || analysis) return;
    if (!settings.enabled) {
      toast({ tone: 'warn', title: 'Modelo de IA desativado', body: 'Ative e configure um modelo de visão nas configurações do Assistente.' });
      return;
    }
    if (!isLocal(settings) && !settings.allowExternal) {
      toast({ tone: 'warn', title: 'Envio externo desativado', body: 'Para modelos remotos, autorize o envio de quadros nas configurações de IA. Ollama local não envia quadros para a internet.' });
      return;
    }
    let key: string | null = null;
    const controller = new AbortController();
    analysisAbort.current = controller;
    try {
      key = settings.provider.needsKey ? await platform.secrets.get(secretName(settings.presetId)) : null;
      let done = 0;
      const total = missingModelCount;
      for (const asset of analysisTargets) {
        if (!session.visionTargets(asset.id, 'all').length) continue;
        setAnalysis({ label: asset.name, done, total });
        const result = await session.runVision(asset.id, {
          provider: settings.provider,
          key,
          fetch: platform.http,
          scope: 'all',
          signal: controller.signal,
          onProgress: (completed) => setAnalysis({ label: asset.name, done: done + completed, total }),
        });
        done += result.labeled;
        if (controller.signal.aborted) break;
      }
      toast(controller.signal.aborted
        ? { tone: 'info', title: 'Análise por modelo interrompida', body: `${done} cenas concluídas permanecem no cache e podem ser retomadas.` }
        : { tone: 'ok', title: `${done} cenas rotuladas`, body: 'Personagens, ações, emoções e enquadramentos vêm das respostas do modelo e mantêm sua confiança.' });
    } catch (error) {
      toast(controller.signal.aborted
        ? { tone: 'info', title: 'Análise por modelo interrompida', body: 'As cenas já concluídas permanecem no cache.' }
        : { tone: 'error', title: 'Falha ao analisar cenas com o modelo', body: error instanceof Error ? error.message : String(error) });
    } finally {
      analysisAbort.current = null;
      setAnalysis(null);
    }
  };

  const interpretSearch = async () => {
    if (!platform || !settings || !query.trim() || searchBusy) return;
    if (!modelAvailable) {
      toast({ tone: 'info', title: 'Busca por modelo indisponível', body: 'Configure um modelo local ou habilite explicitamente o envio externo nas configurações de IA.' });
      return;
    }
    setSearchBusy(true);
    try {
      const key = settings.provider.needsKey ? await platform.secrets.get(secretName(settings.presetId)) : null;
      const response = await chat(
        settings.provider,
        key,
        platform.http,
        `Converta a consulta em filtros para uma biblioteca de cenas. Retorne somente JSON com as chaves character, action, emotion, framing, sceneType e text; todas devem ser string ou null. Use apenas action=${SCENE_ACTIONS.join('|')}; emotion=${SCENE_EMOTIONS.join('|')}; framing=${FRAMINGS.join('|')}; sceneType=${SCENE_TYPES.join('|')}. Não invente rótulos nem afirme que uma cena existe. Coloque em text apenas termos que devam ser procurados literalmente nas notas, falas, tags ou nomes de personagem já analisados.`,
        [{ role: 'user', content: query.trim() }],
        [],
      );
      const filters = parseSceneSearchFilters(response.text);
      if (!Object.values(filters).some(Boolean)) throw new Error('O modelo não conseguiu identificar filtros nessa consulta. Tente nomear personagem, ação, emoção ou enquadramento.');
      setSemantic(filters);
      setQuery('');
      setAction('');
      setEmotion('');
      setFraming('');
      setSceneType('');
      setCharacter('');
      toast({ tone: 'ok', title: 'Consulta convertida em filtros', body: 'Os resultados dependem apenas dos metadados já analisados; nenhuma cena foi classificada pela consulta.' });
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível interpretar a busca', body: error instanceof Error ? error.message : String(error) });
    } finally {
      setSearchBusy(false);
    }
  };

  const addSelected = () => {
    const track = session.project.tracks.find((item) => item.kind === 'video' && !item.locked);
    if (!track || !selected.length) {
      toast({ tone: 'warn', title: 'Selecione cenas e destrave uma trilha de vídeo' });
      return;
    }
    try {
      let startUs = session.project.clips.filter((clip) => clip.trackId === track.id).reduce((end, clip) => Math.max(end, clipEndUs(clip)), 0);
      const commands = selected.flatMap(({ asset, shot }) => {
        const sourceInUs = Math.round(shot.startS * 1_000_000);
        const sourceOutUs = Math.round(shot.endS * 1_000_000);
        const batch = insertAsset(session.project, { assetId: asset.id, trackId: track.id, startUs, sourceInUs, sourceOutUs });
        startUs += sourceOutUs - sourceInUs;
        return batch;
      });
      const ids = commands.flatMap((command) => command.type === 'clip.add' ? [command.clip.id] : []);
      session.history.transaction(`Adicionar ${selected.length} cenas do Laboratório`, commands);
      selectClips(ids);
      toast({ tone: 'ok', title: `${selected.length} cenas adicionadas à timeline`, body: 'Os trechos foram inseridos como clipes editáveis. Ctrl+Z desfaz a ação.' });
      setSelectedIds([]);
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível adicionar as cenas', body: error instanceof Error ? error.message : String(error) });
    }
  };

  const addTag = () => {
    const value = tagDraft.trim();
    if (!active || !value) return;
    const tags = [...new Set([...(active.annotation?.tags ?? []), value])];
    annotate(active, { tags });
    setTagDraft('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h1 className="text-base font-semibold">Laboratório de Cenas</h1>
          <p className="text-2xs text-muted">{entries.length} cenas analisadas · {analysisTargets.length} vídeos com análise disponível · cache reaproveitado</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {analysis ? (
            <>
              <span className="self-center text-2xs text-muted">Analisando {analysis.label} · {analysis.done}/{analysis.total}</span>
              <Button size="sm" variant="danger" onClick={() => analysisAbort.current?.abort()}>Cancelar</Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={!missingLocalCount} onClick={() => void analyzeLocal()} icon={<Eye size={14} />}>
                Análise local ({missingLocalCount})
              </Button>
              <Button size="sm" disabled={!missingModelCount} onClick={() => void analyzeWithModel()} icon={<Sparkles size={14} />}>
                Rótulos por modelo ({missingModelCount})
              </Button>
            </>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 xl:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 xl:w-[58%] xl:flex-none">
          <div className="rounded-panel border border-line bg-panel p-3">
            <div className="flex gap-2">
              <label className="relative min-w-0 flex-1">
                <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar notas, falas, tags ou personagens analisados…" className={`${inputClass} h-9 w-full pl-8`} />
              </label>
              <Button size="sm" disabled={!query.trim() || searchBusy || !modelAvailable} onClick={() => void interpretSearch()} icon={searchBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}>
                Interpretar
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
              <select aria-label="Personagem" className={`${inputClass} h-8`} value={character || semantic.character || ''} onChange={(event) => { setCharacter(event.target.value); setSemantic((current) => ({ ...current, character: null })); }}>
                <option value="">Todos os personagens</option>
                {characters.map((name) => <option key={name}>{name}</option>)}
              </select>
              <select aria-label="Ação" className={`${inputClass} h-8`} value={action || semantic.action || ''} onChange={(event) => { setAction(event.target.value); setSemantic((current) => ({ ...current, action: null })); }}>
                <option value="">Todas as ações</option>
                {SCENE_ACTIONS.map((value) => <option key={value}>{value}</option>)}
              </select>
              <select aria-label="Emoção" className={`${inputClass} h-8`} value={emotion || semantic.emotion || ''} onChange={(event) => { setEmotion(event.target.value); setSemantic((current) => ({ ...current, emotion: null })); }}>
                <option value="">Todas as emoções</option>
                {SCENE_EMOTIONS.map((value) => <option key={value}>{value}</option>)}
              </select>
              <select aria-label="Enquadramento" className={`${inputClass} h-8`} value={framing || semantic.framing || ''} onChange={(event) => { setFraming(event.target.value); setSemantic((current) => ({ ...current, framing: null })); }}>
                <option value="">Todos os enquadramentos</option>
                {FRAMINGS.map((value) => <option key={value}>{value}</option>)}
              </select>
              <select aria-label="Tipo de cena" className={`${inputClass} h-8`} value={sceneType || semantic.sceneType || ''} onChange={(event) => { setSceneType(event.target.value); setSemantic((current) => ({ ...current, sceneType: null })); }}>
                <option value="">Todos os contextos</option>
                {SCENE_TYPES.map((value) => <option key={value}>{value}</option>)}
              </select>
              <label className="flex items-center gap-2 text-2xs text-muted">
                Intensidade mínima
                <input type="range" min="0" max="1" step="0.05" value={minimumIntensity} onChange={(event) => setMinimumIntensity(Number(event.target.value))} className="min-w-0 flex-1 accent-violet" />
                {Math.round(minimumIntensity * 100)}%
              </label>
              <label className="flex items-center gap-1.5 text-2xs text-muted">Duração mín.
                <input type="number" min="0" step="0.1" value={minimumDuration} onChange={(event) => setMinimumDuration(event.target.value)} placeholder="0 s" className={`${inputClass} h-7 w-16`} />
              </label>
              <label className="flex items-center gap-1.5 text-2xs text-muted">Duração máx.
                <input type="number" min="0" step="0.1" value={maximumDuration} onChange={(event) => setMaximumDuration(event.target.value)} placeholder="—" className={`${inputClass} h-7 w-16`} />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} className="accent-violet" /> Favoritas</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={markedOnly} onChange={(event) => setMarkedOnly(event.target.checked)} className="accent-violet" /> Marcadas</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeExcluded} onChange={(event) => setIncludeExcluded(event.target.checked)} className="accent-violet" /> Mostrar excluídas do Auto AMV</label>
              <label className="ml-auto flex items-center gap-1.5">Confiança mín.
                <input type="range" min="0" max="0.9" step="0.05" value={minimumConfidence} onChange={(event) => setMinimumConfidence(Number(event.target.value))} className="w-20 accent-violet" />
                {Math.round(minimumConfidence * 100)}%
              </label>
              <span>{visible.length} resultado(s)</span>
              {(semantic.action || semantic.emotion || semantic.framing || semantic.sceneType || semantic.character || semantic.text) && (
                <button type="button" className="text-violet hover:text-ink" onClick={() => setSemantic(EMPTY_SEMANTIC)}>Limpar filtros da busca inteligente</button>
              )}
            </div>
            <p className="mt-2 text-2xs text-faint">
              A busca em linguagem natural envia somente o texto da consulta ao modelo selecionado; os filtros são aplicados localmente. Rótulos de ação, emoção, personagem e enquadramento exigem análise com confiança suficiente.
            </p>
          </div>
          {selected.length > 0 && (
            <div className="flex shrink-0 items-center justify-between rounded-control border border-violet/30 bg-violet/5 px-3 py-2">
              <span className="text-xs text-ink">{selected.length} cena(s) selecionada(s)</span>
              <Button size="sm" onClick={addSelected} icon={<Clapperboard size={14} />}>Adicionar à timeline</Button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visible.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {visible.map((entry) => (
                  <ResultCard
                    key={entry.id}
                    session={session}
                    entry={entry}
                    active={active?.id === entry.id}
                    selected={selectedIds.includes(entry.id)}
                    onActivate={() => setActiveId(entry.id)}
                    onSelect={() => setSelectedIds((ids) => ids.includes(entry.id) ? ids.filter((id) => id !== entry.id) : [...ids, entry.id])}
                  />
                ))}
              </div>
            ) : (
              <div className="grid min-h-40 place-items-center rounded-panel border border-dashed border-line px-5 text-center text-xs text-muted">
                {entries.length ? 'Nenhuma cena corresponde aos filtros. Dados não analisados não são tratados como uma correspondência.' : 'Importe um vídeo e aguarde a análise de cenas para começar a biblioteca.'}
              </div>
            )}
          </div>
        </section>
        <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto rounded-panel border border-line bg-panel p-3 xl:w-[42%] xl:flex-1">
          {active ? (
            <>
              <Preview session={session} entry={active} />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{active.asset.name}</h2>
                  <p className="tnum text-2xs text-muted">Original {timecode(active.shot.startS)}–{timecode(active.shot.endS)} · proxy de prévia · {active.durationS.toFixed(2)} s</p>
                  <p className="max-w-full truncate text-2xs text-faint" title={active.asset.path}>Arquivo: {active.asset.path}</p>
                </div>
                <span className="shrink-0 rounded-full bg-raised px-2 py-1 text-2xs text-ink-soft">
                  {active.vision?.confidence != null ? `Visão ${percent(active.vision.confidence)}` : active.vision?.sceneTypeConfidence != null ? `Local ${percent(active.vision.sceneTypeConfidence)}` : 'Sem rótulo'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={active.annotation?.favorite ? 'primary' : 'secondary'} onClick={() => annotate(active, { favorite: !active.annotation?.favorite })} icon={<Heart size={14} />}>
                  {active.annotation?.favorite ? 'Favorita' : 'Favoritar'}
                </Button>
                <Button size="sm" variant={active.annotation?.marked ? 'primary' : 'secondary'} onClick={() => annotate(active, { marked: !active.annotation?.marked })} icon={<Bookmark size={14} />}>
                  {active.annotation?.marked ? 'Marcada' : 'Marcar'}
                </Button>
                <Button size="sm" variant={active.annotation?.excludedFromAuto ? 'danger' : 'secondary'} onClick={() => annotate(active, { excludedFromAuto: !active.annotation?.excludedFromAuto })} icon={<CircleSlash2 size={14} />}>
                  {active.annotation?.excludedFromAuto ? 'Fora do Auto AMV' : 'Excluir do Auto AMV'}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-control bg-base p-3 text-2xs">
                <span className="text-muted">Intensidade da análise</span><span className="tnum text-right">{Math.round(active.shot.intensity * 100)}%</span>
                <span className="text-muted">Ação / emoção</span><span className="text-right">{active.vision?.action ?? 'não analisada'} / {active.vision?.emotion ?? 'não analisada'}</span>
                <span className="text-muted">Enquadramento</span><span className="text-right">{active.vision?.framing ?? 'não analisado'} · {percent(active.vision?.framingConfidence)}</span>
                <span className="text-muted">Confiança do rótulo</span><span className="tnum text-right">{percent(active.vision?.confidence)}</span>
                <span className="text-muted">Personagens</span><span className="text-right">{active.vision?.characters.join(', ') || 'não identificados'}</span>
                <span className="text-muted">Contexto local</span><span className="text-right">{active.vision?.sceneType ?? active.vision?.local?.sceneType ?? 'não analisado'}</span>
                {active.vision?.faceCount != null && <><span className="text-muted">Rostos / expressões</span><span className="text-right">{active.vision.faceCount} · {active.vision.expressions?.map((item) => `${item.label} ${percent(item.confidence)}`).join(', ') || 'sem rótulo'}</span></>}
                <span className="text-muted">Plano original</span><span className="tnum text-right">{timecode(active.shot.startS)}–{timecode(active.shot.endS)}</span>
              </div>
              {active.vision?.note && <p className="rounded-control bg-base p-3 text-xs text-ink-soft">{active.vision.note}</p>}
              <div>
                <p className="mb-1.5 text-2xs font-medium text-ink-soft">Cor e imagem (análise local)</p>
                {active.vision?.local ? (
                  <>
                    <div className="flex h-7 overflow-hidden rounded-control border border-line" title={`Paleta quantizada dos quadros amostrados: ${active.vision.local.dominantColors?.join(', ') ?? 'indisponível'}`}>
                      {(active.vision.local.dominantColors ?? []).map((color, index) => <span key={`${color}-${index}`} style={{ backgroundColor: color }} className="flex-1" />)}
                    </div>
                    <p className="mt-1 text-2xs text-muted">Paleta RGB aproximada · brilho {Math.round(active.vision.local.brightness * 100)}% · saturação {Math.round(active.vision.local.saturation * 100)}% · movimento {Math.round(active.vision.local.temporalMotion * 100)}% · {active.vision.local.samples} amostras</p>
                  </>
                ) : <p className="text-2xs text-muted">Não analisada localmente. Execute a análise local para extrair cor, composição e movimento.</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-2xs font-medium text-ink-soft">Tags pessoais</label>
                <div className="flex gap-2">
                  <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addTag()} placeholder="Ex.: golpe final" className={`${inputClass} h-8 min-w-0 flex-1`} />
                  <Button size="sm" onClick={addTag} disabled={!tagDraft.trim()}>Marcar</Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {active.annotation?.tags.map((tag) => <button key={tag} type="button" title={`Remover tag ${tag}`} onClick={() => annotate(active, { tags: active.annotation!.tags.filter((item) => item !== tag) })} className="rounded-full bg-raised px-2 py-1 text-2xs text-ink-soft">{tag} ×</button>)}
                </div>
              </div>
              <p className="mt-auto flex items-start gap-2 border-t border-line pt-2 text-2xs leading-relaxed text-faint">
                <Check size={13} className="mt-0.5 shrink-0" />
                Campos ausentes permanecem “não analisados”. A detecção local não reconhece identidade, rosto ou emoção; esses rótulos só aparecem quando o modelo os fornece, com confiança.
              </p>
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-center text-xs text-muted">
              <span><Eye size={22} className="mx-auto mb-2 text-faint" />Nenhuma cena selecionada</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
