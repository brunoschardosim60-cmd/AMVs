import { impactScore, parseSubtitles, decodeSubtitleBytes, SCENE_EMOTIONS, shotKey, type Cue, type SceneEmotion, type SpeechSegment } from '@amv/analysis';
import { buildCreativeBrief, canonicalizeEpisodeVision, chooseMusicRange, creativeEmphasis, DEFAULT_CREATIVE_PROFILES, generateAmv, generateBestAmv, isBuiltInCreativeProfile, lyricCueKey, planFootage, planNarrative, prepareLocalizedRegeneration, qualityIssueSummary, recommendEpisodePreset, recommendStyle, reviewGeneratedAssembly, scoreSpeechCandidate, STYLE_EDITORIAL_GOALS, STYLES, suggestMusicRanges, type AssemblyScoreBreakdown, type CreativeProfile, type EditorialDirection, type EpisodeInput, type GenerateOptions, type LocalizedRegenerationResult, type LyricTypographyStyle, type OrganizationMode, type StyleId } from '@amv/automv';
import { characterCounts, normLabel, pickAudioStreamByLanguage, type EpisodeVision, type VisionScope } from '@amv/analysis';
import { alignUntimedLyrics, alignUntimedLyricsWithFallback, promoteAlignedCuesForTypography } from '@amv/subtitles';
import { isLocal, loadAiSettings, secretName } from '../../core/aiSettings';
import { loadCreativeProfiles, saveCreativeProfiles } from '../../core/creativeProfiles';
import { extractTranscriptWords, mergeSpeechSegments, transcribeAudioSlice, transcribeMediaAsset, translateTextsAuto } from '../../core/transcription';
import { getAnalysisReadiness } from './analysis-readiness';
import { Flame, Heart, Mic, Music2, Sparkles, Type, Wand2, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectSession } from '../../core/session';
import { useApp, useLibraryVersion, useSessionVersion } from '../../store';
import { displayTitle, recommend, STYLE_THEME } from '@amv/music';
import { applyCommand, clipEndUs, newId, sourceTimeAt, type Clip, type Project } from '@amv/project';
import { Button, Dialog } from '../../ui/controls';
import { MusicalMap } from './MusicalMap';
import { RegenerationCompare } from './RegenerationCompare';
import { SceneSuggestions } from './SceneSuggestions';
import { useEditor } from '../editor/editorStore';
import { getPlayer } from '../editor/Preview';
import { TextLookSample } from '../editor/SubtitlesPanel';

const TYPOGRAPHY_PREVIEW_PILLS: { id: LyricTypographyStyle; label: string; sample: string }[] = [
  { id: 'anime-blend', label: 'Anime · mesclado c/ vídeo', sample: 'FOGO VIVO' },
  { id: 'anime-impact', label: 'Anime · impacto brutal', sample: 'IMPACTO' },
  { id: 'anime-katana', label: 'Anime · katana brush', sample: 'KATANA' },
  { id: 'anime-neon', label: 'Anime · neon vazado', sample: 'NEON' },
  { id: 'anime-gold-epic', label: 'Anime · ouro épico', sample: 'ÉPICO' },
  { id: 'anime-manga', label: 'Anime · slash mangá', sample: 'MANGÁ' },
  { id: 'lyrics-cinematic', label: 'Cinema editorial', sample: 'CINEMA' },
  { id: 'anime-dialogue', label: 'Fala do personagem', sample: 'DIÁLOGO' },
];

const ICONS: Record<StyleId, typeof Flame> = { hype: Flame, rapido: Zap, superacao: Sparkles, letra: Type, discurso: Mic, emocional: Heart };
const INTENSITY = ['Suave', 'Moderada', 'Intensa', 'Extrema'] as const;
const DURATIONS = [15, 30, 45, 60, 90];
const S = 1_000_000;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface LocalizedRange {
  startUs: number;
  endUs: number;
  trackId: string;
  clipIds: string[];
}

interface LocalizedCandidate {
  id: string;
  commands: LocalizedRegenerationResult['commands'];
  baseProject: Project;
  baseRevision: number;
  previewProject: Project;
  startUs: number;
  endUs: number;
  replaceClipIds: string[];
  addedClipIds: string[];
  replaced: number;
  added: number;
  warnings: string[];
  seed: number;
}

export function GenerateDialog({ session, onClose, localizedRange }: { session: ProjectSession; onClose: () => void; localizedRange?: LocalizedRange }) {
  useSessionVersion(session);
  const { platform, toast, library } = useApp();
  useLibraryVersion(library);
  const project = session.project;
  const musics = project.assets.filter((a) => a.kind === 'audio' && !a.tags.includes('sfx'));
  const episodes = project.assets.filter((a) => a.kind === 'video');
  const initialMusicClip = localizedRange && project.tracks.find((track) => track.id === localizedRange.trackId)
    ? project.clips.find((clip) => {
        const track = project.tracks.find((item) => item.id === clip.trackId);
        return track?.role === 'music' && clip.assetId && clip.timelineStartUs <= localizedRange.startUs && clipEndUs(clip) > localizedRange.startUs;
      })
    : undefined;
  const [musicId, setMusicId] = useState(initialMusicClip?.assetId ?? musics[0]?.id ?? '');
  const [epIds, setEpIds] = useState<string[]>(episodes.map((e) => e.id));
  const [directorMode, setDirectorMode] = useState<'autonomous' | 'manual'>('autonomous');
  const [autonomousSpeech, setAutonomousSpeech] = useState(true);
  const [style, setStyle] = useState<StyleId>('hype');
  const [styleMode, setStyleMode] = useState<'auto' | 'manual'>('auto');
  const [musicDriveMode, setMusicDriveMode] = useState<'lyric-kinetic' | 'pure-rhythm' | 'lyric-verse' | 'narrative-climax'>('lyric-kinetic');
  const [autoExtractMusicLyrics, setAutoExtractMusicLyrics] = useState(true);
  const [intensity, setIntensity] = useState<0 | 1 | 2 | 3>(2);
  const [duration, setDuration] = useState(30);
  const [localizedStartS, setLocalizedStartS] = useState((localizedRange?.startUs ?? 0) / S);
  const [localizedEndS, setLocalizedEndS] = useState((localizedRange?.endUs ?? 0) / S);
  const [voiceMoments, setVoiceMoments] = useState(2);
  const [voiceLang, setVoiceLang] = useState<'original' | 'pt'>('original');
  const [speechVisualMode, setSpeechVisualMode] = useState<'voiceover' | 'hybrid' | 'scene'>('voiceover');
  const [focus, setFocus] = useState<'fight' | 'mix'>('fight');
  const [organizationMode, setOrganizationMode] = useState<OrganizationMode>('narrative');
  const [editorialDirection, setEditorialDirection] = useState<EditorialDirection>('balanced');
  const [seqIds, setSeqIds] = useState<string[]>([]);
  const [hitSync, setHitSync] = useState(true);
  const [adaptiveSpeed, setAdaptiveSpeed] = useState(true);
  const [beatOffsetMs, setBeatOffsetMs] = useState(0);
  const [useSfx, setUseSfx] = useState(true);
  const [sfxMode, setSfxMode] = useState<'hits-only' | 'full' | 'off'>('hits-only');
  const [characters, setCharacters] = useState<string[]>([]);
  const [characterDrafts, setCharacterDrafts] = useState<Record<string, string>>({});
  const [visionScope, setVisionScope] = useState<VisionScope>('fights');
  const [deepVisionBeforeGenerate, setDeepVisionBeforeGenerate] = useState(false);
  const [vision, setVision] = useState<{ done: number; total: number; ep: string } | null>(null);
  const visionAbort = useRef<AbortController | null>(null);
  const [musicStart, setMusicStart] = useState<number | null>(null);
  const [useEffects, setUseEffects] = useState(true);
  const [showText, setShowText] = useState(true);
  const [showSpeechCaptions, setShowSpeechCaptions] = useState(true);
  const [depthCutoutOnDrop, setDepthCutoutOnDrop] = useState(true);
  const [speechCaptionLanguage, setSpeechCaptionLanguage] = useState('pt-BR');
  const [lyrics, setLyrics] = useState<{ name: string; cues: Cue[] } | null>(null);
  const [lyricDraft, setLyricDraft] = useState('');
  const [translateLyricsToPt, setTranslateLyricsToPt] = useState(true);
  const [lyricsSyncing, setLyricsSyncing] = useState(false);
  const [lyricsSyncProgress, setLyricsSyncProgress] = useState<{ stage: string; progress: number } | null>(null);
  const transcriptionAbort = useRef<AbortController | null>(null);
  const [matchLyrics, setMatchLyrics] = useState(false);
  const [lyricSceneMatches, setLyricSceneMatches] = useState<NonNullable<GenerateOptions['lyricSceneMatches']>>({});
  const [suggestedMatches, setSuggestedMatches] = useState<NonNullable<GenerateOptions['lyricSceneMatches']> | null>(null);
  const [lyricStyle, setLyricStyle] = useState<LyricTypographyStyle>('anime-blend');
  const [seed, setSeed] = useState(1);
  const [result, setResult] = useState<{
    warnings: string[];
    text: string;
    brief: ReturnType<typeof buildCreativeBrief>;
    storyboard: ReturnType<typeof reviewGeneratedAssembly>['storyboard'];
    alignment: ReturnType<typeof reviewGeneratedAssembly>['alignment'];
    review: {
      high: number;
      medium: number;
      low: number;
      checked: number;
      partial: number;
      unavailable: number;
      repairsApplied: string[];
      issues: Array<{ startUs: number; severity: string; type: string; suggestion: string }>;
    };
    tournament?: {
      score: AssemblyScoreBreakdown;
      candidatesEvaluated: number;
      winnerLabel: string;
      unifiedHighlights: string[];
    };
  } | null>(null);
  const [localizedCandidates, setLocalizedCandidates] = useState<LocalizedCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [candidateMode, setCandidateMode] = useState(false);
  const [compareFraction, setCompareFraction] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [generationStep, setGenerationStep] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [creativeProfiles, setCreativeProfiles] = useState<CreativeProfile[]>([...DEFAULT_CREATIVE_PROFILES]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [profileStorageError, setProfileStorageError] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [actionEmphasis, setActionEmphasis] = useState(50);
  const [emotionEmphasis, setEmotionEmphasis] = useState(50);
  const [preferredEmotion, setPreferredEmotion] = useState<SceneEmotion | ''>('');

  useEffect(() => {
    let cancelled = false;
    if (!platform) return;
    void loadCreativeProfiles(platform).then((profiles) => {
      if (cancelled) return;
      setCreativeProfiles(profiles);
      setProfilesLoaded(true);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setProfileStorageError(true);
      setProfilesLoaded(true);
      toast({ tone: 'error', title: 'Não foi possível carregar perfis criativos', body: (error as Error).message });
    });
    return () => { cancelled = true; };
  }, [platform, toast]);

  const music = session.assetRuntime(musicId).music;
  useEffect(() => {
    transcriptionAbort.current?.abort();
    setLyrics(null);
    setLyricSceneMatches({});
  }, [musicId]);

  useEffect(() => () => {
    transcriptionAbort.current?.abort();
  }, []);
  const ready = episodes.filter((e) => epIds.includes(e.id) && session.assetRuntime(e.id).episode);
  const selectedEpisodes = episodes.filter((episode) => epIds.includes(episode.id));
  const selectedMusic = musics.find((asset) => asset.id === musicId);
  const selectedAnalysis = selectedEpisodes.map((episode) => {
    const runtime = session.assetRuntime(episode.id);
    return {
      id: episode.id,
      name: episode.name,
      ready: !!runtime.episode,
      error: runtime.analysis === 'error' ? runtime.analysisError ?? 'falha desconhecida' : undefined,
    };
  });
  if (selectedMusic) {
    const runtime = session.assetRuntime(selectedMusic.id);
    selectedAnalysis.push({
      id: selectedMusic.id,
      name: selectedMusic.name,
      ready: !!runtime.music,
      error: runtime.analysis === 'error' ? runtime.analysisError ?? 'falha desconhecida' : undefined,
    });
  }
  const analysisReadiness = getAnalysisReadiness(selectedAnalysis);
  const analysisFailures = analysisReadiness.failed;
  const waiting = analysisReadiness.pending.length;
  // muda quando a visão de algum episódio ganha cenas (para refazer o plano)
  const visionVersion = ready.map((e) => {
    const shots = Object.values(session.assetRuntime(e.id).vision?.shots ?? {});
    return `${shots.length}:${shots.filter((shot) => shot.local).length}`;
  }).join(',');
  const inputs = useMemo<EpisodeInput[]>(
    () => ready.map((e) => {
      const vision = (session.assetRuntime(e.id).vision as EpisodeVision | null | undefined) ?? undefined;
      return {
        assetId: e.id,
        name: e.name,
        analysis: session.assetRuntime(e.id).episode!,
        hasAudio: (e.probe?.audio.length ?? 0) > 0,
        sourceFps: e.probe?.video?.avgFps ?? e.probe?.video?.fps ?? null,
        variableFrameRate: e.probe?.video?.vfr ?? false,
        audioStreams: e.probe?.audio.map((a) => ({ index: a.index, language: a.language, title: a.title })),
        vision: canonicalizeEpisodeVision(vision, project.characterLibrary),
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready.map((e) => e.id).join(','), session, visionVersion, project.characterLibrary],
  );
  const recommendation = useMemo(
    () => (music && inputs.length ? recommendStyle(inputs.map((input) => ({ analysis: input.analysis, visual: input.vision })), music, !!lyrics?.cues.length) : null),
    [inputs, music, lyrics],
  );
  const smartPreset = useMemo(() => {
    if (!music || !inputs.length) return null;
    return recommendEpisodePreset(
      inputs,
      { assetId: musicId, name: selectedMusic?.name ?? 'Música', analysis: music },
      lyrics?.cues,
    );
  }, [inputs, music, musicId, selectedMusic?.name, lyrics?.cues]);

  const applySmartPreset = () => {
    if (!smartPreset) return;
    setStyle(smartPreset.style);
    setStyleMode('manual');
    setIntensity(smartPreset.intensity);
    setDuration(smartPreset.durationS);
    if (smartPreset.musicStartS !== null) setMusicStart(smartPreset.musicStartS);
    setEditorialDirection(smartPreset.editorialDirection);
    setOrganizationMode(smartPreset.organizationMode);
    setFocus(smartPreset.focus);
    setVoiceMoments(smartPreset.voiceMoments);
    setVoiceLang(smartPreset.voiceLang);
    setUseEffects(smartPreset.useEffects);
    setHitSync(smartPreset.hitSync);
    setAdaptiveSpeed(smartPreset.adaptiveSpeed);
    toast({ tone: 'ok', title: 'Configuração padrão aplicada', body: smartPreset.explanation.title });
  };
  const selectedStyle = styleMode === 'auto' ? recommendation?.style ?? style : style;
  const activeCreativeProfile = creativeProfiles.find((profile) => profile.id === activeProfileId);
  const activeProfileIsCustom = !!activeCreativeProfile && !isBuiltInCreativeProfile(activeCreativeProfile);
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
    () => (music && inputs.length ? planFootage(inputs, { style: selectedStyle, intensity, durationS: duration, focus, sequenceIds: seqIds, exclude: excluded, seed, characters, editorialDirection }, music) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [music, inputs, selectedStyle, intensity, duration, focus, seqIds.join(','), excluded.join(','), seed, characters.join(','), editorialDirection],
  );
  const ranges = useMemo(() => (music && plan ? suggestMusicRanges(music, duration, plan.fit, 3) : []), [music, plan, duration]);
  // o trecho escolhido só vale enquanto ainda é uma das sugestões (mudou duração/estilo/luta: volta ao automático)
  const chosenStart = ranges.some((r) => r.startS === musicStart) ? musicStart : null;
  const musicMapRange = music ? chooseMusicRange(music, duration, chosenStart) : null;

  // carrega do cache a visão já feita (uma vez por episódio)
  useEffect(() => {
    for (const e of ready) if (session.assetRuntime(e.id).vision === undefined) void session.loadVision(e.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready.map((e) => e.id).join(',')]);
  const charList = useMemo(() => {
    const all = new Map<string, { name: string; displayName: string; shots: number; sources: string[] }>();
    for (const e of ready) for (const c of characterCounts(session.assetRuntime(e.id).vision)) {
      const profile = project.characterLibrary.find((item) =>
        [item.name, ...item.aliases].some((alias) => normLabel(alias) === normLabel(c.name)),
      );
      const k = profile?.id ?? normLabel(c.name);
      const x = all.get(k);
      if (x) {
        x.shots += c.shots;
        if (!x.sources.some((source) => normLabel(source) === normLabel(c.name))) x.sources.push(c.name);
      } else all.set(k, { name: c.name, displayName: profile?.name ?? c.name, shots: c.shots, sources: [c.name] });
    }
    return [...all.values()].sort((a, b) => b.shots - a.shots).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },   [ready.map((e) => e.id).join(','), session, visionVersion, project.characterLibrary]);
  const visionTodo = ready.reduce((n, e) => n + session.visionTargets(e.id, visionScope, undefined, matchLyrics).length, 0);
  const localVisionTodo = ready.reduce((n, e) => n + session.localVisionTargets(e.id, visionScope).length, 0);
  const movementRows = ready.flatMap((episode) =>
    Object.entries(session.assetRuntime(episode.id).vision?.shots ?? {}).flatMap(([key, scene]) =>
      (scene.local?.motionEvents ?? [])
        .filter((event) => event.confidence >= 0.6 && event.cameraMotion !== 'unknown')
        .map((event) => ({
          episode: episode.name,
          shotStartS: session.assetRuntime(episode.id).episode?.shots.find((item) => shotKey(item.startS) === key)?.startS ?? event.startS,
          event,
        })),
    ),
  ).sort((a, b) => a.shotStartS - b.shotStartS);

  const saveCharacterProfile = (sourceLabels: string[], requestedName: string) => {
    const name = requestedName.trim();
    if (!name) {
      toast({ tone: 'warn', title: 'Informe um nome', body: 'A biblioteca de personagens exige um nome para salvar a identificação.' });
      return;
    }
    const current = project.characterLibrary.find((profile) =>
      normLabel(profile.name) === normLabel(name)
        || [profile.name, ...profile.aliases].some((alias) => sourceLabels.some((label) => normLabel(alias) === normLabel(label))),
    );
    const evidence = ready.flatMap((episode) =>
      Object.entries(session.assetRuntime(episode.id).vision?.shots ?? {})
        .filter(([, scene]) => scene.characters.some((label) => sourceLabels.some((source) => normLabel(label) === normLabel(source))))
        .map(([sceneKey, scene]) => ({
          assetId: episode.id,
          sceneKey,
          source: 'vision' as const,
          confidence: scene.confidence ?? null,
        })),
    );
    const evidenceByKey = new Map(
      [...(current?.evidence ?? []), ...evidence].map((item) => [`${item.assetId}@${item.sceneKey}`, item]),
    );
    const allEvidence = [...evidenceByKey.values()];
    const confidenceValues = allEvidence.flatMap((item) => item.confidence === null ? [] : [item.confidence]);
    const updated = {
      id: current?.id ?? newId('character'),
      name,
      aliases: [...new Set([...(current?.aliases ?? []), ...sourceLabels].filter((alias) => normLabel(alias) !== normLabel(name)))],
      evidence: allEvidence,
      confidence: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : null,
      confirmed: true,
    };
    const characters = current
      ? project.characterLibrary.map((profile) => profile.id === current.id ? updated : profile)
      : [...project.characterLibrary, updated];
    session.history.transaction('Salvar personagem na biblioteca do projeto', [{
      type: 'project.characterLibrary.update',
      characters,
    }]);
    setCharacters((selected) => selected.map((label) => sourceLabels.some((source) => normLabel(label) === normLabel(source)) ? name : label));
    toast({ tone: 'ok', title: 'Personagem salvo', body: `${name} e suas cenas associadas foram salvos neste projeto.` });
  };

  const runLocalVision = async () => {
    if (!platform || vision) return;
    visionAbort.current = new AbortController();
    let analyzed = 0;
    let failed = 0;
    let frameFailures = 0;
    try {
      for (const e of ready) {
        const targets = session.localVisionTargets(e.id, visionScope);
        if (!targets.length) continue;
        setVision({ done: 0, total: targets.length, ep: e.name });
        const result = await session.runLocalVision(e.id, {
          scope: visionScope,
          signal: visionAbort.current.signal,
          onProgress: (done, total) => setVision({ done, total, ep: e.name }),
        });
        analyzed += result.analyzed;
        failed += result.failed;
        frameFailures += result.frameFailures;
        if (visionAbort.current.signal.aborted) break;
      }
      toast(failed || frameFailures
        ? { tone: 'warn', title: `${analyzed} cenas analisadas localmente`, body: `${failed} cenas sem quadro; ${frameFailures} falhas de extração. A análise pode ser retomada sem repetir cenas concluídas.` }
        : { tone: 'ok', title: `${analyzed} cenas analisadas localmente`, body: 'Descritores visuais, composição, movimento e categorias heurísticas agora influenciam a montagem. Nenhum quadro saiu do computador.' });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast({ tone: 'error', title: 'Não deu para analisar as cenas localmente', body: (error as Error).message });
    } finally {
      visionAbort.current = null;
      setVision(null);
    }
  };

  const runVision = async (scopeOverride: VisionScope = visionScope): Promise<{ labeled: number; failed: number; frameFailures: number; lyricMatches: NonNullable<GenerateOptions['lyricSceneMatches']> } | null> => {
    if (!platform || vision) return null;
    try {
      const settings = await loadAiSettings(platform);
      if (!settings.enabled) {
        toast({ tone: 'warn', title: 'Ligue um modelo de IA com visão', body: 'Abra o Assistente e clique na engrenagem. Gemini, Claude, GPT-4o e modelos de visão no Ollama são compatíveis.' });
        return null;
      }
      if (!isLocal(settings) && !settings.allowExternal) {
        toast({ tone: 'warn', title: 'Envio para a internet desligado', body: 'A análise manda quadros dos episódios ao serviço de IA. Autorize na engrenagem do Assistente ou use um modelo local (Ollama).' });
        return null;
      }
      const key = settings.provider.needsKey ? await platform.secrets.get(secretName(settings.presetId)) : null;
      const musicRange = music ? chooseMusicRange(music, duration, chosenStart) : null;
      const lyricCues = lyrics?.cues
        .filter((cue) => !musicRange || (cue.endS > musicRange[0] && cue.startS < musicRange[1]))
        .sort((a, b) => impactScore(b.text) - impactScore(a.text))
        .slice(0, 6)
        .sort((a, b) => a.startS - b.startS)
        .map((cue) => ({ id: lyricCueKey(cue), text: cue.text, startS: cue.startS, endS: cue.endS }));
      const context = music
        ? {
            style: STYLES.find((item) => item.id === selectedStyle)!.label,
            editorialObjective: STYLE_EDITORIAL_GOALS[selectedStyle].objective,
            editorialPriorities: STYLE_EDITORIAL_GOALS[selectedStyle].priorities,
            editorialGuardrails: STYLE_EDITORIAL_GOALS[selectedStyle].guardrails,
            targetIntensity: INTENSITY[intensity],
            music: {
              bpm: music.bpm,
              bpmConfidence: music.bpmConfidence,
              intensity: music.intensity,
              sections: music.sections.map(({ label, energy }) => ({ label, energy })),
              dropsS: music.drops.filter((drop) => !musicRange || (drop >= musicRange[0] && drop <= musicRange[1])),
            },
            lyrics: lyricCues?.map((cue) => cue.text),
            lyricCues,
          }
        : undefined;
      if (matchLyrics && !lyricCues?.length) {
        toast({ tone: 'warn', title: 'Carregue uma letra sincronizada', body: 'O encaixe semântico precisa de versos com tempo (.LRC ou .SRT).' });
        return null;
      }
      if (matchLyrics) setLyricSceneMatches({});
      visionAbort.current = new AbortController();
      let labeled = 0;
      let failed = 0;
      let frameFailures = 0;
      let matchCount = 0;
      const allLyricMatches: NonNullable<GenerateOptions['lyricSceneMatches']> = {};
      for (const e of ready) {
        const targets = session.visionTargets(e.id, scopeOverride, undefined, matchLyrics);
        if (!targets.length) continue;
        setVision({ done: 0, total: targets.length, ep: e.name });
        const r = await session.runVision(e.id, {
          provider: settings.provider,
          key,
          fetch: platform.http,
          scope: scopeOverride,
          context,
          matchLyrics,
          signal: visionAbort.current.signal,
          onProgress: (done, total) => {
            setVision({ done, total, ep: e.name });
            if (deepVisionBeforeGenerate) {
              const fraction = done / Math.max(1, total);
              setGenerationProgress(26 + fraction * 12);
              setGenerationStep('Análise semântica profunda · ' + e.name + ' (' + done + '/' + total + ')');
            }
          },
        });
        if (matchLyrics) {
          setLyricSceneMatches((current) => ({ ...current, ...r.lyricMatches }));
          Object.assign(allLyricMatches, r.lyricMatches);
        }
        matchCount += Object.values(r.lyricMatches).reduce((count, matches) => count + Object.keys(matches).length, 0);
        labeled += r.labeled;
        failed += r.failed;
        frameFailures += r.frameFailures;
        if (visionAbort.current.signal.aborted) break;
      }
      if (visionAbort.current?.signal.aborted) return null;
      toast(failed || frameFailures
        ? { tone: 'warn', title: `${labeled} cenas analisadas`, body: `${failed} cenas sem resposta do modelo; ${frameFailures} quadros não puderam ser extraídos. Rode de novo para tentar as cenas incompletas.` }
        : { tone: 'ok', title: `${labeled} cenas analisadas`, body: matchLyrics ? `${matchCount} combinações de letra/cena retornadas; as demais cenas usam a seleção local.` : 'Escolha os personagens ao lado.' });
      return { labeled, failed, frameFailures, lyricMatches: allLyricMatches };
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast({ tone: 'error', title: 'Não deu para analisar as cenas', body: (err as Error).message });
      return null;
    } finally {
      visionAbort.current = null;
      setVision(null);
    }
  };

  const hasTwoAudio = ready.some((e) => (e.probe?.audio.length ?? 0) > 1);
  const sceneCount = useMemo(() => ready.reduce((a, e) => a + (session.assetRuntime(e.id).episode?.shots.length ?? 0), 0), [ready, session]);

  const parseDraftTimedLyrics = (raw: string): Cue[] => {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const ext = /^\s*\[\d+:\d{2}/m.test(trimmed)
      ? 'letra.lrc'
      : /-->/.test(trimmed)
        ? (/^WEBVTT/i.test(trimmed) ? 'letra.vtt' : 'letra.srt')
        : null;
    if (!ext) return [];
    return parseSubtitles(ext, trimmed, music?.durationS).filter((c) => Number.isFinite(c.startS) && c.text.trim());
  };

  const applyMusicDriveMode = (mode: 'lyric-kinetic' | 'pure-rhythm' | 'lyric-verse' | 'narrative-climax') => {
    setMusicDriveMode(mode);
    if (mode === 'lyric-kinetic') {
      setShowText(true);
      setAutoExtractMusicLyrics(true);
      if (lyricStyle === 'lyrics-cinematic' || lyricStyle === 'anime-dialogue') setLyricStyle('anime-impact');
      if (editorialDirection === 'cinematic') setEditorialDirection('hype');
    } else if (mode === 'pure-rhythm') {
      setStyleMode('manual');
      setStyle('rapido');
      setEditorialDirection('hype');
      setHitSync(true);
      setAdaptiveSpeed(true);
      setVoiceMoments(0);
      setShowSpeechCaptions(false);
      setAutoExtractMusicLyrics(false);
    } else if (mode === 'lyric-verse') {
      setShowText(true);
      setAutoExtractMusicLyrics(true);
    } else if (mode === 'narrative-climax') {
      setEditorialDirection('cinematic');
      setOrganizationMode('narrative');
      setShowText(true);
    }
  };

  const pickLyrics = async () => {
    const path = await platform!.dialogs.pickFile('Letra da música (com tempo ou texto)', ['lrc', 'srt', 'ass', 'vtt', 'txt']);
    if (!path) return;
    const text = decodeSubtitleBytes(await platform!.fs.readFile(path));
    const cues = parseSubtitles(path, text, music?.durationS);
    const timed = cues.filter((c) => Number.isFinite(c.startS));
    const fileName = path.split(/[\\/]/).pop()!;
    if (!timed.length) {
      const plain = text.replace(/^\uFEFF/, '').trim();
      if (plain) {
        setLyricDraft(plain);
        setLyrics(null);
        setLyricSceneMatches({});
        toast({ tone: 'info', title: 'Texto carregado na caixa de letra', body: 'Sincronize com a música ou clique em Gerar.' });
        return;
      }
      toast({ tone: 'warn', title: 'Essa letra está vazia', body: 'Use um arquivo .lrc, .srt ou .txt com versos.' });
      return;
    }
    let prepared = timed;
    let labelName = fileName;
    if (translateLyricsToPt && platform) {
      setLyricsSyncing(true);
      setLyricsSyncProgress({ stage: 'Traduzindo letra importada (PT-BR)', progress: 0.4 });
      try {
        const ptRes = await translateTextsAuto(platform, timed.map((c) => c.text), 'português brasileiro');
        prepared = promoteAlignedCuesForTypography(
          timed.map((cue, idx) => ({
            ...cue,
            text: ptRes.translations[idx]?.trim() || cue.text,
          })),
        );
        labelName = `${fileName} (PT-BR)`;
      } finally {
        setLyricsSyncing(false);
        setLyricsSyncProgress(null);
      }
    } else {
      prepared = promoteAlignedCuesForTypography(timed);
    }
    setLyricDraft(prepared.map((c) => c.text).join('\n'));
    setLyrics({ name: labelName, cues: prepared });
    setLyricSceneMatches({});
  };

  const syncWrittenLyrics = async (): Promise<Cue[] | null> => {
    const text = lyricDraft.trim();
    if (!platform || !selectedMusic || !text || lyricsSyncing) return null;
    const directTimed = parseDraftTimedLyrics(text);
    if (directTimed.length) {
      let prepared = directTimed;
      if (translateLyricsToPt) {
        const ptRes = await translateTextsAuto(
          platform,
          directTimed.map((c) => c.text),
          'português brasileiro',
        );
        prepared = directTimed.map((cue, idx) => ({
          ...cue,
          text: ptRes.translations[idx]?.trim() || cue.text,
        }));
      }
      const promoted = promoteAlignedCuesForTypography(prepared);
      setLyrics({ name: 'Letra colada (com tempo)', cues: promoted });
      setLyricSceneMatches({});
      toast({ tone: 'ok', title: `${promoted.length} linhas carregadas`, body: 'Os tempos colados no campo foram reconhecidos diretamente.' });
      return promoted;
    }
    const audioIndex = selectedMusic.probe?.audio[0]?.index;
    if (audioIndex === undefined) {
      toast({ tone: 'error', title: 'A música não tem áudio disponível', body: 'Escolha outro arquivo de música ou confira se ele ainda existe.' });
      return null;
    }
    const controller = new AbortController();
    transcriptionAbort.current = controller;
    setLyrics(null);
    setLyricsSyncing(true);
    setLyricsSyncProgress({ stage: 'Preparando áudio da música', progress: 0 });
    try {
      const totalDuration = Math.max(1, (selectedMusic.probe?.durationUs ?? 0) / S);
      // Para voz cantada sobre música, desliga o filtro VAD para o Silero não descartar os vocais.
      const transcript = await transcribeMediaAsset(platform, selectedMusic, audioIndex, {
        model: 'small',
        vadFilter: false,
        signal: controller.signal,
        onProgress: ({ stage, progress, duration: d }) => setLyricsSyncProgress({
          stage: stage === 'extracting' ? 'Extraindo áudio da música' : stage === 'preparing' ? 'Carregando modelo Whisper' : 'Reconhecendo vocais',
          progress: Math.min(1, Math.max(0, progress / Math.max(1, d || totalDuration))),
        }),
      });
      const words = extractTranscriptWords(transcript);
      if (!words.length && !transcript.segments.length) {
        toast({ tone: 'warn', title: 'Não consegui reconhecer vocais na música', body: 'O modelo não encontrou vocais claros nessa faixa. Tente um arquivo .LRC/.SRT sincronizado.' });
        return null;
      }
      const origLines = text.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
      const direct = alignUntimedLyrics(text, words);
      const detectedAudioLang = (transcript.language ?? '').toLowerCase();
      let translatedForMatching: string | undefined;
      if (origLines.length && direct.matched < origLines.length * 0.4 && detectedAudioLang && !detectedAudioLang.startsWith('pt')) {
        setLyricsSyncProgress({ stage: `Traduzindo letra para alinhar (${detectedAudioLang})`, progress: 0.92 });
        const forMatch = await translateTextsAuto(platform, origLines, detectedAudioLang, { signal: controller.signal });
        translatedForMatching = origLines.map((line, i) => forMatch.translations[i]?.trim() || line).join('\n');
      }
      const aligned = alignUntimedLyricsWithFallback(text, words, transcript.segments, translatedForMatching);
      if (!aligned.cues.length) {
        toast({ tone: 'warn', title: 'Não encontrei correspondências suficientes', body: 'A letra pode estar diferente do áudio reconhecido. Confira se o texto está bem separado linha a linha.' });
        return null;
      }
      let finalCues = aligned.cues;
      if (translateLyricsToPt && !translatedForMatching && (!detectedAudioLang || !detectedAudioLang.startsWith('pt'))) {
        setLyricsSyncProgress({ stage: 'Traduzindo letra para Português', progress: 0.96 });
        const ptRes = await translateTextsAuto(
          platform,
          finalCues.map((c) => c.text),
          'português brasileiro',
          { sourceLanguage: transcript.language, signal: controller.signal },
        );
        finalCues = promoteAlignedCuesForTypography(
          finalCues.map((cue, idx) => ({
            ...cue,
            text: ptRes.translations[idx]?.trim() || cue.text,
          })),
        );
      } else {
        finalCues = promoteAlignedCuesForTypography(finalCues);
      }
      setLyrics({ name: 'Letra escrita e sincronizada', cues: finalCues });
      setLyricSceneMatches({});
      toast({
        tone: aligned.unmatched || aligned.uncertain ? 'warn' : 'ok',
        title: `${finalCues.length} linhas sincronizadas`,
        body: translatedForMatching
          ? 'Letra em português alinhada automaticamente com o vocal no idioma da música.'
          : `${aligned.uncertain} com tempo aproximado e ${aligned.unmatched} não encontradas.`,
      });
      return finalCues;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast({ tone: 'error', title: 'Não consegui sincronizar a letra', body: (error as Error).message });
      return null;
    } finally {
      transcriptionAbort.current = null;
      setLyricsSyncing(false);
      setLyricsSyncProgress(null);
    }
  };

  const extractLyricsFromMusic = async (): Promise<Cue[] | null> => {
    if (!platform || !selectedMusic || lyricsSyncing) return null;
    const audioIndex = selectedMusic.probe?.audio[0]?.index;
    if (audioIndex === undefined) {
      toast({ tone: 'error', title: 'A música não tem áudio disponível', body: 'Escolha outro arquivo de música.' });
      return null;
    }
    const controller = new AbortController();
    transcriptionAbort.current = controller;
    setLyricsSyncing(true);
    setLyricsSyncProgress({ stage: 'Extraindo vocais da música', progress: 0 });
    try {
      const totalDuration = Math.max(1, (selectedMusic.probe?.durationUs ?? 0) / S);
      const transcript = await transcribeMediaAsset(platform, selectedMusic, audioIndex, {
        model: 'small',
        vadFilter: false,
        signal: controller.signal,
        onProgress: ({ stage, progress, duration: d }) => setLyricsSyncProgress({
          stage: stage === 'extracting' ? 'Extraindo áudio da música' : stage === 'preparing' ? 'Carregando modelo Whisper' : 'Ouvindo vocais da música',
          progress: Math.min(1, Math.max(0, progress / Math.max(1, d || totalDuration))),
        }),
      });
      let rawCues: Cue[] = transcript.segments
        .flatMap((segment) => {
          const segWords = (segment.words ?? [])
            .filter((w) => w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
            .sort((a, b) => a.start - b.start);
          if (!segWords.length) {
            const clean = segment.text.replace(/\s+/g, ' ').trim();
            return clean.length >= 2 && segment.end > segment.start
              ? [{ startS: segment.start, endS: segment.end, text: clean }]
              : [];
          }
          // Divide segmentos longos em pausas vocais (>= 0,52 s) e ancora exatamente no início/fim da voz cantada
          const groups: (typeof segWords)[] = [[segWords[0]!]];
          for (let i = 1; i < segWords.length; i++) {
            const prev = segWords[i - 1]!;
            const curr = segWords[i]!;
            if (curr.start - prev.end >= 0.52 || groups[groups.length - 1]!.length >= 8) {
              groups.push([curr]);
            } else {
              groups[groups.length - 1]!.push(curr);
            }
          }
          return groups.map((grp) => ({
            startS: grp[0]!.start,
            endS: grp[grp.length - 1]!.end,
            text: grp.map((w) => w.text.trim()).join(' ').replace(/\s+/g, ' ').trim(),
            words: grp.map((w) => ({
              startS: w.start,
              endS: w.end,
              text: w.text.trim(),
              source: 'whisper' as const,
              confidence: 0.92,
            })),
          }));
        })
        .filter((c) => c.text.length >= 2 && c.endS > c.startS);
      if (!rawCues.length) {
        toast({ tone: 'warn', title: 'Nenhuma letra reconhecida na música', body: 'Essa faixa parece instrumental ou tem vocais muito baixos. Cole a letra manualmente.' });
        return null;
      }
      const detectedLang = (transcript.language ?? '').toLowerCase();
      if (translateLyricsToPt && (!detectedLang || !detectedLang.startsWith('pt'))) {
        setLyricsSyncProgress({ stage: 'Traduzindo letra extraída para PT-BR', progress: 0.94 });
        const ptRes = await translateTextsAuto(
          platform,
          rawCues.map((c) => c.text),
          'português brasileiro',
          { sourceLanguage: transcript.language, signal: controller.signal },
        );
        rawCues = rawCues.map((c, idx) => ({
          ...c,
          text: ptRes.translations[idx]?.trim() || c.text,
        }));
      }
      const finalCues = promoteAlignedCuesForTypography(rawCues);
      setLyricDraft(finalCues.map((c) => c.text).join('\n'));
      setLyrics({
        name: translateLyricsToPt ? 'Letra extraída do áudio (PT-BR)' : 'Letra extraída do áudio',
        cues: finalCues,
      });
      setLyricSceneMatches({});
      toast({
        tone: 'ok',
        title: `${finalCues.length} versos extraídos da música`,
        body: translateLyricsToPt ? 'Letra transcrita e traduzida para Português (Brasil).' : 'Letra transcrita no idioma original.',
      });
      return finalCues;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast({ tone: 'error', title: 'Não deu para extrair a letra', body: (error as Error).message });
      return null;
    } finally {
      transcriptionAbort.current = null;
      setLyricsSyncing(false);
      setLyricsSyncProgress(null);
    }
  };

  const applyCreativeProfile = (profile: CreativeProfile) => {
    setActiveProfileId(profile.id);
    setProfileNameDraft(profile.name);
    setStyle(profile.style);
    setStyleMode('manual');
    setIntensity(profile.intensity);
    setEditorialDirection(profile.editorialDirection);
    setOrganizationMode(profile.organizationMode);
    setFocus(profile.focus);
    setActionEmphasis(profile.actionEmphasis);
    setEmotionEmphasis(profile.emotionEmphasis);
    setPreferredEmotion(profile.preferredEmotion ?? '');
    setVoiceMoments(profile.voiceMoments);
    setShowText(profile.showText);
    setUseEffects(profile.useEffects);
    setHitSync(profile.hitSync);
    setAdaptiveSpeed(profile.adaptiveSpeed);
  };

  const persistCreativeProfiles = async (next: CreativeProfile[], selectedId: string, message: string): Promise<boolean> => {
    if (!platform || profileStorageError) return false;
    try {
      await saveCreativeProfiles(platform, next);
      setCreativeProfiles(next);
      setActiveProfileId(selectedId);
      toast({ tone: 'ok', title: message });
      return true;
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível salvar perfis criativos', body: (error as Error).message });
      return false;
    }
  };

  const profileFromCurrentOptions = (id: string, name: string): CreativeProfile => ({
    id,
    name,
    style: selectedStyle,
    intensity,
    editorialDirection,
    organizationMode,
    focus,
    actionEmphasis,
    emotionEmphasis,
    preferredEmotion: preferredEmotion || null,
    voiceMoments: voiceMoments as CreativeProfile['voiceMoments'],
    showText,
    useEffects,
    hitSync,
    adaptiveSpeed,
  });

  const saveNewCreativeProfile = async () => {
    const name = profileNameDraft.trim();
    if (!name) {
      toast({ tone: 'warn', title: 'Dê um nome ao perfil criativo' });
      return;
    }
    const profile = profileFromCurrentOptions(newId('creative'), name);
    if (await persistCreativeProfiles([...creativeProfiles, profile], profile.id, 'Perfil criativo salvo')) {
      setStyle(profile.style);
      setStyleMode('manual');
      setProfileNameDraft('');
    }
  };

  const updateCreativeProfile = async () => {
    const profile = creativeProfiles.find((item) => item.id === activeProfileId);
    if (!profile || isBuiltInCreativeProfile(profile)) return;
    const updated = profileFromCurrentOptions(profile.id, profileNameDraft.trim() || profile.name);
    if (await persistCreativeProfiles(
      creativeProfiles.map((item) => item.id === updated.id ? updated : item),
      updated.id,
      'Perfil criativo atualizado',
    )) {
      setStyle(updated.style);
      setStyleMode('manual');
      setProfileNameDraft(updated.name);
    }
  };

  const deleteCreativeProfile = async () => {
    const profile = creativeProfiles.find((item) => item.id === activeProfileId);
    if (!profile || isBuiltInCreativeProfile(profile) || !platform) return;
    if (!(await platform.dialogs.confirm(`Excluir o perfil "${profile.name}"?`, 'Excluir perfil criativo'))) return;
    await persistCreativeProfiles(
      creativeProfiles.filter((item) => item.id !== profile.id),
      '',
      'Perfil criativo excluído',
    );
  };

  const generate = async (nextSeed = seed) => {
    if (!music) return;
    if (waiting > 0 || analysisFailures.length > 0) {
      toast({
        tone: 'warn',
        title: 'A análise ainda não está completa',
        body: analysisFailures.length
          ? 'Tente novamente as análises com falha ou desmarque os arquivos antes de gerar.'
          : 'Aguarde a análise dos arquivos selecionados; nenhum episódio será omitido silenciosamente.',
      });
      return;
    }
    setBusy(true);
    try {
      if (localizedRange) {
        const startUs = Math.round(localizedStartS * S);
        const endUs = Math.round(localizedEndS * S);
        if (startUs < 0 || endUs <= startUs) throw new Error('Defina um intervalo válido para a regeneração.');
        const baseProject = session.project;
        const baseRevision = session.history.version;
        const target = baseProject.tracks.find((track) => track.id === localizedRange.trackId);
        if (!target || target.kind !== 'video') throw new Error('A trilha de vídeo selecionada não existe mais.');
        const timelineMusic = baseProject.clips.find((clip) => {
          const track = baseProject.tracks.find((item) => item.id === clip.trackId);
          return track?.role === 'music' && clip.assetId === musicId
            && clip.timelineStartUs <= startUs && clipEndUs(clip) > startUs;
        });
        const musicStartS = timelineMusic
          ? sourceTimeAt(timelineMusic, startUs - timelineMusic.timelineStartUs) / S
          : chosenStart;
        const opts: GenerateOptions = {
          useSfx: false,
          style: selectedStyle,
          intensity,
          durationS: (endUs - startUs) / S,
          musicStartS,
          lyrics: undefined,
          lyricSceneMatches: {},
          useSpeech: false,
          voiceMoments: 0,
          voiceLang,
          useEffects,
          showText: false,
          seed: nextSeed,
          exclude: excluded,
          focus,
          sequenceIds: seqIds,
          hitSync,
          adaptiveSpeed,
          beatOffsetMs,
          characters,
          organizationMode,
          editorialDirection,
          creativeEmphasis: creativeEmphasis({
            actionEmphasis,
            emotionEmphasis,
            preferredEmotion: preferredEmotion || null,
          }),
        };
        const generated = generateAmv({ ...baseProject, clips: [] }, { assetId: musicId, name: musics.find((asset) => asset.id === musicId)?.name ?? musicId, analysis: music }, inputs, opts);
        const generatedClips = generated.commands.flatMap((command) =>
          command.type === 'clip.add' && command.clip.trackId === localizedRange.trackId && command.clip.assetId && !command.clip.text
            ? [command.clip]
            : [],
        );
        const regeneration = prepareLocalizedRegeneration(baseProject, generatedClips, {
          startUs,
          endUs,
          trackId: localizedRange.trackId,
          replaceClipIds: localizedRange.clipIds,
        });
        const previewProject = applyCommand(baseProject, {
          type: 'batch',
          label: 'Prévia da regeneração localizada',
          commands: regeneration.commands,
        }).project;
        const candidate: LocalizedCandidate = {
          id: newId('regen'),
          commands: regeneration.commands,
          baseProject,
          baseRevision,
          previewProject,
          startUs,
          endUs,
          replaceClipIds: [...localizedRange.clipIds],
          addedClipIds: regeneration.commands.flatMap((command) =>
            command.type === 'clip.add' && command.clip.origin === 'ai' ? [command.clip.id] : [],
          ),
          replaced: regeneration.replaced,
          added: regeneration.added,
          warnings: generated.warnings,
          seed: nextSeed,
        };
        setLocalizedCandidates((previous) =>
          previous.length && previous[0]!.baseProject === baseProject
            ? [...previous, candidate]
            : [candidate],
        );
        setSelectedCandidateId(candidate.id);
        setCompareFraction(0.5);
        setSeed(nextSeed);
        setCandidateMode(true);
        return;
      }

      // efeitos sonoros: grava/registra uma vez; se falhar, o AMV sai sem eles e avisa
      let sfxAssets: GenerateOptions['sfxAssets'];
      let sfxError: string | null = null;
      setBusy(true);
      const automaticSpeechWarnings: string[] = [];
      const isAutonomous = directorMode === 'autonomous';

      // Passo 1 (Música Primeiro): analisa/sincroniza/extrai e traduz a letra da música ANTES de escolher as cenas.
      let resolvedLyrics: Cue[] | undefined = lyrics?.cues;
      let lyricsTranslatedToPt = !!lyrics?.name.includes('(PT-BR)');
      if (!resolvedLyrics?.length && lyricDraft.trim() && selectedMusic) {
        setGenerationStep('Sincronizando a letra com a música...');
        setGenerationProgress(6);
        const synced = await syncWrittenLyrics();
        if (synced?.length) {
          resolvedLyrics = synced;
          if (translateLyricsToPt) lyricsTranslatedToPt = true;
        } else {
          automaticSpeechWarnings.push('Não foi possível sincronizar automaticamente a letra digitada; confira o texto ou importe um .LRC/.SRT.');
        }
      } else if (
        !resolvedLyrics?.length
        && autoExtractMusicLyrics
        && showText
        && selectedMusic
        && (isAutonomous || musicDriveMode === 'lyric-kinetic' || musicDriveMode === 'lyric-verse' || selectedStyle === 'letra')
      ) {
        setGenerationStep('Analisando música e extraindo a letra...');
        setGenerationProgress(6);
        const extracted = await extractLyricsFromMusic();
        if (extracted?.length) {
          resolvedLyrics = extracted;
          if (translateLyricsToPt) lyricsTranslatedToPt = true;
        }
      }
      if (resolvedLyrics?.length && translateLyricsToPt && !lyricsTranslatedToPt) {
        setGenerationStep('Traduzindo a letra da música para PT-BR...');
        setGenerationProgress(12);
        const controller = new AbortController();
        transcriptionAbort.current = controller;
        try {
          const ptRes = await translateTextsAuto(
            platform!,
            resolvedLyrics.map((cue) => cue.text),
            'português brasileiro',
            { signal: controller.signal },
          );
          resolvedLyrics = promoteAlignedCuesForTypography(
            resolvedLyrics.map((cue, idx) => ({
              ...cue,
              text: ptRes.translations[idx]?.trim() || cue.text,
            })),
          );
          lyricsTranslatedToPt = true;
        } catch (error) {
          if ((error as Error).name === 'AbortError') throw error;
          automaticSpeechWarnings.push(`Não foi possível traduzir a letra antes de gerar: ${(error as Error).message}`);
        } finally {
          transcriptionAbort.current = null;
        }
      }

      setGenerationStep('Analisando cenas com rigor visual (foco, paleta, movimento e nitidez)...');
      setGenerationProgress(16);
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Orçamento inteligente priorizado: analisa lutas + impactos + melhores cenas narrativas em paralelo (~110 cenas/ep)
      // sem travar vários minutos em créditos de abertura/encerramento ou cenas mortas.
      const smartLocalVisionMax = 110;
      const localVisionPending = ready.reduce((total, episode) => total + session.localVisionTargets(episode.id, 'all', smartLocalVisionMax).length, 0);
      let localVisionAnalyzed = 0;
      let localVisionFailed = 0;
      let localFrameFailures = 0;
      if (localVisionPending > 0) {
        const controller = new AbortController();
        visionAbort.current = controller;
        let completedBeforeEpisode = 0;
        for (const episode of ready) {
          const targets = session.localVisionTargets(episode.id, 'all', smartLocalVisionMax);
          if (!targets.length) continue;
          setGenerationStep('Analisando cenas localmente · ' + episode.name);
          const outcome = await session.runLocalVision(episode.id, {
            scope: 'all',
            max: smartLocalVisionMax,
            signal: controller.signal,
            onProgress: (done, total) => {
              const fraction = (completedBeforeEpisode + done) / Math.max(1, localVisionPending);
              setGenerationProgress(16 + fraction * 14);
              setGenerationStep('Analisando cenas localmente · ' + episode.name + ' (' + done + '/' + total + ')');
            },
          });
          if (controller.signal.aborted) throw Object.assign(new Error('Análise cancelada'), { name: 'AbortError' });
          localVisionAnalyzed += outcome.analyzed;
          localVisionFailed += outcome.failed;
          localFrameFailures += outcome.frameFailures;
          completedBeforeEpisode += targets.length;
        }
        visionAbort.current = null;
      }

      let semanticVisionResult: { labeled: number; failed: number; frameFailures: number; lyricMatches: NonNullable<GenerateOptions['lyricSceneMatches']> } | null = null;
      let effectiveLyricSceneMatches = lyricSceneMatches;
      const semanticPending = ready.reduce((total, episode) => total + session.visionTargets(episode.id, 'all').length, 0);
      if (deepVisionBeforeGenerate && semanticPending > 0) {
        setGenerationStep('Preparando análise semântica de todas as cenas...');
        setGenerationProgress(30);
        await new Promise((resolve) => setTimeout(resolve, 0));
        semanticVisionResult = await runVision('all');
        if (!semanticVisionResult) {
          throw new Error('A análise semântica profunda não foi concluída. Confira o modelo de visão, a autorização de envio externo e tente novamente.');
        }
        effectiveLyricSceneMatches = { ...lyricSceneMatches, ...semanticVisionResult.lyricMatches };
      }

      const directorInputs: EpisodeInput[] = ready.map((episode) => {
        const runtime = session.assetRuntime(episode.id);
        return {
          assetId: episode.id,
          name: episode.name,
          analysis: { ...runtime.episode!, speech: [...runtime.episode!.speech], subtitles: [...runtime.episode!.subtitles] },
          hasAudio: (episode.probe?.audio.length ?? 0) > 0,
          sourceFps: episode.probe?.video?.avgFps ?? episode.probe?.video?.fps ?? null,
          variableFrameRate: episode.probe?.video?.vfr ?? false,
          audioStreams: episode.probe?.audio.map((audio) => ({ index: audio.index, language: audio.language, title: audio.title })),
          vision: canonicalizeEpisodeVision(runtime.vision as EpisodeVision | null | undefined, session.project.characterLibrary),
        };
      });

      const annotationExclusions = session.project.sceneAnnotations
        .filter((annotation) => annotation.excludedFromAuto)
        .map((annotation) => annotation.assetId + '@' + annotation.sceneKey);
      const editorialFootagePlan = planFootage(directorInputs, {
        style: selectedStyle,
        intensity,
        durationS: duration,
        focus: isAutonomous ? 'fight' : focus,
        sequenceIds: seqIds,
        exclude: [...excluded, ...annotationExclusions],
        seed: nextSeed,
        characters,
        editorialDirection: isAutonomous ? 'hype' : editorialDirection,
      }, music);

      const speechTranslations: Record<string, string> = {};
      const effectiveVoiceMoments = isAutonomous ? (autonomousSpeech ? Math.min(3, Math.max(1, Math.floor(duration / 14))) : 0) : voiceMoments;
      const wantsSpeech = effectiveVoiceMoments > 0 || (!isAutonomous && selectedStyle === 'discurso');
      const speechController = wantsSpeech ? new AbortController() : null;
      const transcribedAssetIds = new Set<string>();
      if (speechController) {
        transcriptionAbort.current = speechController;
        let completed = 0;
        for (const episodeInput of directorInputs) {
          const asset = selectedEpisodes.find((item) => item.id === episodeInput.assetId);
          const streams = asset?.probe?.audio ?? [];
          const audioIndex = pickAudioStreamByLanguage(streams, voiceLang)
            ?? (voiceLang === 'pt' && streams.length > 1 ? undefined : streams[0]?.index);
          const epDuration = Math.max(1, (asset?.probe?.durationUs ?? 0) / S);
          const nearFightSpeech = (s: SpeechSegment) =>
            editorialFootagePlan.mode !== 'fight'
            || editorialFootagePlan.pool.some((entry) => entry.ep.assetId === episodeInput.assetId && s.startS >= entry.seq.startS - 15 && s.endS <= entry.seq.endS + 5);
          const relevantWithText = episodeInput.analysis.speech.filter((s) => nearFightSpeech(s) && s.text && s.text.trim().length >= 3);
          const hasUsableSubtitles = relevantWithText.length >= Math.max(2, effectiveVoiceMoments)
            && (voiceLang !== 'pt' || relevantWithText.some((s) => s.language?.toLowerCase().startsWith('pt') || s.language?.toLowerCase().startsWith('por')));
          if (hasUsableSubtitles) {
            completed++;
            continue;
          }
          if (!asset || audioIndex === undefined) {
            automaticSpeechWarnings.push(`Não encontrei uma faixa de áudio para reconhecer as falas de ${episodeInput.name}.`);
            completed++;
            continue;
          }
          setGenerationStep(`Entendendo as falas do anime · ${episodeInput.name}`);
          setGenerationProgress(27 + (completed / Math.max(1, directorInputs.length)) * 5);
          try {
            // Em episódios longos (>= 3 min) com momentos de fala já detectados por voz, transcreve apenas
            // as janelas curtas candidatas (2–5 s cada) em vez do episódio inteiro de 24 min.
            const untitledRelevant = episodeInput.analysis.speech
              .filter((s) => !s.text?.trim() && s.endS - s.startS >= 0.6 && s.endS - s.startS <= 6 && nearFightSpeech(s))
              .sort((a, b) => scoreSpeechCandidate(b) - scoreSpeechCandidate(a))
              .slice(0, !isAutonomous && selectedStyle === 'discurso' ? 10 : Math.max(4, effectiveVoiceMoments * 2));
            if (epDuration >= 180 && untitledRelevant.length > 0) {
              const fallbackLang = streams.find((stream) => stream.index === audioIndex)?.language
                ?? streams.find((stream) => stream.index === audioIndex)?.title
                ?? null;
              let slicesRecognized = 0;
              for (const [sliceIdx, targetSeg] of untitledRelevant.entries()) {
                setGenerationStep(`Transcrevendo fala ${sliceIdx + 1}/${untitledRelevant.length} · ${episodeInput.name}`);
                const res = await transcribeAudioSlice(platform!, asset, audioIndex, targetSeg.startS, targetSeg.endS, {
                  model: 'small',
                  signal: speechController.signal,
                });
                if (res?.text.trim()) {
                  targetSeg.text = res.text.trim();
                  targetSeg.language = res.language ?? fallbackLang;
                  targetSeg.impact = Math.max(targetSeg.impact, impactScore(targetSeg.text));
                  slicesRecognized++;
                }
              }
              if (slicesRecognized > 0) transcribedAssetIds.add(episodeInput.assetId);
            } else {
              const transcript = await transcribeMediaAsset(platform!, asset, audioIndex, {
                model: 'small',
                vadFilter: true,
                signal: speechController.signal,
                onProgress: ({ stage, progress, duration: d }) => {
                  setGenerationStep(`${stage === 'extracting' ? 'Extraindo áudio' : stage === 'preparing' ? 'Preparando Whisper' : 'Reconhecendo falas'} · ${episodeInput.name}`);
                  setGenerationProgress(27 + ((completed + Math.min(1, progress / Math.max(1, d || epDuration))) / Math.max(1, directorInputs.length)) * 5);
                },
              });
              const fallbackLang = streams.find((stream) => stream.index === audioIndex)?.language
                ?? streams.find((stream) => stream.index === audioIndex)?.title
                ?? null;
              episodeInput.analysis.speech = mergeSpeechSegments(episodeInput.analysis.speech, transcript, fallbackLang);
              transcribedAssetIds.add(episodeInput.assetId);
            }
            if (!episodeInput.analysis.speech.some((s) => !!s.text?.trim())) {
              automaticSpeechWarnings.push(`O reconhecimento automático não encontrou falas claras em ${episodeInput.name}; usei apenas os textos existentes.`);
            }
          } catch (error) {
            if ((error as Error).name === 'AbortError') throw error;
            automaticSpeechWarnings.push(`Não consegui transcrever ${episodeInput.name}: ${(error as Error).message}`);
          }
          completed++;
        }
      }

      const targetLanguage: Record<string, string> = {
        'pt-BR': 'português brasileiro',
        en: 'inglês',
        es: 'espanhol',
        fr: 'francês',
        ja: 'japonês',
        de: 'alemão',
        it: 'italiano',
        ko: 'coreano',
        zh: 'chinês',
      };
      if (showText && wantsSpeech && speechCaptionLanguage !== 'original') {
        const pool = editorialFootagePlan.pool;
        const speechCandidates = directorInputs
          .flatMap((episodeInput) => episodeInput.analysis.speech.map((speech) => ({ episodeInput, speech })))
          .filter(({ episodeInput, speech }) => {
            const length = speech.endS - speech.startS;
            const durationFits = selectedStyle === 'discurso'
              ? length >= 0.8 && length <= 6
              : length >= 0.6 && length <= 4;
            if (!durationFits || !speech.text?.trim()) return false;
            if (!episodeInput.hasAudio || excluded.includes(episodeInput.assetId)) return false;
            const streams = episodeInput.audioStreams ?? [];
            if (voiceLang === 'pt' && streams.length >= 2 && pickAudioStreamByLanguage(streams, 'pt') === null) return false;
            if (editorialFootagePlan.mode !== 'fight') return true;
            const nearChosenFight = pool.some((entry) => entry.ep.assetId === episodeInput.assetId
              && speech.startS >= entry.seq.startS - 15 && speech.endS <= entry.seq.endS + 5);
            const fallbackFromChosenFightEpisode = pool.some((entry) => entry.ep.assetId === episodeInput.assetId);
            return nearChosenFight || fallbackFromChosenFightEpisode || selectedStyle === 'discurso';
          })
          .sort((left, right) => {
            const leftInPool = pool.some((entry) => entry.ep.assetId === left.episodeInput.assetId && left.speech.startS >= entry.seq.startS - 15 && left.speech.endS <= entry.seq.endS + 5) ? 1 : 0;
            const rightInPool = pool.some((entry) => entry.ep.assetId === right.episodeInput.assetId && right.speech.startS >= entry.seq.startS - 15 && right.speech.endS <= entry.seq.endS + 5) ? 1 : 0;
            return rightInPool - leftInPool
              || scoreSpeechCandidate(right.speech) - scoreSpeechCandidate(left.speech)
              || left.speech.startS - right.speech.startS;
          })
          .slice(0, !isAutonomous && selectedStyle === 'discurso'
            ? Math.max(60, Math.ceil(duration / 1.0) + 10)
            : Math.max(80, effectiveVoiceMoments * 15));
        if (speechCandidates.length) {
          try {
            setGenerationStep(`Traduzindo as falas para ${targetLanguage[speechCaptionLanguage] ?? speechCaptionLanguage}...`);
            setGenerationProgress(34);
            const translated = await translateTextsAuto(
              platform!,
              speechCandidates.map(({ speech }) => speech.text!),
              targetLanguage[speechCaptionLanguage] ?? speechCaptionLanguage,
              {
                batchSize: 20,
                signal: speechController?.signal,
                onProgress: (done, total) => setGenerationProgress(34 + 4 * done / Math.max(1, total)),
              },
            );
            translated.translations.forEach((value, index) => {
              const candidate = speechCandidates[index]!;
              if (value?.trim()) speechTranslations[`${candidate.episodeInput.assetId}@${candidate.speech.startS}`] = value.trim();
            });
            if (translated.failed) automaticSpeechWarnings.push(`${translated.failed} fala(s) não conseguiram ser traduzidas.`);
          } catch (error) {
            if ((error as Error).name === 'AbortError') throw error;
            automaticSpeechWarnings.push(`Falha na tradução automática: ${(error as Error).message}.`);
          }
        }
      }

      // Persiste as falas reconhecidas e traduzidas na sessão para a aba Biblioteca > Falas mostrar tudo em PT.
      for (const episodeInput of directorInputs) {
        const shouldPersist = transcribedAssetIds.has(episodeInput.assetId)
          || episodeInput.analysis.speech.some((s) => !!speechTranslations[`${episodeInput.assetId}@${s.startS}`]);
        if (!shouldPersist) continue;
        const speechForSession = episodeInput.analysis.speech.map((s) => {
          const translated = speechTranslations[`${episodeInput.assetId}@${s.startS}`];
          return translated ? { ...s, text: translated, language: speechCaptionLanguage } : s;
        });
        await session.updateEpisodeSpeech(episodeInput.assetId, speechForSession);
      }

      setGenerationStep('Preparando recursos e evidências da montagem...');
      setGenerationProgress(38);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const effectiveUseSfx = useSfx && sfxMode !== 'off';
      if (effectiveUseSfx) {
        try {
          sfxAssets = await session.ensureSfx();
        } catch (e) {
          sfxError = (e as Error).message;
        }
      }

      if (suggestedMatches) {
        effectiveLyricSceneMatches = { ...effectiveLyricSceneMatches };
        for (const [scene, cues] of Object.entries(suggestedMatches)) effectiveLyricSceneMatches[scene] = { ...(effectiveLyricSceneMatches[scene] ?? {}), ...cues };
      }
      const opts: GenerateOptions = {
        autonomous: isAutonomous,
        useSfx: effectiveUseSfx,
        sfxMode,
        animeHitAudio: true,
        sfxAssets,
        style: selectedStyle,
        intensity,
        durationS: duration,
        musicStartS: chosenStart,
        lyrics: resolvedLyrics,
        lyricSceneMatches: effectiveLyricSceneMatches,
        lyricStyle,
        lyricDisplayMode: musicDriveMode === 'lyric-kinetic' ? 'kinetic-words' : 'rhythmic-phrases',
        speechTranslations,
        speechTranslationLanguage: speechCaptionLanguage,
        useSpeech: effectiveVoiceMoments > 0,
        voiceMoments: effectiveVoiceMoments,
        voiceLang,
        speechVisualMode: isAutonomous ? 'hybrid' : speechVisualMode,
        useEffects: isAutonomous ? true : useEffects,
        showText,
        showSpeechCaptions,
        depthCutoutOnDrop: isAutonomous ? true : depthCutoutOnDrop,
        seed: nextSeed,
        exclude: excluded,
        focus: isAutonomous ? 'fight' : focus,
        sequenceIds: seqIds,
        hitSync: isAutonomous ? true : hitSync,
        adaptiveSpeed: isAutonomous ? true : adaptiveSpeed,
        beatOffsetMs,
        characters,
        organizationMode: isAutonomous ? 'narrative' : organizationMode,
        editorialDirection: isAutonomous ? 'hype' : editorialDirection,
        creativeEmphasis: creativeEmphasis({ actionEmphasis, emotionEmphasis, preferredEmotion: preferredEmotion || null }),
      };
      const m = musics.find((a) => a.id === musicId)!;
      setGenerationStep(
        isAutonomous
          ? 'Modo Livre · Avaliando 5 montagens completas e auto-reparando a melhor...'
          : 'Avaliando variações candidatas e auto-reparando a melhor...',
      );
      setGenerationProgress(56);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const tournament = generateBestAmv({
        project: session.project,
        music: { assetId: m.id, name: m.name, analysis: music },
        episodes: directorInputs,
        options: opts,
        candidateCount: isAutonomous ? 5 : 3,
      });
      const r = tournament.winner.generated;
      const brief = tournament.winner.brief;
      const editorialReview = tournament.winner.review;
      r.warnings.push(...automaticSpeechWarnings);
      r.warnings = [...new Set(r.warnings)];
      setGenerationProgress(76);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Passe de segurança pós-geração: garante que NENHUMA fala ou letra apareça no idioma errado na timeline.
      const pendingSpeechClips = showText && speechCaptionLanguage !== 'original'
        ? r.commands.flatMap((cmd) => (
            cmd.type === 'clip.add'
            && cmd.clip.text
            && cmd.clip.reason?.startsWith('Legenda da fala')
            && cmd.clip.text.textSource !== 'translation'
              ? [cmd.clip]
              : []
          ))
        : [];
      const pendingLyricClips = showText && translateLyricsToPt && !lyricsTranslatedToPt
        ? r.commands.flatMap((cmd) => (
            cmd.type === 'clip.add'
            && cmd.clip.text
            && (cmd.clip.reason?.startsWith('Letra da música') || cmd.clip.reason?.startsWith('Palavra da letra'))
            && cmd.clip.text.textSource !== 'translation'
              ? [cmd.clip]
              : []
          ))
        : [];
      const translateGeneratedClips = async (clipsToFix: Clip[], targetLangCode: string, targetLangName: string) => {
        if (!clipsToFix.length || !platform) return;
        const postAbort = new AbortController();
        transcriptionAbort.current = postAbort;
        setGenerationStep(`Garantindo legendas em ${targetLangName}...`);
        setGenerationProgress(82);
        try {
          const res = await translateTextsAuto(
            platform,
            clipsToFix.map((clip) => clip.text!.original ?? clip.text!.text),
            targetLangName,
            { batchSize: 20, signal: postAbort.signal },
          );
          res.translations.forEach((value, idx) => {
            const translatedRaw = value?.trim();
            const clip = clipsToFix[idx]!;
            const textObj = clip.text;
            if (!translatedRaw || !textObj) return;
            const origRaw = textObj.original ?? textObj.text;
            const wasUpper = textObj.text === textObj.text.toUpperCase() && /[A-Z]/.test(textObj.text);
            const finalDisplay = wasUpper ? translatedRaw.toUpperCase() : translatedRaw;
            const tokens = finalDisplay.trim().match(/\S+/gu) ?? [];
            let rebuiltWordTimings = textObj.wordTimings;
            if (textObj.wordTimings.length > 0 && tokens.length >= 2) {
              const durUs = Math.max(40_000, clip.durationUs);
              const weights = tokens.map((tok) => Math.max(1, Array.from(tok).length + 1));
              const totalWeight = weights.reduce((acc, w) => acc + w, 0);
              let cursorUs = 0;
              rebuiltWordTimings = tokens.map((token, tIdx) => {
                const shareUs = Math.round((weights[tIdx]! / totalWeight) * durUs);
                const startUs = cursorUs;
                const endUs = tIdx === tokens.length - 1 ? durUs : Math.min(durUs, Math.max(startUs + 20_000, startUs + shareUs));
                cursorUs = endUs;
                return {
                  text: token,
                  startUs,
                  endUs,
                  source: 'estimated' as const,
                  confidence: 0.9,
                  uncertain: false,
                  color: null,
                  scale: null,
                  offsetX: null,
                  offsetY: null,
                  weight: null,
                  syllables: [],
                };
              });
            }
            clip.text = {
              ...textObj,
              text: finalDisplay,
              original: origRaw,
              lang: targetLangCode,
              textSource: 'translation',
              translations: { ...textObj.translations, [targetLangCode]: finalDisplay },
              wordTimings: rebuiltWordTimings,
              timingPrecision: rebuiltWordTimings.length ? 'word' : textObj.timingPrecision,
            };
          });
        } finally {
          transcriptionAbort.current = null;
        }
      };
      if (pendingSpeechClips.length) {
        await translateGeneratedClips(pendingSpeechClips, speechCaptionLanguage, targetLanguage[speechCaptionLanguage] ?? speechCaptionLanguage);
      }
      if (pendingLyricClips.length) {
        await translateGeneratedClips(pendingLyricClips, 'pt-BR', 'português brasileiro');
      }
      const issueCounts = qualityIssueSummary(editorialReview.quality.issues);
      if (localVisionPending > 0) {
        r.warnings.push('Análise visual local concluída: ' + localVisionAnalyzed + ' cenas analisadas; ' + localVisionFailed + ' sem resultado; ' + localFrameFailures + ' falhas de extração.');
      }
      if (semanticVisionResult) {
        r.warnings.push('Análise semântica por visão: ' + semanticVisionResult.labeled + ' cenas rotuladas; ' + semanticVisionResult.failed + ' falhas de resposta; ' + semanticVisionResult.frameFailures + ' falhas de extração.');
      }
      if (sfxError) r.warnings.push('Efeitos sonoros indisponíveis (' + sfxError + ').');
      setGenerationProgress(90);
      // guarda o que estava antes: nada se perde
      await session.saveVersion(`Antes de gerar (${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`);
      const effectiveStyleId = tournament.winner.options.style;
      const effectiveDir = tournament.winner.options.editorialDirection ?? editorialDirection;
      const directionLabel = effectiveDir === 'cinematic' ? 'Cinematográfico' : effectiveDir === 'hype' ? 'Hype' : 'Balanceado';
      const label = isAutonomous
        ? `Modo Livre · ${STYLES.find((s) => s.id === effectiveStyleId)!.label} (${tournament.winner.score.total.toFixed(0)}/100)`
        : `${directionLabel} · ${styleMode === 'auto' ? 'Aberto · ' : ''}${STYLES.find((s) => s.id === selectedStyle)!.label}`;
      session.history.transaction(`Gerar meu AMV — ${label}`, r.commands);
      useEditor.getState().setPlayhead(0);
      useEditor.getState().setPlaying(false);
      try {
        getPlayer(session).seek(0);
      } catch {}
      setSeed(nextSeed);
      const s = r.summary;
      const coverageValues = Object.values(editorialReview.quality.coverage);
      const directionText = [...new Set(s.direction.map((beat) => beat.role))].map((role) =>
        role === 'opening' ? 'Abertura'
          : role === 'build' ? 'Crescimento'
            : role === 'climax' ? 'Clímax'
              : role === 'release' ? 'Respiro'
                : role === 'ending' ? 'Encerramento'
                  : 'Desenvolvimento',
      ).join(' → ');
      const summaryText = s.clips + ' cenas, ' + s.cuts + ' cortes'
        + (s.drop !== null ? ', drop em ' + s.drop.toFixed(1) + ' s' : '')
        + (s.voices ? ', ' + s.voices + ' fala(s)' + (s.speech ? ' (começando por "' + s.speech + '")' : '') : '')
        + '. Trecho da música: ' + mmss(s.musicRange[0]) + '–' + mmss(s.musicRange[1])
        + '. Estrutura musical: ' + directionText + '.'
        + (s.focus === 'fight' && s.fights.length ? ' Luta usada: ' + s.fights.join(' + ') + '.' : s.focus === 'mix' ? ' Cenas de vários pontos (modo misturar).' : '')
        + (s.hitsSynced ? ' ' + s.hitsSynced + ' golpes encaixados na batida.' : '')
        + (s.speedRamps ? ' ' + s.speedRamps + ' rampas de velocidade aplicadas.' : '')
        + (s.sfx ? ' ' + s.sfx + ' efeitos sonoros.' : '');
      setResult({
        warnings: r.warnings,
        text: summaryText,
        brief,
        storyboard: editorialReview.storyboard,
        alignment: editorialReview.alignment,
        review: {
          ...issueCounts,
          checked: coverageValues.filter((item) => item.status === 'checked').length,
          partial: coverageValues.filter((item) => item.status === 'partial').length,
          unavailable: coverageValues.filter((item) => item.status === 'unavailable').length,
          repairsApplied: editorialReview.repairsApplied,
          issues: editorialReview.quality.issues.slice(0, 8).map((issue) => ({
            startUs: issue.startUs,
            severity: issue.severity,
            type: issue.type,
            suggestion: issue.suggestion,
          })),
        },
        tournament: {
          score: tournament.winner.score,
          candidatesEvaluated: tournament.candidatesEvaluated,
          winnerLabel: tournament.winner.label,
          unifiedHighlights: tournament.unifiedHighlights,
        },
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        toast({ tone: 'info', title: 'Geração cancelada', body: 'A montagem não foi aplicada.' });
      } else {
        toast({ tone: 'error', title: 'Não deu para gerar', body: (e as Error).message });
      }
    } finally {
      visionAbort.current = null;
      transcriptionAbort.current = null;
      setBusy(false);
      setGenerationStep(null);
      setGenerationProgress(0);
    }
  };

  const selectedCandidate = localizedCandidates.find((candidate) => candidate.id === selectedCandidateId);
  const candidateIsCurrent = !!selectedCandidate
    && session.project === selectedCandidate.baseProject
    && session.history.version === selectedCandidate.baseRevision;
  const applyLocalizedCandidate = async () => {
    if (!selectedCandidate) return;
    if (!candidateIsCurrent) {
      toast({ tone: 'warn', title: 'A timeline mudou', body: 'Gere uma nova alternativa antes de aplicar para evitar sobrescrever edições recentes.' });
      return;
    }
    setBusy(true);
    let snapshot: Awaited<ReturnType<ProjectSession['createVersionSnapshot']>> | null = null;
    let committed = false;
    try {
      const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      snapshot = await session.createVersionSnapshot(`Antes de regenerar trecho (${time})`, selectedCandidate.baseProject);
      if (session.project !== selectedCandidate.baseProject || session.history.version !== selectedCandidate.baseRevision) {
        throw new Error('A timeline mudou enquanto a alternativa era preparada. Nada foi aplicado; gere outra alternativa.');
      }
      session.history.transaction('Regenerar trecho do AMV', [
        { type: 'version.add', version: snapshot },
        ...selectedCandidate.commands,
      ]);
      committed = true;
      toast({ tone: 'ok', title: 'Trecho regenerado', body: 'A alteração é um único passo de undo; a versão anterior está em Versões.' });
      onClose();
    } catch (error) {
      let detail = error instanceof Error ? error.message : String(error);
      if (snapshot && !committed) {
        try {
          await session.removeVersionSnapshot(snapshot.file);
        } catch (cleanupError) {
          detail += ` Também não foi possível limpar o snapshot temporário: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
        }
      }
      toast({ tone: 'error', title: 'Não foi possível aplicar a regeneração', body: detail });
    } finally {
      setBusy(false);
      setGenerationStep(null);
      setGenerationProgress(0);
    }
  };

  const recs = library ? recommend(library.lib, STYLE_THEME[selectedStyle] ?? 'motivacao', { limit: 3, targetDurationS: duration, sceneFit: plan?.fit }) : [];
  const addFromLibrary = async (trackId: string) => {
    try {
      const t = library?.track(trackId);
      if (!t) throw new Error('A faixa não está mais disponível na biblioteca.');
      await session.importFiles([t.path]);
      const a = session.project.assets.find((x) => x.hash === t.hash);
      if (!a) throw new Error('A faixa foi importada, mas não apareceu no projeto.');
      setMusicId(a.id);
      library?.markUsed(t.id, project.name);
    } catch (error) {
      toast({ tone: 'error', title: 'Não foi possível adicionar a música', body: (error as Error).message });
    }
  };

  const toggleEp = (id: string) => setEpIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  if (localizedRange && candidateMode && selectedCandidate) {
    const frameTimeUs = selectedCandidate.startUs
      + Math.round((selectedCandidate.endUs - selectedCandidate.startUs) * compareFraction);
    const previousClips = selectedCandidate.baseProject.clips.filter((clip) =>
      selectedCandidate.replaceClipIds.includes(clip.id)
      && clip.timelineStartUs < selectedCandidate.endUs
      && clipEndUs(clip) > selectedCandidate.startUs,
    );
    const replacementClips = selectedCandidate.addedClipIds.flatMap((id) => {
      const clip = selectedCandidate.previewProject.clips.find((item) => item.id === id);
      return clip ? [clip] : [];
    });
    const clipSummary = (clip: Clip, sourceProject: Project) => {
      const asset = sourceProject.assets.find((item) => item.id === clip.assetId);
      const start = Math.max(selectedCandidate.startUs, clip.timelineStartUs);
      const end = Math.min(selectedCandidate.endUs, clipEndUs(clip));
      return `${mmss(start / S)}–${mmss(end / S)} · ${asset?.name ?? clip.text?.text ?? 'clipe'}${clip.reason ? ` — ${clip.reason}` : ''}`;
    };
    return (
      <Dialog
        title="Comparar alternativa do trecho"
        onClose={onClose}
        width="w-[900px]"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCandidateMode(false)}>Ajustar opções</Button>
            <Button icon={<Wand2 size={15} />} disabled={busy} onClick={() => void generate(seed + 1)}>
              Gerar outra alternativa
            </Button>
            <Button variant="primary" disabled={busy || !candidateIsCurrent} onClick={() => void applyLocalizedCandidate()}>
              Substituir seleção
            </Button>
          </>
        }
      >
        <p className="mb-3 text-xs text-muted">
          Substitui apenas os clipes de vídeo selecionados, preservando áudio e legendas.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-soft">Alternativas:</span>
          {localizedCandidates.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={candidate.id === selectedCandidate.id}
              className={`rounded border px-2 py-1 text-xs ${candidate.id === selectedCandidate.id ? 'border-violet bg-violet/10 text-ink' : 'border-line text-muted hover:bg-raised'}`}
              onClick={() => setSelectedCandidateId(candidate.id)}
            >
              {index + 1} · semente {candidate.seed}
            </button>
          ))}
          <span className="ml-auto text-2xs text-muted">{selectedCandidate.replaced} selecionado(s) · {selectedCandidate.added} clipe(s) novo(s)</span>
        </div>
        <RegenerationCompare
          session={session}
          before={selectedCandidate.baseProject}
          after={selectedCandidate.previewProject}
          timeUs={frameTimeUs}
        />
        <div className="mt-3 flex gap-2">
          {[0, 0.5, 1].map((fraction) => (
            <Button key={fraction} size="sm" aria-pressed={compareFraction === fraction} onClick={() => setCompareFraction(fraction)}>
              {fraction === 0 ? 'Início' : fraction === 0.5 ? 'Meio' : 'Fim'}
            </Button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <section>
            <h3 className="mb-1 text-xs font-semibold text-ink-soft">Antes · {previousClips.length} clipe(s)</h3>
            <ul className="max-h-28 space-y-1 overflow-y-auto text-2xs text-muted">
              {previousClips.map((clip) => <li key={clip.id}>{clipSummary(clip, selectedCandidate.baseProject)}</li>)}
            </ul>
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold text-ink-soft">Alternativa · {replacementClips.length} clipe(s)</h3>
            <ul className="max-h-28 space-y-1 overflow-y-auto text-2xs text-muted">
              {replacementClips.map((clip) => <li key={clip.id}>{clipSummary(clip, selectedCandidate.previewProject)}</li>)}
            </ul>
          </section>
        </div>
        {selectedCandidate.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-md border border-warn/30 bg-warn/10 p-3 text-xs text-ink-soft">
            {selectedCandidate.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}
        {!candidateIsCurrent && (
          <p role="status" className="mt-3 rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
            O projeto mudou depois desta alternativa. Ela não pode ser aplicada; volte às opções e gere outra.
          </p>
        )}
      </Dialog>
    );
  }

  if (result) {
    return (
      <Dialog
        title="AMV gerado"
        onClose={onClose}
        width="w-[720px]"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResult(null)}>
              Mudar opções
            </Button>
            <Button icon={<Wand2 size={15} />} disabled={busy} onClick={() => generate(seed + 7)}>
              Gerar outra versão
            </Button>
            <Button variant="primary" onClick={() => {
              useEditor.getState().setPlayhead(0);
              try {
                getPlayer(session).seek(0);
              } catch {}
              onClose();
            }}>
              Editar na timeline
            </Button>
          </>
        }
      >
        <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
          <div>
            <p className="text-sm text-ink">{result.text}</p>
            <p className="mt-1 text-2xs text-muted">Ctrl+Z desfaz; versão anterior salva em Versões.</p>
          </div>

          {result.tournament && (
            <section className="rounded-md border border-violet/40 bg-violet/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-violet-strong" />
                  <h3 className="text-xs font-semibold text-ink">{result.tournament.winnerLabel}</h3>
                </div>
                <span className="tnum rounded-full border border-violet/50 bg-base/80 px-2.5 py-0.5 text-xs font-bold text-violet-strong">
                  {result.tournament.score.total.toFixed(0)}/100
                </span>
              </div>
              <div className="mt-2 grid grid-cols-5 gap-1.5 text-center text-[10px]">
                <div className="rounded bg-base/70 px-1.5 py-1">
                  <span className="block text-muted">Técnica</span>
                  <strong className="tnum text-ink">{result.tournament.score.technical}/28</strong>
                </div>
                <div className="rounded bg-base/70 px-1.5 py-1">
                  <span className="block text-muted">Sincronia</span>
                  <strong className="tnum text-ink">{result.tournament.score.sync}/24</strong>
                </div>
                <div className="rounded bg-base/70 px-1.5 py-1">
                  <span className="block text-muted">Diversidade</span>
                  <strong className="tnum text-ink">{result.tournament.score.diversity}/20</strong>
                </div>
                <div className="rounded bg-base/70 px-1.5 py-1">
                  <span className="block text-muted">Arco 3 atos</span>
                  <strong className="tnum text-ink">{result.tournament.score.narrative}/16</strong>
                </div>
                <div className="rounded bg-base/70 px-1.5 py-1">
                  <span className="block text-muted">Fusão</span>
                  <strong className="tnum text-ink">{result.tournament.score.multimodal}/12</strong>
                </div>
              </div>
              {result.tournament.unifiedHighlights.length > 0 && (
                <ul className="mt-2 space-y-1 text-2xs text-ink-soft">
                  {result.tournament.unifiedHighlights.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="rounded-md border border-line-soft p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-ink">Revisão &amp; Auto-reparo · {result.brief.title}</h3>
              <span className="text-2xs text-muted">{result.review.high} críticos · {result.review.medium} médios · {result.review.low} leves</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-2xs text-muted">
              <span className="rounded bg-raised px-2 py-0.5">{result.brief.preferences.durationS}s</span>
              <span className="rounded bg-raised px-2 py-0.5">{result.brief.evidence.scenes} cenas</span>
              <span className="rounded bg-raised px-2 py-0.5">{result.brief.evidence.bpmConfidence}% BPM</span>
            </div>
            {result.review.repairsApplied.length > 0 && (
              <p className="mt-2 rounded bg-ok/10 px-2 py-1 text-xs text-ok">Auto-corrigido: {result.review.repairsApplied.join(' · ')}</p>
            )}
            {result.review.issues.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-ink-soft">
                {result.review.issues.map((issue, index) => (
                  <li key={issue.startUs + ':' + issue.type + ':' + index}>
                    <span className="tnum text-muted">{mmss(issue.startUs / S)}</span> · <strong>{issue.type}</strong> — {issue.suggestion}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-ink-soft">Nenhum problema objetivo pendente.</p>
            )}
          </section>

          <details className="rounded-md border border-line-soft p-2.5 text-xs">
            <summary className="cursor-pointer font-medium text-ink-soft">Storyboard e detalhes ({result.storyboard.length} partes)</summary>
            <ol className="mt-2 space-y-1.5">
              {result.storyboard.slice(0, 7).map((beat, index) => (
                <li key={beat.role + ':' + beat.startS + ':' + index} className="rounded border border-line-soft p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{index + 1}. {beat.label}</span>
                    <span className="tnum text-2xs text-muted">{mmss(beat.startS)}–{mmss(beat.endS)}</span>
                  </div>
                  {beat.scenes.length > 0 && (
                    <p className="mt-1 truncate text-2xs text-muted">
                      {beat.scenes.slice(0, 3).map((s) => `${s.source} (${mmss(s.sourceTimeS)})`).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </details>
        </div>
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
      title={localizedRange ? 'Regenerar intervalo selecionado' : 'Gerar meu AMV'}
      onClose={onClose}
      width="w-[1240px]"
      footer={
        <>
          <span className={`mr-auto self-center text-xs ${analysisFailures.length ? 'text-warn' : 'text-muted'}`}>
            {analysisFailures.length
              ? `${analysisFailures.length} análise(s) falharam; tente novamente ou desmarque o arquivo.`
              : waiting > 0
                ? `Analisando ${waiting} arquivo(s) selecionado(s)…`
                : `${sceneCount} cenas analisadas · ${ready.length} episódio(s) selecionado(s)`}
          </span>
          {analysisFailures.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title={analysisFailures.map((failure) => `${failure.name}: ${failure.error}`).join('\n')}
              onClick={() => analysisFailures.forEach((failure) => session.retry(failure.id))}
            >
              Tentar análise novamente
            </Button>
          )}
          {localizedRange && localizedCandidates.length > 0 && (
            <Button variant="ghost" disabled={busy} onClick={() => setCandidateMode(true)}>
              Comparar alternativas ({localizedCandidates.length})
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon={<Wand2 size={15} />} disabled={!music || ready.length === 0 || !analysisReadiness.canGenerate || busy || lyricsSyncing || (localizedRange !== undefined && localizedRange.clipIds.length === 0)} onClick={() => void generate(seed)}>
            {localizedRange ? 'Gerar alternativa' : directorMode === 'autonomous' ? 'Gerar melhor AMV' : 'Gerar e revisar'}
          </Button>
        </>
      }
    >
      {busy && generationStep && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-lg bg-base/85 backdrop-blur-sm p-6 text-center">
          <div className="relative mb-4 flex items-center justify-center">
            <div className="h-14 w-14 rounded-full border-2 border-violet/30 border-t-violet animate-spin" />
            <Sparkles size={20} className="absolute text-violet-strong" />
          </div>
          <h4 className="text-sm font-semibold text-ink">Direção criativa e revisão do AMV</h4>
          <p className="mt-1 text-xs font-medium text-violet-strong transition-all duration-200">{generationStep}</p>
          <div className="mt-4 h-1.5 w-64 overflow-hidden rounded-full border border-line bg-base">
            <div
              className="h-full bg-gradient-to-r from-violet to-violet-strong transition-all duration-300"
              style={{ width: `${generationProgress}%` }}
            />
          </div>
          {(generationStep.startsWith('Sincronizando a letra')
            || generationStep.startsWith('Analisando música')
            || generationStep.startsWith('Traduzindo a letra')
            || generationStep.startsWith('Analisando cenas')
            || generationStep.startsWith('Análise semântica profunda')
            || generationStep.startsWith('Preparando análise semântica')
            || generationStep.startsWith('Entendendo as falas do anime')
            || generationStep.startsWith('Transcrevendo fala')
            || generationStep.startsWith('Extraindo áudio')
            || generationStep.startsWith('Reconhecendo falas')
            || generationStep.startsWith('Traduzindo as falas')
            || generationStep.startsWith('Garantindo legendas')) && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-3"
              onClick={() => {
                visionAbort.current?.abort();
                transcriptionAbort.current?.abort();
              }}
            >
              Cancelar etapa
            </Button>
          )}
        </div>
      )}
      {localizedRange && (
        <div className="mb-4 rounded-control border border-violet/30 bg-violet/5 p-3">
          <p className="text-sm font-semibold text-ink">Regenerar trecho selecionado</p>
          <p className="mt-1 text-xs text-ink-soft">
            Substitui apenas os clipes de vídeo selecionados; música, falas e legendas permanecem intactas.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted">
              Início (s)
              <input
                type="number"
                min={0}
                step={0.01}
                className="mt-1 block h-8 w-28 rounded-control border border-line bg-base px-2 text-sm text-ink"
                value={localizedStartS}
                onChange={(event) => setLocalizedStartS(Number(event.target.value))}
              />
            </label>
            <label className="text-xs text-muted">
              Fim (s)
              <input
                type="number"
                min={0}
                step={0.01}
                className="mt-1 block h-8 w-28 rounded-control border border-line bg-base px-2 text-sm text-ink"
                value={localizedEndS}
                onChange={(event) => setLocalizedEndS(Number(event.target.value))}
              />
            </label>
            <span className="pb-2 text-xs text-muted">
              Duração: {Math.max(0, localizedEndS - localizedStartS).toFixed(2)} s · {localizedRange.clipIds.length} clipe(s) selecionado(s)
            </span>
          </div>
          {localizedCandidates.length > 0 && (
            <p className="mt-2 text-2xs text-muted">As alternativas existentes ficam vinculadas ao intervalo e à versão do projeto em que foram geradas; se a timeline mudar, gere uma nova.</p>
          )}
        </div>
      )}
      {!localizedRange && episodes.length > 0 && (musics.length > 0 || recs.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet/30 bg-violet/5 p-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={directorMode === 'autonomous'}
              onClick={() => setDirectorMode('autonomous')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${directorMode === 'autonomous' ? 'bg-violet text-white shadow-sm' : 'text-ink-soft hover:bg-raised'}`}
            >
              <Sparkles size={13} />
              Modo Livre · Diretor Mestre
            </button>
            <button
              type="button"
              aria-pressed={directorMode === 'manual'}
              onClick={() => setDirectorMode('manual')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${directorMode === 'manual' ? 'bg-raised font-semibold text-ink border border-line' : 'text-muted hover:text-ink'}`}
            >
              Personalizar Manualmente
            </button>
          </div>
          <span className="text-2xs text-ink-soft">
            {directorMode === 'autonomous'
              ? 'Unifica batida, tipografia mesclada ao vídeo, falas, recortes e golpes, testa 5 variações e entrega a melhor.'
              : 'Ajuste manual completo de estilo, tipografia fixa, cadência e ênfases.'}
          </span>
        </div>
      )}
      {episodes.length === 0 || (musics.length === 0 && !recs.length) ? (
        <p className="text-sm text-ink-soft">Importe pelo menos <b>uma música</b> e <b>um episódio</b>.</p>
      ) : !localizedRange && directorMode === 'autonomous' ? (
        <div className="grid max-h-[calc(100vh-255px)] grid-cols-1 gap-5 overflow-y-auto pr-1 md:grid-cols-2">
          {/* Modo Livre — Coluna 1: Música, Duração e Letra */}
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-soft">1. Música</p>
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
              {music && musicMapRange && <MusicalMap analysis={music} range={musicMapRange} />}
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink-soft">Duração do AMV</p>
                <div className="flex flex-wrap gap-1">
                  {DURATIONS.map((d) => (
                    <button key={d} type="button" onClick={() => setDuration(d)} className={`tnum rounded-control border px-2.5 py-1 text-xs ${duration === d ? 'border-violet bg-violet/15 font-semibold text-ink' : 'border-line text-muted hover:text-ink'}`}>
                      {d} s
                    </button>
                  ))}
                </div>
              </div>
              {ranges.length > 0 && (
                <label className="text-xs text-ink-soft">
                  Trecho da música
                  <select
                    className="mt-1 block h-8 rounded-control border border-line bg-base px-2 text-xs text-ink"
                    value={chosenStart === null ? 'auto' : String(chosenStart)}
                    onChange={(e) => setMusicStart(e.target.value === 'auto' ? null : Number(e.target.value))}
                  >
                    <option value="auto">Automático (melhor drop + clímax)</option>
                    {ranges.map((r) => (
                      <option key={r.startS} value={String(r.startS)}>
                        {mmss(r.startS)}–{mmss(r.endS)} ({Math.round(r.score * 100)}%)
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="space-y-2 rounded-control border border-line-soft p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink-soft">Letra da música (opcional)</p>
                <span className="rounded bg-violet/15 px-2 py-0.5 text-[10px] font-medium text-violet-strong">
                  {lyrics ? `${lyrics.cues.length} linhas prontas` : 'Tipografia dinâmica por seção'}
                </span>
              </div>
              <textarea
                disabled={lyricsSyncing}
                className="min-h-16 w-full resize-y rounded-control border border-line bg-base p-2 text-xs text-ink placeholder:text-faint"
                value={lyricDraft}
                onChange={(event) => {
                  setLyricDraft(event.target.value);
                  setLyrics(null);
                  setLyricSceneMatches({});
                }}
                placeholder="Deixe vazio para extrair automaticamente da música, ou cole a letra / .LRC aqui..."
                rows={3}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="secondary" disabled={lyricsSyncing || !selectedMusic} onClick={() => void extractLyricsFromMusic()}>
                  {lyricsSyncing ? `${Math.round((lyricsSyncProgress?.progress ?? 0) * 100)}%` : 'Extrair da música'}
                </Button>
                <Button size="sm" disabled={!lyricDraft.trim() || lyricsSyncing || !selectedMusic} onClick={() => void syncWrittenLyrics()}>
                  Sincronizar
                </Button>
                <Button size="sm" variant="ghost" disabled={lyricsSyncing} onClick={pickLyrics}>.LRC / .SRT</Button>
                {lyricsSyncing && <Button size="sm" variant="ghost" onClick={() => transcriptionAbort.current?.abort()}>Cancelar</Button>}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
                  <input type="checkbox" className="accent-violet" checked={autoExtractMusicLyrics} disabled={lyricsSyncing} onChange={(e) => setAutoExtractMusicLyrics(e.target.checked)} />
                  Extrair da música automaticamente
                </label>
                <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
                  <input type="checkbox" className="accent-violet" checked={translateLyricsToPt} disabled={lyricsSyncing} onChange={(e) => setTranslateLyricsToPt(e.target.checked)} />
                  Traduzir para PT-BR
                </label>
              </div>
            </div>
          </div>

          {/* Modo Livre — Coluna 2: Episódios & Diretor Autônomo Unificado */}
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-medium text-ink-soft">2. Episódios</p>
                <span className="flex gap-2">
                  <button type="button" className="text-2xs text-muted underline hover:text-ink" onClick={() => setEpIds(episodes.map((episode) => episode.id))}>Todos</button>
                  <button type="button" className="text-2xs text-muted underline hover:text-ink" onClick={() => setEpIds([])}>Nenhum</button>
                </span>
              </div>
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-control border border-line-soft p-2">
                {episodes.map((e) => {
                  const a = session.assetRuntime(e.id);
                  const fightsInEpisode = a.episode?.sequences.filter((sequence) => sequence.kind === 'luta').length ?? 0;
                  return (
                    <li key={e.id}>
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" className="accent-violet" checked={epIds.includes(e.id)} onChange={() => toggleEp(e.id)} />
                        <span className="min-w-0 flex-1 truncate">{e.name}</span>
                        <span className="shrink-0 text-2xs text-faint">{a.episode ? `${a.episode.shots.length} cenas · ${fightsInEpisode} lutas` : a.analysis === 'error' ? 'erro' : 'analisando'}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="space-y-2.5 rounded-control border border-violet/35 bg-violet/10 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-semibold text-ink">
                  <Sparkles size={14} className="text-violet-strong" />
                  O que o Diretor Mestre vai unificar
                </span>
                <span className="rounded bg-base/80 px-2 py-0.5 text-[10px] font-semibold text-violet-strong">
                  Torneio de 5 candidatos
                </span>
              </div>
              <ul className="space-y-1 text-2xs text-ink-soft">
                <li>• <strong>Rigor visual rápido:</strong> filtra créditos, fumaça vazia e clones visuais por assinatura espacial em paralelo.</li>
                <li>• <strong>Tipografia viva em 3 atos:</strong> versos editoriais na intro → katana/neon na subida → <em>blend</em> vazado + recorte V2 de personagem no drop.</li>
                <li>• <strong>Áudio &amp; Fala integrados:</strong> {fights.length > 0 ? `${fights.length} luta(s) detectada(s) · ` : ''}isolamento vocal nas falas sem atropelar o refrão + sons reais dos golpes cravados na batida.</li>
              </ul>
              <div className="grid grid-cols-1 gap-1.5 border-t border-violet/20 pt-2.5 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input type="checkbox" className="accent-violet" checked={showText} onChange={(e) => setShowText(e.target.checked)} />
                  Letras &amp; legendas mescladas
                </label>
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input type="checkbox" className="accent-violet" checked={autonomousSpeech} onChange={(e) => setAutonomousSpeech(e.target.checked)} />
                  Falas dramáticas dos personagens
                </label>
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    className="accent-violet"
                    checked={useSfx && sfxMode !== 'off'}
                    onChange={(e) => {
                      setUseSfx(e.target.checked);
                      if (e.target.checked && sfxMode === 'off') setSfxMode('hits-only');
                    }}
                  />
                  Sons reais dos golpes &amp; impactos
                </label>
                {hasTwoAudio && autonomousSpeech && (
                  <label className="flex items-center gap-1.5 text-xs text-ink-soft">
                    <span>Voz:</span>
                    <select className="h-7 flex-1 rounded-control border border-line bg-base px-1.5 text-xs text-ink" value={voiceLang} onChange={(e) => setVoiceLang(e.target.value as 'original' | 'pt')}>
                      <option value="original">Original (JP)</option>
                      <option value="pt">Dublagem (PT)</option>
                    </select>
                  </label>
                )}
              </div>
            </div>

            {charList.length > 0 && (
              <div className="rounded-control border border-line-soft p-2.5">
                <p className="mb-1.5 text-xs font-medium text-ink-soft">Filtrar personagens identificados (opcional)</p>
                <div className="flex flex-wrap gap-1.5">
                  {charList.map((c) => {
                    const profile = project.characterLibrary.find((item) =>
                      [item.name, ...item.aliases].some((alias) => normLabel(alias) === normLabel(c.name)),
                    );
                    const canonical = profile?.name ?? c.displayName;
                    const on = characters.some((x) => normLabel(x) === normLabel(canonical));
                    return (
                      <button
                        key={c.name}
                        type="button"
                        aria-pressed={on}
                        className={`rounded-full border px-2.5 py-0.5 text-2xs ${on ? 'border-violet bg-violet/20 font-medium text-ink' : 'border-line text-ink-soft hover:border-violet'}`}
                        onClick={() => setCharacters((xs) => (on ? xs.filter((x) => normLabel(x) !== normLabel(canonical)) : [...xs, canonical]))}
                      >
                        {canonical} <span className="text-faint">{c.shots}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="generate-options grid max-h-[calc(100vh-255px)] gap-5 overflow-y-auto pr-1">
          {/* Coluna 1 — Música primeiro: ritmo, modo musical e letra */}
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-soft">1. Música (guia o corte e o ritmo)</p>
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
              {music && musicMapRange && <MusicalMap analysis={music} range={musicMapRange} />}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-soft">Modo guiado pela música</p>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  ['lyric-kinetic', 'Batida + Letra Cinética', '1–2 palavras no centro · cortes na batida'],
                  ['pure-rhythm', 'Puro Ritmo & Batida', 'Cortes rápidos/drop sem depender de texto'],
                  ['lyric-verse', 'Batida + Versos', 'Versos completos sincronizados na cena'],
                  ['narrative-climax', 'História + Clímax', 'Arco progressivo guiado pelas seções'],
                ] as const).map(([mode, title, sub]) => {
                  const active = musicDriveMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={active}
                      onClick={() => applyMusicDriveMode(mode)}
                      className={`rounded-md border px-2.5 py-2 text-left transition-colors ${active ? 'border-violet bg-violet/15 text-ink' : 'border-line text-ink-soft hover:bg-raised'}`}
                    >
                      <span className="block text-xs font-semibold">{title}</span>
                      <span className="mt-0.5 block text-[10px] text-muted">{sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {!localizedRange && (
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
            )}

            {ranges.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink-soft">Trecho da música</p>
                <ul className="space-y-1">
                  <li>
                    <label className="flex items-start gap-2 text-xs">
                      <input type="radio" name="mrange" className="mt-0.5 accent-violet" checked={chosenStart === null} onChange={() => setMusicStart(null)} />
                      <span>Automático</span>
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
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2 rounded-control border border-line-soft p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink-soft">Letra & Tipografia</p>
                {lyrics && <span className="text-[10px] text-violet-strong">{lyrics.cues.length} linhas prontas</span>}
              </div>
              <textarea
                disabled={lyricsSyncing}
                className="min-h-20 w-full resize-y rounded-control border border-line bg-base p-2 text-xs text-ink placeholder:text-faint"
                value={lyricDraft}
                onChange={(event) => {
                  setLyricDraft(event.target.value);
                  setLyrics(null);
                  setLyricSceneMatches({});
                }}
                placeholder="Cole a letra (ou deixe vazio para extrair automaticamente)..."
                rows={4}
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="secondary" disabled={lyricsSyncing || !selectedMusic} onClick={() => void extractLyricsFromMusic()}>
                  {lyricsSyncing ? `${Math.round((lyricsSyncProgress?.progress ?? 0) * 100)}%` : 'Extrair da música'}
                </Button>
                <Button size="sm" disabled={!lyricDraft.trim() || lyricsSyncing || !selectedMusic} onClick={() => void syncWrittenLyrics()}>
                  Sincronizar
                </Button>
                <Button size="sm" variant="ghost" disabled={lyricsSyncing} onClick={pickLyrics}>.LRC / .SRT</Button>
                {lyricsSyncing && <Button size="sm" variant="ghost" onClick={() => transcriptionAbort.current?.abort()}>Cancelar</Button>}
              </div>
              <label className="flex items-center gap-2 text-2xs text-ink-soft">
                <input
                  type="checkbox"
                  className="accent-violet"
                  checked={autoExtractMusicLyrics}
                  disabled={lyricsSyncing}
                  onChange={(e) => setAutoExtractMusicLyrics(e.target.checked)}
                />
                Extrair e sincronizar letra automaticamente se vazia
              </label>
              <label className="flex items-center gap-2 text-2xs text-ink-soft">
                <input
                  type="checkbox"
                  className="accent-violet"
                  checked={translateLyricsToPt}
                  disabled={lyricsSyncing}
                  onChange={(e) => setTranslateLyricsToPt(e.target.checked)}
                />
                Traduzir / converter letra para Português (PT-BR)
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] sm:items-stretch">
                <div className="flex flex-col justify-between gap-1.5">
                  <label className="flex flex-col gap-1 text-2xs text-ink-soft">
                    <span>Tipografia da letra:</span>
                    <select
                      aria-label="Tipografia da letra na geração"
                      value={lyricStyle}
                      onChange={(e) => setLyricStyle(e.target.value as LyricTypographyStyle)}
                      className="h-7 w-full min-w-0 rounded-control border border-line bg-base px-2 text-xs text-ink"
                    >
                      <option value="anime-blend">Anime · mesclado c/ vídeo (vazado/difference)</option>
                      <option value="anime-impact">Anime · impacto (pop + glow)</option>
                      <option value="anime-katana">Anime · katana brush</option>
                      <option value="anime-neon">Anime · neon (ciano elétrico)</option>
                      <option value="anime-gold-epic">Anime · ouro épico (Cinzel dourado)</option>
                      <option value="anime-manga">Anime · mangá (contrastado)</option>
                      <option value="lyrics-cinematic">Letras cinematográficas</option>
                      <option value="anime-dialogue">Discreto (base da tela)</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    {TYPOGRAPHY_PREVIEW_PILLS.map((pill) => {
                      const active = lyricStyle === pill.id;
                      return (
                        <button
                          key={pill.id}
                          type="button"
                          onClick={() => setLyricStyle(pill.id)}
                          title={pill.label}
                          className={`flex flex-col items-center justify-center rounded border px-1 py-1 transition-colors ${active ? 'border-violet bg-violet/20 ring-1 ring-violet/60' : 'border-line-soft bg-base/70 hover:border-line hover:bg-raised'}`}
                        >
                          <TextLookSample look={pill.id} sample={pill.sample} compact fontSizePx={10} />
                          <span className="mt-0.5 max-w-full truncate text-[9px] text-muted">{pill.label.replace(/^Anime · /, '')}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-col justify-between gap-1.5 rounded-control border border-line-soft bg-[#07090e] p-2">
                  <div className="flex items-center justify-between text-[10px] text-faint">
                    <span>Como fica na tela</span>
                    <span className="text-muted">{TYPOGRAPHY_PREVIEW_PILLS.find((p) => p.id === lyricStyle)?.label ?? lyricStyle}</span>
                  </div>
                  <div className="grid min-h-14 flex-1 place-items-center overflow-hidden rounded bg-[radial-gradient(circle_at_center,rgba(90,60,180,0.18),transparent_72%)] px-2 py-2 text-center">
                    <TextLookSample
                      look={lyricStyle}
                      sample={
                        (lyrics?.cues.find((c) => c.text.trim())?.text
                          ?? lyricDraft.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('['))
                          ?? 'MEU PODER É NUNCA DESISTIR!')
                          .replace(/^\[[^\]]+\]\s*/g, '')
                          .trim()
                          .slice(0, 42)
                      }
                    />
                  </div>
                  {(voiceMoments > 0 || style === 'discurso') && showSpeechCaptions && (
                    <div className="flex items-center justify-between gap-2 rounded bg-black/50 px-2 py-1">
                      <span className="shrink-0 text-[9px] text-faint">Fala:</span>
                      <TextLookSample
                        look={lyricStyle === 'anime-dialogue' ? 'anime-impact' : 'anime-dialogue'}
                        sample="Eu nunca vou recuar!"
                        compact
                        fontSizePx={11}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {recs.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-ink-soft">Músicas sugeridas da biblioteca</p>
                <Button size="sm" className="mb-1.5 w-full" onClick={() => void addFromLibrary(recs[0]!.track.id)}>
                  Usar: {displayTitle(recs[0]!.track)}
                </Button>
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
          </div>

          {/* Coluna 2 — Episódios, Cenas e Personagens */}
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-medium text-ink-soft">2. Episódios</p>
                <span className="flex gap-2">
                  <button type="button" className="text-2xs text-muted underline hover:text-ink" onClick={() => setEpIds(episodes.map((episode) => episode.id))}>Todos</button>
                  <button type="button" className="text-2xs text-muted underline hover:text-ink" onClick={() => setEpIds([])}>Nenhum</button>
                </span>
              </div>
              <ul className="max-h-28 space-y-1 overflow-y-auto">
                {episodes.map((e) => {
                  const a = session.assetRuntime(e.id);
                  const fightsInEpisode = a.episode?.sequences.filter((sequence) => sequence.kind === 'luta').length ?? 0;
                  return (
                    <li key={e.id}>
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" className="accent-violet" checked={epIds.includes(e.id)} onChange={() => toggleEp(e.id)} />
                        <span className="min-w-0 flex-1 truncate">{e.name}</span>
                        <span className="shrink-0 text-2xs text-faint">{a.episode ? `${a.episode.shots.length} cenas · ${fightsInEpisode} lutas` : a.analysis === 'error' ? 'erro' : 'analisando'}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-ink-soft">Foco das cenas</p>
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
              {focus === 'fight' && fights.length > 0 && (
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                  {fights.map(({ ep, q }) => {
                    const key = `${ep.assetId}#${q.id}`;
                    return (
                      <li key={key}>
                        <label className="flex items-center gap-2 text-xs">
                          <input type="checkbox" className="accent-violet" checked={seqIds.includes(key)} onChange={() => setSeqIds((xs) => (xs.includes(key) ? xs.filter((x) => x !== key) : [...xs, key]))} />
                          <span className="min-w-0 flex-1 truncate">
                            {ep.name} · {mmss(q.startS)}–{mmss(q.endS)}
                          </span>
                          <span className="tnum text-2xs text-faint">{q.shotCount} · {Math.round(q.intensity * 100)}%</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <label className="mt-2.5 flex items-center gap-2 text-xs">
                <input type="checkbox" className="accent-violet" checked={hitSync} onChange={(e) => setHitSync(e.target.checked)} /> Encaixar golpes na batida
              </label>
              <label className="mt-1.5 flex items-center gap-2 text-xs">
                <input type="checkbox" className="accent-violet" checked={adaptiveSpeed} onChange={(e) => setAdaptiveSpeed(e.target.checked)} /> Rampas de velocidade na ação
              </label>
              <label className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span>Ajuste de sincronia</span>
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
            </div>

            <div className="rounded-control border border-line-soft p-2.5">
              <p className="mb-1.5 text-xs font-medium text-ink-soft">Personagens & Visão</p>
              {charList.length > 0 && (
                <div className="mb-2 space-y-1">
                  {charList.map((c) => {
                    const profile = project.characterLibrary.find((item) =>
                      [item.name, ...item.aliases].some((alias) => normLabel(alias) === normLabel(c.name)),
                    );
                    const canonical = profile?.name ?? c.displayName;
                    const on = characters.some((x) => normLabel(x) === normLabel(canonical));
                    return (
                      <div key={c.name} className="flex items-center gap-1">
                        <button type="button" aria-pressed={on} className={`rounded-full border px-2 py-0.5 text-2xs ${on ? 'border-violet bg-violet/20 text-ink' : 'border-line text-ink-soft hover:border-violet'}`} onClick={() => setCharacters((xs) => (on ? xs.filter((x) => normLabel(x) !== normLabel(canonical)) : [...xs, canonical]))}>
                          {canonical} <span className="text-faint">{c.shots}</span>
                        </button>
                        <input
                          aria-label={`Nome na biblioteca para ${c.name}`}
                          value={characterDrafts[c.name] ?? canonical}
                          onChange={(event) => setCharacterDrafts((drafts) => ({ ...drafts, [c.name]: event.currentTarget.value }))}
                          className="h-6 min-w-0 flex-1 rounded-control border border-line bg-base px-1.5 text-2xs"
                        />
                        <Button size="sm" onClick={() => saveCharacterProfile(c.sources, characterDrafts[c.name] ?? canonical)}>
                          {profile ? 'Salvar' : 'Add'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              {vision ? (
                <div className="flex items-center gap-2 text-2xs text-muted">
                  <span className="tnum">Analisando {vision.ep}: {vision.done}/{vision.total}</span>
                  <Button size="sm" onClick={() => visionAbort.current?.abort()}>Cancelar</Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
                      <input type="radio" name="vision-scope" className="accent-violet" checked={visionScope === 'fights'} onChange={() => setVisionScope('fights')} />
                      Só lutas
                    </label>
                    <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
                      <input type="radio" name="vision-scope" className="accent-violet" checked={visionScope === 'all'} onChange={() => setVisionScope('all')} />
                      Todas as cenas
                    </label>
                  </div>
                  <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
                    <input type="checkbox" className="accent-violet" checked={matchLyrics} disabled={!lyrics?.cues.length} onChange={(e) => setMatchLyrics(e.target.checked)} />
                    Cruzar sentido da letra com IA
                  </label>
                  <label className="flex items-center gap-1.5 text-2xs text-ink-soft">
                    <input type="checkbox" className="accent-violet" checked={deepVisionBeforeGenerate} onChange={(event) => setDeepVisionBeforeGenerate(event.target.checked)} />
                    Análise semântica com IA antes de gerar
                  </label>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {localVisionTodo > 0 && (
                      <Button size="sm" onClick={runLocalVision}>Visão local ({localVisionTodo})</Button>
                    )}
                    {visionTodo > 0 && (
                      <Button size="sm" variant="secondary" onClick={() => { void runVision(); }}>
                        {matchLyrics ? 'IA: cenas + letra' : 'IA: personagens'}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {movementRows.length > 0 && (
                <p className="mt-1.5 text-2xs text-muted">Movimento rastreado em {movementRows.length} cena(s).</p>
              )}
            </div>

            <SceneSuggestions
              session={session}
              inputs={inputs}
              seqIds={seqIds}
              lyrics={lyrics?.cues ?? null}
              musicRange={music ? chooseMusicRange(music, duration, chosenStart) : null}
              onApply={setSuggestedMatches}
            />
          </div>

          {/* Coluna 3 — Estilo, Falas & Direção Criativa */}
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-soft">3. Perfil & Estilo</p>
              <select
                aria-label="Perfil criativo"
                className="h-8 w-full rounded-control border border-line bg-base px-2 text-xs"
                value={activeProfileId}
                onChange={(event) => {
                  const profile = creativeProfiles.find((item) => item.id === event.currentTarget.value);
                  if (profile) applyCreativeProfile(profile);
                  else {
                    setActiveProfileId('');
                    setProfileNameDraft('');
                  }
                }}
              >
                <option value="">Opções atuais</option>
                {creativeProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <input
                  aria-label="Nome do novo perfil criativo"
                  className="h-7 min-w-0 flex-1 rounded-control border border-line bg-base px-2 text-xs"
                  placeholder="Nome do perfil..."
                  value={profileNameDraft}
                  onChange={(event) => setProfileNameDraft(event.currentTarget.value)}
                  disabled={!profilesLoaded || profileStorageError}
                />
                <Button size="sm" onClick={saveNewCreativeProfile} disabled={!profilesLoaded || profileStorageError || !profileNameDraft.trim()}>Salvar</Button>
                {activeProfileIsCustom && (
                  <>
                    <Button size="sm" onClick={updateCreativeProfile} disabled={!profilesLoaded || profileStorageError}>Atualizar</Button>
                    <Button size="sm" variant="ghost" onClick={() => void deleteCreativeProfile()} disabled={!profilesLoaded || profileStorageError}>Excluir</Button>
                  </>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 flex gap-1 rounded-control bg-base p-1">
                <button type="button" aria-pressed={styleMode === 'auto'} onClick={() => setStyleMode('auto')} className={`flex-1 rounded-[4px] px-2 py-1 text-xs ${styleMode === 'auto' ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
                  Automático
                </button>
                <button type="button" aria-pressed={styleMode === 'manual'} onClick={() => setStyleMode('manual')} className={`flex-1 rounded-[4px] px-2 py-1 text-xs ${styleMode === 'manual' ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
                  Manual
                </button>
              </div>
              {styleMode === 'auto' ? (
                <div className="rounded-md border border-violet/40 bg-violet/10 p-2.5">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const Icon = ICONS[selectedStyle];
                      return <Icon size={16} className="shrink-0 text-violet-strong" />;
                    })()}
                    <span className="text-xs font-semibold text-ink">{STYLES.find((item) => item.id === selectedStyle)!.label}</span>
                  </div>
                  {recommendation && <p className="mt-1 text-2xs text-ink-soft">{recommendation.reason}</p>}
                  {smartPreset && (
                    <div className="mt-2 border-t border-violet/20 pt-2">
                      <Button size="sm" variant="primary" className="w-full" onClick={applySmartPreset}>
                        <Sparkles size={12} className="mr-1 inline" />
                        Aplicar Preset Sugerido
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-1">
                  {STYLES.map((s) => {
                    const Icon = ICONS[s.id];
                    const on = style === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setStyle(s.id)}
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left ${on ? 'border-violet bg-violet/10' : 'border-line hover:bg-raised'}`}
                      >
                        <Icon size={15} className={`shrink-0 ${on ? 'text-violet-strong' : 'text-muted'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold">{s.label}</span>
                          <span className="block truncate text-[10px] text-muted">{s.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-medium text-ink-soft">Falas &amp; Efeitos</p>
              <label className="flex items-center justify-between gap-2">
                <span>Falas de anime</span>
                <select className="h-7 rounded-control border border-line bg-base px-1.5 text-xs" value={voiceMoments} onChange={(e) => setVoiceMoments(Number(e.target.value))}>
                  <option value={0}>Nenhuma</option>
                  <option value={1}>1 (antes do drop)</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                  <option value={6}>6</option>
                </select>
              </label>
              {voiceMoments > 0 && selectedStyle !== 'discurso' && (
                <label className="flex items-center justify-between gap-2">
                  <span>Modo das falas</span>
                  <select className="h-7 min-w-0 max-w-[205px] rounded-control border border-line bg-base px-1.5 text-xs" value={speechVisualMode} onChange={(e) => setSpeechVisualMode(e.target.value as 'voiceover' | 'hybrid' | 'scene')}>
                    <option value="voiceover">Narração sobre cenas de ação (estilo Edit)</option>
                    <option value="hybrid">Misto (cena no drop + narração na ação)</option>
                    <option value="scene">Mostrar cena original da fala</option>
                  </select>
                </label>
              )}
              {hasTwoAudio && voiceMoments > 0 && (
                <label className="flex items-center justify-between gap-2">
                  <span>Áudio da fala</span>
                  <select className="h-7 rounded-control border border-line bg-base px-1.5 text-xs" value={voiceLang} onChange={(e) => setVoiceLang(e.target.value as 'original' | 'pt')}>
                    <option value="original">Original (JP)</option>
                    <option value="pt">Português (dub)</option>
                  </select>
                </label>
              )}
              {(voiceMoments > 0 || selectedStyle === 'discurso') && (
                <label className="flex items-center justify-between gap-2">
                  <span>Legenda das falas</span>
                  <select className="h-7 rounded-control border border-line bg-base px-1.5 text-xs" value={speechCaptionLanguage} onChange={(e) => setSpeechCaptionLanguage(e.target.value)}>
                    <option value="pt-BR">Português (Brasil)</option>
                    <option value="en">Inglês</option>
                    <option value="es">Espanhol</option>
                    <option value="fr">Francês</option>
                    <option value="ja">Japonês</option>
                    <option value="original">Original</option>
                  </select>
                </label>
              )}
              <label className="flex items-center justify-between gap-2">
                <span>Sons de impacto</span>
                <select
                  className="h-7 rounded-control border border-line bg-base px-1.5 text-xs"
                  value={useSfx ? sfxMode : 'off'}
                  onChange={(e) => {
                    const v = e.target.value as 'hits-only' | 'full' | 'off';
                    if (v === 'off') {
                      setUseSfx(false);
                      setSfxMode('off');
                    } else {
                      setUseSfx(true);
                      setSfxMode(v);
                    }
                  }}
                >
                  <option value="hits-only">Apenas golpes e impactos (imersão)</option>
                  <option value="full">Completo (+ subida e whoosh)</option>
                  <option value="off">Desligado</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-violet" checked={useEffects} onChange={(e) => setUseEffects(e.target.checked)} />
                {localizedRange ? 'Adicionar efeitos do estilo' : 'Efeitos (clarão, tremida, zoom, RGB)'}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-violet" checked={showText} onChange={(e) => setShowText(e.target.checked)} /> Letras e legendas na tela
              </label>
              {showText && (voiceMoments > 0 || selectedStyle === 'discurso') && (
                <label className="ml-5 flex items-center gap-2 text-2xs text-ink-soft">
                  <input type="checkbox" className="accent-violet" checked={showSpeechCaptions} onChange={(e) => setShowSpeechCaptions(e.target.checked)} />
                  Legenda das falas dos personagens
                </label>
              )}
              {showText && useEffects && (
                <label className="ml-5 flex items-center gap-2 text-2xs text-ink-soft">
                  <input type="checkbox" className="accent-violet" checked={depthCutoutOnDrop} onChange={(e) => setDepthCutoutOnDrop(e.target.checked)} />
                  Destacar personagem no drop (letra atrás)
                </label>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-soft">Direção &amp; Intensidade</p>
              <div className="grid grid-cols-3 gap-1 rounded-control bg-base p-1">
                {([
                  ['cinematic', 'Cinema'],
                  ['balanced', 'Balanceado'],
                  ['hype', 'Hype'],
                ] as const).map(([mode, label]) => (
                  <button key={mode} type="button" aria-pressed={editorialDirection === mode} onClick={() => setEditorialDirection(mode)} className={`rounded-[4px] px-1 py-1 text-xs ${editorialDirection === mode ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 flex gap-1 rounded-control bg-base p-1">
                {INTENSITY.map((label, i) => (
                  <button key={label} type="button" onClick={() => setIntensity(i as 0 | 1 | 2 | 3)} className={`flex-1 rounded-[4px] py-1 text-xs ${intensity === i ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-2xs text-ink-soft">
                  Ação <span className="tnum text-muted">{actionEmphasis}%</span>
                  <input aria-label="Ênfase em ação" className="mt-1 block w-full accent-violet" type="range" min={0} max={100} value={actionEmphasis} onChange={(event) => setActionEmphasis(Number(event.currentTarget.value))} />
                </label>
                <label className="text-2xs text-ink-soft">
                  Emoção <span className="tnum text-muted">{emotionEmphasis}%</span>
                  <input aria-label="Ênfase emocional" className="mt-1 block w-full accent-violet" type="range" min={0} max={100} value={emotionEmphasis} onChange={(event) => setEmotionEmphasis(Number(event.currentTarget.value))} />
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <select
                  aria-label="Emoção principal do perfil"
                  className="h-7 rounded-control border border-line bg-base px-1.5 text-2xs"
                  value={preferredEmotion}
                  onChange={(event) => setPreferredEmotion(event.currentTarget.value as SceneEmotion | '')}
                >
                  <option value="">Emoção: livre</option>
                  {SCENE_EMOTIONS.map((emotion) => <option key={emotion} value={emotion}>{emotion}</option>)}
                </select>
                <select
                  aria-label="Organização temporal"
                  className="h-7 rounded-control border border-line bg-base px-1.5 text-2xs"
                  value={organizationMode}
                  onChange={(event) => setOrganizationMode(event.currentTarget.value as OrganizationMode)}
                >
                  <option value="narrative">Ordem: Narrativo</option>
                  <option value="chronological">Ordem: Cronológico</option>
                  <option value="free">Ordem: Livre</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
