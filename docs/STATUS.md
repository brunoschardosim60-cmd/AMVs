# Status

Estado geral: Fase 1 concluída; Fase 2 ainda em andamento; Fases 3 a 5 implementadas com limitações documentadas; Fases 6 a 8 têm primeira versão, ainda incompleta. A Release v0.6.10 passou no CI Windows (typecheck, suíte completa e empacotamento assinado). No teste manual desta validação, o app instalado foi atualizado de v0.6.9 para v0.6.10 e a tela inicial abriu; timeline/preview com mídia, importação/exportação, viewport 1920×1080 e viewport menor continuam sem validação manual completa.

## Fase 1 — Fundação

| Item | Estado | Como foi verificado |
|---|---|---|
| Monorepo (pnpm), TS strict, Vitest, pytest | feito | `pnpm typecheck`, `pnpm test` |
| Modelo do projeto: schema v10, µs inteiros, FPS racional | feito | testes `packages/project`, incluindo migrações v1 → v10 |
| Comandos com inverso, histórico undo/redo, transações | feito | testes: todo comando + inverso = original; batch atômico; projeto nunca mutado |
| Salvar/abrir transacional, round-trip idêntico, migrações, erros claros | feito | testes de serialização, escrita interrompida e recuperação de backup |
| FFmpeg/FFprobe como sidecar do Tauri | feito | app real rodando no Linux (Xvfb) processou mídia pelo sidecar; Windows: CI baixa build GPL do BtbN com checksum |
| Probe: MP4/MOV/MKV/WEBM/MP3/WAV/FLAC/PNG/JPG, VFR, 10-bit, capa de MP3, idiomas | feito | testes com FFmpeg real em fixtures sintéticas |
| Proxy H.264 8-bit CFR, GOP ~0,5 s, progresso real, cancelamento | feito | teste mede intervalo de keyframes; cancelar não deixa arquivo pela metade |
| Pôster, folha de miniaturas (com fallback HEVC), waveform multinível | feito | testes; waveform acha os 16 cliques de 120 BPM |
| Fila de jobs: prioridade, concorrência, cancelamento, dedupe | feito | testes |
| Cache por hash parcial; reabrir não reprocessa | feito | teste de sessão |
| Tela inicial: novo, abrir, continuar, recentes, favoritos | feito | captura de tela do app real |
| Importação (botão, Ctrl+I, arrastar e soltar) com metadados e avisos | feito | captura de tela do app real; testes de sessão |
| Mídia ausente: aviso, localizar arquivo (confere hash), procurar numa pasta | feito | testes de sessão + captura de tela |
| Autosave a cada 30 s, recuperação após queda e gravação atômica recuperável | feito | testes de autosave, promoção interrompida, falha de escrita/ENOSPC e preservação do arquivo anterior |
| Backups locais rotativos, histórico de versões e restauração com undo | feito | backups antes de sobrescrever, restauração transacional e projeto completo (settings, áudio, mídias, trilhas, clipes, keyframes, efeitos, legendas e marcadores) |
| Registro de mídias, dependências, arquivos ausentes e relink por hash | feito | validação de assets/referências/snapshots e testes de remoção e relocalização |
| Duplicar e arquivar projetos sem nuvem | feito | cópia integral de snapshots/backups e arquivamento para destino local escolhido; originais de mídia permanecem no lugar |
| Verificação de gerenciamento de projetos | passou | desktop 36/36, project 72/72 antes da migração v10; typechecks e build do desktop passaram. Testes incluem ENOSPC, queda entre rename e promoção, restore com undo, cópia, arquivo e relink. |
| Atalhos: Ctrl+N/O/S/Shift+S/I/Z/Shift+Z/Y; bloqueio de atalhos do navegador | feito | código; verificação manual pendente no Windows |
| Aviso ao fechar com alterações não salvas | feito | código; verificação manual pendente no Windows |
| Sidecar Python opcional (esqueleto: saúde, módulos, token) | feito | pytest |
| CI no Windows: testes + instalador NSIS/MSI | feito | Release v0.6.10, run 43038637825 verde: runtime Python, typecheck, suíte completa e instaladores assinados; Release e `latest.json` apontam para 0.6.10. |

### Pendente de verificação no Windows
- Reprodução do proxy no painel de detalhes (WebView2). No Linux de desenvolvimento não dá para testar: o WebKitGTK não toca mídia pelo protocolo de arquivos do Tauri.
- Diálogos nativos de abrir/salvar e o arrastar e soltar no Explorer.

## Distribuição
| Item | Estado | Como foi verificado |
|---|---|---|
| Atualização automática (plugin updater, assinatura minisign) | passou no teste manual | O app instalado v0.6.9 detectou e baixou a v0.6.10; após o reinício, a interface mostrou v0.6.10. O manifesto e os instaladores assinados foram publicados. A Release v0.6.10 e seu `latest.json` ficaram sem notas porque o workflow usava uma entrada não suportada; a coleta/publicação das notas foi corrigida no workflow para as próximas versões. |
| Publicar versão: `node scripts/release.mjs x.y.z --push` (branch `release`) | feito | v0.6.10 publicada pelo workflow Release run 43038637825 |

## Fase 2 — Editor (em andamento)

| Item | Estado | Como foi verificado |
|---|---|---|
| Operações: inserir, dividir, aparar, mover em grupo com sobrescrita, excluir (com/sem fechar buraco), copiar/colar/duplicar, encaixe | feito | 18 testes em `packages/project/test/edit.test.ts` |
| Timeline: régua, trilhas, travar/ocultar/silenciar, zoom (Ctrl+roda, botões, "ajustar tudo"), miniaturas e forma de onda nos clipes | feito | app real no Linux (Xvfb) |
| Arrastar mídia da biblioteca para a timeline (eventos de ponteiro, não HTML5 DnD) | feito | app real; bug de clipe duplicado achado e corrigido |
| Arrastar clipes (entre trilhas do mesmo tipo), aparar pelas bordas, encaixe com linha guia | feito | app real |
| Seleção retangular de clipes, adição e reordenação de trilhas por tipo | feito | testes da seleção; comando de reordenação com inverso testado; validação visual pendente |
| Keyframes de posição X/Y com easing no preview, texto e FFmpeg | feito | testes da curva e teste de render com pixels em dois instantes; WebView2 pendente |
| Preset de glitch editável e exclusão do runtime SAM2 do bundle | feito | componentes reutilizam efeitos com paridade existente; bundle Windows atualizado ainda não medido |
| Preview: player sincronizado com proxies, composição em canvas (posição, escala, rotação, opacidade, recorte, máscaras, blend modes, texto e imagem) | feito | Chromium headless com vídeo de tempo gravado; paridade dos efeitos adicionais ainda requer conferência visual no WebView2 |
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
| Mixagem: múltiplas trilhas, ganho/fades/keyframes, áudio original do vídeo, ducking de voz, EBU R128, limitador e medição | feito | testes de render com FFmpeg empacotado cobrem áudio original, ducking global e manual, loudness, pico e clipping; projeto 74/74, Auto AMV 124/124, render 24/24 e desktop 42/42 passaram; typechecks dos pacotes afetados passaram; migrações v4 → v5 e v9 → v10 |
| Mixer visual e pré-escuta WAV fiel à exportação | feito | controles por trilha (função, ganho, mute/solo), ducking/masterização e WAV renderizado pela mesma cadeia; validação manual do player no WebView2 pendente |
| Diálogo de exportação: formato, resolução, qualidade, progresso, cancelar, mostrar na pasta | feito | app real (Linux) |
| Exportação configurável: MP4/MKV/MOV, H.264/H.265/ProRes, FPS racional, CRF/bitrate e estimativa de tamanho | implementado; validação automatizada | typecheck e testes com FFmpeg sidecar; tamanho é estimativa e encoder varia por build |
| Hardware detectado por teste, fallback automático para CPU, log persistente e publicação transacional | implementado; validação automatizada | executa teste curto do encoder, valida temporário antes de substituir saída e preserva backup em falha |
| Validação final: duração, resolução, FPS, codec, frames decodificados, áudio mixado, sincronização A/V, decode integral e avisos de preto | implementado; validação automatizada | gaps/fades intencionais são excluídos dos avisos de preto; conteúdo preto continua como aviso revisável |
| Verificação desta etapa | passou | Typechecks render/project/desktop, build desktop, 24/24 testes de render com o FFmpeg empacotado e 2/2 testes do estimador/FPS passaram; black warning/gap, fallback, rollback, cancelamento, MKV, color grading e ducking manual validados |

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
| Direção narrativa musical aplicada às escolhas de cena | primeira fatia feita | seções, energia e drops existentes geram papéis narrativos que alteram o score e aparecem nas justificativas/resumo; testes cobrem faixa parcial, offset, seção sem dados e alinhamento entre tempo local e absoluto. Heurística ainda requer validação visual em mídia real e não entende semanticamente a história. |
| Gate das análises selecionadas | implementado | O botão aguarda a análise de todos os episódios selecionados e da música, não omite episódios pendentes quando outros já estão prontos; erros permitem retry ou desmarcação explícita. Testes unitários da prontidão e typecheck/build desktop. |
| Cenas escuras preservadas na seleção | feito | cena marcada como escura continua elegível; baixa luminosidade isolada não é motivo para removê-la. Teste de geração em `packages/automv`. |
| Pontuação contextual e decomposição dos motivos | primeira fatia feita | sinais existentes foram separados em música, ação, emoção, narrativa, transição, diversidade e letra opcional. Justificativas dos clipes mostram sinais selecionados; visão granular só influencia com confiança ≥0,55. Rótulos legados `fight` sem confiança mantêm comportamento compatível. Nitidez, enquadramento, câmera e cor não são medidos e não recebem score inventado. |
| Planejamento global de cenas e direções editoriais | primeira fatia implementada | busca beam limitada avalia o caminho completo dos slots; modos Cronológico, Narrativo e Livre impõem regras distintas. Cinema, Balanceado e Hype alteram duração/ritmo, transição, peso visual e efeitos. 85 testes focados passaram; typecheck do Auto AMV/desktop e build do frontend passaram. Falta validar o resultado audiovisual em mídia real. |
| Confiança de clipe gerado | corrigido | removido o reaproveitamento do score de ranking como `Clip.confidence`; pontuação não é probabilidade de adequação. |
| Análise da mídia de referência local | feita como diagnóstico, não como aceitação visual | FFmpeg/algoritmos existentes analisaram música de 223,4 s e episódio de 1.430,08 s (508 planos em 35,6 s). A classificação musical tem seções longas/coarse; arquivo, streams, métricas e limites estão em `docs/AMV_ENGINE_REFERENCE_VALIDATION.md`. Não foi renderizada nem aprovada uma montagem real. |
| Auditoria do clique Gerar | fluxo rastreado; instrumentação pendente | Análise de vídeo/música é iniciada após importação e lida do cache por hash/versão; `generateAmv` apenas planeja e emite comandos em memória. O clique sub-segundo não mede nem representa a duração anterior de análise. O gate agora impede omissão parcial silenciosa; não há ainda métricas por etapa nem perfil de profundidade. |

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
| Importar SRT/ASS/VTT/LRC com detecção de codificação; LRC alinha com a música | feito | testes; parser ASS também preserva sílabas de karaokê com origem e confiança |
| Puxar falas do episódio para os clipes (considera velocidade) | feito | testes |
| Editar texto, ajustar tempo (±), estilos, avisos de leitura, exportar SRT/VTT/LRC | feito | testes + app real |
| Transcrição local faster-whisper, tradução de legendas | parcial | Transcrição vira clipes editáveis e permite selecionar o stream de áudio; progresso de extração/segmentos e cancelamento cooperativo, com término forçado do sidecar após 5 s. Modelo small carregou offline e decodificou um M4A real de 223,4 s; com VAD, não encontrou falas. Sem VAD, gerou segmentos com confiança de idioma baixa (0,492), então a qualidade de diálogo segue sem validação. PyAV está limitado a <19; smoke test e CI da Release v0.6.3 passaram. Tradução de legendas já funciona. |
| Alinhamento automático de letra sem tempo | feito | Importa TXT com uma linha por verso, transcreve o arquivo local da música com faster-whisper e associa linhas às palavras reconhecidas em ordem. Reporta versos incertos/não encontrados e cria clipes editáveis. Testes cobrem erros de reconhecimento, versos repetidos, japonês e ausência de correspondência; typecheck passou. Falta validação humana com música real no Windows. |
| Frases e letras com animação e espaço nos impactos | feito | Falas são divididas em frases curtas animadas; letras recebem destaque e aproximam o início à batida quando cabe, sendo omitidas sobre falas e impactos principais. Testes Auto AMV cobrem batida, drop, animação, cor e quebra de frases; typecheck/build passaram. Falta conferir visualmente no WebView2 com vídeo real. |
| Editor de tipografia cinética: presets por seção, gradientes, glow, entrada/saída, keyframes e animação confiável por palavra/sílaba | implementado; validação visual pendente | Schema v7 migra projetos sem criar tempos; ASS preserva sílabas, pontuação e runs sem espaços; Inspector permite editar estilo/timestamps e alternar original, traduções e texto manual sem perder variantes. Preview e exportação rasterizada compartilham `drawTextLayer`. Testes focados e typechecks; falta validar renderização no WebView2 com mídia autorizada. |

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

## Correções P0 de montagem e assistente (2026-11-09)

| Item | Estado | Como foi verificado |
|---|---|---|
| Idioma do áudio e das legendas | implementado | Título explícito da faixa tem precedência sobre tags conflitantes; idioma acompanha as legendas embutidas e o cache de análise mudou de e2 para e3. Geração não usa legenda incompatível nem troca silenciosamente para uma faixa de dublagem não identificada. Testes de análise e montagem. |
| Cronologia e cenas coerentes | implementado | Seleção comum avança pela origem do episódio; em slots intensos/drops a busca futura é limitada, sem misturar sequências no foco de luta. Testes de continuidade, foco e compatibilidade musical. |
| Resiliência do Gemini | implementado | Timeout de 45 s, até 3 tentativas transitórias com jitter/Retry-After e circuit breaker de 30 s; fallback local é identificado na interface e só cobre falhas transitórias. Testes com provedor simulado. |
| Verificação desta rodada | concluída | Auto AMV: 72 testes focados; typecheck de automv, analysis, assistant e desktop. Não houve teste com chave Gemini real ou aceitação visual em mídia real. |

## Inteligência visual local e biblioteca de personagens (2026-11-10)

| Item | Estado | Como foi verificado |
|---|---|---|
| Análise visual local incremental | implementada | FFmpeg extrai 1–3 quadros reduzidos por cena; descritores de luminância espacial, bordas, histograma de cor, composição, entropia, movimento e deslocamento são salvos no cache do hash do asset. Cena concluída não é extraída de novo; botão permite retomar localmente. Testes unitários RGB e seleção incremental. |
| Classificação visual e repetição | primeira fatia implementada | categorias heurísticas ação/diálogo/contemplação/tensão/reação/ambiente e similaridade estrutural/temporal por cena; cena semelhante afeta o score do Auto AMV. Não é reconhecimento de identidade nem classificador de câmera com modelo treinado. |
| Rostos, expressão e enquadramento | complemento opcional | respostas do modelo visual podem trazer quantidade de rostos, expressão com confiança e escala do plano; rótulos incompletos/ambíguos são descartados. Não há detector facial local no build atual. |
| Biblioteca de personagens por projeto | implementada | schema `.amvproj` v3, migração v2→v3, nomes/aliases, evidências de cenas e confiança; renomear/corrigir no diálogo de geração muda as etiquetas usadas pelo filtro de personagem e pode ser desfeito. |
| Validação desta etapa | parcial, testes sintéticos locais concluídos | 88 testes Auto AMV, 50 de projeto, 34 de analysis (sem os testes que invocam FFmpeg) e 38 do assistant passaram; typecheck dos pacotes afetados e build desktop passaram. A suíte de integração desktop teve 7 falhas em importação/processamento de mídia porque o FFmpeg não está no PATH do NodeRunner. Extração de vídeo codificado e qualidade/identidade em anime autorizado continuam sem validação visual. |

## Linguagem de câmera e análise de movimento (2026-11-10)

| Item | Estado | Como foi verificado |
|---|---|---|
| Fluxo óptico local | implementado | Correspondência esparsa de patches em quadros 32×18, processada em CPU; saída por intervalo com direção, velocidade normalizada, confiança, movimento localizado e reframe abrupto. Amostragem adaptativa de até 5 quadros por cena. |
| Movimentos e confiança | primeira versão | Classifica pan horizontal/vertical, zoom aparente, rotação, travelling, estático ou desconhecido; zoom registra aproximação/afastamento aparente sem afirmar se câmera ou objeto se moveu. |
| Uso no Auto AMV e interface | implementado | Score favorece continuidade direcional e permite contraste explícito em acento/mudança de energia. O diálogo mostra eventos com confiança ≥60%; sinais abaixo disso não influenciam essa regra. |
| Cache e processamento | incremental | Nova versão local `v2` invalida apenas descritores antigos; eventos são persistidos por cena no cache existente do hash do asset. O processamento não usa CUDA nem exige GPU. |
| Testes | passou em fixtures de movimento com ground truth | 8 testes locais verificam pan, inclinação vertical, zoom in/out, rotação, cena estática, baixa textura e movimento localizado; 10 testes do score verificam continuidade, contraste e rejeição de baixa confiança. Auto AMV: 106 testes passaram. Analysis: 40 testes passaram; duas suítes FFmpeg não iniciaram (`spawn ffmpeg ENOENT`). Typechecks de analysis/Auto AMV/desktop e build desktop passaram. Falta validação com filmagem real autorizada e benchmark na RX 580. |

## Diretor Musical (2026-11-10)

| Item | Estado | Como foi verificado |
|---|---|---|
| Eventos musicais locais | primeira fatia implementada | Cache de análise m4 registra ataques e acentos graves por banda espectral, crescimentos graduais, pausas, drops, mudanças de seção e variações de ritmo, cada evento com suporte heurístico. |
| Direção dos cortes | implementada no Auto AMV | Perfis por estilo variam agrupamento/densidade; crescimentos aceleram, pausas e finais alongam planos, preparação do drop adensa cortes e acentos fortes podem criar corte seletivo. O plano mantém a grade de batidas/seções quando possível. |
| Visualização e ajuste | implementados | Mapa de energia, compassos, ataques e eventos no diálogo de geração; offset manual existente continua disponível. Baixa confiança no BPM gera aviso para revisão. |
| Limites e testes | testes sintéticos concluídos; validação musical real pendente | Analysis: 37 testes; Auto AMV: 91; projeto: 50; assistant: 38. Typecheck de analysis/automv e build desktop passaram; `git diff --check` passou. Os testes de episódio/frames que dependem de FFmpeg foram excluídos porque FFmpeg não está no PATH do NodeRunner; a compilação Tauri e a validação auditiva/editorial com música real autorizada não foram executadas. Instrumentos específicos e vocais não são classificados; eventos usam suporte heurístico, não probabilidade calibrada. |

## Color grading (2026-11-10)

| Item | Estado | Como foi verificado |
|---|---|---|
| Ajustes por cena e presets | implementados | Um efeito undoável oferece exposição, contraste, saturação, temperatura, matiz, sombras, médios, realces e vinheta; presets Cinema quente, Frio, Anime vibrante e Preto e branco. O botão do efeito alterna antes/depois. |
| Aplicação por sequência | implementada | Selecionar vários clipes de vídeo e aplicar um preset atualiza todos numa única transação, mantendo os demais efeitos. |
| Continuidade automática | primeira versão | O Auto AMV limita compensação de exposição a ±0,3 EV usando luminância por plano; se houver histogramas locais RGB com amostras suficientes, aplica balanço cromático leve. Motivos ficam no clipe e o comportamento preserva a intenção entre cenas. |
| Preview e exportação | caminho comum de LUT | A transformação pura alimenta lookup 3D 17³ em WebGL2 quando disponível (RX 580 pode usar o caminho gráfico) e cai para Canvas2D/CPU; gera `.cube` temporário para `lut3d` do FFmpeg na exportação. A avaliação FFmpeg foi bloqueada porque `ffmpeg` não está no PATH do NodeRunner; equivalência com material real ainda não foi verificada. |
| Hardware, LUTs externas e validação visual | parciais | Sem CUDA/dependências novas; WebGL2 é opcional no preview e FFmpeg continua renderizando por CPU. Ainda não há interface para importar LUT `.cube` de usuário. Testes automatizados usam cores sintéticas; falta validar cenas reais autorizadas e medir desempenho na RX 580. |
| Testes disponíveis | passou parcialmente | Projeto: 53 testes; Auto AMV focado: 28; teste de filtergraph LUT: 1; typechecks do projeto/Auto AMV/render/desktop, build desktop e `git diff --check` passaram. O teste de render com pixels não iniciou: `spawn ffmpeg ENOENT`. |

## Avaliador audiovisual (2026-11-10)

| Item | Estado | Como foi verificado |
|---|---|---|
| Análise da timeline e cobertura | primeira versão implementada | Pacote puro `@amv/automv`: continuidade temporal/visual, cortes curtos, repetição de planos identificados, justificativas de sincronização, combinações de efeitos, sobreposição de textos e fontes de áudio. O relatório separa cobertura completa, parcial e indisponível e não gera nota geral. |
| Relatório no editor | implementado | Ação na barra da timeline lista gravidade, timestamp, evidências, motivo e sugestão; “Ver trecho” seleciona os clipes e busca o preview. |
| Correção local | implementada para sobreposição de textos | A correção oferecida é um comando de projeto undoável; não há correções automáticas especulativas para outros achados. |
| Testes e build | passou | Auto AMV: 96 testes; typechecks de Auto AMV e desktop; build de produção do frontend. A build avisou que o bundle principal excede 500 kB. |
| Validação editorial e de exportação | pendente | Nenhuma montagem real foi julgada e preview/exportação não foram comparados por quadros. Análises ausentes ou não carregadas aparecem na cobertura como indisponíveis/parciais. |

## Seleção de cenas e continuidade (2026-11-10)

| Item | Estado | Como foi verificado |
|---|---|---|
| Alternativas quando a janela de continuidade falha | implementada com ressalvas | Busca alternativas próximas da mesma sequência antes de ampliar; repetição narrativa preserva o progresso. Teste real A/B: baseline 53 clipes/53 cenas únicas, salto máximo 16,18 s, 20/50 golpes sincronizados; nova versão 62/56, salto máximo 5,98 s, 25/56 sincronizados. Ainda houve 7 saltos acima de 3 s e seis reutilizações de planos. |
| Validação editorial e de exportação em mídia real | parcial; avaliação pendente | Análise completa de um episódio e uma música, com ambas as versões renderizadas em 45 s, 640×360, 24 fps (1080 quadros). O render novo ainda sinalizou quadro preto em 24,96–25,08 s. Não houve avaliação humana nem comparação preview/export; teste não cobriu fala, letras, SFX, efeitos ou tipografia. |

## Regeneração localizada não destrutiva (2026-11-10)

| Item | Estado | Como foi verificado |
|---|---|---|
| Seleção de intervalo | implementada | Selecione clipes de vídeo na trilha principal e use “Melhorar seleção”; início/fim podem ser ajustados antes de gerar. |
| Alternativas e comparação | implementada | Gera propostas sem alterar o projeto, permite guardar várias alternativas na sessão e comparar previews A/B em três pontos do intervalo. |
| Preservação e transação | implementadas | Só clipes selecionados da trilha-alvo são substituídos; clipes não selecionados são âncoras. Áudio, textos/legendas, demais trilhas e trechos sem cena gerada permanecem. Efeitos, keyframes, transformações, ajustes de áudio do clipe, transições e color grade existentes acompanham a substituição quando os tempos se sobrepõem. |
| Histórico e restauração | implementados | Confirmação guarda snapshot anterior e aplica snapshot + alterações em uma transação única; Undo/Redo e menu Versões restauram a timeline. Alternativas obsoletas são recusadas se o projeto mudou. |
| Testes e build | passou | Suíte Auto AMV: 105 testes; typechecks de Auto AMV e desktop; build de produção do frontend; `git diff --check`. O build ainda avisa que o bundle principal excede 500 kB. |

## Transições por conteúdo (2026-11-10)

| Item | Estado | Como foi verificado |
|---|---|---|
| Escolha por par de cenas | implementada | A geração usa confiança de movimento, direção, personagem/ação, composição, enquadramento, luminosidade, energia/drop, direção editorial e duração. Sem evidência suficiente, mantém corte seco. |
| Catálogo e controles | primeira versão implementada | Dissolve, dip, flash e whip pan têm parâmetros de duração/curva/intensidade/direção; match cut e corte em ação são decisões editoriais secas, sem sobreposição artificial. |
| Preview e exportação | fórmulas compartilhadas | Preview usa os helpers de transição; FFmpeg usa expressões de alfa com curvas equivalentes e desloca/desfoca as duas camadas do whip pan. |
| Testes | passou parcialmente | Auto AMV: 115 testes; projeto: 54 testes; render: 2 testes de grafo e render real sintético de dissolve/whip pan passaram; typechecks de Auto AMV, projeto, render e desktop passaram. A execução inicial de 13/14 testes tinha uma asserção de color grading com fonte vermelha saturada; o fixture foi corrigido posteriormente e a suíte atual passa 24/24. Mídia real e comparação visual continuam pendentes. |

## Laboratório de Cenas (2026-11-10)

| Item | Estado | Como foi verificado |
|---|---|---|
| Biblioteca por projeto | implementada | Tela dedicada lista cenas já cacheadas de todos os vídeos, com miniaturas, arquivo/episódio, timestamps e posição na timeline original. |
| Metadados pesquisáveis | implementados | Filtros de ação, emoção, enquadramento, contexto, personagens, intensidade, confiança e tags; atributos ausentes não viram correspondências. Busca em linguagem natural converte somente em filtros locais de metadados existentes. |
| Prévia e inserção | implementadas | Prévia salta ao timestamp de origem no proxy; seleção múltipla insere clipes comuns e editáveis numa transação undoável. |
| Marcações e Auto AMV | implementados | Favorito, marcação, tags pessoais, direitos de assets e exclusão persistem no schema v10; cenas excluídas são retiradas da seleção automática. |
| Análise incremental | implementada | A tela reutiliza as análises existentes, permite completar visão local ou rotular cenas com modelo configurado, mostra progresso/cancelamento e mantém resultados concluídos no cache. |
| Testes | passou | Projeto: 56; análise: 53 (com FFmpeg sidecar); Auto AMV: 116; busca estruturada: 2. Typecheck desktop passou. Falta validação visual com mídia real autorizada no Windows. |

## Sound design local (2026-11-10)

| Item | Estado | Como foi verificado |
|---|---|---|
| Biblioteca local | implementada | Importa arquivos/pastas de áudio por referência, deduplica por hash e persiste categoria, tags, origem, licença, atribuição e observações em JSON local. Remover da biblioteca não apaga o arquivo original. |
| Pré-escuta e organização | implementadas | Player local, busca por metadados/tags e filtro por categoria; metadados são editáveis pelo usuário. |
| Inserção no projeto | implementada | Importa/reutiliza o asset, preserva direitos no projeto e insere no playhead numa transação única de undo, sem sobrescrever efeitos sobrepostos. Ganho e fades permanecem editáveis pelo Inspector. |
| Sugestões | limitadas e explícitas | Sugestões derivam de marcadores de drop/downbeat/corte já existentes, mostram confiança/evidência e aguardam aprovação. Ainda não inferem oportunidades de sound design a partir de acontecimentos visuais. |
| Testes e validação | parcial | Testes unitários da biblioteca/sugestões e migração v5→v6; typecheck/build desktop. Importação e reprodução em WebView2 e teste manual com arquivos licenciados continuam pendentes. |

## Controle de velocidade (schema v8)

| Item | Estado | Como foi verificado |
|---|---|---|
| Curvas e presets | implementados | Curvas lineares, hold e ease integram a velocidade para mapear tempo da timeline e origem; Inspector mostra o gráfico, permite adicionar/remover pontos, editar fatores/interpolação e aplicar presets. |
| Reverse e freeze | implementados com limitações | Reverse exporta vídeo invertido; freeze usa o quadro correspondente. O preview busca quadros para reverse e pausa durante freeze; áudio reverso é silenciado no preview e excluído da exportação. |
| Mixagem com velocidade | implementada por segmentos | A exportação segmenta ramps para variar o tempo e respeitar pitch conforme a opção do clipe. A aproximação é por blocos e precisa de validação auditiva em áudio real. |
| Edição não destrutiva | implementada | Split, trim e clear-range preservam o mapeamento de origem e recortam keyframes; testes cobrem ramp, reverse, freeze, migração e continuidade nos limites. |
| Verificação desta etapa | parcial | Projeto: 69 testes; Auto AMV: 117; legendas: 17; assistente: 38 — todos passaram. Typechecks dos seis pacotes e build desktop passaram. A execução inicial teve 22/23 testes de render; a asserção de cor foi corrigida depois e a suíte atual passa 24/24. O render real de speed ramp, freeze e reverse passou, incluindo duração de 96 quadros a 24000/1001. Comparação visual preview/export e validação no WebView2 continuam pendentes. |

## Velocidade adaptativa na geração

| Item | Estado | Como foi verificado |
|---|---|---|
| Slow motion em ação | implementado com critérios | O Auto AMV concentra uma rampa curta no pico de movimento quando a cena é classificada como combate/impacto e o FPS de origem oferece quadros suficientes. Quando o golpe foi sincronizado, o mapeamento conserva sua posição musical; os keyframes continuam editáveis no clipe. O resumo da geração mostra quantas rampas foram aplicadas. |
| Aceleração em preparação | implementada com critérios | Só é aplicada numa preparação visual de alta confiança durante a construção narrativa e com pelo menos o dobro do FPS de saída. |
| Recorte orientado a movimento | primeira fatia implementada | Ao escolher subtrechos de um plano, usa intervalos de movimento localizado com confiança suficiente para colocar o evento dentro do clipe, sem atravessar o corte original. Golpes sincronizados continuam ancorados ao pico; sem evidência local, mantém a seleção anterior. |
| Efeitos de impacto | primeira fatia implementada | Remove o sorteio de zoom/shake genéricos: golpes sincronizados com ação visual confiável recebem zoom central animado por keyframes e shake curto conforme a direção editorial; flash no drop e grading/transições continuam pelas regras existentes. A escala-base é preservada para enquadramentos preenchidos e também na exportação. |
| Segurança de cadência e perfis | implementadas | FPS desconhecido, insuficiente ou VFR não recebe rampa automática. A opção vem habilitada e pode ser desligada; fica preservada nos perfis, e perfis antigos sem o campo continuam válidos. |
| Verificação | passou em testes automatizados | Auto AMV: 132/132; render com FFmpeg: 32/32; typecheck do Auto AMV e build do desktop passaram. Testes cobrem alinhamento do pico, zoom animado contextual, recorte guiado por movimento, FPS baixo, VFR, opção desligada e aceleração em preparação. A validação comparativa com mídia real autorizada e no WebView2 continua pendente; não há interpolação de quadros nem promessa de slow motion suave em qualquer fonte. |

## Composição multicamadas (schema v9)

| Item | Estado | Como foi verificado |
|---|---|---|
| PIP, enquadramento dividido, recorte, máscaras e blend modes | implementados | Inspector altera clipes reais; exportação usa máscaras alpha e blend em RGB, além de teste FFmpeg com máscara, multiply e pixels. |
| Transformações animadas e alças no preview | implementadas | Keyframes de posição, escala, rotação e opacidade alimentam preview e exportação; render real testa escala/opacidade animadas. |
| Agrupamento e cópia | implementados | Grupos movem juntos na timeline; cópias de grupos recebem ids independentes e cópia isolada não mantém grupo órfão; teste em `packages/project/test/edit.test.ts`. |
| Migração e validação | implementadas | Migração v8→v9 adiciona blend normal, máscara nenhuma e grupo nulo; teste de serialização. |
| Limites e verificação manual | pendentes | Máscaras disponíveis são formas/metades sem feather. Paridade visual geral e interação de alças precisam de validação no WebView2; não há material visual real no teste automatizado. |
| Verificação automatizada | passou com ressalva | Projeto: 71/71; desktop: 27/27; typechecks de project/render/desktop e build desktop passaram. O teste de composição FFmpeg passou; a execução inicial teve 23/24 na suíte render por causa do fixture saturado de color grading. A asserção foi corrigida posteriormente; a suíte atual passa 24/24. |

## Perfis criativos reutilizáveis (2026-11-10)

| Item | Estado | Como foi verificado |
|---|---|---|
| Modelos e perfis editáveis | primeira fatia implementada | Três modelos iniciais combinam estilo, intensidade, foco de cenas, direção editorial, organização temporal, falas, texto e efeitos. O usuário pode salvar, renomear, atualizar, reutilizar e excluir perfis próprios. |
| Influência na montagem | implementada | Ênfases de ação/emoção alteram o peso de sinais já existentes; emoção principal só recebe bônus quando a análise visual tem confiança suficiente. A justificativa do clipe explicita o sinal usado. |
| Persistência e compatibilidade | implementadas | Perfis personalizados são validados e gravados atomicamente em `perfis-criativos.json` na pasta local do app; perfis padrão ficam no código. Nenhuma migração de `.amvproj` é necessária. Arquivo inválido não é sobrescrito silenciosamente. |
| Testes | passou | Auto AMV: 122/122; desktop: 2/2 testes de persistência; typechecks de Auto AMV e desktop e build de produção Vite passaram. O bundle principal segue acima de 500 kB. Falta validação visual em WebView2, montagem editorial com mídia real autorizada e benchmark no hardware-alvo. |

## Redesign visual do editor

| Item | Estado | Como foi verificado |
|---|---|---|
| Cabeçalho do projeto, biblioteca, preview, timeline e painéis laterais | implementado; inspeção visual parcial | JSX/CSS reorganizados sem trocar os handlers ou os dados exibidos; typecheck e build do desktop passaram. A abertura Windows mostrou a tela inicial em 1386×788; timeline, preview e painéis do editor não foram conferidos nesta sessão. |
| Regressão dos fluxos de player e sessão | passou | 24/24 testes (`player-audio` e `session`) com `AMV_FFMPEG` e `AMV_FFPROBE` apontando para os sidecars locais. |
| Aplicativo em execução no Windows/WebView2 | passou parcialmente | O app desktop instalado abriu na v0.6.10 após a atualização; a tela inicial foi observada. O teste foi interrompido quando houve interação do usuário; não foram exercitados projeto aberto, mídia, timeline ou preview. |

## Revisão assistida do AMV

| Item | Estado | Como foi verificado |
|---|---|---|
| Análise visual por personagem | otimização implementada | A extração de quadros para classificação por IA agora roda em lotes de até três processos FFmpeg concorrentes; cache por cena, lotes do provedor e cancelamento foram preservados. |
| Contexto visual no assistente | primeira fatia implementada | Ao revisar a timeline, o assistente carrega rótulos visuais já existentes do cache e os associa aos clipes usados, incluindo confiança; o prompt proíbe afirmar que viu o vídeo. |
| Revisão de problemas com a assistente | implementada | Cada achado do Avaliador audiovisual pode abrir o Assistente com o trecho selecionado e pedir uma proposta revisável; não altera a timeline sem aprovação. |
| Verificação | passou parcialmente | Desktop: typecheck e 24/24 testes de sessão/player; Assistant: teste do resumo visual e suíte do pacote. A build/tempo de inferência com modelo real ainda precisam de verificação. |
| Análise semântica do arquivo exportado | pendente | Exportação já verifica integridade, duração, FPS, streams, sincronismo A/V e trechos pretos; ainda não há revisão semântica de quadros do arquivo final por IA nem comparação editorial completa com a timeline. |

## Reformulação visual ampla da interface

| Item | Estado | Como foi verificado |
|---|---|---|
| Sistema visual compartilhado | primeira camada implementada | Tokens, foco, superfícies, botões e diálogos atualizados sem adicionar dependências nem alterar os fluxos de edição. |
| Início, editor, música, cenas, efeitos sonoros, assistente e geração | primeira camada implementada | Hierarquia visual, espaçamento, responsividade e estados existentes foram preservados; a timeline e o preview mantêm os mesmos handlers. |
| Transporte do preview | implementado | Busca temporal por quadro e tela cheia usam o playhead e o monitor existentes. |
| Build e testes do desktop | passou | Build/typecheck de produção passou; 42/42 testes passaram com `AMV_FFMPEG` e `AMV_FFPROBE` apontando para os sidecars locais. |
| Inspeção visual 1920×1080 e viewport menor no Windows/WebView2 | pendente | Só foi observada a janela em 1386×788. A comparação nos viewports solicitados, a inspeção visual da timeline/preview e a paridade com render real ainda não foram feitas. |
