# Limitações conhecidas

- **VFR**: detecção por heurística (r_frame_rate × avg_frame_rate, 1%). MKV raramente informa número de quadros; casos de VFR sutil podem passar sem aviso.
- **Miniaturas rápidas**: com `-skip_frame nokey`, cada miniatura é o keyframe mais próximo, não o instante exato. Suficiente para a régua da timeline.
- **Hash parcial**: dois arquivos com mesmo tamanho, início e fim idênticos teriam o mesmo hash. Improvável em mídia real.
- **Linux (desenvolvimento)**: o WebKitGTK não reproduz vídeo/áudio servido pelo asset protocol do Tauri. Alvo é Windows (WebView2); no Linux a pré-visualização de mídia fica indisponível.
- **Preview no painel de detalhes** usa `<video>` com o proxy: é para conferir a mídia, não é preciso quadro a quadro (o preview da timeline vem na Fase 2).
- **Analisador Python** ainda não é iniciado pelo app (entra na Fase 4).
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
- **Falas**: sem transcrição automática (Whisper). "Entender o que o personagem fala" só funciona em episódios com legenda embutida; sem legenda, o app detecta que alguém fala/grita, mas não o texto.
- **Tradução** depende de um modelo de IA ligado; modelos pequenos erram linhas (essas ficam no original e o app avisa). Em modelos na nuvem o texto é enviado ao provedor.
- **YouTube/Spotify**: não é possível (nem permitido pelos termos deles) extrair o áudio para usar no AMV. Só dá para ouvir/pesquisar pelos players oficiais, e a análise de "que parte combina" exige um arquivo de música seu. Ainda não implementado (ver AGENTS.md §3, itens 8–9).
- **Efeitos sonoros** são sintetizados (impacto, golpe, whoosh, subida): bons para AMV de ação, mas não substituem uma biblioteca de efeitos profissionais. Ainda não dá para trocar por arquivos seus.
- **Análise com visão**: testada com um modelo **falso** (o caminho todo funciona: quadro real do FFmpeg → HTTP → rótulos → montagem), **não com um modelo real**. A qualidade do reconhecimento de personagens depende do modelo; sem nome certo ele descreve ("garoto de cabelo laranja"), e o mesmo personagem pode receber rótulos diferentes entre lotes. Há um modo detalhado que amostra 3 quadros de cada cena útil do episódio (cenas abaixo de 0,25 s ficam de fora); ainda não há confiança nem revisão manual dos rótulos. Cada quadro vai ao serviço escolhido: na nuvem gera custo e envia imagens do episódio.
- A interface foi verificada num Chromium (Linux) com FFmpeg real, não no WebView2 do Windows: falta o teste manual lá (fontes, DPI, arrastar do Assistente).
