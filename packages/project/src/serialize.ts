import { ProjectSchema, CURRENT_SCHEMA_VERSION, type Project } from './schema.js';

/** Uma migração leva um objeto da versão N para N+1. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registro de migrações: chave = versão de origem.
 * Ex.: MIGRATIONS[1] converte um projeto v1 em v2.
 * Toda migração nova precisa de teste em test/serialize.test.ts.
 */
function migrateTextTypographyV1(raw: Record<string, unknown>): Record<string, unknown> {
  const clips = Array.isArray(raw.clips) ? raw.clips : [];
  return {
    ...raw,
    clips: clips.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const clip = value as Record<string, unknown>;
      if (!clip.text || typeof clip.text !== 'object' || Array.isArray(clip.text)) return clip;
      const text = clip.text as Record<string, unknown>;
      return {
        ...clip,
        text: {
          weight: 700,
          background: 'none',
          backgroundOpacity: 0.72,
          alignment: 'center',
          maxWidthRatio: 0.9,
          marginX: 48,
          marginY: 36,
          padding: 24,
          lineSpacing: 1.18,
          letterSpacing: 0,
          highlightColor: '#ffd166',
          highlightScale: 1.12,
          timingPrecision: null,
          wordTimings: [],
          ...text,
        },
      };
    }),
  };
}

export const MIGRATIONS: Record<number, Migration> = {
  1: migrateTextTypographyV1,
  2: (raw) => ({ ...raw, characterLibrary: Array.isArray(raw.characterLibrary) ? raw.characterLibrary : [] }),
  3: (raw) => ({ ...raw, sceneAnnotations: Array.isArray(raw.sceneAnnotations) ? raw.sceneAnnotations : [] }),
  4: (raw) => ({ ...raw, audioMix: raw.audioMix && typeof raw.audioMix === 'object' ? raw.audioMix : {} }),
  5: (raw) => ({
    ...raw,
    assets: Array.isArray(raw.assets) ? raw.assets.map((asset) =>
      asset && typeof asset === 'object' && !Array.isArray(asset)
        ? { ...(asset as Record<string, unknown>), rights: (asset as Record<string, unknown>).rights ?? { origin: '', license: '', attribution: '' } }
        : asset,
    ) : [],
  }),
  6: (raw) => ({
    ...raw,
    clips: Array.isArray(raw.clips) ? raw.clips.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const clip = value as Record<string, unknown>;
      if (!clip.text || typeof clip.text !== 'object' || Array.isArray(clip.text)) return clip;
      const text = clip.text as Record<string, unknown>;
      const textSource = text.textSource ?? (typeof text.original === 'string' && typeof text.lang === 'string' ? 'translation' : 'manual');
      const translations = text.translations ?? (
        textSource === 'translation' && typeof text.lang === 'string' && typeof text.text === 'string'
          ? { [text.lang]: text.text }
          : {}
      );
      const wordTimings = Array.isArray(text.wordTimings)
        ? text.wordTimings.map((word) => word && typeof word === 'object' && !Array.isArray(word)
          ? { ...(word as Record<string, unknown>), syllables: Array.isArray((word as Record<string, unknown>).syllables) ? (word as Record<string, unknown>).syllables : [] }
          : word)
        : [];
      return {
        ...clip,
        text: {
          fillStyle: 'solid',
          gradientStartColor: '#ffde59',
          gradientEndColor: '#ff4d9d',
          glowColor: '#ffde59',
          glowIntensity: 0,
          wordAnimation: 'highlight',
          syllableAnimation: false,
          section: 'verse',
          animationInUs: 300_000,
          animationOutUs: 250_000,
          textSource,
          manualText: textSource === 'manual' && typeof text.text === 'string' ? text.text : null,
          translations,
          ...text,
          wordTimings,
        },
      };
    }) : [],
  }),
  7: (raw) => ({
    ...raw,
    clips: Array.isArray(raw.clips) ? raw.clips.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const clip = value as Record<string, unknown>;
      return {
        ...clip,
        reverse: clip.reverse ?? false,
        audio: clip.audio && typeof clip.audio === 'object' && !Array.isArray(clip.audio)
          ? { pitchMode: 'preserve', ...(clip.audio as Record<string, unknown>) }
          : { pitchMode: 'preserve' },
      };
    }) : [],
  }),
  8: (raw) => ({
    ...raw,
    clips: Array.isArray(raw.clips) ? raw.clips.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const clip = value as Record<string, unknown>;
      return {
        ...clip,
        blendMode: clip.blendMode ?? 'normal',
        mask: clip.mask ?? 'none',
        groupId: clip.groupId ?? null,
      };
    }) : [],
  }),
  9: (raw) => ({
    ...raw,
    clips: Array.isArray(raw.clips) ? raw.clips.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const clip = value as Record<string, unknown>;
      const audio = clip.audio && typeof clip.audio === 'object' && !Array.isArray(clip.audio)
        ? clip.audio as Record<string, unknown>
        : {};
      return { ...clip, audio: { ...audio, duckingMode: audio.duckingMode ?? 'auto' } };
    }) : [],
  }),
};

export type ParseResult =
  | { ok: true; project: Project; migratedFrom: number | null; warnings: string[] }
  | { ok: false; error: string; details: string[] };

export function migrate(
  raw: Record<string, unknown>,
  target = CURRENT_SCHEMA_VERSION,
  migrations: Record<number, Migration> = MIGRATIONS,
): Record<string, unknown> {
  let current = raw;
  let version = current.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new Error('arquivo sem schemaVersion válido');
  }
  if (version > target) {
    throw new Error(
      `este projeto foi salvo por uma versão mais nova do AMV Studio (formato ${version}, suportado até ${target})`,
    );
  }
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new Error(`não há migração do formato ${version} para ${version + 1}`);
    current = { ...step(current), schemaVersion: version + 1 };
    version += 1;
  }
  return current;
}

/** Problemas de integridade que o schema sozinho não pega (referências e ids duplicados). */
export function checkIntegrity(project: Project): string[] {
  const problems: string[] = [];
  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const i of ids) {
      if (seen.has(i)) problems.push(`${kind} com id duplicado: ${i}`);
      seen.add(i);
    }
  };
  dup('asset', project.assets.map((a) => a.id));
  dup('trilha', project.tracks.map((t) => t.id));
  dup('clipe', project.clips.map((c) => c.id));
  dup('marcador', project.markers.map((m) => m.id));
  dup('personagem', project.characterLibrary.map((character) => character.id));
  dup('anotação de cena', project.sceneAnnotations.map((annotation) => `${annotation.assetId}@${annotation.sceneKey}`));

  const trackIds = new Set(project.tracks.map((t) => t.id));
  const assetIds = new Set(project.assets.map((a) => a.id));
  for (const annotation of project.sceneAnnotations) {
    if (!assetIds.has(annotation.assetId)) problems.push(`anotação de cena aponta para mídia inexistente ${annotation.assetId}`);
  }
  for (const c of project.clips) {
    if (!trackIds.has(c.trackId)) problems.push(`clipe ${c.id} aponta para trilha inexistente ${c.trackId}`);
    if (c.assetId && !assetIds.has(c.assetId)) {
      problems.push(`clipe ${c.id} aponta para mídia inexistente ${c.assetId}`);
    }
    for (const character of project.characterLibrary) {
      for (const evidence of character.evidence) {
        if (!assetIds.has(evidence.assetId)) problems.push(`personagem ${character.id} aponta para mídia inexistente ${evidence.assetId}`);
      }
    }
  }
  return problems;
}

export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'o arquivo não é um JSON válido', details: [String(e)] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'o arquivo não contém um projeto', details: [] };
  }
  const original = (raw as Record<string, unknown>).schemaVersion;
  let migrated: Record<string, unknown>;
  try {
    migrated = migrate(raw as Record<string, unknown>);
  } catch (e) {
    return { ok: false, error: (e as Error).message, details: [] };
  }
  const parsed = ProjectSchema.safeParse(migrated);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'o projeto tem dados inválidos',
      details: parsed.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
    };
  }
  const problems = checkIntegrity(parsed.data);
  if (problems.length) {
    return { ok: false, error: 'o projeto tem referências quebradas', details: problems };
  }
  return {
    ok: true,
    project: parsed.data,
    migratedFrom: original === CURRENT_SCHEMA_VERSION ? null : (original as number),
    warnings: [],
  };
}

/**
 * JSON canônico e legível: passa pelo schema (chaves sempre na mesma ordem) e
 * recusa salvar um projeto inválido — melhor falhar ao salvar do que gravar lixo.
 */
export function serializeProject(project: Project): string {
  const canonical = ProjectSchema.parse(project);
  const problems = checkIntegrity(canonical);
  if (problems.length) throw new Error(`projeto inconsistente: ${problems.join('; ')}`);
  return `${JSON.stringify(canonical, null, 2)}\n`;
}
