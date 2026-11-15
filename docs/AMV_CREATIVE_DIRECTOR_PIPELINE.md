# Pipeline de Direção Criativa do AMV

> Arquitetura e estado da primeira implementação funcional da Direção Criativa no Auto AMV.

## Estado implementado nesta PR

A primeira fatia funcional está conectada ao fluxo normal de **Gerar e revisar**:

- Gera um brief explícito por estilo, com objetivo, prioridades, limites e preferências escolhidas pelo usuário.
- Antes da montagem, completa os descritores visuais locais pendentes para todas as cenas elegíveis dos episódios selecionados. É processamento local, retomável pelo cache e cancelável; não envia quadros a provedores externos.
- Recria as entradas do gerador com os descritores acabados, para que os sinais locais recentes possam participar da seleção de cenas.
- Cria um storyboard pós-montagem por seção musical, com intenção, origem, tempo e motivo de cada plano. Ação, emoção e personagens só aparecem quando há rótulo semântico acima do limiar de confiança.
- Executa uma segunda avaliação audiovisual usando o relatório objetivo existente, mostra cobertura checked/partial/unavailable e compara critérios do estilo com evidências reais.
- Aplica uma correção automática deliberadamente restrita: encurta somente legendas geradas com sobreposição comprovada, e só mantém a alteração se o peso de problemas objetivos diminuir.

Ainda não estão implementados: rotulagem semântica automática sem configuração/consentimento do usuário; compreensão plena de causa e consequência narrativa; múltiplas estratégias A/B criadas e comparadas automaticamente; reparos narrativos/visuais locais; análise de pixels do preview e do arquivo exportado. A revisão atual não deve ser interpretada como aprovação artística automática.


## 1. Problema observado

O fluxo atual já possui componentes úteis: análise técnica de mídia, mapa musical, metadados visuais opcionais, pontuação de cenas, planejamento de sequência e relatório audiovisual. Porém, eles não formam um ciclo completo de direção e revisão.

Hoje:

- A análise padrão do episódio lê legendas, extrai sinais de voz e mede cortes/estatísticas de quadros em baixa resolução. Isso não significa compreender semanticamente cada cena.
- A visão semântica por modelo é opcional e pode cobrir apenas parte das cenas. A visão local fornece descritores, mas não substitui entendimento de personagens, ações e contexto.
- Os estilos são principalmente conjuntos de parâmetros e pesos. Eles influenciam a escolha, mas não produzem por si só um objetivo editorial explícito.
- `generateAmv` planeja slots, pontua candidatos e escolhe uma sequência de forma determinística. Não existe uma etapa de inferência narrativa completa durante o clique.
- O relatório audiovisual verifica problemas que os dados permitem medir, mas não julga plenamente a coerência dramática nem compara alternativas.
- O progresso visual atual não mede a duração real de cada etapa; pausas curtas entre mensagens de status não são análise.

Portanto, o resultado rápido não é sinal de que uma direção completa aconteceu. O sistema está executando um planejador com informações pré-computadas.

## 2. Resultado desejado

O botão **Gerar AMV** deve iniciar um fluxo com sete entregáveis internos:

1. **Dossiê de evidências:** o que sabemos sobre a música, cada episódio e cada cena, com cobertura e confiança.
2. **Brief criativo:** qual é o objetivo emocional/editorial desta montagem e quais regras definem sucesso.
3. **Storyboard temporal:** o papel que cada trecho do vídeo deve cumprir, com cenas candidatas e justificativas.
4. **Montagens candidatas:** mais de uma solução editorial viável, não apenas variações aleatórias de seed.
5. **Revisão independente:** avaliação de cada montagem contra o brief e contra defeitos técnicos verificáveis.
6. **Revisão corretiva:** substituições locais e limitadas para resolver problemas reais, sem destruir trechos bons.
7. **Entrega explicável:** montagem escolhida, resumo do objetivo, pontos fortes, ressalvas e trechos que merecem conferência humana.

Tempo de processamento não é uma métrica de qualidade. O produto deve mostrar progresso real e permitir cancelamento.

## 3. Pipeline alvo

### Etapa A — Pré-voo e suficiência dos dados

Antes de planejar, construir um manifesto de evidências por asset e por cena:

- análise técnica do episódio concluída;
- análise musical concluída, incluindo confiança da grade de batidas;
- cenas/planos detectados e duração útil;
- legendas e falas disponíveis, com idioma e confiança;
- análise visual local disponível;
- rótulos semânticos disponíveis: personagens, ação, emoção, enquadramento, tipo de cena e confiança;
- falhas de extração, cenas não analisadas e conteúdo sem evidência.

A interface deve distinguir **analisado**, **parcial**, **indisponível** e **falhou**. Ausência de evidência nunca deve ser tratada como evidência negativa.

Modos de profundidade futuros:

- **Rápido:** usa análises existentes e declara as limitações.
- **Completo:** garante cobertura técnica e visual local de todas as cenas elegíveis.
- **Diretor:** acrescenta análise semântica de visão nas cenas relevantes, com cobertura claramente informada.

A análise por provedor externo exige configuração e autorização explícita. Não enviar quadros silenciosamente ao provedor. Se a cobertura necessária não existir, explicar o impacto e oferecer análise, modo rápido ou cancelamento.

### Etapa B — Brief criativo por montagem

Criar um objeto de domínio versionado, por exemplo `CreativeBrief`, derivado da mídia, do estilo e das escolhas do usuário.

O brief deve conter:

- **Objetivo principal:** o que o espectador deve sentir ou entender.
- **Arco emocional:** abertura, preparação, crescimento, clímax, respiro e encerramento, quando fizerem sentido.
- **Promessa visual:** quais tipos de cena, personagens, ações e enquadramentos devem dominar.
- **Curva de ritmo:** densidade de cortes e duração desejada dos planos por seção musical.
- **Estratégia musical:** papel de versos, pausas, ataques, transições e drop; guardar confiança e tolerância.
- **Regras de continuidade:** cronologia, ação, personagem, direção de movimento e contexto.
- **Restrições:** cenas proibidas, repetições máximas, falas obrigatórias, idioma, duração e proporção.
- **Critérios de sucesso:** condições observáveis que a revisão vai testar.

O estilo não deve ser só um nome ou preset numérico. Cada estilo deve declarar objetivo, arco, prioridades, antiobjetivos, regras de montagem e critérios de revisão. Perfis personalizados podem ajustar preferências sem apagar o núcleo editorial do estilo.

Exemplos de intenção:

- **Combate épico:** estabelecer confronto, preparar ação, escalar a troca, entregar impactos e preservar reações/resultado; não encadear golpes sem contexto só porque há batida.
- **Ascensão épica:** mostrar estado inicial, obstáculo, preparação, virada, conquista e consequência; não tratar qualquer cena intensa como vitória.
- **Cinema emocional:** criar relação e progressão por expressão, contexto, pausa e payoff; não apenas alongar cortes e aplicar dissolve.
- **Dark Speech:** fazer a fala conduzir a ideia, estabelecer contexto visual, escalar a mensagem e usar silêncio/impacto com intenção.
- **Lyrics sincronizada:** alinhar conteúdo do verso ao significado visual quando houver evidência; sincronismo temporal sozinho não prova correspondência semântica.

### Etapa C — Análise orientada ao objetivo

A análise deve responder às perguntas que o brief exige, não apenas classificar tudo genericamente.

Para cada cena elegível, guardar evidências estruturadas:

- identidade de personagem, incluindo aliases e confiança;
- ação e fase da ação (preparação, execução, reação, consequência);
- emoção/expressão e confiança;
- tipo de cena e enquadramento;
- movimento de câmera e movimento do sujeito, quando mensuráveis;
- relação com cenas anteriores/posteriores;
- diálogo/legenda e contexto;
- semelhança com outras cenas para detectar duplicatas.

O sistema deve diferenciar fato observado, inferência do modelo e hipótese editorial. Não inventar relações quando os dados não permitem concluir.

A seleção de cenas deve respeitar cobertura e confiança mínimas configuráveis. Quando faltar evidência, registrar incerteza e evitar usar esse sinal como critério decisivo.

### Etapa D — Storyboard antes da timeline

Criar um `StoryboardPlan` entre o brief e os comandos de edição.

Cada slot temporal deve registrar:

- intervalo da música e seção musical;
- papel narrativo/emocional do slot;
- função visual esperada;
- requisitos de personagem/ação/contexto;
- cena escolhida e evidências que justificam a escolha;
- alternativas ordenadas;
- motivo do corte, transição e eventual efeito;
- restrições de continuidade e sincronização.

O storyboard deve ser inspecionável antes de ser aplicado. Um slot não pode ser considerado bem resolvido apenas porque encontrou uma cena com score alto.

### Etapa E — Busca de alternativas

Gerar um conjunto pequeno de candidatos com estratégias editoriais realmente distintas, por exemplo:

- versão mais narrativa/cronológica;
- versão mais musical/rítmica;
- versão mais focada em personagem/emoção.

As alternativas devem compartilhar o mesmo brief e as mesmas restrições. Não variar apenas a seed. O mecanismo atual de busca de sequência pode ser reaproveitado, mas precisa expor diversidade de estratégia e preservar justificativas.

### Etapa F — Revisão independente

Avaliar cada candidato sem alterar seus próprios critérios para favorecer o resultado gerado.

Dimensões mínimas:

| Dimensão | O que verificar |
|---|---|
| Fidelidade ao brief | O arco e o objetivo do estilo aparecem na ordem pretendida? |
| Coerência narrativa | A sequência é compreensível? Há preparação, ação, reação e consequência quando necessárias? |
| Continuidade visual | Personagens, contexto, direção de movimento e enquadramento fazem sentido entre cortes? |
| Ritmo musical | Os cortes respeitam a estrutura da música, a confiança do BPM e as tolerâncias? |
| Variedade | Há repetição excessiva de plano, personagem, enquadramento ou ação? |
| Legibilidade | Falas, letras, efeitos e transições permitem compreender a imagem? |
| Integridade técnica | Há lacunas, sobreposições, clipes inválidos, áudio inesperado ou problemas de duração? |

Cada achado deve guardar severidade, timestamp, evidência, confiança e recomendação. Dimensões sem evidência suficiente devem aparecer como **não avaliadas**, não receber uma nota artificial.

Não apresentar scores como probabilidade ou verdade artística. A pontuação deve ser explicável e acompanhada das evidências que a formaram.

### Etapa G — Correção limitada e nova revisão

A revisão deve produzir um `RevisionPlan` com os intervalos e problemas corrigíveis.

- Alterar apenas os slots afetados e os vizinhos necessários à continuidade.
- Escolher uma alternativa do storyboard; não embaralhar cenas aleatoriamente.
- Preservar os trechos que passaram na revisão.
- Reavaliar o candidato depois de cada rodada.
- Aceitar a correção apenas se reduzir problemas sem causar regressões relevantes no brief ou em outras dimensões.
- Limitar o número de rodadas e guardar a melhor versão encontrada.
- Se não houver alternativa segura, manter a versão anterior e apresentar o problema ao usuário.

### Etapa H — Validação de preview e exportação

Quando possível, inspecionar o preview e o arquivo renderizado, além dos dados da timeline. Medir problemas técnicos que só aparecem após decodificação/render, como congelamentos, quadros pretos, clipping, pico/loudness e dessincronização.

A validação do projeto não deve ser confundida com validação do vídeo final. O relatório deve identificar exatamente qual artefato foi verificado.

## 4. Modelo de domínio sugerido

Os nomes são conceituais e podem ser ajustados à arquitetura existente.

- `AnalysisManifest`: versão, assets, cobertura por cena, fontes, confiança, falhas e consentimento.
- `CreativeBrief`: objetivo, arco, curva de ritmo, prioridades, restrições e critérios de sucesso.
- `StoryboardPlan`: slots, cenas escolhidas, alternativas, evidências e justificativas.
- `GenerationCandidate`: estratégia, seed, comandos, storyboard aplicado e métricas.
- `QualityReport`: dimensões avaliadas, achados, evidências, severidade e itens não avaliados.
- `RevisionPlan`: problemas-alvo, substituições propostas, impacto previsto e resultado da nova revisão.
- `GenerationSession`: identificador, estado de cada etapa, progresso real, cancelamento e artefatos produzidos.

Os artefatos devem ser versionados e vinculados à identidade dos arquivos, versões dos analisadores, brief, parâmetros e versão do gerador. Isso permite reproduzir e comparar uma geração.

## 5. Interface desejada

O usuário não precisa acompanhar detalhes internos, mas deve conseguir entender o processo:

1. **Analisando materiais** — quais arquivos estão prontos e qual cobertura falta.
2. **Definindo a intenção** — mostrar em poucas linhas o objetivo editorial derivado do estilo e da música.
3. **Planejando a história** — mostrar a estrutura temporal do storyboard.
4. **Montando alternativas** — mostrar quantas versões foram criadas e o que muda entre elas.
5. **Revisando** — exibir problemas encontrados e quais correções estão sendo tentadas.
6. **Resultado** — apresentar a melhor versão, um resumo da revisão e os pontos que exigem conferência humana.

O progresso deve vir dos jobs reais. Remover delays artificiais e textos que declarem trabalhos que não estão sendo executados.

## 6. Ordem de implementação

### Fase 0 — Instrumentação e contratos
- Medir duração real por etapa e registrar cobertura.
- Tornar o progresso/cancelamento real.
- Criar tipos versionados e fixtures com episódios e músicas sintéticos.
- Garantir que ausência de evidência resulte em "não avaliado".

### Fase 1 — Brief criativo
- Definir objetivos e critérios de sucesso dos seis estilos.
- Derivar brief a partir de mídia, estilo e opções do usuário.
- Mostrar um resumo do brief antes de gerar.
- Testar cada estilo contra cenários em que deve e não deve funcionar.

### Fase 2 — Suficiência da análise
- Calcular cobertura semântica por cena.
- Criar o fluxo Completo/Diretor com autorização clara para visão externa.
- Reaproveitar cache e permitir retomar/cancelar.
- Impedir que modo Diretor alegue análise completa quando houver lacunas.

### Fase 3 — Storyboard explicável
- Gerar slots narrativos/musicais com requisitos e alternativas.
- Usar evidências e confiança na seleção.
- Expor justificativas no relatório de geração.

### Fase 4 — Candidatos e revisão
- Gerar estratégias distintas sob o mesmo brief.
- Executar revisão independente por dimensão.
- Comparar candidatos e escolher a melhor solução justificável.

### Fase 5 — Correção e validação final
- Corrigir apenas intervalos com problemas corrigíveis.
- Reavaliar após correção e impedir regressões.
- Integrar validação de preview/exportação e apresentar relatório final.

## 7. Critérios de aceite do novo Gerar

A funcionalidade só deve ser considerada direção criativa completa quando:

- Um estilo selecionado gera um brief com objetivo e critérios claros.
- A cobertura de evidências é exibida e nenhuma análise ausente é mascarada.
- O storyboard explica a função de cada parte relevante da montagem.
- São comparadas estratégias genuinamente diferentes.
- Uma revisão independente aponta evidências e timestamps.
- Problemas corrigíveis geram tentativas localizadas de melhoria.
- A versão final é reavaliada e comparada com a anterior.
- Os trechos sem evidência ou que exigem julgamento humano são declarados.
- Progresso, cancelamento, cache e tempos refletem trabalho real.

**Princípio central:** o AMV Studio não deve apenas perguntar “qual cena tem maior pontuação para este corte?”. Deve primeiro decidir “o que esta montagem precisa comunicar?”, depois construir uma sequência que cumpra essa intenção e, por fim, verificar se o resultado realmente a cumpre.
