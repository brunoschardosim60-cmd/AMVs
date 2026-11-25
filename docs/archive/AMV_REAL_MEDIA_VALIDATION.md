# Plano de validação real do Auto AMV — Fase 0

**Estado:** protocolo preparado; execução dos renders reais pendente.
**Data de preparação:** 2026-11-14.

Este documento transforma a Fase 0 do `ROADMAP-MELHORIAS-AMV.md` em um procedimento repetível. Ele não declara que o gerador foi aprovado: ainda são necessários renders completos e revisão humana no Windows com mídia que o usuário tenha direito de utilizar.

## 1. O que já existe no repositório

A Fase 0 não começa do zero. Há testes automatizados relevantes:

- `packages/automv/test/generate.test.ts`: geração determinística, preenchimento da timeline, prevenção de buracos, cenas repetidas, uso de episódios, estilos, letras, falas, drop e efeitos.
- `packages/automv/test/quality.test.ts`: avaliador audiovisual, lacuna visual, reutilização de cena, sincronização declarada, densidade de cortes e correção de sobreposição de legendas.
- `packages/render`: testes com FFmpeg para renderização, efeitos, áudio, validação de saída e avisos técnicos.
- `docs/AMV_ENGINE_REFERENCE_VALIDATION.md`: análise de referência real feita em 2026-11-09. Ela documenta análise de uma música e de um episódio, mas **não** contém uma geração completa, exportação ou aprovação visual de AMV.

Esses testes cobrem regras e regressões de código. Não comprovam que o vídeo final ficou bom, que a análise entendeu a cena ou que preview e export estão visualmente idênticos no Windows.

## 2. Matriz mínima de renders

Executar três projetos completos. Usar mídia autorizada e manter os arquivos originais fora do repositório.

| ID | Perfil / estilo | Material necessário | O que queremos descobrir |
|---|---|---|---|
| R1 — Hype | Hype ou Impacto rápido | Episódio com várias cenas de ação, golpes/impactos visíveis e música com drop claro | Cortes no ritmo, escolha de impacto, repetição e continuidade da ação |
| R2 — Cinema | Cinema ou perfil Cinemático | Episódio com planos longos, mudanças de ambiente, cenas calmas e ação moderada | Ritmo excessivamente lento/rápido, transições inadequadas e coerência visual |
| R3 — Emocional/Discurso | Emocional ou Discurso | Episódio com diálogos/falas reconhecíveis, pausas e cenas de reação; legenda ou transcrição disponível | Sincronia da fala, equilíbrio música/voz, legibilidade e continuidade emocional |

### Regras para uma comparação justa

- Fixar e registrar os mesmos arquivos de entrada, opções, início da música, duração, resolução, FPS, idioma, seed e versão do app.
- Para comparar duas versões do gerador, duplicar o projeto e alterar somente a versão do código. Não trocar a música nem os episódios entre A e B.
- Não editar manualmente uma versão sem registrar cada ajuste. A revisão deve avaliar primeiro o resultado automático.
- Se não houver material adequado para um cenário, marcar como **não executado**; não substituir por fixture sintética e chamar isso de validação real.
- Não enviar episódios, músicas, frames ou áudio a serviços externos durante esta validação. Usar análise local ou dados que já estejam disponíveis localmente.

## 3. Preparação e execução

No Windows, com o repositório atualizado:

```bash
pnpm install
pnpm ffmpeg
pnpm fixtures
pnpm typecheck
pnpm test
```

Depois:

1. Abrir o app instalado e anotar a versão exibida.
2. Criar ou duplicar um projeto de teste para R1, R2 e R3.
3. Importar episódio(s) e música; esperar todas as análises terminarem.
4. Conferir manualmente o idioma/stream de áudio selecionado. Metadados de idioma podem estar incorretos.
5. Gerar o AMV com as opções registradas na ficha abaixo.
6. Salvar o projeto antes de qualquer ajuste manual.
7. Exportar o vídeo completo usando o preset de qualidade escolhido e registrar o caminho local do arquivo.
8. Abrir o arquivo exportado em um player externo e assistir do começo ao fim, com áudio.
9. Registrar cada problema com timestamp, gravidade e evidência. Não basta escrever "ficou estranho".
10. Se necessário, voltar à timeline, corrigir e exportar uma segunda versão; manter os dois resultados para comparação.

**Importante:** `pnpm test` e `pnpm typecheck` são verificações automatizadas. Não substituem os passos 8 e 9.

## 4. Ficha de execução — copiar para cada render

### Identificação

- ID do cenário: R1 / R2 / R3
- Data:
- Commit SHA:
- Versão do app:
- Sistema operacional:
- CPU / GPU / RAM:
- Arquivo do episódio (apelido local):
- Arquivo da música (apelido local):
- Duração dos originais:
- Perfil / estilo:
- Seed:
- Início da música:
- Duração-alvo:
- Resolução / FPS:
- Codec / preset de exportação:
- Tempo de análise:
- Tempo de geração:
- Tempo de render:
- Tamanho final do arquivo:

Não incluir arquivos de mídia, chaves, tokens ou caminhos pessoais no commit. Use apelidos como `episodio-r1.mkv` e `musica-r1.flac` no relatório compartilhado.

### Verificação técnica do arquivo exportado

Marcar **Passou**, **Falhou** ou **Não verificado**:

- [ ] Arquivo abre no player externo.
- [ ] Duração final corresponde ao projeto.
- [ ] Resolução e FPS correspondem à configuração.
- [ ] Vídeo decodifica até o último quadro.
- [ ] Áudio existe e toca até o final.
- [ ] Não há tela preta inesperada.
- [ ] Não há congelamento ou quadro corrompido inesperado.
- [ ] Não há gap visual inesperado entre clipes.
- [ ] Não há clipping audível ou distorção evidente.
- [ ] Loudness e true peak do render foram registrados, quando disponíveis.
- [ ] Preview e export foram comparados em pontos equivalentes no Windows/WebView2.

Avisos automáticos de quadro escuro devem ser revisados: uma cena escura, fade ou flash intencional não é automaticamente um defeito.

### Revisão visual e editorial

Assistir ao vídeo inteiro. Além disso, registrar pelo menos estes pontos:

- [ ] Abertura (primeiros 5–10 segundos).
- [ ] Primeiro trecho de maior energia.
- [ ] Drop/clímax principal.
- [ ] Um trecho de menor energia ou pausa.
- [ ] Encerramento e último quadro.

Para cada dimensão, dar nota de 1 a 5 e anotar o timestamp que justifica a nota:

| Dimensão | Nota (1–5) | Timestamp / observação |
|---|---:|---|
| Escolha das cenas |  |  |
| Continuidade visual |  |  |
| Continuidade de personagem |  |  |
| Cortes no beat/ação |  |  |
| Uso do drop/clímax |  |  |
| Variedade (sem repetição incômoda) |  |  |
| Transições e efeitos |  |  |
| Legibilidade das letras/legendas |  |  |
| Equilíbrio música/voz |  |  |
| Resultado geral |  |  |

A nota é avaliação humana subjetiva, não uma métrica científica. Não somar tudo para criar uma "nota de IA".

### Registro de defeitos

| Timestamp | Gravidade | Categoria | O que aconteceu | Como reproduzir / evidência |
|---|---|---|---|---|
| 00:00.000 | Crítica / Alta / Média / Baixa | Preto / Gap / Repetição / Sincronia / Texto / Áudio / Outro |  |  |

Gravidade sugerida:
- **Crítica:** arquivo não abre, vídeo/áudio ausente, export incompleto ou projeto corrompido.
- **Alta:** tela preta/gap não intencional, fala essencial ausente, áudio distorcido ou texto impossível de ler.
- **Média:** corte fora da ação, repetição perceptível, transição ruim ou desequilíbrio moderado de áudio.
- **Baixa:** ajuste estético pontual sem comprometer a compreensão.

## 5. Métricas que devem ser registradas

Usar o relatório do avaliador e da exportação quando estiverem disponíveis. Não estimar números manualmente.

- Quantidade de avisos de lacuna visual.
- Quantidade de avisos de reutilização da mesma cena.
- Quantidade de avisos de sincronização declarada fora da janela.
- Quantidade de avisos de densidade excessiva de cortes.
- Quantidade de quadros/trechos pretos suspeitos no arquivo exportado, com timestamps revisados.
- Loudness integrado e true peak medidos no arquivo final, se o relatório fornecer.
- Número de defeitos humanos por gravidade.

Essas métricas não são equivalentes a qualidade artística. Um render com poucos avisos ainda pode ter escolhas de cena ruins; um aviso de cena escura pode ser falso positivo.

## 6. Critérios de aprovação da Fase 0

A Fase 0 só pode ser marcada como concluída quando:

- [ ] R1, R2 e R3 foram exportados integralmente com mídia real autorizada.
- [ ] Os três vídeos foram assistidos do início ao fim, com áudio.
- [ ] As fichas de execução foram preenchidas.
- [ ] Todo defeito crítico/alto foi corrigido ou convertido em bug reproduzível com evidência e decisão explícita de bloqueio.
- [ ] As métricas automáticas foram registradas sem tratá-las como julgamento artístico.
- [ ] Preview/export foram comparados no Windows para os recursos usados nos cenários.
- [ ] Baseline e limitações foram atualizados no roadmap/status.

Não aprovar a fase se algum dos três cenários estiver apenas "gerado" mas não revisado.

## 7. Estado inicial conhecido

A análise de referência documentada em `docs/AMV_ENGINE_REFERENCE_VALIDATION.md` identificou pontos que merecem atenção na revisão:

- Uma seção musical classificada como refrão durou quase 120 segundos; os rótulos de estrutura podem ser grosseiros.
- O maior plano detectado no episódio foi de 41,667 segundos; detecção de corte não garante que o limite seja uma cena útil.
- A tag `impacto` não comprova que um golpe ocorreu.
- A análise não identificou identidade de personagem, direção de movimento, enquadramento, nitidez ou contato real de golpes.
- A execução de referência não gerou nem exportou um AMV.

Esses pontos devem ser tratados como riscos a verificar, não como falhas confirmadas em todos os projetos.

## 8. Resultado consolidado

| Cenário | Render completo | Revisão humana | Defeitos críticos/altos abertos | Estado |
|---|---|---|---:|---|
| R1 — Hype | Pendente | Pendente | — | Não executado |
| R2 — Cinema | Pendente | Pendente | — | Não executado |
| R3 — Emocional/Discurso | Pendente | Pendente | — | Não executado |

**Conclusão atual:** protocolo e critérios definidos; Fase 0 ainda não aprovada. É necessário executar os três renders no ambiente Windows com mídia real autorizada.
