# Decisões

Registro de decisões técnicas. Formato: data · decisão · motivo · alternativas.

## 2026-11-06 · Monorepo pnpm + pacotes puros
- `packages/project` (modelo, comandos, undo/redo, serialização) e `packages/media` (FFmpeg) não dependem de React nem Tauri.
- Motivo: testáveis em Node com FFmpeg real; o app só injeta implementações (`ProcessRunner`, `FileSystem`).

## 2026-11-06 · Comandos como dados com inverso calculado
- Cada `Command` é JSON puro; `applyCommand` devolve o projeto novo e o comando inverso calculado do estado anterior.
- Motivo: undo/redo, autosave, ChangeSets da IA (aprovação parcial) e testes usam o mesmo mecanismo. Comandos são serializáveis (podem ir para log/IA).
- `batch` é atômico: se um subcomando falha, nada muda.

## 2026-11-06 · Tempo em µs inteiros, FPS racional
- `frameToUs` arredonda para cima para garantir `usToFrame(frameToUs(f)) === f` (bug pego em teste com 23,976).

## 2026-11-06 · Serialização canônica
- `serializeProject` passa pelo schema Zod (ordem de chaves estável, diffs limpos) e recusa salvar projeto inconsistente.

## 2026-11-06 · Hash parcial v1
- SHA-256 de tamanho + primeiro MiB + último MiB. Rápido para episódios de GB. Usado para cache e relocalização. Não é prova de identidade.

## 2026-11-06 · Waveform por stream de PCM
- FFmpeg decodifica para PCM mono 8 kHz no stdout; picos min/max calculados em pedaços (memória constante). Base de 10 ms por bucket, níveis 2×. Formato binário próprio `AMVW` v1.

## 2026-11-06 · Folha de miniaturas com `-skip_frame nokey` + fallback
- Rápido para episódios inteiros. HEVC com poucos keyframes gera saída vazia com código 0 → o pipeline detecta e refaz decodificando tudo.
- Regra geral: FFmpeg com código 0 e sem arquivo de saída é ERRO (`atomicOutput`).

## 2026-11-06 · Dependências
- `zod` 3.x (MIT) — schema do projeto.
- `vitest` (MIT), `typescript` (Apache-2.0) — dev.

## 2026-11-06 · Lógica do app fora da interface (`ProjectSession`)
- Criar/abrir/salvar/importar/relocalizar/autosave ficam em `apps/desktop/src/core`, sem React, recebendo uma `Platform`.
- Motivo: os mesmos testes rodam com FFmpeg real em Node; a interface só assina mudanças.
- Mudanças do sistema (mídia ficou pronta, arquivo não encontrado) usam `applySystem`: não entram no undo e não marcam o projeto como modificado.

## 2026-11-06 · FFmpeg GPL empacotado — ATENÇÃO para distribuição
- O build do BtbN usado no Windows é **GPL** (inclui libx264/libx265, necessários para proxies e exportação H.264/H.265).
- Distribuir o instalador com esse FFmpeg exige cumprir a GPL (oferecer o código-fonte do FFmpeg e respeitar a licença na distribuição). Para uso pessoal não há problema.
- Alternativa futura: build LGPL + encoders de hardware (NVENC/QSV/AMF) ou baixar o FFmpeg na primeira execução. Decidir antes de vender ou publicar o app.

## 2026-11-06 · Escopo de arquivos amplo
- `fs` e asset protocol com escopo `**` (incluindo pastas que começam com ponto).
- Motivo: editor local precisa ler mídia de qualquer pasta/disco que o usuário escolher. O webview não carrega conteúdo remoto (CSP restrita), o que limita o risco.

## 2026-11-06 · Fonte e ícones
- Manrope (variável, SIL OFL) empacotada via `@fontsource` — o app funciona offline. Ícones `lucide-react` (ISC).

## 2026-11-06 · Dependências do app
- React 19, Zustand 5 (MIT), Tauri 2 + plugins dialog/fs/shell (MIT/Apache-2.0), Tailwind 4 (MIT), Vite 7 (MIT).
- Python: FastAPI, Uvicorn (MIT/BSD).
