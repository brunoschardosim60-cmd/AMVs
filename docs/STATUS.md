# Status

Fases 1 a 5 feitas; 6 (assistente), 7 (músicas) e 8 (legendas) com a primeira versão completa. ~150 testes TS com FFmpeg real e LLM simulado. Falta o teste manual no Windows do Bruno.

## Fase 1 — Fundação

| Item | Estado | Como foi verificado |
|---|---|---|
| Monorepo (pnpm), TS strict, Vitest, pytest | feito | `pnpm typecheck`, `pnpm test` |
| Modelo do projeto: schema v2, µs inteiros, FPS racional | feito | testes `packages/project`, incluindo migração v1 → v2 |
| Comandos com inverso, histórico undo/redo, transações | feito | testes: todo comando + inverso = original; batch atômico; projeto nunca mutado |
| Salvar/abrir com round-trip idêntico, migrações, erros claros | feito | testes de serialização |
| FFmpeg/FFprobe como sidecar do Tauri | feito | app real rodando no Linux (Xvfb) processou mídia pelo sidecar; Windows: CI baixa build GPL do BtbN com checksum |
| Probe: MP4/MOV/MKV/WEBM/MP3/WAV/FLAC/PNG/JPG, VFR, 10-bit, capa de MP3, idiomas | feito | testes com FFmpeg real em fixtures sintéticas |
| Proxy H.264 8-bit CFR, GOP ~0,5 s, progresso real, cancelamento | feito | teste mede intervalo de keyframes; cancelar não deixa arquivo pela metade |
| Pôster, folha de miniaturas (com fallback HEVC), waveform multinível | feito | testes; waveform acha os 16 cliques de 120 BPM |
| Fila de jobs: prioridade, concorrência, cancelamento, dedupe | feito | testes |
| Cache por hash parcial; reabrir não reprocessa | feito | teste de sessão |
| Tela inicial: novo, abrir, continuar, recentes, favoritos | feito | captura de tela do app real |
| Importação (botão, Ctrl+I, arrastar e soltar) com metadados e avisos | feito | captura de tela do app real; testes de sessão |
| Mídia ausente: aviso, localizar arquivo (confere hash), procurar numa pasta | feito | testes de sessão + captura de tela |
| Autosave a cada 30 s e recuperação após queda | feito | teste de sessão |
| Atalhos: Ctrl+N/O/S/Shift+S/I/Z/Shift+Z/Y; bloqueio de atalhos do navegador | feito | código; verificação manual pendente no Windows |
| Aviso ao fechar com alterações não salvas | feito | código; verificação manual pendente no Windows |
| Sidecar Python opcional (esqueleto: saúde, módulos, token) | feito | pytest |
| CI no Windows: testes + instalador NSIS/MSI | feito | Release v0.6.5, run 42551137777 verde: runtime Python, typecheck, suíte completa e instaladores assinados; Release e `latest.json` apontam para 0.6.5. |

### Pendente de verificação no Windows
- Reprodução do proxy no painel de detalhes (WebView2). No Linux de desenvolvimento não dá para testar: o WebKitGTK não toca mídia pelo protocolo de arquivos do Tauri.
- Diálogos nativos de abrir/salvar e o arrastar e soltar no Explorer.

## Distribuição
| Item | Estado | Como foi verificado |
|---|---|---|
| Atualização automática (plugin updater, assinatura minisign) | feito | Release v0.6.5 publicada com `latest.json` e assinaturas; o manifesto aponta para 0.6.5 e os instaladores NSIS/MSI respondem HTTP 200. |
| Publicar versão: `node scripts/release.mjs x.y.z --push` (branch `release`) | feito | v0.6.5 publicada pelo workflow Release run 42551137777 |

## Fase 2 — Editor (em andamento)

| Item | Estado | Como foi verificado |
|---|---|---|
| Operações: inserir, dividir, aparar, mover em grupo com sobrescrita, excluir (com/sem fechar buraco), copiar/colar/duplicar, encaixe | feito | 18 testes em `packages/project/test/edit.test.ts` |
| Timeline: régua, trilhas, travar/ocultar/silenciar, zoom (Ctrl+roda, botões, "ajustar tudo"), miniaturas e forma de onda nos clipes | feito | app real no Linux (Xvfb) |
| Arrastar mídia da biblioteca para a timeline (eventos de ponteiro, não HTML5 DnD) | feito | app real; bug de clipe duplicado achado e corrigido |
| Arrastar clipes (entre trilhas do mesmo tipo), aparar pelas bordas, encaixe com linha guia | feito | app real |
| Preview: player sincronizado com proxies, composição em canvas (posição, escala, rotação, opacidade, recorte, texto) | feito | Chromium headless com vídeo de tempo gravado: quadro certo em 3 posições, incluindo tocando |
| Revisão manual de cenas: prévia do trecho, ajuste de entrada/saída e montagem de vários em sequência | feito | painel Cenas usa proxy mudo; cada trecho entra como clipe separado, numa única ação de undo; typecheck/build |
| Painel de propriedades: tempo, velocidade, deslizar origem, transformar, volume e fades | feito | app real |
| Atalhos: Espaço, S, Delete (Shift = fechar buraco), Ctrl+C/X/V/D/A, setas (Shift = 10 quadros), Home/End, +/− | feito | app real (parcial) |
| Preview de vídeo no Windows (WebView2) | pendente | depende do teste do Bruno |

## Fase 3 — Processamento (feita)

| Item | Estado | Como foi verificado |
|---|---|---|
| Render por janelas + concat sem recodificar, a partir dos originais | feito | 10 testes em `packages/render` conferindo pixels/volume do arquivo final |
| Efeitos e transições com a mesma fórmula no preview e no render | feito | testes de `evalClipLook`/rampas + render |
| Textos desenhados pelo mesmo código no preview e na exportação | feito | app real: exportação 1080p com texto conferida quadro a quadro |
| Mixagem: ganho, fades, faixa de áudio, ducking por keyframes, limitador | feito | teste de volume (−30 dB → −50 dB) |
| Diálogo de exportação: formato, resolução, qualidade, progresso, cancelar, mostrar na pasta | feito | app real (Linux) |

### Limitações da Fase 2
- O preview aplica ganho acima de 0 dB com Web Audio e compressão de pico; a seleção de faixa ainda não é respeitada, pois o proxy inclui a primeira faixa de áudio. O comportamento de áudio precisa ser confirmado no WebView2.

### Ajuste do ganho no preview
- `clipVolume()` agora preserva ganho linear acima de 1 para clipe, trilha e keyframes. O preview usa `GainNode` seguido de `DynamicsCompressorNode`; erros de preparação/reprodução do áudio são notificados.
- Validação: 4 testes focados passaram; typecheck e build desktop passaram. A suíte ampla teve 7 falhas em testes de importação de biblioteca/sessão, fora dos arquivos deste ajuste. WebView2 ainda não foi validado manualmente.


## Fase 4 — Análise (feita)
| Item | Estado | Como foi verificado |
|---|---|---|
| Música: BPM, batidas, compassos, energia, seções, drop | feito | testes com cliques sintéticos; referência real: 170,8 BPM e drop achado |
| Episódio: cortes de cena, movimento, falas e gritos, legendas embutidas, etiquetas | feito | testes com fixtures sintéticas |
| Abas Cenas e Falas (melhores momentos para arrastar) | feito | app real |

## Fase 5 — Gerar meu AMV (feita)
| Item | Estado | Como foi verificado |
|---|---|---|
| Estilos Hype, Impacto rápido, Superação, Letra, Discurso e Emocional; modo Aberto com recomendação local | feito | testes determinísticos de recomendação e subdivisão da batida em `packages/automv` |
| Cortes na batida, cena forte no drop, fala terminando no drop com ducking, legendas, efeitos, motivo em cada clipe | feito | testes + app real |
| Poucas cenas: divide slots na batida, sem buraco | feito | teste + bug real achado no app |
| Gerar outra versão, versões guardadas e voltar | feito | teste de sessão + app real |
| Selecionar vários episódios e identificar cenas/lutas por episódio para a montagem | feito | geração usa os episódios marcados; seleção Todos/Nenhum e contagem de cenas/lutas visíveis |

## Fase 6 — Assistente (primeira versão)
| Item | Estado | Como foi verificado |
|---|---|---|
| Provedores: Ollama/compatível OpenAI, Anthropic e Gemini oficial; chave no cofre do sistema; teste de conexão | feito | Gemini: chamadas/ferramentas/modelos testados com respostas gravadas; sem chave real |
| Ferramentas: pontos fracos, cenas, falas, ideias; propostas (trocar cena, efeito, cortes rápidos, fala antes do drop, montagem, remover) | feito | 8 testes |
| Revisão: itens com dependências, testar (aplica e volta), aplicar parcial num único desfazer, revalidação | feito | testes + app real |
| Configurações de IA acessíveis em telas baixas | feito | corpo do diálogo rolável com ações Salvar/Cancelar fixas; typecheck/build |
| Modo local sem modelo | feito | testes + app real |
| Pendente: prévia fantasma na timeline, A/B lado a lado, memória criativa, "Perguntar à IA" no clique direito | pendente | — |

## Fase 7 — Músicas (primeira versão)
| Item | Estado | Como foi verificado |
|---|---|---|
| Biblioteca global: arquivos/pastas, tags do arquivo, duplicatas por hash, arquivo movido | feito | teste com FFmpeg real |
| Filtros (BPM, intensidade, emoção, drop, não usadas), ordenação, favoritas, notas, tags, playlists | feito | testes + app real |
| Detalhe com curva de energia e partes; comparar até 4; player no rodapé | feito | app real (no Linux o áudio não toca pelo protocolo de arquivos; testar no Windows) |
| Recomendação por tema com justificativa; sugestão no Gerar meu AMV | feito | testes + app real |
| Visualizar batidas e corrigir BPM (×2/÷2 ou tap tempo), salvando grade corrigida no cache compartilhado | feito | testes determinísticos de grade e persistência da biblioteca com FFmpeg empacotado; falta calibração manual com música real |
| Pendente: YouTube/Spotify (spike), pastas monitoradas | pendente | — |

## Fase 8 — Legendas (primeira versão)
| Item | Estado | Como foi verificado |
|---|---|---|
| Importar SRT/ASS/VTT/LRC com detecção de codificação; LRC alinha com a música | feito | testes |
| Puxar falas do episódio para os clipes (considera velocidade) | feito | testes |
| Editar texto, ajustar tempo (±), estilos, avisos de leitura, exportar SRT/VTT/LRC | feito | testes + app real |
| Transcrição local faster-whisper, tradução de legendas | parcial | Transcrição vira clipes editáveis e permite selecionar o stream de áudio; progresso de extração/segmentos e cancelamento cooperativo, com término forçado do sidecar após 5 s. Modelo small carregou offline e decodificou um M4A real de 223,4 s; com VAD, não encontrou falas. Sem VAD, gerou segmentos com confiança de idioma baixa (0,492), então a qualidade de diálogo segue sem validação. PyAV está limitado a <19; smoke test e CI da Release v0.6.3 passaram. Tradução de legendas já funciona. |
| Alinhamento automático de letra sem tempo | feito | Importa TXT com uma linha por verso, transcreve o arquivo local da música com faster-whisper e associa linhas às palavras reconhecidas em ordem. Reporta versos incertos/não encontrados e cria clipes editáveis. Testes cobrem erros de reconhecimento, versos repetidos, japonês e ausência de correspondência; typecheck passou. Falta validação humana com música real no Windows. |
| Frases e letras com animação e espaço nos impactos | feito | Falas são divididas em frases curtas animadas; letras recebem destaque e aproximam o início à batida quando cabe, sendo omitidas sobre falas e impactos principais. Testes Auto AMV cobrem batida, drop, animação, cor e quebra de frases; typecheck/build passaram. Falta conferir visualmente no WebView2 com vídeo real. |

## Pós-0.5.5 (0.6.0, em andamento)
| Item | Estado | Como foi verificado |
|---|---|---|
| Correção do viés de −24 ms nas batidas + refino de pico | feito | teste: viés < 4 ms e pior < 8 ms em 3 andamentos × 3 inícios |
| Sequências (lutas) por episódio, golpe de cada cena | feito | 6 testes unitários (`sequences.test.ts`) |
| Foco na luta, escolha manual de lutas, junta a próxima se faltar cena | feito | testes com controle (misturar produz o que o foco evita) |
| Golpe na batida (alinha o impacto ao corte/drop) | feito | teste: golpe 0,03–0,13 s após o corte, 0,04 s no drop; cortes seguem na batida |
| Melhor trecho da música para as cenas (top 3 com motivo) | feito | testes |
| Falas intercaladas com a música abaixando; faixa original (japonês) | feito | testes |
| Tradução de legendas (9 idiomas), original guardado, voltar | feito | 8 testes do tradutor (modelo falso) + 5 de legendas; **não testado com modelo real** |
| Assistente flutuante/minimizável | feito | typecheck + build; **sem teste visual** |
| Drop com precisão de batida (era perdido ou 1,4–1,8 s atrasado) | feito | teste com 6 combinações de andamento/posição; app real mostra "drop em 0:32" |
| Efeitos sonoros sintetizados + colocação | feito | 11 testes espectrais, 12 de montagem; espectrogramas; **áudio exportado** comparado com/sem efeitos |
| Visão por cena (personagens/luta/ação/emoção/energia) com IA | feito (modelo falso) | quadros reais via FFmpeg, rotulador, contexto da música e filtro na montagem; **não testado com modelo real** |
| Encaixe Gemini com perfil musical, letra/diálogo e sinais visuais | feito (modelo falso) | contexto e categorias validados em testes; energia visual confiável altera a seleção no teste determinístico. Gemini e mídia real ainda não avaliados. |
| Correções de interface (Importar, timeline, assistente) | feito | auditoria automática de controles cobertos em 8 estados + navegador real |
| YouTube/Spotify, trocar efeitos por arquivos | pendente | — |

## Camadas de melhoria solicitadas (2026-11-08)

| Camada | Estado | Escopo / validação |
|---|---|---|
| 1. Sincronia ajustável | primeira entrega feita | Ajuste fino de −500 a +500 ms na geração; desloca batidas, cortes, drop e posições de falas sem deslocar o áudio. Testes do Auto AMV e typecheck; **ainda precisa ser calibrado com músicas reais**. Isso corrige um deslocamento constante, não deriva de andamento variável. |
| 2. Continuidade de luta/personagem | parcial; primeira melhoria feita | A visão oferece escopo "só lutas" ou "todas as cenas"; o modo detalhado revisita rótulos antigos e combina 3 quadros por cena. Agora considera ação, emoção, energia visual e contexto de música/letra/falas ao selecionar cenas. Falta validar modelo real, expor confiança/revisão e melhorar agrupamento heurístico de lutas. |
| 3. Falas e letras automáticas | parcial; transcrição e alinhamento local implementados | No painel de legendas, escolha episódio ou clipe de música, stream de áudio, modelo e idioma; o app extrai o stream para WAV em cache e converte falas/versos em clipes editáveis. TXT sem tempos é alinhado pela sequência de palavras reconhecidas, com aviso de versos incertos/não encontrados. Progresso de extração e dos segmentos; cancelar termina o job ou encerra o sidecar após 5 s. Sem progresso detalhado do download dos pesos. A qualidade da transcrição e do alinhamento ainda precisa de validação humana com diálogo/letra real autorizados no Windows. |
| 4. Mixagem e reprodução | parcial; validar | Exportação já separa música/voz, aplica ducking e efeitos. Falta validar no Windows a faixa de áudio escolhida no preview e melhorar a explicação visual das trilhas de idioma do episódio versus música. |
| 5. Assistente e interface | parcial; validar | Assistente flutuante, minimizável e propostas já existem; Gemini usa API oficial, chave no cofre, host fixo e opt-in de envio textual/quadros amostrados. A análise contextual usa BPM/seções/drop, letra fornecida e legendas/falas locais; o áudio/vídeo completos não saem do PC. Faltam teste de interação no WebView2 e validação com chave real. |
| 6. YouTube/Spotify oficiais | avaliação técnica feita; spike pendente | YouTube Data API v3 + IFrame Player; Spotify Web API + Embed oficial. CSP atual bloqueia embeds e requer spike/allowlist mínima; OAuth Spotify em desktop requer PKCE. Sem extração/análise de áudio de streaming. |
| 7. Aceitação ponta a ponta no Windows | pendente | Testar mídia real autorizada pelo usuário, modelos reais com opt-in, render, áudio, legendas, botões e atualização do instalador. |
| 8. Revisão/correção de batidas | primeira entrega feita | A curva da biblioteca mostra batidas; ×2/÷2 e tap tempo persistem no cache por hash e atualizam montagens futuras. Mapa de andamento variável e metrônomo sincronizado ainda pendentes; calibração com música real pendente. |
| 9. Música, letra e cena com mais contexto | primeira entrega | Recomendações da biblioteca agora comparam a curva de energia medida à sequência/intensidade das cenas e mostram os motivos; análise semântica letra↔cena é opcional, usa até 6 versos e reanalisa quadros amostrados. Falas marcantes ganham fonte maior; correspondências fortes podem manter a letra sobre um impacto. Testes automatizados passaram; falta calibrar Gemini real, tradução automática da letra e conferir tipografia/sincronia no WebView2 com mídia real. |

## Roadmap profissional de AMV — Fase 1 (2026-11-09)

| Item | Estado | Como foi verificado |
|---|---|---|
| Auditoria de tipografia, legendas, diálogo, música, efeitos, render e recorte temporal | feito | registrada em `docs/ROADMAP_PRO_AMV.md`; recorte temporal permanece fora do escopo de implementação |
| Schema v2 e migração de projetos v1 | feito | 44 testes de `packages/project`, incluindo round-trip/migração |
| Timestamps de palavra ASS karaoke, LRC enhanced e faster-whisper | feito | parser e integração cobertos por testes de `packages/analysis`, `packages/subtitles` e `packages/automv` |
| Presets de tipografia, fundos e ajuste de texto/palavras | implementado | inspetor e renderer compartilhado atualizados; typecheck concluído |
| Geração sem timestamps artificiais por palavra | feito | testes do Auto AMV cobrem segmentos sem timestamps e palavra temporizada |
| Testes focados de projeto, análise, legendas, Auto AMV, assistente, desktop e render FFmpeg | feito | 220 testes passaram; render usa FFmpeg/FFprobe empacotados |
| Typecheck e build da interface desktop | feito | `corepack pnpm --filter @amv/desktop run build` |
| Conferência visual e de áudio no WebView2/Windows | pendente | requer teste manual com mídia autorizada |

O preview e a exportação usam `drawTextLayer`; ainda não há teste automatizado de comparação pixel a pixel entre WebView2 e a sequência de imagens exportada.

## Isolamento e composição temporal de personagens — avaliação (2026-11-09)

| Item | Estado | Como foi verificado |
|---|---|---|
| Auditoria de schema, comandos/undo, preview, render e sidecar Python | feito | código atual documentado em `docs/ROADMAP_CHARACTER_CUTOUT.md` |
| Avaliação documental de SAM 2.1, Cutie e XMem | feito | fontes oficiais de código, instalação, checkpoints e licenças consultadas |
| Spike SAM 2.1 Tiny em CPU Windows | parcialmente verificado | Sidecar PyInstaller processou via FFmpeg um clipe sintético de 3 quadros 256×256 a 1 fps em 13,95 s; working set amostrado ~1.079 MiB. Cancelamento real removeu saída parcial; ver benchmark de qualidade abaixo |
| Benchmark SAM 2.1 Tiny (sintético 10/30/60 s) | executado; gate reprovado | Somente animação sintética a 256×256/1 fps; IoU médio 0,8715 / 0,0635 / 0,4424; 30/30 e 60/60 quadros abaixo de 0,75. Evidência real limitada a um trecho de anime de 3 s; relatório em `docs/SAM2_QUALITY_BENCHMARK.md` |
| Comparação `_C` CPU/GPU | pendente | `_C` ausente e CUDA indisponível; não instalada nem comparada uma alternativa CPU |
| Fase 2.2: teste visual com mídia autorizada | executado parcialmente; gate reprovado | Segmento de 72 quadros em 1280×720 processado em CPU. Máscara desapareceu em quadros após troca de plano. Comparativos e JSONs em `C:\Users\Bruno\Videos\AMV-SAM2-Quality\resultados`, fora do repositório |
| Correção em quadro e propagação após correção | testada sem sucesso após perda do alvo | Pontos positivos/negativos e nova propagação no quadro 36 não mudaram a máscara vazia. Inicialização isolada no mesmo quadro produziu apenas uma máscara parcial (~5% da imagem); sem correção temporal confiável nem UI |
| Runtime/pesos no instalador principal | bundle validado; instalador pendente | PyInstaller + smoke test; sidecar descompactado 745,9 MiB (checkpoint 148,8 MiB). Build Tauri ainda não executado |
| API de job, progresso, cancelamento, cache e sequência RGBA | protótipo implementado | 15 testes pytest passam; inferência SAM2 e extração FFmpeg no sidecar empacotado passaram com vídeo sintético; cancelamento real também verificado |
| Seleção no preview, revisão/correção manual de máscara | não iniciado | não há UI |
| Asset editável, timeline, preview e render/exportação da camada | não iniciado | requer migração de schema, comandos undo/redo e integração nos dois renderizadores |

Especificação técnica, pipeline proposto, dependências e gates de aceitação: `docs/ROADMAP_CHARACTER_CUTOUT.md`.

## Fase 2.3 — modelos alternativos de segmentação (2026-11-09)

| Item | Estado | Como foi verificado |
|---|---|---|
| SkyTNT ISNet_IS em imagens (teste ONNX inicial) | resultado revisado na Fase 2.4 | ONNX em CPU a 1024, embora o config HF do checkpoint indique 640; o ONNX concordou com PyTorch quando ambos receberam o mesmo tensor |
| SkyTNT nos 72 quadros | não executado | critérios de saída individual falharam; não inferir consistência temporal por quadros independentes |
| ISNet e U2Net com pesos apropriados | sem benchmark | publicação SkyTNT consultada só tem pesos `isnet_is`; sem checkpoint independente `isnet` ou U2Net |
| CUTIE Small | viabilidade pesquisada; não instalado | API aceita máscara inicial; CPU e Windows não validados pelo upstream neste host; licença de pesos não encontrada separada da licença MIT do código |
| Detecção de mudança de cena | sondagem FFmpeg | picos observados perto de +0,545 s e +2,881 s no trecho; iluminação/efeitos podem causar falso positivo; nenhuma lógica integrada |

Relatório: `docs/ALTERNATIVE_ANIME_SEGMENTATION_BENCHMARK.md`.

## Fase 2.4 — confirmar SkyTNT com PyTorch original (2026-11-09)

| Item | Estado | Como foi verificado |
|---|---|---|
| Checkpoint oficial | SHA-256 validado | `isnetis.ckpt`, hash `2c8f6b9a77386c54dcdbf55b6c917108c4bdf4328abca9152c7bce5727b74d18`; carregado somente após validação |
| PyTorch original, config 640 | executado; recorte não confiável neste material | `inference.py` oficial em CPU/FP32 nos mesmos cinco quadros; imagem 00 teve máscara visível mas com vazamentos, 02/03 quase nulas |
| Resolução 1024 | executada | PyTorch e ONNX ficaram numericamente equivalentes com os mesmos tensores; a configuração HF do checkpoint declara 640 |
| Diagnóstico ONNX | conversão/runtime não apontados como causa | MAE PyTorch×ONNX 1,7e-8–7,4e-8; erro máximo 1,92e-6; nenhum NaN/Inf |
| Consistência temporal | não testada; recorte automático em espera | sem vídeo, sem CUTIE, sem integração ao produto; não avançar tracking sem novas máscaras iniciais confiáveis |

Métricas completas e comparativos fora do repositório em `C:\Users\Bruno\Videos\AMV-SAM2-Quality\resultados\skytnt_isnetis_pytorch_validation`. A conclusão é limitada a esses cinco quadros. Sem UI, timeline, instalador ou dependências do app alterados.
