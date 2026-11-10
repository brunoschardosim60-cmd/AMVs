import type { MusicAnalysis } from '@amv/analysis';

export type NarrativeRole = 'opening' | 'build' | 'climax' | 'release' | 'ending' | 'development';

export interface NarrativeBeat {
  role: NarrativeRole;
  startS: number;
  endS: number;
  section: string;
  reason: string;
}

const LABELS: Record<NarrativeRole, string> = {
  opening: 'Abertura',
  build: 'Crescimento',
  climax: 'Clímax',
  release: 'Respiro',
  ending: 'Encerramento',
  development: 'Desenvolvimento',
};

export function narrativeRoleLabel(role: NarrativeRole): string {
  return LABELS[role];
}

export function planNarrative(music: MusicAnalysis, range: [number, number], offsetS = 0): NarrativeBeat[] {
  const [start, end] = range;
  if (!(end > start)) return [];
  const sections = music.sections
    .map((section) => ({ ...section, startS: section.startS + offsetS, endS: section.endS + offsetS }))
    .filter((section) => section.endS > start && section.startS < end)
    .map((section) => ({
      startS: Math.max(start, section.startS),
      endS: Math.min(end, section.endS),
      label: section.label,
      energy: section.energy,
    }))
    .filter((section) => section.endS > section.startS)
    .sort((a, b) => a.startS - b.startS);

  if (!sections.length) {
    return [{
      role: 'development',
      startS: 0,
      endS: end - start,
      section: 'não identificada',
      reason: 'A análise não identificou seções musicais; mantive a montagem guiada pela energia e pelas batidas disponíveis.',
    }];
  }

  const beats: NarrativeBeat[] = [];
  let previousEnergy: number | null = null;
  for (const [index, section] of sections.entries()) {
    const hasDrop = music.drops.some((drop) => drop + offsetS >= section.startS && drop + offsetS < section.endS);
    let role: NarrativeRole;
    let reason: string;
    switch (section.label) {
      case 'intro':
        role = index === 0 ? 'opening' : 'development';
        reason = index === 0 ? 'Seção identificada como introdução: priorizar apresentação e deixar a energia crescer.' : 'Introdução reaparece no trecho: preservar desenvolvimento sem assumir que a montagem recomeça.';
        break;
      case 'pré-refrão':
        role = 'build';
        reason = 'Pré-refrão identificado: construir expectativa antes da próxima seção.';
        break;
      case 'drop':
        role = 'climax';
        reason = hasDrop ? 'Drop detectado dentro da seção: reservar impacto visual para a entrada, sem obrigar um corte no primeiro frame.' : 'Seção rotulada como drop: aumentar a prioridade de ação/impacto.';
        break;
      case 'refrão':
        role = hasDrop ? 'climax' : 'development';
        reason = hasDrop ? 'Refrão contém um drop detectado: tratar como clímax.' : 'Refrão identificado, mas sem drop detectado; manter a direção sem presumir um impacto.';
        break;
      case 'ponte':
        role = previousEnergy !== null && section.energy < previousEnergy - 0.08 ? 'release' : 'development';
        reason = role === 'release' ? 'Ponte com energia inferior à seção anterior: abrir espaço de respiro.' : 'Ponte identificada sem queda clara de energia: manter o desenvolvimento.';
        break;
      case 'final':
        role = 'ending';
        reason = 'Seção final identificada: orientar a sequência para um encerramento.';
        break;
      case 'verso':
      default:
        if (index === 0) {
          role = 'opening';
          reason = 'Primeira seção disponível no trecho: usar como abertura, sem evidência de uma intro separada.';
        } else if (previousEnergy !== null && section.energy > previousEnergy + 0.12) {
          role = 'build';
          reason = 'Energia da seção aumentou: favorecer crescimento moderado.';
        } else {
          role = 'development';
          reason = 'Seção sem marcador narrativo específico: manter desenvolvimento equilibrado.';
        }
        break;
    }
    beats.push({
      role,
      startS: section.startS - start,
      endS: section.endS - start,
      section: section.label,
      reason,
    });
    previousEnergy = section.energy;
  }
  return beats;
}

export function narrativeAt(beats: NarrativeBeat[], atS: number): NarrativeBeat | undefined {
  const active = beats.find((beat) => atS >= beat.startS && atS < beat.endS);
  if (active) return active;
  const last = beats.at(-1);
  return last && atS >= last.endS ? last : undefined;
}
