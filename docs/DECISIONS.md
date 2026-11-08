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
- Rápido para episódios inteiros. HEVC com poucos keyframes não gera nada: no FFmpeg 6 sai com código 0 e sem arquivo; no 7+ falha ("Could not open encoder before EOF", pego pelo CI no Windows). Nos dois casos o pipeline refaz decodificando tudo.
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

## 2026-11-07 · Assistente de IA: provedores, cofre e HTTP
- Provedores atrás de uma interface (`packages/assistant`): API compatível com OpenAI (OpenAI, Ollama, LM Studio, OpenRouter, Groq) e API de mensagens da Anthropic. Sem streaming por enquanto.
- Chaves no cofre do sistema via crate `keyring` 3 (MIT/Apache-2.0): Gerenciador de Credenciais no Windows, Keychain no macOS, keyutils no Linux. Nunca em arquivo.
- Chamadas HTTP pelo `tauri-plugin-http` (MIT/Apache-2.0): sem CORS, funciona com Ollama local. Escopo: `https://*`, `http://localhost:*`, `http://127.0.0.1:*`.
- O modelo nunca muda o projeto: ferramentas `propose_*` devolvem um ChangeSet; o usuário escolhe os itens, testa (aplica e volta) e aplica num único desfazer.
- Sem modelo ligado, o chat entende pedidos diretos por palavras-chave e roda as mesmas ferramentas (funciona offline).
- Envio para serviço na internet só com a permissão marcada; endereço local não precisa.

## 2026-11-07 · Músicas e legendas
- `packages/music`: biblioteca global (arquivo `biblioteca-musicas.json` na pasta do app), recomendação por tema com pontuação vinda da análise real; reaproveita o cache de análise dos projetos (mesmo hash).
- `packages/subtitles`: legendas são clipes de texto comuns; importar SRT/ASS/VTT/LRC, puxar falas do episódio pelo trecho de origem do clipe, exportar SRT/VTT/LRC.

## 2026-11-07 · Sincronia, lutas e tradução (0.6.0)
- **Viés de batida medido, não suposto**: com cliques sintéticos em instantes conhecidos, toda batida saía −24 ms. Causa: `offsetS` assumia janela centrada (`size/2`), mas o quadro começa em `f·hop` e o fluxo espectral compara com o quadro anterior (faltava 1 salto). Correção `offsetS = (size/2 + hop)/sr` + interpolação parabólica do pico. `MUSIC_ANALYSIS_VERSION` m1→m2 (cache antigo é refeito). Teste trava viés < 4 ms.
- **Lutas por ritmo, sem visão**: `buildSequences` junta planos intensos (≥ 0,4) tolerando pausas frias de até 6 s; cena escura ou pausa maior separa. `EPISODE_ANALYSIS_VERSION` e1→e2 (também grava `peakS` por plano).
- **Estoque de lutas por contagem de cenas**: cada corte gasta uma cena, então "segundos de imagem" não basta. Junta a próxima luta só se a atual cobrir < 70% dos cortes previstos; acima disso, repetir um pouco é preferível a misturar outra luta (pedido explícito do usuário).
- **Faixa de áudio**: uma única regra (`pickAudioStreamByLanguage`) para análise e para a fala; padrão = original (japonês).
- **Tradução** reaproveita o provedor de IA do Assistente (sem dependência nova); o original fica em `text.original` (campo opcional, sem migração de schema) e a tradução sempre parte dele.
- **YouTube/Spotify**: mantida a decisão do AGENTS.md §3 — não extrair áudio de streaming.

## 2026-11-08 · Efeitos sonoros, visão e achados de interface
- **Drop por batida**: a grade de 4 compassos perdia ou atrasava o drop. Candidatos = cada batida; salto = energia dos 4 s depois − 4 s antes; seções ganham um limite exato no drop. `MUSIC_ANALYSIS_VERSION` m3.
- **Efeitos sintetizados por código** (`@amv/sfx`): sem licença, determinísticos, versionados no nome do arquivo. Ficam como mídia com a tag `sfx` (fora das listas) e a trilha "Efeitos" já existia. O sorteio de efeitos usa semente própria: ligar efeitos não muda a escolha das cenas (teste garante).
- **Seletividade dos golpes**: a 1ª versão colocava 45 golpes em 60 s (metralhadora); agora espaçamento ≥ 0,75 s e prioridade pela força da cena.
- **Visão opcional e retomável**, separada da análise de ritmo (arquivo `vision-v1.json` por episódio): custa chamadas ao modelo, então só roda quando pedida; mostra custo antes; local (Ollama) não envia nada.
- **Teste de interface real**: harness (`apps/desktop/dev`) roda o app num Chromium com ponte para FFmpeg/arquivos. Achou o botão Importar inclicável e a trilha Efeitos escondida, que a leitura de código não mostrou. Hipótese refutada: o `Dialog` não roubava foco.

## 2026-11-08 · Escopo da análise visual
- A visão oferece o modo rápido (prioriza lutas, 1 quadro por cena, até 120 cenas) e o detalhado (todas as cenas úteis, 3 quadros por cena, sem limite fixo).
- No modo detalhado, rótulos antigos com uma amostra são reprocessados. A saída combina personagens e exige maioria clara para marcar luta.
- Motivo: aumentar a cobertura e reduzir a classificação equivocada de uma cena sem aumentar o custo de todas as gerações. Não foi adicionada dependência; o modo detalhado avisa a estimativa antes de enviar quadros.

## 2026-11-08 · Calibração manual da sincronia
- A geração aceita ajuste entre −500 e +500 ms para deslocar batidas, cortes, drop e falas em relação à faixa de música, sem deslocar o áudio.
- Motivo: tornar corrigível um deslocamento constante sem fingir que o rastreador atual resolve deriva de andamento variável. A calibração com músicas reais continua necessária.

## 2026-11-08 · Transcrição local via faster-whisper
- O serviço Python passa a oferecer transcrição autenticada por arquivo local, com timestamps por segmento e palavra; modelo `small`/CPU/int8 por padrão e tamanhos configuráveis.
- `faster-whisper` é extra opcional (MIT); a instalação adiciona CTranslate2 e dependências nativas, e os pesos são baixados sob demanda (o tamanho depende do modelo, de centenas de MB a vários GB). Não baixar nem iniciar modelo até a pessoa solicitar a transcrição.
- O desktop inicia o serviço sob demanda via `python`/`py -3`, autentica com token por sessão e mantém o processo até o app fechar. O instalador ainda não empacota o runtime Python; o usuário precisa instalar o extra no ambiente Python.
- Motivo: entregar timestamps locais sem enviar áudio a terceiros e manter o editor funcional sem Python. Não instalar dependências nem baixar pesos sem ação explícita do usuário.
