import { CancelledError, joinPath } from '@amv/media';
import { evalClipLook, type Clip, type Project } from '@amv/project';
import { renderProject, type ExportSettings, type RenderProgress, type RenderResult } from '@amv/render';
import type { Platform } from '../platform/types';
import type { ProjectSession } from './session';

export interface ExportPreset {
  id: string;
  label: string;
  /** Altura de saída (a largura acompanha a proporção do projeto). null = do projeto. */
  height: number | null;
}

export const RESOLUTION_PRESETS: ExportPreset[] = [
  { id: 'project', label: 'Do projeto', height: null },
  { id: '2160', label: '4K (2160p)', height: 2160 },
  { id: '1440', label: '1440p', height: 1440 },
  { id: '1080', label: '1080p', height: 1080 },
  { id: '720', label: '720p', height: 720 },
];

export function outputSize(project: Project, preset: ExportPreset): { width: number; height: number } {
  const P = project.settings;
  if (!preset.height) return { width: P.width, height: P.height };
  // a "altura" da predefinição vale para o lado menor (vertical 1080×1920 → 1080 de largura)
  const short = Math.min(P.width, P.height);
  const k = preset.height / short;
  const even = (v: number) => Math.max(2, 2 * Math.round(v / 2));
  return { width: even(P.width * k), height: even(P.height * k) };
}

/**
 * Rasteriza um clipe de texto com o MESMO desenho do preview.
 * Parado → 1 PNG (opacidade/efeitos aplicados pelo FFmpeg).
 * Animado → 1 PNG por quadro, já com tudo.
 */
export type TextRasterizer = (clip: Clip, project: Project, width: number, height: number, dir: string, fps: { num: number; den: number }) => Promise<{ path: string; sequence: boolean } | null>;

export interface ExportJob {
  promise: Promise<RenderResult>;
  cancel(): void;
}

export function startExport(
  platform: Platform,
  session: ProjectSession,
  output: string,
  settings: ExportSettings,
  rasterize: TextRasterizer,
  onProgress: (p: RenderProgress) => void,
): ExportJob {
  const ctrl = new AbortController();
  const project = session.project; // retrato do projeto no momento do clique
  const promise = (async () => {
    const work = joinPath(await platform.cacheDir(), `render-${Date.now().toString(36)}`);
    return renderProject(
      project,
      output,
      settings,
      {
        runner: platform.runner,
        fs: platform.fs,
        workDir: work,
        source: (id) => {
          const a = project.assets.find((x) => x.id === id);
          if (!a || !a.probe || a.status === 'missing') return null;
          return {
            path: a.path,
            kind: a.kind,
            width: a.probe.video?.width ?? 0,
            height: a.probe.video?.height ?? 0,
            audioStreams: a.probe.audio.map((s) => s.index),
          };
        },
        textImage: (clip, W, H, dir, fps) => rasterize(clip, project, W, H, dir, fps),
      },
      onProgress,
      ctrl.signal,
    );
  })();
  return { promise, cancel: () => ctrl.abort() };
}

export function isCancel(e: unknown): boolean {
  return e instanceof CancelledError || (e as Error)?.name === 'CancelledError';
}

/** Estado visual "neutro" para desenhar texto parado (o FFmpeg aplica opacidade e rampas). */
export function staticLook(clip: Clip) {
  return { ...evalClipLook({ ...clip, effects: [], transitionIn: null, transform: { ...clip.transform, opacity: 1 } }, 0, clip.durationUs / 1e6), dx: 0, dy: 0 };
}
