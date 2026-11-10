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

/** Efeitos sonoros que o app gera (impacto, whoosh…): ficam no projeto, mas fora das listas do usuário. */
export const SFX_TAG = 'sfx';
export const isSfxAsset = (a: { tags: string[] }) => a.tags.includes(SFX_TAG);
