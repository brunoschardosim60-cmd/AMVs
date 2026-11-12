import { impactScore, parseSubtitles, decodeSubtitleBytes, SCENE_EMOTIONS, shotKey, type CameraMotionType, type Cue, type SceneEmotion } from '@amv/analysis';
import { canonicalizeEpisodeVision, chooseMusicRange, creativeEmphasis, DEFAULT_CREATIVE_PROFILES, generateAmv, isBuiltInCreativeProfile, lyricCueKey, planFootage, prepareLocalizedRegeneration, recommendStyle, STYLES, suggestMusicRanges, type CreativeProfile, type EditorialDirection, type EpisodeInput, type GenerateOptions, type LocalizedRegenerationResult, type OrganizationMode, type StyleId } from '@amv/automv';
import { characterCounts, normLabel, pickAudioStreamByLanguage, type EpisodeVision, type VisionScope } from '@amv/analysis';
import { isLocal, loadAiSettings, secretName } from '../../core/aiSettings';
import { loadCreativeProfiles, saveCreativeProfiles } from '../../core/creativeProfiles';
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
import { useEditor } from '../editor/editorStore';
import { getPlayer } from '../editor/Preview';

const ICONS: Record<StyleId, typeof Flame> = { hype: Flame, rapido: Zap, superacao: Sparkles, letra: Type, discurso: Mic, emocional: Heart };
const INTENSITY = ['Suave', 'Moderada', 'Intensa', 'Extrema'] as const;
const DURATIONS = [15, 30, 45, 60, 90];
const S = 1_000_000;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const CAMERA_MOTION_LABEL: Record<CameraMotionType, string> = {
  'pan-horizontal': 'pan horizontal',
  'pan-vertical': 'pan vertical',
  'zoom-in': 'zoom aparente in',
  'zoom-out': 'zoom aparente out',
  rotation: 'rotação',
  travelling: 'travelling/deslocamento',
  static: 'câmera estática',
  unknown: 'movimento não classificado',
};
const FLOW_DIRECTIONS = ['direita', 'baixo-direita', 'baixo', 'baixo-esquerda', 'esquerda', 'cima-esquerda', 'cima', 'cima-direita'];
const flowDirectionLabel = (degrees: number | null): string | null =>
  degrees === null ? null : FLOW_DIRECTIONS[((Math.round(degrees / 45) % 8) + 8) % 8]!;

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
  const [style, setStyle] = useState<StyleId>('hype');
  const [styleMode, setStyleMode] = useState<'auto' | 'manual'>('auto');
  const [intensity, setIntensity] = useState<0 | 1 | 2 | 3>(2);
  const [duration, setDuration] = useState(30);
  const [localizedStartS, setLocalizedStartS] = useState((localizedRange?.startUs ?? 0) / S);
  const [localizedEndS, setLocalizedEndS] = useState((localizedRange?.endUs ?? 0) / S);
  const [voiceMoments, setVoiceMoments] = useState(1);
  const [voiceLang, setVoiceLang] = useState<'original' | 'pt'>('original');
  const [focus, setFocus] = useState<'fight' | 'mix'>('fight');
  const [organizationMode, setOrganizationMode] = useState<OrganizationMode>('narrative');
  const [editorialDirection, setEditorialDirection] = useState<EditorialDirection>('balanced');
  const [seqIds, setSeqIds] = useState<string[]>([]);
  const [hitSync, setHitSync] = useState(true);
  const [adaptiveSpeed, setAdaptiveSpeed] = useState(true);
  const [beatOffsetMs, setBeatOffsetMs] = useState(0);
  const [useSfx, setUseSfx] = useState(true);
  const [characters, setCharacters] = useState<string[]>([]);
  const [characterDrafts, setCharacterDrafts] = useState<Record<string, string>>({});
  const [visionScope, setVisionScope] = useState<VisionScope>('fights');
  const [vision, setVision] = useState<{ done: number; total: number; ep: string } | null>(null);
  const visionAbort = useRef<AbortController | null>(null);
  const [musicStart, setMusicStart] = useState<number | null>(null);
  const [useEffects, setUseEffects] = useState(true);
  const [showText, setShowText] = useState(true);
  const [lyrics, setLyrics] = useState<{ name: string; cues: Cue[] } | null>(null);
  const [matchLyrics, setMatchLyrics] = useState(false);
  const [lyricSceneMatches, setLyricSceneMatches] = useState<NonNullable<GenerateOptions['lyricSceneMatches']>>({});
  const [seed, setSeed] = useState(1);
  const [result, setResult] = useState<{ warnings: string[]; text: string } | null>(null);
  const [localizedCandidates, setLocalizedCandidates] = useState<LocalizedCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [candidateMode, setCandidateMode] = useState(false);
  const [compareFraction, setCompareFraction] = useState(0.5);
  const [busy, setBusy] = useState(false);
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
      const lyricCues = lyrics?.cues
        .filter((cue) => !musicRange || (cue.endS > musicRange[0] && cue.startS < musicRange[1]))
        .sort((a, b) => impactScore(b.text) - impactScore(a.text))
        .slice(0, 6)
        .sort((a, b) => a.startS - b.startS)
        .map((cue) => ({ id: lyricCueKey(cue), text: cue.text, startS: cue.startS, endS: cue.endS }));
      const context = music
        ? {
            style: STYLES.find((item) => item.id === selectedStyle)!.label,
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
        return;
      }
      if (matchLyrics) setLyricSceneMatches({});
      visionAbort.current = new AbortController();
      let labeled = 0;
      let failed = 0;
      let frameFailures = 0;
      let matchCount = 0;
      for (const e of ready) {
        const targets = session.visionTargets(e.id, visionScope, undefined, matchLyrics);
        if (!targets.length) continue;
        setVision({ done: 0, total: targets.length, ep: e.name });
        const r = await session.runVision(e.id, { provider: settings.provider, key, fetch: platform.http, scope: visionScope, context, matchLyrics, signal: visionAbort.current.signal, onProgress: (done, total) => setVision({ done, total, ep: e.name }) });
        if (matchLyrics) setLyricSceneMatches((current) => ({ ...current, ...r.lyricMatches }));
        matchCount += Object.values(r.lyricMatches).reduce((count, matches) => count + Object.keys(matches).length, 0);
        labeled += r.labeled;
        failed += r.failed;
        frameFailures += r.frameFailures;
        if (visionAbort.current.signal.aborted) break;
      }
      toast(failed || frameFailures ? { tone: 'warn', title: `${labeled} cenas analisadas`, body: `${failed} cenas sem resposta do modelo; ${frameFailures} quadros não puderam ser extraídos. Rode de novo para tentar as cenas incompletas.` } : { tone: 'ok', title: `${labeled} cenas analisadas`, body: matchLyrics ? `${matchCount} combinações de letra/cena retornadas; as demais cenas usam a seleção local.` : 'Escolha os personagens ao lado.' });
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
    setLyricSceneMatches({});
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
      if (useSfx) {
        try {
          sfxAssets = await session.ensureSfx();
        } catch (e) {
          sfxError = (e as Error).message;
        }
      }
      const opts: GenerateOptions = { useSfx, sfxAssets, style: selectedStyle, intensity, durationS: duration, musicStartS: chosenStart, lyrics: lyrics?.cues, lyricSceneMatches, useSpeech: voiceMoments > 0, voiceMoments, voiceLang, useEffects, showText, seed: nextSeed, exclude: excluded, focus, sequenceIds: seqIds, hitSync, adaptiveSpeed, beatOffsetMs, characters, organizationMode, editorialDirection, creativeEmphasis: creativeEmphasis({ actionEmphasis, emotionEmphasis, preferredEmotion: preferredEmotion || null }) };
      const m = musics.find((a) => a.id === musicId)!;
      const r = generateAmv(session.project, { assetId: m.id, name: m.name, analysis: music }, inputs, opts);
      if (sfxError) r.warnings.push(`Não consegui preparar os efeitos sonoros (${sfxError}): o vídeo saiu sem eles.`);
      // guarda o que estava antes: nada se perde
      await session.saveVersion(`Antes de gerar (${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`);
      const directionLabel = editorialDirection === 'cinematic' ? 'Cinematográfico' : editorialDirection === 'hype' ? 'Hype' : 'Balanceado';
      const label = `${directionLabel} · ${styleMode === 'auto' ? 'Aberto · ' : ''}${STYLES.find((s) => s.id === selectedStyle)!.label}`;
      session.history.transaction(`Gerar meu AMV — ${label}`, r.commands);
      useEditor.getState().setPlayhead(0);
      useEditor.getState().setPlaying(false);
      try {
        getPlayer(session).seek(0);
      } catch {}
      setSeed(nextSeed);
      const s = r.summary;
      setResult({
        warnings: r.warnings,
        text: `${s.clips} cenas, ${s.cuts} cortes${s.drop !== null ? `, drop em ${s.drop.toFixed(1)} s` : ''}${s.voices ? `, ${s.voices} fala(s)${s.speech ? ` (começando por "${s.speech}")` : ''}` : ''}. Trecho da música: ${mmss(s.musicRange[0])}–${mmss(s.musicRange[1])}. Direção: ${[...new Set(s.direction.map((beat) => beat.role))].map((role) => role === 'opening' ? 'Abertura' : role === 'build' ? 'Crescimento' : role === 'climax' ? 'Clímax' : role === 'release' ? 'Respiro' : role === 'ending' ? 'Encerramento' : 'Desenvolvimento').join(' → ')}.${s.focus === 'fight' && s.fights.length ? ` Luta usada: ${s.fights.join(' + ')}.` : s.focus === 'mix' ? ' Cenas de vários pontos (modo misturar).' : ''}${s.hitsSynced ? ` ${s.hitsSynced} golpes encaixados na batida.` : ''}${s.speedRamps ? ` ${s.speedRamps} rampas de velocidade aplicadas.` : ''}${s.sfx ? ` ${s.sfx} efeitos sonoros.` : ''}`,
      });
    } catch (e) {
      toast({ tone: 'error', title: 'Não deu para gerar', body: (e as Error).message });
    } finally {
      setBusy(false);
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
          A regeneração altera somente os clipes de vídeo selecionados na trilha de destino. Áudio, legendas, outras trilhas e clipes não selecionados são mantidos.
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
        width="w-[560px]"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResult(null)}>
              Mudar opções
            </Button>
            <Button icon={<Wand2 size={15} />} disabled={busy} onClick={() => generate(seed + 1)}>
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
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon={<Wand2 size={15} />} disabled={!music || ready.length === 0 || !analysisReadiness.canGenerate || busy || (localizedRange !== undefined && localizedRange.clipIds.length === 0)} onClick={() => void generate(seed)}>
            {localizedRange ? 'Gerar alternativa' : 'Gerar'}
          </Button>
        </>
      }
    >
      {localizedRange && (
        <div className="mb-4 rounded-control border border-violet/30 bg-violet/5 p-3">
          <p className="text-sm font-semibold text-ink">Regeneração não destrutiva</p>
          <p className="mt-1 text-xs text-ink-soft">
            Apenas os clipes de vídeo selecionados podem ser substituídos. Música, falas, efeitos sonoros, legendas, transições e clipes não selecionados permanecem na timeline. Cada alternativa é pré-visualizada antes da confirmação.
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
      {episodes.length === 0 || (musics.length === 0 && !recs.length) ? (
        <p className="text-sm text-ink-soft">Importe pelo menos <b>uma música</b> e <b>um episódio</b>. O AMV Studio analisa os dois e monta o vídeo a partir deles.</p>
      ) : (
        <div className="generate-options grid max-h-[calc(100vh-210px)] gap-5 overflow-y-auto pr-1">
          <div>
            <p className="mb-2 text-xs font-medium text-ink-soft">Perfil criativo</p>
            <select
              aria-label="Perfil criativo"
              className="h-9 w-full rounded-control border border-line bg-base px-2 text-sm"
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
            <div className="mt-2 space-y-1.5 rounded-control border border-line-soft p-2">
              <input
                aria-label="Nome do novo perfil criativo"
                className="h-7 w-full rounded-control border border-line bg-base px-2 text-xs"
                placeholder="Nome do perfil para salvar"
                value={profileNameDraft}
                onChange={(event) => setProfileNameDraft(event.currentTarget.value)}
                disabled={!profilesLoaded || profileStorageError}
              />
              <div className="flex flex-wrap gap-1">
                <Button size="sm" onClick={saveNewCreativeProfile} disabled={!profilesLoaded || profileStorageError || !profileNameDraft.trim()}>
                  Salvar como novo
                </Button>
                {activeProfileIsCustom && (
                  <>
                    <Button size="sm" onClick={updateCreativeProfile} disabled={!profilesLoaded || profileStorageError}>Atualizar</Button>
                    <Button size="sm" variant="ghost" onClick={() => void deleteCreativeProfile()} disabled={!profilesLoaded || profileStorageError}>Excluir</Button>
                  </>
                )}
              </div>
              <p className="text-2xs text-muted">Perfis ficam neste computador. Ao aplicar um, você ainda pode ajustar as opções antes de gerar.</p>
              {profileStorageError && <p className="text-2xs text-danger">Armazenamento inválido; perfis padrão ficam disponíveis, mas salvar está desativado para preservar o arquivo.</p>}
            </div>

            <p className="mb-2 text-xs font-medium text-ink-soft">Estilo</p>
            <div className="mb-2 flex gap-1 rounded-control bg-base p-1">
              <button type="button" aria-pressed={styleMode === 'auto'} onClick={() => setStyleMode('auto')} className={`flex-1 rounded-[4px] px-2 py-1.5 text-xs ${styleMode === 'auto' ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
                Aberto · o app escolhe
              </button>
              <button type="button" aria-pressed={styleMode === 'manual'} onClick={() => setStyleMode('manual')} className={`flex-1 rounded-[4px] px-2 py-1.5 text-xs ${styleMode === 'manual' ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
                Escolher estilo
              </button>
            </div>
            {styleMode === 'auto' ? (
              <div className="rounded-md border border-violet/40 bg-violet/10 p-3">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = ICONS[selectedStyle];
                    return <Icon size={17} className="shrink-0 text-violet-strong" />;
                  })()}
                  <span className="text-sm font-semibold text-ink">{STYLES.find((item) => item.id === selectedStyle)!.label}</span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{recommendation ? `Recomendado por: ${recommendation.reason}.` : 'Aguardando a análise da música e dos episódios selecionados.'}</p>
                <p className="mt-1 text-2xs text-muted">A escolha usa BPM, energia, cenas, falas e letra carregada. É automática e local; você ainda pode mudar para um estilo manual.</p>
              </div>
            ) : (
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
            )}

            <p className="mt-4 mb-2 text-xs font-medium text-ink-soft">Direção de edição</p>
            <div className="grid grid-cols-3 gap-1 rounded-control bg-base p-1">
              {([
                ['cinematic', 'Cinema'],
                ['balanced', 'Balanceado'],
                ['hype', 'Hype'],
              ] as const).map(([mode, label]) => (
                <button key={mode} type="button" aria-pressed={editorialDirection === mode} onClick={() => setEditorialDirection(mode)} className={`rounded-[4px] px-1 py-1.5 text-xs ${editorialDirection === mode ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-2xs text-muted">
              {editorialDirection === 'cinematic' ? 'Planos longos, mais continuidade, dissolves e efeitos discretos.' : editorialDirection === 'hype' ? 'Cortes mais curtos, prioridade a ação/impacto e efeitos mais fortes, sem abandonar a sequência.' : 'Mantém o ritmo do estilo escolhido, equilibrando música e continuidade.'}
            </p>

            <p className="mt-4 mb-2 text-xs font-medium text-ink-soft">Intensidade</p>
            <div className="flex gap-1 rounded-control bg-base p-1">
              {INTENSITY.map((label, i) => (
                <button key={label} type="button" onClick={() => setIntensity(i as 0 | 1 | 2 | 3)} className={`flex-1 rounded-[4px] py-1.5 text-xs ${intensity === i ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
                  {label}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-xs text-ink-soft">
              Ênfase em ação <span className="tnum text-muted">{actionEmphasis}%</span>
              <input
                aria-label="Ênfase em ação"
                className="mt-1 block w-full accent-violet"
                type="range"
                min={0}
                max={100}
                value={actionEmphasis}
                onChange={(event) => setActionEmphasis(Number(event.currentTarget.value))}
              />
            </label>
            <label className="mt-2 block text-xs text-ink-soft">
              Ênfase emocional <span className="tnum text-muted">{emotionEmphasis}%</span>
              <input
                aria-label="Ênfase emocional"
                className="mt-1 block w-full accent-violet"
                type="range"
                min={0}
                max={100}
                value={emotionEmphasis}
                onChange={(event) => setEmotionEmphasis(Number(event.currentTarget.value))}
              />
            </label>
            <p className="mt-1 text-2xs text-muted">Esses pesos só alteram a seleção quando há tags locais ou sinais visuais confiáveis; não são notas nem probabilidades.</p>
            <label className="mt-2 block text-xs text-ink-soft">
              Emoção principal
              <select
                aria-label="Emoção principal do perfil"
                className="mt-1 h-8 w-full rounded-control border border-line bg-base px-2"
                value={preferredEmotion}
                onChange={(event) => setPreferredEmotion(event.currentTarget.value as SceneEmotion | '')}
              >
                <option value="">Sem preferência</option>
                {SCENE_EMOTIONS.map((emotion) => <option key={emotion} value={emotion}>{emotion}</option>)}
              </select>
            </label>
            <p className="mt-3 mb-1 text-xs font-medium text-ink-soft">Organização temporal</p>
            <div className="grid grid-cols-3 gap-1 rounded-control bg-base p-1">
              {([
                ['chronological', 'Cronológico'],
                ['narrative', 'Narrativo'],
                ['free', 'Livre'],
              ] as const).map(([mode, label]) => (
                <button key={mode} type="button" aria-pressed={organizationMode === mode} onClick={() => setOrganizationMode(mode)} className={`rounded-[4px] px-1 py-1.5 text-2xs ${organizationMode === mode ? 'bg-raised font-semibold text-ink' : 'text-muted hover:text-ink'}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-2xs text-muted">
              {organizationMode === 'chronological' ? 'Avança pela ordem dos episódios selecionados e pelo tempo original.' : organizationMode === 'narrative' ? 'Preserva a progressão de cada episódio e planeja a sequência completa antes de montar.' : 'Permite saltos não lineares; saltos sem sinal musical ou visual recebem penalidade e justificativa.'}
            </p>

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
            <label className="mt-2 flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5 accent-violet" checked={adaptiveSpeed} onChange={(e) => setAdaptiveSpeed(e.target.checked)} />
              <span>
                Rampas de velocidade guiadas pela ação
                <span className="mt-0.5 block text-2xs text-muted">Só usa slow motion em fontes de FPS alto e aceleração em preparações identificadas. VFR ou cadência insuficiente mantém a velocidade original.</span>
              </span>
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
                <div className="space-y-1">
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
                          {profile ? 'Salvar' : 'Adicionar'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-2xs text-muted">A análise local não inventa identidades. Use o modelo de visão para sugerir personagens; depois salve/corrija os nomes na biblioteca deste projeto.</p>
              )}
              {project.characterLibrary.length > 0 && (
                <p className="mt-1 text-2xs text-muted">
                  Biblioteca do projeto: {project.characterLibrary.length} personagem(ns) · evidências vinculadas às cenas e salvas com undo.
                </p>
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
                  <label className="mt-2 flex items-start gap-1.5 text-2xs text-ink-soft">
                    <input type="checkbox" className="mt-0.5 accent-violet" checked={matchLyrics} disabled={!lyrics?.cues.length} onChange={(e) => setMatchLyrics(e.target.checked)} />
                    <span>Relacionar o sentido da letra com as cenas (IA; opcional)</span>
                  </label>
                  <p className="mt-1 text-2xs text-faint">
                    Usa até 6 versos e reanalisa os quadros amostrados para sugerir combinações; pode consumir cota do modelo. Sem essa opção, a montagem continua local, pela batida, energia, ação e emoção.
                  </p>
                  {localVisionTodo > 0 && (
                    <>
                      <Button size="sm" className="mt-2" onClick={runLocalVision} title="Analisa quadros localmente; nenhum dado sai do computador.">
                        Analisar visual localmente ({localVisionTodo})
                      </Button>
                      <p className="mt-1 text-2xs text-faint">
                        Usa fluxo óptico esparso em baixa resolução para medir câmera e movimento localizado, direção, velocidade e mudanças bruscas. Retoma do cache por cena; não reconhece personagens.
                      </p>
                    </>
                  )}
                  {visionTodo > 0 ? (
                    <>
                      <Button size="sm" className="mt-2" onClick={runVision} title="Complementa a análise local com rótulos semânticos de um modelo de visão.">
                        {matchLyrics ? 'Analisar cenas e sentido da letra' : 'Analisar cenas com IA'}
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
              {movementRows.length > 0 && (
                <div className="mt-2 rounded-control border border-line-soft p-2">
                  <p className="text-2xs font-medium text-ink-soft">
                    Movimento confiável (confiança ≥ 60%) · {movementRows.length} intervalo(s)
                  </p>
                  <ul className="mt-1 space-y-0.5 text-2xs text-muted">
                    {movementRows.slice(0, 6).map(({ episode, shotStartS, event }, index) => (
                      <li key={`${episode}-${event.startS}-${index}`}>
                        {episode} · {mmss(shotStartS)} · {CAMERA_MOTION_LABEL[event.cameraMotion]}
                        {flowDirectionLabel(event.directionDeg) && ` · quadro → ${flowDirectionLabel(event.directionDeg)}`}
                        {' · '}{event.speed.toFixed(3)} diag/s · {Math.round(event.confidence * 100)}%
                        {event.subjectMotion.confidence >= 0.6 && ' · movimento localizado'}
                        {event.apparentScaleChange === 'in' && ' · aproximação aparente'}
                        {event.apparentScaleChange === 'out' && ' · afastamento aparente'}
                        {event.abruptFramingChange && ' · mudança brusca'}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-2xs text-faint">Zoom/aproximação são sinais aparentes; só esses quadros não distinguem movimento de câmera de movimento do objeto.</p>
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
              {music && musicMapRange && <MusicalMap analysis={music} range={musicMapRange} />}
            </div>

            {recs.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-ink-soft">Melhor música para estas cenas (sua biblioteca)</p>
                <p className="mb-2 text-2xs text-muted">Ranqueadas por BPM, intensidade, duração e compatibilidade da curva de energia com as cenas selecionadas.</p>
                <Button size="sm" className="mb-2 w-full" onClick={() => void addFromLibrary(recs[0]!.track.id)}>
                  Usar melhor: {displayTitle(recs[0]!.track)}
                </Button>
                <p className="mb-2 text-2xs text-faint">{recs[0]!.reasons.join(' · ') || 'Compatibilidade baseada na análise local da faixa.'}</p>
                <ul className="space-y-1">
                  {recs.map((r) => (
                    <li key={r.track.id}>
                      <button type="button" title={r.reasons.join(' · ')} onClick={() => void addFromLibrary(r.track.id)} className="flex w-full items-center gap-2 rounded border border-line px-2 py-1 text-left text-2xs hover:bg-raised">
                        <Music2 size={11} className="shrink-0 text-violet-strong" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{displayTitle(r.track)}</span>
                          {r.reasons[0] && <span className="block truncate text-faint">{r.reasons[0]}</span>}
                        </span>
                        <span className="tnum text-faint">{Math.round(r.score * 100)}%</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              {!localizedRange && (
                <>
                  <p className="mb-1.5 text-xs font-medium text-ink-soft">Duração</p>
                  <div className="flex flex-wrap gap-1">
                    {DURATIONS.map((d) => (
                      <button key={d} type="button" onClick={() => setDuration(d)} className={`tnum rounded-control border px-2.5 py-1 text-xs ${duration === d ? 'border-violet bg-violet/10' : 'border-line text-muted hover:text-ink'}`}>
                        {d} s
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-medium text-ink-soft">Episódios</p>
                <span className="flex gap-2">
                  <button type="button" className="text-2xs text-muted underline hover:text-ink" onClick={() => setEpIds(episodes.map((episode) => episode.id))}>Todos</button>
                  <button type="button" className="text-2xs text-muted underline hover:text-ink" onClick={() => setEpIds([])}>Nenhum</button>
                </span>
              </div>
              <p className="mb-1.5 text-2xs text-muted">O app analisa os momentos dos episódios marcados e prioriza as melhores lutas; desmarque o que não quer misturar.</p>
              <ul className="max-h-32 space-y-1 overflow-y-auto">
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
                <input type="checkbox" className="accent-violet" checked={useEffects} onChange={(e) => setUseEffects(e.target.checked)} />
                {localizedRange ? 'Adicionar efeitos do estilo (os existentes são preservados)' : 'Efeitos (clarão, tremida, zoom)'}
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
              <p className="mt-1 text-2xs text-muted">Use letra sincronizada; para exibir em português, selecione um arquivo já traduzido. O app não busca nem traduz letras automaticamente.</p>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
