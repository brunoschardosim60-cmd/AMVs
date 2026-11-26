# Protocolo de Validação com Mídia Real — AMV Studio

> **Regra de evidência:** resultados com mídia real **não** podem ser inferidos por testes sintéticos. Todos os campos permanecem marcados como **`PENDENTE`** até que uma pessoa execute cada bateria no Windows (WebView2) com arquivos próprios/licenciados e preencha as medições. Mídia real nunca entra no Git.

---

## 1. Cenários obrigatórios (3 execuções independentes)

| ID | Cenário | Estilo / Direção | Requisitos da música | Requisitos do vídeo | Status |
|---|---|---|---|---|---|
| **C1** | **Hype / Luta** | `hype` · Direção `hype` | 135–175 BPM fixo, drop percussivo claro, letra sincronizada | Episódio 20–25 min (`.mkv` HEVC 10-bit ou `.mp4` H.264), sequência intensa de combate + gritos | `PENDENTE` |
| **C2** | **Cinemático** | `superacao` ou `historia` · Direção `cinematic` | 90–125 BPM, introdução atmosférica + crescimento orquestral | Episódio com planos abertos (`wide`), preparação dramática e diálogo nítido | `PENDENTE` |
| **C3** | **Emocional (BPM variável)** | `emocional` · Direção `balanced` | Música acústica/orquestral com **andamento variável** (`rubato` ou mudança real de BPM entre verso e clímax) | Episódio focado em expressões faciais (`close-up`), respiros longos e falas calmas | `PENDENTE` |

---

## 2. Ficha de execução (copiar 1 ficha para C1, C2 e C3)

### Ficha — Cenário: `[C1 / C2 / C3]` — Status: `PENDENTE`

- **Versão instalada do app:** `PENDENTE` (ex.: `0.9.5`)
- **Sistema / GPU / RAM:** `PENDENTE`
- **Música de entrada:**
  - Nome local (sem caminho pessoal): `PENDENTE`
  - Contêiner / codec / duração / taxa de amostragem: `PENDENTE`
  - BPM detectado pelo app × BPM esperado: `PENDENTE`
  - Indicador de BPM variável acionado? `PENDENTE`
- **Episódio(s) de entrada:**
  - Nome local (sem caminho pessoal): `PENDENTE`
  - Contêiner / codec / bit depth / resolução / FPS (`CFR` ou `VFR`): `PENDENTE`
  - Duração total: `PENDENTE`
- **Configurações usadas na geração:**
  - Modo (`Modo Livre` ou manual) / Estilo / Direção / Intensidade: `PENDENTE`
  - Duração alvo (s) / Trecho musical inicial–final: `PENDENTE`
  - Falas (`off` / `breaks` / `voiceover`) / Efeitos sonoros (`off` / `hits-only` / `subtle` / `intense`): `PENDENTE`
  - Tipografia da letra / Recorte em `V2` no drop: `PENDENTE`
- **Tempos medidos no relógio:**
  - Importação + geração de proxy: `PENDENTE`
  - Análise musical + análise de cenas/falas: `PENDENTE`
  - Alinhamento/transcrição Whisper (se aplicável): `PENDENTE`
  - Geração da montagem na timeline: `PENDENTE`
  - Exportação final (1080p H.264): `PENDENTE`
- **Avisos exibidos pelo app (copiar literalmente):**
  - `PENDENTE`

---

## 3. Checklist de revisão do Preview e do Render completo (com timestamps)

Preencha `OK` (zero ocorrências) ou liste cada ocorrência como `MM:SS.mmm — descrição`.

| Item verificado | Preview (WebView2) | Arquivo exportado (player externo) | Timestamps / Observações |
|---|---|---|---|
| **Fluidez na entrada de textos e textos seguidos** (sem travar, sem voltar o vídeo, sem exibir `"Carregando quadro…"`) | `PENDENTE` | N/A | `PENDENTE` |
| **Quadro preto inesperado** (lacunas visuais fora de `fade_in`/`fade_out`) | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| **Cena repetida ou clone visual** (mesmo plano reutilizado de forma perceptível) | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| **Corte fora da batida** (atraso ou avanço perceptível em relação ao bumbo/caixa/drop) | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| **Letra ilegível, cortada ou atrasada** (baixo contraste em cena clara, sobreposição com fala ou atraso vocal) | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| **Fala baixa demais, alta demais ou embolada com a música** (ducking / `voiceIsolation` / `echoTail`) | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| **Clipping ou distorção de áudio** (saturação acima de 0 dBFS em impactos + música + voz) | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| **Diferença visual Preview × Export** (posição/escala da tipografia, `blendMode` `difference`/`screen`, cor, enquadramento, recortes `V2`) | `PENDENTE` | `PENDENTE` | `PENDENTE` |

---

## 4. Comparação: nota do "Diretor Mestre" (0–100) × Avaliação Humana (1–5)

### 4.1. Como pontuar antes de revelar a nota automática
1. Assista ao vídeo exportado **sem olhar** o detalhamento da nota automática (ou anote as notas humanas antes de abrir a Central de Qualidade).
2. Atribua uma nota inteira de **1 a 5** para cada uma das 5 dimensões equivalentes às dimensões internas de `scoreAssemblyQuality`:
   - `1` = ruim / defeito grave evidente
   - `2` = fraco / múltiplos problemas perceptíveis
   - `3` = aceitável / funcional, mas comum
   - `4` = bom / acabamento consistente
   - `5` = excelente / nível profissional

### 4.2. Conversão para escala comparável (0–100)

Cada subnota automática é normalizada para `0–100` dividindo pelo seu teto em `scoreAssemblyQuality`, e cada nota humana `h ∈ [1..5]` é convertida por `H_100 = (h - 1) * 25`:

| Dimensão | Teto automático | Nota automática bruta | Automática (`0–100`) | Nota humana (`1–5`) | Humana (`0–100`) | Diferença `\|A - H\|` |
|---|---|---|---|---|---|---|
| **1. Rigor técnico** (`technical`) | 28 | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| **2. Sincronia rítmica** (`sync`) | 24 | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| **3. Diversidade visual** (`diversity`) | 20 | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| **4. Progressão narrativa** (`narrative`) | 16 | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| **5. Coesão multimodal** (`multimodal`) | 12 | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |
| **Nota global** (`total` vs média ponderada humana) | 100 | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` | `PENDENTE` |

*(Média ponderada humana na mesma proporção dos pesos: `0,28·H1 + 0,24·H2 + 0,20·H3 + 0,16·H4 + 0,12·H5`.)*

### 4.3. Critério objetivo de correlação

A nota do "Diretor Mestre" só pode ser declarada **correlacionada** com a avaliação humana quando **todos** os critérios abaixo forem cumpridos nos 3 cenários (`C1`, `C2`, `C3`):

1. **Monotonicidade entre candidatos:** em pelo menos 1 cenário, exportar também o candidato de menor nota do torneio (`allScores`) e confirmar que o avaliador humano prefere o vencedor (`winner`) ao último colocado.
2. **Erro absoluto na nota global:** `|total_auto - total_humano| <= 15` pontos (em 100) em cada um dos 3 cenários.
3. **Sem falso positivo grave:** nenhuma dimensão avaliada por humano com nota `1` ou `2` (`<= 25/100`) pode receber `>= 75%` do teto automático daquela dimensão.
4. **Ordenação dimensional:** correlação de postos de Spearman `ρ >= 0,60` nos 15 pares `(dimensão × cenário)` medidos.

**Resultado consolidado da validação real:** `PENDENTE`
