# Isolamento e composição temporal de personagens

## Auditoria da arquitetura atual

- `Project` guarda assets de arquivo único e clipes que apontam para um asset; o schema atual não tem um tipo para sequência de imagens com alpha, máscara ou proveniência de segmentação.
- `ProjectHistory` já agrupa `Command`s, então inserir a camada e uma trilha de composição pode ser uma única ação de undo/redo.
- O preview (`Player`) cria um elemento HTML por asset e desenha no canvas. Não existe decodificador de sequência RGBA nem ferramenta de clique/paint de máscara.
- `packages/render` separa a timeline em janelas e compõe as camadas com FFmpeg. O caminho atual não descreve uma sequência de quadros RGBA como origem de um clipe.
- O sidecar Python agora tem endpoints autenticados de transcrição e segmentação, ambos com jobs/cancelamento; o job de segmentação e a sequência RGBA ainda são um protótipo backend. O bundle PyInstaller e o checkpoint passaram smoke test e inferência sintética com FFmpeg; o instalador Tauri ainda não foi construído.
- Portanto, uma UI que só desenhe uma silhueta ou que use um PNG estático não seria tracking e não será adicionada como substituto.

## Avaliação de alternativas

| Opção | Código/modelo | Prompt e propagação | Windows/CPU | Decisão |
|---|---|---|---|---|
| SAM 2 / SAM 2.1 Hiera Tiny | Repositório e checkpoints sob Apache-2.0, declarado pelo README oficial e pelo model card `facebook/sam2.1-hiera-tiny`. 38,9 milhões de parâmetros para Tiny; o upstream não estabelece requisito de RAM/VRAM mínimo. | Prompts de pontos/caixas em vídeo e propagação temporal com memória; melhor ajuste ao fluxo de clicar no personagem e acompanhá-lo. | O INSTALL upstream declara Linux como plataforma e recomenda WSL com Ubuntu para Windows; requer Python ≥3.10, PyTorch ≥2.5.1 e TorchVision correspondente. A extensão CUDA pode ser omitida, com pós-processamento limitado. O benchmark de velocidade é em A100. No host Windows disponível, o sidecar CPU processou três quadros sintéticos via FFmpeg; faltam medição de RAM e validação visual com mídia autorizada. | **Selecionado pelo usuário para spike em CPU**, com runtime e pesos no instalador principal se os gates técnicos passarem; ainda não aprovado para distribuição. |
| Cutie | Código MIT; licença/termos do checkpoint precisam de revisão independente. A documentação declara teste em Ubuntu e requer PyTorch/TorchVision. | Boa propagação temporal de uma máscara inicial; para o fluxo por clique seria necessário adicionar e manter outro segmentador de quadro inicial. | Não há suporte Windows nativo declarado e os exemplos principais movem modelo/quadro/máscara para CUDA. CPU não foi validada aqui. | Não é a primeira opção: duas etapas de modelo aumentariam dependências e falhas operacionais. |
| XMem | Código MIT; checkpoint separado também requer revisão dos termos. | Propagação temporal de máscara, sem resolver sozinho o prompt por clique no primeiro quadro. | O repositório e os exemplos são focados em PyTorch/CUDA; compatibilidade/latência no Windows e CPU não demonstradas neste projeto. | Referência técnica, não primeira integração. |

Fontes primárias consultadas em 2026-11-09:

- [SAM 2 README](https://github.com/facebookresearch/sam2) e [licença do código SAM 2](https://raw.githubusercontent.com/facebookresearch/sam2/main/LICENSE).
- [SAM 2 INSTALL](https://github.com/facebookresearch/sam2/blob/main/INSTALL.md) e [model card oficial SAM 2.1 Hiera Tiny](https://huggingface.co/facebook/sam2.1-hiera-tiny).
- [Cutie README](https://github.com/hkchengrex/Cutie), [avaliação/checkpoints Cutie](https://github.com/hkchengrex/Cutie/blob/main/docs/EVALUATION.md) e [licença do código Cutie](https://raw.githubusercontent.com/hkchengrex/Cutie/main/LICENSE).
- [Licença do código XMem](https://raw.githubusercontent.com/hkchengrex/XMem/main/LICENSE).

As fontes não publicam requisitos de RAM/VRAM ou velocidade de CPU aplicáveis ao AMV Studio. O host Windows disponível reporta Ryzen 5 3600, 16 GB de RAM e AMD Radeon RX 580 4 GB; não há CUDA/NVIDIA. O sidecar empacotado processou via FFmpeg um clipe sintético de três quadros 256×256 a 1 fps em 13,95 s; o working set máximo amostrado do processo foi ~1.079 MiB. Velocidade aquecida e qualidade em anime, especialmente a 24/30 fps, ainda não foram medidas. Aceleração AMD/DirectML não é presumida.

## Desenho técnico proposto

### Fluxo de dados

1. A ferramenta captura a seleção atual e o intervalo do clipe, sem alterar a mídia original.
2. O preview pausado fornece o quadro exato (proxy para interação; quadros de origem decodificados pelo FFmpeg para processamento). Clique positivo e, para exclusão, cliques negativos podem ser adicionados no quadro-semente.
3. FFmpeg extrai somente o intervalo escolhido em resolução configurável e taxa CFR igual à taxa do projeto. VFR e mapeamento entre `sourceInUs`, velocidade do clipe e o relógio do projeto precisam de teste explícito.
4. Um job local autenticado propaga a máscara no sentido temporal. O protocolo inclui `queued/running/completed/failed/cancelled`, progresso de quadros e cancelamento cooperativo entre inferências.
5. Cache versionado por hash do asset, intervalo, taxa/resolução, modelo/checkpoint e prompts. Gerar em pasta `.partial`; publicar o resultado apenas após validar todas as máscaras/quadros, para nunca usar saída parcial como concluída.
6. Resultado canônico: sequência de quadros RGBA PNG, alinhada ao FPS do projeto, e sequência de máscaras editáveis (PNG de um canal). PNG preserva alpha sem perdas; não transcodificar o recorte intermediário para H.264. Guardar proveniência e parâmetros num manifesto junto ao cache.
7. Uma correção manual altera a máscara daquele quadro; repropagar a partir da correção para frente e para trás e preservar o histórico de máscaras para undo. Não sobrescrever a sequência original já gerada.
8. “Aplicar” cria um asset derivado e um clipe numa trilha de vídeo acima da fonte numa transação única. O asset aponta para o cache/manifesto; o renderizador mistura o RGBA sobre as trilhas abaixo. Transformações e keyframes continuam propriedades normais do clipe.

### Revisão e sinais de incerteza

- Revisar por padrão quadros-chave (início, meio, fim e descontinuidades), com alternância entre original, fundo preto, quadriculado e cor escolhida.
- O score do modelo não será apresentado como probabilidade/confiança calibrada. Mudanças abruptas de área, máscara vazia, variação alta de contorno e regiões sem suporte são **sinais heurísticos para revisão**, explicitamente rotulados.
- A ferramenta deve permitir corrigir com pincel positivo/negativo e repetir propagação. Sem uma máscara válida, sem pontos-semente ou com job interrompido, não existe botão de aplicar.
- Contorno, glow e sombra devem ser efeitos determinísticos sobre o alpha da camada, com parâmetros armazenados no clipe e renderização compartilhada entre preview e exportação.

### Paridade de preview e exportação

- Preview: carregar apenas o quadro RGBA atual/próximo do cache no canvas; desenhar sobre as camadas abaixo, sem `<video>` para cada PNG.
- Exportação: ler a sequência numerada como input FFmpeg com o FPS e índice inicial explícitos e preservar alpha até o `overlay` sobre a composição final.
- Os testes devem medir alpha em pixels transparentes/opacos, ordem de camadas, início/fim do intervalo, corte, escala, posição e um projeto vertical. Comparar pixels do renderer de preview com quadros extraídos da exportação.
- O formato final de distribuição/codec alpha não é requisito do cache: a exportação final pode continuar H.264/H.265 opaca depois da composição.

## Etapas e gates de aceitação

### Fase 2A — Spike do modelo (parcial; gate de qualidade pendente)

- O usuário escolheu incluir runtime e pesos no instalador principal; CI/script de empacotamento foram atualizados. O bundle PyInstaller foi validado e mede 745,9 MiB descompactado (checkpoint 148,8 MiB); o instalador Tauri ainda não foi construído.
- O endpoint empacotado extraiu e processou via FFmpeg três quadros sintéticos com objeto em movimento; as máscaras acompanharam o objeto. PyTorch avisou que a extensão `_C` não foi compilada e que o preenchimento de buracos foi ignorado.
- Cancelamento de um job real foi verificado no meio do processamento: terminou como `cancelled` e não deixou a pasta `.partial`.
- O gate continua aberto: validar qualidade em clipe curto autorizado, medir velocidade aquecida e construir/testar o instalador Tauri. Se o consumo ou a qualidade forem inadequados, reavaliar WSL/modelo. Não presumir CUDA/DirectML nem anunciar o recurso como pronto.

### Fase 2B — Job e artefato (protótipo implementado; validação parcial)

- API autenticada para iniciar/consultar/cancelar jobs, com progresso real e erro explícito.
- Saída temporária `.partial`, sequência PNG RGBA e máscaras PNG, manifesto e reutilização do cache por chave/modelo.
- 15 testes pytest passam; testes automatizados de infraestrutura usam predictor falso. O modelo real e a extração FFmpeg passaram em 3 quadros sintéticos pelo sidecar empacotado; cancelamento real também foi verificado.

### Fase 2C — Seleção e revisão de máscara (depende de 2B)

- Modal acoplado ao clipe selecionado: clicar personagem no preview, escolher clipe/intervalo, processar, revisar e corrigir quadros.
- Indicar pontos a revisar; não preencher falhas com quadros vizinhos nem afirmar identidade de personagem.
- Testes Playwright para coordenadas do prompt, navegação de quadros, edição de máscara, cancelamento e impedir aplicação de job incompleto.

### Fase 2D — Asset, timeline e composição (depende de 2C)

- Migração do schema para o tipo de asset sequencial/proveniência, sem invalidar projetos existentes.
- Aplicar cria trilha/camada RGBA editável com uma ação de undo/redo; original não é tocado.
- Preview e FFmpeg leem a mesma sequência e os mesmos parâmetros de contorno/glow/sombra; testar projeto horizontal e vertical, cancelamento de render e alpha.

### Fase 2E — Polimento

- Cache/limpeza por projeto, retomada segura, múltiplos personagens/correções, keyframes e combinação com fundo desfocado.
- Avaliar aceleração adicional e futuro backend remoto apenas por opt-in explícito; não enviar mídia ao serviço externo automaticamente.

## Estado nesta revisão

Há um protótipo backend: SAM2 real propaga máscaras em quadros sintéticos e grava sequência PNG RGBA/máscaras, com manifesto, cache, job autenticado, progresso e cancelamento. Testes automatizados de infraestrutura usam predictor falso e não substituem validação visual do modelo. Ainda não há UI, correção manual, novo schema/asset, layer na timeline, preview ou render. O instalador principal foi escolhido, mas o build empacotado, a memória, FFmpeg real e a qualidade com clipe autorizado continuam sendo gates obrigatórios.
