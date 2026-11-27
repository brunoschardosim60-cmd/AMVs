export * from './time.js';
export * from './schema.js';
export * from './commands.js';
export * from './history.js';
export * from './factory.js';
export * from './serialize.js';
export * from './hash.js';
export * from './timeline.js';
export * from './edit.js';
export * from './effects.js';
export * from './keyframes.js';
export * from './audioMix.js';
export * from './speed.js';

/** Efeitos sonoros que o app gera (impacto, whoosh…): ficam no projeto, mas fora das listas do usuário. */
export const SFX_TAG = 'sfx';
export const isSfxAsset = (a: { tags: string[] }) => a.tags.includes(SFX_TAG);

/** Camadas internas de recorte transparente (V2): ficam no projeto, mas fora da biblioteca de mídias do usuário. */
export const ALPHA_CUTOUT_TAG = 'alpha-cutout';
export const isInternalCutoutAsset = (a: { tags: string[]; name?: string; path?: string }) =>
  a.tags.includes(ALPHA_CUTOUT_TAG)
  || /^Recorte(\s+V2)?\s*·/i.test(a.name ?? '')
  || /[\\/]cutouts[\\/]cutout-/i.test(a.path ?? '');
