# Roadmap — AMV Studio

## Entregue até v0.7.0

- **Camada 1 — Tipografia Pro + Fontes Embutidas + UI Enxuta:** `Anton`, `Bebas Neue`, `Cinzel Variable` e `Montserrat Variable` embutidas, *Hero Word* (dupla fonte + inclinação), extrusão 3D, duplo contorno, RGB Split, reflexo *Sheen* e limpeza de textos prolixos.
- **Camada 2 — Cortes, Auto-Reframe de Anime, OP/ED e Velocity:** `subjectFocus` com trajetória dinâmica em 9:16, reserva automática de OP/ED em episódios longos, transição `zoom_through`, overscan automático contra borda preta em `shake` e interpolação suave em slow-motion.
- **Camada 3 — Voz Limpa e Sincronia Percussiva:** `voiceIsolation` (canal central + filtragem vocal), `echoTail` dramático antes do drop, realce percussivo no detector de batidas e pré-isolamento vocal antes do Whisper.
- **Camada 4 — Recorte de Personagem + Texto Atrás (`behindCutout`):** composição `V1 → Texto → V2`, destaque automático no drop, recorte de 1 clique em `V2` (ONNX DirectML GPU + fallback instantâneo sem download) e máscaras `subject-focus` / `manga-slash`.

## Próximos passos opcionais

1. Download opcional pelo próprio app de checkpoint `BiRefNet-lite.onnx` / `RMBG-1.4.onnx` para refinar fios de cabelo em planos complexos via DirectML.
2. Validação manual completa em GPU AMD/NVIDIA no Windows seguindo [TESTE_MANUAL_WINDOWS.md](./TESTE_MANUAL_WINDOWS.md).
