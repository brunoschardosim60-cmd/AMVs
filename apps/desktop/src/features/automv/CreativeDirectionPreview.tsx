import {
  explainEditorialDecision,
  findAlternativeScenesForPhrase,
  NARRATIVE_MODEL_LABELS,
  type CreativeDirectionOverrides,
  type CreativeDirectionSession,
  type EditorialDecision,
  type NarrativeModelId,
  type SemanticAlignmentType,
} from '@amv/automv';
import { Check, HelpCircle, Lock, RefreshCw, Search, Sparkles, Unlock, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../ui/controls';

const ARCHETYPE_LABELS: Record<string, string> = {
  narrative: 'A. Narrativa',
  emotional: 'B. Emocional',
  combat: 'C. Combate',
  instrumental: 'D. Instrumental',
  hybrid: 'E. Híbrida',
};

const ALIGNMENT_LABELS: Record<SemanticAlignmentType, string> = {
  literal: 'Literal',
  metaphorical: 'Metafórica',
  emotional: 'Emocional',
  contextual: 'Contextual',
  intentional_contrast: 'Contraste intencional',
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export interface CreativeDirectionPreviewProps {
  creativeSession: CreativeDirectionSession;
  overrides: CreativeDirectionOverrides;
  onChangeOverrides: (next: CreativeDirectionOverrides) => void;
  onApproveAndGenerate: () => void;
  onBackToOptions: () => void;
  busy?: boolean;
}

export function CreativeDirectionPreview({
  creativeSession,
  overrides,
  onChangeOverrides,
  onApproveAndGenerate,
  onBackToOptions,
  busy = false,
}: CreativeDirectionPreviewProps) {
  const { plan, solution, qualityReview, musicUnderstanding, scenes } = creativeSession;
  const scenesById = useMemo(() => new Map(scenes.map((s) => [s.sceneId, s])), [scenes]);
  const [expandedExplanationSlot, setExpandedExplanationSlot] = useState<number | null>(null);
  const [phraseQuery, setPhraseQuery] = useState('');
  const [allowContrastSearch, setAllowContrastSearch] = useState(false);
  const [targetSlotForPhrase, setTargetSlotForPhrase] = useState<number>(0);

  const phraseResults = useMemo(() => {
    if (!phraseQuery.trim()) return [];
    return findAlternativeScenesForPhrase({
      phraseText: phraseQuery.trim(),
      scenes,
      allowIntentionalContrast: allowContrastSearch,
      limit: 5,
    });
  }, [phraseQuery, scenes, allowContrastSearch]);

  const allDialogueScenes = useMemo(
    () => scenes.filter((s) => !s.excluded && s.context.hasDialogue && s.context.dialogueText),
    [scenes],
  );

  const updateOverride = (patch: Partial<CreativeDirectionOverrides>) => {
    onChangeOverrides({ ...overrides, ...patch });
  };

  const toggleLockSlot = (decision: EditorialDecision) => {
    const key = `slot:${decision.slotIndex}`;
    const currentLocks = { ...(overrides.lockedScenes ?? {}) };
    if (currentLocks[key]) {
      delete currentLocks[key];
    } else {
      currentLocks[key] = decision.selectedSceneId;
    }
    updateOverride({ lockedScenes: currentLocks });
  };

  const replaceSlotScene = (slotIndex: number, sceneId: string) => {
    const key = `slot:${slotIndex}`;
    updateOverride({
      lockedScenes: {
        ...(overrides.lockedScenes ?? {}),
        [key]: sceneId,
      },
    });
  };

  const togglePreservedDialogue = (sceneId: string) => {
    const current = new Set(overrides.preservedDialogueSceneIds ?? plan.preservedDialogues.map((d) => d.sceneId));
    if (current.has(sceneId)) current.delete(sceneId);
    else current.add(sceneId);
    updateOverride({ preservedDialogueSceneIds: [...current] });
  };

  const describeSceneShort = (sceneId: string) => {
    const sc = scenesById.get(sceneId);
    if (!sc) return sceneId;
    return `${sc.sourceEpisode} · ${mmss(sc.startTime)}–${mmss(sc.endTime)} (${sc.actions.slice(0, 2).join(', ')})`;
  };

  const preservedIds = new Set(overrides.preservedDialogueSceneIds ?? plan.preservedDialogues.map((d) => d.sceneId));

  return (
    <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1 text-xs">
      {/* 1. Ideia Central + Qualidade Global Independente */}
      <section className="rounded-lg border border-violet/40 bg-violet/10 p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-violet px-2.5 py-0.5 text-[11px] font-semibold text-white">
                <Sparkles size={12} /> Creative Direction Preview
              </span>
              <span className="rounded bg-base/80 px-2 py-0.5 text-[11px] font-medium text-violet-strong">
                Música: {ARCHETYPE_LABELS[musicUnderstanding.archetype] ?? musicUnderstanding.archetype}
              </span>
              <span className="rounded bg-base/80 px-2 py-0.5 text-[11px] text-ink-soft">
                Emoção: <strong>{plan.predominantEmotion}</strong>
              </span>
              <span className="rounded bg-base/80 px-2 py-0.5 text-[11px] text-muted">
                Confiança: {Math.round(plan.confidence * 100)}%
              </span>
            </div>
            <h3 className="mt-2 text-sm font-semibold text-ink">{plan.centralIdea}</h3>
            <p className="mt-1 text-2xs text-ink-soft">{plan.narrativeModelReason}</p>
          </div>
          <div className="shrink-0 rounded-md border border-violet/45 bg-base/90 px-3 py-2 text-center">
            <span className="block text-[10px] uppercase tracking-wider text-muted">Qualidade Global</span>
            <strong className="tnum text-lg font-bold text-violet-strong">{qualityReview.overallScore.toFixed(0)}/100</strong>
            <span className={`block text-[10px] font-medium ${qualityReview.verdict === 'approved' ? 'text-ok' : 'text-warn'}`}>
              {qualityReview.verdict === 'approved' ? 'Aprovado' : qualityReview.verdict === 'needs_revision' ? 'Revisão sugerida' : 'Requer ajuste'}
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-1.5 text-center text-[10px] sm:grid-cols-8">
          {[
            ['Narrativa', qualityReview.dimensions.narrativeCoherence],
            ['Música↔Img', qualityReview.dimensions.musicImageAlignment],
            ['Cont. Visual', qualityReview.dimensions.visualContinuity],
            ['Cont. Emoc.', qualityReview.dimensions.emotionalContinuity],
            ['Respiração', qualityReview.dimensions.rhythmAndDynamics],
            ['Cortes', qualityReview.dimensions.cutQuality],
            ['Variedade', qualityReview.dimensions.visualVariety],
            ['Final', qualityReview.dimensions.endingQuality],
          ].map(([label, val]) => (
            <div key={String(label)} className="rounded bg-base/75 px-1.5 py-1">
              <span className="block truncate text-muted">{label}</span>
              <strong className="tnum text-ink">{Number(val).toFixed(0)}</strong>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Controles Diretos de Direção Editorial */}
      <section className="grid grid-cols-1 gap-2.5 rounded-md border border-line-soft bg-panel/60 p-3 md:grid-cols-4">
        <label className="space-y-1">
          <span className="block text-[11px] font-medium text-ink-soft">Estratégia narrativa</span>
          <select
            aria-label="Estratégia narrativa"
            className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
            value={overrides.narrativeModel ?? plan.narrativeModel}
            onChange={(e) => updateOverride({ narrativeModel: e.target.value as NarrativeModelId })}
          >
            {(Object.entries(NARRATIVE_MODEL_LABELS) as Array<[NarrativeModelId, string]>).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-[11px] font-medium text-ink-soft">Relação música-imagem</span>
          <select
            aria-label="Relação música-imagem"
            className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
            value={overrides.preferredAlignmentType ?? ''}
            onChange={(e) => updateOverride({ preferredAlignmentType: (e.target.value || undefined) as SemanticAlignmentType | undefined })}
          >
            <option value="">Automática (contextual)</option>
            {(Object.entries(ALIGNMENT_LABELS) as Array<[SemanticAlignmentType, string]>).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-[11px] font-medium text-ink-soft">Ajuste de intensidade</span>
          <select
            aria-label="Ajuste fino de intensidade"
            className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink"
            value={String(overrides.intensityBias ?? 0)}
            onChange={(e) => updateOverride({ intensityBias: Number(e.target.value) as -1 | 0 | 1 })}
          >
            <option value="-1">-1 · Mais respiração cinematográfica</option>
            <option value="0">0 · Equilíbrio do diretor</option>
            <option value="1">+1 · Mais impacto e cortes</option>
          </select>
        </label>

        <div className="flex items-end gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 flex-1"
            icon={<RefreshCw size={13} />}
            onClick={() => updateOverride({ proposalVariant: (overrides.proposalVariant ?? 0) + 1 })}
          >
            Solicitar nova proposta
          </Button>
        </div>
      </section>

      {/* 3. Abertura, Clímax e Encerramento Planejados */}
      <section className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <div className="rounded-md border border-line-soft p-2.5">
          <p className="text-[11px] font-semibold text-violet-strong">1. Abertura sugerida</p>
          {plan.openingSelection ? (
            <>
              <p className="mt-1 font-medium text-ink">{describeSceneShort(plan.openingSelection.sceneId)}</p>
              <p className="mt-0.5 text-2xs text-muted">{plan.openingSelection.reason}</p>
              <select
                aria-label="Escolher outra abertura"
                className="mt-2 h-7 w-full rounded-control border border-line bg-base px-1.5 text-2xs text-ink"
                value={overrides.openingSceneId ?? plan.openingSelection.sceneId}
                onChange={(e) => updateOverride({ openingSceneId: e.target.value })}
              >
                <option value={plan.openingSelection.sceneId}>Atual · {describeSceneShort(plan.openingSelection.sceneId)}</option>
                {plan.openingSelection.alternatives.map((altId) => (
                  <option key={altId} value={altId}>Alternativa · {describeSceneShort(altId)}</option>
                ))}
              </select>
            </>
          ) : (
            <p className="mt-1 text-2xs text-muted">Sem abertura dedicada.</p>
          )}
        </div>

        <div className="rounded-md border border-line-soft p-2.5">
          <p className="text-[11px] font-semibold text-violet-strong">2. Clímax planejado</p>
          {plan.climaxSelection ? (
            <>
              <p className="mt-1 font-medium text-ink">{describeSceneShort(plan.climaxSelection.sceneId)}</p>
              <p className="mt-0.5 text-2xs text-muted">{plan.climaxSelection.reason}</p>
              <select
                aria-label="Mudar o clímax"
                className="mt-2 h-7 w-full rounded-control border border-line bg-base px-1.5 text-2xs text-ink"
                value={overrides.climaxSceneId ?? plan.climaxSelection.sceneId}
                onChange={(e) => updateOverride({ climaxSceneId: e.target.value })}
              >
                <option value={plan.climaxSelection.sceneId}>Atual · {describeSceneShort(plan.climaxSelection.sceneId)}</option>
                {plan.climaxSelection.alternatives.map((altId) => (
                  <option key={altId} value={altId}>Alternativa · {describeSceneShort(altId)}</option>
                ))}
              </select>
            </>
          ) : (
            <p className="mt-1 text-2xs text-muted">Sem clímax dedicado.</p>
          )}
        </div>

        <div className="rounded-md border border-line-soft p-2.5">
          <p className="text-[11px] font-semibold text-violet-strong">3. Encerramento intencional</p>
          <p className="mt-1 font-medium text-ink">
            {plan.endingStrategy.sceneId ? describeSceneShort(plan.endingStrategy.sceneId) : plan.endingStrategy.kind}
          </p>
          <p className="mt-0.5 text-2xs text-muted">{plan.endingStrategy.reason}</p>
          {plan.endingStrategy.alternatives.length > 0 && (
            <select
              aria-label="Mudar o encerramento"
              className="mt-2 h-7 w-full rounded-control border border-line bg-base px-1.5 text-2xs text-ink"
              value={overrides.endingSceneId ?? plan.endingStrategy.sceneId ?? ''}
              onChange={(e) => updateOverride({ endingSceneId: e.target.value || undefined })}
            >
              {plan.endingStrategy.sceneId && (
                <option value={plan.endingStrategy.sceneId}>Atual · {describeSceneShort(plan.endingStrategy.sceneId)}</option>
              )}
              {plan.endingStrategy.alternatives.map((altId) => (
                <option key={altId} value={altId}>Alternativa · {describeSceneShort(altId)}</option>
              ))}
            </select>
          )}
        </div>
      </section>

      {/* 4. Momentos Musicais, Respiração e Preservação de Diálogos */}
      <section className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <div className="rounded-md border border-line-soft p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold text-ink-soft">
            Momentos musicais &amp; respiração ({plan.keyMusicalMoments.length})
          </p>
          <ul className="max-h-32 space-y-1 overflow-y-auto text-2xs text-muted">
            {plan.keyMusicalMoments.map((m, idx) => (
              <li key={`${m.timelineS}:${idx}`}>
                <span className="tnum font-semibold text-ink">{mmss(m.timelineS)}</span> · {m.description}
              </li>
            ))}
            {plan.breathingZones.map((z, idx) => (
              <li key={`bz:${idx}`} className="text-azure">
                <span className="tnum font-semibold">{mmss(z.startTime)}–{mmss(z.endTime)}</span> · {z.reason}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-line-soft p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold text-ink-soft">
            Falas dos personagens a preservar ({allDialogueScenes.length})
          </p>
          {allDialogueScenes.length > 0 ? (
            <ul className="max-h-32 space-y-1 overflow-y-auto text-2xs">
              {allDialogueScenes.slice(0, 8).map((sc) => (
                <li key={sc.sceneId}>
                  <label className="flex items-center gap-2 text-ink-soft">
                    <input
                      type="checkbox"
                      className="accent-violet"
                      checked={preservedIds.has(sc.sceneId)}
                      onChange={() => togglePreservedDialogue(sc.sceneId)}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <strong>{sc.sourceEpisode} ({mmss(sc.startTime)}):</strong> &ldquo;{sc.context.dialogueText}&rdquo;
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-2xs text-muted">Nenhuma fala textual detectada nos episódios selecionados.</p>
          )}
        </div>
      </section>

      {/* 5. Consulta Interativa: "Encontre outra cena que combine melhor com essa frase" */}
      <section className="rounded-md border border-azure/35 bg-azure/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Search size={13} className="text-azure" />
            Encontrar outra cena que combine melhor com uma frase
          </span>
          <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
            <input
              type="checkbox"
              className="accent-violet"
              checked={allowContrastSearch}
              onChange={(e) => setAllowContrastSearch(e.target.checked)}
            />
            Permitir contraste dramático intencional
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="text"
            value={phraseQuery}
            onChange={(e) => setPhraseQuery(e.target.value)}
            placeholder="Digite um verso da música ou ideia dramática (ex.: mesmo ferido vou continuar de pé)..."
            className="h-8 min-w-[240px] flex-1 rounded-control border border-line bg-base px-2.5 text-xs text-ink"
          />
          <select
            aria-label="Trecho alvo para aplicar a cena"
            className="h-8 rounded-control border border-line bg-base px-2 text-2xs text-ink"
            value={targetSlotForPhrase}
            onChange={(e) => setTargetSlotForPhrase(Number(e.target.value))}
          >
            {solution.decisions.map((d) => (
              <option key={d.slotIndex} value={d.slotIndex}>
                Aplicar no corte #{d.slotIndex + 1} ({mmss(d.startTime)}–{mmss(d.endTime)})
              </option>
            ))}
          </select>
        </div>
        {phraseResults.length > 0 && (
          <ul className="mt-2.5 space-y-1.5">
            {phraseResults.map((item) => (
              <li key={item.scene.sceneId} className="flex items-center justify-between gap-2 rounded border border-line-soft bg-base/85 px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">
                    {item.scene.sourceEpisode} ({mmss(item.scene.startTime)}–{mmss(item.scene.endTime)})
                  </span>
                  <span className="ml-2 rounded bg-violet/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-strong">
                    {ALIGNMENT_LABELS[item.alignment.alignmentType]} · {item.combinedScore.toFixed(0)}/100
                  </span>
                  <p className="mt-0.5 truncate text-2xs text-muted">{item.alignment.explanation}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => replaceSlotScene(targetSlotForPhrase, item.scene.sceneId)}
                >
                  Usar no corte #{targetSlotForPhrase + 1}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 6. Decisões Editoriais Corte a Corte (Combate, Emoção, Letras, Travas e "Por que você escolheu essa cena?") */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-ink">
            Plano de Edição Global ({solution.decisions.length} decisões · média {solution.averageScore.toFixed(0)}/100)
          </h4>
          <span className="text-2xs text-muted">Trave, substitua ou inspecione o motivo real de cada corte</span>
        </div>

        <div className="space-y-1.5">
          {solution.decisions.map((d) => {
            const sc = scenesById.get(d.selectedSceneId);
            const isLocked = Boolean(overrides.lockedScenes?.[`slot:${d.slotIndex}`]);
            const isExpanded = expandedExplanationSlot === d.slotIndex;
            return (
              <div
                key={d.slotIndex}
                className={`rounded-md border p-2.5 ${isLocked ? 'border-violet bg-violet/10' : 'border-line-soft bg-base/60'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="tnum font-semibold text-ink">
                        #{d.slotIndex + 1} · {mmss(d.startTime)}–{mmss(d.endTime)}
                      </span>
                      <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-soft">
                        {d.episodeName} ({mmss(d.sourceStartTime)})
                      </span>
                      <span className="rounded bg-violet/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-strong">
                        {ALIGNMENT_LABELS[d.semanticAlignment.alignmentType]} · {d.score.toFixed(0)}/100
                      </span>
                      {d.isBreathingHold && (
                        <span className="rounded bg-azure/20 px-1.5 py-0.5 text-[10px] text-azure">
                          Respiração longa
                        </span>
                      )}
                      {d.continuityWithPrevious?.relationKind === 'combat_chain' || d.continuityWithPrevious?.relationKind === 'cross_episode_match' ? (
                        <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[10px] text-ok">
                          Cadeia coreográfica
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-2xs text-muted">{d.musicalRelationship}</p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {d.alternatives.length > 0 && (
                      <select
                        aria-label={`Substituir cena do corte ${d.slotIndex + 1}`}
                        className="h-7 max-w-[185px] rounded-control border border-line bg-base px-1.5 text-2xs text-ink"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) replaceSlotScene(d.slotIndex, e.target.value);
                        }}
                      >
                        <option value="">Substituir cena…</option>
                        {d.alternatives.map((alt) => (
                          <option key={alt.sceneId} value={alt.sceneId}>
                            {alt.episodeName} {mmss(alt.startTime)} ({alt.score.toFixed(0)} pts)
                          </option>
                        ))}
                      </select>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleLockSlot(d)}
                      className={`inline-flex h-7 items-center gap-1 rounded-control border px-2 text-2xs font-medium ${
                        isLocked ? 'border-violet bg-violet text-white' : 'border-line bg-base text-ink-soft hover:text-ink'
                      }`}
                      title={isLocked ? 'Destravar esta cena' : 'Travar esta cena na montagem'}
                    >
                      {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
                      {isLocked ? 'Travada' : 'Travar'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedExplanationSlot(isExpanded ? null : d.slotIndex)}
                      className="inline-flex h-7 items-center gap-1 rounded-control border border-line bg-base px-2 text-2xs text-ink-soft hover:text-ink"
                    >
                      <HelpCircle size={11} />
                      Por que escolheu?
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <pre className="mt-2 whitespace-pre-wrap rounded border border-line-soft bg-panel p-2.5 font-sans text-2xs text-ink-soft">
                    {explainEditorialDecision(d, sc)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 7. Alertas da Avaliação Global Independente */}
      {qualityReview.findings.length > 0 && (
        <section className="rounded-md border border-warn/35 bg-warn/10 p-3">
          <p className="font-semibold text-ink">Observações do Avaliador Global Independente</p>
          <ul className="mt-1.5 space-y-1 text-2xs text-ink-soft">
            {qualityReview.findings.map((f, idx) => (
              <li key={`${f.code}:${idx}`}>
                • <strong>[{f.severity.toUpperCase()}] {mmss(f.startTime)}:</strong> {f.explanation} <em>({f.replanSuggestion})</em>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Rodapé interno rápido */}
      <div className="flex items-center justify-end gap-2 border-t border-line-soft pt-3">
        <Button variant="ghost" disabled={busy} onClick={onBackToOptions}>
          Voltar às opções
        </Button>
        <Button
          variant="primary"
          icon={busy ? <Wand2 size={15} /> : <Check size={15} />}
          disabled={busy}
          onClick={onApproveAndGenerate}
        >
          Aprovar plano e gerar AMV
        </Button>
      </div>
    </div>
  );
}
