import { joinPath } from '@amv/media';
import { PRESETS, type ProviderConfig } from '@amv/assistant';
import type { Platform } from '../platform/types';

/**
 * Configuração da IA. Fica em ia.json na pasta do app — SEM a chave.
 * A chave vai para o cofre do sistema (secret "ia:<preset>").
 */
export interface AiSettings {
  /** Desligado = o chat usa só os comandos locais (sem modelo). */
  enabled: boolean;
  presetId: string;
  provider: ProviderConfig;
  /** Envio do resumo do projeto para serviço na internet. Desligado por padrão. */
  allowExternal: boolean;
  /** Tokens usados (estimativa de consumo). */
  usage: { input: number; output: number };
}

export function defaultAiSettings(): AiSettings {
  const p = PRESETS[0]!;
  return { enabled: false, presetId: p.id, provider: { name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model, needsKey: p.needsKey }, allowExternal: false, usage: { input: 0, output: 0 } };
}

export const isLocal = (s: AiSettings) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(s.provider.baseUrl);

export const secretName = (presetId: string) => `ia:${presetId}`;

async function file(p: Platform) {
  return joinPath(await p.dataDir(), 'ia.json');
}

export async function loadAiSettings(p: Platform): Promise<AiSettings> {
  try {
    const f = await file(p);
    if (!(await p.fs.exists(f))) return defaultAiSettings();
    const raw = JSON.parse(new TextDecoder().decode(await p.fs.readFile(f))) as Partial<AiSettings>;
    const d = defaultAiSettings();
    return { ...d, ...raw, provider: { ...d.provider, ...raw.provider }, usage: { ...d.usage, ...raw.usage } };
  } catch {
    return defaultAiSettings();
  }
}

export async function saveAiSettings(p: Platform, s: AiSettings): Promise<void> {
  await p.fs.mkdir(await p.dataDir());
  const f = await file(p);
  await p.fs.writeFile(`${f}.tmp`, new TextEncoder().encode(JSON.stringify(s, null, 2)));
  await p.fs.rename(`${f}.tmp`, f);
}
