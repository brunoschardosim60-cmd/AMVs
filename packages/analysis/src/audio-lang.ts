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

export function languageFamily(value: string | null | undefined): 'ja' | 'pt' | 'en' | null {
  const normalized = (value ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (JA.includes(normalized) || /japon|japan|日本語/.test(normalized)) return 'ja';
  if (PT.includes(normalized) || /portugu|dublad|pt-br/.test(normalized)) return 'pt';
  if (['eng', 'en', 'en-us', 'en-gb'].includes(normalized) || /english|ingl[eê]s/.test(normalized)) return 'en';
  return null;
}

function streamLanguage(x: AudioStreamInfo): 'ja' | 'pt' | 'en' | null {
  return languageFamily(x.title) ?? languageFamily(x.language);
}

const isJa = (x: AudioStreamInfo) => streamLanguage(x) === 'ja';
const isPt = (x: AudioStreamInfo) => streamLanguage(x) === 'pt';

/**
 * Índice do stream (como o FFmpeg numera, `0:<índice>`) do idioma pedido, ou null quando
 * não houver uma faixa identificável. O título explícito prevalece sobre tags de idioma
 * conflitantes, comuns em arquivos MKV.
 */
export function pickAudioStreamByLanguage(streams: AudioStreamInfo[], lang: 'original' | 'pt' = 'original'): number | null {
  if (streams.length < 2) return null;
  if (lang === 'pt') return streams.find(isPt)?.index ?? null;
  return streams.find(isJa)?.index ?? streams.find((x) => !isPt(x))?.index ?? null;
}
