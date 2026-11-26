import {
  buildFullTimelineAutoRepair,
  buildProjectReadingSummary,
  harmonizeTextClipsWithScenes,
  type QualityDimension,
  type QualityIssue,
} from '@amv/automv';
import { formatTimecode } from '@amv/project';
import { Activity, Bot, Check, ChevronRight, ScanSearch, Sparkles, Wand2 } from 'lucide-react';
import { useMemo } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { Button, Dialog } from '../../ui/controls';
import { getPlayer } from './Preview';
import { useEditor } from './editorStore';
import { buildSessionReadingInputs } from './readingInputs';

const DIMENSION_LABELS: Record<QualityDimension, string> = {
  narrative: 'Narrativa',
  temporal: 'Continuidade temporal',
  visual: 'Continuidade visual',
  'music-sync': 'Sincronização musical',
  'cut-density': 'Densidade de cortes',
  'shot-variety': 'Variedade de planos',
  repetition: 'Repetição',
  'emotional-progression': 'Progressão emocional',
  effects: 'Efeitos',
  audio: 'Áudio',
  subtitles: 'Legendas',
  'preview-export': 'Preview / exportação',
};

const SEVERITY_LABELS = { high: 'Alta', medium: 'Média', low: 'Baixa' } as const;
const COVERAGE_LABELS = { checked: 'Verificado', partial: 'Parcial', unavailable: 'Sem dados' } as const;
const SEVERITY_STYLES = {
  high: 'border-danger/40 bg-danger/10 text-danger',
  medium: 'border-warn/40 bg-warn/10 text-warn',
  low: 'border-line bg-raised text-muted',
} as const;

export function QualityDialog({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  const project = session.project;
  const toast = useApp((state) => state.toast);
  const readingInputs = useMemo(() => buildSessionReadingInputs(session), [session, session.changes, project.assets]);
  const summary = useMemo(
    () => buildProjectReadingSummary({ project, ...readingInputs }),
    [project, readingInputs],
  );
  const report = summary.quality;
  const autoRepairPreview = useMemo(
    () => buildFullTimelineAutoRepair({ project, ...readingInputs }),
    [project, readingInputs],
  );
  const textHarmonizePreview = useMemo(
    () => harmonizeTextClipsWithScenes({ project, episodes: readingInputs.episodes }),
    [project, readingInputs.episodes],
  );

  const navigateTo = (item: QualityIssue) => {
    useEditor.getState().select(item.clipIds);
    useEditor.getState().setPlayhead(item.startUs);
    getPlayer(session).seek(item.startUs);
  };

  const askAssistant = (item: QualityIssue) => {
    const evidence = item.evidence.join('; ');
    useEditor.setState({
      selection: item.clipIds,
      playheadUs: item.startUs,
      assistantOpen: true,
      assistantDraft: `Analise este problema do meu AMV: ${item.type}. ${item.reason} Evidências: ${evidence}. Sugestão local: ${item.suggestion}. Proponha uma correção pequena para eu revisar; não altere o projeto sem aprovação.`,
    });
    onClose();
  };

  const applyFix = (item: QualityIssue) => {
    if (!item.fix) return;
    try {
      session.history.transaction(item.fix.label, item.fix.commands);
      toast({ tone: 'ok', title: 'Correção aplicada', body: 'A alteração pode ser desfeita com Ctrl+Z.' });
      onClose();
    } catch (error) {
      toast({ tone: 'warn', title: 'Não foi possível aplicar a correção', body: error instanceof Error ? error.message : String(error) });
    }
  };

  const applyFullAutoRepair = () => {
    if (!autoRepairPreview.commands.length) return;
    try {
      session.history.transaction('Auto-reparar leitura audiovisual', autoRepairPreview.commands);
      toast({
        tone: 'ok',
        title: `${autoRepairPreview.repairsApplied.length || autoRepairPreview.commands.length} reparo(s) aplicado(s)`,
        body: autoRepairPreview.repairsApplied.slice(0, 3).join(' · ') || 'Pode desfazer com Ctrl+Z.',
      });
    } catch (error) {
      toast({ tone: 'warn', title: 'Falha no auto-reparo', body: error instanceof Error ? error.message : String(error) });
    }
  };

  const applyTextHarmonize = () => {
    if (!textHarmonizePreview.commands.length) return;
    try {
      session.history.transaction('Harmonizar legendas com o vídeo', textHarmonizePreview.commands);
      toast({
        tone: 'ok',
        title: `${textHarmonizePreview.updatedCount} legenda(s) harmonizada(s)`,
        body: textHarmonizePreview.extendedForReading
          ? `${textHarmonizePreview.extendedForReading} tiveram o tempo alongado para leitura confortável.`
          : 'Cores, desvio do rosto e contraste ajustados.',
      });
    } catch (error) {
      toast({ tone: 'warn', title: 'Não foi possível harmonizar', body: error instanceof Error ? error.message : String(error) });
    }
  };

  const counts = {
    high: report.issues.filter((item) => item.severity === 'high').length,
    medium: report.issues.filter((item) => item.severity === 'medium').length,
    low: report.issues.filter((item) => item.severity === 'low').length,
  };

  const scoreTone = summary.score.total >= 82 ? 'text-ok' : summary.score.total >= 65 ? 'text-warn' : 'text-danger';

  return (
    <Dialog title="Central de leitura & qualidade audiovisual" onClose={onClose} width="w-[800px]">
      <section aria-label="Leitura geral do AMV" className="mb-4 rounded-control border border-violet/35 bg-base/80 p-3">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Nota de Direção</span>
            <div className="flex items-baseline gap-1">
              <span className={`tnum text-2xl font-extrabold ${scoreTone}`}>{Math.round(summary.score.total)}</span>
              <span className="text-xs text-muted">/ 100</span>
            </div>
          </div>
          <div className="grid min-w-[260px] flex-1 grid-cols-5 gap-2 text-2xs">
            {[
              { label: 'Técnica', val: summary.score.technical, max: 30 },
              { label: 'Sincronia', val: summary.score.sync, max: 25 },
              { label: 'Variedade', val: summary.score.diversity, max: 20 },
              { label: 'Arco 3 atos', val: summary.score.narrative, max: 15 },
              { label: 'Fusão', val: summary.score.multimodal, max: 10 },
            ].map((d) => (
              <div key={d.label} className="space-y-1">
                <div className="flex justify-between text-muted">
                  <span>{d.label}</span>
                  <span className="tnum font-semibold text-ink">{Math.round(d.val)}/{d.max}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                  <div className="h-full rounded-full bg-violet-strong" style={{ width: `${Math.min(100, Math.round((d.val / d.max) * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line-soft pt-3 text-2xs sm:grid-cols-4">
          <div className="rounded bg-raised/60 px-2.5 py-1.5">
            <span className="block text-muted">Cortes na batida</span>
            <span className="tnum text-xs font-semibold text-ink">{summary.beatLockedRate}% ({summary.beatLockedCuts}/{Math.max(0, summary.totalVideoClips - 1)})</span>
          </div>
          <div className="rounded bg-raised/60 px-2.5 py-1.5">
            <span className="block text-muted">Golpes sincronizados</span>
            <span className="tnum text-xs font-semibold text-ink">{summary.syncedHitPeaks} impacto(s)</span>
          </div>
          <div className="rounded bg-raised/60 px-2.5 py-1.5">
            <span className="block text-muted">Cenas únicas</span>
            <span className="tnum text-xs font-semibold text-ink">{summary.uniqueScenes} / {summary.totalVideoClips} clipes</span>
          </div>
          <div className="rounded bg-raised/60 px-2.5 py-1.5">
            <span className="block text-muted">Leitura das legendas</span>
            <span className="tnum text-xs font-semibold text-ink">
              {summary.textClipsCount ? `${summary.averageCps} chars/s` : 'Sem legendas'}
              {(summary.fastTextCount > 0 || summary.lowContrastOrFaceTextCount > 0) && (
                <span className="ml-1 text-warn">({summary.fastTextCount + summary.lowContrastOrFaceTextCount} alerta)</span>
              )}
            </span>
          </div>
        </div>

        {(autoRepairPreview.commands.length > 0 || textHarmonizePreview.commands.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-2.5">
            <Activity size={13} className="text-violet-strong" />
            <span className="text-2xs font-medium text-ink-soft">Melhorias automáticas disponíveis:</span>
            {autoRepairPreview.commands.length > 0 && (
              <Button size="sm" variant="primary" icon={<Sparkles size={13} />} onClick={applyFullAutoRepair}>
                Auto-reparar tudo ({autoRepairPreview.repairsApplied.length || autoRepairPreview.commands.length})
              </Button>
            )}
            {textHarmonizePreview.commands.length > 0 && (
              <Button size="sm" variant="secondary" icon={<Wand2 size={13} />} onClick={applyTextHarmonize}>
                Harmonizar legendas c/ vídeo ({textHarmonizePreview.updatedCount})
              </Button>
            )}
          </div>
        )}
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Duração analisada: {formatTimecode(report.durationUs, project.settings.fps)}</span>
        <span className="ml-auto flex gap-2">
          <span className="text-danger">{counts.high} alta</span>
          <span className="text-warn">{counts.medium} média</span>
          <span className="text-muted">{counts.low} baixa</span>
        </span>
      </div>

      <section aria-label="Cobertura da análise" className="mb-5">
        <h3 className="mb-2 text-xs font-semibold text-ink-soft">Cobertura e limites</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(report.coverage).map(([dimension, coverage]) => (
            <div key={dimension} className="rounded-control border border-line-soft bg-base px-2.5 py-2">
              <div className="flex items-center justify-between gap-2 text-2xs">
                <span className="font-medium text-ink-soft">{DIMENSION_LABELS[dimension as QualityDimension]}</span>
                <span className={coverage.status === 'checked' ? 'text-ok' : coverage.status === 'partial' ? 'text-warn' : 'text-faint'}>
                  {COVERAGE_LABELS[coverage.status]}
                </span>
              </div>
              <p className="mt-1 text-2xs leading-relaxed text-muted">{coverage.evidence.join(' · ')}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Problemas identificados">
        <h3 className="mb-2 text-xs font-semibold text-ink-soft">Pontos para revisar</h3>
        {report.issues.length === 0 ? (
          <div className="rounded-control border border-line-soft bg-base px-4 py-6 text-center">
            <Check className="mx-auto mb-2 text-ok" size={20} />
            <p className="text-sm font-medium">Nenhum problema objetivo encontrado</p>
            <p className="mt-1 text-xs text-muted">Isso não substitui uma revisão artística. Consulte a cobertura acima para ver o que os dados disponíveis permitiram avaliar.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {report.issues.map((item) => (
              <li key={item.id} className="rounded-control border border-line-soft bg-base p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-1.5 py-0.5 text-2xs ${SEVERITY_STYLES[item.severity]}`}>{SEVERITY_LABELS[item.severity]}</span>
                  <span className="text-2xs text-muted">{DIMENSION_LABELS[item.dimension]}</span>
                  <span className="tnum ml-auto text-2xs text-muted">
                    {formatTimecode(item.startUs, project.settings.fps)}
                    {item.endUs > item.startUs ? `–${formatTimecode(item.endUs, project.settings.fps)}` : ''}
                  </span>
                </div>
                <h4 className="mt-2 text-sm font-semibold">{item.type}</h4>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">{item.reason}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted"><strong className="font-medium text-ink-soft">Evidências:</strong> {item.evidence.join(' · ')}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted"><strong className="font-medium text-ink-soft">Sugestão:</strong> {item.suggestion}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" icon={<ChevronRight size={13} />} onClick={() => navigateTo(item)}>Ver trecho</Button>
                  <Button size="sm" icon={<Bot size={13} />} onClick={() => askAssistant(item)}>Pedir proposta à assistente</Button>
                  {item.fix && <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={() => applyFix(item)}>{item.fix.label}</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mt-4 flex items-start gap-2 border-t border-line-soft pt-3 text-2xs leading-relaxed text-muted">
        <ScanSearch className="mt-0.5 shrink-0" size={14} />
        A avaliação usa apenas análises já disponíveis na sessão e os dados da timeline. Não inicia processamento pesado nem mede o arquivo exportado.
      </p>
    </Dialog>
  );
}
