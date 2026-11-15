# Pesquisa técnica — qualidade de AMVs

Atualizado em 14/11/2026. Esta pesquisa orienta a evolução do motor; não é uma afirmação de que os modelos opcionais já estão instalados.

## Decisões de integração

### 1. Grade musical com intros silenciosas — integrado (m5)

O analisador existente já calcula fluxo espectral por bandas, BPM por autocorrelação, batidas por programação dinâmica, downbeats, energia, seções e drops. Foi preservado esse núcleo determinístico, sem adicionar dependência pesada ou rede ao caminho padrão.

A melhoria m5 completa a grade para trás usando a mediana dos primeiros intervalos detectados quando a faixa começa com silêncio. Assim, o primeiro ataque continua no mesmo instante, mas a montagem pode ter uma grade coerente desde o começo para planejar introdução, títulos e primeiro corte. O período inferido é limitado a ±25% do período esperado pelo BPM para evitar propagar uma estimativa aberrante.

A versão do cache de análise foi incrementada de m4 para m5 para forçar a reanálise de mapas antigos. O teste cobre uma faixa sintética com dois segundos de silêncio inicial.

### 2. Uma única fonte temporal para imagem e áudio — manter como regra

A análise musical deve produzir um mapa de cues reutilizado por montagem, letras, efeitos reativos e avaliação de sincronismo. Não executar detectores independentes em cada módulo: isso cria pequenas divergências de tempo.

- Beats/downbeats são candidatos, não obrigação de corte.
- Mudanças de seção e frases musicais orientam mudanças maiores de linguagem visual.
- Onsets fortes podem receber impactos específicos.
- Deixar beats sem corte preserva contraste e evita edição mecânica.
- Eventos visuais devem atingir o frame do cue; antecipação pode começar antes dele.

### 3. Seleção de cenas — evoluir por evidências, não por efeitos

Manter pontuação explicável e determinística como base. Evoluções recomendadas:
- combinar energia musical, ação/movimento, enquadramento, continuidade e variedade;
- evitar repetição de composição e sequência sem quebrar continuidade coreográfica intencional;
- tratar rótulos semânticos como evidência com confiança, nunca como verdade;
- permitir revisão humana dos trechos escolhidos.

### 4. Render e qualidade técnica

O FFmpeg já oferece filtros úteis para validação de exportação:
- `blackdetect`: intervalos quase pretos;
- `freezedetect`: conteúdo sem mudança significativa durante um período;
- `loudnorm`: normalização EBU R128 com loudness integrado, LRA e true peak;
- `signalstats`/medições de vídeo: suporte a inspeção técnica adicional.

Detecção automática deve gerar alertas revisáveis. Um quadro escuro ou parado pode ser intencional; não corrigir ou cortar automaticamente sem contexto.

## Referências pesquisadas

- [Documentação oficial de filtros FFmpeg](https://ffmpeg.org/ffmpeg-filters.html) — blackdetect, freezedetect, loudnorm e ferramentas de análise.
- [Music and beat sync](https://github.com/OpenSenseNova/SenseNova-6.8-Code2Video/blob/main/skills/code-video/crafts/music-and-beat-sync.md) — cue map único, hierarquia de eventos musicais e sincronismo medido no arquivo final.
- [beat-synced-edit](https://github.com/ZiadAbdelkarim/beat-synced-edit) — pipeline de referência que combina análise musical, detecção de cenas e montagem FFmpeg.
- [AEON music video](https://github.com/AEON-7/aeon-music-video) — referência de automação visual reativa a RMS, onsets e bandas espectrais.
- [Material educacional Music Remix](https://daw.web.leuphana.de/wp-content/uploads/2024/03/MusicRemix-In-The-Classroom.pdf) — reforça a revisão iterativa entre ritmo, movimento, letra e narrativa.

## O que não será copiado cegamente

Não importar um pipeline inteiro ou um modelo de deep learning só porque existe no GitHub. O projeto tem arquitetura própria, editor multipista, cache versionado, execução local, render original e testes. Dependências de modelos precisam passar por avaliação de licença, tamanho, latência em CPU/Windows, memória, distribuição e qualidade em anime. Beat This, separação Demucs e embeddings de identidade permanecem candidatos a spikes isolados, não dependências obrigatórias.

## Próximas camadas técnicas

1. Mapa de andamento variável e detecção de mudanças de tempo/compasso; manter correção manual de BPM/fase.
2. Benchmark comparativo do beat tracker atual contra librosa/Beat This em um conjunto de músicas autorizadas.
3. Melhorar seleção por frases e eventos com avaliação A/B reproduzível.
4. Avaliar sincronismo final entre cue, corte, impacto visual, letra e áudio por timestamps/frames do render.
5. Medir qualidade de mixagem e true peak no arquivo exportado; revisar auditivamente com fala, música e SFX.
6. Validar o resultado em três AMVs reais autorizados antes de declarar qualidade artística aprovada.

## Critério de adoção

Uma técnica externa só entra no caminho padrão se demonstrar melhoria mensurável em testes, estabilidade em Windows, custo aceitável e compatibilidade de licença. Até lá, fica como experimento opcional e o caminho determinístico atual continua disponível.

## Implementação incremental de 15/11/2026 — frase musical e look-ahead narrativo

A documentação atual do librosa descreve uma limitação relevante do BPM único: ele funciona melhor com andamento aproximadamente constante; para variações acentuadas, a biblioteca permite fornecer estimativas de BPM variáveis por frame ao rastreador dinâmico. A estimativa local pode ser irregular e aproximada. Por isso, esta atualização não introduz uma dependência nova nem finge resolver tempo variável: usa os tempos reais de batida já presentes na análise e acrescenta fronteiras de frase a partir dos downbeats.

Na montagem:
- fronteiras de frase detectadas pelos downbeats passam a poder abrir um corte mesmo quando o agrupamento de batidas passaria por cima delas;
- o início da frase vira uma evidência editorial para a transição e pode liberar um número pequeno de cenas da sequência seguinte;
- a busca narrativa compara uma janela limitada de planos futuros, com preferência contextual por ação ou preparação/reação, em vez de obrigar sempre o primeiro plano disponível.

A validação automatizada cobre as fronteiras de frase e a janela limitada de candidatos. O rastreamento de andamento variável continua listado como pesquisa/experimento futuro e exige benchmark de áudio real antes de entrar no runtime.
