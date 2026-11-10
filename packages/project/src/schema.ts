import { z } from 'zod';

/** Versão atual do formato `.amvproj`. Toda mudança incrementa e ganha uma migração. */
export const CURRENT_SCHEMA_VERSION = 9;

const us = z.number().int().safe();
const nonNegUs = us.nonnegative();
const id = z.string().min(1);

export const RationalSchema = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
});

export const AssetKindSchema = z.enum(['video', 'audio', 'image']);

export const VideoStreamInfoSchema = z.object({
  codec: z.string(),
  profile: z.string().nullable(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  pixFmt: z.string().nullable(),
  bitDepth: z.number().int().nullable(),
  /** FPS declarado (r_frame_rate). */
  fps: RationalSchema.nullable(),
  /** FPS médio real (avg_frame_rate). */
  avgFps: RationalSchema.nullable(),
  /** Taxa de quadros variável detectada. */
  vfr: z.boolean(),
  frameCount: z.number().int().nullable(),
});

export const AudioStreamInfoSchema = z.object({
  index: z.number().int(),
  codec: z.string(),
  sampleRate: z.number().int().nullable(),
  channels: z.number().int().nullable(),
  channelLayout: z.string().nullable(),
  language: z.string().nullable(),
  title: z.string().nullable(),
});

export const SubtitleStreamInfoSchema = z.object({
  index: z.number().int(),
  codec: z.string(),
  language: z.string().nullable(),
  title: z.string().nullable(),
});

export const ProbeInfoSchema = z.object({
  container: z.string(),
  durationUs: nonNegUs,
  sizeBytes: z.number().int().nonnegative(),
  bitRate: z.number().int().nullable(),
  video: VideoStreamInfoSchema.nullable(),
  audio: z.array(AudioStreamInfoSchema),
  subtitles: z.array(SubtitleStreamInfoSchema),
  tags: z.record(z.string()),
});

export const AssetStatusSchema = z.enum(['ok', 'missing', 'processing', 'error']);

export const AssetSchema = z.object({
  id,
  name: z.string(),
  /** Caminho absoluto do arquivo ORIGINAL. Nunca é modificado. */
  path: z.string(),
  /** Hash parcial (ver hash.ts). Usado para relocalizar e cache. */
  hash: z.string(),
  kind: AssetKindSchema,
  probe: ProbeInfoSchema.nullable(),
  status: AssetStatusSchema,
  error: z.string().nullable().default(null),
  importedAt: z.string(),
  tags: z.array(z.string()).default([]),
  favorite: z.boolean().default(false),
  rights: z.object({
    origin: z.string().default(''),
    license: z.string().default(''),
    attribution: z.string().default(''),
  }).optional(),
});

export const TrackKindSchema = z.enum(['video', 'audio', 'text']);
export const AudioRoleSchema = z.enum(['music', 'voice', 'sfx', 'music2', 'ambience', 'other']);

export const TrackSchema = z.object({
  id,
  kind: TrackKindSchema,
  name: z.string(),
  role: AudioRoleSchema.nullable().default(null),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  /** Ganho da trilha em dB (mixer). */
  gainDb: z.number().default(0),
});

export const TransformSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  scale: z.number().positive().default(1),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  crop: z
    .object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() })
    .default({ left: 0, top: 0, right: 0, bottom: 0 }),
});

export const BlendModeSchema = z.enum(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'addition']);
export const LayerMaskSchema = z.enum(['none', 'circle', 'left', 'right', 'top', 'bottom']);

export const ClipAudioSchema = z.object({
  gainDb: z.number().default(0),
  fadeInUs: nonNegUs.default(0),
  fadeOutUs: nonNegUs.default(0),
  pitchSemitones: z.number().default(0),
  pitchMode: z.enum(['preserve', 'follow']).default('preserve'),
  /** Qual stream de áudio do asset usar (episódios com várias faixas de idioma). */
  streamIndex: z.number().int().nullable().default(null),
});

export const EffectInstanceSchema = z.object({
  id,
  effect: z.string(),
  enabled: z.boolean().default(true),
  params: z.record(z.unknown()).default({}),
});

export const TransitionInstanceSchema = z.object({
  transition: z.string(),
  durationUs: nonNegUs,
  params: z.record(z.unknown()).default({}),
});

export const KeyframeSchema = z.object({
  /** Tempo relativo ao início do clipe na timeline. */
  atUs: nonNegUs,
  value: z.number(),
  easing: z.enum(['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out']).default('linear'),
});

export const TextSyllableTimingSchema = z.object({
  text: z.string().min(1),
  startUs: nonNegUs,
  endUs: us.positive(),
  source: z.enum(['ass', 'lrc', 'whisper', 'manual', 'estimated']).default('ass'),
  confidence: z.number().min(0).max(1).nullable().default(null),
  uncertain: z.boolean().default(false),
}).refine((syllable) => syllable.endUs > syllable.startUs, {
  message: 'endUs precisa ser maior que startUs',
  path: ['endUs'],
});

export const TextWordTimingSchema = z
  .object({
    text: z.string().min(1),
    startUs: nonNegUs,
    endUs: us.positive(),
    source: z.enum(['ass', 'lrc', 'whisper', 'manual', 'estimated']).default('manual'),
    confidence: z.number().min(0).max(1).nullable().default(null),
    uncertain: z.boolean().default(false),
    color: z.string().nullable().optional(),
    scale: z.number().positive().nullable().optional(),
    offsetX: z.number().nullable().optional(),
    offsetY: z.number().nullable().optional(),
    weight: z.number().int().min(100).max(900).nullable().optional(),
    syllables: z.array(TextSyllableTimingSchema).default([]),
  })
  .refine((word) => word.endUs > word.startUs, {
    message: 'endUs precisa ser maior que startUs',
    path: ['endUs'],
  });

export const TextContentSchema = z.object({
  text: z.string(),
  textSource: z.enum(['original', 'translation', 'manual']).default('manual'),
  manualText: z.string().nullable().default(null),
  translations: z.record(z.string()).default({}),
  font: z.string().default('Inter'),
  size: z.number().positive().default(64),
  color: z.string().default('#ffffff'),
  weight: z.number().int().min(100).max(900).default(700),
  outlineColor: z.string().nullable().default(null),
  outlineWidth: z.number().nonnegative().default(0),
  shadow: z.boolean().default(false),
  animationIn: z.enum(['fade', 'pop', 'slide', 'slide-left', 'slide-right', 'blur', 'typewriter']).nullable().default(null),
  animationOut: z.enum(['fade', 'slide', 'pop', 'blur']).nullable().default(null),
  animationInUs: nonNegUs.default(300_000),
  animationOutUs: nonNegUs.default(250_000),
  background: z.enum(['none', 'bar', 'box', 'full']).default('none'),
  backgroundOpacity: z.number().min(0).max(1).default(0.72),
  alignment: z.enum(['left', 'center', 'right']).default('center'),
  maxWidthRatio: z.number().min(0.2).max(1).default(0.9),
  marginX: z.number().nonnegative().default(48),
  marginY: z.number().nonnegative().default(36),
  padding: z.number().nonnegative().default(24),
  lineSpacing: z.number().min(0.8).max(2).default(1.18),
  letterSpacing: z.number().min(-10).max(40).default(0),
  highlightColor: z.string().default('#ffd166'),
  highlightScale: z.number().min(1).max(2).default(1.12),
  fillStyle: z.enum(['solid', 'linear-gradient']).default('solid'),
  gradientStartColor: z.string().default('#ffde59'),
  gradientEndColor: z.string().default('#ff4d9d'),
  glowColor: z.string().default('#ffde59'),
  glowIntensity: z.number().min(0).max(50).default(0),
  wordAnimation: z.enum(['none', 'highlight', 'pop', 'fade']).default('highlight'),
  syllableAnimation: z.boolean().default(false),
  section: z.enum(['intro', 'verse', 'chorus', 'climax', 'custom']).default('verse'),
  timingPrecision: z.enum(['segment', 'word', 'manual']).nullable().default(null),
  wordTimings: z.array(TextWordTimingSchema).default([]),
  /** Legenda traduzida: o texto de antes da tradução (para voltar ou traduzir de novo). */
  original: z.string().optional(),
  /** Idioma do `text` atual (ex.: `en`), quando foi traduzido. */
  lang: z.string().optional(),
});

export const OriginSchema = z.enum(['user', 'ai']);

export const ClipSchema = z
  .object({
    id,
    trackId: id,
    assetId: id.nullable(),
    timelineStartUs: nonNegUs,
    durationUs: us.positive(),
    sourceInUs: nonNegUs,
    sourceOutUs: nonNegUs,
    speed: z.number().positive().default(1),
    reverse: z.boolean().default(false),
    transform: TransformSchema.default({}),
    blendMode: BlendModeSchema.default('normal'),
    mask: LayerMaskSchema.default('none'),
    groupId: id.nullable().default(null),
    audio: ClipAudioSchema.default({}),
    effects: z.array(EffectInstanceSchema).default([]),
    transitionIn: TransitionInstanceSchema.nullable().default(null),
    keyframes: z.record(z.array(KeyframeSchema)).default({}),
    text: TextContentSchema.nullable().default(null),
    origin: OriginSchema.default('user'),
    reason: z.string().nullable().default(null),
    confidence: z.number().min(0).max(1).nullable().default(null),
    label: z.string().nullable().default(null),
  })
  .refine((c) => c.sourceOutUs >= c.sourceInUs, {
    message: 'sourceOutUs precisa ser >= sourceInUs',
    path: ['sourceOutUs'],
  });

export const MarkerKindSchema = z.enum([
  'beat',
  'downbeat',
  'section',
  'speech',
  'scene',
  'drop',
  'user',
]);

export const MarkerSchema = z.object({
  id,
  kind: MarkerKindSchema,
  atUs: nonNegUs,
  durationUs: nonNegUs.default(0),
  label: z.string().default(''),
  color: z.string().nullable().default(null),
  origin: OriginSchema.default('user'),
  confidence: z.number().min(0).max(1).nullable().default(null),
});

export const ProjectSettingsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: RationalSchema,
  sampleRate: z.number().int().positive().default(48000),
  background: z.string().default('#000000'),
});

export const AudioMixSettingsSchema = z.object({
  includeVideoAudio: z.boolean().default(true),
  duckingEnabled: z.boolean().default(true),
  duckingAmountDb: z.number().min(0).max(24).default(12),
  duckingAttackMs: z.number().int().min(0).max(2000).default(80),
  duckingReleaseMs: z.number().int().min(0).max(5000).default(350),
  normalization: z.enum(['off', 'ebu-r128']).default('off'),
  targetLufs: z.number().min(-24).max(-5).default(-14),
  limiterEnabled: z.boolean().default(true),
  limiterCeilingDb: z.number().min(-12).max(0).default(-0.3),
});

export const AnalysisRefSchema = z.object({
  id,
  assetId: id,
  kind: z.string(),
  engine: z.string(),
  engineVersion: z.string(),
  createdAt: z.string(),
  cachePath: z.string(),
});

export const CharacterEvidenceSchema = z.object({
  assetId: id,
  sceneKey: z.string().regex(/^t\d+$/),
  source: z.enum(['vision', 'user']),
  confidence: z.number().min(0).max(1).nullable().default(null),
});

export const ProjectCharacterSchema = z.object({
  id,
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  evidence: z.array(CharacterEvidenceSchema).default([]),
  confidence: z.number().min(0).max(1).nullable().default(null),
  confirmed: z.boolean().default(false),
});

export const SceneAnnotationSchema = z.object({
  assetId: id,
  sceneKey: z.string().min(1),
  favorite: z.boolean().default(false),
  marked: z.boolean().default(false),
  excludedFromAuto: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1)).default([]),
});

export const VersionRefSchema = z.object({
  id,
  name: z.string(),
  createdAt: z.string(),
  origin: OriginSchema,
  file: z.string(),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id,
  name: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: ProjectSettingsSchema,
  audioMix: AudioMixSettingsSchema.default({}),
  assets: z.array(AssetSchema),
  tracks: z.array(TrackSchema),
  clips: z.array(ClipSchema),
  markers: z.array(MarkerSchema),
  analysis: z.array(AnalysisRefSchema).default([]),
  characterLibrary: z.array(ProjectCharacterSchema).default([]),
  sceneAnnotations: z.array(SceneAnnotationSchema).default([]),
  versions: z.array(VersionRefSchema).default([]),
});

export type Rational = z.infer<typeof RationalSchema>;
export type AssetKind = z.infer<typeof AssetKindSchema>;
export type ProbeInfo = z.infer<typeof ProbeInfoSchema>;
export type VideoStreamInfo = z.infer<typeof VideoStreamInfoSchema>;
export type AudioStreamInfo = z.infer<typeof AudioStreamInfoSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type AssetStatus = z.infer<typeof AssetStatusSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type TrackKind = z.infer<typeof TrackKindSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type BlendMode = z.infer<typeof BlendModeSchema>;
export type LayerMask = z.infer<typeof LayerMaskSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type TextWordTiming = z.infer<typeof TextWordTimingSchema>;
export type EffectInstance = z.infer<typeof EffectInstanceSchema>;
export type Marker = z.infer<typeof MarkerSchema>;
export type ProjectCharacter = z.infer<typeof ProjectCharacterSchema>;
export type SceneAnnotation = z.infer<typeof SceneAnnotationSchema>;
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type AudioMixSettings = z.infer<typeof AudioMixSettingsSchema>;
export type Project = z.infer<typeof ProjectSchema>;
