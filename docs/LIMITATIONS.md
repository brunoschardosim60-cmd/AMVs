# Limitações conhecidas

- **VFR**: detecção por heurística (r_frame_rate × avg_frame_rate, 1%). MKV raramente informa número de quadros; casos de VFR sutil podem passar sem aviso.
- **Miniaturas rápidas**: com `-skip_frame nokey`, cada miniatura é o keyframe mais próximo, não o instante exato. Suficiente para a régua da timeline.
- **Hash parcial**: dois arquivos com mesmo tamanho, início e fim idênticos teriam o mesmo hash. Improvável em mídia real.
- **Linux (desenvolvimento)**: o WebKitGTK não reproduz vídeo/áudio servido pelo asset protocol do Tauri. Alvo é Windows (WebView2); no Linux a pré-visualização de mídia fica indisponível.
- **Preview no painel de detalhes** usa `<video>` com o proxy: é para conferir a mídia, não é preciso quadro a quadro (o preview da timeline vem na Fase 2).
- **Analisador Python** ainda não é iniciado pelo app (entra na Fase 4).
