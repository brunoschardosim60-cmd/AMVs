# Validação local de mídia de referência do motor AMV

**Data:** 2026-11-09
**Escopo:** diagnóstico local do pipeline e da primeira versão da pontuação contextual. Não é aprovação visual da montagem.

## Arquivos recebidos

Os originais ficaram em `C:\Users\Bruno\Downloads` e não foram alterados, copiados para o repositório, enviados a serviços externos ou incluídos num commit.

| Arquivo | Dados observados |
|---|---|
| `05. The Highest vs. The Lowest (1).mkv` | 390,3 MiB; H.264, 1280×720, 24000/1001 fps; 1430,08 s. Dois streams AAC estéreo e um stream de legenda SubRip em inglês. |
| `videoplayback.m4a` | 3,45 MiB; AAC estéreo, 44,1 kHz; 223,399 s. |

O FFprobe reporta `language=jpn` nos dois streams de áudio do MKV, mas os títulos são `English` e `Japanese`. Essa inconsistência é do metadado recebido; selecionar idioma só pela tag `language` não é evidência suficiente. Conferir os streams no diálogo de importação permanece importante.

## Execução observada

Foi usado o FFmpeg/FFprobe local do projeto, o extrator `packages/analysis` e o score atual; somente CPU, sem modelo de visão, rede, escrita nos originais ou render de um AMV. A análise completa de áudio/vídeo do episódio levou **35,6 s** no ambiente desta execução.

### Música

- Duração detectada: 223,399 s.
- BPM reportado: 144,3; confiança interna do detector: 1,0. Esse número não é uma probabilidade calibrada e não foi confirmado por audição/tap tempo.
- 538 batidas detectadas; intensidade 60/100; loudness estimado −5 dBFS.
- Uma queda principal em 126,777 s.
- Seções detectadas: intro 0–0,95 s; refrão 0,95–120,17 s; pré-refrão 120,17–126,78 s; drop 126,78–159,89 s; ponte 159,89–166,50 s; versos 166,50–179,75 s; refrão 179,75–219,50 s; final 219,50–223,40 s.
- O refrão de quase 120 s mostra que os rótulos de estrutura ainda são grosseiros e precisam de validação. O plano narrativo não deve tratar o BPM/seção como interpretação musical certa.

### Episódio

- 508 planos detectados, 41 sequências heurísticas, das quais 9 foram classificadas como `luta`.
- 267 cues de legenda e 267 segmentos de fala derivados das legendas.
- Tags: 100 `ação`, 126 `impacto`, 50 `clarão`, 235 `fala`, 76 `grito`, 11 `calma`, 2 `escura`.
- Plano detectado mais longo: 41,667 s; isso é sinal de que corte por mudança visual nem sempre representa limites de cena úteis para montagem.
- A classificação é por diferença de quadro/luma, áudio e legendas. Não identifica personagens, direção do movimento, enquadramento, cor, nitidez nem contato real de golpes. A tag `impacto` não comprova que houve um golpe.

### Pontuação contextual

Uma janela de 30 s sugerida pelo código atual foi `[113,545; 143,545]` da faixa. O score separou encaixe musical, tags de ação, direção narrativa, continuidade, diversidade e correspondência opcional de letra. A seleção de candidatos no diagnóstico usou o mesmo cálculo puro, mas **não foi uma geração completa nem uma comparação justa com o gerador anterior**: não filtrou uma luta escolhida, não calculou continuidade sequencial durante uma montagem e não renderizou vídeo.

## Conclusão e pendências

1. A entrada local é compatível com o pipeline atual de análise sem modelo adicional e seus metadados/contagens foram lidos com sucesso.
2. O resultado confirma que o gerador tem muitos cortes e sinais locais disponíveis, mas o analisador não comprova semântica de personagem, evento de golpe ou qualidade de plano.
3. A seção musical excessivamente longa e o plano detectado de 41,667 s são exemplos concretos de limites que podem levar a decisões ruins; precisam de revisão antes de calibrar pesos.
4. Esta execução não prova melhoria visual da montagem. Não houve preview, exportação, revisão de frames por pessoa nem comparação baseline/nova.
5. Os cenários emocional e de cortes rápidos, três perfis editoriais, comparação segura de versões, crítico e regeneração localizada continuam pendentes.
