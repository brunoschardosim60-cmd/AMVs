Você vai desenvolver o AMV Studio neste repositório. Leia `AGENTS.md` por completo antes de qualquer ação — ele define produto, arquitetura travada, riscos técnicos, fases e regras.

Esta é a primeira sessão. Objetivo: entregar a **Fase 1 — Fundação** conforme os critérios de pronto do §8.

Ordem de trabalho:

1. **Inspecionar o ambiente**: versões de Node, pnpm, Rust, Python; se o repositório já tiver código, mapear o que existe e preservar o que funciona.
2. **Criar `docs/`**: `STATUS.md` com a lista de tarefas da Fase 1 quebrada em itens pequenos, `DECISIONS.md` com as decisões iniciais e `LIMITATIONS.md`.
3. **Esqueleto do monorepo** no layout do §2 (pnpm workspaces), TypeScript strict, lint, Vitest e pytest rodando, e workflow do GitHub Actions em `windows-latest`.
4. **Sidecar FFmpeg/FFprobe**: script que baixa binários de uma fonte oficial com checksum, registra como sidecar no Tauri, e um teste que executa `ffprobe -version` a partir do app.
5. **`packages/project`**: schema Zod v1, tempos em microssegundos inteiros, FPS racional, sistema de `Command` com undo/redo, serialização e teste de round-trip.
6. **Fila de jobs** com progresso real e cancelamento; jobs `probe`, `thumbnails`, `waveform` e `proxy` (H.264 8-bit, CFR, GOP curto — ver §3).
7. **Fixtures sintéticas** geradas por script com FFmpeg (incluindo um MKV, um arquivo VFR e um áudio com tons em BPM conhecido).
8. **UI**: design system base (tokens de cor escura, tipografia, espaçamentos), shell do app com a navegação global do §6 (só mostrar as telas que já existem de verdade; Music Hub, Translation Studio e assistente entram nas fases deles), tela inicial e importação mostrando os metadados.
9. **Salvar/abrir projeto**, recentes, detecção de asset ausente e relocalização por hash.

Ao final:
- Rodar todos os testes e o app.
- Atualizar `STATUS.md` com o que foi feito, o que foi testado e como, e o que ficou pendente.
- Listar no resumo final qualquer coisa que não foi possível verificar.

Não avance para a Fase 2 nesta sessão.
