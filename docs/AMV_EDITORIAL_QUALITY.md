# Qualidade editorial do Auto AMV — pesquisa e decisões

## Objetivo

Aumentar a coerência entre letra, cena, personagem, voz, música e tipografia sem transformar a geração em uma sequência de efeitos. A implementação permanece local/determinística e mantém decisões visíveis e editáveis.

## Achados do código

1. **Chave de letra incompatível:** `generate.ts` identificava cada cue por centésimos + hash, mas `lyric-matcher.ts` usava milissegundos e outro separador. A correspondência interna não chegava ao score da cena.
2. **Falsos positivos:** `includes()` encontrava raízes dentro de palavras não relacionadas. Movimento alto era tratado como fogo, close-up como tristeza e tag de impacto como luz.
3. **Atribuição indevida de fala:** “fala do personagem” não era sustentado pelo dado; havia um segmento reconhecido dentro do plano, sem identidade do falante.
4. **Idioma da fala confundido com idioma da legenda:** `detectSpeech` cria segmentos a partir de legendas embutidas e carrega o idioma do texto. Comparar esse idioma diretamente com a faixa de áudio podia descartar o áudio japonês quando a legenda era portuguesa.
5. **Texto CJK sem quebra:** um texto japonês sem espaços podia virar um único token maior que a largura máxima.
6. **Legibilidade:** o helper contava UTF-16, permitia mais de duas linhas e usava limite de 48 caracteres por linha.

## Mudanças desta etapa

- Centralizada `lyricCueKey` em módulo usado pelo gerador e matcher.
- Comparação de temas por tokens Unicode, respeitando fronteiras e stems.
- Determinação/tristeza exigem rótulo/expressão visual confiável; fogo exige descrição visual explícita; impacto não substitui brilho; close-up não prova tristeza.
- Falas exigem confiança e sobreposição temporal; justificativa não atribui identidade não observada.
- Idioma do texto de legenda controla somente sua exibição; nunca deve impedir o uso da faixa de áudio escolhida. Teste de regressão: áudio japonês + legenda portuguesa preserva a voz e oculta apenas a legenda incompatível.
- Texto sem espaços é quebrado em grafemas e preserva índice do timing original.
- Karaoke palavra a palavra exige ASS/LRC/manual ou Whisper com confiança ≥0,90 e sem sinal de incerteza; timings estimados/incertos ficam como frase inteira.
- Typewriter conta pontos de código Unicode.
- Avisos de legenda verificam até duas linhas e 45 caracteres por linha.

## O que não resolve

- Não é tracking persistente de identidade; labels continuam dependentes da análise visual opcional.
- Correspondência lexical não entende metáfora, ironia ou contexto completo; é sinal auxiliar, não verdade semântica.
- Legenda transcrita pode estar traduzida; idioma textual não identifica automaticamente o idioma falado nem a faixa de áudio. A seleção de voz e a exibição do texto agora são decisões independentes.
- Mapa de andamento variável ainda não foi validado em músicas reais. Nenhuma nova dependência foi adicionada nesta etapa.
- Métrica automática não substitui três renders reais: ação/hype, cinematográfico e emocional/discurso.

## Critérios de validação

- [ ] matcher e planejador usam a mesma chave e a correspondência chega ao score/cuts log.
- [ ] falsos positivos por substring/sinal visual genérico são rejeitados.
- [ ] karaoke não promove timings estimados/incertos a palavra/sílaba exata.
- [ ] fala não é atribuída a personagem sem identidade.
- [ ] legenda traduzida não suprime o áudio original; apenas o texto incompatível é ocultado.
- [ ] texto CJK/unbroken não ultrapassa a largura.
- [ ] preview e render usam a mesma função de texto.
- [ ] Typecheck e testes de automv, subtitles e desktop passam.
- [ ] Revisão com mídia real valida tipografia, timing, continuidade, voz e qualidade artística.

## Pesquisa externa

- Ma et al., **Automated Conversion of Music Videos into Lyric Videos**, ACM UIST 2023. Estuda alinhamento de letras, legibilidade e foco visual unificado; a pipeline e o user study apoiam tratar a tipografia como parte do enquadramento, não um overlay indiferente. https://doi.org/10.1145/3586183.3606757
- Wang et al., **HIVE**, EMNLP Industry 2025. Combina personagem, diálogo, narrativa e segmentação de cena; separa highlights, abertura/fechamento e poda de trechos irrelevantes. O paper trata drama/anúncios, não valida por si só anime AMVs. https://aclanthology.org/2025.emnlp-industry.185/
- Haraguchi et al., **Fonts That Fit the Music**, IEEE Access, 2022. Analisa relação entre mood musical, aparência do tipo, movimento das palavras e sincronização com ritmo/voz; decoração excessiva pode prejudicar leitura. https://doi.org/10.1109/ACCESS.2022.3184028
- **Section 508 — Captions and Transcripts**. Recomenda consistência visual, fonte sem serifa, até duas linhas e até 45 caracteres por linha, além de evitar animação distrativa. https://www.section508.gov/create/captions-transcripts/
- **librosa — Beat tracking with time-varying tempo**. BPM global pode não acompanhar mudanças radicais de andamento; a documentação demonstra estimativas variáveis no tempo. Não adicionamos librosa ao runtime TypeScript nesta etapa. https://librosa.org/doc/latest/auto_tutorials/03-advanced/plot_dynamic_beat.html
- **FFmpeg Filters Documentation**. Referência para blackdetect, freezedetect e loudnorm já usados em outras áreas do projeto. https://ffmpeg.org/ffmpeg-filters.html
