import { clipEndUs, colorGradingPreset, COLOR_GRADING_PRESETS, defaultParams, isSfxAsset, EFFECTS, evaluateKeyframes, fillScale, formatTimecode, newId, param, removeKeyframeAt, sourceDurationUs, SPEED_PRESETS, speedAt, speedFactorAt, speedKeyframesForPreset, TRANSITIONS, trimClip, upsertKeyframe, type Clip, type Command, type EffectId, type Keyframe, type Project, type TextWordTiming } from '@amv/project';
import { Eye, EyeOff, Pause, Play, Plus, RotateCcw, SkipForward, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { editSubtitleTextManually, langLabel, selectSubtitleTextVariant } from '@amv/subtitles';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { IconButton } from '../../ui/controls';
import { AssetDetail } from '../project/AssetDetail';
import { useEditor } from './editorStore';
import { TEXT_ANIMATIONS_IN, TEXT_ANIMATIONS_OUT } from './textLayer';

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
  const playheadUs = useEditor((state) => state.playheadUs);
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
  const keyframeAtUs = Math.max(0, Math.min(clip.durationUs, playheadUs - clip.timelineStartUs));
  const positionX = evaluateKeyframes(clip.keyframes['transform.x'], keyframeAtUs, tr.x);
  const positionY = evaluateKeyframes(clip.keyframes['transform.y'], keyframeAtUs, tr.y);
  const hasXKeyframe = clip.keyframes['transform.x']?.some((keyframe) => keyframe.atUs === keyframeAtUs) ?? false;
  const hasYKeyframe = clip.keyframes['transform.y']?.some((keyframe) => keyframe.atUs === keyframeAtUs) ?? false;
  const scaleAtPlayhead = evaluateKeyframes(clip.keyframes['transform.scale'], keyframeAtUs, tr.scale);
  const rotationAtPlayhead = evaluateKeyframes(clip.keyframes['transform.rotation'], keyframeAtUs, tr.rotation);
  const opacityAtPlayhead = evaluateKeyframes(clip.keyframes['transform.opacity'], keyframeAtUs, tr.opacity);
  const hasScaleKeyframe = clip.keyframes['transform.scale']?.some((keyframe) => keyframe.atUs === keyframeAtUs) ?? false;
  const hasRotationKeyframe = clip.keyframes['transform.rotation']?.some((keyframe) => keyframe.atUs === keyframeAtUs) ?? false;
  const hasOpacityKeyframe = clip.keyframes['transform.opacity']?.some((keyframe) => keyframe.atUs === keyframeAtUs) ?? false;
  const setPosition = (axis: 'x' | 'y', value: number) => {
    const path = `transform.${axis}`;
    if (clip.keyframes[path]?.length) {
      patch(`Animar posição ${axis.toUpperCase()}`, { keyframes: { ...clip.keyframes, [path]: upsertKeyframe(clip.keyframes[path], keyframeAtUs, value) } });
    } else {
      patch('Posição', { transform: { ...tr, [axis]: value } });
    }
  };
  const togglePositionKeyframe = (axis: 'x' | 'y') => {
    const path = `transform.${axis}`;
    const keyframes = hasXKeyframe && axis === 'x' || hasYKeyframe && axis === 'y'
      ? removeKeyframeAt(clip.keyframes[path], keyframeAtUs)
      : upsertKeyframe(clip.keyframes[path], keyframeAtUs, axis === 'x' ? positionX : positionY);
    patch(`${keyframes.some((keyframe) => keyframe.atUs === keyframeAtUs) ? 'Adicionar' : 'Remover'} quadro-chave ${axis.toUpperCase()}`, {
      keyframes: { ...clip.keyframes, [path]: keyframes },
    });
  };
  const setPositionEasing = (axis: 'x' | 'y', easing: Keyframe['easing']) => {
    const path = `transform.${axis}`;
    const keyframes = (clip.keyframes[path] ?? []).map((keyframe) =>
      keyframe.atUs === keyframeAtUs ? { ...keyframe, easing } : keyframe,
    );
    patch(`Interpolação da posição ${axis.toUpperCase()}`, { keyframes: { ...clip.keyframes, [path]: keyframes } });
  };
  const toggleTransformKeyframe = (property: 'scale' | 'rotation' | 'opacity', value: number) => {
    const path = `transform.${property}`;
    const exists = clip.keyframes[path]?.some((keyframe) => keyframe.atUs === keyframeAtUs) ?? false;
    const keyframes = exists
      ? removeKeyframeAt(clip.keyframes[path], keyframeAtUs)
      : upsertKeyframe(clip.keyframes[path], keyframeAtUs, value);
    const name = property === 'scale' ? 'escala' : property === 'rotation' ? 'rotação' : 'opacidade';
    patch(`${exists ? 'Remover' : 'Marcar'} quadro-chave de ${name}`, {
      keyframes: { ...clip.keyframes, [path]: keyframes },
    });
  };
  const setTransformKeyframeEasing = (property: 'scale' | 'rotation' | 'opacity', easing: Keyframe['easing']) => {
    const path = `transform.${property}`;
    const name = property === 'scale' ? 'escala' : property === 'rotation' ? 'rotação' : 'opacidade';
    patch(`Interpolação de ${name}`, {
      keyframes: {
        ...clip.keyframes,
        [path]: (clip.keyframes[path] ?? []).map((keyframe) =>
          keyframe.atUs === keyframeAtUs ? { ...keyframe, easing } : keyframe,
        ),
      },
    });
  };
  const setTransformValue = (property: 'scale' | 'rotation' | 'opacity', value: number) => {
    const path = `transform.${property}`;
    if (clip.keyframes[path]?.length) {
      const name = property === 'scale' ? 'escala' : property === 'rotation' ? 'rotação' : 'opacidade';
      patch(`Animar ${name}`, {
        keyframes: { ...clip.keyframes, [path]: upsertKeyframe(clip.keyframes[path], keyframeAtUs, value) },
      });
    } else {
      patch(property === 'scale' ? 'Escala' : property === 'rotation' ? 'Rotação' : 'Opacidade', { transform: { ...tr, [property]: value } });
    }
  };
  const patchTransitionParams = (params: Record<string, unknown>) => {
    if (clip.transitionIn) patch('Parâmetros da transição', { transitionIn: { ...clip.transitionIn, params } });
  };
  const speedKeyframes = clip.keyframes.speed ?? [];
  const setSpeedKeyframes = (next: Keyframe[]) => patch('Editar curva de velocidade', { keyframes: { ...clip.keyframes, speed: next } });
  const speedGraphMax = Math.max(2, ...Array.from({ length: 33 }, (_, index) => speedAt(clip, Math.round(clip.durationUs * index / 32))));
  const speedGraphPoints = Array.from({ length: 33 }, (_, index) => {
    const x = (index / 32) * 240;
    const rate = speedAt(clip, Math.round(clip.durationUs * index / 32));
    const y = 35 - (rate / speedGraphMax) * 30;
    return `${x},${y}`;
  }).join(' ');
  const addSpeedKeyframe = () => {
    const value = speedFactorAt(clip, keyframeAtUs);
    setSpeedKeyframes(upsertKeyframe(speedKeyframes, keyframeAtUs, value));
  };
  const pictureInPicture = () => {
    const keyframes = { ...clip.keyframes };
    for (const path of ['transform.x', 'transform.y', 'transform.scale']) delete keyframes[path];
    patch('Aplicar Picture in Picture', {
      transform: { ...tr, x: project.settings.width * 0.31, y: -project.settings.height * 0.31, scale: 0.34 },
      keyframes,
    });
  };
  const isEditorialCut = clip.transitionIn?.transition === 'match_cut' || clip.transitionIn?.transition === 'cut_on_action';

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
                  const keyframes = { ...clip.keyframes };
                  delete keyframes.speed;
                  patch('Alterar velocidade', { speed: v, durationUs: Math.max(1000, Math.round(span / v)), keyframes });
                }}
              />
              <label className="flex items-center justify-between py-1 text-xs">
                <span className="text-muted">Reverter vídeo</span>
                <input type="checkbox" className="accent-violet" checked={clip.reverse} onChange={(event) => patch('Reverter vídeo', { reverse: event.target.checked })} />
              </label>
              <label className="grid grid-cols-[1fr_150px] items-center gap-2 py-1 text-xs">
                <span className="text-muted">Pitch do áudio</span>
                <select
                  className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink"
                  value={clip.audio.pitchMode}
                  onChange={(event) => patch('Pitch do áudio', { audio: { ...clip.audio, pitchMode: event.target.value as Clip['audio']['pitchMode'] } })}
                >
                  <option value="preserve">Preservar</option>
                  <option value="follow">Acompanhar velocidade</option>
                </select>
              </label>
              <div className="mt-2 border-t border-line-soft pt-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-soft">Curva de velocidade</span>
                  <span className="tnum text-2xs text-muted">{speedAt(clip, keyframeAtUs).toFixed(2)}×</span>
                </div>
                <svg viewBox="0 0 240 40" className="h-12 w-full overflow-visible rounded-control border border-line-soft bg-base" role="img" aria-label="Gráfico de velocidade ao longo do clipe">
                  <path d="M0 35H240 M0 20H240 M0 5H240" stroke="currentColor" strokeOpacity="0.12" fill="none" />
                  <polyline points={speedGraphPoints} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-violet" />
                  {speedKeyframes.map((keyframe, index) => (
                    <circle key={`${keyframe.atUs}-${index}`} cx={(keyframe.atUs / clip.durationUs) * 240} cy={35 - (speedAt(clip, keyframe.atUs) / speedGraphMax) * 30} r="2.5" className="fill-azure" />
                  ))}
                </svg>
                <label className="mt-1 grid grid-cols-[1fr_150px] items-center gap-2 py-1 text-xs">
                  <span className="text-muted">Preset editável</span>
                  <select
                    className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink"
                    value=""
                    onChange={(event) => {
                      const preset = SPEED_PRESETS.find((item) => item.id === event.target.value);
                      if (preset) setSpeedKeyframes(speedKeyframesForPreset(clip, preset.id));
                    }}
                    aria-label="Preset de velocidade"
                  >
                    <option value="">Escolher…</option>
                    {SPEED_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                  </select>
                </label>
                <button type="button" className="h-7 w-full rounded-control border border-line bg-base text-2xs hover:bg-hover" onClick={addSpeedKeyframe}>
                  Adicionar ponto no playhead
                </button>
                {speedKeyframes.length > 0 && (
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {speedKeyframes.map((keyframe, index) => (
                      <div key={`${keyframe.atUs}-${index}`} className="rounded-control border border-line-soft px-2 py-1">
                        <div className="flex items-center justify-between text-2xs text-muted">
                          <span>Ponto {index + 1} · {(keyframe.atUs / S).toFixed(2)} s</span>
                          <button type="button" className="text-warn hover:text-ink" onClick={() => setSpeedKeyframes(removeKeyframeAt(speedKeyframes, keyframe.atUs))} aria-label={`Remover ponto ${index + 1}`}>Remover</button>
                        </div>
                        <NumField label="Fator" suffix="×" value={keyframe.value} min={0} max={4} step={0.05} onCommit={(value) => setSpeedKeyframes(speedKeyframes.map((item) => item.atUs === keyframe.atUs ? { ...item, value } : item))} />
                        <label className="grid grid-cols-[1fr_130px] items-center gap-2 py-1 text-xs">
                          <span className="text-muted">Interpolação até aqui</span>
                          <select
                            className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink"
                            value={keyframe.easing}
                            onChange={(event) => setSpeedKeyframes(speedKeyframes.map((item) => item.atUs === keyframe.atUs ? { ...item, easing: event.target.value as Keyframe['easing'] } : item))}
                          >
                            <option value="linear">Linear</option><option value="hold">Manter</option><option value="ease-in">Acelerar</option><option value="ease-out">Desacelerar</option><option value="ease-in-out">Suave</option>
                          </select>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-2xs text-muted">0× congela o quadro. A curva redistribui a reprodução dentro do trecho selecionado, sem alterar seus limites. Reverse no preview é busca quadro a quadro; o áudio do clipe invertido fica mudo.</p>
              </div>
            </>
          )}
        </Section>

        {visual && (
          <Section title="Transformar" onReset={() => {
            const keyframes = { ...clip.keyframes };
            delete keyframes['transform.x'];
            delete keyframes['transform.y'];
            patch('Redefinir transformação', { transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: tr.opacity, crop: { left: 0, top: 0, right: 0, bottom: 0 } }, keyframes });
          }}>
            <FitButtons session={session} project={project} ids={[clip.id]} />
            <NumField label="Posição X" suffix="px" value={positionX} step={1} digits={0} onCommit={(v) => setPosition('x', v)} />
            <button type="button" className="mb-1 flex items-center gap-1 rounded px-1 py-1 text-2xs text-muted hover:bg-raised hover:text-ink" onClick={() => togglePositionKeyframe('x')} aria-label={`${hasXKeyframe ? 'Remover' : 'Adicionar'} quadro-chave X`}>
              {hasXKeyframe ? <Trash2 size={11} /> : <Plus size={11} />}
              {hasXKeyframe ? 'Remover chave X neste tempo' : 'Marcar X neste tempo'}
            </button>
            <label className="grid grid-cols-[1fr_120px] items-center gap-2 py-1 text-2xs">
              <span className="text-muted">Interpolação X</span>
              <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" disabled={!hasXKeyframe} value={clip.keyframes['transform.x']?.find((keyframe) => keyframe.atUs === keyframeAtUs)?.easing ?? 'linear'} onChange={(e) => setPositionEasing('x', e.target.value as Keyframe['easing'])}>
                <option value="linear">Linear</option>
                <option value="hold">Manter</option>
                <option value="ease-in">Ease in</option>
                <option value="ease-out">Ease out</option>
                <option value="ease-in-out">Suave</option>
              </select>
            </label>
            <NumField label="Posição Y" suffix="px" value={positionY} step={1} digits={0} onCommit={(v) => setPosition('y', v)} />
            <button type="button" className="mb-1 flex items-center gap-1 rounded px-1 py-1 text-2xs text-muted hover:bg-raised hover:text-ink" onClick={() => togglePositionKeyframe('y')} aria-label={`${hasYKeyframe ? 'Remover' : 'Adicionar'} quadro-chave Y`}>
              {hasYKeyframe ? <Trash2 size={11} /> : <Plus size={11} />}
              {hasYKeyframe ? 'Remover chave Y neste tempo' : 'Marcar Y neste tempo'}
            </button>
            <label className="grid grid-cols-[1fr_120px] items-center gap-2 py-1 text-2xs">
              <span className="text-muted">Interpolação Y</span>
              <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" disabled={!hasYKeyframe} value={clip.keyframes['transform.y']?.find((keyframe) => keyframe.atUs === keyframeAtUs)?.easing ?? 'linear'} onChange={(e) => setPositionEasing('y', e.target.value as Keyframe['easing'])}>
                <option value="linear">Linear</option>
                <option value="hold">Manter</option>
                <option value="ease-in">Ease in</option>
                <option value="ease-out">Ease out</option>
                <option value="ease-in-out">Suave</option>
              </select>
            </label>
            <NumField label="Escala" suffix="%" value={scaleAtPlayhead * 100} min={1} max={1000} step={1} digits={1} onCommit={(v) => setTransformValue('scale', v / 100)} />
            <button type="button" className="mb-1 flex items-center gap-1 rounded px-1 py-1 text-2xs text-muted hover:bg-raised hover:text-ink" onClick={() => toggleTransformKeyframe('scale', scaleAtPlayhead)} aria-label={`${hasScaleKeyframe ? 'Remover' : 'Adicionar'} quadro-chave de escala`}>
              {hasScaleKeyframe ? <Trash2 size={11} /> : <Plus size={11} />}{hasScaleKeyframe ? 'Remover chave de escala neste tempo' : 'Marcar escala neste tempo'}
            </button>
            <label className="grid grid-cols-[1fr_120px] items-center gap-2 py-1 text-2xs">
              <span className="text-muted">Interpolação da escala</span>
              <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" disabled={!hasScaleKeyframe} value={clip.keyframes['transform.scale']?.find((keyframe) => keyframe.atUs === keyframeAtUs)?.easing ?? 'linear'} onChange={(e) => setTransformKeyframeEasing('scale', e.target.value as Keyframe['easing'])}>
                <option value="linear">Linear</option><option value="hold">Manter</option><option value="ease-in">Ease in</option><option value="ease-out">Ease out</option><option value="ease-in-out">Suave</option>
              </select>
            </label>
            <NumField label="Rotação" suffix="°" value={rotationAtPlayhead} step={1} digits={1} onCommit={(v) => setTransformValue('rotation', v)} />
            <button type="button" className="mb-1 flex items-center gap-1 rounded px-1 py-1 text-2xs text-muted hover:bg-raised hover:text-ink" onClick={() => toggleTransformKeyframe('rotation', rotationAtPlayhead)} aria-label={`${hasRotationKeyframe ? 'Remover' : 'Adicionar'} quadro-chave de rotação`}>
              {hasRotationKeyframe ? <Trash2 size={11} /> : <Plus size={11} />}{hasRotationKeyframe ? 'Remover chave de rotação neste tempo' : 'Marcar rotação neste tempo'}
            </button>
            <label className="grid grid-cols-[1fr_120px] items-center gap-2 py-1 text-2xs">
              <span className="text-muted">Interpolação da rotação</span>
              <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" disabled={!hasRotationKeyframe} value={clip.keyframes['transform.rotation']?.find((keyframe) => keyframe.atUs === keyframeAtUs)?.easing ?? 'linear'} onChange={(e) => setTransformKeyframeEasing('rotation', e.target.value as Keyframe['easing'])}>
                <option value="linear">Linear</option><option value="hold">Manter</option><option value="ease-in">Ease in</option><option value="ease-out">Ease out</option><option value="ease-in-out">Suave</option>
              </select>
            </label>
            <NumField label="Opacidade" suffix="%" value={opacityAtPlayhead * 100} min={0} max={100} step={5} digits={0} onCommit={(v) => setTransformValue('opacity', v / 100)} />
            <button type="button" className="mb-1 flex items-center gap-1 rounded px-1 py-1 text-2xs text-muted hover:bg-raised hover:text-ink" onClick={() => toggleTransformKeyframe('opacity', opacityAtPlayhead)} aria-label={`${hasOpacityKeyframe ? 'Remover' : 'Adicionar'} quadro-chave de opacidade`}>
              {hasOpacityKeyframe ? <Trash2 size={11} /> : <Plus size={11} />}{hasOpacityKeyframe ? 'Remover chave de opacidade neste tempo' : 'Marcar opacidade neste tempo'}
            </button>
            <label className="grid grid-cols-[1fr_120px] items-center gap-2 py-1 text-2xs">
              <span className="text-muted">Interpolação da opacidade</span>
              <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" disabled={!hasOpacityKeyframe} value={clip.keyframes['transform.opacity']?.find((keyframe) => keyframe.atUs === keyframeAtUs)?.easing ?? 'linear'} onChange={(e) => setTransformKeyframeEasing('opacity', e.target.value as Keyframe['easing'])}>
                <option value="linear">Linear</option><option value="hold">Manter</option><option value="ease-in">Ease in</option><option value="ease-out">Ease out</option><option value="ease-in-out">Suave</option>
              </select>
            </label>
            <button type="button" className="mt-2 w-full rounded-control border border-violet/40 bg-violet/10 px-2 py-1.5 text-xs text-ink-soft hover:bg-violet/20" onClick={pictureInPicture}>
              Picture in picture · canto superior direito
            </button>
          </Section>
        )}

        {visual && (
          <Section title="Composição">
            <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
              <span className="text-muted">Mesclagem</span>
              <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" value={clip.blendMode} onChange={(event) => patch('Modo de mesclagem', { blendMode: event.target.value as Clip['blendMode'] })}>
                <option value="normal">Normal</option><option value="multiply">Multiplicar</option><option value="screen">Tela</option><option value="overlay">Sobrepor</option><option value="darken">Escurecer</option><option value="lighten">Clarear</option><option value="addition">Adicionar</option>
              </select>
            </label>
            <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
              <span className="text-muted">Máscara</span>
              <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" value={clip.mask} onChange={(event) => patch('Máscara', { mask: event.target.value as Clip['mask'] })}>
                <option value="none">Nenhuma</option><option value="circle">Elipse</option><option value="left">Metade esquerda</option><option value="right">Metade direita</option><option value="top">Metade superior</option><option value="bottom">Metade inferior</option>
              </select>
            </label>
            <p className="mt-1 mb-2 text-2xs text-muted">A máscara é aplicada ao recorte da camada; o modo de mesclagem também vale no render final.</p>
            {(['left', 'top', 'right', 'bottom'] as const).map((side) => (
              <NumField
                key={side}
                label={`Recorte ${side === 'left' ? 'esquerdo' : side === 'top' ? 'superior' : side === 'right' ? 'direito' : 'inferior'}`}
                suffix="%"
                value={tr.crop[side] * 100}
                min={0}
                max={49}
                step={1}
                digits={0}
                onCommit={(value) => patch('Recortar camada', { transform: { ...tr, crop: { ...tr.crop, [side]: value / 100 } } })}
              />
            ))}
          </Section>
        )}

        {clip.text && <TextSection clip={clip} patch={patch} />}

        {visual && <EffectsSection clip={clip} patch={patch} />}

        {visual && (
          <Section title="Transição de entrada">
            <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
              <span className="text-muted">Tipo</span>
              <select
                className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink"
                value={clip.transitionIn?.transition ?? ''}
                onChange={(e) => {
                  const transition = e.target.value;
                  const editorialCut = transition === 'match_cut' || transition === 'cut_on_action';
                  const params: Record<string, unknown> = transition
                    ? {
                        curve: 'linear',
                        intensity: transition === 'flash' ? 0.8 : transition === 'whip_pan' ? 0.65 : 1,
                        ...(transition === 'whip_pan' ? { direction: 1, blur: 8 } : {}),
                      }
                    : {};
                  patch('Transição', {
                    transitionIn: transition
                      ? { transition, durationUs: editorialCut ? 0 : clip.transitionIn?.durationUs || 400_000, params }
                      : null,
                  });
                }}
              >
                <option value="">Corte seco</option>
                {TRANSITIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {clip.transitionIn && (
              <>
                {!isEditorialCut && (
                  <>
                    <NumField
                      label="Duração"
                      suffix="s"
                      value={clip.transitionIn.durationUs / S}
                      min={0.05}
                      max={Math.min(3, clip.durationUs / S)}
                      step={0.05}
                      onCommit={(v) => patch('Duração da transição', { transitionIn: { ...clip.transitionIn!, durationUs: Math.round(v * S) } })}
                    />
                    <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
                      <span className="text-muted">Curva</span>
                      <select
                        className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink"
                        value={String(clip.transitionIn.params.curve ?? 'linear')}
                        onChange={(e) => {
                          const curve = e.target.value;
                          if (curve === 'linear' || curve === 'ease-in' || curve === 'ease-out' || curve === 'ease-in-out') {
                            patchTransitionParams({ ...clip.transitionIn!.params, curve });
                          }
                        }}
                      >
                        <option value="linear">Linear</option>
                        <option value="ease-in">Suave na entrada</option>
                        <option value="ease-out">Suave na saída</option>
                        <option value="ease-in-out">Suave nos dois lados</option>
                      </select>
                    </label>
                  </>
                )}
                {!isEditorialCut && (
                  <NumField
                    label="Intensidade"
                    value={typeof clip.transitionIn.params.intensity === 'number'
                      ? clip.transitionIn.params.intensity
                      : clip.transitionIn.transition === 'flash' ? 0.8 : clip.transitionIn.transition === 'whip_pan' ? 0.65 : 1}
                    min={clip.transitionIn.transition === 'whip_pan' ? 0.1 : 0}
                    max={1}
                    step={0.05}
                    onCommit={(v) => patchTransitionParams({ ...clip.transitionIn!.params, intensity: v })}
                  />
                )}
                {clip.transitionIn.transition === 'whip_pan' && (
                  <>
                    <NumField
                      label="Desfoque"
                      suffix="px"
                      value={typeof clip.transitionIn.params.blur === 'number' ? clip.transitionIn.params.blur : 8}
                      min={0}
                      max={32}
                      step={1}
                      onCommit={(v) => patchTransitionParams({ ...clip.transitionIn!.params, blur: v })}
                    />
                    <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
                      <span className="text-muted">Direção</span>
                      <select
                        className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink"
                        value={clip.transitionIn.params.direction === -1 ? '-1' : '1'}
                        onChange={(e) => patchTransitionParams({ ...clip.transitionIn!.params, direction: Number(e.target.value) })}
                      >
                        <option value="1">Direita</option>
                        <option value="-1">Esquerda</option>
                      </select>
                    </label>
                  </>
                )}
              </>
            )}
            <p className="mt-1 text-2xs text-muted">
              {isEditorialCut ? 'Corte seco intencional; sem sobreposição artificial.' : 'O clipe anterior continua por baixo durante a transição.'}
            </p>
          </Section>
        )}

        {track.kind === 'audio' && (
          <Section title="Áudio" onReset={() => patch('Redefinir áudio', { audio: { ...clip.audio, gainDb: 0, fadeInUs: 0, fadeOutUs: 0 } })}>
            <NumField label="Volume" suffix="dB" value={clip.audio.gainDb} min={-60} max={12} step={1} digits={1} onCommit={(v) => patch('Volume', { audio: { ...clip.audio, gainDb: v } })} />
            <NumField label="Entrada suave" suffix="s" value={clip.audio.fadeInUs / S} min={0} max={clip.durationUs / S} step={0.1} digits={2} onCommit={(v) => patch('Entrada suave', { audio: { ...clip.audio, fadeInUs: Math.round(v * S) } })} />
            <NumField label="Saída suave" suffix="s" value={clip.audio.fadeOutUs / S} min={0} max={clip.durationUs / S} step={0.1} digits={2} onCommit={(v) => patch('Saída suave', { audio: { ...clip.audio, fadeOutUs: Math.round(v * S) } })} />
            {asset?.probe && asset.probe.audio.length > 1 && (
              <label className="grid grid-cols-[1fr_150px] items-center gap-2 py-1 text-xs">
                <span className="text-muted">Faixa de áudio</span>
                <select
                  className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink"
                  value={clip.audio.streamIndex ?? ''}
                  onChange={(e) => patch('Faixa de áudio', { audio: { ...clip.audio, streamIndex: e.target.value === '' ? null : Number(e.target.value) } })}
                >
                  <option value="">1ª faixa</option>
                  {asset.probe.audio.map((a, i) => (
                    <option key={a.index} value={a.index}>
                      {i + 1}ª — {a.language ?? a.codec}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="mt-1 text-2xs text-muted">O preview aplica ganho acima de 0 dB com compressão de pico. A seleção de faixa de áudio ainda só vale na exportação; o preview usa a faixa incluída no proxy.</p>
          </Section>
        )}
      </fieldset>
    </div>
  );
}

function TextSection({ clip, patch }: { clip: Clip; patch: (label: string, p: Partial<Clip>) => void }) {
  const S = 1_000_000;
  const t = clip.text!;
  const [text, setText] = useState(t.text);
  const [font, setFont] = useState(t.font);
  const [wordIndex, setWordIndex] = useState(0);
  const playheadUs = useEditor((state) => state.playheadUs);
  const playing = useEditor((state) => state.playing);
  const setPlayhead = useEditor((state) => state.setPlayhead);
  const setPlaying = useEditor((state) => state.setPlaying);
  const words = t.wordTimings ?? [];
  const word = words[wordIndex];
  const syllables = word?.syllables ?? [];
  const textVariant = t.textSource === 'translation' ? `translation:${t.lang ?? ''}` : t.textSource;
  useEffect(() => setText(t.text), [t.text]);
  useEffect(() => setFont(t.font), [t.font]);
  const set = (label: string, p: Partial<NonNullable<Clip['text']>>) => patch(label, { text: { ...t, ...p } });
  useEffect(() => {
    if (!playing || !word) return;
    if (playheadUs >= clip.timelineStartUs + word.endUs) setPlaying(false);
  }, [clip.timelineStartUs, playheadUs, playing, setPlaying, word]);
  const updateWord = (label: string, values: Partial<TextWordTiming>) => {
    if (!word) return;
    const updated = words.map((item, index) =>
      index === wordIndex
        ? { ...item, ...values, ...(values.startUs !== undefined || values.endUs !== undefined ? { source: 'manual' as const, confidence: 1, uncertain: false } : {}) }
        : item,
    );
    set(label, { wordTimings: updated, timingPrecision: 'manual' });
  };
  const updateSyllable = (index: number, values: Partial<NonNullable<TextWordTiming['syllables']>[number]>) => {
    if (!word) return;
    updateWord('Ajustar tempo da sílaba', {
      syllables: syllables.map((item, syllableIndex) => syllableIndex === index
        ? { ...item, ...values, source: 'manual', confidence: 1, uncertain: false }
        : item),
    });
  };
  const seekWord = (index: number, play: boolean) => {
    const selected = words[index];
    if (!selected) return;
    setWordIndex(index);
    setPlayhead(clip.timelineStartUs + selected.startUs);
    setPlaying(play);
  };
  return (
    <Section title="Texto">
      {(Object.keys(t.translations).length > 0 || t.manualText !== null) && (
        <label className="mb-2 grid grid-cols-[1fr_150px] items-center gap-2 text-xs">
          <span className="text-muted">Versão do texto</span>
          <select
            className="h-7 min-w-0 rounded-control border border-line bg-base px-1 text-xs text-ink"
            value={textVariant}
            onChange={(event) => {
              const value = event.target.value;
              const selected = value === 'original'
                ? selectSubtitleTextVariant(t, { type: 'original' })
                : value === 'manual'
                  ? selectSubtitleTextVariant(t, { type: 'manual' })
                  : selectSubtitleTextVariant(t, { type: 'translation', lang: value.slice('translation:'.length) });
              setText(selected.text);
              set('Versão do texto', selected);
            }}
            aria-label="Versão do texto"
          >
            {t.original !== undefined && <option value="original">Original</option>}
            {Object.keys(t.translations).sort().map((lang) => <option key={lang} value={`translation:${lang}`}>Tradução · {langLabel(lang)}</option>)}
            {t.manualText !== null && <option value="manual">Manual</option>}
          </select>
        </label>
      )}
      <textarea
        className="mb-2 h-20 w-full resize-none rounded-control border border-line bg-base p-2 text-sm text-ink outline-none focus:border-violet"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== t.text && set('Editar texto', editSubtitleTextManually(t, text))}
        aria-label="Texto"
      />
      {t.original !== undefined && (
        <div className="mb-2 rounded-control border border-line-soft bg-base/60 p-2 text-2xs">
          <p className="font-medium text-muted">Original{t.lang ? ` · texto atual: ${t.lang}` : ''}</p>
          <p className="mt-1 whitespace-pre-wrap text-ink-soft">{t.original}</p>
        </div>
      )}
      <label className="grid grid-cols-[1fr_150px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Fonte local instalada</span>
        <input
          list="amv-local-fonts"
          className="h-7 min-w-0 rounded-control border border-line bg-base px-2 text-xs text-ink"
          value={font}
          onChange={(event) => setFont(event.target.value)}
          onBlur={() => {
            const next = font.trim() || 'Manrope Variable';
            setFont(next);
            if (next !== t.font) set('Fonte da tipografia', { font: next });
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          aria-label="Família tipográfica local"
        />
        <datalist id="amv-local-fonts">
          {['Manrope Variable', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Consolas', 'Georgia', 'Impact', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'].map((font) => <option key={font} value={font} />)}
        </datalist>
      </label>
      <p className="mb-1 text-2xs text-faint">Use fontes instaladas no Windows. Preview e exportação rasterizada usam a mesma fonte disponível neste computador.</p>
      <NumField label="Tamanho" suffix="px" value={t.size} min={8} max={400} step={2} digits={0} onCommit={(v) => set('Tamanho do texto', { size: v })} />
      <NumField label="Peso" value={t.weight ?? 700} min={100} max={900} step={100} digits={0} onCommit={(v) => set('Peso da fonte', { weight: Math.round(v / 100) * 100 })} />
      <label className="grid grid-cols-[1fr_96px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Cor</span>
        <input type="color" className="h-7 w-full rounded-control border border-line bg-base" value={t.color} onChange={(e) => set('Cor do texto', { color: e.target.value })} />
      </label>
      <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Fundo</span>
        <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" value={t.background ?? 'none'} onChange={(e) => set('Fundo do texto', { background: e.target.value as NonNullable<typeof t.background> })}>
          <option value="none">Sem fundo</option>
          <option value="bar">Faixa preta</option>
          <option value="box">Caixa translúcida</option>
          <option value="full">Tela preta</option>
        </select>
      </label>
      {(t.background === 'box' || t.background === 'bar') && (
        <NumField label="Opacidade do fundo" suffix="%" value={t.backgroundOpacity * 100} min={0} max={100} step={5} digits={0} onCommit={(v) => set('Opacidade do fundo', { backgroundOpacity: v / 100 })} />
      )}
      <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Alinhamento</span>
        <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" value={t.alignment} onChange={(e) => set('Alinhamento do texto', { alignment: e.target.value as NonNullable<typeof t.alignment> })}>
          <option value="left">Esquerda</option>
          <option value="center">Centro</option>
          <option value="right">Direita</option>
        </select>
      </label>
      <NumField label="Largura máxima" suffix="%" value={t.maxWidthRatio * 100} min={20} max={100} step={5} digits={0} onCommit={(v) => set('Largura máxima do texto', { maxWidthRatio: v / 100 })} />
      <NumField label="Margem lateral" suffix="px" value={t.marginX} min={0} max={500} step={8} digits={0} onCommit={(v) => set('Margem lateral', { marginX: v })} />
      <NumField label="Margem vertical" suffix="px" value={t.marginY} min={0} max={500} step={8} digits={0} onCommit={(v) => set('Margem vertical', { marginY: v })} />
      <NumField label="Espaço entre linhas" suffix="×" value={t.lineSpacing} min={0.8} max={2} step={0.05} digits={2} onCommit={(v) => set('Espaço entre linhas', { lineSpacing: v })} />
      <NumField label="Espaço entre letras" suffix="px" value={t.letterSpacing} min={-10} max={40} step={1} digits={0} onCommit={(v) => set('Espaço entre letras', { letterSpacing: v })} />
      <label className="grid grid-cols-[1fr_96px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Contorno</span>
        <input type="color" className="h-7 w-full rounded-control border border-line bg-base" value={t.outlineColor ?? '#000000'} onChange={(e) => set('Cor do contorno', { outlineColor: e.target.value, outlineWidth: t.outlineWidth || 3 })} />
      </label>
      <NumField label="Espessura do contorno" suffix="px" value={t.outlineWidth} min={0} max={20} step={1} digits={0} onCommit={(v) => set('Contorno', { outlineWidth: v })} />
      <label className="flex items-center justify-between py-1 text-xs">
        <span className="text-muted">Sombra</span>
        <input type="checkbox" className="accent-violet" checked={t.shadow} onChange={(e) => set('Sombra', { shadow: e.target.checked })} />
      </label>
      <label className="grid grid-cols-[1fr_96px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Cor da palavra ativa</span>
        <input type="color" className="h-7 w-full rounded-control border border-line bg-base" value={t.highlightColor ?? '#ffd166'} onChange={(e) => set('Cor da palavra ativa', { highlightColor: e.target.value })} />
      </label>
      <NumField label="Escala da palavra ativa" suffix="×" value={t.highlightScale} min={1} max={2} step={0.05} digits={2} onCommit={(v) => set('Escala da palavra ativa', { highlightScale: v })} />
      <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Preenchimento</span>
        <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" value={t.fillStyle} onChange={(e) => set('Preenchimento tipográfico', { fillStyle: e.target.value as NonNullable<typeof t.fillStyle> })}>
          <option value="solid">Cor sólida</option><option value="linear-gradient">Gradiente linear</option>
        </select>
      </label>
      {t.fillStyle === 'linear-gradient' && (
        <>
          <label className="grid grid-cols-[1fr_96px] items-center gap-2 py-1 text-xs"><span className="text-muted">Gradiente · início</span><input type="color" className="h-7 w-full rounded-control border border-line bg-base" value={t.gradientStartColor} onChange={(e) => set('Cor inicial do gradiente', { gradientStartColor: e.target.value })} /></label>
          <label className="grid grid-cols-[1fr_96px] items-center gap-2 py-1 text-xs"><span className="text-muted">Gradiente · fim</span><input type="color" className="h-7 w-full rounded-control border border-line bg-base" value={t.gradientEndColor} onChange={(e) => set('Cor final do gradiente', { gradientEndColor: e.target.value })} /></label>
        </>
      )}
      <label className="grid grid-cols-[1fr_96px] items-center gap-2 py-1 text-xs"><span className="text-muted">Cor do glow</span><input type="color" className="h-7 w-full rounded-control border border-line bg-base" value={t.glowColor} onChange={(e) => set('Cor do glow', { glowColor: e.target.value })} /></label>
      <NumField label="Intensidade do glow" suffix="px" value={t.glowIntensity} min={0} max={50} step={1} digits={0} onCommit={(v) => set('Intensidade do glow', { glowIntensity: v })} />
      <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Animação da palavra</span>
        <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" value={t.wordAnimation} onChange={(e) => set('Animação da palavra ativa', { wordAnimation: e.target.value as NonNullable<typeof t.wordAnimation> })}>
          <option value="none">Nenhuma</option><option value="highlight">Realce</option><option value="pop">Pop suave</option><option value="fade">Aparecer</option>
        </select>
      </label>
      <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Seção / preset</span>
        <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" value={t.section} onChange={(e) => set('Seção tipográfica', { section: e.target.value as NonNullable<typeof t.section> })}>
          <option value="intro">Introdução</option><option value="verse">Verso</option><option value="chorus">Refrão</option><option value="climax">Clímax</option><option value="custom">Personalizado</option>
        </select>
      </label>
      <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Entrada</span>
        <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" value={t.animationIn ?? ''} onChange={(e) => set('Animação de entrada', { animationIn: (e.target.value || null) as NonNullable<typeof t.animationIn> | null })}>
          {TEXT_ANIMATIONS_IN.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <NumField label="Duração da entrada" suffix="s" value={t.animationInUs / S} min={0} max={2} step={0.05} digits={2} onCommit={(v) => set('Duração da animação de entrada', { animationInUs: Math.round(v * S) })} />
      <NumField label="Duração da saída" suffix="s" value={t.animationOutUs / S} min={0} max={2} step={0.05} digits={2} onCommit={(v) => set('Duração da animação de saída', { animationOutUs: Math.round(v * S) })} />
      <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Saída</span>
        <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" value={t.animationOut ?? ''} onChange={(e) => set('Animação de saída', { animationOut: (e.target.value || null) as NonNullable<typeof t.animationOut> | null })}>
          {TEXT_ANIMATIONS_OUT.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      {words.length > 0 ? (
        <div className="mt-3 border-t border-line-soft pt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-soft">Sincronização por palavra</span>
            <span className="text-2xs text-faint">{word?.source === 'manual' ? 'editada' : word?.source === 'ass' ? 'ASS' : word?.source === 'lrc' ? 'LRC' : 'Whisper · revisar'}</span>
          </div>
          <div className="mb-2 flex gap-1">
            <button type="button" className="flex h-7 flex-1 items-center justify-center gap-1 rounded-control border border-line bg-base text-2xs hover:bg-hover" onClick={() => seekWord(wordIndex, true)} disabled={!word}>
              {playing ? <Pause size={12} /> : <Play size={12} />} Ouvir palavra
            </button>
            <button type="button" aria-label="Próxima palavra" title="Próxima palavra" className="grid size-7 place-items-center rounded-control border border-line bg-base hover:bg-hover" onClick={() => seekWord(Math.min(wordIndex + 1, words.length - 1), false)} disabled={wordIndex >= words.length - 1}>
              <SkipForward size={13} />
            </button>
          </div>
          <div className="max-h-28 space-y-0.5 overflow-y-auto rounded-control border border-line-soft p-1">
            {words.map((item, index) => (
              <button key={`${item.startUs}-${index}`} type="button" className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-2xs ${index === wordIndex ? 'bg-violet/15 text-ink' : 'text-muted hover:bg-hover'}`} onClick={() => seekWord(index, false)}>
                <span className="min-w-0 flex-1 truncate">{item.text}</span>
                <span className="tnum shrink-0">{(item.startUs / 1e6).toFixed(2)}–{(item.endUs / 1e6).toFixed(2)}s</span>
                {(item.uncertain || (item.confidence !== null && item.confidence < 0.78)) && <span className="text-amber-300">incerta</span>}
              </button>
            ))}
          </div>
          {word && (
            <div className="mt-2 space-y-0.5">
              <NumField label="Início relativo" suffix="s" value={word.startUs / 1e6} min={0} max={clip.durationUs / 1e6} step={0.01} digits={2} onCommit={(v) => updateWord('Ajustar início da palavra', { startUs: Math.min(Math.round(v * 1e6), word.endUs - 1) })} />
              <NumField label="Fim relativo" suffix="s" value={word.endUs / 1e6} min={0.001} max={clip.durationUs / 1e6} step={0.01} digits={2} onCommit={(v) => updateWord('Ajustar fim da palavra', { endUs: Math.max(Math.round(v * 1e6), word.startUs + 1) })} />
              <label className="grid grid-cols-[1fr_96px] items-center gap-2 py-1 text-xs">
                <span className="text-muted">Cor desta palavra</span>
                <input type="color" className="h-7 w-full rounded-control border border-line bg-base" value={word.color ?? t.color} onChange={(e) => updateWord('Cor da palavra', { color: e.target.value })} />
              </label>
              <NumField label="Escala desta palavra" suffix="×" value={word.scale ?? 1} min={0.5} max={3} step={0.05} digits={2} onCommit={(v) => updateWord('Escala da palavra', { scale: v })} />
              <NumField label="Deslocamento X" suffix="px" value={word.offsetX ?? 0} min={-500} max={500} step={4} digits={0} onCommit={(v) => updateWord('Deslocamento X da palavra', { offsetX: v })} />
              <NumField label="Deslocamento Y" suffix="px" value={word.offsetY ?? 0} min={-500} max={500} step={4} digits={0} onCommit={(v) => updateWord('Deslocamento Y da palavra', { offsetY: v })} />
              <NumField label="Peso desta palavra" value={word.weight ?? t.weight} min={100} max={900} step={100} digits={0} onCommit={(v) => updateWord('Peso da palavra', { weight: Math.round(v / 100) * 100 })} />
              {syllables.length > 0 && (
                <div className="mt-2 border-t border-line-soft pt-2">
                  <label className="flex items-center justify-between py-1 text-xs">
                    <span className="text-muted">Animar sílabas confiáveis</span>
                    <input type="checkbox" className="accent-violet" checked={t.syllableAnimation} disabled={!['ass', 'manual'].includes(word.source) || word.uncertain || (word.confidence ?? 0) < 0.95} onChange={(e) => set('Animação por sílaba', { syllableAnimation: e.target.checked })} />
                  </label>
                  {['ass', 'manual'].includes(word.source) && (word.confidence ?? 0) >= 0.95 && !word.uncertain ? (
                    <div className="mt-1 space-y-1">
                      <p className="text-2xs text-muted">Tempos de karaokê ASS ou confirmados manualmente; sem estimação automática.</p>
                      {syllables.map((item, index) => (
                        <div key={`${item.startUs}-${index}`} className="rounded border border-line-soft p-1.5">
                          <p className="mb-1 truncate text-2xs text-ink-soft">{item.text}</p>
                          <NumField label="Início" suffix="s" value={item.startUs / S} min={word.startUs / S} max={item.endUs / S - 0.001} step={0.01} digits={2} onCommit={(v) => updateSyllable(index, { startUs: Math.round(v * S) })} />
                          <NumField label="Fim" suffix="s" value={item.endUs / S} min={item.startUs / S + 0.001} max={word.endUs / S} step={0.01} digits={2} onCommit={(v) => updateSyllable(index, { endUs: Math.round(v * S) })} />
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-2xs text-muted">Segmentação silábica indisponível ou sem confiança suficiente; nenhum tempo será inferido.</p>}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 text-2xs text-muted">
          {t.timingPrecision === 'segment'
            ? 'Sincronizada como frase/segmento. Este arquivo não trouxe tempos por palavra; o editor não os inventa.'
            : 'Sem tempos por palavra. Importe ASS karaokê ou transcreva com timestamps Whisper para revisar palavra a palavra.'}
        </p>
      )}
    </Section>
  );
}

function EffectsSection({ clip, patch }: { clip: Clip; patch: (label: string, p: Partial<Clip>) => void }) {
  const add = (id: EffectId) => patch(`Adicionar ${EFFECTS.find((e) => e.id === id)!.label}`, { effects: [...clip.effects, { id: newId('fx'), effect: id, enabled: true, params: defaultParams(id) }] });
  const impactGlitchAdded = (['rgb_split', 'shake', 'flash'] as const).every((effect) => clip.effects.some((instance) => instance.effect === effect));
  const addImpactGlitch = () => {
    const effects: EffectId[] = ['rgb_split', 'shake', 'flash'];
    patch('Adicionar preset Glitch de impacto', {
      effects: [...clip.effects, ...effects.map((effect) => ({ id: newId('fx'), effect, enabled: true, params: defaultParams(effect) }))],
    });
  };
  const update = (fxId: string, p: Partial<Clip['effects'][number]>, label: string) => patch(label, { effects: clip.effects.map((f) => (f.id === fxId ? { ...f, ...p } : f)) });
  const groups = [...new Set(EFFECTS.map((e) => e.group))];
  return (
    <Section title="Efeitos">
      {clip.effects.length === 0 && <p className="mb-2 text-xs text-muted">Nenhum efeito. Experimente um clarão ou zoom no corte do drop.</p>}
      <button type="button" disabled={impactGlitchAdded} className="mb-2 w-full rounded-control border border-violet/40 bg-violet/10 px-2 py-1.5 text-left text-xs text-ink-soft hover:bg-violet/20 disabled:cursor-not-allowed disabled:opacity-50" onClick={addImpactGlitch}>
        {impactGlitchAdded ? 'Glitch de impacto já adicionado' : 'Glitch de impacto'} <span className="text-muted">· RGB + tremida + clarão, editáveis</span>
      </button>
      {clip.effects.map((fx) => {
        const def = EFFECTS.find((e) => e.id === fx.effect);
        if (!def) return null;
        return (
          <div key={fx.id} className={`mb-2 rounded-md border border-line-soft bg-base/60 px-2 py-1.5 ${fx.enabled ? '' : 'opacity-60'}`}>
            <div className="flex items-center gap-1">
              <span className="mr-auto text-xs font-medium">{def.label}</span>
            <IconButton label={fx.effect === 'color' ? (fx.enabled ? 'Comparar antes' : 'Comparar depois') : (fx.enabled ? 'Desligar' : 'Ligar')} className="size-6" onClick={() => update(fx.id, { enabled: !fx.enabled }, fx.enabled ? 'Comparar antes da cor' : 'Comparar depois da cor')}>
                {fx.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
              </IconButton>
              <IconButton label="Remover efeito" className="size-6" onClick={() => patch('Remover efeito', { effects: clip.effects.filter((f) => f.id !== fx.id) })}>
                <Trash2 size={12} />
              </IconButton>
            </div>
            {fx.effect === 'color' && (
              <label className="mb-1 flex items-center gap-2 text-xs">
                <span className="text-muted">Preset</span>
                <select
                  className="h-7 flex-1 rounded-control border border-line bg-base px-1 text-xs text-ink"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const preset = colorGradingPreset(e.target.value as (typeof COLOR_GRADING_PRESETS)[number]['id']);
                    update(fx.id, { params: { ...fx.params, ...preset.params } }, `Aplicar preset ${preset.label}`);
                  }}
                  aria-label="Preset de color grading"
                >
                  <option value="">Escolher preset…</option>
                  {COLOR_GRADING_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                </select>
              </label>
            )}
            {def.params.map((p) => (
              <NumField
                key={p.key}
                label={p.label}
                suffix={p.unit}
                value={param(fx, p.key)}
                min={p.min}
                max={p.max}
                step={p.step}
                digits={p.step < 0.1 ? 2 : p.step < 1 ? 1 : 0}
                onCommit={(v) => update(fx.id, { params: { ...fx.params, [p.key]: v } }, `${def.label}: ${p.label}`)}
              />
            ))}
          </div>
        );
      })}
      <label className="flex items-center gap-2 text-xs">
        <Plus size={13} className="text-muted" />
        <select
          className="h-7 flex-1 rounded-control border border-line bg-base px-1 text-xs text-ink"
          value=""
          onChange={(e) => e.target.value && add(e.target.value as EffectId)}
          aria-label="Adicionar efeito"
        >
          <option value="">Adicionar efeito…</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {EFFECTS.filter((e) => e.group === g).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </Section>
  );
}

export function Inspector({ session, project, selectedAssetId }: { session: ProjectSession; project: Project; selectedAssetId: string | null }) {
  const selection = useEditor((s) => s.selection);
  const clips = selection.map((id) => project.clips.find((c) => c.id === id)).filter((c): c is Clip => !!c);
  const asset = selectedAssetId ? project.assets.find((a) => a.id === selectedAssetId) : null;

  if (clips.length === 1) {
    return (
      <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-panel" aria-label="Propriedades">
        <AskAi />
        <ClipInspector session={session} project={project} clip={clips[0]!} />
      </aside>
    );
  }
  if (clips.length > 1) {
    const videoClips = clips.filter((clip) => {
      const track = project.tracks.find((item) => item.id === clip.trackId);
      const asset = project.assets.find((item) => item.id === clip.assetId);
      return track?.kind === 'video' && !track.locked && !!clip.assetId && asset?.kind !== 'audio';
    });
    const selectedTracks = clips.map((clip) => project.tracks.find((track) => track.id === clip.trackId));
    const canGroup = selectedTracks.every((track) => track && !track.locked && track.kind === selectedTracks[0]?.kind);
    return (
      <aside className="w-[300px] shrink-0 border-l border-line bg-panel p-4 text-sm" aria-label="Propriedades">
        <p className="font-semibold">{clips.length} clipes selecionados</p>
        <p className="mt-1 text-xs text-muted">Arraste para mover juntos, Delete para excluir, Ctrl+C para copiar.</p>
        <div className="mt-3 grid grid-cols-2 gap-1">
          <button type="button" disabled={!canGroup} className="rounded-control border border-line px-2 py-1.5 text-xs text-ink-soft hover:bg-raised disabled:opacity-40" onClick={() => {
            const groupId = newId('grp');
            session.history.transaction('Agrupar elementos', clips.map((clip) => ({ type: 'clip.update' as const, clipId: clip.id, patch: { groupId } })));
          }}>
            Agrupar
          </button>
          <button type="button" disabled={!canGroup || clips.every((clip) => clip.groupId === null)} className="rounded-control border border-line px-2 py-1.5 text-xs text-ink-soft hover:bg-raised disabled:opacity-40" onClick={() => session.history.transaction('Desagrupar elementos', clips.map((clip) => ({ type: 'clip.update' as const, clipId: clip.id, patch: { groupId: null } })))}>
            Desagrupar
          </button>
        </div>
        <p className="mt-3 mb-1 text-xs font-semibold text-ink-soft">Enquadramento de todos</p>
        <FitButtons session={session} project={project} ids={clips.map((c) => c.id)} />
        {videoClips.length === 2 && <SplitScreenButton session={session} project={project} clips={videoClips} />}
        {videoClips.length > 0 && <BatchColorGrading session={session} clips={videoClips} />}
        <div className="-mx-4 mt-3">
          <AskAi />
        </div>
      </aside>
    );
  }
  if (asset) return <AssetDetail asset={asset} session={session} />;
  return <EmptyInspector project={project} />;
}

function SplitScreenButton({ session, project, clips }: { session: ProjectSession; project: Project; clips: Clip[] }) {
  const apply = () => {
    const [left, right] = clips;
    if (!left?.assetId || !right?.assetId) return;
    const half = (clip: Clip, x: number) => {
      const asset = project.assets.find((item) => item.id === clip.assetId);
      const width = asset?.probe?.video?.width ?? project.settings.width;
      const height = asset?.probe?.video?.height ?? project.settings.height;
      const contentWidth = width * (1 - clip.transform.crop.left - clip.transform.crop.right);
      const contentHeight = height * (1 - clip.transform.crop.top - clip.transform.crop.bottom);
      const scale = Math.min((project.settings.width / 2) / contentWidth, project.settings.height / contentHeight);
      const keyframes = { ...clip.keyframes };
      delete keyframes['transform.x'];
      delete keyframes['transform.y'];
      delete keyframes['transform.scale'];
      return {
        type: 'clip.update' as const,
        clipId: clip.id,
        patch: {
          transform: { ...clip.transform, x, y: 0, scale },
          keyframes,
        },
      };
    };
    session.history.transaction('Compor tela dividida', [
      half(left, -project.settings.width / 4),
      half(right, project.settings.width / 4),
    ]);
  };
  return (
    <button type="button" className="mt-2 w-full rounded-control border border-violet/40 bg-violet/10 px-2 py-1.5 text-xs text-ink-soft hover:bg-violet/20" onClick={apply}>
      Compor tela dividida com 2 vídeos
    </button>
  );
}

function BatchColorGrading({ session, clips }: { session: ProjectSession; clips: Clip[] }) {
  const [presetId, setPresetId] = useState<(typeof COLOR_GRADING_PRESETS)[number]['id']>(COLOR_GRADING_PRESETS[0].id);
  const apply = () => {
    const preset = colorGradingPreset(presetId);
    const commands: Command[] = clips.map((clip) => {
      const current = clip.effects.find((effect) => effect.effect === 'color');
      const effects = current
        ? clip.effects.map((effect) => effect.id === current.id ? { ...effect, enabled: true, params: { ...effect.params, ...preset.params } } : effect)
        : [...clip.effects, { id: newId('fx'), effect: 'color', enabled: true, params: { ...defaultParams('color'), ...preset.params } }];
      return { type: 'clip.update', clipId: clip.id, patch: { effects } };
    });
    session.history.transaction(`Color grading: ${preset.label} em ${clips.length} cenas`, commands);
  };
  return (
    <section className="mt-3 border-t border-line pt-3">
      <p className="mb-2 text-xs font-semibold text-ink-soft">Color grading da sequência</p>
      <p className="mb-2 text-2xs text-muted">Aplica o preset aos {clips.length} clipes de vídeo selecionados, sem alterar os outros efeitos.</p>
      <select className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs text-ink" value={presetId} onChange={(event) => setPresetId(event.target.value as typeof presetId)}>
        {COLOR_GRADING_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
      </select>
      <button type="button" className="mt-2 w-full rounded-control border border-violet/40 bg-violet/10 px-2 py-1.5 text-xs text-ink-soft hover:bg-violet/20" onClick={apply}>
        Aplicar à sequência selecionada
      </button>
    </section>
  );
}

/** Sem seleção: mostra o próximo passo em vez de um painel vazio. */
function EmptyInspector({ project }: { project: Project }) {
  const hasMusic = project.assets.some((a) => a.kind === 'audio' && !isSfxAsset(a));
  const hasVideo = project.assets.some((a) => a.kind === 'video');
  const hasClips = project.clips.length > 0;
  const steps: [boolean, string, string][] = [
    [hasVideo, 'Importe episódios', 'Arraste os arquivos para a janela ou use Importar. Eles são analisados sozinhos (cenas, falas, gritos).'],
    [hasMusic, 'Escolha a música', 'Importe um arquivo ou pegue na tela Músicas → Recomendadas.'],
    [hasClips, 'Monte o vídeo', 'Use "Gerar meu AMV" no topo, ou arraste cenas das abas Cenas e Falas para a timeline.'],
  ];
  return (
    <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-panel p-4" aria-label="Propriedades">
      {hasClips ? (
        <>
          <p className="text-sm font-semibold text-ink-soft">Nada selecionado</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">Clique num clipe para ajustar posição, escala, velocidade, volume, efeitos e transição.</p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">Começando</p>
          <ol className="mt-3 space-y-3">
            {steps.map(([done, title, text], i) => (
              <li key={title} className="flex gap-2.5">
                <span className={`grid size-5 shrink-0 place-items-center rounded-full text-2xs font-semibold ${done ? 'bg-ok/20 text-ok' : 'bg-raised text-muted'}`}>{done ? '✓' : i + 1}</span>
                <span>
                  <span className={`block text-xs font-semibold ${done ? 'text-muted line-through' : 'text-ink'}`}>{title}</span>
                  {!done && <span className="block text-2xs leading-relaxed text-muted">{text}</span>}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="mt-6 border-t border-line pt-3">
        <p className="mb-2 text-2xs font-semibold tracking-wide text-muted uppercase">Atalhos</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-2xs">
          {[
            ['Espaço', 'tocar / pausar'],
            ['S', 'dividir no playhead'],
            ['T', 'texto no playhead'],
            ['Delete', 'excluir'],
            ['Ctrl+D', 'duplicar'],
            ['Ctrl+Z', 'desfazer'],
            ['← →', 'quadro a quadro'],
            ['Ctrl+E', 'exportar'],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-line bg-base px-1.5 py-0.5 font-sans text-ink-soft">{k}</kbd>
              </dt>
              <dd className="self-center text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  );
}

/** Abre o assistente já falando dos clipes selecionados. */
function AskAi() {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line px-4 py-2">
      {['Como melhorar esta cena?', 'Troque por uma cena mais forte', 'Clarão e tremida aqui'].map((q) => (
        <button key={q} type="button" className="rounded-full border border-line px-2 py-0.5 text-2xs text-ink-soft hover:border-violet hover:text-ink" onClick={() => useEditor.setState({ assistantOpen: true, assistantDraft: q })}>
          ✦ {q}
        </button>
      ))}
    </div>
  );
}

/** Encaixar (inteiro, com faixas pretas) ou Preencher (ocupa o quadro, corta as sobras). */
function FitButtons({ session, project, ids }: { session: ProjectSession; project: Project; ids: string[] }) {
  const clips = project.clips.filter((c) => ids.includes(c.id) && c.assetId);
  const withAsset = clips.map((c) => ({ c, a: project.assets.find((x) => x.id === c.assetId) })).filter((x) => x.a?.probe?.video);
  if (!withAsset.length) return null;
  const apply = (mode: 'fit' | 'fill') =>
    session.history.transaction(
      mode === 'fill' ? 'Preencher a tela' : 'Encaixar na tela',
      withAsset.map(({ c, a }) => ({ type: 'clip.update' as const, clipId: c.id, patch: { transform: { ...c.transform, x: 0, y: 0, scale: mode === 'fill' ? fillScale(project, a!) : 1 } } })),
    );
  const allFill = withAsset.every(({ c, a }) => Math.abs(c.transform.scale - fillScale(project, a!)) < 0.001);
  const allFit = withAsset.every(({ c }) => c.transform.scale === 1);
  return (
    <div className="mb-2 grid grid-cols-2 gap-1 rounded-control bg-base p-1">
      <button type="button" title="Mostra o vídeo inteiro (pode sobrar faixa preta)" onClick={() => apply('fit')} className={`rounded-[4px] py-1 text-xs ${allFit ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
        Encaixar
      </button>
      <button type="button" title="Ocupa a tela toda (corta as sobras) — ideal para vídeo horizontal em projeto vertical" onClick={() => apply('fill')} className={`rounded-[4px] py-1 text-xs ${allFill ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
        Preencher
      </button>
    </div>
  );
}
