import { decodeSubtitleBytes, parseSubtitles, pickAudioStreamByLanguage, toSrt } from '@amv/analysis';
import { clipEndUs, type Clip } from '@amv/project';
import { alignUntimedLyrics, alignUntimedLyricsWithFallback, applyTranslation, cuesForClip, editSubtitleTextManually, langLabel, LOOKS, originalText, placeCues, promoteAlignedCuesForTypography, restoreOriginals, SUBTITLE_LANGS, pullClipSubtitles, readability, restyleSubtitles, shiftSubtitles, subtitleClips, textTracks, toLrc, toVtt, trackCues, type SubtitleLook } from '@amv/subtitles';
import { AlertTriangle, Download, FileText, Film, Languages, Mic, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ProjectSession } from '../../core/session';
import { extractTranscriptWords, mergeSpeechSegments, transcribeMediaAsset, translateTextsAuto } from '../../core/transcription';
import { useApp } from '../../store';
import { Button } from '../../ui/controls';
import { useEditor } from './editorStore';

const fmt = (us: number) => {
  const s = us / 1e6;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

/** Legendas: importar, puxar do episódio, editar, sincronizar e exportar. */
export function SubtitlesPanel({ session }: { session: ProjectSession }) {
  const { platform, toast } = useApp();
  const project = session.project;
  const tracks = textTracks(project);
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? '');
  const [look, setLook] = useState<SubtitleLook>('legenda');
  const [lang, setLang] = useState('pt-BR');
  const [translating, setTranslating] = useState<{ done: number; total: number } | null>(null);
  const [speechAssetId, setSpeechAssetId] = useState(project.assets.find((asset) => asset.kind === 'video')?.id ?? '');
  const [speechModel, setSpeechModel] = useState('small');
  const [speechLanguage, setSpeechLanguage] = useState('');
  const [speechAudioIndex, setSpeechAudioIndex] = useState<number | null>(() => {
    const asset = project.assets.find((item) => item.id === speechAssetId);
    const streams = asset?.probe?.audio ?? [];
    return pickAudioStreamByLanguage(streams, 'original') ?? streams[0]?.index ?? null;
  });
  const [speechProgress, setSpeechProgress] = useState<{ stage: 'extracting' | 'preparing' | 'transcribing'; progress: number; duration: number } | null>(null);
  const [cancellingSpeech, setCancellingSpeech] = useState(false);
  const [autoTranslateSpeech, setAutoTranslateSpeech] = useState(true);
  const [translateLyricsToPt, setTranslateLyricsToPt] = useState(true);
  const musicTrack = project.tracks.find((track) => track.role === 'music');
  const musicClips = musicTrack
    ? project.clips.filter((clip) => clip.trackId === musicTrack.id && !!clip.assetId).sort((a, b) => a.timelineStartUs - b.timelineStartUs)
    : [];
  const [lyricsClipId, setLyricsClipId] = useState(musicClips[0]?.id ?? '');
  const [untimedLyrics, setUntimedLyrics] = useState<{ name: string; text: string } | null>(null);
  const lyricsClip = musicClips.find((clip) => clip.id === lyricsClipId) ?? musicClips[0];
  const lyricsAsset = project.assets.find((asset) => asset.id === lyricsClip?.assetId);
  const lyricsAudioStreams = lyricsAsset?.probe?.audio ?? [];
  const [lyricsAudioIndex, setLyricsAudioIndex] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const speechAbort = useRef<AbortController | null>(null);
  const selection = useEditor((s) => s.selection);
  const playheadUs = useEditor((s) => s.playheadUs);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const select = useEditor((s) => s.select);
  const clips = trackId ? subtitleClips(project, trackId) : [];
  const selectedSubs = clips.filter((c) => selection.includes(c.id));
  const target = selectedSubs.length ? selectedSubs : clips;
  const videoAssets = project.assets.filter((asset) => asset.kind === 'video');
  const transcriptAssetId = videoAssets.some((asset) => asset.id === speechAssetId) ? speechAssetId : videoAssets[0]?.id ?? '';
  const transcriptAsset = project.assets.find((asset) => asset.id === transcriptAssetId);
  const audioStreams = transcriptAsset?.probe?.audio ?? [];
  const transcribing = speechProgress !== null;

  useEffect(() => {
    setSpeechAudioIndex(pickAudioStreamByLanguage(audioStreams, 'original') ?? audioStreams[0]?.index ?? null);
  }, [audioStreams, transcriptAssetId]);

  useEffect(
    () => () => {
      abort.current?.abort();
      speechAbort.current?.abort();
    },
    [],
  );

  if (!tracks.length) return <p className="p-3 text-xs text-muted">O projeto não tem trilha de legendas.</p>;

  const fail = (title: string, e: unknown) => toast({ tone: 'error', title, body: (e as Error).message });

  const importFile = async () => {
    try {
      const path = await platform!.dialogs.pickFile('Legenda ou letra', ['srt', 'ass', 'ssa', 'vtt', 'lrc', 'txt']);
      if (!path) return;
      const text = decodeSubtitleBytes(await platform!.fs.readFile(path));
      const cues = parseSubtitles(path, text, lyricsAsset?.probe ? lyricsAsset.probe.durationUs / 1e6 : undefined).filter((c) => Number.isFinite(c.startS));
      if (!cues.length) {
        const plainText = text.replace(/^\uFEFF/, '').trim();
        if (/\.txt$/i.test(path) && plainText) {
          setUntimedLyrics({ name: path.split(/[\\/]/).pop() ?? 'Letra', text: plainText });
          toast({ tone: 'ok', title: 'Letra carregada', body: 'Agora escolha o clipe da música e sincronize com a transcrição local.' });
          return;
        }
        toast({ tone: 'warn', title: 'Esse arquivo não tem tempos', body: 'Importe um .txt com uma linha por verso ou sincronize as linhas manualmente.' });
        return;
      }
      setUntimedLyrics(null);
      // letra (.lrc) acompanha a música: alinha com o começo do clipe de música
      const isLyrics = /\.lrc$/i.test(path);
      const musicClip = lyricsClip;
      const mappedCues = isLyrics && musicClip ? cuesForClip(musicClip, cues) : cues;
      const offsetUs = isLyrics && musicClip ? 0 : playheadUs;
      const cmds = placeCues(project, mappedCues, { trackId, offsetUs, look: isLyrics && look === 'legenda' ? 'karaoke' : look, windowUs: isLyrics && musicClip ? [musicClip.timelineStartUs, clipEndUs(musicClip)] : undefined, label: path.split(/[\\/]/).pop() });
      if (!cmds.length) {
        toast({ tone: 'warn', title: 'Nenhuma linha caiu dentro do vídeo', body: isLyrics ? 'O trecho da música usado na timeline não tem letra nesse arquivo.' : undefined });
        return;
      }
      session.history.transaction(`Importar legenda (${cues.length} linhas)`, cmds);
      toast({ tone: 'ok', title: `${cmds.filter((c) => c.type === 'clip.add').length} legendas na timeline`, body: isLyrics ? 'Letra alinhada com a música.' : `A partir de ${fmt(offsetUs)} (playhead).` });
    } catch (e) {
      fail('Não deu para importar a legenda', e);
    }
  };

  const pull = () => {
    const videoClips = project.clips.filter((c) => c.assetId && project.tracks.find((t) => t.id === c.trackId)?.kind === 'video');
    const chosen = videoClips.filter((c) => selection.includes(c.id));
    const from = chosen.length ? chosen : videoClips;
    const byAsset = new Map<string, { startS: number; endS: number; text: string }[]>();
    for (const c of from) {
      const ep = session.assetRuntime(c.assetId!).episode;
      if (ep?.subtitles.length) byAsset.set(c.assetId!, ep.subtitles);
    }
    if (!byAsset.size) {
      toast({ tone: 'warn', title: 'Esses episódios não têm legenda embutida', body: 'Episódios .mkv costumam ter. Você pode importar o .srt/.ass do episódio aqui mesmo.' });
      return;
    }
    const r = pullClipSubtitles(project, from, byAsset, trackId, look);
    if (!r.count) {
      toast({ tone: 'info', title: 'Ninguém fala nesses trechos', body: 'Os clipes escolhidos não têm falas na legenda do episódio.' });
      return;
    }
    session.history.transaction('Puxar falas do episódio', r.commands);
    toast({ tone: 'ok', title: `${r.count} fala(s) encaixada(s)`, body: chosen.length ? 'Dos clipes selecionados.' : 'De todos os clipes do vídeo.' });
  };

  const transcribe = async () => {
    if (!platform || !transcriptAssetId || transcribing) return;
    const asset = project.assets.find((item) => item.id === transcriptAssetId);
    if (!asset) return;
    const audioIndex = speechAudioIndex ?? pickAudioStreamByLanguage(audioStreams, 'original') ?? audioStreams[0]?.index;
    if (audioIndex === undefined || audioIndex === null) {
      toast({ tone: 'error', title: 'Não há faixa de áudio', body: 'O episódio não tem uma faixa de áudio selecionável para transcrever.' });
      return;
    }
    const videoClips = project.clips.filter((clip) => clip.assetId === transcriptAssetId && project.tracks.find((track) => track.id === clip.trackId)?.kind === 'video');
    const selectedClips = videoClips.filter((clip) => selection.includes(clip.id));
    const targetVideoClips = selectedClips.length ? selectedClips : videoClips;
    if (asset.status === 'missing') {
      toast({ tone: 'error', title: 'Arquivo do episódio ausente', body: 'Relocalize o arquivo antes de transcrever.' });
      return;
    }
    const overlaps = targetVideoClips.length > 0 && clips.some((subtitle) =>
      targetVideoClips.some(
        (video) =>
          subtitle.timelineStartUs < clipEndUs(video) && clipEndUs(subtitle) > video.timelineStartUs,
      ),
    );
    if (overlaps && !(await platform.dialogs.confirm('As falas transcritas substituem legendas existentes nos trechos escolhidos. Continuar?', 'Substituir legendas no trecho?'))) return;
    const controller = new AbortController();
    speechAbort.current = controller;
    const duration = (asset.probe?.durationUs ?? 0) / 1e6;
    setCancellingSpeech(false);
    setSpeechProgress({ stage: 'extracting', progress: 0, duration });
    try {
      const transcript = await transcribeMediaAsset(platform, asset, audioIndex, {
        model: speechModel,
        ...(speechLanguage ? { language: speechLanguage } : {}),
        vadFilter: true,
        signal: controller.signal,
        onProgress: setSpeechProgress,
      });
      const fallbackLang = audioStreams.find((stream) => stream.index === audioIndex)?.language ?? null;
      let mergedSpeech = mergeSpeechSegments(session.assetRuntime(transcriptAssetId).episode?.speech ?? [], transcript, fallbackLang);
      let finalSegments = transcript.segments.map((segment) => ({
        startS: segment.start,
        endS: segment.end,
        text: segment.text,
        words: segment.words,
      }));
      const targetLangPrefix = lang.toLowerCase().split('-')[0]!;
      const detectedLang = (transcript.language ?? speechLanguage ?? '').toLowerCase();
      let translatedCount = 0;
      if (autoTranslateSpeech && finalSegments.length && (!detectedLang || !detectedLang.startsWith(targetLangPrefix))) {
        const translated = await translateTextsAuto(
          platform,
          finalSegments.map((segment) => segment.text),
          langLabel(lang),
          { sourceLanguage: transcript.language, signal: controller.signal },
        );
        finalSegments = finalSegments.map((segment, index) => {
          const t = translated.translations[index]?.trim();
          if (t) translatedCount++;
          return t && t !== segment.text
            ? { ...segment, text: t, words: [] }
            : segment;
        });
        const nonEmptySpeech = mergedSpeech
          .map((seg, index) => ({ seg, index }))
          .filter(({ seg }) => !!seg.text?.trim() && !(seg.language ?? '').toLowerCase().startsWith(targetLangPrefix));
        if (nonEmptySpeech.length) {
          const translatedEpisode = await translateTextsAuto(
            platform,
            nonEmptySpeech.map(({ seg }) => seg.text!),
            langLabel(lang),
            { sourceLanguage: transcript.language, signal: controller.signal },
          );
          const mapByIdx = new Map<number, string>();
          translatedEpisode.translations.forEach((value, idx) => {
            if (value?.trim()) mapByIdx.set(nonEmptySpeech[idx]!.index, value.trim());
          });
          mergedSpeech = mergedSpeech.map((seg, idx) =>
            mapByIdx.has(idx) ? { ...seg, text: mapByIdx.get(idx)!, language: lang } : seg,
          );
        }
      }
      await session.updateEpisodeSpeech(transcriptAssetId, mergedSpeech);

      const cues = finalSegments.map((segment) => ({
        startS: segment.startS,
        endS: segment.endS,
        text: segment.text,
        ...(segment.words.length
          ? {
              words: segment.words.map((word) => ({
                startS: word.start,
                endS: word.end,
                text: word.text,
                source: 'whisper' as const,
                confidence: null,
              })),
            }
          : {}),
      }));
      if (!cues.length) {
        toast({ tone: 'warn', title: 'Nenhuma fala reconhecida', body: 'Tente outra faixa de áudio ou um modelo maior. O arquivo original não foi alterado.' });
        return;
      }
      if (!targetVideoClips.length) {
        toast({
          tone: 'ok',
          title: `${cues.length} falas salvas no episódio`,
          body: translatedCount
            ? `Falas transcritas e traduzidas para ${langLabel(lang)}. Veja na aba Falas ou gere o AMV.`
            : 'Falas reconhecidas e salvas na aba Falas. Adicione clipes à timeline ou clique em Gerar AMV.',
        });
        return;
      }
      const r = pullClipSubtitles(project, targetVideoClips, new Map([[transcriptAssetId, cues]]), trackId, look);
      if (!r.commands.length) {
        toast({
          tone: 'warn',
          title: 'Falas salvas no episódio, mas fora dos clipes atuais',
          body: 'Os trechos na timeline não coincidem com as falas deste episódio. Confira a aba Falas.',
        });
        return;
      }
      session.history.transaction(`Transcrever falas (${r.count} linhas)`, r.commands);
      const language = transcript.language ? (transcript.language_probability > 0
        ? ` Idioma detectado: ${transcript.language} (${Math.round(transcript.language_probability * 100)}%).`
        : ` Idioma utilizado: ${transcript.language}.`) : '';
      toast({
        tone: 'ok',
        title: `${r.count} falas adicionadas${translatedCount ? ` em ${langLabel(lang)}` : ''}`,
        body: `Falas atualizadas na aba Falas e na trilha de legendas.${language}`,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        toast({ tone: 'info', title: 'Transcrição cancelada', body: 'O áudio original não foi alterado.' });
      } else {
        toast({ tone: 'error', title: 'Não deu para transcrever', body: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      speechAbort.current = null;
      setCancellingSpeech(false);
      setSpeechProgress(null);
    }
  };

  const alignLyrics = async () => {
    if (!platform || !untimedLyrics || !lyricsClip || !lyricsAsset || !musicTrack || transcribing) return;
    if (lyricsAsset.kind !== 'audio' || lyricsAsset.status === 'missing') {
      toast({ tone: 'error', title: 'Arquivo de música indisponível', body: 'Escolha um clipe ligado a um arquivo local de áudio presente no computador.' });
      return;
    }
    const audioIndex = lyricsAudioIndex ?? lyricsAudioStreams[0]?.index;
    if (audioIndex === undefined) {
      toast({ tone: 'error', title: 'A música não tem faixa de áudio', body: 'Confira o arquivo selecionado ou escolha outro clipe de música.' });
      return;
    }
    const controller = new AbortController();
    speechAbort.current = controller;
    setCancellingSpeech(false);
    setSpeechProgress({ stage: 'extracting', progress: 0, duration: (lyricsAsset.probe?.durationUs ?? 0) / 1e6 });
    try {
      const transcript = await transcribeMediaAsset(platform, lyricsAsset, audioIndex, {
        model: speechModel,
        ...(speechLanguage ? { language: speechLanguage } : {}),
        vadFilter: false,
        signal: controller.signal,
        onProgress: setSpeechProgress,
      });
      const words = extractTranscriptWords(transcript);
      const origLines = untimedLyrics.text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
      const direct = alignUntimedLyrics(untimedLyrics.text, words);
      const detectedAudioLang = (transcript.language ?? speechLanguage ?? '').toLowerCase();
      let translatedForMatching: string | undefined;
      if (origLines.length && direct.matched < origLines.length * 0.4 && detectedAudioLang && !detectedAudioLang.startsWith('pt')) {
        const forMatch = await translateTextsAuto(platform, origLines, detectedAudioLang, { signal: controller.signal });
        const mapped = origLines.map((line, i) => forMatch.translations[i]?.trim() || line);
        translatedForMatching = mapped.join('\n');
      }
      const aligned = alignUntimedLyricsWithFallback(untimedLyrics.text, words, transcript.segments, translatedForMatching);
      if (!aligned.cues.length) {
        toast({ tone: 'warn', title: 'Nenhum verso alinhado', body: 'A transcrição não encontrou vocais nem segmentos na música.' });
        return;
      }
      let finalCues = aligned.cues;
      if (translateLyricsToPt && !translatedForMatching && (!detectedAudioLang || !detectedAudioLang.startsWith('pt'))) {
        const ptTrans = await translateTextsAuto(
          platform,
          finalCues.map((c) => c.text),
          'português brasileiro',
          { sourceLanguage: transcript.language, signal: controller.signal },
        );
        finalCues = promoteAlignedCuesForTypography(
          finalCues.map((c, idx) => ({
            ...c,
            text: ptTrans.translations[idx]?.trim() || c.text,
          })),
        );
      } else {
        finalCues = promoteAlignedCuesForTypography(finalCues);
      }
      const timelineCues = cuesForClip(lyricsClip, finalCues);
      const outsideClip = finalCues.length - timelineCues.length;
      const windowUs: [number, number] = [lyricsClip.timelineStartUs, clipEndUs(lyricsClip)];
      const overlaps = clips.some((subtitle) => subtitle.timelineStartUs < windowUs[1] && clipEndUs(subtitle) > windowUs[0]);
      if (overlaps && !(await platform.dialogs.confirm('Os versos alinhados substituem legendas existentes sobre este trecho da música. Continuar?', 'Substituir legendas no trecho?'))) return;
      const commands = placeCues(project, timelineCues, {
        trackId,
        offsetUs: 0,
        look: look === 'legenda' ? 'karaoke' : look,
        windowUs,
        label: untimedLyrics.name,
      });
      if (!commands.length) {
        toast({ tone: 'warn', title: 'Nenhum verso caiu no clipe', body: 'Confira se o trecho de origem do clipe coincide com a parte da música que contém a letra.' });
        return;
      }
      session.history.transaction(`Sincronizar letra (${aligned.matched} linhas)`, commands);
      setUntimedLyrics(null);
      toast({
        tone: aligned.unmatched || aligned.uncertain ? 'warn' : 'ok',
        title: `${commands.filter((command) => command.type === 'clip.add').length} versos sincronizados`,
        body: `${aligned.uncertain} com tempo aproximado e ${outsideClip} fora do trecho do clipe. Revise os clipes de texto na timeline.`,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        toast({ tone: 'info', title: 'Sincronização cancelada', body: 'A letra e o projeto não foram alterados.' });
      } else {
        toast({ tone: 'error', title: 'Não deu para sincronizar a letra', body: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      speechAbort.current = null;
      setCancellingSpeech(false);
      setSpeechProgress(null);
    }
  };

  const cancelTranscription = () => {
    if (!speechAbort.current) return;
    setCancellingSpeech(true);
    speechAbort.current.abort();
  };

  const translate = async () => {
    if (!platform || !target.length || translating) return;
    try {
      abort.current = new AbortController();
      setTranslating({ done: 0, total: target.length });
      // sempre parte do texto original (trocar de idioma não traduz uma tradução)
      const r = await translateTextsAuto(platform, target.map(originalText), langLabel(lang), {
        signal: abort.current.signal,
        onProgress: (done, total) => setTranslating({ done, total }),
      });
      const cmds = applyTranslation(target, r.translations, lang);
      if (cmds.length) session.history.transaction(`Traduzir legendas (${langLabel(lang)})`, cmds);
      toast(
        r.failed
          ? { tone: 'warn', title: `${cmds.length} traduzidas, ${r.failed} mantidas no original`, body: 'Algumas linhas falharam. Tente novamente.' }
          : { tone: 'ok', title: `${cmds.length} legenda(s) em ${langLabel(lang)}`, body: 'Ctrl+Z desfaz. "Original" volta ao idioma de antes.' },
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') fail('Não deu para traduzir', e);
    } finally {
      abort.current = null;
      setTranslating(null);
    }
  };
  const restore = () => {
    const cmds = restoreOriginals(target);
    if (cmds.length) session.history.transaction('Voltar legendas ao original', cmds);
  };
  const translatedCount = target.filter((c) => c.text?.original !== undefined).length;

  const shift = (ms: number) => session.history.transaction(`Ajustar tempo ${ms > 0 ? '+' : ''}${ms} ms`, shiftSubtitles(project, target.map((c) => c.id), ms * 1000));
  const restyle = (l: SubtitleLook) => {
    setLook(l);
    if (target.length) session.history.transaction('Estilo das legendas', restyleSubtitles(project, target.map((c) => c.id), l));
  };

  const exportAs = async (ext: 'srt' | 'vtt' | 'lrc') => {
    try {
      const cues = trackCues(project, trackId);
      const path = await platform!.dialogs.saveFile('Exportar legendas', `${project.name}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }]);
      if (!path) return;
      const text = ext === 'srt' ? toSrt(cues) : ext === 'vtt' ? toVtt(cues) : toLrc(cues);
      await platform!.fs.writeFile(path, new TextEncoder().encode(text));
      toast({ tone: 'ok', title: `${cues.length} legendas exportadas`, body: path });
    } catch (e) {
      fail('Não deu para exportar', e);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="shrink-0 space-y-2 border-b border-line px-3 pb-3">
        {tracks.length > 1 && (
          <select className="h-7 w-full rounded-control border border-line bg-base px-1 text-xs" value={trackId} onChange={(e) => setTrackId(e.target.value)}>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" icon={<FileText size={13} />} onClick={importFile} title="SRT, ASS, VTT, LRC ou TXT sem tempos">
            Importar
          </Button>
          <Button size="sm" icon={<Film size={13} />} onClick={pull} title="Coloca as falas certas embaixo dos clipes de episódio (selecionados, ou todos)">
            Do episódio
          </Button>
        </div>
        {untimedLyrics && (
          <div className="space-y-1.5 rounded-control border border-violet/40 bg-violet/5 p-2">
            <div className="flex items-center gap-1.5 text-2xs font-medium text-ink-soft">
              <FileText size={13} />
              Letra sem tempos: {untimedLyrics.name}
            </div>
            {musicClips.length > 0 ? (
              <>
                <select
                  className="h-7 w-full rounded-control border border-line bg-base px-1 text-2xs"
                  value={lyricsClip?.id ?? ''}
                  onChange={(event) => {
                    setLyricsClipId(event.target.value);
                    setLyricsAudioIndex(null);
                  }}
                  aria-label="Clipe da música para sincronizar a letra"
                  disabled={transcribing}
                >
                  {musicClips.map((clip) => {
                    const asset = project.assets.find((item) => item.id === clip.assetId);
                    return <option key={clip.id} value={clip.id}>{asset?.name ?? 'Música'} · {fmt(clip.timelineStartUs)}</option>;
                  })}
                </select>
                <div className="flex gap-1">
                  <select className="h-7 min-w-0 flex-1 rounded-control border border-line bg-base px-1 text-2xs" value={speechModel} onChange={(event) => setSpeechModel(event.target.value)} aria-label="Modelo de transcrição da letra" disabled={transcribing}>
                    {['tiny', 'base', 'small', 'medium', 'large-v3'].map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                  <select className="h-7 min-w-0 flex-1 rounded-control border border-line bg-base px-1 text-2xs" value={speechLanguage} onChange={(event) => setSpeechLanguage(event.target.value)} aria-label="Idioma cantado na música" disabled={transcribing}>
                    <option value="">Detectar idioma</option>
                    <option value="ja">Japonês</option>
                    <option value="pt">Português</option>
                    <option value="en">Inglês</option>
                    <option value="es">Espanhol</option>
                    <option value="fr">Francês</option>
                  </select>
                </div>
                <div className="flex gap-1">
                  {lyricsAudioStreams.length > 1 && (
                    <select
                      className="h-7 min-w-0 flex-1 rounded-control border border-line bg-base px-1 text-2xs"
                      value={lyricsAudioIndex ?? lyricsAudioStreams[0]?.index ?? ''}
                      onChange={(event) => setLyricsAudioIndex(event.target.value ? Number(event.target.value) : null)}
                      aria-label="Faixa de áudio da música"
                      disabled={transcribing}
                    >
                      {lyricsAudioStreams.map((stream) => (
                        <option key={stream.index} value={stream.index}>{stream.title || stream.language || `Faixa ${stream.index + 1}`}</option>
                      ))}
                    </select>
                  )}
                  {transcribing ? (
                    <Button size="sm" variant="ghost" onClick={cancelTranscription} disabled={cancellingSpeech} icon={<X size={13} />}>
                      {cancellingSpeech ? 'Cancelando…' : 'Cancelar'}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={alignLyrics} disabled={!lyricsClip || !lyricsAsset || lyricsAudioStreams.length === 0} icon={<Mic size={13} />}>
                      Sincronizar letra
                    </Button>
                  )}
                </div>
                <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
                  <input type="checkbox" className="accent-violet" checked={translateLyricsToPt} onChange={(e) => setTranslateLyricsToPt(e.target.checked)} disabled={transcribing} />
                  Traduzir letra para Português na tela
                </label>
                <p className="text-2xs text-faint">
                  O app transcreve a música localmente e alinha versos (inclusive se a letra estiver em PT e a música em EN).
                </p>
              </>
            ) : (
              <p className="text-2xs text-faint">Adicione um arquivo de música local à trilha Música para sincronizar esta letra.</p>
            )}
          </div>
        )}
        {speechProgress && (
          <div className="space-y-0.5">
            <div className="flex justify-between text-2xs text-muted">
              <span>
                {cancellingSpeech
                  ? 'Cancelando transcrição…'
                  : speechProgress.stage === 'extracting'
                    ? 'Preparando áudio…'
                    : speechProgress.stage === 'preparing'
                      ? 'Carregando o modelo ou aguardando o primeiro segmento…'
                      : 'Transcrevendo…'}
              </span>
              {speechProgress.duration > 0 && (
                <span className="tnum">{Math.min(100, Math.round((speechProgress.progress / speechProgress.duration) * 100))}%</span>
              )}
            </div>
            <progress
              className="h-1 w-full accent-violet"
              max={speechProgress.duration || 1}
              value={Math.min(speechProgress.progress, speechProgress.duration || 0)}
              aria-label={speechProgress.stage === 'extracting' ? 'Progresso da preparação do áudio' : 'Progresso da transcrição'}
            />
          </div>
        )}
        {videoAssets.length > 0 && (
          <div className="space-y-1.5 rounded-control border border-line-soft p-2">
            <div className="flex items-center gap-1.5 text-2xs font-medium text-ink-soft">
              <Mic size={13} />
              Transcrição local de falas
            </div>
            <div className="flex gap-1">
              <select className="h-7 min-w-0 flex-1 rounded-control border border-line bg-base px-1 text-2xs" value={transcriptAssetId} onChange={(e) => setSpeechAssetId(e.target.value)} aria-label="Episódio para transcrever" disabled={transcribing}>
                {videoAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.name}</option>
                ))}
              </select>
              <select className="h-7 rounded-control border border-line bg-base px-1 text-2xs" value={speechModel} onChange={(e) => setSpeechModel(e.target.value)} aria-label="Modelo de transcrição" disabled={transcribing}>
                {['tiny', 'base', 'small', 'medium', 'large-v3'].map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </div>
            <select
              className="h-7 w-full rounded-control border border-line bg-base px-1 text-2xs"
              value={speechAudioIndex ?? ''}
              onChange={(e) => setSpeechAudioIndex(e.target.value ? Number(e.target.value) : null)}
              aria-label="Faixa de áudio do episódio"
              disabled={transcribing || audioStreams.length === 0}
            >
              {audioStreams.length === 0 ? (
                <option value="">Nenhuma faixa de áudio</option>
              ) : (
                audioStreams.map((stream) => (
                  <option key={stream.index} value={stream.index}>
                    {stream.title || stream.language || `Faixa ${stream.index + 1}`} · stream {stream.index}
                  </option>
                ))
              )}
            </select>
            <div className="flex gap-1">
              <select className="h-7 min-w-0 flex-1 rounded-control border border-line bg-base px-1 text-2xs" value={speechLanguage} onChange={(e) => setSpeechLanguage(e.target.value)} aria-label="Idioma falado no episódio" disabled={transcribing}>
                <option value="">Detectar idioma</option>
                <option value="ja">Japonês</option>
                <option value="pt">Português</option>
                <option value="en">Inglês</option>
                <option value="es">Espanhol</option>
                <option value="fr">Francês</option>
              </select>
              {transcribing ? (
                <Button size="sm" variant="ghost" onClick={cancelTranscription} disabled={cancellingSpeech} icon={<X size={13} />}>
                  {cancellingSpeech ? 'Cancelando…' : 'Cancelar'}
                </Button>
              ) : (
                <Button size="sm" onClick={transcribe} disabled={!transcriptAssetId || audioStreams.length === 0} icon={<Mic size={13} />}>
                  Transcrever
                </Button>
              )}
            </div>
            <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
              <input type="checkbox" className="accent-violet" checked={autoTranslateSpeech} onChange={(e) => setAutoTranslateSpeech(e.target.checked)} disabled={transcribing} />
              Traduzir automaticamente para {langLabel(lang)}
            </label>
            <p className="text-2xs text-faint">
              Local, sem enviar áudio. As falas são salvas no episódio e traduzidas para {langLabel(lang)}.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {LOOKS.map((l) => (
            <Button size="sm" key={l.id} aria-pressed={look === l.id} title={`${l.description}${target.length ? ` Aplica em ${selectedSubs.length ? 'selecionadas' : 'todas'}.` : ''}`} onClick={() => restyle(l.id)} className={`px-2 text-2xs ${look === l.id ? 'border-violet bg-violet/10 text-ink' : 'border-line text-muted hover:text-ink'}`}>
              {l.label}
            </Button>
          ))}
        </div>
        {clips.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Languages size={13} className="shrink-0 text-muted" />
              <select className="h-7 min-w-0 flex-1 rounded-control border border-line bg-base px-1 text-xs" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Idioma das legendas" disabled={!!translating}>
                {SUBTITLE_LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              {translating ? (
                <Button size="sm" onClick={() => abort.current?.abort()}>
                  Cancelar
                </Button>
              ) : (
                <Button size="sm" onClick={translate} title={`Traduz ${selectedSubs.length ? 'as selecionadas' : 'todas as legendas'} para ${langLabel(lang)} com o modelo de IA configurado no Assistente`}>
                  Traduzir
                </Button>
              )}
              {translatedCount > 0 && !translating && (
                <Button size="sm" variant="ghost" onClick={restore} title="Volta ao texto de antes da tradução">
                  Original
                </Button>
              )}
            </div>
            {translating && <p className="text-2xs text-muted">Traduzindo… {translating.done}/{translating.total}</p>}
          </div>
        )}
        {clips.length > 0 && (
          <div className="flex items-center gap-1 text-2xs text-muted">
            <span className="mr-auto">Tempo ({selectedSubs.length ? `${selectedSubs.length} sel.` : 'todas'})</span>
            {[-500, -100, 100, 500].map((ms) => (
              <button key={ms} type="button" className="tnum rounded border border-line px-1.5 py-0.5 hover:bg-raised hover:text-ink" onClick={() => shift(ms)}>
                {ms > 0 ? '+' : '−'}
                {Math.abs(ms) / 1000}s
              </button>
            ))}
          </div>
        )}
      </div>

      {clips.length === 0 ? (
        <p className="p-3 text-xs leading-relaxed text-muted">
          Nenhuma legenda ainda. <b>Importar</b> traz um .srt/.ass/.lrc; <b>Do episódio</b> encaixa as falas originais embaixo de cada cena. Também dá para criar uma com <b>T</b>.
        </p>
      ) : (
        <ul className="shrink-0 py-1">
          {clips.map((c, i) => (
            <SubRow
              key={c.id}
              index={i + 1}
              clip={c}
              selected={selection.includes(c.id)}
              onPick={(add) => {
                setPlayhead(c.timelineStartUs);
                select(add ? (selection.includes(c.id) ? selection.filter((x) => x !== c.id) : [...selection, c.id]) : [c.id]);
              }}
              onText={(text) => {
                if (c.text) session.execute({ type: 'clip.update', clipId: c.id, patch: { text: editSubtitleTextManually(c.text, text) } }, 'Editar legenda');
              }}
              onDelete={() => session.execute({ type: 'clip.remove', clipId: c.id }, 'Apagar legenda')}
            />
          ))}
        </ul>
      )}

      {clips.length > 0 && (
        <div className="flex items-center gap-1 border-t border-line p-2">
          <Download size={13} className="text-muted" />
          <span className="mr-auto text-2xs text-muted">{clips.length} legendas</span>
          {(['srt', 'vtt', 'lrc'] as const).map((x) => (
            <button key={x} type="button" className="rounded border border-line px-1.5 py-0.5 text-2xs uppercase text-ink-soft hover:bg-raised" onClick={() => exportAs(x)}>
              {x}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SubRow({ index, clip, selected, onPick, onText, onDelete }: { index: number; clip: Clip; selected: boolean; onPick: (add: boolean) => void; onText: (t: string) => void; onDelete: () => void }) {
  const [text, setText] = useState(clip.text!.text);
  useEffect(() => setText(clip.text!.text), [clip.text]);
  const warn = readability(text, clip.durationUs / 1e6);
  return (
    <li className={`group mx-1 mb-1 rounded-md border px-2 py-1.5 ${selected ? 'border-violet bg-violet/10' : 'border-transparent hover:bg-raised'}`}>
      <button type="button" className="flex w-full items-center gap-1.5 text-left text-2xs text-muted" onClick={(e) => onPick(e.shiftKey || e.ctrlKey || e.metaKey)}>
        <span className="tnum w-5 text-faint">{index}</span>
        <span className="tnum">
          {fmt(clip.timelineStartUs)} → {fmt(clipEndUs(clip))}
        </span>
        {warn && (
          <span title={warn} className="text-warn">
            <AlertTriangle size={11} />
          </span>
        )}
        <span
          role="button"
          tabIndex={0}
          title="Apagar legenda"
          className="ml-auto hidden rounded p-0.5 hover:bg-base hover:text-danger group-hover:block"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={11} />
        </span>
      </button>
      <textarea
        rows={Math.min(4, Math.max(text.split("\n").length, Math.ceil(text.length / 30)))}
        className="mt-1 w-full resize-none rounded bg-transparent px-1 text-xs text-ink outline-none focus:bg-base"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== clip.text!.text && text.trim() && onText(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
          if (e.key === 'Escape') setText(clip.text!.text);
        }}
      />
    </li>
  );
}
