# Auditoria Técnica — AMV Creative Intelligence Engine (Camada 0)

## 1. Escopo e Metodologia

Esta auditoria avalia o estado real do repositório do **AMV Studio** (`v0.9.10`) frente à especificação **AMV Creative Intelligence** antes da implementação incremental das Camadas 1 a 9.

Cada módulo foi inspecionado diretamente no código-fonte de `@amv/analysis`, `@amv/automv`, `@amv/project`, `@amv/subtitles`, `@amv/assistant` e `apps/desktop`, classificado em uma das cinco categorias:

- **Já implementado e funcional**
- **Implementado parcialmente**
- **Documentado, mas não executado**
- **Inexistente**
- **Necessita substituição ou refatoração**

---

## 2. Matriz de Classificação dos Módulos Atuais

| Capacidade da Especificação | Classificação Atual | Arquivos e Funções Inspecionados | Evidência Técnica Real e Lacunas Identificadas |
| :--- | :--- | :--- | :--- |
| **Ingestão de mídia, cache por hash e preservação de originais** | **Já implementado e funcional** | `packages/media/src/cache.ts`, `packages/project/src/hash.ts`, `apps/desktop/src/core/session.ts` | Arquivos originais nunca são alterados; cache em disco indexado por hash parcial do arquivo (`EpisodeAnalysis`, `MusicAnalysis`, `EpisodeVision`). Falta cache derivado específico para `SceneAnalysis[]` e `MusicUnderstandingResult` reutilizável entre múltiplos projetos em memória/disco. |
| **Análise rítmica base (BPM, batidas, compasso, energia, drops)** | **Já implementado e funcional** | `packages/analysis/src/music.ts` (`analyzeMusic`, `trackBeats`, `detectMeterAndDownbeats`, `findSections`, `detectVariableTempo`) | Detecta BPM, `beats`, `downbeats`, `meter` (`3/4`, `4/4`, `6/8`), `tempoVariable`, curva `energy`, `drops` e `events` acústicos (`onset`, `impact`, `growth`, `pause`, `drop`, `section-change`, `rhythm-change`). |
| **Motor de Compreensão Musical Semântica e Classificação Tipológica (Tipos A–E)** | **Implementado parcialmente** | `packages/analysis/src/music.ts`, `packages/automv/src/music-map.ts`, `packages/automv/src/music-selection.ts` | Não constrói grade explícita de compassos (`bars`), não separa trechos vocais × instrumentais com confiança, não interpreta significado semântico/emocional das frases da letra (`semanticMeaning`), nem classifica a faixa nos tipos **Narrativa / Emocional / Combate / Instrumental / Híbrida** com troca dinâmica de estratégia por seção. |
| **Detecção de planos, movimento óptico local e falas/legendas** | **Já implementado e funcional** | `packages/analysis/src/episode.ts` (`buildEpisodeAnalysis`, `detectSpeech`), `packages/analysis/src/local-vision.ts` (`analyzeLocalVisualFrames`, `estimateSparseFlow`), `packages/analysis/src/vision.ts` (`ShotVision`) | Extrai cortes, intensidade, brilho, segmentos de fala/grito, legendas embutidas, foco de sujeito/rosto de anime, movimento de câmera/assunto (`directionDeg`, `cameraMotion`), paleta dominante e `fingerprint` anti-clone. |
| **Motor de Compreensão Visual Multiclasse (`SceneAnalysis`)** | **Implementado parcialmente** | `packages/analysis/src/episode.ts`, `packages/analysis/src/vision.ts`, `packages/analysis/src/local-vision.ts` | `Shot.tags` tem apenas 7 tags básicas (`ação`, `impacto`, `fala`, `grito`, `calma`, `clarão`, `escura`) e `ShotVision` escolhe **uma única** `action` e **uma única** `emotion`. Faltam: contrato unificado `SceneAnalysis`, classificação semântica simultânea nas 24 categorias da especificação (ataque, defesa, esquiva, contra-ataque, superação, derrota, vitória, sacrifício, despedida, memória, revelação, confronto emocional etc.), fase coreográfica e estado físico/emocional do personagem. |
| **Motor de Alinhamento Semântico Letra ↔ Cena (5 tipos + score 0–100)** | **Necessita substituição ou refatoração** | `packages/automv/src/lyric-matcher.ts` (`matchLyricsSemantics`) | Opera apenas por 7 grupos de palavras-chave lexicais com `boost` fixo (`0.58–0.90`). Não distingue os 5 tipos de relação (`literal`, `metaphorical`, `emotional`, `contextual`, `intentional_contrast`), não calcula score normalizado `0–100` configurável com os 6 pesos da especificação, e não planeja sincronização sub-frasal (preparação antes da frase, impacto na palavra-chave, sustentação por múltiplos cortes). |
| **Diretor Narrativo Não Linear (`Narrative Director`)** | **Necessita substituição ou refatoração** | `packages/automv/src/narrative.ts` (`planNarrative`), `packages/automv/src/creative-director.ts` (`buildCreativeBrief`) | `planNarrative` apenas mapeia rótulos de seções musicais linearmente (`opening`, `build`, `climax`, `release`, `ending`, `development`). Não suporta abertura pelo clímax do episódio (`cold open`), flashbacks entre episódios, antecipação (`foreshadowing`), rivalidade, vingança, transformação ou escolha intencional de encerramento. |
| **Motor de Continuidade Coreográfica, Emocional e Memória Contextual** | **Implementado parcialmente** | `packages/automv/src/scoring.ts` (`scoreSceneCandidate`, `motionTransition`, `actionTransition`) | Possui heurísticas locais de par adjacente (`previous` → `current`) para movimento, cor e repetição de personagem, mas não modela cadeia coreográfica completa (`preparação → ataque → impacto → reação/defesa/esquiva/contra-ataque`), não mantém `NarrativeContextMemory` explícita e penaliza saltos não cronológicos em vários modos. |
| **Edição Guiada pela Música, Respiração Cinematográfica e Interação Vocal** | **Implementado parcialmente** | `packages/automv/src/generate.ts` (`makeSlots`, `VoiceBlock`), `packages/automv/src/music-selection.ts` (`buildSmartDuckingKeyframes`) | Tem ducking inteligente e cortes adaptativos por batida, mas `makeSlots` ainda fatia planos longos de forma mecânica em vários cenários, não classifica os 10 tipos editoriais de corte, não protege explicitamente zonas de **respiração cinematográfica** (sustentando planos contemplativos/emocionais por múltiplas batidas) e não modela um mapa unificado de eventos sonoros diferenciando fala dramática essencial de fala secundária. |
| **Motor Global de Decisão de Edição (`EditorialDecision` + alternativas)** | **Implementado parcialmente** | `packages/automv/src/sequence-planner.ts` (`planSequence`), `packages/automv/src/generate.ts` | `planSequence` já executa busca em feixe (*beam search*) determinística, porém retorna apenas `(TCandidate | null)[]` sem registrar `EditorialDecision` estruturada (`alternatives` rejeitadas + motivo, relação musical, relação narrativa, `semanticAlignment`, `continuityRelation`, riscos de coerência e travas manuais por slot). |
| **Avaliação Global Independente da Qualidade Artística/Narrativa** | **Implementado parcialmente** | `packages/automv/src/quality.ts` (`evaluateAudiovisualQuality`), `packages/automv/src/tournament.ts` (`scoreAssemblyQuality`) | Excelente cobertura técnica (lacunas, luminância, micro-cortes, sobreposição de legendas), mas não possui o avaliador independente `0–100` com as 8 dimensões ponderadas (20/20/15/15/10/10/5/5) capaz de reprovar montagens com bons clipes isolados porém narrativa global confusa, diálogos cortados no meio da ideia ou frases focais sem correspondência visual. |
| **Interface `Creative Direction Preview` e Consultas de Justificativa** | **Inexistente** | `apps/desktop/src/features/automv/GenerateDialog.tsx`, `apps/desktop/src/features/editor/Inspector.tsx`, `packages/assistant/src/tools.ts` | `GenerateDialog.tsx` exibe storyboard apenas **após** gerar e não possui o painel pré-geração/interativo **Creative Direction Preview** (ideia central, estratégia narrativa, abertura sugerida, cadeias de combate, associações letra↔cena, travar cena, trocar abertura/clímax, preservar fala, *"Por que você escolheu essa cena?"* e *"Encontre outra cena que combine melhor com essa frase."*). |

---

## 3. Mapeamento de Dependências e Preservação Arquitetural

1. **Invariantes preservadas (`AGENTS.md`):**
   - Pacotes em `/packages/*` permanecem 100% livres de React e Tauri.
   - Tempo na timeline permanece em microssegundos inteiros (`us`) e FPS racional (`{ num, den }`).
   - `generateAmv` e `generateBestAmv` continuam produzindo `Command[]` padrão reversíveis por `ProjectHistory` (undo/redo único) e mantendo retrocompatibilidade total com projetos `.amvproj` (`schemaVersion: 10`).
   - O contrato existente `MusicEvent` em `@amv/analysis/src/music.ts` é preservado intacto para não quebrar caches `m6` nem testes existentes; o novo contrato semântico-temporal é exportado como `CreativeMusicEvent` (e alias `MusicUnderstandingEvent` / `MusicSemanticEvent` no motor criativo).

2. **Fluxo Modular do `AMV Creative Intelligence Engine`:**
   ```text
   EpisodeAnalysis + EpisodeVision + Project Annotations
        ↓
   VisualUnderstandingEngine (@amv/analysis) ──► SceneAnalysis[] + Cache por Hash
        ↓
   MusicAnalysis + Lyrics (Cue[]) + Audio Envelope
        ↓
   MusicUnderstandingEngine (@amv/analysis)  ──► CreativeMusicEvent[] + SongArchetype (A–E)
        ↓
   SemanticAlignmentEngine (@amv/automv)     ──► SemanticAlignment (5 tipos, 0–100)
        ↓
   NarrativeDirector (@amv/automv)           ──► CreativeDirectionPlan (12 modelos não lineares)
        ↓
   ContinuityEngine (@amv/automv)            ──► ContinuityRelation + NarrativeContextMemory
        ↓
   EditingDecisionEngine (@amv/automv)       ──► EditorialDecision[] + AudioEventMap + Respiração
        ↓
   generateAmv / generateBestAmv             ──► Commands + Justificativas Reais + Confiança
        ↓
   GlobalQualityReview (@amv/automv)         ──► Avaliação Independente 0–100 (8 dimensões)
        ↓
   CreativeDirectionPreview (apps/desktop)   ──► Aprovação, Substituição, Travas e Consultas
   ```

---

## 4. Contratos de Dados Definidos para as Camadas 1–8

- **`SceneAnalysis`** (`packages/analysis/src/visual-understanding.ts`): `sceneId`, `contentKey` (por hash), `sourceFile`, `sourceEpisode`, `startTime`, `endTime`, `characters`, `actions`, `actionPhase`, `emotions`, `semanticTags` (24 categorias simultâneas), `characterState`, `movement`, `cameraMotion`, `context`, `visualDescription`, `confidence`.
- **`CreativeMusicEvent` & `MusicUnderstandingResult`** (`packages/analysis/src/music-understanding.ts`): `startTime`, `endTime`, `eventType`, `lyrics`, `semanticMeaning`, `emotion`, `intensity`, `confidence`, `archetype` (`narrative` | `emotional` | `combat` | `instrumental` | `hybrid`), `bars`, `sectionProfiles`, `vocalSpans`, `instrumentalSpans`.
- **`SemanticAlignment`** (`packages/automv/src/semantic-alignment.ts`): `musicEventId`, `sceneId`, `alignmentType` (`literal` | `metaphorical` | `emotional` | `contextual` | `intentional_contrast`), `phraseSyncMode`, `score` (`0..100`), `components`, `explanation`, `confidence`.
- **`CreativeNarrativeBeat` & `CreativeDirectionPlan`** (`packages/automv/src/narrative-director.ts`): `centralIdea`, `predominantEmotion`, `narrativeModel`, `openingSelection`, `climaxSelection`, `endingStrategy`, `narrativeBeats`, `preservedSpeeches`, `breathingZones`.
- **`ContinuityRelation` & `NarrativeContextMemory`** (`packages/automv/src/continuity-engine.ts`): `fromSceneId`, `toSceneId`, `continuityScore` (`0..100`), `relationKind`, `dimensions`, `explanation`, `confidence`.
- **`EditorialDecision`** (`packages/automv/src/editing-decision-engine.ts`): `selectedSceneId`, `startTime`, `endTime`, `cutType`, `isBreathingHold`, `reason`, `alternatives`, `musicalRelationship`, `narrativeRelationship`, `semanticAlignment`, `continuityWithPrevious`, `coherenceRisks`, `confidence`.
- **`GlobalQualityReport`** (`packages/automv/src/global-quality-review.ts`): `overallScore` (`0..100`), `dimensions` (8 pesos configuráveis), `findings`, `replanSuggestions`.
