# Limitações conhecidas

- **VFR**: detecção por heurística (r_frame_rate × avg_frame_rate, 1%). MKV raramente informa número de quadros; casos de VFR sutil podem passar sem aviso.
- **Miniaturas rápidas**: com `-skip_frame nokey`, cada miniatura é o keyframe mais próximo, não o instante exato. Suficiente para a régua da timeline.
- **Hash parcial**: dois arquivos com mesmo tamanho, início e fim idênticos teriam o mesmo hash. Improvável em mídia real.
- **Linux (desenvolvimento)**: o WebKitGTK não reproduz vídeo/áudio servido pelo asset protocol do Tauri. Alvo é Windows (WebView2); no Linux a pré-visualização de mídia fica indisponível.
- **Preview no painel de detalhes** usa `<video>` com o proxy: é para conferir a mídia, não é preciso quadro a quadro (o preview da timeline vem na Fase 2).
- **Analisador Python**: o bundle Windows inclui o runtime do serviço via PyInstaller; o smoke test da API e da disponibilidade de faster-whisper passou no CI Windows. O build completo do instalador ainda precisa passar. No desenvolvimento, o fallback continua exigindo Python e `pip install -e ".[speech]"` em `services/analyzer`.
- **Transcrição faster-whisper**: CPU/int8; o áudio original não é modificado nem enviado. O modelo escolhido pode ser baixado do Hugging Face na primeira execução (centenas de MB ou mais); esse download não tem progresso detalhado. A UI acompanha o áudio extraído e os segmentos reconhecidos; cancelar é cooperativo e, se o carregamento/inferência não parar em 5 s, encerra o processo do analisador para garantir o cancelamento. A faixa de áudio pode ser escolhida e é convertida em WAV mono no cache. Ainda não há teste com áudio/modelo reais.
- **Tamanho do instalador**: o build GPL completo do FFmpeg tem ~166 MB por executável (ffmpeg + ffprobe). Dá para reduzir com um build enxuto (só os codecs usados) numa fase de polimento.

## Assistente, músicas e legendas (0.5.0)
- O assistente não mostra a prévia "fantasma" na timeline nem o A/B lado a lado; o "Testar" aplica de verdade e "Voltar ao original" desfaz.
- Sem modelo de IA, o chat só entende pedidos diretos (palavras-chave).
- Semelhança entre personagens precisa de um modelo de visão e ainda não existe.
- Músicas: YouTube/Spotify ainda não; pastas monitoradas ainda não. Emoção é só a que você marca.
- Legendas: sem transcrição automática (Whisper) e sem tradução por enquanto; letra sem tempo (.txt) precisa ser posicionada à mão.

## 0.6.0
- **Ajuste fino da sincronia**: a geração permite antecipar/atrasar batidas e drop em até 500 ms sem mover a música. Resolve deslocamento constante percebido pelo usuário, mas não corrige deriva causada por andamento variável; a calibração com músicas reais continua pendente.
- **Sincronia automática validada em sinais sintéticos** (cliques/bumbo em andamento fixo): erro ~0,2 ms de viés. Em música real, o rastreador de andamento global pode se afastar, sobretudo em faixas que aceleram/desaceleram; o ajuste fino manual ajuda com deslocamento constante, mas não elimina deriva.
- **Golpe na batida** é heurístico: usa o quadro de maior diferença entre quadros. Câmera tremendo ou flash pode ser confundido com o golpe.
- **Lutas** são separadas por intensidade, pausas frias (> 6 s) e cenas escuras. Duas lutas coladas, sem pausa nem fade, viram uma só. Não reconhece personagens.
- **Falas**: a transcrição local automática agora está integrada; a qualidade e o tempo dependem do modelo e da faixa escolhida. Ainda não há teste com modelo real. Sem transcrição, "entender o que o personagem fala" depende de legendas embutidas.
- **Tradução** depende de um modelo de IA ligado; modelos pequenos erram linhas (essas ficam no original e o app avisa). Em modelos na nuvem o texto é enviado ao provedor.
- **YouTube/Spotify**: não é possível (nem permitido pelos termos deles) extrair o áudio para usar no AMV. Só dá para ouvir/pesquisar pelos players oficiais, e a análise de "que parte combina" exige um arquivo de música seu. Ainda não implementado (ver AGENTS.md §3, itens 8–9).
- **Efeitos sonoros** são sintetizados (impacto, golpe, whoosh, subida): bons para AMV de ação, mas não substituem uma biblioteca de efeitos profissionais. Ainda não dá para trocar por arquivos seus.
- **Análise com visão**: testada com um modelo **falso** (o caminho todo funciona: quadro real do FFmpeg → HTTP → rótulos → montagem), **não com um modelo real**. A qualidade do reconhecimento de personagens depende do modelo; sem nome certo ele descreve ("garoto de cabelo laranja"), e o mesmo personagem pode receber rótulos diferentes entre lotes. Há um modo detalhado que amostra 3 quadros de cada cena útil do episódio (cenas abaixo de 0,25 s ficam de fora); ainda não há confiança nem revisão manual dos rótulos. Cada quadro vai ao serviço escolhido: na nuvem gera custo e envia imagens do episódio.
- A interface foi verificada num Chromium (Linux) com FFmpeg real, não no WebView2 do Windows: falta o teste manual lá (fontes, DPI, arrastar do Assistente).
