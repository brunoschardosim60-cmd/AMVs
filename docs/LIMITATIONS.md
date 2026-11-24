# Limitações Conhecidas — AMV Studio (v0.6.31)

1. **Recorte de personagem (SAM2) fora do instalador:**
   O protótipo com SAM2 foi reprovado na avaliação de qualidade/desempenho em cenas de anime (ver `docs/archive/SAM2_QUALITY_BENCHMARK.md`). O endpoint `/segmentation/jobs` permanece apenas como recurso experimental (`experimental: true`) para pesquisa e não é empacotado no instalador.

2. **Reconhecimento semântico de personagem e emoção:**
   Os testes automatizados de visão usam provedores simulados (mocks). Sem um provedor de visão real configurado (Ollama local, OpenAI ou Gemini), o AMV Studio usa descritores visuais locais (movimento, brilho, histograma de cor, tags de ação/calma) e não afirma identidade de personagem.

3. **Músicas com andamento muito livre (rubato extremo) ou sem percussão:**
   Embora a v0.6.31 detecte andamento variável (`tempoVariable`) e compassos `3/4`, `4/4` e `6/8` relaxando o rastreador DP de batidas, faixas puramente orquestrais ou a cappella ainda podem exigir ajuste fino de offset ou cortes manuais na timeline.

4. **Sincronia de letra via Whisper em músicas muito densas:**
   O alinhamento de voz cantada sobre instrumental pesado usa `vad_filter=False` para não descartar vocais, mas vocais muito abafados podem gerar tempos aproximados. Use o botão **Auto-sync** no painel de Legendas ou arquivos `.LRC`/`.SRT` sincronizados para precisão máxima.

5. **Preview no Windows (WebView2):**
   A reprodução em tempo real no preview depende dos codecs disponíveis no WebView2/Media Foundation do Windows (vídeos H.264/AAC funcionam nativamente; MKV com faixas exóticas ou 10-bit podem precisar de proxy). Consulte [TESTE_MANUAL_WINDOWS.md](./TESTE_MANUAL_WINDOWS.md).
