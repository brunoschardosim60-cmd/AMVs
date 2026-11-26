# Limitações Conhecidas — AMV Studio

## Limitações atuais

1. **Validação com mídia real pendente:**
   Os pipelines automatizados (Vitest + FFmpeg) cobrem fluxos e regressões apenas com **mídia sintética** (`fixtures/`). A confirmação de fluidez em episódios reais, sincronia rítmica subjetiva e paridade visual Preview × Export depende da execução do protocolo em [VALIDACAO_REAL.md](./VALIDACAO_REAL.md).

2. **Preview de tempo real × filtros exclusivos de exportação (WebView2):**
   O preview interativo prioriza fluidez em tempo real usando proxies H.264 8-bit CFR e sprites de texto pré-aquecidos (`sheen` e `chromaticAberration` amostrados em ponto estável; sem motion blur CSS por quadro). Filtros pesados de áudio/vídeo (`voiceIsolation`, `echoTail` e `minterpolate` em slow-motion) e a sequência PNG quadro a quadro completa das legendas são aplicados integralmente na exportação FFmpeg.

3. **Isolamento de voz local (`voiceIsolation`):**
   Baseado em extração de canal central e filtragem espectral no FFmpeg: atenua a trilha estéreo de fundo sem artefatos metálicos, mas não separa 100% de efeitos sonoros mono na mesma faixa de frequência da voz.

4. **Recorte de personagem sem pesos ONNX embutidos + SAM 2 experimental:**
   O instalador não inclui checkpoints pesados (200+ MB); por padrão usa matting cromático/contorno local instantâneo ou máscaras geométricas em `V2`. Para recorte neural em GPU Windows (DirectML), coloque um modelo compatível (`birefnet-lite.onnx` ou `rmbg-1.4.onnx`) em `models/` ou aponte `AMV_CUTOUT_MODEL`. O endpoint de segmentação de vídeo SAM 2 (`services/analyzer/amv_analyzer/segmentation.py`) permanece marcado como `experimental: true` e fora do fluxo padrão do instalador.

5. **Streaming externo apenas como referência:**
   Faixas pesquisadas em catálogos externos não têm áudio extraído nem baixado pelo app; para editar e exportar na timeline, o usuário importa arquivos de áudio próprios.

---

## Histórico de validações

Relatórios de spikes, benchmarks experimentais de segmentação e rodadas anteriores foram arquivados em [`docs/archive/`](./archive/):

- [Benchmark alternativo de segmentação de anime](./archive/ALTERNATIVE_ANIME_SEGMENTATION_BENCHMARK.md)
- [Pesquisa histórica de algoritmos de montagem](./archive/AMV_ALGORITHM_RESEARCH.md)
- [Validação histórica de referência do motor](./archive/AMV_ENGINE_REFERENCE_VALIDATION.md)
- [Registro anterior de validação com mídia real](./archive/AMV_REAL_MEDIA_VALIDATION.md)
- [Benchmark experimental SAM 2.1](./archive/SAM2_QUALITY_BENCHMARK.md)
- [Relatório histórico de limpeza do projeto](./archive/PROJECT_CLEANUP_REPORT.md)
