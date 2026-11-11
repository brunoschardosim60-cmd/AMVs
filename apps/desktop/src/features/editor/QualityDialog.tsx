import type { EpisodeAnalysis, EpisodeVision, MusicAnalysis } from '@amv/analysis';
import { evaluateAudiovisualQuality, type QualityDimension, type QualityIssue } from '@amv/automv';
import { formatTimecode } from '@amv/project';
import { Bot, Check, ChevronRight, ScanSearch } from 'lucide-react';
import { useMemo } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { Button, Dialog } from '../../ui/controls';
import { getPlayer } from './Preview';
import { useEditor } from './editorStore';

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
  const report = useMemo(() => {
    const episodes = new Map<string, EpisodeAnalysis>();
    const visions = new Map<string, EpisodeVision>();
    const music = new Map<string, MusicAnalysis>();
    for (const clip of project.clips) {
      if (!clip.assetId) continue;
      const runtime = session.assetRuntime(clip.assetId);
      if (runtime.episode) episodes.set(clip.assetId, runtime.episode);
      if (runtime.vision) visions.set(clip.assetId, runtime.vision);
      if (runtime.music) music.set(clip.assetId, runtime.music);
    }
    return evaluateAudiovisualQuality({ project, episodes, visions, music });
  }, [project, session]);

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

  const counts = {
    high: report.issues.filter((item) => item.severity === 'high').length,
    medium: report.issues.filter((item) => item.severity === 'medium').length,
    low: report.issues.filter((item) => item.severity === 'low').length,
  };

  return (
    <Dialog title="Avaliação audiovisual" onClose={onClose} width="w-[760px]">
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
