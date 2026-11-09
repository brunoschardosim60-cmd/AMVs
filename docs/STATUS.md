# Status

Fases 1 a 5 feitas; 6 (assistente), 7 (músicas) e 8 (legendas) com a primeira versão completa. ~150 testes TS com FFmpeg real e LLM simulado. Falta o teste manual no Windows do Bruno.

## Fase 1 — Fundação

| Item | Estado | Como foi verificado |
|---|---|---|
| Monorepo (pnpm), TS strict, Vitest, pytest | feito | `pnpm typecheck`, `pnpm test` |
| Modelo do projeto: schema v1, µs inteiros, FPS racional | feito | testes `packages/project` |
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
| CI no Windows: testes + instalador NSIS/MSI | feito | Release v0.6.2, run 42542302583 verde: runtime Python, typecheck, suíte completa e instaladores assinados; Release e `latest.json` apontam para 0.6.2. |

### Pendente de verificação no Windows
- Reprodução do proxy no painel de detalhes (WebView2). No Linux de desenvolvimento não dá para testar: o WebKitGTK não toca mídia pelo protocolo de arquivos do Tauri.
- Diálogos nativos de abrir/salvar e o arrastar e soltar no Explorer.

## Distribuição
| Item | Estado | Como foi verificado |
|---|---|---|
| Atualização automática (plugin updater, assinatura minisign) | feito | Release v0.6.1 publicada com `latest.json` e assinatura; arquivo consultado pelo app aponta para o MSI v0.6.1 |
| Publicar versão: `node scripts/release.mjs x.y.z --push` (branch `release`) | feito | v0.6.1 publicada pelo workflow Release run 42538120990 |

## Fase 2 — Editor (em andamento)

| Item | Estado | Como foi verificado |
|---|---|---|
| Operações: inserir, dividir, aparar, mover em grupo com sobrescrita, excluir (com/sem fechar buraco), copiar/colar/duplicar, encaixe | feito | 18 testes em `packages/project/test/edit.test.ts` |
| Timeline: régua, trilhas, travar/ocultar/silenciar, zoom (Ctrl+roda, botões, "ajustar tudo"), miniaturas e forma de onda nos clipes | feito | app real no Linux (Xvfb) |
| Arrastar mídia da biblioteca para a timeline (eventos de ponteiro, não HTML5 DnD) | feito | app real; bug de clipe duplicado achado e corrigido |
| Arrastar clipes (entre trilhas do mesmo tipo), aparar pelas bordas, encaixe com linha guia | feito | app real |
| Preview: player sincronizado com proxies, composição em canvas (posição, escala, rotação, opacidade, recorte, texto) | feito | Chromium headless com vídeo de tempo gravado: quadro certo em 3 posições, incluindo tocando |
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
- No preview, volume acima de 0 dB e a faixa de áudio escolhida não são ouvidos (usa a 1ª faixa do proxy); a exportação respeita os dois.


## Fase 4 — Análise (feita)
| Item | Estado | Como foi verificado |
|---|---|---|
| Música: BPM, batidas, compassos, energia, seções, drop | feito | testes com cliques sintéticos; referência real: 170,8 BPM e drop achado |
| Episódio: cortes de cena, movimento, falas e gritos, legendas embutidas, etiquetas | feito | testes com fixtures sintéticas |
| Abas Cenas e Falas (melhores momentos para arrastar) | feito | app real |

## Fase 5 — Gerar meu AMV (feita)
| Item | Estado | Como foi verificado |
|---|---|---|
| 5 estilos das referências (Hype, Superação, Letra, Discurso, Emocional), intensidade, duração | feito | 13 testes em `packages/automv` |
| Cortes na batida, cena forte no drop, fala terminando no drop com ducking, legendas, efeitos, motivo em cada clipe | feito | testes + app real |
| Poucas cenas: divide slots na batida, sem buraco | feito | teste + bug real achado no app |
| Gerar outra versão, versões guardadas e voltar | feito | teste de sessão + app real |

## Fase 6 — Assistente (primeira versão)
| Item | Estado | Como foi verificado |
|---|---|---|
| Provedores: Ollama/compatível OpenAI, Anthropic e Gemini oficial; chave no cofre do sistema; teste de conexão | feito | Gemini: chamadas/ferramentas/modelos testados com respostas gravadas; sem chave real |
| Ferramentas: pontos fracos, cenas, falas, ideias; propostas (trocar cena, efeito, cortes rápidos, fala antes do drop, montagem, remover) | feito | 8 testes |
| Revisão: itens com dependências, testar (aplica e volta), aplicar parcial num único desfazer, revalidação | feito | testes + app real |
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
| Transcrição local faster-whisper, tradução de legendas | parcial | Transcrição vira clipes editáveis e permite selecionar o stream de áudio; progresso de extração/segmentos e cancelamento cooperativo, com término forçado do sidecar após 5 s. Modelo small carregou offline e decodificou um M4A real de 223,4 s; com VAD, não encontrou falas. Sem VAD, gerou segmentos com confiança de idioma baixa (0,492), então a qualidade de diálogo segue sem validação. PyAV está limitado a <19; smoke test e CI da Release v0.6.1 passaram. Tradução de legendas já funciona. |
| Alinhamento automático de letra sem tempo | pendente | — |

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
| 3. Falas e letras automáticas | parcial; transcrição com stream, progresso e cancelamento | No painel de legendas, escolha episódio, faixa de áudio, modelo e idioma; o app extrai o stream escolhido para WAV em cache e converte falas em clipes editáveis nos trechos selecionados (ou em todos os clipes daquele episódio). Progresso de extração e dos segmentos; cancelar termina o job ou encerra o sidecar após 5 s. Sem progresso detalhado do download dos pesos. Um M4A real carregou com faster-whisper small, mas não trouxe fala confiável. A incompatibilidade de PyAV 19 foi corrigida com limite <19 e um smoke test que decodifica áudio; falta o novo CI/instalador e uma amostra autorizada com diálogo claro. |
| 4. Mixagem e reprodução | parcial; validar | Exportação já separa música/voz, aplica ducking e efeitos. Falta validar no Windows a faixa de áudio escolhida no preview e melhorar a explicação visual das trilhas de idioma do episódio versus música. |
| 5. Assistente e interface | parcial; validar | Assistente flutuante, minimizável e propostas já existem; Gemini usa API oficial, chave no cofre, host fixo e opt-in de envio textual/quadros amostrados. A análise contextual usa BPM/seções/drop, letra fornecida e legendas/falas locais; o áudio/vídeo completos não saem do PC. Faltam teste de interação no WebView2 e validação com chave real. |
| 6. YouTube/Spotify oficiais | avaliação técnica feita; spike pendente | YouTube Data API v3 + IFrame Player; Spotify Web API + Embed oficial. CSP atual bloqueia embeds e requer spike/allowlist mínima; OAuth Spotify em desktop requer PKCE. Sem extração/análise de áudio de streaming. |
| 7. Aceitação ponta a ponta no Windows | pendente | Testar mídia real autorizada pelo usuário, modelos reais com opt-in, render, áudio, legendas, botões e atualização do instalador. |
| 8. Revisão/correção de batidas | primeira entrega feita | A curva da biblioteca mostra batidas; ×2/÷2 e tap tempo persistem no cache por hash e atualizam montagens futuras. Mapa de andamento variável e metrônomo sincronizado ainda pendentes; calibração com música real pendente. |
