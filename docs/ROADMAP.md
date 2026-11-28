# Roadmap — AMV Studio

## Entregue até v0.10.0

- **AMV Creative Intelligence Engine (v0.10.0):** motor modular completo de compreensão musical (arquétipos A–E, frases vocais × instrumentais), compreensão visual multiclasse (24 categorias simultâneas, fases de ação e vetores direcionais), alinhamento semântico (literal, metafórico, emocional, contextual e contraste intencional), direção narrativa não linear (12 modelos incluindo *cold open* pelo clímax e mistura entre episódios), continuidade coreográfica/emocional com memória contextual, respiração cinematográfica, avaliação global independente e painel interativo `Creative Direction Preview`.
- **Download simplificado, recorte neural V2 e blindagem de camadas (v0.9.6–v0.9.10):** recorte de personagem `IS-Net Anime` ONNX DirectML GPU em vídeo transparente VP9 Alpha, seleção da melhor parte da música sem abafar o refrão, controles pós-geração de letras/legendas/música e exportação simplificada por cartões de qualidade (`720p`, `1080p`, `1440p/4K`).
- **Editor multipista e exportação FFmpeg:** timeline com vídeo (`V1`/`V2`), áudio (`Música`, `Falas`, `Efeitos`) e texto, undo/redo por comandos puros, proxies automáticos e renderização H.264/H.265/ProRes.
- **Montagem assistida e avaliação objetiva (`@amv/automv`):** seleção rítmica por batida/drop, arco narrativo, torneio de candidatos, auto-reparo de micro-cortes/repetições/luminosidade e justificativa auditável (`reason` + `confidence`) em cada clipe gerado.
- **Tipografia, legendas e recortes:** fontes locais embutidas, presets de tipografia AMV, modos de mesclagem com vídeo, recorte de personagem em `V2` com fallback local e sincronização/tradução de letras e falas.
- **Rodada de estabilização (v0.9.5):**
  - Baseline medido em [BASELINE.md](./BASELINE.md).
  - Motor de preview estabilizado com sprites de texto pré-aquecidos, contenção de sockets HTTP/1.1 no WebView2 e eliminação de auto-seek por atraso de quadro.
  - Blindagem numérica (`NaN`/divisão por zero), eliminação da corrida em undo/redo de importação e degradação por timeout no sidecar Python.
  - Protocolo de validação em mídia real ([VALIDACAO_REAL.md](./VALIDACAO_REAL.md)) e proposta de redução de superfície ([PROPOSTA_MODO_PRO.md](./PROPOSTA_MODO_PRO.md)).

## Próximos passos (estabilização contínua, sem novas features)

1. **Executar a validação humana em mídia real** nos 3 cenários definidos em [VALIDACAO_REAL.md](./VALIDACAO_REAL.md) e no roteiro [TESTE_MANUAL_WINDOWS.md](./TESTE_MANUAL_WINDOWS.md).
2. **Concluir a divisão modular dos monólitos** mapeados em [BASELINE.md](./BASELINE.md) (`generate.ts`, `GenerateDialog.tsx`, `Timeline.tsx`, `Inspector.tsx`, `session.ts`) em módulos menores mantendo 100% de compatibilidade comportamental.
3. **Revisar e decidir sobre o `Modo Pro`** conforme [PROPOSTA_MODO_PRO.md](./PROPOSTA_MODO_PRO.md) após feedback do usuário.
