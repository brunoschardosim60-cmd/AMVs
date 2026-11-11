import { isSfxAsset, type Asset } from '@amv/project';
import { AlertTriangle, Archive, AudioLines, Copy, Download, Film, FolderSearch, Image as ImageIcon, Plus, Redo2, Save, Search, ShieldCheck, Undo2, Wand2, History, Bot } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { duration, fpsLabel, mainCodec, resolution, bytes } from '../../format';
import { useApp, useSessionVersion } from '../../store';
import { Button, IconButton, Kbd, Progress, inputClass } from '../../ui/controls';
import { AssetDetail } from './AssetDetail';
import { EditorView } from '../editor/EditorView';
import { ExportDialog } from '../export/ExportDialog';
import { GenerateDialog } from '../automv/GenerateDialog';
import { VersionsMenu } from '../automv/VersionsMenu';
import { AssistantPanel } from '../assistant/AssistantPanel';
import { useEditor } from '../editor/editorStore';
import type { ProjectSession } from '../../core/session';

type Filter = 'all' | Asset['kind'];

const KIND_ICON = { video: Film, audio: AudioLines, image: ImageIcon };

function Thumb({ asset, session }: { asset: Asset; session: ProjectSession }) {
  const platform = useApp((s) => s.platform)!;
  const poster = session.assetRuntime(asset.id).artifacts?.posterPath;
  const Icon = KIND_ICON[asset.kind];
  if (poster && asset.status !== 'missing') {
    return <img src={platform.fileUrl(poster)} alt="" className="h-9 w-16 rounded-[4px] bg-black object-cover" draggable={false} />;
  }
  return (
    <span className={`grid h-9 w-16 place-items-center rounded-[4px] ${asset.kind === 'audio' ? 'bg-azure-deep text-azure' : 'bg-raised text-faint'}`}>
      <Icon size={16} strokeWidth={1.75} />
    </span>
  );
}

function Status({ asset, session }: { asset: Asset; session: ProjectSession }) {
  if (asset.status === 'processing') {
    const jobs = session.queue.list().filter((j) => j.assetId === asset.id && (j.status === 'running' || j.status === 'queued'));
    const running = jobs.find((j) => j.status === 'running');
    if (!running) return <span className="text-muted">Na fila</span>;
    return (
      <span className="flex w-full items-center gap-2">
        <span className="w-16 shrink-0">
          <Progress value={running.progress} live />
        </span>
        <span className="truncate text-muted">{running.label.split(' · ')[0]}</span>
      </span>
    );
  }
  const map = {
    ok: ['bg-ok', 'Pronta'],
    missing: ['bg-warn', 'Não encontrada'],
    error: ['bg-danger', 'Erro'],
  } as const;
  const [dot, label] = map[asset.status];
  return (
    <span className="flex items-center gap-2 text-ink-soft" title={asset.error ?? undefined}>
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

const COLS = 'grid-cols-[64px_minmax(160px,1fr)_76px_92px_64px_96px_76px_150px]';

export function ProjectScreen() {
  const { session, selectedAssetId, selectAsset, importMedia, save, toast, platform } = useApp();
  useSessionVersion(session);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [view, setView] = useState<'edit' | 'media'>('edit');
  const [exporting, setExporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const assistantOpen = useEditor((st) => st.assistantOpen);
  const setAssistantOpen = (v: boolean | ((x: boolean) => boolean)) => useEditor.setState((st) => ({ assistantOpen: typeof v === 'function' ? v(st.assistantOpen) : v }));
  useEffect(() => () => useEditor.setState({ assistantOpen: false }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setExporting(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const project = session!.project;
  // os efeitos sonoros do app ficam no projeto, mas fora das listas
  const userAssets = useMemo(() => project.assets.filter((a) => !isSfxAsset(a)), [project.assets]);
  const assets = useMemo(
    () =>
      userAssets.filter(
        (a) => (filter === 'all' || a.kind === filter) && (!query || a.name.toLowerCase().includes(query.toLowerCase())),
      ),
    [userAssets, filter, query],
  );
  const selected = project.assets.find((a) => a.id === selectedAssetId) ?? null;
  const missing = userAssets.filter((a) => a.status === 'missing').length;
  const counts = { all: userAssets.length, video: 0, audio: 0, image: 0 };
  for (const a of userAssets) counts[a.kind]++;

  useEffect(() => {
    if (selectedAssetId && !selected) selectAsset(null);
  }, [selectedAssetId, selected, selectAsset]);

  const s = session!;

  const findInFolder = async () => {
    const folder = await platform!.dialogs.pickFolder('Pasta onde estão as mídias');
    if (!folder) return;
    const r = await s.relocateFromFolder(folder);
    toast(
      r.found
        ? { tone: 'ok', title: `${r.found} mídia(s) encontrada(s)`, body: r.stillMissing ? `${r.stillMissing} ainda faltando.` : undefined }
        : { tone: 'warn', title: 'Nenhuma mídia encontrada nessa pasta', body: 'O AMV Studio procura pelo conteúdo do arquivo, mesmo que tenha sido renomeado.' },
    );
  };

  const duplicateProject = async () => {
    const target = await platform!.dialogs.saveProjectAs(`${project.name} - Cópia`);
    if (!target) return;
    try {
      const duplicate = await s.duplicateTo(target);
      s.dispose();
      useApp.setState({ session: duplicate, screen: 'project', selectedAssetId: null });
      await useApp.getState().refreshRecents();
      toast({ tone: 'ok', title: 'Cópia do projeto criada', body: duplicate.path });
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível duplicar o projeto', body: (error as Error).message });
    }
  };

  const archiveProject = async () => {
    const confirmed = await platform!.dialogs.confirm(
      'O projeto será salvo e movido para o local escolhido. As mídias originais não serão movidas.',
      'Arquivar projeto',
    );
    if (!confirmed) return;
    const target = await platform!.dialogs.saveProjectAs(`${project.name} - Arquivado`);
    if (!target) return;
    try {
      await s.archiveTo(target);
      await useApp.getState().refreshRecents();
      toast({ tone: 'ok', title: 'Projeto arquivado', body: s.path });
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível arquivar o projeto', body: (error as Error).message });
    }
  };

  const validateProject = async () => {
    try {
      const report = await s.validateDependencies();
      const problems = [
        ...report.missingAssets.map((item) => `Mídia ausente: ${item.path}`),
        ...report.missingVersions.map((item) => `Versão ausente: ${item.path}`),
        ...report.invalidVersions.map((item) => `Versão inválida: ${item.path}`),
        ...report.invalidReferences.map((item) => `Clipe ${item.clipId}: referência inválida (${item.reference})`),
      ];
      toast(report.valid
        ? { tone: 'ok', title: 'Dependências do projeto verificadas', body: `${report.mediaUsage.length} mídias registradas.` }
        : { tone: 'warn', title: 'O projeto tem dependências pendentes', body: problems.slice(0, 4).join('\n') });
    } catch (error) {
      toast({ tone: 'error', title: 'Falha ao validar o projeto', body: (error as Error).message });
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const i = assets.findIndex((a) => a.id === selectedAssetId);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectAsset(assets[Math.min(assets.length - 1, i + 1)]?.id ?? null);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectAsset(assets[Math.max(0, i - 1)]?.id ?? null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      s.removeAsset(selected.id);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      {assistantOpen && <AssistantPanel session={s} onClose={() => setAssistantOpen(false)} />}
      <header className="z-20 shrink-0 border-b border-line bg-panel/95 shadow-[0_4px_18px_rgba(0,0,0,0.1)]">
        <div className="flex min-h-14 items-center gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            {editingName ? (
              <input
                autoFocus
                defaultValue={project.name}
                className={`${inputClass} h-8 w-72 text-[15px] font-semibold`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== project.name) s.execute({ type: 'project.rename', name: v });
                  setEditingName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditingName(false);
                }}
              />
            ) : (
              <button type="button" className="max-w-72 truncate rounded px-1 text-[15px] font-bold tracking-tight text-ink hover:bg-raised" title="Renomear projeto" onClick={() => setEditingName(true)}>
                {project.name}
              </button>
            )}
            <span className="tnum hidden whitespace-nowrap text-2xs text-muted xl:inline">
              {project.settings.width}×{project.settings.height} · {fpsLabel(project.settings.fps)} fps
            </span>
            <span className={`hidden items-center gap-1.5 whitespace-nowrap text-2xs sm:inline-flex ${s.dirty ? 'text-warn' : 'text-muted'}`}>
              <span className={`size-1.5 rounded-full ${s.dirty ? 'bg-warn' : 'bg-ok'}`} />
              {s.dirty ? 'Não salvo' : 'Salvo'}
            </span>
          </div>
          <div className="ml-2 flex gap-0.5 rounded-lg border border-line-soft bg-base p-0.5 text-xs" role="tablist" aria-label="Modo">
            {(
              [
                ['edit', 'Edição'],
                ['media', 'Mídia'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={view === k}
                onClick={() => setView(k)}
                className={`rounded-md px-3 py-1.5 transition-colors ${view === k ? 'bg-raised font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton label={s.history.undoLabel ? `Desfazer: ${s.history.undoLabel} (Ctrl+Z)` : 'Nada para desfazer'} disabled={!s.history.canUndo} onClick={() => s.undo()}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton label={s.history.redoLabel ? `Refazer: ${s.history.redoLabel} (Ctrl+Shift+Z)` : 'Nada para refazer'} disabled={!s.history.canRedo} onClick={() => s.redo()}>
            <Redo2 size={16} />
          </IconButton>
          <span className="mx-2 h-5 w-px bg-line" />
          <Button size="sm" icon={<Save size={14} />} onClick={save} disabled={!s.dirty} title="Salvar (Ctrl+S)">
            Salvar
          </Button>
          <Button size="sm" variant="primary" icon={<Download size={15} />} onClick={() => setExporting(true)} title="Exportar vídeo (Ctrl+E)">
            Exportar
          </Button>
          </div>
        </div>
        <div className="flex min-h-11 items-center gap-1 overflow-x-auto border-t border-line-soft/70 bg-black/10 px-4 py-1">
          <span className="mr-2 shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-faint">Projeto</span>
          <IconButton label="Validar mídias, versões e referências do projeto" className="size-7" onClick={() => void validateProject()}>
            <ShieldCheck size={14} />
          </IconButton>
          <IconButton label="Criar cópia completa do projeto" className="size-7" onClick={() => void duplicateProject()}>
            <Copy size={14} />
          </IconButton>
          <IconButton label="Arquivar projeto em outro local" className="size-7" onClick={() => void archiveProject()}>
            <Archive size={14} />
          </IconButton>
          <div className="relative">
            <IconButton label={`Versões guardadas (${s.project.versions.length})`} className="size-7" onClick={() => setVersionsOpen((v) => !v)}>
              <History size={14} />
            </IconButton>
            {versionsOpen && <VersionsMenu session={s} onClose={() => setVersionsOpen(false)} />}
          </div>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => importMedia()} title="Importar mídia (Ctrl+I)">
            Importar mídia
          </Button>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button size="sm" icon={<Bot size={14} />} variant={assistantOpen ? 'primary' : undefined} onClick={() => setAssistantOpen((v) => !v)} title="Assistente: peça mudanças, ideias e análise do AMV">
            Assistente
          </Button>
          <Button size="sm" icon={<Wand2 size={14} />} onClick={() => setGenerating(true)} title="Gerar um AMV automaticamente a partir da música e dos episódios">
            Gerar meu AMV
          </Button>
          </div>
        </div>
      </header>

      {missing > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b border-warn/25 bg-warn/8 px-5 py-2 text-sm">
          <AlertTriangle size={16} className="text-warn" />
          <span className="text-ink-soft">
            {missing === 1 ? '1 mídia não foi encontrada' : `${missing} mídias não foram encontradas`} no lugar de antes.
          </span>
          <Button size="sm" className="ml-auto" icon={<FolderSearch size={14} />} onClick={findInFolder}>
            Procurar numa pasta
          </Button>
        </div>
      )}

      {view === 'edit' ? (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <EditorView session={s} />
          </div>
        </div>
      ) : (
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col" aria-label="Mídia do projeto">
          <div className="flex shrink-0 items-center gap-3 px-5 py-3">
            <h2 className="text-sm font-semibold">Mídia</h2>
            <div className="flex gap-0.5 text-xs" role="tablist" aria-label="Filtrar por tipo">
              {(
                [
                  ['all', 'Tudo'],
                  ['video', 'Vídeo'],
                  ['audio', 'Áudio'],
                  ['image', 'Imagem'],
                ] as [Filter, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={filter === k}
                  onClick={() => setFilter(k)}
                  className={`rounded-control px-2.5 py-1 ${filter === k ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
                >
                  {label} <span className="tnum text-faint">{counts[k]}</span>
                </button>
              ))}
            </div>
            <label className="relative ml-auto">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar pelo nome" aria-label="Buscar pelo nome" className={`${inputClass} h-8 w-56 pl-8 text-xs`} />
            </label>
          </div>

          {userAssets.length === 0 ? (
            <div className="mx-5 mb-5 grid flex-1 place-items-center rounded-panel border border-dashed border-line">
              <div className="max-w-sm text-center">
                <p className="text-[15px] font-semibold">Arraste episódios, músicas e imagens para cá</p>
                <p className="mt-2 text-sm text-muted">MP4, MKV, MOV, WEBM, MP3, WAV, FLAC, PNG e JPG. Os arquivos originais nunca são alterados.</p>
                <Button variant="primary" className="mt-5" icon={<Plus size={16} />} onClick={() => importMedia()}>
                  Escolher arquivos
                </Button>
                <p className="mt-3 text-xs text-muted">
                  ou <Kbd>Ctrl</Kbd> <Kbd>I</Kbd>
                </p>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto px-3 pb-3" role="listbox" aria-label="Arquivos" tabIndex={0} onKeyDown={onListKey}>
              <div className={`grid ${COLS} sticky top-0 z-10 items-center gap-3 border-b border-line-soft bg-base px-2 py-1.5 text-2xs font-medium text-muted`}>
                <span />
                <span>Nome</span>
                <span className="text-right">Duração</span>
                <span>Resolução</span>
                <span className="text-right">Q/s</span>
                <span>Codec</span>
                <span className="text-right">Tamanho</span>
                <span>Estado</span>
              </div>
              {assets.map((a) => {
                const sel = a.id === selectedAssetId;
                return (
                  <div
                    key={a.id}
                    role="option"
                    aria-selected={sel}
                    onClick={() => selectAsset(a.id)}
                    className={`grid ${COLS} cursor-default items-center gap-3 rounded-md px-2 py-1.5 text-xs ${
                      sel ? 'bg-violet/15 ring-1 ring-violet/50 ring-inset' : 'hover:bg-panel'
                    } ${a.status === 'missing' ? 'opacity-70' : ''}`}
                  >
                    <Thumb asset={a} session={s} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-ink" title={a.path}>
                        {a.name}
                      </span>
                      {s.assetRuntime(a.id).warnings.length > 0 && (
                        <span className="flex items-center gap-1 text-2xs text-warn">
                          <AlertTriangle size={11} />
                          {s.assetRuntime(a.id).warnings.length} aviso(s)
                        </span>
                      )}
                    </span>
                    <span className="tnum text-right text-ink-soft">{a.kind === 'image' || !a.probe ? '—' : duration(a.probe.durationUs)}</span>
                    <span className="tnum text-ink-soft">{resolution(a)}</span>
                    <span className="tnum text-right text-ink-soft">{a.kind === 'video' ? fpsLabel(a.probe?.video?.fps) : '—'}</span>
                    <span className="truncate text-ink-soft">{mainCodec(a)}</span>
                    <span className="tnum text-right text-ink-soft">{a.probe ? bytes(a.probe.sizeBytes) : '—'}</span>
                    <Status asset={a} session={s} />
                  </div>
                );
              })}
              {assets.length === 0 && <p className="px-2 py-6 text-sm text-muted">Nada com esse filtro.</p>}
            </div>
          )}
        </section>

        {selected && <AssetDetail asset={selected} session={s} />}
      </div>
      )}
      {generating && <GenerateDialog session={s} onClose={() => setGenerating(false)} />}
      {exporting && <ExportDialog session={s} onClose={() => setExporting(false)} />}
    </div>
  );
}
