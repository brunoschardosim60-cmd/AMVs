# AMV Studio

App desktop (Tauri + React + Python) para criar Anime Music Videos com editor não linear, montagem automática assistida por IA, Music Hub e Translation Studio.

O que já faz:
- **Editor** multipista com preview, efeitos, transições, textos, mixagem e exportação até 4K a partir dos originais.
- **Gerar meu AMV**: analisa a música (BPM, drop) e os episódios (cenas, falas, gritos, legendas) e monta o vídeo em 5 estilos, tudo editável.
- **Assistente**: pedidos em português viram propostas que você aprova item por item. Funciona offline ou com Ollama, Claude, OpenAI e compatíveis.
- **Músicas**: biblioteca com análise, filtros, playlists, comparação, player persistente e recomendação por tema.
- **Legendas**: importar SRT/ASS/VTT/LRC, encaixar as falas do episódio, editar, sincronizar e exportar.

- Especificação, arquitetura e regras: [`AGENTS.md`](AGENTS.md)
- Andamento: [`docs/STATUS.md`](docs/STATUS.md) · decisões: [`docs/DECISIONS.md`](docs/DECISIONS.md) · limitações: [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)

## Baixar e testar no Windows

Baixe o instalador em **Releases** (a versão mais nova). Depois de instalado, o app se atualiza sozinho.

## Desenvolvimento

Requisitos: Node 22+, pnpm 10, Rust estável. No Windows, o WebView2 já vem com o sistema.

```bash
pnpm install
pnpm ffmpeg      # baixa o FFmpeg para src-tauri/binaries (Windows) ou copia o do sistema (Linux/macOS)
pnpm fixtures    # gera mídia de teste sintética
pnpm test        # testes, incluindo integração com FFmpeg real
pnpm dev         # abre o app
```

Estrutura:

```
apps/desktop        app Tauri + React (core/ = lógica testável, features/ = telas)
packages/project    modelo do projeto, comandos, undo/redo, serialização
packages/media      FFmpeg: probe, proxy, miniaturas, waveform, fila de jobs
packages/render     projeto → FFmpeg (exportação), mesma matemática dos efeitos do preview
packages/analysis   análise de música e de episódio, legendas (parse)
packages/automv     Gerar meu AMV (montagem determinística por estilo)
packages/subtitles  legendas na timeline (importar, puxar do episódio, exportar)
packages/music      biblioteca de músicas e recomendação
packages/assistant  assistente: provedores de IA, ferramentas, propostas (ChangeSet)
services/analyzer   sidecar Python de análise (opcional)
scripts             fixtures sintéticas e download do FFmpeg
```
