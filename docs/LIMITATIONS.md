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
