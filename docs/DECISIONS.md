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
- O desktop inicia o serviço sob demanda, autentica com token por sessão e mantém o processo até o app fechar. O runtime empacotado é preferido no instalador; Python do sistema é fallback para desenvolvimento.
- Motivo: entregar timestamps locais sem enviar áudio a terceiros e manter o editor funcional sem Python. Não instalar dependências nem baixar pesos sem ação explícita do usuário.

## 2026-11-08 · Jobs, faixa de áudio e runtime Python empacotado
- Transcrição roda como job local autenticado com progresso em segundos de áudio e cancelamento cooperativo entre segmentos; cancelar não encerra o sidecar nem outros jobs.
- O stream escolhido é extraído pelo FFmpeg para WAV mono 16 kHz no cache do app. O original nunca é alterado; chave de cache inclui hash do asset e índice absoluto do stream.
- O instalador Windows inclui o serviço + faster-whisper via PyInstaller em modo onedir, em `resources/analyzer`; o app prefere esse executável e mantém Python do sistema como fallback de desenvolvimento. O CI constrói o bundle e verifica a API e a disponibilidade do módulo speech.
- Dependência de empacotamento: PyInstaller 6 (GPLv2 com exceção do bootloader); não é dependência do editor em execução. O artefato do CI Windows tem 406 MB (NSIS ~170 MB e MSI ~236 MB) e foi instalado em diretório temporário isolado; o app abriu. Pesos dos modelos seguem fora do instalador e baixam só quando solicitados.

## 2026-11-08 · Gemini oficial e descoberta de streaming
- Gemini usa o endpoint REST oficial `generateContent` (não a API compatível com OpenAI); a chave continua no cofre do sistema, o host é fixo em `generativelanguage.googleapis.com` e a configuração de envio externo continua desligada por padrão. O modelo inicial pode ser trocado pela lista retornada pela API.
- A busca YouTube deve usar YouTube Data API v3 com chave do usuário; reprodução, se viável no Tauri, fica no IFrame Player API oficial. O `search.list` tem cota, e o player precisa de iframe de pelo menos 200×200 px. Não extrair nem analisar o áudio do player.
- A busca Spotify pode usar Web API oficial; OAuth em app desktop deve usar Authorization Code com PKCE, sem client secret. Reprodução deve permanecer no Embed/player oficial; não usar preview como áudio do projeto nem presumir acesso a atributos de áudio.
- O CSP atual do Tauri não permite iframes nem conexões diretas aos domínios dos provedores. Não abrir esses domínios globalmente sem um spike de player e uma allowlist mínima; botão de abrir no app/site oficial é o fallback.
- Referências oficiais consultadas em 2026-11-08: [Gemini API](https://ai.google.dev/api/generate-content), [YouTube Search](https://developers.google.com/youtube/data/reference/rest/v3/search/list), [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference), [Spotify Search](https://developer.spotify.com/documentation/web-api/reference/search), [Spotify Authorization](https://developer.spotify.com/documentation/web-api/concepts/authorization), [Spotify Embeds](https://developer.spotify.com/documentation/embeds), [Spotify Terms](https://developer.spotify.com/terms).

## 2026-11-08 · Contexto musical na análise visual
- A análise com visão recebe BPM/confiança, seções/energia, posição dos drops, estilo/intensidade, até seis trechos de letra fornecida pelo usuário e somente as falas/legendas que cruzam cada cena amostrada. Não recebe o áudio nem o vídeo completos.
- A visão v2 retorna categorias controladas de ação/emoção, intensidade visual e confiança. A geração usa a intensidade do modelo apenas com confiança ≥ 0,55, sempre combinada com a análise local; ação/emoção ajustam levemente a seleção conforme seção/estilo. Sem rótulo v2 confiável, o comportamento local anterior permanece.
- Motivo: aproximar a seleção do significado e do arco visual sem entregar o projeto ao modelo, manter os cortes na grade determinística e limitar texto repetido/custo. O cache visual muda de v1 para v2 para forçar nova análise.
- Segurança: letras e falas são tratadas como dados, não instruções ao modelo; chamadas externas seguem desligadas até consentimento explícito. Letras só vêm de arquivo fornecido pelo usuário.

## 2026-11-08 · Correção manual da grade de batidas
- A biblioteca permite dobrar/dividir o BPM e reconstruir a grade por tap tempo; a correção é gravada atomicamente no cache da análise compartilhado pelo hash da faixa.
- O BPM corrigido alimenta os filtros/resumos da biblioteca, as marcações da timeline e as próximas montagens sem editar o arquivo original nem duplicar dados por projeto.
- O tap tempo usa os toques para estimar andamento e fase, com confiança manual máxima; continua sendo uma grade constante, não um mapa de andamento variável. Letras só vêm de arquivo fornecido pelo usuário.

## 2026-11-09 · Alinhamento de letra sem timestamps
- TXT fornecido pelo usuário é alinhado à transcrição local do arquivo de música com correspondência aproximada de tokens em ordem; para texto japonês, a comparação usa caracteres para não depender de segmentação por espaços.
- Correspondências abaixo do limiar são omitidas; correspondências parciais são mantidas como incertas e reportadas para revisão. Os tempos passam pelo helper comum de mapeamento de cues, respeitando aparo e velocidade do clipe selecionado.
- Motivo: dar sincronização revisável sem enviar áudio para serviços externos nem adicionar dependências. A transcrição de música cantada é inerentemente incerta e não é apresentada como sincronização garantida.

## 2026-11-09 · Tipografia animada consciente de impactos
- Falas e letras geradas são exibidas em frases curtas com animação pop/fade, usando o mesmo renderizador de texto do preview e da exportação. Clipes curtos usam animações proporcionais à duração para a frase não ficar invisível.
- Legendas de música podem aproximar o início à batida vizinha (até 100 ms), mas são omitidas quando cruzam falas ou janelas de impacto/drop; cada omissão aparece em `warnings`. A palavra da letra no drop recebe destaque dourado.
- Motivo: integrar tipografia ao ritmo e preservar os instantes visuais importantes. Como não há timestamps por palavra da fala, a divisão de frases é proporcional à duração do segmento e continua aproximada.

## 2026-11-09 · Modo Aberto e estilo de cortes rápidos
- O modo Aberto recomenda estilo com uma pontuação local, reproduzível e explicável, usando análises já existentes de música, cenas, falas, letra e visão. Não faz uma chamada de IA nem afirma reconhecer conteúdo que não foi analisado.
- Impacto rápido divide o intervalo entre batidas em meia batida para favorecer cortes curtos sincronizados; a seleção de cenas dá prioridade explícita a tags de ação/impacto. O mínimo de 0,2 s protege legibilidade e estabilidade.
- A geração continua restrita aos episódios selecionados. A UI expõe Todos/Nenhum e contagens de cenas/lutas para deixar claro o conjunto analisado.

## 2026-11-09 · Encaixe contextual de música, letra e cenas
- Recomendações locais consideram BPM, intensidade, duração e a compatibilidade entre a curva de energia da faixa e as intensidades das cenas selecionadas; cada sugestão expõe os sinais usados.
- A correspondência semântica entre até seis versos temporizados e quadros de cena é opcional, desligada por padrão e só roda por ação explícita. Reanalisa quadros do escopo escolhido, respeita o opt-in de envio externo e acrescenta justificativa aos clipes escolhidos; sem isso, a montagem permanece local e heurística.
- Motivo: aproximar música e imagem sem esconder custo nem transformar análise de IA em requisito. As correspondências semânticas são temporárias na janela de geração e precisam ser refeitas se ela for fechada.
- Falas com maior pontuação de impacto recebem fonte maior; a tradução da letra não é automática, então só se exibe o texto sincronizado fornecido pelo usuário.

## 2026-11-09 · Fase 1 do roadmap profissional de AMV
- A tipografia continua como clipes de texto normais e não destrutivos. Aumentar o schema exige migrar projetos v1; defaults de migração mantêm o look antigo.
- Os timestamps de palavra são relativos ao clipe, guardam origem/confiança quando disponíveis e nunca são inferidos dividindo igualmente o tempo do segmento. Sem tempos de palavra, a frase continua uma unidade revisável.
- ASS karaoke e LRC enhanced de uma palavra por timestamp fornecem tempos com origem própria; faster-whisper fornece tempos de origem Whisper, exibidos como sugestão. Edição manual é outro comando com undo. LRC enhanced com trechos de várias palavras por timestamp permanece como frase, sem subdivisão artificial.
- Fundos, alinhamento e realce por palavra são desenhados pelo mesmo `drawTextLayer` usado no preview e na exportação rasterizada. Sem segunda implementação visual.
- SAM 2.1 Hiera Tiny foi selecionado para um spike local de CPU, sem aprovação de qualidade para produção. Código e checkpoint oficial são Apache-2.0; a instalação de dependências/pesos no instalador principal foi escolhida pelo usuário, sujeita aos gates de tamanho, memória e estabilidade.
- Referência: [roadmap profissional](./ROADMAP_PRO_AMV.md), [SAM 2 oficial](https://github.com/facebookresearch/sam2).

## 2026-11-09 · Spike local de isolamento temporal com SAM 2.1 Tiny
- SAM 2.1 Hiera Tiny é o candidato recomendado para o primeiro spike por combinar prompt por pontos/caixas com propagação temporal. O upstream licencia código e checkpoints Apache-2.0 e lista 38,9 milhões de parâmetros para Tiny. O INSTALL declara Linux, recomenda WSL no Windows, requer PyTorch ≥2.5.1/TorchVision correspondente e documenta a extensão CUDA opcional; velocidade publicada foi medida em A100.
- Cutie e XMem propagam máscaras, mas seus exemplos/documentação não resolvem sozinhos a seleção inicial por clique; Cutie declara teste em Ubuntu. Seus termos de checkpoint ainda requerem revisão.
- O host Windows disponível reporta Ryzen 5 3600, 16 GB de RAM e AMD Radeon RX 580 4 GB, sem CUDA. O uso de DirectML não será presumido. Não há números de RAM/FPS para inferência CPU do vídeo publicados pelo upstream nem medidos neste projeto.
- O usuário escolheu testar SAM 2.1 Tiny em CPU e incluir runtime/pesos no instalador principal. Em Windows nativo, o sidecar PyInstaller empacotado processou via FFmpeg um clipe sintético de 3 quadros 256×256 a 1 fps em 13,95 s após iniciar o serviço; a máscara acompanhou o objeto nos três quadros e não acionou revisão heurística. O pico de working set do processo, amostrado a cada 400 ms, foi ~1.079 MiB.
- O bundle PyInstaller foi validado por smoke test e inferência real com o checkpoint. O tamanho descompactado do sidecar é 745,9 MiB, dos quais 148,8 MiB são o checkpoint. O instalador Tauri ainda não foi construído. O pico de RAM e a qualidade com anime não foram medidos.
- O cancelamento de um job real foi solicitado durante a propagação; o job terminou como `cancelled` e não deixou diretório parcial. A extensão nativa `_C` não está disponível nesta instalação; o upstream informa que, nesse caso, o preenchimento de buracos é ignorado. O caso sintético passou, mas o runtime não está aprovado para qualidade de produção.
- A prova de conceito gera sequência PNG RGBA e máscaras PNG, com cache, jobs autenticados, progresso e cancelamento. Ainda não há schema/asset de sequência integrado, UI de seleção/correção, composição no preview ou renderização/exportação. Não habilitar o recurso na interface até esses fluxos serem reais.
- Especificação, dependências e critérios de aceitação: [roadmap de isolamento temporal](./ROADMAP_CHARACTER_CUTOUT.md).

## 2026-11-09 · Gate de qualidade do SAM 2.1 Tiny
- O benchmark de CPU em Windows com animação sintética de 10/30/60 s foi concluído a 256×256 e 1 quadro/s. IoU médio: 0,8715, 0,0635 e 0,4424; os ensaios de 30/60 s falharam em todos os quadros segundo IoU < 0,75. A sinalização `reviewFrames` permaneceu vazia, pois a heurística atual mede área e variação da área, não a qualidade da máscara.
- Decisão: **REPROVADO para avançar o gate de integração**. Isto não é uma conclusão de que SAM 2 nunca possa servir ao caso; não houve teste com anime autorizado, múltiplos prompts nem correção manual. Requer dados reais anotados e nova avaliação antes de integrar.
- `_C` faz o preenchimento opcional de buracos pequenos via componentes conectados. O upstream só oferece construção CUDA (`CUDAExtension`/`.cu`); no host CPU/Radeon não há comparação ou instalação compatível. SciPy/OpenCV são alternativas CPU a avaliar, mas não foram instaladas nem testadas.
- Relatório, métricas e comparações sintéticas: [benchmark SAM 2.1](./SAM2_QUALITY_BENCHMARK.md). Os PNGs são explicitamente sintéticos, não evidência de qualidade em anime.
- Para a Fase 2.2, não buscar vídeos aleatórios na internet. A pasta de entrada fica em `C:\Users\Bruno\Videos\AMV-SAM2-Quality`, fora do Git. A avaliação real permanece bloqueada até receber clipes próprios/licenciados.
- O predictor SAM 2 fixado oferece pontos positivos/negativos por quadro (`add_new_points_or_box`) e máscara binária por quadro (`add_new_mask`). A possibilidade de usar esses prompts para corrigir o estado e propagar novamente é tecnicamente fundamentada no upstream, mas ainda não existe protótipo do ciclo nem teste local com o modelo; não considerar implementado.

## 2026-11-09 · Fase 2.2 — teste visual real de SAM 2.1 Tiny
- O usuário autorizou o processamento local do episódio fornecido. Foi processado um segmento de 3 s (72 quadros, 1280×720, 24000/1001 fps) com o runtime isolado já verificado, sem CUDA e sem `_C`.
- A propagação inicial levou 338,296 s, cerca de 4,699 s/quadro (0,2128 quadro/s), com working set máximo observado de 2404,6 MiB. A máscara inicial perdeu completamente o alvo após a troca de plano; amostras posteriores mostram silhueta incompleta/vazamento.
- Adicionar pontos positivos/negativos ao estado propagado no quadro 36 e repetir a propagação não alterou a máscara vazia. Um teste isolado com novos pontos no mesmo quadro gerou somente uma máscara parcial de pernas/roupa, ~5,023% da imagem.
- Decisão mantida: **REPROVADO para integração**. Os resultados reais reforçam que a saída não é confiável sem revisão, mas não cobrem todos os cenários nem substituem ground truth anotado; não são uma avaliação geral do modelo.
- A música fornecida não foi usada nesta validação visual. Nenhum clipe foi copiado ao repositório, e não houve mudança na UI, timeline, instalador ou dependências do app.
- Comparativos, prompts e medições ficaram fora do Git em `C:\Users\Bruno\Videos\AMV-SAM2-Quality\resultados`; ver [relatório SAM 2.1](./SAM2_QUALITY_BENCHMARK.md).

## 2026-11-09 · Fase 2.3 — gate visual do SkyTNT ISNet_IS
- Testar primeiro o ONNX oficial do `skytnt/anime-seg` isoladamente, sem instalar dependências no app, e só executar a etapa temporal se os quadros individuais fossem utilizáveis.
- Em cinco quadros do episódio, com o pré-processamento documentado pelo Space oficial, a máscara teve alpha médio entre 0,00010 e 0,02072 e nenhum pixel acima de 0,5. Tempo médio: 1,9284 s/quadro; pico de working set observado: 1761,7 MiB.
- Decisão preliminar: reprovação da execução ONNX a 1024, com verificação PyTorch ainda pendente à época. A Fase 2.4 abaixo revisa o diagnóstico: o tamanho oficial do checkpoint é 640 e a conversão ONNX concorda com PyTorch a 1024.
- A publicação oficial só contém pesos `isnet_is`; o código implementa `isnet` e `isnet_is` com a mesma classe de inferência `ISNetDIS`, mas não há pesos independentes `isnet`. Também não há pesos U2Net na publicação. Não comparar nomes de arquitetura com o mesmo checkpoint e chamar isso de avaliação independente.
- CUTIE permanece candidato experimental de propagação que recebe uma máscara rotulada inicial; CPU/Windows e termos dos pesos não estão verificados. O código é MIT; não foi presumida a mesma licença para os pesos.
- A detecção exploratória de cena pelo FFmpeg mostrou scores altos em mudanças visuais do trecho, mas flashes/efeitos também podem acionar o detector; qualquer reinicialização de tracking requer revisão.
- Relatório e imagens: [benchmark de segmentação alternativa](./ALTERNATIVE_ANIME_SEGMENTATION_BENCHMARK.md). Testes e pesos locais ficam fora do Git; sem mudanças na interface, timeline, instalador ou dependências do produto.

## 2026-11-09 · Fase 2.4 — validar checkpoint SkyTNT no PyTorch original
- O checkpoint oficial `isnetis.ckpt` foi obtido apenas da URL oficial e seu SHA-256 esperado foi validado antes do carregamento: `2c8f6b9a77386c54dcdbf55b6c917108c4bdf4328abca9152c7bce5727b74d18`.
- Executado o `inference.py` do repositório oficial (commit `55d874013a2811cdf59c365059174c7823acf5b4`), CPU FP32, nos mesmos cinco quadros, em 640 e 1024. O `config.json` HF declara `isnet_is` e `img_size: 640`.
- A entrada RGB float32 NCHW, normalização `/255`, letterbox central e remoção do padding seguiram `inference.py`. `AnimeSegmentation.forward` aplica sigmoid; a saída ONNX já contém sigmoid e não foi novamente ativada nem invertida.
- PyTorch e ONNX, ambos a 1024 e alimentados com o mesmo tensor, coincidiram com MAE de `1.7e-8` a `7.4e-8` e erro absoluto máximo `1.92e-6`. Portanto não atribuir a falha observada a conversão ou runtime; a execução ONNX inicial estava em tamanho diferente do config publicado.
- A 640, o primeiro quadro teve uma máscara visível mas com vazamentos; o segundo foi fraco, quadros de ação 02/03 ficaram praticamente vazios e o 04 não gerou região opaca (`max alpha 0.402`). Decisão: **recorte automático SkyTNT em espera; insuficiente para uso confiável neste material.** Não executar tracking, benchmark de 72 quadros nem instalar CUTIE.
- Inferência média PyTorch: `0.748 s/quadro` a 640 e `1.878 s/quadro` a 1024, seis threads. Sem ground truth, a avaliação de qualidade é visual e limitada aos cinco quadros.
- Resultados/PNG/JSON e checkpoint permanecem fora do Git. Nenhuma alteração na interface, timeline, instalador ou dependências do produto.
