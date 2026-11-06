/**
 * Hash parcial de arquivos de mídia (rápido mesmo para episódios de vários GB).
 *
 * v1 = SHA-256 de: "amvhash-v1" + tamanho (8 bytes LE) + primeiro MiB + último MiB.
 * Usado para cache de análise/proxy e para relocalizar arquivos movidos.
 * Não é prova criptográfica de identidade; é identificação prática.
 */

export const HASH_CHUNK = 1024 * 1024;

export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function partialHash(size: number, read: RangeReader): Promise<string> {
  const header = new TextEncoder().encode('amvhash-v1');
  const sizeBytes = new Uint8Array(8);
  new DataView(sizeBytes.buffer).setBigUint64(0, BigInt(size), true);

  const headLen = Math.min(HASH_CHUNK, size);
  const head = headLen > 0 ? await read(0, headLen) : new Uint8Array();
  const tailStart = Math.max(headLen, size - HASH_CHUNK);
  const tail = size > tailStart ? await read(tailStart, size - tailStart) : new Uint8Array();

  const all = new Uint8Array(header.length + 8 + head.length + tail.length);
  let o = 0;
  for (const part of [header, sizeBytes, head, tail]) {
    all.set(part, o);
    o += part.length;
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', all);
  return `v1:${toHex(digest)}`;
}

export interface CandidateFile {
  path: string;
  name: string;
  hash: string;
}

/**
 * Para cada asset ausente, encontra um arquivo candidato com o mesmo hash.
 * Prefere candidatos com o mesmo nome de arquivo quando há empate.
 */
export function matchMissingAssets(
  missing: { id: string; hash: string; path: string }[],
  candidates: CandidateFile[],
): Map<string, string> {
  const byHash = new Map<string, CandidateFile[]>();
  for (const c of candidates) {
    const list = byHash.get(c.hash) ?? [];
    list.push(c);
    byHash.set(c.hash, list);
  }
  const result = new Map<string, string>();
  for (const asset of missing) {
    const list = byHash.get(asset.hash);
    if (!list?.length) continue;
    const originalName = asset.path.split(/[\\/]/).pop();
    const best = list.find((c) => c.name === originalName) ?? list[0]!;
    result.set(asset.id, best.path);
  }
  return result;
}
