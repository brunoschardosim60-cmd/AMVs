# Limitações Conhecidas — AMV Studio (v0.7.0)

1. **Recorte de personagem sem modelo ONNX externo:**
   Por padrão, o instalador não embute pesos pesados de 200+ MB; o recorte usa matting cromático/contorno de anime instantâneo (ou máscara `subject-focus`). Para recorte neural de fios finos em GPU Windows (AMD/Intel/NVIDIA via DirectML), coloque um modelo compatível (`birefnet-lite.onnx` ou `rmbg-1.4.onnx`) em `models/` ou aponte `AMV_CUTOUT_MODEL`. O antigo protótipo SAM2 por vídeo permanece arquivado como `experimental: true`.

2. **Isolamento de voz em falas do episódio:**
   `voiceIsolation` usa extração de canal central + filtragem espectral no FFmpeg (instantâneo e sem artefatos metálicos), reduzindo bastante a trilha de fundo do anime, mas não remove 100% de efeitos sonoros mono centralizados na mesma faixa da voz.

3. **Preview no Windows (WebView2):**
   Filtros exclusivos de exportação (`voiceIsolation`, `echoTail` e `minterpolate`) são ouvidos/vistos na renderização final do FFmpeg; o preview prioriza resposta em tempo real.
