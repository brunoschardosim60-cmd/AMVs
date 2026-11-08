# Testes de interface (só desenvolvimento)

Rodam o app **real** (mesmos componentes React) num Chromium, com arquivos e FFmpeg reais
através de uma ponte Node. Não fazem parte do app instalado.

Requisitos: `ffmpeg`, Python 3 com `playwright` (`pip install playwright && playwright install chromium`).

```bash
python3 apps/desktop/dev/e2e/make_media.py          # cria /tmp/media (episódio + música)
apps/desktop/dev/e2e/run.sh audit_flow.py 1366 768  # procura controles cobertos/inclicáveis em cada tela
apps/desktop/dev/e2e/run.sh assistant_floating.py   # arrastar/minimizar/reabrir o assistente
apps/desktop/dev/e2e/run.sh vision_flow.py          # análise de cenas com IA (modelo falso) até a montagem
```

`run.sh` sobe a ponte (`dev/bridge.mjs`, porta 1421) e o Vite (`vite.harness.config.ts`, porta 1430),
roda o script e derruba tudo. A ponte inclui um modelo de visão FALSO compatível com OpenAI
(`/fake-llm/v1`) para testar a análise de cenas sem gastar nada.

`audit.py` mede, para cada botão/campo visível, se o ponto central realmente recebe o clique
(`elementFromPoint`): é o sintoma "botão que não pega" (algo por cima ou cortado).
