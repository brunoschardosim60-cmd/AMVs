import { clipEndUs, formatTimecode, sourceDurationUs, trimClip, type Clip, type Command, type Project } from '@amv/project';
import { RotateCcw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { IconButton } from '../../ui/controls';
import { AssetDetail } from '../project/AssetDetail';
import { useEditor } from './editorStore';

/** Campo numérico que só grava ao confirmar (Enter/sair do campo) — um passo de desfazer por edição. */
function NumField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
  suffix,
  digits = 2,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  digits?: number;
}) {
  const [text, setText] = useState(fmt(value, digits));
  useEffect(() => setText(fmt(value, digits)), [value, digits]);
  const commit = () => {
    const v = Number(text.replace(',', '.'));
    if (!Number.isFinite(v)) {
      setText(fmt(value, digits));
      return;
    }
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (c !== value) onCommit(c);
    else setText(fmt(value, digits));
  };
  return (
    <label className="grid grid-cols-[1fr_96px] items-center gap-2 py-1 text-xs">
      <span className="text-muted">{label}</span>
      <span className="flex items-center rounded-control border border-line bg-base focus-within:border-violet">
        <input
          className="tnum h-7 w-full min-w-0 bg-transparent px-2 text-right text-xs text-ink outline-none"
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setText(fmt(value, digits));
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value + d)));
            }
          }}
        />
        {suffix && <span className="pr-2 text-2xs text-faint">{suffix}</span>}
      </span>
    </label>
  );
}

function fmt(v: number, digits: number) {
  return Number(v.toFixed(digits)).toLocaleString('pt-BR', { maximumFractionDigits: digits, useGrouping: false });
}

function Section({ title, children, onReset }: { title: string; children: ReactNode; onReset?: () => void }) {
  return (
    <section className="border-b border-line-soft px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-ink-soft">{title}</h3>
        {onReset && (
          <IconButton label={`Redefinir ${title.toLowerCase()}`} className="size-6" onClick={onReset}>
            <RotateCcw size={12} />
          </IconButton>
        )}
      </div>
      {children}
    </section>
  );
}

function ClipInspector({ session, project, clip }: { session: ProjectSession; project: Project; clip: Clip }) {
  const toast = useApp((s) => s.toast);
  const track = project.tracks.find((t) => t.id === clip.trackId)!;
  const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : null;
  const fps = project.settings.fps;
  const run = (label: string, cmds: Command[]) => {
    if (!cmds.length) return;
    try {
      session.history.transaction(label, cmds);
    } catch (e) {
      toast({ tone: 'error', title: 'Valor não aceito', body: (e as Error).message });
    }
  };
  const patch = (label: string, p: Partial<Clip>) => run(label, [{ type: 'clip.update', clipId: clip.id, patch: p }]);
  const tr = clip.transform;
  const visual = track.kind !== 'audio';
  const srcMax = sourceDurationUs(project, clip);
  const S = 1e6;

  return (
    <div className="text-sm">
      <div className="border-b border-line-soft px-4 py-3">
        <p className="truncate font-semibold">{clip.text?.text ?? clip.label ?? asset?.name}</p>
        <p className="tnum mt-0.5 text-xs text-muted">
          {track.name} · {formatTimecode(clip.timelineStartUs, fps)} → {formatTimecode(clipEndUs(clip), fps)}
        </p>
        {clip.origin === 'ai' && clip.reason && <p className="mt-2 rounded-md bg-violet/10 px-2 py-1.5 text-xs text-ink-soft">IA: {clip.reason}</p>}
        {track.locked && <p className="mt-2 text-xs text-warn">Trilha travada: destrave para editar.</p>}
      </div>

      <fieldset disabled={track.locked}>
        <Section title="Tempo">
          <NumField label="Início na timeline" suffix="s" value={clip.timelineStartUs / S} min={0} step={0.1} digits={3} onCommit={(v) => run('Mover clipe', [{ type: 'clip.update', clipId: clip.id, patch: { timelineStartUs: Math.round(v * S) } }])} />
          <NumField label="Duração" suffix="s" value={clip.durationUs / S} min={0.001} step={0.1} digits={3} onCommit={(v) => { try { run('Alterar duração', trimClip(project, clip.id, 'end', clip.timelineStartUs + Math.round(v * S))); } catch (e) { toast({ tone: 'warn', title: (e as Error).message }); } }} />
          {asset && (
            <>
              <NumField
                label="Entrada na origem"
                suffix="s"
                value={clip.sourceInUs / S}
                min={0}
                max={srcMax !== null ? (srcMax - (clip.sourceOutUs - clip.sourceInUs)) / S : undefined}
                step={0.1}
                digits={3}
                onCommit={(v) => {
                  // desliza o trecho de origem mantendo a duração (slip)
                  const d = Math.round(v * S) - clip.sourceInUs;
                  patch('Deslizar trecho', { sourceInUs: clip.sourceInUs + d, sourceOutUs: clip.sourceOutUs + d });
                }}
              />
              <NumField
                label="Velocidade"
                suffix="×"
                value={clip.speed}
                min={0.1}
                max={8}
                step={0.05}
                onCommit={(v) => {
                  // mantém o trecho de origem: muda a duração na timeline
                  const span = clip.sourceOutUs - clip.sourceInUs;
                  patch('Alterar velocidade', { speed: v, durationUs: Math.max(1000, Math.round(span / v)) });
                }}
              />
            </>
          )}
        </Section>

        {visual && (
          <Section title="Transformar" onReset={() => patch('Redefinir transformação', { transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: tr.opacity, crop: { left: 0, top: 0, right: 0, bottom: 0 } } })}>
            <NumField label="Posição X" suffix="px" value={tr.x} step={1} digits={0} onCommit={(v) => patch('Posição', { transform: { ...tr, x: v } })} />
            <NumField label="Posição Y" suffix="px" value={tr.y} step={1} digits={0} onCommit={(v) => patch('Posição', { transform: { ...tr, y: v } })} />
            <NumField label="Escala" suffix="%" value={tr.scale * 100} min={1} max={1000} step={1} digits={1} onCommit={(v) => patch('Escala', { transform: { ...tr, scale: v / 100 } })} />
            <NumField label="Rotação" suffix="°" value={tr.rotation} step={1} digits={1} onCommit={(v) => patch('Rotação', { transform: { ...tr, rotation: v } })} />
            <NumField label="Opacidade" suffix="%" value={tr.opacity * 100} min={0} max={100} step={5} digits={0} onCommit={(v) => patch('Opacidade', { transform: { ...tr, opacity: v / 100 } })} />
          </Section>
        )}

        {track.kind === 'audio' && (
          <Section title="Áudio" onReset={() => patch('Redefinir áudio', { audio: { ...clip.audio, gainDb: 0, fadeInUs: 0, fadeOutUs: 0 } })}>
            <NumField label="Volume" suffix="dB" value={clip.audio.gainDb} min={-60} max={0} step={1} digits={1} onCommit={(v) => patch('Volume', { audio: { ...clip.audio, gainDb: v } })} />
            <NumField label="Entrada suave" suffix="s" value={clip.audio.fadeInUs / S} min={0} max={clip.durationUs / S} step={0.1} digits={2} onCommit={(v) => patch('Entrada suave', { audio: { ...clip.audio, fadeInUs: Math.round(v * S) } })} />
            <NumField label="Saída suave" suffix="s" value={clip.audio.fadeOutUs / S} min={0} max={clip.durationUs / S} step={0.1} digits={2} onCommit={(v) => patch('Saída suave', { audio: { ...clip.audio, fadeOutUs: Math.round(v * S) } })} />
            <p className="mt-1 text-2xs text-muted">Volume acima de 0 dB chega com o mixer, na próxima fase.</p>
          </Section>
        )}
      </fieldset>
    </div>
  );
}

export function Inspector({ session, project, selectedAssetId }: { session: ProjectSession; project: Project; selectedAssetId: string | null }) {
  const selection = useEditor((s) => s.selection);
  const clips = selection.map((id) => project.clips.find((c) => c.id === id)).filter((c): c is Clip => !!c);
  const asset = selectedAssetId ? project.assets.find((a) => a.id === selectedAssetId) : null;

  if (clips.length === 1) {
    return (
      <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-panel" aria-label="Propriedades">
        <ClipInspector session={session} project={project} clip={clips[0]!} />
      </aside>
    );
  }
  if (clips.length > 1) {
    return (
      <aside className="w-[300px] shrink-0 border-l border-line bg-panel p-4 text-sm" aria-label="Propriedades">
        <p className="font-semibold">{clips.length} clipes selecionados</p>
        <p className="mt-1 text-xs text-muted">Arraste para mover juntos, Delete para excluir, Ctrl+C para copiar.</p>
      </aside>
    );
  }
  if (asset) return <AssetDetail asset={asset} session={session} />;
  return (
    <aside className="w-[300px] shrink-0 border-l border-line bg-panel p-4" aria-label="Propriedades">
      <p className="text-sm font-semibold text-ink-soft">Nada selecionado</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">Clique num clipe da timeline para ver e ajustar posição, escala, velocidade e volume.</p>
    </aside>
  );
}
