# AMV Studio

App desktop (Tauri + React + Python) para criar Anime Music Videos com editor não linear, montagem automática assistida por IA, Music Hub e Translation Studio.

- Especificação, arquitetura e regras: [`AGENTS.md`](AGENTS.md)
- Andamento: [`docs/STATUS.md`](docs/STATUS.md) · decisões: [`docs/DECISIONS.md`](docs/DECISIONS.md) · limitações: [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)

## Baixar e testar no Windows

Cada push gera um instalador em **Actions → CI → AMV-Studio-Windows** (artefato `.exe`/`.msi`).

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
services/analyzer   sidecar Python de análise (opcional)
scripts             fixtures sintéticas e download do FFmpeg
```
