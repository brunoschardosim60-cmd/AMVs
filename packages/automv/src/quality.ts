import type { EpisodeAnalysis, EpisodeVision, MusicAnalysis } from '@amv/analysis';
import { clipEndUs, sourceTimeAt, type Clip, type Command, type Project } from '@amv/project';

export type QualitySeverity = 'low' | 'medium' | 'high';
export type QualityDimension =
  | 'narrative'
  | 'temporal'
  | 'visual'
  | 'music-sync'
  | 'cut-density'
  | 'shot-variety'
  | 'repetition'
  | 'emotional-progression'
  | 'effects'
  | 'audio'
  | 'subtitles'
  | 'preview-export';

export interface QualityFix {
  label: string;
  commands: Command[];
}

export interface QualityIssue {
  id: string;
  startUs: number;
  endUs: number;
  dimension: QualityDimension;
  type: string;
  severity: QualitySeverity;
  evidence: string[];
  reason: string;
  suggestion: string;
  clipIds: string[];
  fix?: QualityFix;
}

export interface QualityCoverage {
  status: 'checked' | 'partial' | 'unavailable';
  evidence: string[];
}

export interface QualityReport {
  durationUs: number;
  issues: QualityIssue[];
  coverage: Record<QualityDimension, QualityCoverage>;
}

export interface QualityInputs {
  project: Project;
  episodes: ReadonlyMap<string, EpisodeAnalysis>;
  visions?: ReadonlyMap<string, EpisodeVision>;
  music?: ReadonlyMap<string, MusicAnalysis>;
}

const DIMENSIONS: QualityDimension[] = [
  'narrative', 'temporal', 'visual', 'music-sync', 'cut-density', 'shot-variety',
  'repetition', 'emotional-progression', 'effects', 'audio', 'subtitles', 'preview-export',
];

const dimensionLabel: Record<QualityDimension, string> = {
  narrative: 'coerência narrativa',
  temporal: 'continuidade temporal',
  visual: 'continuidade visual',
  'music-sync': 'sincronização musical',
  'cut-density': 'densidade de cortes',
  'shot-variety': 'variedade de planos',
  repetition: 'repetição de cenas',
  'emotional-progression': 'progressão emocional e clímax',
  effects: 'uso de efeitos',
  audio: 'áudio',
  subtitles: 'legendas',
  'preview-export': 'preview e exportação',
};

function issue(
  dimension: QualityDimension,
  startUs: number,
  endUs: number,
  severity: QualitySeverity,
  type: string,
  evidence: string[],
  reason: string,
  suggestion: string,
  clipIds: string[],
  fix?: QualityFix,
): QualityIssue {
  const start = Math.max(0, Math.round(startUs));
  const end = Math.max(start, Math.round(endUs));
  return {
    id: `${dimension}:${start}:${clipIds.join(',')}:${type}`,
    startUs: start,
    endUs: end,
    dimension,
    type,
    severity,
    evidence,
    reason,
    suggestion,
    clipIds,
    ...(fix ? { fix } : {}),
  };
}

function activeClips(project: Project, kind: 'video' | 'audio' | 'text'): Clip[] {
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  const anyAudioSolo = project.tracks.some((track) => track.kind === 'audio' && track.solo);
  return project.clips.filter((clip) => {
    const track = tracks.get(clip.trackId);
    return track?.kind === kind
      && (kind === 'audio' || !track.hidden)
      && !track.muted
      && (kind !== 'audio' || !anyAudioSolo || track.solo);
  });
}

function shotFor(analysis: EpisodeAnalysis | undefined, clip: Clip) {
  if (!analysis) return undefined;
  const sourceStartUs = sourceTimeAt(clip, 0);
  const sourceEndUs = sourceTimeAt(clip, clip.durationUs);
  const sourceMinUs = Math.min(sourceStartUs, sourceEndUs);
  const sourceMaxUs = Math.max(sourceStartUs, sourceEndUs);
  const midpoint = (sourceMinUs + sourceMaxUs) / 2_000_000;
  return analysis.shots.find((shot) => midpoint >= shot.startS && midpoint < shot.endS)
    ?? analysis.shots.find((shot) => shot.startS < sourceMaxUs / 1e6 && shot.endS > sourceMinUs / 1e6);
}

function clipMusicTime(clip: Clip, timelineUs: number): number {
  return sourceTimeAt(clip, timelineUs - clip.timelineStartUs) / 1e6;
}

function nearestDistance(time: number, marks: number[]): number {
  return marks.reduce((distance, mark) => Math.min(distance, Math.abs(mark - time)), Number.POSITIVE_INFINITY);
}

function overlaps(a: Clip, b: Clip): number {
  return Math.max(0, Math.min(clipEndUs(a), clipEndUs(b)) - Math.max(a.timelineStartUs, b.timelineStartUs));
}

function makeCoverage(): Record<QualityDimension, QualityCoverage> {
  return {
    narrative: { status: 'unavailable', evidence: [] },
    temporal: { status: 'unavailable', evidence: [] },
    visual: { status: 'unavailable', evidence: [] },
    'music-sync': { status: 'unavailable', evidence: [] },
    'cut-density': { status: 'unavailable', evidence: [] },
    'shot-variety': { status: 'unavailable', evidence: [] },
    repetition: { status: 'unavailable', evidence: [] },
    'emotional-progression': { status: 'unavailable', evidence: [] },
    effects: { status: 'unavailable', evidence: [] },
    audio: { status: 'unavailable', evidence: [] },
    subtitles: { status: 'unavailable', evidence: [] },
    'preview-export': { status: 'unavailable', evidence: [] },
  };
}

export function evaluateAudiovisualQuality(input: QualityInputs): QualityReport {
  const { project } = input;
  const video = activeClips(project, 'video').filter((clip) => clip.assetId);
  const audio = activeClips(project, 'audio').filter((clip) => clip.assetId);
  const text = activeClips(project, 'text').filter((clip) => clip.text);
  const durationUs = Math.max(0, ...project.clips.map(clipEndUs));
  const coverage = makeCoverage();
  const issues: QualityIssue[] = [];
  const episodeAssets = new Set(video.map((clip) => clip.assetId!).filter((id) => input.episodes.has(id)));
  const musicAssets = new Set(audio.map((clip) => clip.assetId!).filter((id) => input.music?.has(id)));
  const hasLocalVision = [...episodeAssets].some((id) => Object.values(input.visions?.get(id)?.shots ?? {}).some((shot) => shot.local));

  coverage.temporal = { status: video.length ? 'checked' : 'unavailable', evidence: video.length ? [`${video.length} clipes visuais na timeline`] : ['Nenhum clipe visual na timeline'] };
  coverage.visual = {
    status: episodeAssets.size ? (hasLocalVision ? 'checked' : 'partial') : 'unavailable',
    evidence: episodeAssets.size ? [`Análise de episódio disponível para ${episodeAssets.size} asset(s)`, hasLocalVision ? 'Descritores visuais locais disponíveis' : 'Descritores de cor/enquadramento local não estão disponíveis'] : ['Análises dos episódios usados não estão carregadas'],
  };
  coverage['music-sync'] = {
    status: musicAssets.size ? 'partial' : 'unavailable',
    evidence: musicAssets.size ? [`Análise musical disponível para ${musicAssets.size} asset(s)`, 'Verifica cortes cuja justificativa declara sincronização; não exige corte em toda batida'] : ['Não há análise musical carregada para áudio usado na timeline'],
  };
  coverage['cut-density'] = { status: video.length > 1 ? 'partial' : 'unavailable', evidence: video.length > 1 ? [`${video.length} clipes visuais`, 'Identifica sequências de clipes com menos de 180 ms; não impõe uma cadência universal'] : ['Poucos clipes visuais para avaliar a cadência'] };
  coverage['shot-variety'] = { status: hasLocalVision ? 'partial' : 'unavailable', evidence: hasLocalVision ? ['Verifica apenas sequências de enquadramentos repetidos classificados localmente'] : ['Análise visual com enquadramento não está disponível'] };
  coverage.repetition = { status: video.length > 1 ? 'partial' : 'unavailable', evidence: video.length > 1 ? ['Compara clipes que apontam para o mesmo plano detectado; similaridade semântica integral não é presumida'] : ['Poucos clipes para comparar repetição'] };
  coverage['emotional-progression'] = { status: episodeAssets.size && musicAssets.size ? 'partial' : 'unavailable', evidence: ['Progressão estimada apenas por intensidade local e seções musicais; não representa compreensão narrativa humana'] };
  coverage.narrative = { status: 'partial', evidence: hasLocalVision ? ['Ações e tipos de cena disponíveis quando foram analisados; coerência semântica integral não é inferida'] : ['Sem rótulos semânticos confiáveis, a coerência narrativa não pode ser verificada automaticamente'] };
  coverage.effects = { status: video.length ? 'partial' : 'unavailable', evidence: ['Verifica combinações de efeitos potencialmente difíceis de ler; não julga intenção estética'] };
  coverage.audio = { status: audio.length ? 'partial' : 'unavailable', evidence: audio.length ? ['Sobreposições e ganhos da timeline são verificáveis; pico e loudness do mix final exigem renderização'] : ['Nenhum clipe de áudio ativo'] };
  coverage.subtitles = { status: 'partial', evidence: text.length ? [`${text.length} clipes de texto; verifica sobreposição na mesma trilha, não tradução ou legibilidade`] : ['Nenhuma legenda na timeline; não é possível determinar se isso é intencional'] };
  coverage['preview-export'] = { status: 'partial', evidence: ['O relatório usa dados do projeto, não quadros medidos do preview e do arquivo exportado'] };

  const visibleTracks = project.tracks.filter((track) => track.kind === 'video' && !track.hidden);
  const primaryTrack = visibleTracks
    .map((track) => ({ track, clips: video.filter((clip) => clip.trackId === track.id).sort((a, b) => a.timelineStartUs - b.timelineStartUs) }))
    .sort((a, b) => b.clips.length - a.clips.length)[0];
  if (primaryTrack && primaryTrack.clips.length > 1) {
    const ordered = primaryTrack.clips;
    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1]!;
      const current = ordered[i]!;
      if (current.timelineStartUs > clipEndUs(previous) + 120_000) {
        const gapUs = current.timelineStartUs - clipEndUs(previous);
        const overlays = video.some((clip) => clip.trackId !== primaryTrack.track.id && clip.timelineStartUs <= clipEndUs(previous) && clipEndUs(clip) >= current.timelineStartUs);
        if (!overlays) {
          issues.push(issue('temporal', clipEndUs(previous), current.timelineStartUs, gapUs > 500_000 ? 'medium' : 'low', 'lacuna visual', [`Intervalo sem clipe na trilha principal: ${(gapUs / 1e6).toFixed(2)} s`], 'Há um trecho sem imagem entre dois clipes consecutivos da trilha principal.', 'Revise se o preto é intencional; caso contrário, estenda ou mova um clipe para cobrir o intervalo.', [previous.id, current.id]));
        }
      }

      const priorAnalysis = input.episodes.get(previous.assetId!);
      const currentAnalysis = input.episodes.get(current.assetId!);
      const priorShot = shotFor(priorAnalysis, previous);
      const currentShot = shotFor(currentAnalysis, current);
      if (priorShot && currentShot && Math.abs(priorShot.brightness - currentShot.brightness) >= 0.32) {
        issues.push(issue('visual', current.timelineStartUs, clipEndUs(current), 'medium', 'salto de luminosidade', [`Brilho médio das cenas: ${priorShot.brightness.toFixed(2)} → ${currentShot.brightness.toFixed(2)} (escala 0–1)`], 'A análise por cena encontrou uma diferença de luminância grande na transição.', 'Ajuste exposição/realces/sombras no clipe ou escolha um ponto de corte que preserve melhor a continuidade.', [previous.id, current.id]));
      }

      const claimSync = /batida|beat|acento|drop|sincroniz/i.test(current.reason ?? '');
      if (claimSync) {
        const musicClip = audio.find((clip) => {
          const track = project.tracks.find((item) => item.id === clip.trackId);
          return track?.role === 'music' && current.timelineStartUs >= clip.timelineStartUs && current.timelineStartUs < clipEndUs(clip);
        });
        const analysis = musicClip?.assetId ? input.music?.get(musicClip.assetId) : undefined;
        if (musicClip && analysis && analysis.bpmConfidence >= 0.5) {
          const sourceS = clipMusicTime(musicClip, current.timelineStartUs);
          const marks = [...analysis.beats, ...(analysis.events ?? []).filter((event) => event.type === 'impact' || event.type === 'drop').map((event) => event.atS)];
          if (!marks.length) continue;
          const distance = nearestDistance(sourceS, marks);
          const tolerance = Math.min(0.18, 9 / analysis.bpm);
          if (distance > tolerance) {
            issues.push(issue('music-sync', current.timelineStartUs, current.timelineStartUs, 'low', 'sincronia declarada fora da janela', [`Motivo do clipe: ${current.reason}`, `Evento musical mais próximo: ${(distance * 1000).toFixed(0)} ms`, `Confiança de BPM: ${Math.round(analysis.bpmConfidence * 100)}%`], 'O motivo do clipe declara sincronização, mas o corte está distante das batidas/impactos analisados.', 'Reposicione o corte ou remova a justificativa de sincronização se o deslocamento for intencional.', [current.id]));
          }
        }
      }
    }

    for (let startIndex = 0; startIndex < ordered.length;) {
      if (ordered[startIndex]!.durationUs >= 180_000) {
        startIndex++;
        continue;
      }
      let endIndex = startIndex + 1;
      while (
        endIndex < ordered.length
        && ordered[endIndex]!.durationUs < 180_000
        && ordered[endIndex]!.timelineStartUs <= clipEndUs(ordered[endIndex - 1]!) + 120_000
      ) endIndex++;
      const shortRun = ordered.slice(startIndex, endIndex);
      if (shortRun.length >= 3) {
        const start = shortRun[0]!;
        const end = shortRun.at(-1)!;
        issues.push(issue('cut-density', start.timelineStartUs, clipEndUs(end), 'medium', 'sequência de cortes muito curtos', [`${shortRun.length} clipes consecutivos com duração inferior a 180 ms na trilha principal`], 'Vários clipes abaixo do limiar de duração podem piscar sem dar tempo de ler a ação.', 'Alongue ou remova alguns cortes; preserve os curtos apenas nos impactos em que forem intencionais.', shortRun.map((clip) => clip.id)));
      }
      startIndex = endIndex;
    }

    const sourceOccurrences = new Map<string, Clip[]>();
    for (const clip of ordered) {
      const analysis = input.episodes.get(clip.assetId!);
      const shot = shotFor(analysis, clip);
      if (!shot) continue;
      const sourceKey = `${clip.assetId}:${Math.round(shot.startS * 10)}`;
      sourceOccurrences.set(sourceKey, [...(sourceOccurrences.get(sourceKey) ?? []), clip]);
    }
    for (const occurrences of sourceOccurrences.values()) {
      if (occurrences.length < 2) continue;
      const first = occurrences[0]!;
      const repeated = occurrences.at(-1)!;
      issues.push(issue('repetition', first.timelineStartUs, clipEndUs(repeated), occurrences.length >= 3 ? 'medium' : 'low', 'mesma cena reutilizada', [`A mesma cena de origem aparece ${occurrences.length} vezes`, `Asset ${first.assetId}, origem ${((first.sourceInUs) / 1e6).toFixed(2)} s`], 'Os clipes mapeiam para o mesmo plano detectado na análise do episódio.', 'Considere substituir uma ocorrência por outro plano ou mantenha-a se a repetição for um recurso rítmico deliberado.', occurrences.map((clip) => clip.id)));
    }

    const framed = ordered.map((clip) => {
      const shot = shotFor(input.episodes.get(clip.assetId!), clip);
      const vision = shot && input.visions?.get(clip.assetId!)?.shots[`t${Math.round(shot.startS * 100)}`];
      return { clip, framing: vision?.framing };
    });
    for (let start = 0; start < framed.length;) {
      const framing = framed[start]!.framing;
      let end = start + 1;
      if (!framing || framing === 'unknown') { start++; continue; }
      while (end < framed.length && framed[end]!.framing === framing) end++;
      if (end - start >= 5) {
        const group = framed.slice(start, end);
        issues.push(issue('shot-variety', group[0]!.clip.timelineStartUs, clipEndUs(group.at(-1)!.clip), 'low', 'enquadramento repetido', [`${end - start} planos consecutivos classificados como ${framing}`], 'A análise visual classificou vários planos consecutivos com o mesmo enquadramento.', 'Intercale um plano mais aberto/fechado se a variedade ajudar a leitura da sequência.', group.map((item) => item.clip.id)));
      }
      start = end;
    }
  }

  for (const clip of video) {
    const enabled = clip.effects.filter((effect) => effect.enabled);
    const flash = enabled.filter((effect) => effect.effect === 'flash').length;
    const shake = enabled.some((effect) => effect.effect === 'shake');
    const rgb = enabled.some((effect) => effect.effect === 'rgb_split');
    if (flash > 1 || (shake && rgb && clip.durationUs < 250_000)) {
      issues.push(issue('effects', clip.timelineStartUs, clipEndUs(clip), 'low', 'efeitos sobrepostos em trecho curto', [`${flash} clarões ativos; tremida=${shake ? 'sim' : 'não'}; separação RGB=${rgb ? 'sim' : 'não'}`, `Duração do clipe: ${(clip.durationUs / 1e6).toFixed(2)} s`], 'A combinação pode reduzir a legibilidade do quadro, especialmente num clipe curto.', 'Desative ou reduza um dos efeitos e confira o trecho no preview.', [clip.id]));
    }
  }

  for (const [index, first] of text.entries()) {
    for (const second of text.slice(index + 1)) {
      if (first.trackId !== second.trackId || overlaps(first, second) <= 100_000) continue;
      const earlier = first.timelineStartUs <= second.timelineStartUs ? first : second;
      const later = earlier === first ? second : first;
      const newDuration = later.timelineStartUs - earlier.timelineStartUs;
      const fix = newDuration >= 1_000
        ? { label: 'Ajustar fim da legenda anterior', commands: [{ type: 'clip.update' as const, clipId: earlier.id, patch: { durationUs: newDuration } }] }
        : undefined;
      issues.push(issue('subtitles', Math.max(first.timelineStartUs, second.timelineStartUs), Math.min(clipEndUs(first), clipEndUs(second)), 'medium', 'legendas sobrepostas na mesma faixa', [`“${first.text?.text ?? ''}” e “${second.text?.text ?? ''}”`, `Sobreposição: ${(overlaps(first, second) / 1e6).toFixed(2)} s`], 'Dois textos ocupam a mesma faixa ao mesmo tempo e podem ficar visualmente sobrepostos.', 'Ajuste a duração/posição das legendas ou use outra faixa de texto.', [first.id, second.id], fix));
    }
  }

  const audioTrackById = new Map(project.tracks.filter((track) => track.kind === 'audio').map((track) => [track.id, track]));
  const boundaries = [...new Set(audio.flatMap((clip) => [clip.timelineStartUs, clipEndUs(clip)]))].sort((a, b) => a - b);
  for (let index = 0; index + 1 < boundaries.length; index++) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    const active = audio.filter((clip) => clip.timelineStartUs <= start && clipEndUs(clip) >= end);
    if (active.length < 3) continue;
    const linearGain = active.reduce((sum, clip) => sum + Math.pow(10, (clip.audio.gainDb + (audioTrackById.get(clip.trackId)?.gainDb ?? 0)) / 20), 0);
    const db = 20 * Math.log10(Math.max(linearGain, 1e-6));
    if (db > 6) {
      issues.push(issue('audio', start, end, 'medium', 'muitas fontes de áudio sobrepostas', [`${active.length} clipes ativos; ganho nominal acumulado ${db.toFixed(1)} dB`, 'A exportação limita o pico do mix, o que pode comprimir transientes'], 'Há várias fontes simultâneas com ganho nominal alto; o limitador evita ultrapassar o teto, mas não garante clareza da mixagem.', 'Ouça o trecho e reduza ganhos/duplique menos fontes se houver mascaramento.', active.map((clip) => clip.id)));
    }
  }

  const musicClips = audio.filter((clip) => audioTrackById.get(clip.trackId)?.role === 'music');
  if (video.length && musicClips.length) {
    const videoStart = Math.min(...video.map((clip) => clip.timelineStartUs));
    const videoEnd = Math.max(...video.map(clipEndUs));
    const musicBoundaries = [...new Set([
      videoStart,
      videoEnd,
      ...musicClips.flatMap((clip) => [Math.max(videoStart, clip.timelineStartUs), Math.min(videoEnd, clipEndUs(clip))]),
    ])].sort((a, b) => a - b);
    for (let index = 0; index + 1 < musicBoundaries.length; index++) {
      const start = musicBoundaries[index]!;
      const end = musicBoundaries[index + 1]!;
      const hasVideo = video.some((clip) => clip.timelineStartUs < end && clipEndUs(clip) > start);
      const hasMusic = musicClips.some((clip) => clip.timelineStartUs <= start && clipEndUs(clip) >= end);
      if (hasVideo && !hasMusic && end - start >= 1_000_000) {
        issues.push(issue('audio', start, end, 'low', 'trecho sem música', [`Sem clipe na trilha de música por ${((end - start) / 1e6).toFixed(2)} s enquanto há vídeo`], 'A trilha de música não cobre este trecho visual.', 'Confira se a pausa musical é intencional ou estenda/reposicione o clipe de música.', video.filter((clip) => clip.timelineStartUs < end && clipEndUs(clip) > start).map((clip) => clip.id)));
      }
    }

    const narrativeSamples: { clip: Clip; energy: number; sceneIntensity: number; action: string | undefined; confidence: number }[] = [];
    for (const clip of video) {
      const musicClip = musicClips.find((candidate) => clip.timelineStartUs < clipEndUs(candidate) && clipEndUs(clip) > candidate.timelineStartUs);
      if (!musicClip?.assetId) continue;
      const musicAnalysis = input.music?.get(musicClip.assetId);
      const episodeAnalysis = input.episodes.get(clip.assetId!);
      const shot = shotFor(episodeAnalysis, clip);
      if (!musicAnalysis || !shot) continue;
      const localTime = clipMusicTime(musicClip, Math.max(clip.timelineStartUs, musicClip.timelineStartUs));
      const section = musicAnalysis.sections.find((item) => localTime >= item.startS && localTime < item.endS);
      const visual = input.visions?.get(clip.assetId!)?.shots[`t${Math.round(shot.startS * 100)}`];
      narrativeSamples.push({ clip, energy: section?.energy ?? 0, sceneIntensity: shot.intensity, action: visual?.action, confidence: visual?.confidence ?? 0 });
    }
    const highEnergy = narrativeSamples.filter((sample) => sample.energy >= 0.65);
    const opening = narrativeSamples.filter((sample) => sample.clip.timelineStartUs <= videoStart + (videoEnd - videoStart) * 0.2);
    if (highEnergy.length >= 2 && opening.length >= 2) {
      const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const openingIntensity = average(opening.map((sample) => sample.sceneIntensity));
      const climaxIntensity = average(highEnergy.map((sample) => sample.sceneIntensity));
      if (climaxIntensity + 0.15 < openingIntensity) {
        issues.push(issue('emotional-progression', highEnergy[0]!.clip.timelineStartUs, clipEndUs(highEnergy.at(-1)!.clip), 'medium', 'intensidade visual cai no trecho musical forte', [`Intensidade média da abertura: ${openingIntensity.toFixed(2)}`, `Intensidade média em seções musicais de alta energia: ${climaxIntensity.toFixed(2)}`, `${highEnergy.length} clipes avaliados`], 'A intensidade visual analisada diminui na seção mais energética da música, em vez de acompanhar o clímax.', 'Considere mover cenas de maior impacto para este trecho ou preservar uma queda deliberada como contraste.', highEnergy.map((sample) => sample.clip.id)));
      }
      const calmActions = highEnergy.filter((sample) => sample.confidence >= 0.65 && ['diálogo', 'contemplação', 'ambiente'].includes(sample.action ?? ''));
      if (calmActions.length >= 2 && calmActions.length / highEnergy.length >= 0.6) {
        issues.push(issue('narrative', calmActions[0]!.clip.timelineStartUs, clipEndUs(calmActions.at(-1)!.clip), 'low', 'cenas calmas durante alta energia', [`${calmActions.length} de ${highEnergy.length} clipes em seções fortes têm rótulos visuais de diálogo/contemplação/ambiente`, 'Os rótulos vieram da análise visual com confiança ≥ 65%'], 'A categoria visual disponível pode contrastar com as seções de alta energia; isso pode ser intencional, mas merece revisão narrativa.', 'Revise esses trechos e substitua apenas se o contraste não fizer parte da intenção editorial.', calmActions.map((sample) => sample.clip.id)));
      }
    }
  }

  for (const dimension of DIMENSIONS) {
    if (issues.some((item) => item.dimension === dimension)) continue;
    coverage[dimension].evidence.push(`Nenhum problema objetivo foi encontrado com os dados disponíveis para ${dimensionLabel[dimension]}.`);
  }
  issues.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]) || a.startUs - b.startUs);
  return { durationUs, issues, coverage };
}
