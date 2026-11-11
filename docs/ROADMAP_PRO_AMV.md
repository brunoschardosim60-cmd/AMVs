# Roadmap: editor profissional de AMVs

## Auditoria do que já existe

| Área | Estado atual | Lacuna principal |
|---|---|---|
| Editor, timeline, commands/undo e render FFmpeg | Funcional e não destrutivo; clipes de texto são dados normais do projeto. | A validação ponta a ponta no WebView2 e a paridade visual em mídia real continuam pendentes. |
| Tipografia | `textLayer.ts` é compartilhado pelo preview e pela rasterização da exportação; há tamanho, cor, contorno, sombra e animações de entrada/saída. | Sem layout/fundo configuráveis, realce por palavra, estilos de palavra ou revisão temporal individual. |
| Legendas e letras | SRT/ASS/VTT/LRC podem virar clipes editáveis; alinhamento local de TXT usa timestamps de palavras do Whisper como sugestão. | O parser ASS remove tags de karaokê; os tempos de palavra são descartados ao criar legendas; não há revisão por palavra. |
| Diálogo | faster-whisper já solicita timestamps de palavra e segmento. | O fluxo para a timeline conserva só o segmento e a interface não distingue tempo de frase de tempo por palavra. |
| Música e montagem | BPM, batidas, seções, energia, drops, cenas e geração automática já existem; recomendações locais consideram intensidade. | Andamento variável e correlação semântica dependem de validação real; a detecção de golpe é heurística. |
| Efeitos | Zoom, tremida, flash, cor, blur, separação RGB, vinheta e transições já existem; um preset de glitch combina efeitos editáveis. | LUTs, motion blur e rampas de velocidade ainda não existem. |
| Isolamento de personagem | Há um protótipo Python de SAM2 com saída de máscaras/PNG RGBA e job local; não está ligado à UI, projeto ou render, e foi reprovado como recortador confiável. | Mantido como opção de desenvolvimento; não deve ser empacotado nem tratado como recurso disponível. |

## Fases e dependências

| Fase | Escopo | Dependências | Critérios de aceitação |
|---|---|---|---|
| 1. Tipografia cinética e revisão de palavras (esta entrega) | Presets independentes para letra, diálogo e impacto; fundos, layout e controles editáveis; ingestão de tempos ASS/LRC/Whisper; revisão manual por palavra. | Migração compatível do projeto e renderizador compartilhado existente. | Projeto v1 migra sem perda; tempos ASS/LRC/Whisper mantêm origem e incerteza; revisão altera um comando undoável; preview e exportação usam o mesmo renderer; build e testes passam. A comparação visual no WebView2 continua pendente. |
| 2. Narrativa musical dirigida | Primeira fatia entregue: plano determinístico por seção musical, com abertura/crescimento/clímax/respiro/encerramento, influenciando a pontuação das cenas e suas justificativas. | Análises atuais; ainda não há inferência semântica de cenas nesta etapa. | Testes de faixa parcial, seção/drop, offset e seleção. Resta validar com mídia real e evoluir eventos de fala/letra, batida variável e controles de aprovação. |
| 3. Biblioteca de efeitos e transições | Motion blur, rampas de velocidade/zoom, glitch, aberração cromática, light leaks, grading/LUT e transições selecionáveis; importação de elementos/áudio do usuário. | Specs compartilhadas de efeito e testes de paridade do preview/export. | Cada efeito publicado tem implementação em ambos os lados ou é identificado como só exportação; teste de render com FFmpeg real; intensidade/frequência configuráveis e undo. |
| 4. Spike de isolamento temporal de personagem | SAM 2.1 Hiera Tiny selecionado para teste CPU no Windows; há inferência sintética e API protótipo. | Medir memória/latência e qualidade real; validar FFmpeg e build do instalador. | O smoke test sintético não fecha o gate. Só avançar após medição reproduzível, qualidade revisada e instalador validado. |
| 5. Recorte, correção e composição | Job temporal de máscara alfa em cache, edição manual de máscara, camadas/fundo, contorno/glow/sombra e movimento; manter originais intactos. | Fase 4 aprovada; integração ao render plan e ciclo de vida de jobs. | Máscaras propagadas em sequência de quadros, editáveis/recalculáveis; cancelar não deixa cache parcial; teste de export alfa/compósito e undo; qualidade revisada em sequência real autorizada. |
| 6. Mixer e aceitação profissional | Paridade preview/export para seleção de faixa, ganho por clipe/trilha, mute/solo, fades, ducking e SFX; revisão final de desempenho/UX. | Base existente de áudio e testes no Windows/WebView2. | Matriz de cenários A/V automatizada; teste manual em WebView2 com áudio e vídeo reais autorizados; sem clipping nas medições de saída e sem arquivos originais modificados. |

## Prioridade atual: timeline profissional

A timeline já oferece faixas por tipo, sobreposição de vídeo em faixas distintas, seleção por Ctrl/Shift-clique, movimentação e aparo por gesto, snapping, comandos em grupo e undo/redo. A lacuna trabalhada agora é selecionar vários clipes em uma área, sem depender de clicar em cada um:

- Arrastar em uma área vazia da faixa cria uma caixa de seleção que cruza os clipes dentro do intervalo de tempo e das faixas abrangidas.
- Shift/Ctrl durante o arrasto adiciona os clipes encontrados à seleção atual; clique simples continua posicionando o playhead e limpa a seleção.
- Depois da seleção, as operações de grupo existentes (mover, copiar, excluir, duplicar) continuam usando o mesmo histórico de comandos.
- A lógica de interseção do retângulo é pura e coberta por testes; gestos cancelados restauram a seleção anterior.

Próximas lacunas do mesmo eixo, a tratar incrementalmente: seleção por faixa/tipo, navegação e edição numérica em quadros, arraste automático nas bordas, grupos e persistência de layout. Não fazem parte desta alteração.

## Incremento: composição, animação, efeitos e distribuição

- **Composição:** a timeline pode criar trilhas independentes de vídeo e áudio e texto; os controles de ordenação movem trilhas da mesma categoria sem deslocar seus clipes. A ordem das trilhas visuais é a ordem Z da composição e usa `track.move`, portanto undo/redo restaura a pilha.
- **Keyframes:** posição X/Y aceita pontos no tempo local do clipe, interpolação linear, hold, ease-in, ease-out e ease-in-out. Preview, texto rasterizado e FFmpeg usam a mesma curva; marcadores aparecem nos clipes da timeline. Escala, rotação e opacidade ainda são estáticas.
- **Efeitos:** o preset Glitch de impacto adiciona separação RGB, tremida e clarão como instâncias comuns editáveis; não introduz uma implementação de efeito exclusiva ou sem paridade.
- **Distribuição:** o sidecar de produção deixa de incluir SAM 2, PyTorch, TorchVision, ONNX Runtime e checkpoint SAM2. O código e o extra opcional de desenvolvimento permanecem. O tamanho novo do bundle precisa ser medido em build Windows antes de quantificar a economia.

### Fase 1: escopo implementado nesta execução

- `Lyrics Cinematic`, `Dialogue Dramatic` e `Impact Typography` são presets de configuração, não efeitos automáticos obrigatórios.
- A camada de texto conserva palavra, intervalo relativo ao clipe, origem (`ASS`, `LRC`, `Whisper` ou edição manual), confiança quando disponível e overrides visuais.
- O renderer único desenha palavra ativa, fundo (nenhum, faixa, caixa translúcida ou quadro preto), alinhamento, margem/largura e espaçamento; preview e exportação chamam o mesmo código.
- O inspetor permite selecionar/escutar uma palavra, ajustar seu intervalo e editar seu realce. Segmentos sem tempos por palavra permanecem como frase; não se inventam tempos distribuindo a duração.
- Projetos antigos migram para defaults que preservam o visual atual.

### Primeira fatia: direção narrativa da montagem automática

- O gerador deriva papéis narrativos apenas das seções, energia e drops que já existem na análise musical; não adiciona um modelo visual nem afirma compreender personagens ou a história do episódio.
- A direção influencia a pontuação de cenas: por exemplo, cenas calmas ganham preferência na abertura/respiro, e cenas de ação/impacto no clímax. Essa pontuação continua sendo uma heurística determinística, não uma garantia de adequação.
- A razão de cada clipe e o resumo da geração mostram o papel e a seção que orientaram a escolha. Sem seções, o plano usa desenvolvimento genérico e explicita a limitação.
- Cenas escuras não são descartadas apenas por terem a tag de baixa luminosidade; o brilho sozinho não é evidência de baixa relevância narrativa.
- Cobertura automatizada inclui cortes de seção, drop, faixa parcial, deslocamento de batida, fase aplicada à seleção/justificativa e análise sem seções. A qualidade em anime real continua pendente de revisão humana.

### Etapa inicial: pontuação contextual e continuidade

- A pontuação do gerador foi separada em sinais musicais, ação, emoção, direção narrativa, transição, diversidade por episódio e correspondência opcional de letra. `scoring.ts` retorna a decomposição e evidências legíveis; o motivo do clipe selecionado guarda os sinais usados.
- Os pesos iniciais preservam as regras existentes: encaixe musical `1 − 1,6 × diferença de intensidade`; bônus de contexto/tags e continuidade foram extraídos do seletor anterior, em vez de recalibrados por impressão. O resultado é ordenação heurística, não nota de qualidade.
- Continuidade mantém as regras existentes de avanço dentro do episódio/luta e passa a acrescentar personagem em comum e relações preparação→combate / combate→reação somente quando ambas as etiquetas visuais têm confiança suficiente.
- Emoção e ação visual granular sem confiança mínima (0,55) não alteram a escolha; rótulos antigos `fight` sem campo de confiança são aceitos para compatibilidade, e a justificativa não os apresenta como confiáveis.
- Não existe dimensão de nitidez, enquadramento, direção de câmera ou paleta na análise local atual; a pontuação não finge medir qualidade técnica ou essas relações. Isso requer evolução separada do analisador e evidência validada.
- O campo `Clip.confidence` deixa de receber o score de ordenação: score de ranking não é probabilidade nem confiança artística.
- Esta etapa não implementa os perfis de três versões, geração em lote, eventização de preparação/impacto, crítico automático ou regeneração localizada. Permanecem etapas posteriores; não há controles falsos na interface.
- O episódio e a música fornecidos foram analisados localmente pelo pipeline atual. Metadados e resultados reproduzíveis estão em [AMV_ENGINE_REFERENCE_VALIDATION.md](./AMV_ENGINE_REFERENCE_VALIDATION.md); a inspeção confirma sinais disponíveis, mas não equivale a uma comparação visual de montagens.

### Incremento: visão local por cena e biblioteca de personagens

- O botão de análise local extrai 1–3 quadros RGB reduzidos por plano, escolhidos conforme duração; cada plano é persistido individualmente no cache do hash do asset e não é reextraído quando já tem a versão local atual.
- Os descritores registram luminância espacial, bordas por região, histogramas RGB, brilho, saturação, entropia, centro de massa visual, movimento entre quadros e deslocamento global estimado. Uma classificação heurística rotula ação, diálogo, contemplação, tensão, reação ou ambiente com confiança explícita.
- Similaridade combina estrutura espacial, bordas, movimento e cor; apenas cor/intensidade não basta. Cenas visualmente repetitivas adjacentes recebem penalidade no ranking. As relações persistidas ficam limitadas às 300 cenas de maior intensidade analisadas por asset.
- O modelo de visão pode complementar com nomes, enquadramento, rostos e expressões; o parser valida confiança e mantém a evidência local. A biblioteca canônica (nome, aliases, confiança e cenas-fonte) é armazenada no projeto v3 e seus aliases são usados pelo filtro do Auto AMV.
- Limite deliberado: os descritores locais não identificam personagens, não detectam expressões/rostos e não compreendem a narrativa; rótulos de cena são heurísticas. Não havia FFmpeg no PATH para executar o teste de decodificação nesta máquina nem mídia real autorizada disponível nesta etapa, então a aceitação visual com anime e consistência de personagem continua pendente.

### Incremento: planejamento global e direção editorial

- A seleção agora compara caminhos completos com busca beam determinística e limitada (largura 32, até 16 ramificações por estado), considerando score musical/narrativo, continuidade e repetição.
- Organização temporal oferece Cronológico, Narrativo e Livre. O modo Cronológico não retrocede; Narrativo avança dentro de cada episódio e limita saltos quando há slots suficientes; Livre admite saltos não lineares e os penaliza quando não há sinal visual/musical que os justifique.
- Cinema, Balanceado e Hype alteram os parâmetros do estilo (duração mínima, batidas por corte, transição, prioridade de ação/emoção e intensidade de efeitos). Não são três montagens independentes nem adicionam efeitos.
- Testes cobrem busca de caminho, regras temporais, esgotamento/repetição, match de letra e diferenças paramétricas das direções. Ainda falta revisão audiovisual humana em mídia autorizada; análise atual não identifica de forma confiável a identidade ou a história dos personagens.

## Auditoria funcional resumida

| Capacidade | Situação observada no código | Próxima lacuna relevante |
|---|---|---|
| Timeline multipista e undo/redo | Edição não destrutiva por comandos, seleção e operações em grupo, trilhas com ordenação; testes do pacote de projeto e UI. | Refinar precisão em quadros, automação de borda e validar gestos no WebView2. |
| Composição e keyframes | Composição de trilhas e animação de posição X/Y com easing chegam ao preview e ao FFmpeg; texto usa o renderer compartilhado. | Keyframes para escala/rotação/opacidade e avaliação visual automatizada do preview no Windows. |
| Efeitos | Efeitos existentes e preset de glitch reutilizam specs/instâncias do editor. | Motion blur, LUTs e speed ramp não estão implementados. |
| Áudio e sincronia | BPM, batidas, seções, energia, drops, diálogo, ducking e SFX já integram a montagem; offset constante pode ser ajustado. | Validar músicas reais e andamento variável; seleção da faixa de áudio no preview ainda difere da exportação. |
| Direção musical | Mapa local m4 de energia/eventos com suporte heurístico; perfis por estilo modulam densidade, crescimento, pausas, preparação do drop e encerramento. UI mostra o trecho e mantém ajuste manual. | Validar em músicas reais autorizadas, andamento variável, métrica diferente de 4/4 e escuta humana; não identifica instrumentos nem separa vocal. |
| Isolamento de personagens | SAM2 permanece protótipo reprovado como recortador confiável e não é empacotado no runtime de produção. | Não retomar integração como recurso principal sem nova evidência de qualidade; interface e timeline não oferecem recorte. |

## Spike de recorte temporal: SAM 2.1 selecionado para teste, não para produção

O usuário escolheu SAM 2.1 Hiera Tiny, teste em CPU e runtime/pesos no instalador principal. O código e o checkpoint consultados são Apache-2.0. O upstream recomenda WSL para Windows e documenta extensão CUDA opcional. Neste host Windows, o sidecar PyInstaller processou via FFmpeg um clipe sintético de três quadros 256×256 a 1 fps em 13,95 s após iniciar o serviço, acompanhando o objeto em movimento. O bundle descompactado mede 745,9 MiB e o working set amostrado foi ~1.079 MiB; cancelamento real também foi validado. Isso não valida qualidade em anime nem desempenho a 24/30 fps; o instalador Tauri ainda não foi construído.

Para fechar o gate, medir:

1. Windows 10/11 nativo e GPU sem CUDA (CPU/DirectML, se tecnicamente suportado), além de GPU NVIDIA quando disponível;
2. tempo por quadro/trecho, pico de RAM e VRAM, inicialização, tamanho do runtime e checkpoint;
3. estabilidade de identidade/contorno em cortes, oclusão, motion blur e cenas de anime;
4. edição por pontos positivos/negativos e propagação após corrigir um quadro;
5. cancelamento, cache por hash + versão do modelo/configuração e retomada sem corromper resultados;
6. licença de código, pesos e demais dependências, com obrigações de redistribuição.

SAM2 continua como protótipo opcional no código-fonte, mas não será instalado ou empacotado pelo runtime de distribuição. A validação visual reprovou a qualidade como recortador confiável. Não declarar o recurso disponível nem enviar quadros para nuvem. O histórico detalhado está em [ROADMAP_CHARACTER_CUTOUT.md](./ROADMAP_CHARACTER_CUTOUT.md).

## Fora do escopo desta entrega

Nenhuma UI de isolamento, correção manual, camada de timeline, composição de preview ou exportação está implementada nesta fase. O backend é protótipo e a lista acima é plano, não promessa de funcionalidade disponível.

## Referências técnicas

- SAM 2, repositório e guia oficial: https://github.com/facebookresearch/sam2
- Licença de código SAM 2: https://github.com/facebookresearch/sam2/blob/main/LICENSE

## Ajuste incremental: ganho positivo no preview

- **Problema:** o inspetor aceitava ganho de até +12 dB, mas o player dependia de `HTMLMediaElement.volume`, que não representa ganho acima da unidade.
- **Desenvolvimento:** preservar o cálculo existente de clipe/trilha/fades/keyframes e aplicá-lo por `GainNode`; uma compressão de pico no master reduz clipping audível. Falhas ao preparar ou iniciar o áudio são notificadas.
- **Arquivos:** `apps/desktop/src/features/editor/player.ts`, `Preview.tsx`, `Inspector.tsx` e `apps/desktop/test/player-audio.test.ts`; estado e limitação registrados em `docs/STATUS.md` e `docs/LIMITATIONS.md`.
- **Integração:** áudio segue vindo dos proxies e trilhas sem alterar o projeto, a exportação ou os comandos de edição. Proxies AAC por faixa alternativa permitem que o preview respeite o `streamIndex` selecionado; sincronização final precisa de validação manual no WebView2.
- **Validação:** testes focados de ganho/fades/mute-solo/keyframes, typecheck e build desktop; a verificação manual no WebView2 permanece pendente.
