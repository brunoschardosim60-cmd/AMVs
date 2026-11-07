import type { ClipboardData } from '@amv/project';
import { create } from 'zustand';

/** Arrasto de mídia da biblioteca para a timeline (feito com eventos de ponteiro, não HTML5 DnD). */
export interface AssetDrag {
  assetId: string;
  label: string;
  x: number;
  y: number;
  /** Só um trecho da mídia (cena/fala), em µs da origem. */
  sourceInUs?: number;
  sourceOutUs?: number;
  /** Texto da fala (para a legenda opcional). */
  line?: string | null;
}

interface EditorState {
  /** Pixels por segundo na timeline. */
  zoom: number;
  playheadUs: number;
  playing: boolean;
  selection: string[];
  clipboard: ClipboardData | null;
  snapping: boolean;
  /** Fração da resolução do projeto usada no preview (não afeta a exportação). */
  previewScale: 1 | 0.5 | 0.25;
  assetDrag: AssetDrag | null;
  /** Painel do assistente aberto (o inspetor vazio some para dar espaço). */
  assistantOpen: boolean;
  /** Projeto a que este estado pertence (troca de projeto zera tudo). */
  projectId: string | null;

  bind(projectId: string): void;
  setZoom(z: number): void;
  setPlayhead(us: number): void;
  setPlaying(p: boolean): void;
  select(ids: string[]): void;
  toggleSelect(id: string): void;
  setClipboard(c: ClipboardData | null): void;
  setSnapping(s: boolean): void;
  setPreviewScale(s: 1 | 0.5 | 0.25): void;
  setAssetDrag(d: AssetDrag | null): void;
}

export const ZOOM_MIN = 2;
export const ZOOM_MAX = 2000;

export const useEditor = create<EditorState>((set, get) => ({
  zoom: 60,
  playheadUs: 0,
  playing: false,
  selection: [],
  clipboard: null,
  snapping: true,
  previewScale: 0.5,
  assetDrag: null,
  assistantOpen: false,
  projectId: null,

  bind(projectId) {
    if (get().projectId === projectId) return;
    set({ projectId, playheadUs: 0, playing: false, selection: [], zoom: 60 });
  },
  setZoom(z) {
    set({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) });
  },
  setPlayhead(us) {
    set({ playheadUs: Math.max(0, Math.round(us)) });
  },
  setPlaying(p) {
    set({ playing: p });
  },
  select(ids) {
    set({ selection: ids });
  },
  toggleSelect(id) {
    const s = get().selection;
    set({ selection: s.includes(id) ? s.filter((x) => x !== id) : [...s, id] });
  },
  setClipboard(c) {
    set({ clipboard: c });
  },
  setSnapping(s) {
    set({ snapping: s });
  },
  setPreviewScale(s) {
    set({ previewScale: s });
  },
  setAssetDrag(d) {
    set({ assetDrag: d });
  },
}));

export const usToPx = (us: number, zoom: number) => (us / 1_000_000) * zoom;
export const pxToUs = (px: number, zoom: number) => Math.round((px / zoom) * 1_000_000);

/** Atalhos do editor não valem enquanto digita ou com uma janela (diálogo) aberta. */
export function ignoreEditorKey(e: KeyboardEvent): boolean {
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return true;
  return !!document.querySelector('[aria-modal="true"]');
}
