import { buildProjectMusicDuckingCommands, suggestMusicRanges, type MusicDuckingPreset } from '@amv/automv';
import { clipEndUs, type Asset, type Clip, type Command, type Project } from '@amv/project';
import { Music2, Pause, Play, RotateCcw, Sparkles, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp } from '../../store';

const S = 1_000_000;

const fmtTime = (sec: number) => {
  const safe = Math.max(0, sec);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export function detectMusicDuckingState(clip: Clip): MusicDuckingPreset | 'auto' {
  const kf = clip.keyframes['audio.gainDb'];
  if (!kf || kf.length === 0) {
    return clip.audio.duckingMode === 'manual' ? 'off' : 'auto';
  }
  const minVal = Math.min(...kf.map((k) => k.value));
  if (minVal >= -0.2) return 'off';
  if (minVal >= -8) return 'gentle';
  if (minVal >= -13.5) return 'smart';
  return 'deep';
}

const DUCKING_OPTIONS: { id: MusicDuckingPreset; label: string; shortLabel: string; tip: string }[] = [
  { id: 'off', label: 'Sem abafar (0 dB)', shortLabel: 'Sem abafar', tip: 'Mantém a música 100% limpa e forte o tempo todo, sem quedas de volume.' },
  { id: 'gentle', label: 'Suave (-6 dB)', shortLabel: 'Suave', tip: 'Abaixa levemente a música nas falas sem perder o peso do instrumental.' },
  { id: 'smart', label: 'Inteligente (Clímax protegido)', shortLabel: 'Inteligente', tip: 'Protege o refrão/drop contra abafamento e reduz moderadamente nos trechos calmos.' },
  { id: 'deep', label: 'Forte (-16 dB)', shortLabel: 'Forte', tip: 'Abaixa bastante a música para dar foco total às falas dos personagens.' },
];

export function MusicDuckingQuickPills({
  session,
  project,
  clip,
  disabled = false,
  compact = false,
}: {
  session: ProjectSession;
  project: Project;
  clip: Clip;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { toast } = useApp();
  const active = detectMusicDuckingState(clip);
  const musicAnalysis = clip.assetId ? session.assetRuntime(clip.assetId).music : null;

  const applyPreset = (preset: MusicDuckingPreset, label: string) => {
    const cmds = buildProjectMusicDuckingCommands(project, clip.id, preset, musicAnalysis);
    if (!cmds.length) return;
    session.history.transaction(`Equilíbrio da música: ${label}`, cmds);
    toast({
      tone: 'ok',
      title: `Música: ${label}`,
      body: preset === 'off'
        ? 'Quedas de volume removidas — a música toca limpa sem abafar.'
        : 'Automação de volume recalculada sobre as falas audíveis.',
    });
  };

  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-control border border-line bg-base">
      <span className="px-1.5 text-2xs text-muted" title="Controle anti-abafamento da música durante falas">
        Mix
      </span>
      {DUCKING_OPTIONS.map((opt) => {
        const isCurrent = active === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            title={opt.tip}
            onClick={() => applyPreset(opt.id, opt.label)}
            className={`h-7 border-l border-line-soft px-2 text-2xs transition-colors disabled:opacity-50 ${
              isCurrent ? 'bg-azure/20 font-semibold text-ink' : 'text-muted hover:bg-raised hover:text-ink'
            }`}
          >
            {compact ? opt.shortLabel : opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function MusicSliceInspectorCard({
  session,
  project,
  clip,
  asset,
  disabled = false,
  onSlipToStartS,
}: {
  session: ProjectSession;
  project: Project;
  clip: Clip;
  asset: Asset;
  disabled?: boolean;
  onSlipToStartS: (startS: number, label?: string) => void;
}) {
  const { platform } = useApp();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const startS = clip.sourceInUs / S;
  const endS = clip.sourceOutUs / S;
  const clipDurS = Math.max(1, (clipEndUs(clip) - clip.timelineStartUs) / S);
  const musicAnalysis = session.assetRuntime(asset.id).music;
  const totalSongS = musicAnalysis?.durationS ?? (asset.probe?.durationUs ? asset.probe.durationUs / S : Math.max(endS, 60));
  const maxStartS = Math.max(0, totalSongS - (endS - startS));
  const [scrubS, setScrubS] = useState(startS);

  useEffect(() => {
    setScrubS(startS);
  }, [startS]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const mediaUrl = platform && asset.status !== 'missing' ? platform.fileUrl(asset.path) : '';

  const suggestions = useMemo(() => {
    if (!musicAnalysis) return [];
    return suggestMusicRanges(musicAnalysis, clipDurS, null, 4);
  }, [musicAnalysis, clipDurS]);

  const togglePreview = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      if (el.currentTime < startS - 0.1 || el.currentTime >= endS - 0.05) {
        el.currentTime = startS;
      }
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  };

  return (
    <div className="space-y-2.5 rounded-md border border-line-soft bg-base/70 p-2.5 text-2xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Music2 size={13} className="shrink-0 text-azure" />
          <span className="truncate font-semibold text-ink">Trecho da música</span>
        </div>
        <span className="tnum shrink-0 font-medium text-azure">
          {fmtTime(startS)} → {fmtTime(endS)} / {fmtTime(totalSongS)}
        </span>
      </div>

      {mediaUrl && (
        <audio
          ref={audioRef}
          src={mediaUrl}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime >= endS) {
              e.currentTarget.pause();
            }
          }}
        />
      )}

      {maxStartS > 0.2 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-muted">
            <span>Escolher ponto na música: <b className="tnum text-ink">{fmtTime(scrubS)}</b></span>
            {musicAnalysis && <span>{musicAnalysis.bpm} BPM</span>}
          </div>
          <input
            type="range"
            aria-label="Ponto inicial da música"
            disabled={disabled}
            min={0}
            max={maxStartS}
            step={0.25}
            value={Math.min(maxStartS, scrubS)}
            onChange={(e) => setScrubS(Number(e.target.value))}
            onPointerUp={() => {
              if (Math.abs(scrubS - startS) >= 0.05) onSlipToStartS(scrubS, `Trecho da música em ${fmtTime(scrubS)}`);
            }}
            onKeyUp={() => {
              if (Math.abs(scrubS - startS) >= 0.05) onSlipToStartS(scrubS, `Trecho da música em ${fmtTime(scrubS)}`);
            }}
            className="h-1.5 w-full accent-azure"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {mediaUrl && (
          <>
            <button
              type="button"
              onClick={togglePreview}
              className="inline-flex h-6 items-center gap-1 rounded border border-azure/45 bg-azure/15 px-2 font-medium text-ink hover:bg-azure/25"
            >
              {playing ? <Pause size={11} /> : <Play size={11} />}
              {playing ? 'Pausar trecho' : 'Ouvir trecho'}
            </button>
            <button
              type="button"
              title="Voltar para o início do trecho escolhido"
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.currentTime = startS;
                  void audioRef.current.play().catch(() => undefined);
                }
              }}
              className="inline-flex h-6 items-center rounded border border-line bg-panel px-1.5 text-muted hover:text-ink"
            >
              <RotateCcw size={11} />
            </button>
          </>
        )}
        {[-4, -1, 1, 4].map((sec) => (
          <button
            key={sec}
            type="button"
            disabled={disabled}
            onClick={() => onSlipToStartS(Math.max(0, Math.min(maxStartS, startS + sec)), `Deslizar música ${sec > 0 ? `+${sec}` : sec}s`)}
            className="tnum h-6 rounded border border-line bg-panel px-1.5 text-ink-soft hover:bg-raised hover:text-ink disabled:opacity-50"
          >
            {sec > 0 ? `+${sec}s` : `${sec}s`}
          </button>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-1 border-t border-line-soft pt-2">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-azure">
            <Sparkles size={10} /> Melhores partes identificadas na música
          </div>
          <div className="space-y-1">
            {suggestions.map((sug, idx) => {
              const isSelected = Math.abs(sug.startS - startS) < 0.8;
              return (
                <button
                  key={sug.startS}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSlipToStartS(sug.startS, `Ir para melhor parte (${fmtTime(sug.startS)})`)}
                  className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left transition-colors disabled:opacity-50 ${
                    isSelected
                      ? 'border-azure bg-azure/15 text-ink'
                      : 'border-line-soft bg-panel/80 text-ink-soft hover:border-azure/50 hover:text-ink'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span className="tnum">{idx + 1}º · {fmtTime(sug.startS)}–{fmtTime(sug.endS)}</span>
                      <span className="rounded bg-azure/20 px-1 text-[9px] text-azure">{Math.round(sug.score * 100)}%</span>
                    </div>
                    {sug.reasons.length > 0 && (
                      <div className="truncate text-[10px] text-muted">{sug.reasons.slice(0, 2).join(' · ')}</div>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold text-azure">
                    {isSelected ? 'Em uso' : 'Usar'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1 border-t border-line-soft pt-2">
        <div className="flex items-center gap-1 text-[10px] font-semibold text-ink-soft">
          <Volume2 size={11} className="text-azure" />
          Equilíbrio Música × Falas (evitar abafar o som)
        </div>
        <MusicDuckingQuickPills session={session} project={project} clip={clip} disabled={disabled} compact />
      </div>
    </div>
  );
}

/** Desliza o clipe de música para `newStartS` e recalcula o ducking inteligente se havia automação. */
export function buildSlipMusicClipCommands(
  session: ProjectSession,
  project: Project,
  clip: Clip,
  newStartS: number,
): Command[] {
  const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : null;
  const spanUs = clip.sourceOutUs - clip.sourceInUs;
  const maxDurUs = asset?.probe?.durationUs ?? Number.MAX_SAFE_INTEGER;
  const clampedInUs = Math.max(0, Math.min(Math.max(0, maxDurUs - spanUs), Math.round(newStartS * S)));
  if (clampedInUs === clip.sourceInUs) return [];

  const updatedClip: Clip = {
    ...clip,
    sourceInUs: clampedInUs,
    sourceOutUs: clampedInUs + spanUs,
  };
  const cmds: Command[] = [{
    type: 'clip.update',
    clipId: clip.id,
    patch: { sourceInUs: updatedClip.sourceInUs, sourceOutUs: updatedClip.sourceOutUs },
  }];

  // Se o clipe tinha automação de ducking e pertence à trilha de música, realinha com a energia do novo trecho
  const track = project.tracks.find((t) => t.id === clip.trackId);
  if (track?.role === 'music' && clip.keyframes['audio.gainDb']?.length) {
    const preset = detectMusicDuckingState(clip);
    if (preset !== 'auto' && preset !== 'off') {
      const musicAnalysis = clip.assetId ? session.assetRuntime(clip.assetId).music : null;
      const tempProject: Project = {
        ...project,
        clips: project.clips.map((c) => (c.id === clip.id ? updatedClip : c)),
      };
      const duckCmds = buildProjectMusicDuckingCommands(tempProject, clip.id, preset, musicAnalysis);
      for (const dc of duckCmds) {
        if (dc.type === 'clip.update' && dc.clipId === clip.id) {
          cmds[0] = {
            type: 'clip.update',
            clipId: clip.id,
            patch: {
              sourceInUs: updatedClip.sourceInUs,
              sourceOutUs: updatedClip.sourceOutUs,
              ...dc.patch,
            },
          };
        }
      }
    }
  }
  return cmds;
}
