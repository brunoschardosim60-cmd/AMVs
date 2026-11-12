import type { Cue, MusicAnalysis } from '@amv/analysis';
import { recommendStyle, type EditorialDirection, type StyleId } from './styles.js';
import { findHeroCoverFrame, type HeroCoverResult } from './hero-cover.js';
import { chooseMusicRange, type EpisodeInput, type GenerateOptions, type MusicInput, type OrganizationMode } from './generate.js';

export interface SmartEpisodePreset {
  style: StyleId;
  intensity: 0 | 1 | 2 | 3;
  durationS: number;
  musicStartS: number | null;
  editorialDirection: EditorialDirection;
  organizationMode: OrganizationMode;
  focus: 'fight' | 'mix';
  voiceMoments: number;
  voiceLang: 'original' | 'pt';
  useSpeech: boolean;
  useEffects: boolean;
  hitSync: boolean;
  adaptiveSpeed: boolean;
  heroCover: HeroCoverResult | null;
  explanation: {
    title: string;
    description: string;
    reasons: string[];
  };
}

/**
 * Analisa os episódios e a música para gerar uma configuração padrão personalizada e calibrada ("config padrão inteligente"),
 * escolhendo o estilo ideal, intensidade rítmica, direção editorial, momento das falas e o melhor enquadramento de capa.
 */
export function recommendEpisodePreset(
  episodes: EpisodeInput[],
  music: MusicInput,
  lyrics?: Cue[],
): SmartEpisodePreset {
  const m = music.analysis;
  const hasLyrics = Boolean(lyrics && lyrics.length > 0);

  // 1. Estilo recomendado com base na combinação áudio-visual
  const styleRec = recommendStyle(episodes, m, hasLyrics);
  const style = styleRec.style;

  // 2. Intensidade dos cortes baseada em BPM e energia musical
  let intensity: 0 | 1 | 2 | 3 = 2;
  if (m.bpm >= 140 || m.intensity >= 78) intensity = 3;
  else if (m.bpm <= 95 && m.intensity <= 35) intensity = 1;
  else intensity = 2;

  // 3. Direção editorial
  let editorialDirection: EditorialDirection = 'balanced';
  if (style === 'hype' || style === 'rapido') editorialDirection = 'hype';
  else if (style === 'emocional' || style === 'discurso') editorialDirection = 'cinematic';

  // 4. Modo de organização e foco
  const totalSequences = episodes.reduce((sum, ep) => sum + (ep.analysis.sequences?.length ?? 0), 0);
  const focus: 'fight' | 'mix' = totalSequences > 0 && style !== 'discurso' ? 'fight' : 'mix';
  const organizationMode: OrganizationMode = totalSequences > 0 ? 'narrative' : 'free';

  // 5. Duração sugerida compatível com a música
  const drop = m.drops[0];
  let durationS = 30;
  if (drop !== undefined) {
    if (drop <= 20) durationS = 30;
    else if (drop <= 35) durationS = 45;
    else durationS = 60;
  } else if (m.durationS < 35) {
    durationS = Math.round(m.durationS);
  }

  // 6. Trecho da música com o melhor drop ou ápice
  const range = chooseMusicRange(m, durationS, null);
  const musicStartS = range[0];

  // 7. Falas marcantes e idioma
  const allSpeech = episodes.flatMap((ep) => ep.analysis.speech ?? []);
  const highImpactSpeech = allSpeech.filter((s) => s.impact >= 0.7);
  const hasPortugueseAudio = episodes.some((ep) =>
    ep.audioStreams?.some((stream) => stream.language === 'pt' || stream.language === 'por'),
  );
  const voiceMoments = highImpactSpeech.length >= 2 ? 2 : highImpactSpeech.length === 1 ? 1 : 0;
  const useSpeech = voiceMoments > 0;
  const voiceLang: 'original' | 'pt' = hasPortugueseAudio ? 'pt' : 'original';

  // 8. Capa heroica padrão
  const heroCover = findHeroCoverFrame(episodes);

  // 9. Explicação detalhada
  const reasons: string[] = [
    `Estilo ${style.toUpperCase()}: ${styleRec.reason}`,
    `Intensidade ${intensity}/3 calibrada para o ritmo de ${Math.round(m.bpm)} BPM`,
    focus === 'fight'
      ? `${totalSequences} sequência(s) de ação detectadas; modo luta focado para preservar a continuidade`
      : 'Montagem mista para cobrir uma narrativa dinâmica entre as melhores cenas',
  ];
  if (useSpeech) {
    reasons.push(`${voiceMoments} fala(s) de impacto configurada(s) para pontuar os momentos dramáticos`);
  }
  if (hasLyrics) {
    reasons.push('Letra da música sincronizada e integrada com tipografia cinética');
  }

  return {
    style,
    intensity,
    durationS,
    musicStartS,
    editorialDirection,
    organizationMode,
    focus,
    voiceMoments,
    voiceLang,
    useSpeech,
    useEffects: true,
    hitSync: true,
    adaptiveSpeed: true,
    heroCover,
    explanation: {
      title: `Configuração Ideal para ${episodes[0]?.name ?? 'o Episódio'}`,
      description: `Preset ajustado automaticamente combinando as características visuais do anime com o ritmo de ${music.name}.`,
      reasons,
    },
  };
}
