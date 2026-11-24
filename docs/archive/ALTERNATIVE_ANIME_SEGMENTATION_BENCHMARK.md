# Alternativas de segmentação de anime — Fases 2.3 e 2.4

## Decisão atualizada após a Fase 2.4

**A conversão ONNX não é a causa da máscara fraca.** PyTorch original e ONNX, alimentados com o mesmo tensor FP32 de 1024×1024, produziram máscaras numericamente equivalentes (MAE por quadro de `1.7e-8` a `7.4e-8`; diferença absoluta máxima de `1.92e-6`). O ONNX testado tem entrada estática 1024×1024, mas o `config.json` oficial do checkpoint declara `img_size: 640`. O teste anterior usou 1024.

Com o tamanho oficial 640, o PyTorch recuperou sinal de máscara em alguns quadros, principalmente no primeiro close-up, porém não segmentou o alvo de forma consistente: os quadros de ação 02 e 03 ficaram praticamente sem alpha, e o quadro 04 teve apenas valores parciais abaixo de 0,5. No quadro 01, o máximo foi 0,473. O resultado **continua reprovado para recorte confiável neste material**, embora agora se saiba que a avaliação anterior a 1024 não respeitava o tamanho do config oficial. Não há ground truth anotado; as conclusões são visuais e específicas aos cinco quadros.

Não foi testado vídeo/tracking, CUTIE nem o episódio inteiro. Não houve alteração na interface, timeline, instalador ou arquitetura; não houve commit/push. Código, checkpoint e resultados estão fora do repositório.

## Configuração e evidências — Fase 2.3 (teste ONNX inicial)

| Item | Resultado |
|---|---|
| Material | episódio fornecido pelo usuário e autorizado para processamento local |
| Arquivo | `05. The Highest vs. The Lowest (1).mkv` |
| Quadros avaliados | 857,50; 858,00; 858,25; 859,50; 860,38 s |
| Resolução | 1280×720 |
| Hardware declarado | Ryzen 5 3600, 16 GB RAM, Radeon RX 580 4 GB |
| Inferência | CPUExecutionProvider; CUDA não usado |
| Runtime isolado | Python 3.12.13, ONNX Runtime 1.31.1, OpenCV 5.0.0 |
| Entrada do modelo | `img`, `[1, 3, 1024, 1024]`, float32 |
| Pré-processamento | letterbox RGB para 1024×1024, igual ao app oficial SkyTNT |
| Modelo | `skytnt/anime-seg`, revisão `493cb60893f47441b26ec4fb9a306bce9e342982`, arquivo `isnetis.onnx` |
| SHA-256 ONNX | `f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99` |
| Tempo de carregamento da sessão | 0,5392 s |
| Tempo médio de inferência | 1,9284 s/quadro; 0,519 quadro/s |
| Pico de working set observado | 1761,7 MiB |

O benchmark de tempo cobre inferência ONNX, não decodificação ou escrita das imagens. A memória é o pico observado do processo, incluindo o runtime, não uma medida isolada de alocação do modelo. VRAM não foi usada nem medida.

JSON com os valores por imagem: `C:\Users\Bruno\Videos\AMV-SAM2-Quality\resultados\skytnt_isnetis_image_tests\metrics.json`.

## Avaliação visual — Fase 2.3

Comparativo gerado com original, máscara em escala de cinza, composição sobre preto, branco, magenta e quadriculado de transparência:

`C:\Users\Bruno\Videos\AMV-SAM2-Quality\resultados\skytnt_isnetis_image_tests\comparison.png`

Arquivos PNG integrais de origem, máscara e recorte RGBA também ficam nessa pasta (`original_*.png`, `mask_*.png`, `cutout_*.png`). As cinco máscaras têm área com alpha ≥ 0,5 igual a zero. Os quadros de close-up deixam uma resposta muito fraca, sem recorte de cabelo/rosto/roupa; nas imagens de ação a máscara também não separa o personagem do cenário. Isso é falha de recorte, não uma avaliação de fidelidade de contorno: não existe silhueta suficientemente opaca para avaliar fios, acessórios ou bordas com precisão.

Não foi aplicado contraste artificial, limiar adaptativo nem correção manual à máscara final, pois isso poderia criar a impressão de uma segmentação que o modelo não entregou. Não há máscara de referência; métricas de precisão/IoU não foram calculadas.

## Validação do checkpoint PyTorch original — Fase 2.4

### Integridade e execução

| Item | Resultado |
|---|---|
| Fonte do checkpoint | URL oficial `https://huggingface.co/skytnt/anime-seg/resolve/main/isnetis.ckpt` |
| Tamanho / SHA-256 | 204.275.908 bytes / `2c8f6b9a77386c54dcdbf55b6c917108c4bdf4328abca9152c7bce5727b74d18` (conferido antes de carregar) |
| `config.json` HF | `net_name: isnet_is`, `img_size: 640` |
| Código oficial | `SkyTNT/anime-segmentation`, commit `55d874013a2811cdf59c365059174c7823acf5b4` |
| Execução | `inference.py --net isnet_is --device cpu --fp32 --only-matted`, cinco imagens, tamanhos 640 e 1024 |
| Runtime PyTorch | Python 3.12.13; PyTorch 2.5.1+cpu; TorchVision 0.20.1+cpu; OpenCV 5.0.0; CPU, sem CUDA |
| Threads na medição de máscaras brutas | 6 |
| Quadros | Os mesmos cinco PNGs usados na Fase 2.3; SHA-256 de cada arquivo comparado e idêntico |
| VRAM | Não usada |

O script oficial foi executado diretamente nos dois tamanhos. A medição bruta usou `inference.get_mask` do mesmo checkout e conferiu que a máscara produzida corresponde à saída do script oficial: a alpha PNG quantizada coincide pixel a pixel em ambos os tamanhos (diferença máxima zero).

### Verificação da conversão ONNX e do pipeline

- **Canais:** `inference.py` lê BGR com OpenCV e converte para RGB antes da inferência. O mesmo RGB foi usado para preparar o tensor ONNX.
- **Normalização:** divisão por 255 para `float32`, intervalo observado `[0,1]`; sem mean/std adicional.
- **Geometria:** redimensionamento preservando proporção, centralização em canvas quadrado preenchido com zeros e remoção do padding após inferência; o redimensionamento foi reproduzido com OpenCV.
- **Tensor:** entrada NCHW `float32`, `[1,3,1024,1024]` no teste de paridade; a saída ONNX é `[1,1,1024,1024]`, `float32`.
- **Sigmoid/alpha:** `AnimeSegmentation.forward` aplica sigmoid ao primeiro mapa ISNet. O ONNX já contém essa operação: sua saída coincide com a saída PyTorch; não foi aplicada sigmoid adicional, inversão nem limiar. A saída é usada diretamente como alpha.
- **Runtime:** ONNX Runtime 1.31.1 com `CPUExecutionProvider`.

| Quadro | MAE PyTorch×ONNX | RMSE | Diferença absoluta máxima | Correlação |
|---|---:|---:|---:|---:|
| 00 | 2.18e-8 | 2.97e-8 | 2.76e-7 | 0.999999999994 |
| 01 | 2.30e-8 | 3.05e-8 | 2.63e-7 | 0.999999999990 |
| 02 | 1.65e-8 | 2.09e-8 | 1.06e-7 | 0.999999993191 |
| 03 | 1.73e-8 | 2.18e-8 | 1.28e-7 | 0.999999999862 |
| 04 | 7.40e-8 | 1.35e-7 | 1.91e-6 | 0.999999999979 |

**Conclusão do diagnóstico:** não há evidência de falha de conversão nem de diferença do ONNX Runtime. A execução ONNX anterior usou 1024 embora o config HF do checkpoint diga 640; essa discrepância explica por que o teste inicial não representava a configuração publicada. Ela não explica, por si só, a máscara quase vazia nos quadros de ação nem torna o recorte confiável.

### Métricas de alpha

Estatísticas calculadas sobre a máscara float32 restaurada à resolução original 1280×720, sem threshold ou contraste artificial. Percentuais são fração dos pixels acima do limiar indicado.

| Backend / tamanho | Quadro | Mínimo | Máximo | Média | Desvio padrão | >0.01 (%) | >0.1 (%) | >0.5 (%) | NaN | Inf |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| PyTorch / 640 | 00 | 5.19e-6 | 0.991617 | 0.182041 | 0.326393 | 41.9729 | 26.9632 | 18.6138 | 0 | 0 |
| PyTorch / 640 | 01 | 1.54e-5 | 0.473411 | 0.0366278 | 0.0635584 | 42.6931 | 13.7857 | 0 | 0 | 0 |
| PyTorch / 640 | 02 | 5.80e-6 | 0.00977725 | 0.001048 | 0.00161508 | 0 | 0 | 0 | 0 | 0 |
| PyTorch / 640 | 03 | 5.72e-6 | 0.0114301 | 0.00121908 | 0.00186195 | 0.0584 | 0 | 0 | 0 | 0 |
| PyTorch / 640 | 04 | 6.24e-6 | 0.401518 | 0.0440529 | 0.0428491 | 71.3424 | 11.2729 | 0 | 0 | 0 |
| PyTorch / 1024 | 00 | 4.47e-6 | 0.0625113 | 0.00533298 | 0.00824927 | 21.5036 | 0 | 0 | 0 | 0 |
| PyTorch / 1024 | 01 | 4.42e-6 | 0.0421936 | 0.00382907 | 0.0061226 | 14.8252 | 0 | 0 | 0 | 0 |
| PyTorch / 1024 | 02 | 4.18e-6 | 0.00220142 | 9.17e-5 | 0.000178807 | 0 | 0 | 0 | 0 | 0 |
| PyTorch / 1024 | 03 | 4.23e-6 | 0.0142345 | 0.000633516 | 0.00126551 | 0.0667 | 0 | 0 | 0 | 0 |
| PyTorch / 1024 | 04 | 4.21e-6 | 0.228781 | 0.0197806 | 0.0166005 | 67.5228 | 0.1374 | 0 | 0 | 0 |
| ONNX / 1024 | 00 | 4.45e-6 | 0.0625113 | 0.00533299 | 0.00824927 | 21.5036 | 0 | 0 | 0 | 0 |
| ONNX / 1024 | 01 | 4.41e-6 | 0.0421936 | 0.00382906 | 0.0061226 | 14.8250 | 0 | 0 | 0 | 0 |
| ONNX / 1024 | 02 | 4.19e-6 | 0.00220136 | 9.17e-5 | 0.000178806 | 0 | 0 | 0 | 0 | 0 |
| ONNX / 1024 | 03 | 4.21e-6 | 0.0142344 | 0.000633513 | 0.00126550 | 0.0667 | 0 | 0 | 0 | 0 |
| ONNX / 1024 | 04 | 4.20e-6 | 0.228781 | 0.0197805 | 0.0166004 | 67.5228 | 0.1374 | 0 | 0 | 0 |

### Leitura visual e desempenho

- No tamanho publicado 640, o primeiro close-up produz uma silhueta visível, porém com vazamento do fundo/contorno difuso. O segundo close-up já é fraco; nos quadros 02 e 03, de ação, a máscara é praticamente nula. O quadro 04 mantém scores baixos e não forma uma camada opaca estável.
- Em 1024, PyTorch e ONNX produzem máscaras praticamente vazias nos cinco quadros. Isso reproduz e explica a medição anterior do ONNX.
- Média de inferência PyTorch: **0,748 s/quadro em 640** e **1,878 s/quadro em 1024**, com carregamento de pesos de 0,644 s e 0,439 s, respectivamente. ONNX em 1024: 1,50–1,72 s/quadro nesta comparação. Tempos são inferência, sem decodificação ou escrita.
- Não há anotação de referência, então não foram calculados IoU/precisão. Os dados não permitem avaliar tracking, estabilidade temporal ou cortes de câmera.

Comparativos completos salvos fora do Git em `C:\Users\Bruno\Videos\AMV-SAM2-Quality\resultados\skytnt_isnetis_pytorch_validation`:

- `comparison_pytorch_640.png`: original, máscara PyTorch 640 e composições em preto, branco e magenta.
- `comparison_pytorch_vs_onnx_1024.png`: original e máscara/composições PyTorch e ONNX para os mesmos cinco quadros.
- PNGs individuais `pytorch_640_*`, `pytorch_1024_*` e `onnx_1024_*`; métricas completas em `comparison_metrics.json` e `raw\pytorch_raw_metrics.json`.
- As pastas `official_640` e `official_1024` contêm as saídas geradas pelo `inference.py` original.

## Separação entre imagem e vídeo

O modelo publicado é um segmentador de **imagem**. Cada chamada recebe um quadro; não há memória temporal, associação de identidade, propagação de máscara ou tratamento de oclusão entre quadros no artefato ONNX testado. Uma sequência de chamadas independentes poderia oscilar mesmo que cada quadro isolado fosse correto.

**Teste dos 72 quadros não executado** porque nem no tamanho oficial 640 há uma máscara de personagem utilizável e consistente nos cinco quadros. Assim, não há resultado de consistência temporal, oscilação, perda de alvo nem tempo medido para a sequência. O tempo por quadro observado não deve ser interpretado como tracking.

## ISNet, ISNet_IS e U2Net disponíveis

O repositório SkyTNT declara suporte a `isnet`, `isnet_is`, `u2net` e outros nomes. No código, `get_net("isnet")` e `get_net("isnet_is")` instanciam a mesma arquitetura `ISNetDIS`; `isnet_is` adiciona um codificador de supervisão intermediária durante treino. Logo, a diferença principal é o regime/checkpoint de treino, não uma segunda arquitetura de inferência.

Na revisão consultada do Hugging Face, os únicos pesos disponíveis são `isnetis.ckpt` (~204 MB), `isnetis.onnx` (~176 MB) e `model.safetensors` (~204 MB); o `config.json` declara `net_name: isnet_is`. Não há checkpoint SkyTNT `isnet` nem checkpoint U2Net nessa publicação. Reutilizar os mesmos pesos `isnet_is` com o nome `isnet` não seria uma comparação entre modelos treinados independentemente. Um U2Net genérico de outra fonte também não seria uma comparação justa com um modelo treinado especificamente para anime e não foi baixado.

Na Fase 2.3, só o ONNX foi testado. Na Fase 2.4, o checkpoint `isnetis.ckpt` oficial também foi executado pelo PyTorch original, em 640 e 1024. ISNet com pesos próprios e U2Net com pesos próprios continuam sem benchmark, não “empatados” ou aprovados.

## CUTIE Small — viabilidade, sem instalação

Não foi instalado nem executado.

- **Uso como segundo estágio:** viável na API em princípio. O exemplo de inferência oficial inicializa `InferenceCore.step(image, mask, objects=...)`; uma máscara do ISNet_IS poderia ser binarizada e passada como anotação inicial. Isso descarta a alpha suave e pressupõe uma máscara inicial correta. O teste SkyTNT falhou, então não há máscara útil para esse handoff nesta execução.
- **CPU:** o núcleo é PyTorch, portanto CPU é tecnicamente plausível; o exemplo oficial move explicitamente imagem/máscara para `.cuda()` e usa autocast CUDA. Para CPU seria preciso adaptar o caminho de execução e medir desempenho/memória. Não há benchmark oficial de CPU usado aqui.
- **Windows:** o README upstream declara teste em Ubuntu; não foi encontrada declaração de suporte ou validação Windows. Compatibilidade nativa permanece não comprovada.
- **Pesos Small:** o release oficial disponibiliza `cutie-small-mega.pth` (~115 MB) e variantes de treino. O tamanho do arquivo não comprova qualidade em anime.
- **Licença:** o código Cutie declara MIT. O release não traz uma licença separada explícita para os pesos; não presumir que a licença do código resolva o uso/distribuição dos checkpoints e dados. Exige revisão de licença antes de adoção.
- **Conclusão:** CUTIE não foi instalado. O teste PyTorch de 640/1024 não produziu máscaras confiáveis em todos os cinco quadros; portanto não existe máscara inicial adequada para validar esse handoff. Não avançar com tracking automático nesta fase.

Referências oficiais: [repositório e exemplo SkyTNT](https://github.com/SkyTNT/anime-segmentation), [model card e pesos SkyTNT](https://huggingface.co/skytnt/anime-seg), [código CUTIE](https://github.com/hkchengrex/Cutie), [avaliação CUTIE](https://github.com/hkchengrex/Cutie/blob/main/docs/EVALUATION.md), [release CUTIE Small](https://github.com/hkchengrex/Cutie/releases/tag/v1.0).

## Detecção de mudanças de cena

Foi feita uma sondagem exploratória do filtro `scene` do FFmpeg no trecho. Com threshold de seleção 0,2, os eventos registrados nos 3 segundos foram: +0,545 s (score 0,506), +2,214 s (0,356), +2,881 s (0,993), +2,923 s (0,484) e +2,964 s (0,249), relativos ao início em 857,5 s. Os picos maiores coincidem aproximadamente com mudanças visuais observadas, mas os múltiplos scores próximos mostram que iluminação/efeitos podem gerar candidatos adicionais. O filtro mede diferença de imagem, não semântica ou identidade.

Isso sustenta uma estratégia futura, não uma implementação validada: detectar e confirmar o corte, encerrar a propagação anterior, abrir um novo segmento e pedir nova seleção/máscara. Flash, explosão ou iluminação intensa podem gerar falsos cortes; o threshold precisa ser calibrado e cada reinicialização deve ser visível/revisável. Nenhuma lógica de detecção foi adicionada ao app.

## Licenças e dados

- O código SkyTNT declara Apache-2.0 e o model card `skytnt/anime-seg` declara `apache-2.0`. O repositório descreve dados de treino combinados de AniSeg e `character_bg_seg_data`; a licença e os direitos de todos os componentes do conjunto não foram auditados nesta fase.
- O código Cutie declara MIT. A licença específica dos pesos Small não está indicada separadamente na página do release consultada.
- Nenhum modelo SkyTNT foi adicionado ao projeto, instalador ou dependências do app. O ONNX usado para o teste fica na pasta local de runtime isolado, fora do Git.

## Recomendação após as Fases 2.3 e 2.4

1. Deixar o recorte automático de personagem em espera: o PyTorch original confirma que o checkpoint responde em alguns quadros a 640, mas falha nos quadros de ação e não fornece um recorte consistente neste material.
2. Considerar encerrada a investigação deste checkpoint nesta etapa; não iniciar nova pesquisa de modelos, conversão ou tracking sem solicitação explícita.
3. Não instalar CUTIE nem integrar a segmentação no editor. O teste de imagem não demonstrou uma máscara inicial confiável e não avaliou consistência temporal.
4. As imagens e métricas desta rodada são evidências apenas dos cinco quadros escolhidos; não generalizar o resultado para todo anime nem afirmar desempenho em vídeo.

## Limitações

- Apenas um checkpoint treinado para anime foi testado, em cinco quadros selecionados de um episódio.
- Sem ground truth, não há métricas quantitativas de contorno/precisão.
- Não houve execução nos 72 quadros nem benchmark temporal; deliberadamente omitido após falha do teste de imagem.
- ISNet com checkpoint próprio, U2Net, CUTIE e uma segunda implementação PyTorch do checkpoint SkyTNT não foram executados.
- Os resultados não predizem qualidade em outros animes, compressões, resoluções ou cenas.
