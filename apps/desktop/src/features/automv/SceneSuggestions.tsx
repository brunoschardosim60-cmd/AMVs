import { shotKey, type Cue } from '@amv/analysis';
import { pickFrameScenes, suggestScenes, suggestionsToLyricMatches, MAX_SUGGESTION_LYRICS, MAX_SUGGESTION_SCENES, type SceneSuggestion, type SuggestionScene } from '@amv/assistant';
import { lyricCueKey, type EpisodeInput, type GenerateOptions } from '@amv/automv';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isLocal, loadAiSettings, secretName } from '../../core/aiSettings';
import { useApp } from '../../store';
import { Button } from '../../ui/controls';

type Matches = NonNullable<GenerateOptions['lyricSceneMatches']>;
type Scope = 'marked' | 'all' | 'custom';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** Aceita "1:23", "83" ou "83,5". */
export function parseClock(value: string): number | null {
  const v = value.trim().replace(',', '.');
  if (!v) return null;
  const parts = v.split(':');
  if (parts.length > 2) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.length === 2 ? nums[0]! * 60 + nums[1]! : nums[0]!;
}

/** Cenas dos trechos escolhidos, mais fortes primeiro quando há mais que o limite, depois em ordem. */
export function scenesForSuggestion(
  inputs: readonly EpisodeInput[],
  opts: { scope: Scope; seqIds: readonly string[]; custom?: { assetId: string; fromS: number; toS: number } | null },
): SuggestionScene[] {
  const out: (SuggestionScene & { order: number })[] = [];
  inputs.forEach((ep, epIndex) => {
    const seqRanges = ep.analysis.sequences.filter((q) => opts.seqIds.includes(`${ep.assetId}#${q.id}`));
    for (const shot of ep.analysis.shots) {
      if (shot.endS - shot.startS < 0.25 || shot.tags.includes('escura')) continue;
      if (opts.scope === 'marked' && !seqRanges.some((q) => shot.startS >= q.startS - 1e-3 && shot.endS <= q.endS + 1e-3)) continue;
      if (opts.scope === 'custom') {
        const c = opts.custom;
        if (!c || c.assetId !== ep.assetId || shot.endS <= c.fromS || shot.startS >= c.toS) continue;
      }
      const v = ep.vision?.shots[shotKey(shot.startS)];
      out.push({
        id: `${ep.assetId}@${shot.startS}`,
        episode: ep.name,
        startS: shot.startS,
        endS: shot.endS,
        intensity: shot.intensity,
        motion: shot.motion,
        tags: [...shot.tags],
        line: shot.line,
        note: v?.note || null,
        emotion: v?.emotion ?? null,
        action: v?.action ?? null,
        characters: v?.characters ?? [],
        order: epIndex * 1e7 + shot.startS,
      });
    }
  });
  const picked = out.length > MAX_SUGGESTION_SCENES ? [...out].sort((a, b) => b.intensity - a.intensity).slice(0, MAX_SUGGESTION_SCENES) : out;
  return picked.sort((a, b) => a.order - b.order).map(({ order: _order, ...scene }) => scene);
}

export function SceneSuggestions({
  session,
  inputs,
  seqIds,
  lyrics,
  musicRange,
  onApply,
}: {
  session?: { sceneThumbnails: (items: { id: string; assetId: string; timeS: number }[], signal?: AbortSignal) => Promise<{ sceneId: string; jpegBase64: string }[]> };
  inputs: EpisodeInput[];
  seqIds: string[];
  lyrics: Cue[] | null;
  musicRange: [number, number] | null;
  onApply: (matches: Matches | null) => void;
}) {
  const { platform, toast } = useApp();
  const [mood, setMood] = useState('');
  const [scope, setScope] = useState<Scope>(seqIds.length ? 'marked' : 'all');
  const [customEp, setCustomEp] = useState(inputs[0]?.assetId ?? '');
  const [fromText, setFromText] = useState('0:00');
  const [toText, setToText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ suggestions: SceneSuggestion[]; discarded: number } | null>(null);
  const [applied, setApplied] = useState(false);
  const [withFrames, setWithFrames] = useState(false);
  const [phase, setPhase] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const custom = useMemo(() => {
    if (scope !== 'custom') return null;
    const fromS = parseClock(fromText);
    const toS = parseClock(toText);
    if (fromS === null || toS === null || toS <= fromS || !customEp) return null;
    return { assetId: customEp, fromS, toS };
  }, [scope, customEp, fromText, toText]);

  const scenes = useMemo(() => scenesForSuggestion(inputs, { scope, seqIds, custom }), [inputs, scope, seqIds, custom]);
  const verses = useMemo(
    () => (lyrics ?? [])
      .filter((c) => c.text.trim() && (!musicRange || (c.endS > musicRange[0] && c.startS < musicRange[1])))
      .slice(0, MAX_SUGGESTION_LYRICS)
      .map((c) => ({ key: lyricCueKey(c), text: c.text, startS: c.startS, endS: c.endS })),
    [lyrics, musicRange?.[0], musicRange?.[1]],
  );
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.id, s])), [scenes]);
  const verseByKey = useMemo(() => new Map(verses.map((v) => [v.key, v])), [verses]);

  const run = async () => {
    if (!platform || busy) return;
    const settings = await loadAiSettings(platform);
    if (!settings.enabled) {
      toast({ tone: 'warn', title: 'Ligue um modelo de IA', body: 'Abra o Assistente e clique na engrenagem. Ollama roda no seu PC; Claude, OpenAI e Gemini usam a sua própria chave.' });
      return;
    }
    if (!isLocal(settings) && !settings.allowExternal) {
      toast({ tone: 'warn', title: 'Envio para a internet desligado', body: 'Serão enviados os versos, o clima e descrições das cenas' + (withFrames ? ' e até 16 quadros pequenos' : ' (sem quadros)') + '. Autorize na engrenagem do Assistente ou use o Ollama.' });
      return;
    }
    abort.current = new AbortController();
    setBusy(true);
    setApplied(false);
    try {
      const key = settings.provider.needsKey ? await platform.secrets.get(secretName(settings.presetId)) : null;
      let frames: { sceneId: string; jpegBase64: string }[] = [];
      if (withFrames && session) {
        setPhase('Capturando quadros das cenas…');
        const pick = pickFrameScenes(scenes);
        frames = await session.sceneThumbnails(pick.map((s) => ({ id: s.id, assetId: s.id.slice(0, s.id.lastIndexOf('@')), timeS: (s.startS + s.endS) / 2 })), abort.current.signal);
        if (!frames.length) throw new Error('Nenhum quadro pôde ser capturado. Tente analisar o episódio novamente ou desmarque a opção de imagens.');
        if (frames.length < pick.length) toast({ tone: 'warn', title: 'Alguns quadros não foram capturados', body: `${frames.length} de ${pick.length} cenas serão enviadas com imagem; as outras terão apenas descrição.` });
      }
      if (abort.current.signal.aborted) return;
      setPhase('Pedindo sugestões…');
      const r = await suggestScenes(settings.provider, key, platform.http, { mood, lyrics: verses, scenes, frames, signal: abort.current.signal });
      setResult({ suggestions: r.suggestions, discarded: r.discarded });
      if (!r.suggestions.length) toast({ tone: 'warn', title: 'Nenhuma sugestão válida', body: 'O modelo não indicou cenas existentes. Tente descrever o clima ou incluir mais trechos.' });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast({ tone: 'error', title: 'Não deu para sugerir cenas', body: (error as Error).message });
    } finally {
      abort.current = null;
      setPhase('');
      setBusy(false);
    }
  };

  const disabledReason = !verses.length
    ? 'Sincronize ou importe a letra (com tempo) para pedir sugestões.'
    : !scenes.length
      ? scope === 'marked' ? 'Marque ao menos uma luta acima ou escolha outro trecho.' : scope === 'custom' ? 'Informe um trecho válido (início antes do fim).' : 'Aguardando a análise dos episódios.'
      : null;

  return (
    <div className="space-y-2 rounded-control border border-line-soft p-2" aria-label="Sugestão de cenas por letra e clima">
      <p className="text-xs font-medium text-ink-soft">Sugerir cenas pela letra e pelo clima (IA, opcional)</p>
      <input
        value={mood}
        onChange={(e) => setMood(e.currentTarget.value)}
        placeholder="Clima: ex. melancólico que vira vitória, rivalidade, saudade…"
        aria-label="Clima da música"
        className="h-7 w-full rounded-control border border-line bg-base px-2 text-xs"
      />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-ink-soft">
        <label className="flex items-center gap-1.5"><input type="radio" name="suggest-scope" className="accent-violet" checked={scope === 'marked'} onChange={() => setScope('marked')} /> Lutas marcadas</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="suggest-scope" className="accent-violet" checked={scope === 'all'} onChange={() => setScope('all')} /> Episódios selecionados</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="suggest-scope" className="accent-violet" checked={scope === 'custom'} onChange={() => setScope('custom')} /> Trecho específico</label>
      </div>
      {scope === 'custom' && (
        <div className="flex flex-wrap items-center gap-1.5 text-2xs">
          <select aria-label="Episódio do trecho" value={customEp} onChange={(e) => setCustomEp(e.currentTarget.value)} className="h-7 min-w-0 flex-1 rounded-control border border-line bg-base px-1.5">
            {inputs.map((ep) => <option key={ep.assetId} value={ep.assetId}>{ep.name}</option>)}
          </select>
          <input aria-label="Início do trecho" value={fromText} onChange={(e) => setFromText(e.currentTarget.value)} className="h-7 w-16 rounded-control border border-line bg-base px-1.5 tnum" placeholder="0:00" />
          <span className="text-muted">até</span>
          <input aria-label="Fim do trecho" value={toText} onChange={(e) => setToText(e.currentTarget.value)} className="h-7 w-16 rounded-control border border-line bg-base px-1.5 tnum" placeholder="2:30" />
        </div>
      )}
      {session && (
        <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
          <input type="checkbox" className="accent-violet" checked={withFrames} onChange={(e) => setWithFrames(e.currentTarget.checked)} />
          Deixar o modelo ver as cenas (até 16 quadros; precisa de modelo com visão)
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !!disabledReason} onClick={() => void run()}>
          {busy ? phase || 'Pedindo sugestões…' : `Sugerir cenas (${verses.length} versos · ${scenes.length} cenas)`}
        </Button>
        {busy && <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>Cancelar</Button>}
      </div>
      {disabledReason && <p className="text-2xs text-muted">{disabledReason}</p>}
      {result && result.suggestions.length > 0 && (
        <div className="space-y-1">
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {result.suggestions.map((s) => {
              const scene = sceneById.get(s.sceneId);
              const verse = verseByKey.get(s.lyricKey);
              return (
                <li key={`${s.lyricKey}|${s.sceneId}`} className="rounded-control bg-base px-2 py-1 text-2xs">
                  <span className="text-ink">“{verse?.text}”</span>{' '}
                  <span className="text-muted">→ {scene?.episode} · corte {mmss(s.inS)}–{mmss(s.outS)} ({(s.outS - s.inS).toFixed(1)}s)</span>
                  <span className="block text-faint">{s.reason}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={applied ? 'ghost' : undefined} onClick={() => { onApply(suggestionsToLyricMatches(result.suggestions)); setApplied(true); toast({ tone: 'ok', title: 'Sugestões aplicadas', body: 'A próxima geração vai priorizar essas cenas nos versos indicados, sem ignorar batida e energia.' }); }}>
              {applied ? 'Aplicadas à próxima geração' : 'Usar na próxima geração'}
            </Button>
            {applied && <Button size="sm" variant="ghost" onClick={() => { onApply(null); setApplied(false); }}>Remover</Button>}
          </div>
          <p className="text-2xs text-faint">
            Os pontos de corte são referência para ajuste manual; na geração, as cenas sugeridas ganham prioridade no verso e o corte final segue a batida.
            {result.discarded > 0 ? ` ${result.discarded} item(ns) inválido(s) do modelo foram descartados.` : ''}
          </p>
        </div>
      )}
      <p className="text-2xs text-faint">
        Usa o modelo configurado no Assistente. {withFrames ? 'Envia versos, clima, descrições e até 16 quadros pequenos das cenas — nenhum vídeo ou áudio.' : 'Envia só texto: versos, clima e descrições das cenas já analisadas — nenhum quadro, vídeo ou áudio.'} Com Ollama, tudo fica no seu PC.
      </p>
    </div>
  );
}
