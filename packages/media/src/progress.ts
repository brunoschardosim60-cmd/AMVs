/**
 * Lê a saída de `ffmpeg -progress pipe:1`, que vem em blocos chave=valor
 * terminados por `progress=continue` ou `progress=end`.
 */
export interface ProgressUpdate {
  /** Tempo já processado da SAÍDA, em µs. */
  outTimeUs: number;
  /** Velocidade relativa ao tempo real (ex.: 3.2 = 3,2x). null se desconhecida. */
  speed: number | null;
  frame: number | null;
  done: boolean;
}

export class ProgressParser {
  private buffer = '';
  private block: Record<string, string> = {};

  constructor(private readonly onUpdate: (u: ProgressUpdate) => void) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      this.block[key] = value;
      if (key === 'progress') this.flush(value === 'end');
    }
  }

  private flush(done: boolean): void {
    const b = this.block;
    this.block = {};
    // out_time_us é o correto; out_time_ms historicamente também está em µs
    const raw = b.out_time_us ?? b.out_time_ms;
    const n = raw === undefined || raw === 'N/A' ? NaN : Number(raw);
    const speedMatch = b.speed?.match(/^([\d.]+)x$/);
    const frame = b.frame === undefined ? null : Number(b.frame);
    this.onUpdate({
      outTimeUs: Number.isFinite(n) && n > 0 ? n : 0,
      speed: speedMatch ? Number(speedMatch[1]) : null,
      frame: frame !== null && Number.isFinite(frame) ? frame : null,
      done,
    });
  }
}

/** Fração 0..1 com trava para não ultrapassar nem regredir. */
export function progressFraction(outTimeUs: number, totalUs: number): number {
  if (totalUs <= 0) return 0;
  return Math.min(1, Math.max(0, outTimeUs / totalUs));
}

/** Estimativa de tempo restante em segundos, ou null se ainda não dá para estimar. */
export function etaSeconds(fraction: number, elapsedMs: number): number | null {
  if (fraction <= 0.02 || elapsedMs < 1000) return null;
  return ((elapsedMs / fraction) * (1 - fraction)) / 1000;
}
