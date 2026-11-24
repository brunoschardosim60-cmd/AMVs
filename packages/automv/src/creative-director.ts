import type { ShotVision } from '@amv/analysis';
import { shotKey } from '@amv/analysis';
import { applyCommand, clipEndUs, sourceTimeAt, type Clip, type Command, type Project } from '@amv/project';
import { evaluateAudiovisualQuality, type QualityIssue, type QualityReport } from './quality.js';
import { autoRepairAssembly } from './auto-repair.js';
import type { EpisodeInput, GenerateOptions, GenerateResult, MusicInput } from './generate.js';
import { narrativeRoleLabel, type NarrativeBeat, type NarrativeRole } from './narrative.js';
import { STYLE_EDITORIAL_GOALS, type StyleId } from './styles.js';

const SECOND = 1_000_000;
const TRUSTED_VISION = 0.55;

export interface CreativeBrief {
  version: 1;
  style: StyleId;
  title: string;
  objective: string;
  priorities: string[];
  guardrails: string[];
  preferences: {
    durationS: number;
    intensity: 0 | 1 | 2 | 3;
    editorialDirection: 'cinematic' | 'balanced' | 'hype';
    organizationMode: 'chronological' | 'narrative' | 'free';
    focus: 'fight' | 'mix';
    voiceMoments: number;
  };
  arc: Array<{ role: NarrativeRole; label: string; startS: number; endS: number; intention: string; evidence: string }>;
  evidence: {
    episodes: number;
    scenes: number;
    localVisualScenes: number;
    semanticScenes: number;
    semanticCoverage: number;
    speechSegments: number;
    timedLyrics: number;
    bpm: number;
    bpmConfidence: number;
  };
  confidence: 'strong' | 'partial' | 'limited';
  limitations: string[];
}

export interface StoryboardScene {
  clipId: string;
  source: string;
  sourceTimeS: number;
  reason: string;
  action: string | null;
  emotion: string | null;
  characters: string[];
  semanticConfidence: number | null;
}

export interface StoryboardBeat {
  role: NarrativeRole;
  label: string;
  startS: number;
  endS: number;
  intention: string;
  musicalEvidence: string;
  scenes: StoryboardScene[];
}

export interface BriefAlignmentCheck {
  criterion: string;
  status: 'met' | 'review' | 'unknown';
  evidence: string;
}

export interface CreativeReview {
  commands: Command[];
  storyboard: StoryboardBeat[];
  quality: QualityReport;
  alignment: BriefAlignmentCheck[];
  repairsApplied: string[];
  generatedClipCount: number;
  generatedVideoClipCount: number;
}

export interface CreativeDirectorInput {
  project: Project;
  commands: Command[];
  brief: CreativeBrief;
  direction: NarrativeBeat[];
  summary: GenerateResult['summary'];
  episodes: EpisodeInput[];
  music: MusicInput;
}

function roleIntention(role: NarrativeRole, style: StyleId): string {
  const styleSpecific: Partial<Record<StyleId, Partial<Record<NarrativeRole, string>>>> = {
    hype: { opening: 'Apresentar o confronto e reservar os golpes mais fortes', build: 'Aumentar a pressão e preparar a troca de ataques', climax: 'Concentrar os impactos de maior energia', release: 'Dar espaço para reação ou mudança de ritmo', ending: 'Fechar com consequência visual, não apenas com o último corte' },
    rapido: { opening: 'Estabelecer o padrão de ritmo sem gastar todos os impactos', build: 'Aumentar a densidade de cortes com legibilidade', climax: 'Entregar os combos e acentos mais fortes', release: 'Interromper a velocidade para destacar o próximo impacto', ending: 'Encerrar com um golpe ou imagem que permaneça legível' },
    superacao: { opening: 'Apresentar o ponto de partida ou o obstáculo', build: 'Construir expectativa e preparação para a virada', climax: 'Reservar o auge visual para a virada musical', release: 'Mostrar reação ou consequência da mudança', ending: 'Sugerir conquista ou encerramento sem inventar contexto' },
    letra: { opening: 'Introduzir o tema da letra com texto legível', build: 'Acompanhar a progressão do verso e preparar a próxima frase', climax: 'Dar destaque à linha ou palavra de maior impacto', release: 'Abrir espaço para a leitura do próximo trecho', ending: 'Finalizar a frase sem cortar o tempo de leitura' },
    discurso: { opening: 'Apresentar a primeira ideia falada com contexto visual', build: 'Organizar as falas para construir a mensagem', climax: 'Dar prioridade à fala de maior impacto', release: 'Preservar pausas e compreensão', ending: 'Deixar a última fala concluir antes do encerramento' },
    emocional: { opening: 'Estabelecer ambiente e vínculo sem pressa', build: 'Aprofundar a progressão emocional com planos legíveis', climax: 'Reservar a expressão ou ação mais significativa', release: 'Permitir que a emoção assente', ending: 'Encerrar com uma imagem que tenha tempo de permanecer' },
  };
  const specific = styleSpecific[style]?.[role];
  if (specific) return specific;
  const fallback: Record<NarrativeRole, string> = {
    opening: 'Apresentar contexto',
    build: 'Construir expectativa',
    climax: 'Concentrar o momento de maior intensidade',
    release: 'Criar respiro',
    ending: 'Encerrar a progressão',
    development: 'Manter a progressão coerente',
  };
  return fallback[role];
}

function trustedVision(vision: ShotVision | undefined): vision is ShotVision & { confidence: number } {
  return typeof vision?.confidence === 'number' && Number.isFinite(vision.confidence)
    && vision.confidence >= TRUSTED_VISION && vision.confidence <= 1;
}

export function buildCreativeBrief(input: {
  style: StyleId;
  episodes: EpisodeInput[];
  music: MusicInput;
  options: Pick<GenerateOptions, 'durationS' | 'intensity' | 'editorialDirection' | 'organizationMode' | 'focus' | 'voiceMoments'>;
  direction: NarrativeBeat[];
  hasTimedLyrics?: boolean;
}): CreativeBrief {
  const intent = STYLE_EDITORIAL_GOALS[input.style];
  const scenes = input.episodes.flatMap((episode) => episode.analysis.shots.map((shot) => ({
    vision: episode.vision?.shots[shotKey(shot.startS)],
  })));
  const semanticScenes = scenes.filter(({ vision }) => trustedVision(vision)).length;
  const localVisualScenes = scenes.filter(({ vision }) => !!vision?.local).length;
  const sceneCount = scenes.length;
  const semanticCoverage = sceneCount ? semanticScenes / sceneCount : 0;
  const speechSegments = input.episodes.reduce((sum, episode) => sum + episode.analysis.speech.length, 0);
  const bpmConfidence = input.music.analysis.bpmConfidence;
  const styleEvidenceMissing = (input.style === 'letra' && !input.hasTimedLyrics)
    || (input.style === 'discurso' && speechSegments === 0);
  const hasVisualEvidence = semanticScenes > 0 || localVisualScenes > 0;
  const confidence = semanticCoverage >= 0.5 && bpmConfidence >= 0.5 && !styleEvidenceMissing
    ? 'strong'
    : hasVisualEvidence ? 'partial' : 'limited';
  const limitations: string[] = [];
  if (semanticCoverage < 0.5) limitations.push('A cobertura de rótulos semânticos confiáveis é parcial. Não afirmar continuidade de personagem, intenção ou consequência sem evidência.');
  if (localVisualScenes < sceneCount) limitations.push('Parte das cenas não tem descritores visuais locais; movimento e enquadramento podem não estar avaliados.');
  if (bpmConfidence < 0.5) limitations.push('A confiança da pulsação musical é baixa; tolerâncias de sincronização devem ser tratadas como aproximadas.');
  if (input.style === 'letra' && !input.hasTimedLyrics) limitations.push('Não foi fornecida letra sincronizada; o modo pode seguir a música, mas não validar correspondência entre palavra e imagem.');
  if (input.style === 'discurso' && speechSegments === 0) limitations.push('Nenhuma fala foi detectada; o objetivo de discurso não está sustentado pelo material analisado.');
  return {
    version: 1,
    style: input.style,
    title: intent.title,
    objective: intent.objective,
    priorities: [...intent.priorities],
    guardrails: [...intent.guardrails],
    preferences: {
      durationS: input.options.durationS,
      intensity: input.options.intensity,
      editorialDirection: input.options.editorialDirection ?? 'balanced',
      organizationMode: input.options.organizationMode ?? 'narrative',
      focus: input.options.focus ?? 'fight',
      voiceMoments: input.options.voiceMoments ?? 0,
    },
    arc: input.direction.map((beat) => ({
      role: beat.role,
      label: narrativeRoleLabel(beat.role),
      startS: beat.startS,
      endS: beat.endS,
      intention: roleIntention(beat.role, input.style),
      evidence: beat.reason,
    })),
    evidence: {
      episodes: input.episodes.length,
      scenes: sceneCount,
      localVisualScenes,
      semanticScenes,
      semanticCoverage: Math.round(semanticCoverage * 100),
      speechSegments,
      timedLyrics: input.hasTimedLyrics ? 1 : 0,
      bpm: Math.round(input.music.analysis.bpm),
      bpmConfidence: Math.round(bpmConfidence * 100),
    },
    confidence,
    limitations,
  };
}

function findSourceShot(episode: EpisodeInput | undefined, clip: Clip) {
  if (!episode) return undefined;
  const sourceMidS = sourceTimeAt(clip, clip.durationUs / 2) / SECOND;
  return episode.analysis.shots.find((shot) => sourceMidS >= shot.startS && sourceMidS < shot.endS)
    ?? episode.analysis.shots.find((shot) => sourceMidS >= shot.startS - 0.05 && sourceMidS <= shot.endS + 0.05);
}

export function buildEditorialStoryboard(input: {
  project: Project;
  commands: Command[];
  brief: CreativeBrief;
  direction: NarrativeBeat[];
  episodes: EpisodeInput[];
}): StoryboardBeat[] {
  const episodeById = new Map(input.episodes.map((episode) => [episode.assetId, episode]));
  const tracks = new Map(input.project.tracks.map((track) => [track.id, track]));
  const addedIds = new Set(input.commands.flatMap((command) => command.type === 'clip.add' ? [command.clip.id] : []));
  const projectVideoClips = input.project.clips
    .filter((clip) => addedIds.has(clip.id) && tracks.get(clip.trackId)?.kind === 'video' && clip.assetId)
    .sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  const videoClips = projectVideoClips.length
    ? projectVideoClips
    : input.commands.flatMap((command) => {
        if (command.type !== 'clip.add') return [];
        const track = tracks.get(command.clip.trackId);
        return track?.kind === 'video' && command.clip.assetId ? [command.clip] : [];
      }).sort((a, b) => a.timelineStartUs - b.timelineStartUs);
  const direction = input.direction.length ? input.direction : [{
    role: 'development' as const,
    startS: 0,
    endS: Math.max(0, ...videoClips.map((clip) => clipEndUs(clip) / SECOND)),
    section: 'não identificada',
    reason: 'Sem seções musicais suficientes para dividir a montagem.',
  }];
  return direction.map((beat) => {
    const scenes = videoClips
      .filter((clip) => clip.timelineStartUs < beat.endS * SECOND && clipEndUs(clip) > beat.startS * SECOND)
      .map((clip): StoryboardScene => {
        const episode = episodeById.get(clip.assetId!);
        const shot = findSourceShot(episode, clip);
        const vision = shot ? episode?.vision?.shots[shotKey(shot.startS)] : undefined;
        const trusted = trustedVision(vision);
        return {
          clipId: clip.id,
          source: episode?.name ?? clip.assetId!,
          sourceTimeS: sourceTimeAt(clip, clip.durationUs / 2) / SECOND,
          reason: clip.reason ?? 'Motivo editorial não registrado',
          action: trusted ? vision.action ?? null : null,
          emotion: trusted ? vision.emotion ?? null : null,
          characters: trusted ? vision.characters : [],
          semanticConfidence: trusted ? vision.confidence : null,
        };
      });
    return {
      role: beat.role,
      label: narrativeRoleLabel(beat.role),
      startS: beat.startS,
      endS: beat.endS,
      intention: roleIntention(beat.role, input.brief.style),
      musicalEvidence: beat.reason,
      scenes,
    };
  });
}

function issuePenalty(report: QualityReport): number {
  return report.issues.reduce((total, item) => total + (item.severity === 'high' ? 10 : item.severity === 'medium' ? 4 : 1), 0);
}

function buildBriefAlignment(input: {
  brief: CreativeBrief;
  summary: GenerateResult['summary'];
  videoClips: Clip[];
  textClips: Clip[];
  episodes: EpisodeInput[];
}): BriefAlignmentCheck[] {
  const checks: BriefAlignmentCheck[] = [];
  const { brief, summary, videoClips, textClips, episodes } = input;
  const episodeById = new Map(episodes.map((episode) => [episode.assetId, episode]));
  const sortedDurations = videoClips.map((clip) => clip.durationUs / SECOND).sort((a, b) => a - b);
  const medianDuration = sortedDurations.length ? sortedDurations[Math.floor(sortedDurations.length / 2)]! : 0;
  const roles = new Set(brief.arc.map((beat) => beat.role));
  const populatedBeats = brief.arc.filter((beat) =>
    videoClips.some((clip) => clip.timelineStartUs < beat.endS * SECOND && clipEndUs(clip) > beat.startS * SECOND),
  ).length;
  const musicalCoverage = brief.arc.length ? populatedBeats / brief.arc.length : 0;
  checks.push({
    criterion: 'Cobertura da estrutura musical',
    status: !brief.arc.length || !videoClips.length ? 'unknown' : musicalCoverage >= 0.8 ? 'met' : 'review',
    evidence: brief.arc.length
      ? populatedBeats + '/' + brief.arc.length + ' partes musicais têm planos de vídeo; ' + brief.evidence.bpm + ' BPM com ' + brief.evidence.bpmConfidence + '% de confiança.'
      : 'A análise não forneceu seções musicais suficientes para conferir cobertura.',
  });
  checks.push({
    criterion: 'Cobertura semântica das cenas',
    status: brief.evidence.semanticScenes > 0 ? (brief.evidence.semanticCoverage >= 50 ? 'met' : 'review') : 'unknown',
    evidence: brief.evidence.semanticScenes + '/' + brief.evidence.scenes + ' cenas têm rótulos semânticos confiáveis (' + brief.evidence.semanticCoverage + '%).',
  });
  if (brief.style === 'rapido') {
    checks.push({
      criterion: 'Cadência de impacto',
      status: videoClips.length ? (medianDuration <= 0.85 ? 'met' : 'review') : 'unknown',
      evidence: videoClips.length + ' planos; duração mediana de ' + medianDuration.toFixed(2) + ' s.',
    });
  } else if (brief.style === 'hype') {
    const climaxBeats = brief.arc.filter((beat) => beat.role === 'climax');
    const actionAtClimax = climaxBeats.length > 0 && videoClips.some((clip) => {
      if (!climaxBeats.some((beat) => clip.timelineStartUs < beat.endS * SECOND && clipEndUs(clip) > beat.startS * SECOND)) return false;
      const episode = episodeById.get(clip.assetId ?? '');
      if (!episode) return false;
      const sourceMidS = sourceTimeAt(clip, clip.durationUs / 2) / SECOND;
      const shot = episode.analysis.shots.find((item) => sourceMidS >= item.startS && sourceMidS < item.endS);
      return !!shot?.tags.some((tag) => ['ação', 'impacto', 'luta', 'combate', 'golpe'].includes(tag.toLocaleLowerCase('pt-BR')));
    });
    checks.push({
      criterion: 'Ação visual no clímax',
      status: actionAtClimax ? (summary.hitsSynced > 0 ? 'met' : 'review') : 'unknown',
      evidence: actionAtClimax
        ? 'Há pelo menos um plano classificado com ação/impacto durante a seção musical de clímax; ' + summary.hitsSynced + ' impacto(s) ficaram sincronizados.'
        : 'Não há evidência suficiente de um plano de ação no clímax. A seção musical sozinha não comprova um clímax visual.',
    });
  } else if (brief.style === 'superacao') {
    const hasArc = roles.has('opening') && (roles.has('build') || roles.has('development')) && roles.has('climax');
    checks.push({
      criterion: 'Estrutura musical disponível para a virada',
      status: hasArc ? 'review' : 'unknown',
      evidence: 'Papéis musicais encontrados: ' + ([...roles].join(', ') || 'nenhum') + '. A estrutura cria espaço para um arco, mas a análise atual não comprova obstáculo, transformação ou vitória nas imagens.',
    });
  } else if (brief.style === 'letra') {
    const lyricClips = textClips.filter((clip) => /letra da música|palavra da letra/i.test(clip.reason ?? '')).length;
    checks.push({
      criterion: 'Legendas da letra inseridas',
      status: brief.evidence.timedLyrics ? (lyricClips > 0 ? 'met' : 'review') : 'unknown',
      evidence: brief.evidence.timedLyrics ? lyricClips + ' clipes de letra foram inseridos.' : 'Nenhum arquivo de letra com tempo foi fornecido.',
    });
  } else if (brief.style === 'discurso') {
    checks.push({
      criterion: 'Falas disponíveis',
      status: summary.voices > 0 ? 'met' : 'review',
      evidence: summary.voices + ' falas foram incluídas na montagem.',
    });
  } else if (brief.style === 'emocional') {
    checks.push({
      criterion: 'Tempo para leitura dos planos',
      status: videoClips.length ? (medianDuration >= 1.2 ? 'met' : 'review') : 'unknown',
      evidence: videoClips.length + ' planos; duração mediana de ' + medianDuration.toFixed(2) + ' s.',
    });
  }
  return checks;
}

/**
 * Builds the editorial brief/storyboard, independently reviews the generated timeline,
 * and applies only narrowly allowlisted fixes when they improve the objective QA score.
 * It does not claim semantic narrative understanding where the visual evidence is absent.
 */
export function reviewGeneratedAssembly(input: CreativeDirectorInput): CreativeReview {
  const generatedClips = input.commands.flatMap((command) => command.type === 'clip.add' ? [command.clip] : []);
  const generatedIds = new Set(generatedClips.map((clip) => clip.id));
  const preview = applyCommand(input.project, {
    type: 'batch',
    label: 'Prévia da direção criativa',
    commands: input.commands,
  }).project;
  const scopedProject = { ...preview, clips: preview.clips.filter((clip) => generatedIds.has(clip.id)) };
  const qualityInputs = {
    episodes: new Map(input.episodes.map((episode) => [episode.assetId, episode.analysis])),
    visions: new Map(input.episodes.flatMap((episode) => episode.vision ? [[episode.assetId, episode.vision] as const] : [])),
    music: new Map([[input.music.assetId, input.music.analysis]]),
  };
  const initialQuality = evaluateAudiovisualQuality({ project: scopedProject, ...qualityInputs });
  let workingPreview = preview;
  let finalCommands = [...input.commands];
  let finalQuality = initialQuality;
  const repairsApplied: string[] = [];

  // Executa até 2 passadas de autocorreção (saltos de luminosidade, micro-cortes e sobreposição de legendas),
  // aceitando cada passada apenas quando reduz a penalidade objetiva de qualidade.
  for (let pass = 0; pass < 2; pass++) {
    const autoFixes = autoRepairAssembly(workingPreview, generatedIds, input.episodes, finalQuality);
    if (!autoFixes.commands.length) break;
    try {
      const repaired = applyCommand(workingPreview, {
        type: 'batch',
        label: `Correções automáticas da revisão (passada ${pass + 1})`,
        commands: autoFixes.commands,
      }).project;
      const repairedScope = { ...repaired, clips: repaired.clips.filter((clip) => generatedIds.has(clip.id)) };
      const repairedQuality = evaluateAudiovisualQuality({ project: repairedScope, ...qualityInputs });
      if (issuePenalty(repairedQuality) < issuePenalty(finalQuality)) {
        workingPreview = repaired;
        finalCommands = [...finalCommands, ...autoFixes.commands];
        finalQuality = repairedQuality;
        for (const label of autoFixes.repairsApplied) {
          if (!repairsApplied.includes(label)) repairsApplied.push(label);
        }
      } else {
        break;
      }
    } catch {
      // A falha de uma correção opcional nunca deve bloquear ou descartar a montagem original.
      break;
    }
  }

  const storyboard = buildEditorialStoryboard({
    project: workingPreview,
    commands: finalCommands,
    brief: input.brief,
    direction: input.direction,
    episodes: input.episodes,
  });
  const survivingGeneratedClips = workingPreview.clips.filter((clip) => generatedIds.has(clip.id));
  const finalVideoClips = survivingGeneratedClips.filter((clip) => workingPreview.tracks.some((track) => track.id === clip.trackId && track.kind === 'video'));
  const finalTextClips = survivingGeneratedClips.filter((clip) => workingPreview.tracks.some((track) => track.id === clip.trackId && track.kind === 'text'));
  const alignment = buildBriefAlignment({
    brief: input.brief,
    summary: input.summary,
    videoClips: finalVideoClips,
    textClips: finalTextClips,
    episodes: input.episodes,
  });
  return {
    commands: finalCommands,
    storyboard,
    quality: finalQuality,
    alignment,
    repairsApplied,
    generatedClipCount: survivingGeneratedClips.length,
    generatedVideoClipCount: finalVideoClips.length,
  };
}

export function qualityIssueSummary(issues: QualityIssue[]): { high: number; medium: number; low: number } {
  return {
    high: issues.filter((item) => item.severity === 'high').length,
    medium: issues.filter((item) => item.severity === 'medium').length,
    low: issues.filter((item) => item.severity === 'low').length,
  };
}
