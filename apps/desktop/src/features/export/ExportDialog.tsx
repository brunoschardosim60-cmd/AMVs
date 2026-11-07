import { etaSeconds } from '@amv/media';
import { formatDuration, projectDurationUs } from '@amv/project';
import { missingForRender, type RenderProgress } from '@amv/render';
import { CheckCircle2, FolderOpen, Play } from 'lucide-react';
import { useRef, useState } from 'react';
import { isCancel, outputSize, RESOLUTION_PRESETS, startExport, type ExportJob } from '../../core/exporter';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { Button, Dialog, Field, Progress } from '../../ui/controls';
import { rasterizeText } from './rasterizeText';

type Codec = 'h264' | 'h265' | 'prores';
type State = { kind: 'setup' } | { kind: 'running'; p: RenderProgress; started: number } | { kind: 'done'; path: string; seconds: number } | { kind: 'error'; message: string };

const CODECS: { id: Codec; label: string; hint: string }[] = [
  { id: 'h264', label: 'MP4 H.264', hint: 'Toca em qualquer lugar. Ideal para YouTube, TikTok e Instagram.' },
  { id: 'h265', label: 'MP4 H.265', hint: 'Arquivo menor com a mesma qualidade, mas exportar demora mais.' },
  { id: 'prores', label: 'MOV ProRes', hint: 'Arquivo enorme, para editar em outro programa.' },
];

export function ExportDialog({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  const { platform, toast } = useApp();
  const project = session.project;
  const [resId, setResId] = useState('project');
  const [codec, setCodec] = useState<Codec>('h264');
  const [quality, setQuality] = useState<0 | 1 | 2>(1);
  const [state, setState] = useState<State>({ kind: 'setup' });
  const job = useRef<ExportJob | null>(null);

  const preset = RESOLUTION_PRESETS.find((r) => r.id === resId)!;
  const size = outputSize(project, preset);
  const dur = projectDurationUs(project);
  const missing = missingForRender(project);
  const busy = state.kind === 'running';

  const start = async () => {
    const ext = codec === 'prores' ? 'mov' : 'mp4';
    const safe = project.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'AMV';
    const path = await platform!.dialogs.saveFile('Salvar vídeo', `${safe}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }]);
    if (!path) return;
    const out = path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`;
    const started = Date.now();
    setState({ kind: 'running', p: { fraction: 0, stage: 'audio', detail: 'Preparando' }, started });
    job.current = startExport(platform!, session, out, { width: size.width, height: size.height, enc: { codec, quality }, audioBitrateK: 256 }, rasterizeText, (p) =>
      setState((s) => (s.kind === 'running' ? { ...s, p } : s)),
    );
    try {
      const r = await job.current.promise;
      setState({ kind: 'done', path: r.output, seconds: (Date.now() - started) / 1000 });
      toast({ tone: 'ok', title: 'Vídeo exportado', body: r.output });
    } catch (e) {
      if (isCancel(e)) setState({ kind: 'setup' });
      else setState({ kind: 'error', message: (e as Error).message });
    } finally {
      job.current = null;
    }
  };

  const close = () => {
    if (busy) return;
    onClose();
  };

  return (
    <Dialog
      title="Exportar vídeo"
      onClose={close}
      width="w-[560px]"
      footer={
        state.kind === 'running' ? (
          <Button variant="danger" onClick={() => job.current?.cancel()}>
            Cancelar exportação
          </Button>
        ) : state.kind === 'done' ? (
          <>
            <Button icon={<FolderOpen size={15} />} onClick={() => void platform!.reveal(state.path)}>
              Mostrar na pasta
            </Button>
            <Button icon={<Play size={15} />} onClick={() => void platform!.openFile(state.path)}>
              Assistir
            </Button>
            <Button variant="primary" onClick={onClose}>
              Fechar
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={dur <= 0 || missing.length > 0} onClick={start}>
              Exportar
            </Button>
          </>
        )
      }
    >
      {state.kind === 'running' && <Running state={state} />}
      {state.kind === 'done' && (
        <div className="flex gap-3">
          <CheckCircle2 className="mt-0.5 shrink-0 text-ok" size={20} />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Pronto em {formatDuration(state.seconds * 1e6).replace(/\.\d+$/, '')}</p>
            <p className="mt-1 text-xs break-all text-muted">{state.path}</p>
          </div>
        </div>
      )}
      {state.kind === 'error' && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs">
          <p className="font-medium text-danger">A exportação falhou</p>
          <p className="mt-1 break-words whitespace-pre-wrap text-ink-soft select-text">{state.message}</p>
        </div>
      )}
      {(state.kind === 'setup' || state.kind === 'error') && (
        <>
          {missing.length > 0 && (
            <p className="mb-4 rounded-md border border-warn/30 bg-warn/10 p-3 text-xs text-ink-soft">
              Faltam arquivos usados na timeline: {missing.join(', ')}. Localize-os na aba Mídia antes de exportar.
            </p>
          )}
          {dur <= 0 && <p className="mb-4 text-sm text-muted">A timeline está vazia. Coloque clipes nela para exportar.</p>}
          <Field label="Formato">
            <div className="grid grid-cols-3 gap-1">
              {CODECS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCodec(c.id)}
                  className={`rounded-control border px-2 py-2 text-xs ${codec === c.id ? 'border-violet bg-violet/10 text-ink' : 'border-line text-ink-soft hover:bg-raised'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-2xs text-muted">{CODECS.find((c) => c.id === codec)!.hint}</p>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Resolução">
              <select className="h-9 w-full rounded-control border border-line bg-base px-2 text-sm" value={resId} onChange={(e) => setResId(e.target.value)}>
                {RESOLUTION_PRESETS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <span className="tnum mt-1 block text-2xs text-muted">
                {size.width}×{size.height}
              </span>
            </Field>
            <Field label="Qualidade">
              <select className="h-9 w-full rounded-control border border-line bg-base px-2 text-sm" value={quality} onChange={(e) => setQuality(Number(e.target.value) as 0 | 1 | 2)}>
                <option value={0}>Rascunho (rápido)</option>
                <option value={1}>Alta</option>
                <option value={2}>Máxima (lento)</option>
              </select>
            </Field>
          </div>
          <p className="tnum text-xs text-muted">
            Duração: {formatDuration(dur).replace(/\.\d+$/, '')} · usa os arquivos originais, não os proxies do preview.
          </p>
          <p className="mt-3 text-2xs leading-relaxed text-faint">
            Publique só o que você tem direito de usar. Episódios e músicas costumam ter direitos autorais; plataformas podem bloquear ou remover o vídeo.
          </p>
        </>
      )}
    </Dialog>
  );
}

function Running({ state }: { state: Extract<State, { kind: 'running' }> }) {
  const eta = etaSeconds(state.p.fraction, Date.now() - state.started);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span>{state.p.detail}</span>
        <span className="tnum text-muted">
          {Math.round(state.p.fraction * 100)}%{eta !== null ? ` · ${eta < 60 ? `${Math.ceil(eta)} s` : `${Math.ceil(eta / 60)} min`} restantes` : ''}
        </span>
      </div>
      <Progress value={state.p.fraction} live />
      <p className="mt-3 text-xs text-muted">Pode continuar usando o computador. Não feche o AMV Studio até terminar.</p>
    </div>
  );
}
