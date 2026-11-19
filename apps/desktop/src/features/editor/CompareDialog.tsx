import { useEffect, useMemo, useRef, useState } from 'react';
import { type Clip, type Project } from '@amv/project';
import { Columns2, Pause, Play } from 'lucide-react';
import type { ProjectSession } from '../../core/session';
import { Button, Dialog, inputClass } from '../../ui/controls';
import { createPlayer } from './Preview';
import { compareVariant, comparisonEndUs, type ComparePreset } from './compareVariant';
import { useEditor } from './editorStore';

function CompareCanvas({ session, project, timeUs }: { session: ProjectSession; project: Project; timeUs: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const player = useMemo(() => createPlayer(session, project, true), [session]);
  useEffect(() => { const cv = ref.current; if (!cv) return; player.attach(cv); return () => { player.pause(); player.detach(); }; }, [player]);
  useEffect(() => { player.setProject(project); player.seek(timeUs); }, [player, project, timeUs]);
  return <canvas ref={ref} width={project.settings.width} height={project.settings.height} className="w-full border border-line bg-base" aria-label="Quadro da comparação" />;
}

export function CompareDialog({ session, clip, onClose }: { session: ProjectSession; clip: Clip; onClose: () => void }) {
  const [a, setA] = useState<ComparePreset>('current');
  const [b, setB] = useState<ComparePreset>('vibrant');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(clip.durationUs / 1_000_000);
  const [startB, setStartB] = useState(0);
  const [endB, setEndB] = useState(clip.durationUs / 1_000_000);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canTrim = !clip.reverse && Object.values(clip.keyframes).every((frames) => !frames.length) && !clip.text;
  const validRange = (from: number, to: number) => Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from && to <= clip.durationUs / 1_000_000;
  const valid = validRange(start, end) && validRange(startB, endB);
  const va = useMemo(() => compareVariant(clip, a, valid ? start * 1_000_000 : 0, valid ? end * 1_000_000 : clip.durationUs), [clip, a, start, end, valid]);
  const vb = useMemo(() => compareVariant(clip, b, valid ? startB * 1_000_000 : 0, valid ? endB * 1_000_000 : clip.durationUs), [clip, b, startB, endB, valid]);
  const comparisonEnd = comparisonEndUs(va, vb);
  const projectFor = (variant: Clip): Project => ({ ...session.project, tracks: session.project.tracks.map((t) => ({ ...t, muted: true })), clips: [{ ...variant, timelineStartUs: 0, audio: { ...variant.audio, gainDb: -96 } }] });
  const pa = useMemo(() => projectFor(va), [va]);
  const pb = useMemo(() => projectFor(vb), [vb]);
  useEffect(() => { setTime(0); setPlaying(false); }, [start, end, startB, endB]);
  useEffect(() => {
    if (!playing) return;
    const tick = window.setInterval(() => setTime((t) => (t + 100_000) % Math.max(va.durationUs, vb.durationUs)), 100);
    return () => window.clearInterval(tick);
  }, [playing, va.durationUs, vb.durationUs]);
  const apply = (variant: Clip) => {
    const current = session.project.clips.find((c) => c.id === clip.id);
    const track = session.project.tracks.find((t) => t.id === current?.trackId);
    if (!current || track?.locked || !valid) return;
    session.history.transaction('Aplicar comparação', [{ type: 'clip.update', clipId: clip.id, patch: { effects: variant.effects, sourceInUs: variant.sourceInUs, sourceOutUs: variant.sourceOutUs, durationUs: variant.durationUs, timelineStartUs: variant.timelineStartUs, keyframes: variant.keyframes } }]);
    useEditor.getState().setPlayhead(variant.timelineStartUs);
    onClose();
  };
  const selector = (value: ComparePreset, change: (v: ComparePreset) => void, label: string) => <select aria-label={label} value={value} className={inputClass} onChange={(e) => change(e.target.value as ComparePreset)}><option value="current">Efeitos atuais</option><option value="clean">Sem efeitos</option><option value="vibrant">Cor vibrante</option><option value="impact">Cor + impacto leve</option></select>;
  return <Dialog title="Comparar trecho" width="w-[1000px]" onClose={onClose} footer={<><Button disabled={!valid} onClick={() => apply(va)}>Aplicar A</Button><Button variant="primary" disabled={!valid} onClick={() => apply(vb)}>Aplicar B</Button></>}>
    <div className="grid grid-cols-2 gap-3">
      <div className="min-w-0 space-y-2"><h3 className="text-xs text-muted">A</h3>{selector(a, setA, 'Efeitos A')}<CompareCanvas session={session} project={pa} timeUs={Math.min(time, va.durationUs - 1)} /></div>
      <div className="min-w-0 space-y-2"><h3 className="text-xs text-muted">B</h3>{selector(b, setB, 'Efeitos B')}<CompareCanvas session={session} project={pb} timeUs={Math.min(time, vb.durationUs - 1)} /></div>
    </div>
    <div className="my-4 grid grid-cols-2 gap-3"><label className="text-xs">Entrada (s)<input disabled={!canTrim} aria-label="Entrada da comparação" type="number" step="0.1" min={0} max={end} className={inputClass} value={start} onChange={(e) => setStart(Number(e.target.value))} /></label><label className="text-xs">Saída (s)<input disabled={!canTrim} aria-label="Saída da comparação" type="number" step="0.1" min={start} max={clip.durationUs / 1_000_000} className={inputClass} value={end} onChange={(e) => setEnd(Number(e.target.value))} /></label></div>
    {!canTrim && <p className="text-xs text-muted">Corte preservado: este clipe contém animação, texto ou reprodução reversa.</p>}
    <div className="my-4 grid grid-cols-2 gap-3"><label className="text-xs">Entrada B (s)<input disabled={!canTrim} aria-label="Entrada B" type="number" step="0.1" min={0} max={endB} className={inputClass} value={startB} onChange={(e) => setStartB(Number(e.target.value))} /></label><label className="text-xs">Saída B (s)<input disabled={!canTrim} aria-label="Saída B" type="number" step="0.1" min={startB} max={clip.durationUs / 1_000_000} className={inputClass} value={endB} onChange={(e) => setEndB(Number(e.target.value))} /></label></div>
    {!valid && <p role="alert" className="text-xs text-danger">Selecione um intervalo válido dentro do clipe.</p>}
    <div className="flex items-center gap-3"><Button aria-label={playing ? 'Pausar comparação' : 'Reproduzir comparação'} icon={playing ? <Pause size={16} /> : <Play size={16} />} disabled={!valid} onClick={() => setPlaying(!playing)} /><input aria-label="Posição da comparação" type="range" min={0} max={comparisonEnd} value={Math.min(time, comparisonEnd)} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} className="min-w-0 flex-1 accent-violet" /><Columns2 size={16} className="text-muted" /></div>
  </Dialog>;
}