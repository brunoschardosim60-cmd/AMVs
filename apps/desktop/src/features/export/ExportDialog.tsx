import { etaSeconds } from '@amv/media';
import { formatDuration, projectDurationUs } from '@amv/project';
import { availableHardwareEncoders, missingForRender, type HardwareEncoder, type RenderProgress, type RenderResult } from '@amv/render';
import { CheckCircle2, FolderOpen, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { estimateOutputSize, isCancel, OUTPUT_FRAME_RATES, outputSize, RESOLUTION_PRESETS, startExport, type ExportJob } from '../../core/exporter';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { Button, Dialog, Field, Progress } from '../../ui/controls';
import { rasterizeText } from './rasterizeText';

type Codec = 'h264' | 'h265' | 'prores';
type Container = 'mp4' | 'mkv' | 'mov';
type Encoder = 'auto' | 'cpu' | HardwareEncoder;
type State = { kind: 'setup' } | { kind: 'running'; p: RenderProgress; started: number } | { kind: 'done'; path: string; logPath: string; seconds: number; result: RenderResult } | { kind: 'error'; message: string; logPath?: string };

const CODECS: { id: Codec; label: string; hint: string }[] = [
  { id: 'h264', label: 'MP4 H.264', hint: 'Toca em qualquer lugar. Ideal para YouTube, TikTok e Instagram.' },
  { id: 'h265', label: 'MP4 H.265', hint: 'Arquivo menor com a mesma qualidade, mas exportar demora mais.' },
  { id: 'prores', label: 'MOV ProRes', hint: 'Arquivo enorme, para editar em outro programa.' },
];

function defaultCrf(codec: Codec, quality: 0 | 1 | 2): number {
  if (codec === 'h265') return [26, 20, 17][quality]!;
  return [23, 18, 15][quality]!;
}

export function ExportDialog({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  const { platform, toast } = useApp();
  const project = session.project;
  const [resId, setResId] = useState('project');
  const [codec, setCodec] = useState<Codec>('h264');
  const [quality, setQuality] = useState<0 | 1 | 2>(1);
  const [container, setContainer] = useState<Container>('mp4');
  const [encoder, setEncoder] = useState<Encoder>('auto');
  const [rateControl, setRateControl] = useState<'crf' | 'bitrate'>('crf');
  const [crf, setCrf] = useState(18);
  const [bitrateK, setBitrateK] = useState(8000);
  const [audioBitrateK, setAudioBitrateK] = useState(256);
  const [fpsId, setFpsId] = useState('project');
  const [hardware, setHardware] = useState<{ encoders: HardwareEncoder[]; checking: boolean; error: string | null }>({ encoders: [], checking: true, error: null });
  const [customSize, setCustomSize] = useState({ width: project.settings.width, height: project.settings.height });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [state, setState] = useState<State>({ kind: 'setup' });
  const job = useRef<ExportJob | null>(null);

  const preset = RESOLUTION_PRESETS.find((r) => r.id === resId) ?? RESOLUTION_PRESETS[0]!;
  const size = resId === 'custom'
    ? { width: Math.max(2, 2 * Math.round(customSize.width / 2)), height: Math.max(2, 2 * Math.round(customSize.height / 2)) }
    : outputSize(project, preset);
  const dur = projectDurationUs(project);
  const selectedFps = OUTPUT_FRAME_RATES.find((rate) => rate.id === fpsId)?.value ?? project.settings.fps;
  const missing = missingForRender(project);
  const busy = state.kind === 'running';
  const estimate = estimateOutputSize(dur, size.width, size.height, codec, audioBitrateK, rateControl, bitrateK, crf);

  useEffect(() => {
    let active = true;
    if (codec === 'prores') {
      setHardware({ encoders: [], checking: false, error: null });
      setEncoder('cpu');
      setContainer('mov');
      return () => { active = false; };
    }
    setHardware({ encoders: [], checking: true, error: null });
    void availableHardwareEncoders(platform!.runner, codec, rateControl).then((encoders) => {
      if (active) setHardware({ encoders, checking: false, error: null });
    }).catch((error: unknown) => {
      if (active) setHardware({ encoders: [], checking: false, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; };
  }, [platform, codec, rateControl]);

  useEffect(() => setCrf(defaultCrf(codec, quality)), [codec, quality]);

  const start = async () => {
    const ext = codec === 'prores' ? 'mov' : container;
    const safe = project.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'AMV';
    const path = await platform!.dialogs.saveFile('Salvar vídeo', `${safe}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }]);
    if (!path) return;
    const out = path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`;
    const started = Date.now();
    setState({ kind: 'running', p: { fraction: 0, stage: 'audio', detail: 'Preparando' }, started });
    job.current = startExport(platform!, session, out, {
      width: size.width,
      height: size.height,
      enc: { codec, quality, encoder, rateControl, crf, bitrateK },
      audioBitrateK,
      container: ext,
      fps: OUTPUT_FRAME_RATES.find((rate) => rate.id === fpsId)?.value ?? undefined,
    }, rasterizeText, (p) =>
      setState((s) => (s.kind === 'running' ? { ...s, p } : s)),
    );
    try {
      const r = await job.current.promise;
      setState({ kind: 'done', path: r.output, logPath: r.logPath, seconds: (Date.now() - started) / 1000, result: r });
      toast({ tone: 'ok', title: 'Exportação validada', body: r.output });
    } catch (e) {
      if (isCancel(e)) setState({ kind: 'setup' });
      else setState({ kind: 'error', message: (e as Error).message, logPath: (e as { logPath?: string }).logPath });
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
            <Button icon={<FolderOpen size={15} />} onClick={() => void platform!.reveal(state.logPath)}>
              Abrir log
            </Button>
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
            <Button variant="primary" disabled={dur <= 0 || missing.length > 0 || (encoder !== 'cpu' && encoder !== 'auto' && !hardware.encoders.includes(encoder)) || (hardware.checking && encoder === 'auto')} onClick={start}>
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
            <p className="text-sm font-semibold">Arquivo validado em {formatDuration(state.seconds * 1e6).replace(/\.\d+$/, '')}</p>
            <p className="mt-1 text-xs break-all text-muted">{state.path}</p>
            <p className="mt-2 text-xs text-muted">
              {state.result.validation.width}×{state.result.validation.height} · {state.result.validation.fps?.num}/{state.result.validation.fps?.den} fps · {state.result.validation.frames.toLocaleString()} quadros · {state.result.validation.videoCodec?.toUpperCase()}
              {' · áudio sincronizado · arquivo decodificado sem erros'}
            </p>
            <p className="mt-2 text-xs text-muted">
              Mixagem: {state.result.audioMetrics.integratedLufs === null ? 'loudness indisponível' : `${state.result.audioMetrics.integratedLufs.toFixed(1)} LUFS`}
              {' · Pico verdadeiro: '}
              {state.result.audioMetrics.truePeakDbfs === null ? 'indisponível' : `${state.result.audioMetrics.truePeakDbfs.toFixed(1)} dBFS`}
              {' · '}
              {state.result.audioMetrics.clippingDetected ? 'clipping detectado' : 'sem clipping digital detectado'}
            </p>
            {state.result.validation.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-warn">{warning}</p>)}
            <p className="mt-2 text-2xs text-faint">Log detalhado: {state.logPath}</p>
          </div>
        </div>
      )}
      {state.kind === 'error' && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs">
          <p className="font-medium text-danger">A exportação falhou</p>
          <p className="mt-1 break-words whitespace-pre-wrap text-ink-soft select-text">{state.message}</p>
          {state.logPath && <button type="button" className="mt-2 text-xs text-violet underline" onClick={() => void platform!.reveal(state.logPath!)}>Abrir log detalhado</button>}
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
          {codec !== 'prores' && (
            <Field label="Contêiner">
              <select className="h-9 w-full rounded-control border border-line bg-base px-2 text-sm" value={container} onChange={(event) => setContainer(event.target.value as Container)}>
                <option value="mp4">MP4 (compatibilidade)</option>
                <option value="mkv">Matroska (MKV)</option>
                <option value="mov">QuickTime (MOV)</option>
              </select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Resolução">
              <select className="h-9 w-full rounded-control border border-line bg-base px-2 text-sm" value={resId} onChange={(e) => setResId(e.target.value)}>
                {RESOLUTION_PRESETS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
                <option value="custom">Personalizada</option>
              </select>
              {resId === 'custom' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input aria-label="Largura personalizada" type="number" min={2} step={2} value={customSize.width} onChange={(event) => setCustomSize((value) => ({ ...value, width: Math.max(2, Number(event.target.value) || 2) }))} className="h-8 rounded-control border border-line bg-base px-2 text-xs" />
                  <input aria-label="Altura personalizada" type="number" min={2} step={2} value={customSize.height} onChange={(event) => setCustomSize((value) => ({ ...value, height: Math.max(2, Number(event.target.value) || 2) }))} className="h-8 rounded-control border border-line bg-base px-2 text-xs" />
                </div>
              )}
              <span className="tnum mt-1 block text-2xs text-muted">
                {size.width}×{size.height}
              </span>
            </Field>
            <Field label={codec === 'prores' ? 'Perfil ProRes' : 'Preset do encoder'}>
              <select className="h-9 w-full rounded-control border border-line bg-base px-2 text-sm" value={quality} onChange={(e) => setQuality(Number(e.target.value) as 0 | 1 | 2)}>
                <option value={0}>{codec === 'prores' ? 'Proxy (ProRes 422)' : 'Rápido'}</option>
                <option value={1}>{codec === 'prores' ? 'Edição (ProRes 422 HQ)' : 'Equilibrado'}</option>
                <option value={2}>{codec === 'prores' ? 'Máxima qualidade (ProRes 4444)' : 'Mais lento / maior qualidade'}</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="FPS de saída">
              <select className="h-9 w-full rounded-control border border-line bg-base px-2 text-sm" value={fpsId} onChange={(event) => setFpsId(event.target.value)}>
                {OUTPUT_FRAME_RATES.map((rate) => <option key={rate.id} value={rate.id}>{rate.label}</option>)}
              </select>
            </Field>
            <Field label="Encoder">
              <select className="h-9 w-full rounded-control border border-line bg-base px-2 text-sm" value={encoder} onChange={(event) => setEncoder(event.target.value as Encoder)}>
                <option value="auto">Automático (testar hardware)</option>
                <option value="cpu">CPU</option>
                {hardware.encoders.includes('amf') && <option value="amf">AMD AMF</option>}
                {hardware.encoders.includes('nvenc') && <option value="nvenc">NVIDIA NVENC</option>}
                {hardware.encoders.includes('qsv') && <option value="qsv">Intel Quick Sync</option>}
              </select>
              <span className="mt-1 block text-2xs text-muted">{hardware.checking ? 'Testando encoders e driver…' : hardware.error ? `Detecção falhou: ${hardware.error}` : hardware.encoders.length ? `Disponíveis e testados: ${hardware.encoders.join(', ')}` : 'Nenhum encoder de hardware passou no teste; CPU disponível.'}</span>
            </Field>
          </div>
          {codec !== 'prores' && (
            <div className="rounded-md border border-line p-3">
              <button type="button" className="text-xs font-medium text-ink-soft" onClick={() => setShowAdvanced((show) => !show)}>
                {showAdvanced ? 'Ocultar controles de taxa avançados' : 'Controles avançados: CRF e bitrate'}
              </button>
              {showAdvanced && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Controle de taxa">
                    <select className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs" value={rateControl} onChange={(event) => setRateControl(event.target.value as 'crf' | 'bitrate')}>
                      <option value="crf">CRF (qualidade constante)</option>
                      <option value="bitrate">Bitrate alvo</option>
                    </select>
                  </Field>
                  {rateControl === 'crf' ? (
                    <Field label={`CRF: ${crf} (menor = mais qualidade)`}>
                      <input type="range" min={14} max={35} value={crf} onChange={(event) => setCrf(Number(event.target.value))} className="mt-2 w-full" />
                    </Field>
                  ) : (
                    <Field label="Bitrate de vídeo (kb/s)">
                      <input type="number" min={250} max={100000} step={250} value={bitrateK} onChange={(event) => setBitrateK(Math.max(250, Number(event.target.value) || 250))} className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs" />
                    </Field>
                  )}
                  <Field label="Bitrate de áudio (kb/s)">
                    <select className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs" value={audioBitrateK} onChange={(event) => setAudioBitrateK(Number(event.target.value))}>
                      {[128, 192, 256, 320].map((rate) => <option key={rate} value={rate}>{rate}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </div>
          )}
          {hardware.error && <p className="text-2xs text-warn">Não foi possível testar a aceleração; use CPU ou confira o log do FFmpeg. {hardware.error}</p>}
          <p className="tnum text-xs text-muted">
            Estimativa aproximada: {formatBytes(estimate.minBytes)}–{formatBytes(estimate.maxBytes)} · faixa ampla; conteúdo e encoder podem alterar bastante o tamanho.
          </p>
          <p className="tnum text-xs text-muted">
            Duração: {formatDuration(dur).replace(/\.\d+$/, '')} · FPS selecionado: {selectedFps.num}/{selectedFps.den} · usa os originais, não os proxies.
          </p>
          <p className="mt-3 text-2xs leading-relaxed text-faint">
            Publique só o que você tem direito de usar. Episódios e músicas costumam ter direitos autorais; plataformas podem bloquear ou remover o vídeo.
          </p>
        </>
      )}
    </Dialog>
  );
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;
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
