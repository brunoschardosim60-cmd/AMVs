import { clearRange, newId, TrackSchema, type Clip, type Command } from '@amv/project';
import {
  copyClipStyleToSubtitles,
  explodeSubtitlesToWords,
  formatSubtitlesForBulkEdit,
  insertBlankSubtitleAt,
  mergeSubtitlesIntoPhrase,
  patchSubtitlesStyle,
  replaceSubtitlesTextBulk,
  separateLyricsAndDialogueTracks,
  splitSubtitleAt,
  textTracks,
  transformSubtitlesCase,
  type SubtitleLook,
} from '@amv/subtitles';
import { Copy, Eye, EyeOff, FileEdit, Layers, Merge, Plus, Scissors, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { Button, Dialog } from '../../ui/controls';
import { useEditor } from './editorStore';
import { LOCAL_FONT_FAMILIES } from './Inspector';

export function SubtitleTrackManagerBar({
  session,
  trackId,
  setTrackId,
  look,
}: {
  session: ProjectSession;
  trackId: string;
  setTrackId: (id: string) => void;
  look: SubtitleLook;
}) {
  const { toast } = useApp();
  const project = session.project;
  const tracks = textTracks(project);
  const activeTrack = tracks.find((t) => t.id === trackId) ?? tracks[0];
  const select = useEditor((s) => s.select);
  const setPlayhead = useEditor((s) => s.setPlayhead);

  const canSeparate = (() => {
    const res = separateLyricsAndDialogueTracks(project);
    return res.movedCount > 0;
  })();

  const run = (label: string, cmds: Command[]) => {
    if (!cmds.length) return;
    session.history.transaction(label, cmds);
  };

  const addNewSubtitleHere = () => {
    if (!activeTrack) return;
    const playheadUs = useEditor.getState().playheadUs;
    const res = insertBlankSubtitleAt(project, activeTrack.id, playheadUs, look, 'Nova legenda');
    run('Adicionar legenda no cursor', res.commands);
    select([res.clipId]);
    const added = session.project.clips.find((c) => c.id === res.clipId);
    if (added) setPlayhead(added.timelineStartUs);
    toast({ tone: 'ok', title: 'Legenda criada no cursor' });
  };

  const addNewTextTrack = () => {
    const created = TrackSchema.parse({
      id: newId('trk'),
      kind: 'text',
      name: `Legendas ${tracks.length + 1}`,
    });
    run('Nova trilha de texto', [{ type: 'track.add', track: created, index: 0 }]);
    setTrackId(created.id);
    toast({ tone: 'ok', title: `Trilha "${created.name}" criada` });
  };

  const handleSeparateTracks = () => {
    const res = separateLyricsAndDialogueTracks(project);
    if (!res.commands.length || !res.dialogueTrackId) {
      toast({ tone: 'info', title: 'As letras e falas já estão separadas' });
      return;
    }
    run('Separar Letras e Falas em trilhas', res.commands);
    toast({
      tone: 'ok',
      title: 'Letras × Falas separadas em trilhas!',
      body: `${res.movedCount} fala(s) movida(s) para "Falas do Anime" para edição independente.`,
    });
  };

  if (!activeTrack) return null;

  return (
    <div className="space-y-1.5 pt-2">
      <div className="flex items-center gap-1">
        <select
          aria-label="Selecionar trilha de legendas"
          className="h-7 min-w-0 flex-1 rounded-control border border-line bg-base px-1.5 text-xs font-medium text-ink"
          value={activeTrack.id}
          onChange={(e) => setTrackId(e.target.value)}
        >
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}{t.hidden ? ' (oculta)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => run(activeTrack.hidden ? 'Mostrar trilha de texto' : 'Ocultar trilha de texto', [{ type: 'track.update', trackId: activeTrack.id, patch: { hidden: !activeTrack.hidden } }])}
          title={activeTrack.hidden ? 'Mostrar esta trilha de texto no vídeo' : 'Ocultar temporariamente esta trilha de texto'}
          className={`inline-flex size-7 shrink-0 items-center justify-center rounded-control border ${activeTrack.hidden ? 'border-warn/50 bg-warn/15 text-warn' : 'border-line bg-base text-ink-soft hover:text-ink'}`}
        >
          {activeTrack.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button
          type="button"
          onClick={addNewSubtitleHere}
          title="Inserir nova legenda editável na posição atual da agulha"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-control border border-violet/45 bg-violet/15 px-2 text-2xs font-medium text-ink hover:bg-violet/25"
        >
          <Plus size={12} />
          Legenda
        </button>
        <button
          type="button"
          onClick={addNewTextTrack}
          title="Criar uma nova trilha independente de texto/letras"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-control border border-line bg-base px-1.5 text-2xs text-muted hover:bg-raised hover:text-ink"
        >
          <Layers size={11} />
          +Trilha
        </button>
      </div>
      {canSeparate && (
        <button
          type="button"
          onClick={handleSeparateTracks}
          className="flex h-6 w-full items-center justify-center gap-1.5 rounded-control border border-azure/45 bg-azure/10 px-2 text-[11px] font-medium text-azure hover:bg-azure/20"
          title="Move automaticamente as falas dos personagens para uma trilha própria e deixa a letra da música isolada"
        >
          <Layers size={11} />
          Separar Letras da Música × Falas em 2 trilhas
        </button>
      )}
    </div>
  );
}

export function SubtitleBatchPowerBar({
  session,
  trackId,
  clips,
  selectedSubs,
  timelineBeatsS,
}: {
  session: ProjectSession;
  trackId: string;
  clips: Clip[];
  selectedSubs: Clip[];
  timelineBeatsS: number[];
}) {
  const { toast, platform } = useApp();
  const project = session.project;
  const select = useEditor((s) => s.select);
  const [bulkOpen, setBulkOpen] = useState(false);

  if (clips.length === 0) return null;

  const target = selectedSubs.length > 0 ? selectedSubs : clips;
  const targetIds = target.map((c) => c.id);
  const scopeLabel = selectedSubs.length > 0 ? `${selectedSubs.length} sel.` : `todas (${clips.length})`;
  const sampleClip = target[0]!;
  const allBehind = target.every((c) => Boolean(c.text?.behindCutout));

  const run = (label: string, cmds: Command[]) => {
    if (!cmds.length) return;
    session.history.transaction(label, cmds);
  };

  const handleExplodeWords = () => {
    const res = explodeSubtitlesToWords(project, targetIds, { beatsS: timelineBeatsS });
    if (!res.commands.length) {
      toast({ tone: 'info', title: 'Já estão em palavras curtas', body: 'Selecione frases com 2 ou mais palavras para explodir.' });
      return;
    }
    run('Explodir frases em palavras', res.commands);
    toast({ tone: 'ok', title: `${res.createdCount} palavras cinéticas criadas`, body: 'Cortes alinhados às batidas próximas (Ctrl+Z desfaz).' });
  };

  const handleMerge = () => {
    const ids = selectedSubs.length >= 2 ? selectedSubs.map((c) => c.id) : [];
    if (ids.length < 2) {
      toast({ tone: 'info', title: 'Selecione 2 ou mais legendas', body: 'Segure Shift ou Ctrl ao clicar nas palavras/legendas que deseja juntar numa frase.' });
      return;
    }
    const res = mergeSubtitlesIntoPhrase(project, ids);
    if (!res.commands.length || !res.mergedClipId) return;
    run('Juntar legendas em frase', res.commands);
    select([res.mergedClipId]);
    toast({ tone: 'ok', title: 'Legendas unidas em uma frase' });
  };

  const handleSplit = () => {
    const one = selectedSubs[0] ?? clips.find((c) => {
      const ph = useEditor.getState().playheadUs;
      return ph > c.timelineStartUs + 80_000 && ph < c.timelineStartUs + c.durationUs - 80_000;
    }) ?? sampleClip;
    const res = splitSubtitleAt(project, one.id, useEditor.getState().playheadUs);
    if (!res.commands.length || !res.createdClipIds) {
      toast({ tone: 'info', title: 'Legenda curta demais para dividir' });
      return;
    }
    run('Dividir legenda', res.commands);
    select([res.createdClipIds[0]]);
    toast({ tone: 'ok', title: 'Legenda dividida em duas' });
  };

  const handleCopyStyleToTrack = () => {
    const src = selectedSubs[0] ?? sampleClip;
    const others = clips.filter((c) => c.id !== src.id).map((c) => c.id);
    const cmds = copyClipStyleToSubtitles(project, src.id, others);
    if (!cmds.length) return;
    run('Copiar estilo para toda a trilha', cmds);
    toast({ tone: 'ok', title: `Estilo aplicado a ${cmds.length + 1} legendas` });
  };

  const handleClearTrack = async () => {
    if (platform && !(await platform.dialogs.confirm(`Apagar todas as ${clips.length} legendas desta trilha? (Ctrl+Z desfaz)`, 'Limpar trilha de legendas?'))) {
      return;
    }
    run('Limpar trilha de legendas', clearRange(project, trackId, 0, Number.MAX_SAFE_INTEGER));
    select([]);
  };

  return (
    <div className="space-y-1.5 rounded-control border border-line-soft bg-base/50 p-2 text-2xs">
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold text-ink-soft">Controle pós-geração ({scopeLabel})</span>
        <button
          type="button"
          onClick={() => setBulkOpen(true)}
          className="inline-flex h-6 items-center gap-1 rounded border border-violet/45 bg-violet/15 px-2 font-medium text-ink hover:bg-violet/25"
          title="Abrir editor de texto completo para trocar/corrigir toda a letra ou substituir palavras de uma vez"
        >
          <FileEdit size={11} />
          Editar letra inteira
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <select
          aria-label="Fonte em lote das legendas"
          value={sampleClip.text?.font ?? ''}
          onChange={(e) => {
            if (e.target.value) run(`Fonte ${e.target.value}`, patchSubtitlesStyle(project, targetIds, { font: e.target.value }));
          }}
          className="h-6 min-w-0 flex-1 rounded border border-line bg-panel px-1 text-2xs text-ink"
          title="Trocar apenas a fonte sem perder cores, brilho ou animações"
        >
          {LOCAL_FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <div className="flex items-center overflow-hidden rounded border border-line bg-panel">
          <button type="button" onClick={() => run('Diminuir fonte', patchSubtitlesStyle(project, targetIds, { sizeDelta: -6 }))} className="h-6 px-1.5 text-ink-soft hover:bg-raised" title="Diminuir tamanho">A-</button>
          <button type="button" onClick={() => run('Aumentar fonte', patchSubtitlesStyle(project, targetIds, { sizeDelta: 6 }))} className="h-6 border-l border-line-soft px-1.5 text-ink-soft hover:bg-raised" title="Aumentar tamanho">A+</button>
        </div>
        <input
          type="color"
          aria-label="Cor do texto em lote"
          title="Mudar cor principal do texto"
          value={sampleClip.text?.color ?? '#ffffff'}
          onChange={(e) => run('Cor das legendas', patchSubtitlesStyle(project, targetIds, { color: e.target.value }))}
          className="h-6 w-6 cursor-pointer rounded border border-line bg-panel p-0.5"
        />
        <div className="flex items-center overflow-hidden rounded border border-line bg-panel">
          {([['upper', 'AA', 'Converter para MAIÚSCULAS'], ['sentence', 'Aa', 'Primeira letra maiúscula'], ['lower', 'aa', 'Converter para minúsculas']] as const).map(([mode, lbl, tip]) => (
            <button
              key={mode}
              type="button"
              title={tip}
              onClick={() => run(`Caixa (${lbl})`, transformSubtitlesCase(project, targetIds, mode))}
              className="h-6 border-r border-line-soft px-1.5 text-muted last:border-r-0 hover:bg-raised hover:text-ink"
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <div className="flex items-center overflow-hidden rounded border border-line bg-panel">
          {([['top', 'Topo'], ['center', 'Centro'], ['bottom', 'Base']] as const).map(([z, lbl]) => (
            <button
              key={z}
              type="button"
              onClick={() => run(`Posição ${lbl}`, patchSubtitlesStyle(project, targetIds, { zone: z }))}
              className="h-6 border-r border-line-soft px-1.5 text-muted last:border-r-0 hover:bg-raised hover:text-ink"
            >
              {lbl}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleExplodeWords}
          title="Transforma frases em explosão palavra por palavra sincronizada (Kinetic Words)"
          className="inline-flex h-6 items-center gap-1 rounded border border-violet/40 bg-violet/10 px-1.5 text-ink-soft hover:bg-violet/20 hover:text-ink"
        >
          <Sparkles size={10} />
          Em palavras
        </button>
        <button
          type="button"
          onClick={handleMerge}
          title="Junta 2 ou mais palavras/legendas selecionadas (Shift+clique) em uma frase única"
          className="inline-flex h-6 items-center gap-1 rounded border border-line bg-panel px-1.5 text-ink-soft hover:bg-raised hover:text-ink"
        >
          <Merge size={10} />
          Juntar
        </button>
        <button
          type="button"
          onClick={handleSplit}
          title="Divide a legenda selecionada no cursor ou na metade"
          className="inline-flex h-6 items-center gap-1 rounded border border-line bg-panel px-1.5 text-ink-soft hover:bg-raised hover:text-ink"
        >
          <Scissors size={10} />
          Dividir
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {selectedSubs.length === 1 && clips.length > 1 && (
          <button
            type="button"
            onClick={handleCopyStyleToTrack}
            title="Copia fonte, cores, glow, contorno e posição desta legenda selecionada para todas da trilha"
            className="inline-flex h-6 items-center gap-1 rounded border border-azure/40 bg-azure/10 px-1.5 text-azure hover:bg-azure/20"
          >
            <Copy size={10} />
            Estilo → todas
          </button>
        )}
        <button
          type="button"
          onClick={() => run('Alternar texto atrás do personagem', patchSubtitlesStyle(project, targetIds, { behindCutout: !allBehind }))}
          title="Faz a letra passar atrás do recorte de personagem em V2 (Depth Text)"
          className={`inline-flex h-6 items-center gap-1 rounded border px-1.5 ${allBehind ? 'border-azure bg-azure/15 text-ink' : 'border-line bg-panel text-muted hover:text-ink'}`}
        >
          Atrás V2
        </button>
        <button
          type="button"
          onClick={() => void handleClearTrack()}
          title="Apagar todas as legendas desta trilha"
          className="ml-auto inline-flex h-6 items-center gap-1 rounded border border-line bg-panel px-1.5 text-muted hover:border-danger/50 hover:text-danger"
        >
          <Trash2 size={10} />
          Limpar
        </button>
      </div>

      {bulkOpen && (
        <BulkLyricsEditorDialog
          session={session}
          trackId={trackId}
          clips={target}
          isSelectionOnly={selectedSubs.length > 0}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
}

function BulkLyricsEditorDialog({
  session,
  trackId,
  clips,
  isSelectionOnly,
  onClose,
}: {
  session: ProjectSession;
  trackId: string;
  clips: Clip[];
  isSelectionOnly: boolean;
  onClose: () => void;
}) {
  const { toast } = useApp();
  const [draft, setDraft] = useState(() => formatSubtitlesForBulkEdit(clips));
  const [findStr, setFindStr] = useState('');
  const [replaceStr, setReplaceStr] = useState('');

  useEffect(() => {
    setDraft(formatSubtitlesForBulkEdit(clips));
  }, [clips]);

  const draftLines = draft.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);

  const applySearchReplace = () => {
    if (!findStr) return;
    const next = draft.split(findStr).join(replaceStr);
    setDraft(next);
  };

  const save = () => {
    const res = replaceSubtitlesTextBulk(
      session.project,
      trackId,
      draft,
      isSelectionOnly ? clips.map((c) => c.id) : undefined,
    );
    if (!res.commands.length) {
      onClose();
      return;
    }
    session.history.transaction('Editar letras em lote', res.commands);
    toast({
      tone: 'ok',
      title: 'Letras atualizadas!',
      body: `${res.updated} alterada(s)${res.added ? `, ${res.added} adicionada(s)` : ''}${res.removed ? `, ${res.removed} removida(s)` : ''}.`,
    });
    onClose();
  };

  return (
    <Dialog
      title={isSelectionOnly ? `Editar ${clips.length} legendas selecionadas` : `Editar letra / legendas da trilha (${clips.length} linhas)`}
      width="w-[680px]"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-2xs text-muted">
            {draftLines.length} linha(s) no editor · {clips.length} clipe(s) atuais (1 linha = 1 clipe, use &quot; / &quot; para quebra interna)
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={save}>Aplicar na timeline</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 text-xs">
        <p className="text-muted">
          Reescreva a letra livremente, cole outra tradução ou corrija palavras erradas de uma só vez mantendo os tempos e estilos visuais da timeline.
        </p>
        <div className="flex flex-wrap items-center gap-1.5 rounded-control border border-line-soft bg-base p-2">
          <input
            type="text"
            placeholder="Localizar palavra/trecho…"
            value={findStr}
            onChange={(e) => setFindStr(e.target.value)}
            className="h-7 min-w-[150px] flex-1 rounded border border-line bg-panel px-2 text-xs text-ink"
          />
          <input
            type="text"
            placeholder="Substituir por…"
            value={replaceStr}
            onChange={(e) => setReplaceStr(e.target.value)}
            className="h-7 min-w-[150px] flex-1 rounded border border-line bg-panel px-2 text-xs text-ink"
          />
          <Button size="sm" variant="secondary" disabled={!findStr} onClick={applySearchReplace}>
            Substituir tudo
          </Button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          className="w-full resize-y rounded-control border border-line bg-base p-3 font-mono text-xs leading-relaxed text-ink outline-none focus:border-violet"
          aria-label="Texto completo das legendas"
        />
      </div>
    </Dialog>
  );
}
