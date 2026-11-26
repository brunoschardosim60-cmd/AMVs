# AMV Studio

App desktop (Tauri 2 + React/TypeScript + sidecar Python opcional) para criar Anime Music Videos com editor não linear multipista, montagem automática auditável, Music Hub e Translation Studio.

O que faz:
- **Editor** multipista com preview por proxy, efeitos, transições, tipografia, mixagem e exportação até 4K a partir dos originais intactos.
- **Gerar meu AMV**: analisa música, cenas, falas e legendas e monta o vídeo em estilos editoriais com clipes 100% editáveis e justificativa (`reason` + `confidence`).
- **Assistente**: pedidos em português viram propostas (`ChangeSet`) que você aprova antes de aplicar. Funciona offline ou com provedores configuráveis.
- **Músicas**: biblioteca local com análise de BPM/energia, filtros, comparação e recomendações.
- **Legendas**: importar SRT/ASS/VTT/LRC, extrair do episódio, sincronizar, traduzir e exportar.

Documentação principal:
- Especificação, arquitetura travada e invariantes: [`AGENTS.md`](AGENTS.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Estado atual, roadmap e decisões: [`docs/STATUS.md`](docs/STATUS.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md) · [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Limitações conhecidas e histórico arquivado: [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)
- Baseline técnico e métricas de complexidade: [`docs/BASELINE.md`](docs/BASELINE.md)
- Protocolo de validação com mídia real e checklist Windows: [`docs/VALIDACAO_REAL.md`](docs/VALIDACAO_REAL.md) · [`docs/TESTE_MANUAL_WINDOWS.md`](docs/TESTE_MANUAL_WINDOWS.md)
- Proposta de organização da interface (`Modo Pro`): [`docs/PROPOSTA_MODO_PRO.md`](docs/PROPOSTA_MODO_PRO.md)
- Direção editorial e critérios de qualidade: [`docs/prompts/AMV_EDITORIAL_PROMPT.md`](docs/prompts/AMV_EDITORIAL_PROMPT.md) · [`docs/AMV_EDITORIAL_QUALITY.md`](docs/AMV_EDITORIAL_QUALITY.md)

## Baixar e testar no Windows

Baixe o instalador NSIS em **Releases** (versão mais recente). O instalador atualiza a pasta única em `%LOCALAPPDATA%\AMV Studio`.

## Desenvolvimento

Requisitos: Node 22+, pnpm 10, Rust estável. No Windows, o WebView2 já vem com o sistema.

```bash
pnpm install
pnpm ffmpeg      # baixa o FFmpeg para src-tauri/binaries (Windows) ou copia o do sistema (Linux/macOS)
pnpm fixtures    # gera mídia de teste sintética
pnpm typecheck   # validação estática TypeScript em todos os pacotes
pnpm test        # testes unitários e de integração com FFmpeg real
pnpm dev         # abre o app em modo desenvolvimento
```

Estrutura:

```text
apps/desktop        app Tauri + React (core/ = lógica testável, features/ = telas)
packages/project    modelo do projeto, comandos puros, undo/redo, migrações
packages/media      FFmpeg: probe, proxy, miniaturas, waveform, fila de jobs
packages/render     projeto → grafo FFmpeg (exportação)
packages/analysis   análise de música, episódio e legendas
packages/automv     planejamento, pontuação, revisão e reparo automático de AMVs
packages/subtitles  operações puras de legendas (SRT/ASS/VTT/LRC)
packages/music      biblioteca de músicas e recomendação
packages/assistant  provedores de IA, ferramentas e ChangeSet
packages/sfx        síntese local de efeitos sonoros
packages/sound-design biblioteca e sugestões locais de sound design
services/analyzer   sidecar Python opcional (Whisper / recorte neural)
scripts             fixtures sintéticas, release e download do FFmpeg
```
