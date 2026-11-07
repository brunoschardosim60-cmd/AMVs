import { parseSubtitles, decodeSubtitleBytes, type Cue } from '@amv/analysis';
import { generateAmv, STYLES, type GenerateOptions, type StyleId } from '@amv/automv';
import { Flame, Heart, Mic, Music2, Sparkles, Type, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp, useLibraryVersion, useSessionVersion } from '../../store';
import { displayTitle, recommend, STYLE_THEME } from '@amv/music';
import { Button, Dialog } from '../../ui/controls';

const ICONS: Record<StyleId, typeof Flame> = { hype: Flame, superacao: Sparkles, letra: Type, discurso: Mic, emocional: Heart };
const INTENSITY = ['Suave', 'Moderada', 'Intensa', 'Extrema'] as const;
const DURATIONS = [15, 30, 45, 60, 90];

export function GenerateDialog({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  useSessionVersion(session);
  const { platform, toast, library } = useApp();
  useLibraryVersion(library);
  const project = session.project;
  const musics = project.assets.filter((a) => a.kind === 'audio');
  const episodes = project.assets.filter((a) => a.kind === 'video');
  const [musicId, setMusicId] = useState(musics[0]?.id ?? '');
  const [epIds, setEpIds] = useState<string[]>(episodes.map((e) => e.id));
  const [style, setStyle] = useState<StyleId>('hype');
  const [intensity, setIntensity] = useState<0 | 1 | 2 | 3>(2);
  const [duration, setDuration] = useState(30);
  const [useSpeech, setUseSpeech] = useState(true);
  const [useEffects, setUseEffects] = useState(true);
  const [showText, setShowText] = useState(true);
  const [lyrics, setLyrics] = useState<{ name: string; cues: Cue[] } | null>(null);
  const [seed, setSeed] = useState(1);
  const [result, setResult] = useState<{ warnings: string[]; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const music = session.assetRuntime(musicId).music;
  const ready = episodes.filter((e) => epIds.includes(e.id) && session.assetRuntime(e.id).episode);
  const waiting = epIds.filter((id) => !session.assetRuntime(id).episode).length + (musicId && !music ? 1 : 0);
  const sceneCount = useMemo(() => ready.reduce((a, e) => a + (session.assetRuntime(e.id).episode?.shots.length ?? 0), 0), [ready, session]);

  const pickLyrics = async () => {
    const path = await platform!.dialogs.pickFile('Letra da música (com tempo)', ['lrc', 'srt', 'ass', 'vtt', 'txt']);
    if (!path) return;
    const text = decodeSubtitleBytes(await platform!.fs.readFile(path));
    const cues = parseSubtitles(path, text, music?.durationS);
    const timed = cues.filter((c) => Number.isFinite(c.startS));
    if (!timed.length) {
      toast({ tone: 'warn', title: 'Essa letra não tem tempo', body: 'Use um arquivo .lrc ou .srt (letra sincronizada).' });
      return;
    }
    setLyrics({ name: path.split(/[\\/]/).pop()!, cues: timed });
  };

  const generate = async (nextSeed = seed) => {
    if (!music) return;
    setBusy(true);
    try {
      const opts: GenerateOptions = { style, intensity, durationS: duration, musicStartS: null, lyrics: lyrics?.cues, useSpeech, useEffects, showText, seed: nextSeed, exclude: episodes.filter((e) => !epIds.includes(e.id)).map((e) => e.id) };
      const m = musics.find((a) => a.id === musicId)!;
      const r = generateAmv(
        project,
        { assetId: m.id, name: m.name, analysis: music },
        ready.map((e) => ({ assetId: e.id, name: e.name, analysis: session.assetRuntime(e.id).episode!, hasAudio: (e.probe?.audio.length ?? 0) > 0 })),
        opts,
      );
      // guarda o que estava antes: nada se perde
      await session.saveVersion(`Antes de gerar (${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`);
      const label = STYLES.find((s) => s.id === style)!.label;
      session.history.transaction(`Gerar meu AMV — ${label}`, r.commands);
      setSeed(nextSeed);
      const s = r.summary;
      setResult({
        warnings: r.warnings,
        text: `${s.clips} cenas, ${s.cuts} cortes${s.drop !== null ? `, drop em ${s.drop.toFixed(1)} s` : ''}${s.speech ? `, fala: "${s.speech}"` : ''}. Trecho da música: ${s.musicRange[0].toFixed(0)}–${s.musicRange[1].toFixed(0)} s.`,
      });
    } catch (e) {
      toast({ tone: 'error', title: 'Não deu para gerar', body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const recs = library ? recommend(library.lib, STYLE_THEME[style] ?? 'motivacao', { limit: 3, targetDurationS: duration }).filter((r) => !project.assets.some((a) => a.hash === r.track.hash)) : [];
  const addFromLibrary = async (trackId: string) => {
    const t = library!.track(trackId)!;
    await session.importFiles([t.path]);
    const a = session.project.assets.find((x) => x.hash === t.hash);
    if (a) {
      setMusicId(a.id);
      library!.markUsed(t.id, project.name);
    }
  };

  const toggleEp = (id: string) => setEpIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  if (result) {
    return (
      <Dialog
        title="AMV gerado"
        onClose={onClose}
        width="w-[560px]"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResult(null)}>
              Mudar opções
            </Button>
            <Button icon={<Wand2 size={15} />} disabled={busy} onClick={() => generate(seed + 1)}>
              Gerar outra versão
            </Button>
            <Button variant="primary" onClick={onClose}>
              Editar na timeline
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">{result.text}</p>
        <p className="mt-2 text-xs text-muted">Tudo virou clipes comuns: passe o mouse num clipe da timeline para ver por que a IA escolheu aquela cena. Desfazer (Ctrl+Z) volta tudo; a montagem anterior também ficou guardada em Versões.</p>
        {result.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-md border border-warn/30 bg-warn/10 p-3 text-xs text-ink-soft">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Gerar meu AMV"
      onClose={onClose}
      width="w-[760px]"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted">{waiting > 0 ? `Esperando a análise de ${waiting} arquivo(s)…` : `${sceneCount} cenas de ${ready.length} episódio(s)`}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon={<Wand2 size={15} />} disabled={!music || ready.length === 0 || busy} onClick={() => generate(seed)}>
            Gerar
          </Button>
        </>
      }
    >
      {episodes.length === 0 || (musics.length === 0 && !recs.length) ? (
        <p className="text-sm text-ink-soft">Importe pelo menos <b>uma música</b> e <b>um episódio</b>. O AMV Studio analisa os dois e monta o vídeo a partir deles.</p>
      ) : (
        <div className="grid max-h-[62vh] grid-cols-[1fr_220px] gap-5 overflow-y-auto pr-1">
          <div>
            <p className="mb-2 text-xs font-medium text-ink-soft">Estilo</p>
            <div className="grid grid-cols-1 gap-1.5">
              {STYLES.map((s) => {
                const Icon = ICONS[s.id];
                const on = style === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyle(s.id)}
                    className={`flex gap-3 rounded-md border px-3 py-2 text-left ${on ? 'border-violet bg-violet/10' : 'border-line hover:bg-raised'}`}
                  >
                    <Icon size={18} className={`mt-0.5 shrink-0 ${on ? 'text-violet-strong' : 'text-muted'}`} />
                    <span>
                      <span className="block text-sm font-semibold">{s.label}</span>
                      <span className="block text-xs text-muted">{s.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mt-4 mb-2 text-xs font-medium text-ink-soft">Intensidade</p>
            <div className="flex gap-1 rounded-control bg-base p-1">
              {INTENSITY.map((label, i) => (
                <button key={label} type="button" onClick={() => setIntensity(i as 0 | 1 | 2 | 3)} className={`flex-1 rounded-[4px] py-1.5 text-xs ${intensity === i ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-soft">Música</p>
              <select className="h-9 w-full rounded-control border border-line bg-base px-2 text-sm" value={musicId} onChange={(e) => setMusicId(e.target.value)} disabled={!musics.length}>
                {!musics.length && <option value="">Escolha uma abaixo</option>}
                {musics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              {music ? (
                <p className="mt-1 flex items-center gap-1 text-2xs text-muted">
                  <Music2 size={11} /> {music.bpm} BPM · {music.drops.length ? `drop em ${Math.floor(music.drops[0]! / 60)}:${String(Math.floor(music.drops[0]! % 60)).padStart(2, '0')}` : 'sem drop claro'}
                </p>
              ) : (
                <p className="mt-1 text-2xs text-muted">Analisando a música…</p>
              )}
            </div>

            {recs.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-ink-soft">Combinam com o estilo (sua biblioteca)</p>
                <ul className="space-y-1">
                  {recs.map((r) => (
                    <li key={r.track.id}>
                      <button type="button" title={r.reasons.join(' · ')} onClick={() => void addFromLibrary(r.track.id)} className="flex w-full items-center gap-2 rounded border border-line px-2 py-1 text-left text-2xs hover:bg-raised">
                        <Music2 size={11} className="shrink-0 text-violet-strong" />
                        <span className="min-w-0 flex-1 truncate">{displayTitle(r.track)}</span>
                        <span className="tnum text-faint">{Math.round(r.score * 100)}%</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-soft">Duração</p>
              <div className="flex flex-wrap gap-1">
                {DURATIONS.map((d) => (
                  <button key={d} type="button" onClick={() => setDuration(d)} className={`tnum rounded-control border px-2.5 py-1 text-xs ${duration === d ? 'border-violet bg-violet/10' : 'border-line text-muted hover:text-ink'}`}>
                    {d} s
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-soft">Episódios</p>
              <ul className="max-h-32 space-y-1 overflow-y-auto">
                {episodes.map((e) => {
                  const a = session.assetRuntime(e.id);
                  return (
                    <li key={e.id}>
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" className="accent-violet" checked={epIds.includes(e.id)} onChange={() => toggleEp(e.id)} />
                        <span className="min-w-0 flex-1 truncate">{e.name}</span>
                        <span className="text-2xs text-faint">{a.episode ? `${a.episode.shots.length} cenas` : a.analysis === 'error' ? 'erro' : '…'}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="space-y-1.5 text-xs">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-violet" checked={useSpeech} onChange={(e) => setUseSpeech(e.target.checked)} /> Fala marcante antes do drop
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-violet" checked={useEffects} onChange={(e) => setUseEffects(e.target.checked)} /> Efeitos (clarão, tremida, zoom)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-violet" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> Legendas e letras na tela
              </label>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-ink-soft">Letra da música (opcional)</p>
              <Button size="sm" onClick={pickLyrics}>
                {lyrics ? lyrics.name : 'Escolher .lrc / .srt'}
              </Button>
              <p className="mt-1 text-2xs text-muted">Necessária para o estilo "Letra na tela".</p>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
