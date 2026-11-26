# Baseline — rodada de estabilização

Medido **sem alterar código** (Fase 0). Ponto de partida das refatorações da Fase 1.

| Item | Valor |
|---|---|
| Versão (`package.json`) | 0.9.3 (o prompt citava 0.9.1; 0.9.2 e 0.9.3 já estavam publicadas) |
| Commit medido | `634129e` (`release: v0.9.3`) |
| Ambiente | Windows, Node + pnpm, FFmpeg real disponível (`AMV_FFMPEG_DIR`) |

## Comandos e tempos

| Comando | Resultado | Tempo |
|---|---|---|
| `pnpm install --frozen-lockfile` | OK | ~1 s (dependências já instaladas) |
| `pnpm typecheck` | OK, 0 erros | ~25 s |
| `pnpm -r --workspace-concurrency=2 test` | **1 falha** (instável, ver abaixo) | ~80 s |

### Testes por pacote

| Pacote | Testes |
|---|---|
| `packages/project` | 75 |
| `packages/sfx` | 12 |
| `packages/sound-design` | 5 |
| `packages/media` | 30 |
| `packages/analysis` | 67 |
| `packages/render` | 38 (usam FFmpeg real) |
| `packages/music` | 16 |
| `packages/subtitles` | 26 |
| `packages/automv` | 223 |
| `packages/assistant` | 51 |
| `apps/desktop` | 65 (64 passaram + 1 falha nesta execução) |
| **Total** | **608** |

### Teste instável

`apps/desktop/test/session.test.ts` › `sessão do projeto › undo da importação cancela jobs; redo reprocessa`.
- Falhou em 2 de 4 execuções completas; passou em 3 de 3 execuções isoladas do pacote.
- Hipótese (não confirmada): corrida com processos FFmpeg/arquivos temporários no Windows. Corrigir na Fase 5, com causa comprovada.

## 10 maiores arquivos `.ts/.tsx` (linhas)

| # | Arquivo | Linhas |
|---|---|---|
| 1 | `packages/automv/src/generate.ts` | 2.959 |
| 2 | `apps/desktop/src/features/automv/GenerateDialog.tsx` | 2.803 |
| 3 | `apps/desktop/src/features/editor/Timeline.tsx` | 2.068 |
| 4 | `apps/desktop/src/features/editor/Inspector.tsx` | 1.566 |
| 5 | `packages/automv/test/generate.test.ts` (teste) | 1.448 |
| 6 | `apps/desktop/src/core/session.ts` | 1.313 |
| 7 | `apps/desktop/src/features/editor/Preview.tsx` | 1.126 |
| 8 | `apps/desktop/src/features/editor/player.ts` | 1.113 |
| 9 | `apps/desktop/src/features/editor/SubtitlesPanel.tsx` | 1.111 |
| 10 | `packages/subtitles/src/index.ts` | 1.049 |

Arquivos de código (exceto testes) acima de 600 linhas: **15**.

## Funções com mais de 80 linhas nos 5 alvos

Medição por AST do TypeScript (funções, métodos e arrow functions). "Linha" = início.

### `packages/automv/src/generate.ts`
| Função | Linha | Tamanho |
|---|---|---|
| `generateInner` | 1408 | 1.549 |
| `textClip` | 940 | 254 |
| `makeSlots` | 202 | 169 |
| (anônima) | 1942 | 97 |
| `placeSfx` | 2577 | 97 |

### `apps/desktop/src/features/automv/GenerateDialog.tsx`
| Função | Linha | Tamanho |
|---|---|---|
| `GenerateDialog` (componente) | 64 | 2.739 |
| `generate` | 870 | 669 |
| `syncWrittenLyrics` | 578 | 101 |
| `extractLyricsFromMusic` | 680 | 98 |
| `runVision` | 398 | 93 |

### `apps/desktop/src/features/editor/Timeline.tsx`
| Função | Linha | Tamanho |
|---|---|---|
| `Timeline` | 268 | 847 |
| `TimelineClipModifyModal` | 1547 | 521 |
| `TimelineQuickEditBar` | 1158 | 388 |
| (anônima) | 957 | 88 |

### `apps/desktop/src/features/editor/Inspector.tsx`
| Função | Linha | Tamanho |
|---|---|---|
| `ClipInspector` | 275 | 652 |
| `TextSection` | 928 | 340 |
| `EffectsSection` | 1269 | 88 |

### `apps/desktop/src/core/session.ts`
| Função | Linha | Tamanho |
|---|---|---|
| `runLocalVision` | 728 | 125 |
| `runVision` | 873 | 115 |

## Não verificado

- Paridade preview × export e qualidade em mídia real: só há testes com mídia sintética (ver Fase 2).
- Causa raiz do teste instável: hipótese apenas.
- Os números de linha das funções mudam a cada edição; refazer a medição antes da Fase 1.

## Observações

- `CHANGELOG.md` ainda tem trechos com codificação corrompida (Fase 3).
- `docs/LIMITATIONS.md`, `STATUS.md` e `ROADMAP.md` ainda citam v0.7.0 (Fase 3).
