/**
 * Qual faixa de áudio usar quando o arquivo tem mais de uma (ex.: japonês + dublagem
 * em português). Uma regra só para a análise (falas/gritos) e para o Gerar meu AMV,
 * senão os tempos analisados numa faixa tocariam em outra.
 */
export interface AudioStreamInfo {
  index: number;
  language: string | null;
  title?: string | null;
}

const JA = ['jpn', 'ja', 'jp', 'jap'];
const PT = ['por', 'pt', 'pob', 'ptb', 'pt-br', 'pt_br'];
const isJa = (x: AudioStreamInfo) => JA.includes((x.language ?? '').toLowerCase()) || /japon|japan/i.test(x.title ?? '');
const isPt = (x: AudioStreamInfo) => PT.includes((x.language ?? '').toLowerCase()) || /portugu|dublad/i.test(x.title ?? '');

/**
 * Índice do stream (como o FFmpeg numera, `0:<índice>`) do idioma pedido, ou null para
 * deixar a faixa padrão. `original` = japonês; sem idioma marcado, a primeira que não é dublagem.
 */
export function pickAudioStreamByLanguage(streams: AudioStreamInfo[], lang: 'original' | 'pt' = 'original'): number | null {
  if (streams.length < 2) return null;
  if (lang === 'pt') return streams.find(isPt)?.index ?? null;
  return streams.find(isJa)?.index ?? streams.find((x) => !isPt(x))?.index ?? null;
}
