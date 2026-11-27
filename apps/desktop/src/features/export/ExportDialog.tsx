import { etaSeconds } from '@amv/media';
import { formatDuration, projectDurationUs } from '@amv/project';
import { availableHardwareEncoders, missingForRender, type HardwareEncoder, type RenderProgress, type RenderResult } from '@amv/render';
import { CheckCircle2, ChevronDown, ChevronRight, Download, FolderOpen, Play, ScanSearch, Sparkles, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { estimateOutputSize, isCancel, OUTPUT_FRAME_RATES, outputSize, RESOLUTION_PRESETS, startExport, type ExportJob } from '../../core/exporter';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { Button, Dialog, Field, Progress } from '../../ui/controls';
import { rasterizeText } from './rasterizeText';
import { getPlayer } from '../editor/Preview';
import { useEditor } from '../editor/editorStore';

type Codec = 'h264' | 'h265' | 'prores';
type Container = 'mp4' | 'mkv' | 'mov';
type Encoder = 'auto' | 'cpu' | HardwareEncoder;
type QualityTierId = 'fast' | 'high' | 'ultra';
type State =
  | { kind: 'setup' }
  | { kind: 'running'; p: RenderProgress; started: number }
  | { kind: 'done'; path: string; logPath: string; seconds: number; result: RenderResult }
  | { kind: 'error'; message: string; logPath?: string };

const CODECS: { id: Codec; label: string; hint: string }[] = [
  { id: 'h264', label: 'MP4 H.264', hint: 'Toca em qualquer celular, TV ou PC. Ideal para YouTube, TikTok, Instagram e WhatsApp.' },
  { id: 'h265', label: 'MP4 H.265', hint: 'Arquivo menor com a mesma qualidade, mas demora mais para gerar.' },
  { id: 'prores', label: 'MOV ProRes', hint: 'Arquivo grande sem compressão pesada, para finalizar em outro editor.' },
];

function defaultCrf(codec: Codec, quality: 0 | 1 | 2): number {
  if (codec === 'h265') return [26, 20, 17][quality]!;
  return [23, 18, 15][quality]!;
}

export function ExportDialog({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  const { platform, toast } = useApp();
  const project = session.project;
  const ultraResId = Math.max(project.settings.width, project.settings.height) >= 3840 ? '2160' : '1440';

  const [resId, setResId] = useState('1080');
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

  const activeSimpleTier: QualityTierId | null =
    codec === 'h264' && container === 'mp4' && rateControl === 'crf' && fpsId === 'project'
      ? resId === '720' && quality === 0
        ? 'fast'
        : resId === '1080' && quality === 1
          ? 'high'
          : (resId === '1440' || resId === '2160') && quality === 2
            ? 'ultra'
            : null
      : null;

  const applySimpleTier = (tier: QualityTierId) => {
    setCodec('h264');
    setContainer('mp4');
    setRateControl('crf');
    setFpsId('project');
    setEncoder('auto');
    if (tier === 'fast') {
      setResId('720');
      setQuality(0);
      setCrf(23);
      setAudioBitrateK(192);
    } else if (tier === 'high') {
      setResId('1080');
      setQuality(1);
      setCrf(18);
      setAudioBitrateK(256);
    } else {
      setResId(ultraResId);
      setQuality(2);
      setCrf(15);
      setAudioBitrateK(320);
    }
  };

  const reviewAtUs = state.kind === 'done'
    ? [...state.result.validation.unexpectedBlackIntervals, ...state.result.validation.freezeIntervals]
      .sort((a, b) => a.startUs - b.startUs)[0]?.startUs
    : undefined;
  const reviewFirstWarning = () => {
    if (reviewAtUs === undefined) return;
    useEditor.getState().setPlayhead(reviewAtUs);
    getPlayer(session).seek(reviewAtUs);
    onClose();
  };
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

  const ext = codec === 'prores' ? 'mov' : container;

  const start = async () => {
    const safe = project.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Meu-AMV';
    const path = await platform!.dialogs.saveFile('Onde salvar seu vídeo', `${safe}.${ext}`, [{ name: `Vídeo ${ext.toUpperCase()}`, extensions: [ext] }]);
    if (!path) return;
    const out = path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`;
    const effectiveEncoder: Encoder =
      encoder === 'auto'
        ? hardware.checking
          ? 'cpu'
          : hardware.encoders.length > 0
            ? 'auto'
            : 'cpu'
        : encoder;
    const started = Date.now();
    setState({ kind: 'running', p: { fraction: 0, stage: 'audio', detail: 'Preparando download do vídeo…' }, started });
    job.current = startExport(platform!, session, out, {
      width: size.width,
      height: size.height,
      enc: { codec, quality, encoder: effectiveEncoder, rateControl, crf, bitrateK },
      audioBitrateK,
      container: ext,
      fps: OUTPUT_FRAME_RATES.find((rate) => rate.id === fpsId)?.value ?? undefined,
    }, rasterizeText, (p) =>
      setState((s) => (s.kind === 'running' ? { ...s, p } : s)),
    );
    try {
      const r = await job.current.promise;
      setState({ kind: 'done', path: r.output, logPath: r.logPath, seconds: (Date.now() - started) / 1000, result: r });
      toast({ tone: 'ok', title: 'Vídeo baixado com sucesso!', body: r.output });
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

  const explicitHardwareMissing = encoder !== 'cpu' && encoder !== 'auto' && !hardware.encoders.includes(encoder);

  return (
    <Dialog
      title="Baixar vídeo"
      onClose={close}
      width="w-[560px]"
      footer={
        state.kind === 'running' ? (
          <Button variant="danger" onClick={() => job.current?.cancel()}>
            Cancelar download
          </Button>
        ) : state.kind === 'done' ? (
          <>
            {reviewAtUs !== undefined && (
              <Button icon={<ScanSearch size={15} />} onClick={reviewFirstWarning}>
                Revisar aviso
              </Button>
            )}
            <Button icon={<FolderOpen size={15} />} onClick={() => void platform!.reveal(state.path).catch(() => {})}>
              Mostrar na pasta
            </Button>
            <Button variant="primary" icon={<Play size={15} />} onClick={() => void platform!.openFile(state.path).catch(() => {})}>
              Assistir vídeo
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              icon={<Download size={15} />}
              disabled={dur <= 0 || missing.length > 0 || explicitHardwareMissing}
              onClick={() => void start()}
            >
              Baixar vídeo (.{ext.toUpperCase()})
            </Button>
          </>
        )
      }
    >
      {state.kind === 'running' && <Running state={state} />}
      {state.kind === 'done' && (
        <div className="rounded-lg border border-ok/30 bg-ok/10 p-4">
          <div className="flex gap-3">
            <CheckCircle2 className="mt-0.5 shrink-0 text-ok" size={22} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                Seu vídeo está pronto! ({formatDuration(state.seconds * 1e6).replace(/\.\d+$/, '')})
              </p>
              <p className="mt-1 text-xs break-all text-ink-soft select-text">{state.path}</p>
              <p className="mt-2 text-xs text-muted">
                {state.result.validation.width}×{state.result.validation.height} · {state.result.validation.videoCodec?.toUpperCase()} · {state.result.validation.frames.toLocaleString()} quadros · som e imagem sincronizados
              </p>
              {state.result.validation.warnings.map((warning) => (
                <p key={warning} className="mt-2 text-xs text-warn">{warning}</p>
              ))}
            </div>
          </div>
        </div>
      )}
      {state.kind === 'error' && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs">
          <p className="font-medium text-danger">Não foi possível concluir o download do vídeo</p>
          <p className="mt-1 break-words whitespace-pre-wrap text-ink-soft select-text">{state.message}</p>
          {state.logPath && (
            <button type="button" className="mt-2 text-xs text-violet underline" onClick={() => void platform!.reveal(state.logPath!).catch(() => {})}>
              Mostrar arquivo de diagnóstico
            </button>
          )}
        </div>
      )}
      {(state.kind === 'setup' || state.kind === 'error') && (
        <div className="space-y-4">
          {missing.length > 0 && (
            <p className="rounded-md border border-warn/30 bg-warn/10 p-3 text-xs text-ink-soft">
              Faltam arquivos usados na timeline: {missing.join(', ')}. Localize-os na aba Mídia antes de baixar.
            </p>
          )}
          {dur <= 0 && (
            <p className="rounded-md border border-line bg-panel p-3 text-sm text-muted">
              A timeline ainda está vazia. Gere seu AMV ou adicione clipes antes de baixar o vídeo.
            </p>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold text-ink">Escolha a qualidade</p>
            <div className="grid gap-2">
              <QualityCard
                selected={activeSimpleTier === 'fast'}
                icon={<Zap size={16} />}
                title="Leve e Rápido · HD (720p)"
                subtitle="Gera bem rápido e ocupa pouco espaço. Ótimo para mandar no WhatsApp ou Discord."
                onClick={() => applySimpleTier('fast')}
              />
              <QualityCard
                selected={activeSimpleTier === 'high'}
                badge="Recomendado"
                icon={<Sparkles size={16} />}
                title="Alta Qualidade · Full HD (1080p)"
                subtitle="Imagem nítida e áudio cristalino em MP4 universal. Ideal para YouTube, TikTok, Reels e PC."
                onClick={() => applySimpleTier('high')}
              />
              <QualityCard
                selected={activeSimpleTier === 'ultra'}
                icon={<CheckCircle2 size={16} />}
                title={`Máxima · Ultra HD (${ultraResId === '2160' ? '4K' : '1440p'})`}
                subtitle="Máximo detalhe para telas grandes. Demora mais e gera um arquivo maior."
                onClick={() => applySimpleTier('ultra')}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-soft bg-panel/70 px-3 py-2 text-xs text-muted">
            <span className="tnum font-medium text-ink-soft">
              {ext.toUpperCase()} · {size.width}×{size.height} · {formatDuration(dur).replace(/\.\d+$/, '')}
            </span>
            <span className="tnum">
              Tamanho estimado: {formatBytes(estimate.minBytes)}–{formatBytes(estimate.maxBytes)}
            </span>
          </div>

          <div className="rounded-md border border-line-soft">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-muted hover:text-ink"
              onClick={() => setShowAdvanced((show) => !show)}
            >
              <span>Opções avançadas (formato, FPS, encoder, resolução personalizada)</span>
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {showAdvanced && (
              <div className="space-y-3 border-t border-line-soft p-3">
                <Field label="Formato">
                  <div className="grid grid-cols-3 gap-1">
                    {CODECS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCodec(c.id)}
                        className={`rounded-control border px-2 py-1.5 text-xs ${codec === c.id ? 'border-violet bg-violet/10 text-ink' : 'border-line text-ink-soft hover:bg-raised'}`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-2xs text-muted">{CODECS.find((c) => c.id === codec)!.hint}</p>
                </Field>
                {codec !== 'prores' && (
                  <Field label="Contêiner">
                    <select className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs" value={container} onChange={(event) => setContainer(event.target.value as Container)}>
                      <option value="mp4">MP4 (compatibilidade universal)</option>
                      <option value="mkv">Matroska (MKV)</option>
                      <option value="mov">QuickTime (MOV)</option>
                    </select>
                  </Field>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Resolução">
                    <select className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs" value={resId} onChange={(e) => setResId(e.target.value)}>
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
                  </Field>
                  <Field label="FPS de saída">
                    <select className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs" value={fpsId} onChange={(event) => setFpsId(event.target.value)}>
                      {OUTPUT_FRAME_RATES.map((rate) => <option key={rate.id} value={rate.id}>{rate.label}</option>)}
                    </select>
                    <span className="tnum mt-1 block text-2xs text-muted">{selectedFps.num}/{selectedFps.den} fps</span>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={codec === 'prores' ? 'Perfil ProRes' : 'Velocidade de compressão'}>
                    <select className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs" value={quality} onChange={(e) => setQuality(Number(e.target.value) as 0 | 1 | 2)}>
                      <option value={0}>{codec === 'prores' ? 'Proxy (ProRes 422)' : 'Rápido'}</option>
                      <option value={1}>{codec === 'prores' ? 'Edição (ProRes 422 HQ)' : 'Equilibrado'}</option>
                      <option value={2}>{codec === 'prores' ? 'Máxima qualidade (ProRes 4444)' : 'Mais lento / maior qualidade'}</option>
                    </select>
                  </Field>
                  <Field label="Processador de vídeo">
                    <select className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs" value={encoder} onChange={(event) => setEncoder(event.target.value as Encoder)}>
                      <option value="auto">Automático (placa de vídeo ou CPU)</option>
                      <option value="cpu">CPU (máxima compatibilidade)</option>
                      {hardware.encoders.includes('amf') && <option value="amf">AMD AMF</option>}
                      {hardware.encoders.includes('nvenc') && <option value="nvenc">NVIDIA NVENC</option>}
                      {hardware.encoders.includes('qsv') && <option value="qsv">Intel Quick Sync</option>}
                    </select>
                    <span className="mt-1 block text-2xs text-muted">
                      {hardware.checking
                        ? 'Verificando placa de vídeo em segundo plano…'
                        : hardware.encoders.length
                          ? `Aceleração ativa: ${hardware.encoders.join(', ').toUpperCase()}`
                          : 'Usando CPU automaticamente'}
                    </span>
                  </Field>
                </div>
                {codec !== 'prores' && (
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Taxa">
                      <select className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs" value={rateControl} onChange={(event) => setRateControl(event.target.value as 'crf' | 'bitrate')}>
                        <option value="crf">Qualidade constante (CRF)</option>
                        <option value="bitrate">Bitrate fixo</option>
                      </select>
                    </Field>
                    {rateControl === 'crf' ? (
                      <Field label={`CRF: ${crf}`}>
                        <input type="range" min={14} max={35} value={crf} onChange={(event) => setCrf(Number(event.target.value))} className="mt-2 w-full" />
                      </Field>
                    ) : (
                      <Field label="Vídeo (kb/s)">
                        <input type="number" min={250} max={100000} step={250} value={bitrateK} onChange={(event) => setBitrateK(Math.max(250, Number(event.target.value) || 250))} className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs" />
                      </Field>
                    )}
                    <Field label="Áudio (kb/s)">
                      <select className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs" value={audioBitrateK} onChange={(event) => setAudioBitrateK(Number(event.target.value))}>
                        {[128, 192, 256, 320].map((rate) => <option key={rate} value={rate}>{rate}</option>)}
                      </select>
                    </Field>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function QualityCard({
  selected,
  badge,
  icon,
  title,
  subtitle,
  onClick,
}: {
  selected: boolean;
  badge?: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
        selected
          ? 'border-violet bg-violet/12 ring-1 ring-violet/50'
          : 'border-line bg-base/60 hover:border-line-strong hover:bg-raised/60'
      }`}
    >
      <span className={`mt-0.5 rounded-md p-1.5 ${selected ? 'bg-violet/20 text-violet-strong' : 'bg-raised text-muted'}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <strong className="text-sm font-semibold text-ink">{title}</strong>
          {badge && (
            <span className="rounded-full bg-violet/20 px-2 py-0.5 text-[10px] font-semibold text-violet-strong">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted">{subtitle}</span>
      </span>
    </button>
  );
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function Running({ state }: { state: Extract<State, { kind: 'running' }> }) {
  const eta = etaSeconds(state.p.fraction, Date.now() - state.started);
  return (
    <div className="py-2">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink">{state.p.detail}</span>
        <span className="tnum text-muted">
          {Math.round(state.p.fraction * 100)}%{eta !== null ? ` · ${eta < 60 ? `${Math.ceil(eta)} s` : `${Math.ceil(eta / 60)} min`} restantes` : ''}
        </span>
      </div>
      <Progress value={state.p.fraction} live />
      <p className="mt-3 text-xs text-muted">Gerando seu arquivo MP4 final em alta definição. Não feche o programa até concluir.</p>
    </div>
  );
}
