import { impactScore, parseSubtitles, decodeSubtitleBytes, type Cue } from '@amv/analysis';
import { chooseMusicRange, generateAmv, planFootage, STYLES, suggestMusicRanges, type EpisodeInput, type GenerateOptions, type StyleId } from '@amv/automv';
import { characterCounts, pickAudioStreamByLanguage, type EpisodeVision, type VisionScope } from '@amv/analysis';
import { isLocal, loadAiSettings, secretName } from '../../core/aiSettings';
import { Flame, Heart, Mic, Music2, Sparkles, Type, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp, useLibraryVersion, useSessionVersion } from '../../store';
import { displayTitle, recommend, STYLE_THEME } from '@amv/music';
import { Button, Dialog } from '../../ui/controls';

const ICONS: Record<StyleId, typeof Flame> = { hype: Flame, superacao: Sparkles, letra: Type, discurso: Mic, emocional: Heart };
const INTENSITY = ['Suave', 'Moderada', 'Intensa', 'Extrema'] as const;
const DURATIONS = [15, 30, 45, 60, 90];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function GenerateDialog({ session, onClose }: { session: ProjectSession; onClose: () => void }) {
  useSessionVersion(session);
  const { platform, toast, library } = useApp();
  useLibraryVersion(library);
  const project = session.project;
  const musics = project.assets.filter((a) => a.kind === 'audio' && !a.tags.includes('sfx'));
  const episodes = project.assets.filter((a) => a.kind === 'video');
  const [musicId, setMusicId] = useState(musics[0]?.id ?? '');
  const [epIds, setEpIds] = useState<string[]>(episodes.map((e) => e.id));
  const [style, setStyle] = useState<StyleId>('hype');
  const [intensity, setIntensity] = useState<0 | 1 | 2 | 3>(2);
  const [duration, setDuration] = useState(30);
  const [voiceMoments, setVoiceMoments] = useState(1);
  const [voiceLang, setVoiceLang] = useState<'original' | 'pt'>('original');
  const [focus, setFocus] = useState<'fight' | 'mix'>('fight');
  const [seqIds, setSeqIds] = useState<string[]>([]);
  const [hitSync, setHitSync] = useState(true);
  const [beatOffsetMs, setBeatOffsetMs] = useState(0);
  const [useSfx, setUseSfx] = useState(true);
  const [characters, setCharacters] = useState<string[]>([]);
  const [visionScope, setVisionScope] = useState<VisionScope>('fights');
  const [vision, setVision] = useState<{ done: number; total: number; ep: string } | null>(null);
  const visionAbort = useRef<AbortController | null>(null);
  const [musicStart, setMusicStart] = useState<number | null>(null);
  const [useEffects, setUseEffects] = useState(true);
  const [showText, setShowText] = useState(true);
  const [lyrics, setLyrics] = useState<{ name: string; cues: Cue[] } | null>(null);
  const [seed, setSeed] = useState(1);
  const [result, setResult] = useState<{ warnings: string[]; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const music = session.assetRuntime(musicId).music;
  const ready = episodes.filter((e) => epIds.includes(e.id) && session.assetRuntime(e.id).episode);
  const waiting = epIds.filter((id) => !session.assetRuntime(id).episode).length + (musicId && !music ? 1 : 0);
  // muda quando a visão de algum episódio ganha cenas (para refazer o plano)
  const visionVersion = ready.map((e) => Object.keys(session.assetRuntime(e.id).vision?.shots ?? {}).length).join(',');
  const inputs = useMemo<EpisodeInput[]>(
    () =>
      ready.map((e) => ({
        assetId: e.id,
        name: e.name,
        analysis: session.assetRuntime(e.id).episode!,
        hasAudio: (e.probe?.audio.length ?? 0) > 0,
        audioStreams: e.probe?.audio.map((a) => ({ index: a.index, language: a.language, title: a.title })),
        vision: (session.assetRuntime(e.id).vision as EpisodeVision | null | undefined) ?? undefined,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready.map((e) => e.id).join(','), session, visionVersion],
  );
  const excluded = useMemo(() => episodes.filter((e) => !epIds.includes(e.id)).map((e) => e.id), [episodes, epIds]);
  const fights = useMemo(
    () =>
      inputs
        .flatMap((ep) => ep.analysis.sequences?.filter((q) => q.kind === 'luta').map((q) => ({ ep, q })) ?? [])
        .sort((a, b) => b.q.intensity - a.q.intensity)
        .slice(0, 8),
    [inputs],
  );
  const plan = useMemo(
    () => (music && inputs.length ? planFootage(inputs, { style, intensity, durationS: duration, focus, sequenceIds: seqIds, exclude: excluded, seed, characters }, music) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [music, inputs, style, intensity, duration, focus, seqIds.join(','), excluded.join(','), seed, characters.join(',')],
  );
  const ranges = useMemo(() => (music && plan ? suggestMusicRanges(music, duration, plan.fit, 3) : []), [music, plan, duration]);
  // o trecho escolhido só vale enquanto ainda é uma das sugestões (mudou duração/estilo/luta: volta ao automático)
  const chosenStart = ranges.some((r) => r.startS === musicStart) ? musicStart : null;

  // carrega do cache a visão já feita (uma vez por episódio)
  useEffect(() => {
    for (const e of ready) if (session.assetRuntime(e.id).vision === undefined) void session.loadVision(e.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready.map((e) => e.id).join(',')]);
  const charList = useMemo(() => {
    const all = new Map<string, { name: string; shots: number }>();
    for (const e of ready) for (const c of characterCounts(session.assetRuntime(e.id).vision)) {
      const k = c.name.toLowerCase();
      const x = all.get(k);
      if (x) x.shots += c.shots;
      else all.set(k, { ...c });
    }
    return [...all.values()].sort((a, b) => b.shots - a.shots).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visionVersion]);
  const visionTodo = ready.reduce((n, e) => n + session.visionTargets(e.id, visionScope).length, 0);

  const runVision = async () => {
    if (!platform || vision) return;
    try {
      const settings = await loadAiSettings(platform);
      if (!settings.enabled) {
        toast({ tone: 'warn', title: 'Ligue um modelo de IA com visão', body: 'Abra o Assistente e clique na engrenagem. Gemini, Claude, GPT-4o e modelos de visão no Ollama são compatíveis.' });
        return;
      }
      if (!isLocal(settings) && !settings.allowExternal) {
        toast({ tone: 'warn', title: 'Envio para a internet desligado', body: 'A análise manda quadros dos episódios ao serviço de IA. Autorize na engrenagem do Assistente ou use um modelo local (Ollama).' });
        return;
      }
      const key = settings.provider.needsKey ? await platform.secrets.get(secretName(settings.presetId)) : null;
      const musicRange = music ? chooseMusicRange(music, duration, chosenStart) : null;
      const context = music
        ? {
            style: STYLES.find((item) => item.id === style)!.label,
            targetIntensity: INTENSITY[intensity],
            music: {
              bpm: music.bpm,
              bpmConfidence: music.bpmConfidence,
              intensity: music.intensity,
              sections: music.sections.map(({ label, energy }) => ({ label, energy })),
              dropsS: music.drops.filter((drop) => !musicRange || (drop >= musicRange[0] && drop <= musicRange[1])),
            },
            lyrics: lyrics?.cues
              .filter((cue) => !musicRange || (cue.endS > musicRange[0] && cue.startS < musicRange[1]))
              .sort((a, b) => impactScore(b.text) - impactScore(a.text))
              .slice(0, 6)
              .sort((a, b) => a.startS - b.startS)
              .map((cue) => `[${mmss(cue.startS)}] ${cue.text}`),
          }
        : undefined;
      visionAbort.current = new AbortController();
      let labeled = 0;
      let failed = 0;
      let frameFailures = 0;
      for (const e of ready) {
        if (!session.visionTargets(e.id, visionScope).length) continue;
        setVision({ done: 0, total: session.visionTargets(e.id, visionScope).length, ep: e.name });
        const r = await session.runVision(e.id, { provider: settings.provider, key, fetch: platform.http, scope: visionScope, context, signal: visionAbort.current.signal, onProgress: (done, total) => setVision({ done, total, ep: e.name }) });
        labeled += r.labeled;
        failed += r.failed;
        frameFailures += r.frameFailures;
        if (visionAbort.current.signal.aborted) break;
      }
      toast(failed || frameFailures ? { tone: 'warn', title: `${labeled} cenas analisadas`, body: `${failed} cenas sem resposta do modelo; ${frameFailures} quadros não puderam ser extraídos. Rode de novo para tentar as cenas incompletas.` } : { tone: 'ok', title: `${labeled} cenas analisadas`, body: 'Escolha os personagens ao lado.' });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast({ tone: 'error', title: 'Não deu para analisar as cenas', body: (err as Error).message });
    } finally {
      visionAbort.current = null;
      setVision(null);
    }
  };

  const hasTwoAudio = ready.some((e) => (e.probe?.audio.length ?? 0) > 1);
  const noOriginal = ready.some((e) => (e.probe?.audio.length ?? 0) > 1 && pickAudioStreamByLanguage(e.probe!.audio, voiceLang) === null);
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
      // efeitos sonoros: grava/registra uma vez; se falhar, o AMV sai sem eles e avisa
      let sfxAssets: GenerateOptions['sfxAssets'];
      let sfxError: string | null = null;
      if (useSfx) {
        try {
          sfxAssets = await session.ensureSfx();
        } catch (e) {
          sfxError = (e as Error).message;
        }
      }
      const opts: GenerateOptions = { useSfx, sfxAssets, style, intensity, durationS: duration, musicStartS: chosenStart, lyrics: lyrics?.cues, useSpeech: voiceMoments > 0, voiceMoments, voiceLang, useEffects, showText, seed: nextSeed, exclude: excluded, focus, sequenceIds: seqIds, hitSync, beatOffsetMs, characters };
      const m = musics.find((a) => a.id === musicId)!;
      const r = generateAmv(session.project, { assetId: m.id, name: m.name, analysis: music }, inputs, opts);
      if (sfxError) r.warnings.push(`Não consegui preparar os efeitos sonoros (${sfxError}): o vídeo saiu sem eles.`);
      // guarda o que estava antes: nada se perde
      await session.saveVersion(`Antes de gerar (${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`);
      const label = STYLES.find((s) => s.id === style)!.label;
      session.history.transaction(`Gerar meu AMV — ${label}`, r.commands);
      setSeed(nextSeed);
      const s = r.summary;
      setResult({
        warnings: r.warnings,
        text: `${s.clips} cenas, ${s.cuts} cortes${s.drop !== null ? `, drop em ${s.drop.toFixed(1)} s` : ''}${s.voices ? `, ${s.voices} fala(s)${s.speech ? ` (começando por "${s.speech}")` : ''}` : ''}. Trecho da música: ${mmss(s.musicRange[0])}–${mmss(s.musicRange[1])}.${s.focus === 'fight' && s.fights.length ? ` Luta usada: ${s.fights.join(' + ')}.` : s.focus === 'mix' ? ' Cenas de vários pontos (modo misturar).' : ''}${s.hitsSynced ? ` ${s.hitsSynced} golpes encaixados na batida.` : ''}${s.sfx ? ` ${s.sfx} efeitos sonoros.` : ''}`,
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
      width="w-[1020px]"
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
        <div className="grid max-h-[calc(100vh-210px)] grid-cols-[1.05fr_1fr_0.8fr] gap-5 overflow-y-auto pr-1">
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

          <div>
            <p className="mb-2 text-xs font-medium text-ink-soft">Cenas</p>
            <div className="flex gap-1 rounded-control bg-base p-1">
              {(
                [
                  ['fight', 'Focar na luta'],
                  ['mix', 'Misturar cenas'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setFocus(k)} className={`flex-1 rounded-[4px] py-1.5 text-xs ${focus === k ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
                  {label}
                </button>
              ))}
            </div>
            {focus === 'fight' ? (
              <div className="mt-2">
                <p className="mb-1 text-2xs text-muted">
                  {seqIds.length ? 'Usando só as lutas marcadas.' : plan?.mode === 'fight' ? `O app escolheu: ${plan.pool.map((e) => `${e.ep.name} ${mmss(e.seq.startS)}–${mmss(e.seq.endS)}`).join(' + ')}. Marque para escolher você.` : 'Aguardando a análise ou sem luta clara nos episódios.'}
                </p>
                {fights.length > 0 && (
                  <ul className="max-h-32 space-y-1 overflow-y-auto">
                    {fights.map(({ ep, q }) => {
                      const key = `${ep.assetId}#${q.id}`;
                      return (
                        <li key={key}>
                          <label className="flex items-center gap-2 text-xs">
                            <input type="checkbox" className="accent-violet" checked={seqIds.includes(key)} onChange={() => setSeqIds((xs) => (xs.includes(key) ? xs.filter((x) => x !== key) : [...xs, key]))} />
                            <span className="min-w-0 flex-1 truncate">
                              {ep.name} · {mmss(q.startS)}–{mmss(q.endS)}
                            </span>
                            <span className="tnum text-2xs text-faint">{q.shotCount} cenas · força {Math.round(q.intensity * 100)}%</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-2 text-2xs text-muted">Pega as cenas mais fortes de qualquer ponto dos episódios (pode misturar lutas diferentes).</p>
            )}
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" className="accent-violet" checked={hitSync} onChange={(e) => setHitSync(e.target.checked)} /> Encaixar o golpe de cada cena na batida
            </label>
            <label className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span title="Ajusta os cortes e o drop, sem deslocar o áudio da música.">Ajuste fino da sincronia</span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  min={-500}
                  max={500}
                  step={10}
                  value={beatOffsetMs}
                  onChange={(e) => {
                    const value = Number(e.currentTarget.value);
                    setBeatOffsetMs(Number.isFinite(value) ? Math.max(-500, Math.min(500, value)) : 0);
                  }}
                  className="h-7 w-20 rounded-control border border-line bg-base px-2 text-right text-xs tnum"
                  aria-label="Ajuste fino da sincronia em milissegundos"
                />
                <span className="text-muted">ms</span>
              </span>
            </label>
            <p className="mt-1 text-2xs text-muted">Negativo antecipa os cortes; positivo atrasa. Não altera a faixa de áudio.</p>

            <div className="mt-3 rounded-control border border-line-soft p-2">
              <p className="mb-1 text-xs font-medium text-ink-soft">Personagens (análise com IA)</p>
              {charList.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {charList.map((c) => {
                    const on = characters.some((x) => x.toLowerCase() === c.name.toLowerCase());
                    return (
                      <button key={c.name} type="button" aria-pressed={on} className={`rounded-full border px-2 py-0.5 text-2xs ${on ? 'border-violet bg-violet/20 text-ink' : 'border-line text-ink-soft hover:border-violet'}`} onClick={() => setCharacters((xs) => (on ? xs.filter((x) => x.toLowerCase() !== c.name.toLowerCase()) : [...xs, c.name]))}>
                        {c.name} <span className="text-faint">{c.shots}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-2xs text-muted">Descubra quem aparece em cada cena para montar só com um personagem e deixar de fora o que não é luta.</p>
              )}
              {characters.length > 0 && (
                <p className="mt-1 text-2xs text-muted">
                  Só cenas com {characters.join(' ou ')}. {plan?.warnings.find((warning) => warning.includes('Mantive o filtro'))}
                </p>
              )}
              {vision ? (
                <div className="mt-2 flex items-center gap-2 text-2xs text-muted">
                  <span className="tnum">
                    Analisando {vision.ep}: {vision.done}/{vision.total}
                  </span>
                  <Button size="sm" onClick={() => visionAbort.current?.abort()}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="mt-2">
                  <p className="mb-1 text-2xs text-muted">Escopo da análise visual</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
                      <input type="radio" name="vision-scope" className="accent-violet" checked={visionScope === 'fights'} onChange={() => setVisionScope('fights')} />
                      Só cenas de luta
                    </label>
                    <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
                      <input type="radio" name="vision-scope" className="accent-violet" checked={visionScope === 'all'} onChange={() => setVisionScope('all')} />
                      Todas as cenas, em detalhe
                    </label>
                  </div>
                  {visionTodo > 0 ? (
                    <>
                      <Button size="sm" className="mt-2" onClick={runVision} title="Analisa cenas com o contexto da música selecionada; o áudio não é enviado.">
                        Analisar cenas com IA
                      </Button>
                      <p className="mt-1 text-2xs text-faint">
                        ≈ {visionTodo * (visionScope === 'all' ? 3 : 1)} quadros, até {Math.ceil((visionTodo * (visionScope === 'all' ? 3 : 1)) / 6)} chamadas.{' '}
                        {visionScope === 'all' ? 'Usa 3 quadros por cena e inclui cenas escuras; pode demorar e gerar mais custo.' : 'Prioriza lutas e usa 1 quadro por cena.'}{' '}
                        A análise combina quadros, ritmo/seções e letras/legendas fornecidas; não envia o áudio ou vídeo completos. Em serviço na nuvem esses dados e os quadros amostrados vão ao provedor; com Ollama ficam no seu PC.
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-2xs text-faint">Não há cenas pendentes neste escopo.</p>
                  )}
                </div>
              )}
            </div>

            {ranges.length > 0 && (
              <>
                <p className="mt-4 mb-2 text-xs font-medium text-ink-soft">Trecho da música que combina</p>
                <ul className="space-y-1">
                  <li>
                    <label className="flex items-start gap-2 text-xs">
                      <input type="radio" name="mrange" className="mt-0.5 accent-violet" checked={chosenStart === null} onChange={() => setMusicStart(null)} />
                      <span>Automático (o melhor para as cenas escolhidas)</span>
                    </label>
                  </li>
                  {ranges.map((r) => (
                    <li key={r.startS}>
                      <label className="flex items-start gap-2 text-xs" title={r.reasons.join(' · ')}>
                        <input type="radio" name="mrange" className="mt-0.5 accent-violet" checked={chosenStart === r.startS} onChange={() => setMusicStart(r.startS)} />
                        <span className="min-w-0 flex-1">
                          <span className="tnum">
                            {mmss(r.startS)}–{mmss(r.endS)}
                          </span>{' '}
                          <span className="text-2xs text-faint">{Math.round(r.score * 100)}%</span>
                          {r.reasons[0] && <span className="block truncate text-2xs text-muted">{r.reasons[0]}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
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
                Falas dos personagens
                <select className="h-7 rounded-control border border-line bg-base px-1.5 text-xs" value={voiceMoments} onChange={(e) => setVoiceMoments(Number(e.target.value))}>
                  <option value={0}>Nenhuma</option>
                  <option value={1}>1 (antes do drop)</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </label>
              {voiceMoments > 0 && <p className="text-2xs text-muted">A música abaixa sozinha durante cada fala e volta depois.</p>}
              {hasTwoAudio && voiceMoments > 0 && (
                <label className="flex items-center gap-2">
                  Áudio da fala
                  <select className="h-7 rounded-control border border-line bg-base px-1.5 text-xs" value={voiceLang} onChange={(e) => setVoiceLang(e.target.value as 'original' | 'pt')}>
                    <option value="original">Original (japonês)</option>
                    <option value="pt">Português (dublagem)</option>
                  </select>
                </label>
              )}
              {hasTwoAudio && voiceMoments > 0 && (
                <p className="text-2xs text-muted">Seus episódios têm 2 faixas de áudio (idiomas). Elas são do anime, não da música.{noOriginal ? ' Em algum episódio não achei a faixa desse idioma: usei a padrão.' : ''}</p>
              )}
              <label className="flex items-center gap-2" title="Subida até o drop, impacto no drop, golpes nas pancadas e whoosh nos cortes. Gerados pelo app, sem direitos autorais.">
                <input type="checkbox" className="accent-violet" checked={useSfx} onChange={(e) => setUseSfx(e.target.checked)} /> Efeitos sonoros (impacto, subida, whoosh)
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
