import { joinPath } from '@amv/media';
import { AudioMixSettingsSchema, type AudioMixSettings, type Track } from '@amv/project';
import type { RenderResult } from '@amv/render';
import { useEffect, useRef, useState } from 'react';
import { startExport, type ExportJob } from '../../core/exporter';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';
import { Button, Dialog, Field } from '../../ui/controls';

const ROLES: { value: NonNullable<Track['role']>; label: string }[] = [
  { value: 'music', label: 'Música' },
  { value: 'voice', label: 'Voz / diálogo' },
  { value: 'sfx', label: 'Efeitos sonoros' },
  { value: 'music2', label: 'Música 2' },
  { value: 'ambience', label: 'Ambiência' },
  { value: 'other', label: 'Outro' },
];

export function AudioMixerDialog({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  const { platform, toast } = useApp();
  const [mixing, setMixing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewPath, setPreviewPath] = useState('');
  const [previewMetrics, setPreviewMetrics] = useState<RenderResult['audioMetrics'] | null>(null);
  const job = useRef<ExportJob | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const project = session.project;
  const audioTracks = project.tracks.filter((track) =>
    track.kind === 'audio' ||
    (track.kind === 'video' && project.audioMix.includeVideoAudio && project.clips.some((clip) =>
      clip.trackId === track.id && !!project.assets.find((asset) => asset.id === clip.assetId)?.probe?.audio.length,
    )),
  );

  const run = (label: string, command: Parameters<typeof session.history.transaction>[1][number]) => {
    try {
      session.history.transaction(label, [command]);
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível atualizar a mixagem', body: (error as Error).message });
    }
  };
  const updateMix = (patch: Partial<AudioMixSettings>) => {
    const parsed = AudioMixSettingsSchema.safeParse({ ...project.audioMix, ...patch });
    if (!parsed.success) {
      toast({ tone: 'error', title: 'Configuração inválida', body: parsed.error.issues[0]?.message ?? 'Revise os valores da mixagem.' });
      return;
    }
    run('Configurar mixagem de áudio', { type: 'audioMix.update', patch });
  };

  const createPreview = async () => {
    if (!platform || mixing) return;
    setMixing(true);
    try {
      audio.current?.pause();
      audio.current?.removeAttribute('src');
      audio.current?.load();
      setPreviewUrl('');
      if (previewPath) await platform.fs.remove(previewPath);
      const path = joinPath(await platform.cacheDir(), `audio-mix-preview-${crypto.randomUUID()}.wav`);
      const dummyRasterizer = async () => null;
      const exportJob = startExport(
        platform,
        session,
        path,
        { width: project.settings.width, height: project.settings.height, enc: { codec: 'h264', quality: 0 }, audioBitrateK: 256, audioOnly: true },
        dummyRasterizer,
        () => undefined,
      );
      job.current = exportJob;
      const result = await exportJob.promise;
      setPreviewPath(path);
      setPreviewUrl(platform.fileUrl(path));
      setPreviewMetrics(result.audioMetrics);
      toast({ tone: 'ok', title: 'Pré-escuta pronta', body: 'Esta prévia foi gerada pela mesma cadeia de áudio da exportação.' });
    } catch (error) {
      toast({ tone: 'error', title: 'Falha ao gerar a pré-escuta', body: (error as Error).message });
    } finally {
      job.current = null;
      setMixing(false);
    }
  };

  const close = () => {
    job.current?.cancel();
    audio.current?.pause();
    audio.current?.removeAttribute('src');
    audio.current?.load();
    if (previewPath && platform) void platform.fs.remove(previewPath).catch((error: unknown) => {
      toast({ tone: 'error', title: 'Não foi possível remover a prévia temporária', body: (error as Error).message });
    });
    onClose();
  };

  return (
    <Dialog title="Mixer de áudio" onClose={close} width="w-[720px]" footer={<Button variant="primary" onClick={close}>Fechar</Button>}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Trilhas</h3>
          <label className="mb-2 flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={project.audioMix.includeVideoAudio} onChange={(event) => updateMix({ includeVideoAudio: event.target.checked })} />
            Incluir o áudio original dos clipes de vídeo
          </label>
          <div className="max-h-64 space-y-2 overflow-auto">
            {audioTracks.map((track) => (
              <div key={track.id} className="grid grid-cols-[minmax(100px,1fr)_150px_1.2fr_auto_auto] items-center gap-2 rounded-control border border-line-soft bg-base p-2">
                <span className="truncate text-sm" title={track.name}>{track.kind === 'video' ? `${track.name} · áudio original` : track.name}</span>
                {track.kind === 'audio' ? (
                  <select
                    aria-label={`Função da trilha ${track.name}`}
                    className="h-8 rounded-control border border-line bg-panel px-2 text-xs"
                    value={track.role ?? 'other'}
                    onChange={(event) => run('Alterar função da trilha', { type: 'track.update', trackId: track.id, patch: { role: event.target.value as Track['role'] } })}
                  >
                    {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                ) : <span className="text-xs text-muted">Voz (automático)</span>}
                <label className="flex items-center gap-2 text-xs text-ink-soft">
                  <span className="w-12">{track.gainDb.toFixed(1)} dB</span>
                  <AudioRange
                    className="min-w-0 flex-1"
                    ariaLabel={`Ganho da trilha ${track.name}`}
                    min={-24}
                    max={12}
                    step={0.5}
                    value={track.gainDb}
                    onCommit={(value) => run('Ajustar ganho da trilha', { type: 'track.update', trackId: track.id, patch: { gainDb: value } })}
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input type="checkbox" checked={track.muted} onChange={(event) => run('Silenciar trilha', { type: 'track.update', trackId: track.id, patch: { muted: event.target.checked } })} />
                  Mudo
                </label>
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input type="checkbox" checked={track.solo} onChange={(event) => run('Solo da trilha', { type: 'track.update', trackId: track.id, patch: { solo: event.target.checked } })} />
                  Solo
                </label>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4">
          <Field label="Ducking automático de voz">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={project.audioMix.duckingEnabled} onChange={(event) => updateMix({ duckingEnabled: event.target.checked })} />
              Reduzir música durante trilhas de voz
            </label>
            <label className="mt-2 block text-xs text-muted">
              Redução: {project.audioMix.duckingAmountDb} dB
              <AudioRange className="mt-1 block w-full" ariaLabel="Redução automática de música em dB" min={0} max={24} step={1} value={project.audioMix.duckingAmountDb} onCommit={(value) => updateMix({ duckingAmountDb: value })} />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">Ataque (ms)
                <AudioNumber min={0} max={2000} value={project.audioMix.duckingAttackMs} ariaLabel="Ataque do ducking em milissegundos" onCommit={(value) => updateMix({ duckingAttackMs: value })} />
              </label>
              <label className="text-xs text-muted">Retorno (ms)
                <AudioNumber min={0} max={5000} value={project.audioMix.duckingReleaseMs} ariaLabel="Retorno do ducking em milissegundos" onCommit={(value) => updateMix({ duckingReleaseMs: value })} />
              </label>
            </div>
          </Field>
          <Field label="Masterização">
            <label className="block text-xs text-muted">Normalização
              <select className="mt-1 h-8 w-full rounded-control border border-line bg-base px-2 text-sm text-ink" value={project.audioMix.normalization} onChange={(event) => updateMix({ normalization: event.target.value as AudioMixSettings['normalization'] })}>
                <option value="off">Desativada</option>
                <option value="ebu-r128">EBU R128 (passagem dinâmica)</option>
              </select>
            </label>
            <label className="mt-2 block text-xs text-muted">Alvo: {project.audioMix.targetLufs} LUFS
              <AudioRange className="mt-1 block w-full" ariaLabel="Alvo de loudness em LUFS" min={-24} max={-5} step={1} value={project.audioMix.targetLufs} onCommit={(value) => updateMix({ targetLufs: value })} />
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={project.audioMix.limiterEnabled} onChange={(event) => updateMix({ limiterEnabled: event.target.checked })} />
              Limitador de pico
            </label>
            <label className="mt-2 block text-xs text-muted">Teto: {project.audioMix.limiterCeilingDb.toFixed(1)} dBFS
              <AudioRange className="mt-1 block w-full" ariaLabel="Teto do limitador em dBFS" min={-12} max={0} step={0.1} value={project.audioMix.limiterCeilingDb} onCommit={(value) => updateMix({ limiterCeilingDb: value })} />
            </label>
          </Field>
        </section>

        <section className="rounded-control border border-line-soft bg-base p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Pré-escuta da mixagem</h3>
              <p className="mt-1 text-xs text-muted">Renderiza o WAV integral com a cadeia usada na exportação, sem modificar os originais.</p>
            </div>
            <Button disabled={mixing} onClick={() => void createPreview()}>{mixing ? 'Renderizando…' : 'Gerar pré-escuta'}</Button>
          </div>
          {previewUrl && (
            <>
              <audio ref={audio} className="mt-3 w-full" controls src={previewUrl} />
              {previewMetrics && <p className="mt-2 text-xs text-muted">
                {previewMetrics.integratedLufs === null ? 'Loudness indisponível' : `${previewMetrics.integratedLufs.toFixed(1)} LUFS`}
                {' · Pico verdadeiro: '}
                {previewMetrics.truePeakDbfs === null ? 'indisponível' : `${previewMetrics.truePeakDbfs.toFixed(1)} dBFS`}
                {' · '}
                {previewMetrics.clippingDetected ? 'clipping detectado' : 'sem clipping digital detectado'}
              </p>}
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
}

function AudioRange({
  value,
  min,
  max,
  step,
  ariaLabel,
  className = 'w-full accent-violet',
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  ariaLabel: string;
  className?: string;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  useEffect(() => {
    setDraft(value);
    committed.current = value;
  }, [value]);
  const commit = () => {
    if (draft === committed.current) return;
    committed.current = draft;
    onCommit(draft);
  };
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      className={`accent-violet ${className}`}
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(event) => setDraft(Number(event.target.value))}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
    />
  );
}

function AudioNumber({ value, min, max, ariaLabel, onCommit }: {
  value: number;
  min: number;
  max: number;
  ariaLabel: string;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  const committed = useRef(value);
  useEffect(() => {
    setDraft(String(value));
    committed.current = value;
  }, [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed === committed.current) return;
    committed.current = parsed;
    onCommit(parsed);
  };
  return (
    <input
      className="mt-1 h-8 w-full rounded-control border border-line bg-base px-2 text-sm text-ink"
      type="number"
      aria-label={ariaLabel}
      min={min}
      max={max}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
    />
  );
}
