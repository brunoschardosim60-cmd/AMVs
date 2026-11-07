import { clipEndUs, defaultParams, EFFECTS, fillScale, formatTimecode, newId, param, sourceDurationUs, TRANSITIONS, trimClip, type Clip, type Command, type EffectId, type Project } from '@amv/project';
import { Eye, EyeOff, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
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
            <FitButtons session={session} project={project} ids={[clip.id]} />
            <NumField label="Posição X" suffix="px" value={tr.x} step={1} digits={0} onCommit={(v) => patch('Posição', { transform: { ...tr, x: v } })} />
            <NumField label="Posição Y" suffix="px" value={tr.y} step={1} digits={0} onCommit={(v) => patch('Posição', { transform: { ...tr, y: v } })} />
            <NumField label="Escala" suffix="%" value={tr.scale * 100} min={1} max={1000} step={1} digits={1} onCommit={(v) => patch('Escala', { transform: { ...tr, scale: v / 100 } })} />
            <NumField label="Rotação" suffix="°" value={tr.rotation} step={1} digits={1} onCommit={(v) => patch('Rotação', { transform: { ...tr, rotation: v } })} />
            <NumField label="Opacidade" suffix="%" value={tr.opacity * 100} min={0} max={100} step={5} digits={0} onCommit={(v) => patch('Opacidade', { transform: { ...tr, opacity: v / 100 } })} />
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
                onChange={(e) =>
                  patch(
                    'Transição',
                    { transitionIn: e.target.value ? { transition: e.target.value, durationUs: clip.transitionIn?.durationUs ?? 400_000, params: {} } : null },
                  )
                }
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
              <NumField
                label="Duração"
                suffix="s"
                value={clip.transitionIn.durationUs / S}
                min={0.05}
                max={Math.min(3, clip.durationUs / S)}
                step={0.05}
                onCommit={(v) => patch('Duração da transição', { transitionIn: { ...clip.transitionIn!, durationUs: Math.round(v * S) } })}
              />
            )}
            <p className="mt-1 text-2xs text-muted">O clipe anterior continua por baixo durante a transição.</p>
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
            <p className="mt-1 text-2xs text-muted">No preview o volume vai até 0 dB e toca a 1ª faixa; a exportação usa o ganho e a faixa escolhidos.</p>
          </Section>
        )}
      </fieldset>
    </div>
  );
}

function TextSection({ clip, patch }: { clip: Clip; patch: (label: string, p: Partial<Clip>) => void }) {
  const t = clip.text!;
  const [text, setText] = useState(t.text);
  useEffect(() => setText(t.text), [t.text]);
  const set = (label: string, p: Partial<NonNullable<Clip['text']>>) => patch(label, { text: { ...t, ...p } });
  return (
    <Section title="Texto">
      <textarea
        className="mb-2 h-20 w-full resize-none rounded-control border border-line bg-base p-2 text-sm text-ink outline-none focus:border-violet"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== t.text && set('Editar texto', { text })}
        aria-label="Texto"
      />
      <NumField label="Tamanho" suffix="px" value={t.size} min={8} max={400} step={2} digits={0} onCommit={(v) => set('Tamanho do texto', { size: v })} />
      <label className="grid grid-cols-[1fr_96px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Cor</span>
        <input type="color" className="h-7 w-full rounded-control border border-line bg-base" value={t.color} onChange={(e) => set('Cor do texto', { color: e.target.value })} />
      </label>
      <label className="grid grid-cols-[1fr_96px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Contorno</span>
        <input type="color" className="h-7 w-full rounded-control border border-line bg-base" value={t.outlineColor ?? '#000000'} onChange={(e) => set('Cor do contorno', { outlineColor: e.target.value, outlineWidth: t.outlineWidth || 3 })} />
      </label>
      <NumField label="Espessura do contorno" suffix="px" value={t.outlineWidth} min={0} max={20} step={1} digits={0} onCommit={(v) => set('Contorno', { outlineWidth: v })} />
      <label className="flex items-center justify-between py-1 text-xs">
        <span className="text-muted">Sombra</span>
        <input type="checkbox" className="accent-violet" checked={t.shadow} onChange={(e) => set('Sombra', { shadow: e.target.checked })} />
      </label>
      <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Entrada</span>
        <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" value={t.animationIn ?? ''} onChange={(e) => set('Animação de entrada', { animationIn: e.target.value || null })}>
          {TEXT_ANIMATIONS_IN.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid grid-cols-[1fr_140px] items-center gap-2 py-1 text-xs">
        <span className="text-muted">Saída</span>
        <select className="h-7 rounded-control border border-line bg-base px-1 text-xs text-ink" value={t.animationOut ?? ''} onChange={(e) => set('Animação de saída', { animationOut: e.target.value || null })}>
          {TEXT_ANIMATIONS_OUT.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
    </Section>
  );
}

function EffectsSection({ clip, patch }: { clip: Clip; patch: (label: string, p: Partial<Clip>) => void }) {
  const add = (id: EffectId) => patch(`Adicionar ${EFFECTS.find((e) => e.id === id)!.label}`, { effects: [...clip.effects, { id: newId('fx'), effect: id, enabled: true, params: defaultParams(id) }] });
  const update = (fxId: string, p: Partial<Clip['effects'][number]>, label: string) => patch(label, { effects: clip.effects.map((f) => (f.id === fxId ? { ...f, ...p } : f)) });
  const groups = [...new Set(EFFECTS.map((e) => e.group))];
  return (
    <Section title="Efeitos">
      {clip.effects.length === 0 && <p className="mb-2 text-xs text-muted">Nenhum efeito. Experimente um clarão ou zoom no corte do drop.</p>}
      {clip.effects.map((fx) => {
        const def = EFFECTS.find((e) => e.id === fx.effect);
        if (!def) return null;
        return (
          <div key={fx.id} className={`mb-2 rounded-md border border-line-soft bg-base/60 px-2 py-1.5 ${fx.enabled ? '' : 'opacity-60'}`}>
            <div className="flex items-center gap-1">
              <span className="mr-auto text-xs font-medium">{def.label}</span>
              <IconButton label={fx.enabled ? 'Desligar' : 'Ligar'} className="size-6" onClick={() => update(fx.id, { enabled: !fx.enabled }, fx.enabled ? 'Desligar efeito' : 'Ligar efeito')}>
                {fx.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
              </IconButton>
              <IconButton label="Remover efeito" className="size-6" onClick={() => patch('Remover efeito', { effects: clip.effects.filter((f) => f.id !== fx.id) })}>
                <Trash2 size={12} />
              </IconButton>
            </div>
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
    return (
      <aside className="w-[300px] shrink-0 border-l border-line bg-panel p-4 text-sm" aria-label="Propriedades">
        <p className="font-semibold">{clips.length} clipes selecionados</p>
        <p className="mt-1 text-xs text-muted">Arraste para mover juntos, Delete para excluir, Ctrl+C para copiar.</p>
        <p className="mt-3 mb-1 text-xs font-semibold text-ink-soft">Enquadramento de todos</p>
        <FitButtons session={session} project={project} ids={clips.map((c) => c.id)} />
        <div className="-mx-4 mt-3">
          <AskAi />
        </div>
      </aside>
    );
  }
  if (asset) return <AssetDetail asset={asset} session={session} />;
  return <EmptyInspector project={project} />;
}

/** Sem seleção: mostra o próximo passo em vez de um painel vazio. */
function EmptyInspector({ project }: { project: Project }) {
  const assistantOpen = useEditor((s) => s.assistantOpen);
  if (assistantOpen) return null;
  const hasMusic = project.assets.some((a) => a.kind === 'audio');
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
