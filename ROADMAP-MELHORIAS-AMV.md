# Roadmap de melhorias — AMV Studio

> Objetivo: elevar a qualidade dos AMVs gerados sem duplicar recursos que já existem, priorizando confiabilidade, continuidade visual e edição musical. Este documento é um plano de trabalho, não uma afirmação de que os itens pendentes já foram implementados.

## Princípios

1. **Não regredir o editor:** preservar projetos existentes, schema, timeline e fluxo de exportação.
2. **Evidência antes de automação:** toda decisão automática deve usar dados disponíveis, expor incerteza e permitir correção manual.
3. **Preview e export coerentes:** mudanças visuais precisam ser conferidas no WebView2 e no arquivo renderizado.
4. **Mídia real autorizada:** fixtures sintéticas cobrem lógica e regressões; qualidade artística só pode ser aprovada com amostras reais autorizadas e revisão humana.
5. **Sem promessas falsas:** heurísticas não devem ser descritas como compreensão de história, identidade ou emoção.

## Estado atual que orienta o plano

- O app já possui editor multipista, geração automática em estilos editáveis, análise de música/episódio, biblioteca de personagens, tipografia cinética, color grading, mixer com medição EBU R128/true peak no arquivo renderizado e avaliação técnica de exportação.
- O gerador já tem planejamento global, pontuação de cenas e sinais de direção narrativa. Esses sinais ainda são heurísticos e não equivalem a entendimento semântico do episódio.
- A biblioteca de personagens guarda nomes/aliases confirmados e referências de cenas, mas a identidade visual contínua ainda não é confiável. Descritores locais não são embeddings de identidade.
- A tipografia pode realçar palavras quando a origem fornece timestamps adequados (por exemplo, ASS karaoke ou LRC enhanced). Não se deve inventar precisão por palavra para arquivos sem esses tempos.
- O color grading automático já suaviza saltos de luminância; temperatura e matiz dependem de análise local e ainda precisam de validação visual em material real.
- A mixagem já mede loudness e true peak no WAV/export renderizado. Ainda falta calibrar o volume das falas entre episódios e validar o equilíbrio auditivamente em diferentes fontes.
- A avaliação do vídeo exportado cobre integridade técnica e trechos pretos, mas não julga de forma confiável a qualidade narrativa/artística.
- A comparação A/B existente não substitui uma avaliação automatizada e reproduzível de dois renders completos.

---

**Incremento técnico 14/11/2026:** o analisador musical foi atualizado para m5; a grade de batidas agora pode ser completada antes da primeira batida detectada em faixas com silêncio inicial. Teste sintético adicionado. Pesquisa e critérios de adoção: [AMV_ALGORITHM_RESEARCH.md](docs/AMV_ALGORITHM_RESEARCH.md).

## Fase 0 — Baseline e validação real

**Prioridade: máxima | Bloqueia a aprovação das fases seguintes**

**Plano operacional:** [docs/AMV_REAL_MEDIA_VALIDATION.md](docs/AMV_REAL_MEDIA_VALIDATION.md). Em 14/11/2026, o protocolo e a ficha de execução foram preparados; os três renders reais ainda estão pendentes. Esta fase permanece aberta.

### Entregas
- Criar um conjunto de 2–3 projetos de teste com mídia real autorizada, músicas diferentes e estilos distintos (por exemplo: Hype/luta, Cinemático e Emocional).
- Registrar para cada execução: versão do app, arquivos de entrada, duração, FPS, resolução, perfil, configurações, avisos, tempo de análise e tempo de render.
- Revisar o vídeo exportado do início ao fim: quadros pretos inesperados, repetição de cenas, cortes fora de ação/beat, letras ilegíveis, clipping, falas baixas/altas e diferenças entre preview e export.
- Guardar uma baseline para comparar futuras mudanças; não usar somente a pontuação automática como prova de melhoria.
- Corrigir o roteiro de validação e documentar bugs reproduzíveis com timestamp e passos.

### Critérios de aceite
- Pelo menos 3 renders completos revisados por uma pessoa.
- Nenhum defeito crítico conhecido sem registro e classificação.
- Cada problema reportado tem timestamp, evidência e passos para reproduzir.
- A suíte sintética continua passando; testes de mídia que dependem do FFmpeg são executados no ambiente suportado.

## Fase 1 — Continuidade de personagens e cenas

**Prioridade: alta**

### Entregas
- Evoluir a biblioteca de personagens para um fluxo de confirmação por cena: sugestão, confiança, confirmação/recusa e alias.
- Criar um mecanismo conservador de associação entre cenas próximas, usando referências confirmadas e características visuais disponíveis. Quando houver dúvida, marcar como "não confirmado" em vez de afirmar identidade.
- Adicionar revisão rápida de cenas suspeitas: personagem trocado, cena repetida, mudança brusca de aparência ou enquadramento.
- Separar claramente "semelhança visual" de "mesmo personagem"; não reutilizar descritores estruturais locais como prova de identidade.
- Medir qualidade e custo de qualquer abordagem de tracking antes de integrá-la ao fluxo padrão. O protótipo SAM 2.1 não deve ser tratado como recurso pronto: a validação anterior foi sintética e o recorte visual foi considerado pouco confiável.

### Critérios de aceite
- O usuário consegue confirmar/corrigir a identidade sugerida sem alterar a mídia original.
- A montagem não trata uma sugestão de baixa confiança como identidade certa.
- Testes cobrem cenas sem personagem, múltiplos personagens, mudança de roupa/plano e falsos positivos.
- Desempenho e memória são medidos em hardware de referência antes de ativar por padrão.

## Fase 2 — Montagem orientada à ação e ao impacto

**Prioridade: alta**

### Entregas
- Melhorar a escolha dos pontos de entrada/saída para que o corte acompanhe a ação (preparação, movimento, impacto e reação), não apenas o beat mais próximo.
- Usar os sinais disponíveis de movimento, intensidade, cortes e análise visual com confiança explícita.
- Criar uma regra de continuidade: evitar cortar no meio de uma ação quando houver alternativa equivalente; preferir mostrar impacto e reação quando existirem cenas adequadas.
- Reforçar a prevenção de repetição e de saltos grandes entre trechos de origem, sem preencher lacunas com cenas visualmente inadequadas.
- Oferecer motivos legíveis para cada escolha: "cortou no impacto", "alternativa com maior continuidade" ou "material insuficiente".

### Critérios de aceite
- Testes unitários para cortes antes/durante/depois do impacto, ausência de ação e falta de alternativas.
- Em um conjunto fixo de projetos, comparar baseline e nova versão com métricas como repetição, distância entre trechos de origem e proporção de cortes próximos a impactos detectados.
- Revisão humana confirma melhora sem aumentar quadros pretos, cortes abruptos ou repetição.
- O sistema informa quando os sinais são heurísticos ou insuficientes.

## Fase 3 — Mixagem consistente entre episódios

**Prioridade: média-alta**

### Entregas
- Medir loudness dos trechos de fala por episódio e normalizar o ganho de cada fala com limites seguros, em vez de aplicar um ganho fixo indistinto.
- Preservar a automação de ducking já existente e evitar que a normalização faça a música desaparecer ou amplifique ruído.
- Adicionar alertas para fala muito baixa, fala muito alta, clipping/true peak e diferenças excessivas entre blocos.
- Validar a mixagem com audição em fones e alto-falantes comuns; métricas não substituem escuta.

### Critérios de aceite
- Falas de episódios diferentes ficam em faixa consistente sem clipping.
- A música reduz durante as falas e retorna suavemente ao nível-base.
- Testes cobrem fala silenciosa, fala alta, ruído, ausência de fala e múltiplas falas próximas.
- Relatório registra loudness/true peak medidos no render final.

## Fase 4 — Letras e tipografia cinética

**Prioridade: média**

### Entregas
- Melhorar a experiência de importação e revisão de letras: indicar origem dos timestamps, confiança e linhas que precisam de correção.
- Oferecer presets de entrada/saída e destaque de palavras sem alterar tempos de origem confiáveis.
- Quando houver timestamps por palavra, permitir ênfase visual no drop e em palavras selecionadas; sem timestamps, manter animação por frase/segmento e informar a limitação.
- Adicionar posicionamento assistido para evitar áreas importantes do quadro, mantendo ajuste manual como autoridade final.
- Automatizar comparação visual entre preview e export em frames representativos no Windows/WebView2.

### Critérios de aceite
- Nenhuma palavra recebe timestamp inventado.
- Linhas longas, sobrepostas ou com baixa confiança são sinalizadas.
- Preview e export são visualmente equivalentes nos casos de teste suportados.
- Legibilidade é revisada em 16:9 e em diferentes resoluções.

## Fase 5 — Avaliação do render e comparação de versões

**Prioridade: média**

**Implementação incremental (2026-11-14):** o validador sinaliza quadros pretos inesperados e possíveis congelamentos ≥2,5 s com FFmpeg `freezedetect`. Os dois detectores compartilham uma única passagem de decodificação; os eventos são avisos revisáveis, não falhas automáticas. Intervalos pretos inesperados e congelamentos ficam disponíveis separadamente, e a exportação oferece **Revisar no editor** para saltar ao primeiro timestamp suspeito. Parser e integração com o filtro real têm testes adicionados. Relatório persistido e comparação A/B completa continuam pendentes; a revisão humana permanece obrigatória.

### Entregas
- Gerar relatório pós-render com integridade de streams, duração, FPS, resolução, áudio, trechos pretos suspeitos, congelamentos e possíveis gaps.
- Vincular cada aviso ao timestamp e oferecer salto direto para o trecho na timeline.
- Permitir comparar duas versões exportadas com os mesmos critérios e um resumo das alterações.
- Separar claramente métricas técnicas de avaliação artística; não produzir uma nota única que pareça objetiva quando não for.
- Manter a revisão humana como etapa necessária para coerência narrativa, emoção e qualidade estética.

### Critérios de aceite
- Relatório identifica problemas técnicos reproduzíveis em fixtures.
- Avisos de conteúdo escuro ou fades previstos não são apresentados como falha certa.
- Comparação A/B registra configurações e versões usadas.
- O usuário consegue abrir o ponto sinalizado no projeto.

## Fase 6 — Polimento, desempenho e distribuição

**Prioridade: após as fases anteriores**

### Entregas
- Medir análise, preview e render em projetos curtos e longos, incluindo hardware de referência como a Radeon RX 580.
- Verificar consumo de RAM/VRAM, tempo de geração de proxies e tamanho do instalador.
- Validar layout, DPI, fontes substituídas, acessibilidade básica e controles no Windows/WebView2.
- Documentar limitações conhecidas e atualizar o README/STATUS após cada entrega real.
- Remover ou simplificar caminhos experimentais que não atinjam critérios mínimos de qualidade/desempenho.

### Critérios de aceite
- Benchmarks repetíveis documentados.
- Nenhuma regressão crítica na suíte automatizada.
- Instalação limpa e abertura de projeto existente verificadas no Windows.
- Limitações e requisitos ficam visíveis ao usuário.

---

## Ordem recomendada de execução

1. Fase 0 — validar a qualidade atual com mídia real autorizada.
2. Fase 1 — continuidade de personagens, com abordagem conservadora.
3. Fase 2 — cortes orientados à ação/impacto.
4. Fase 3 — consistência de falas e mixagem.
5. Fase 4 — refinamento das letras e paridade preview/export.
6. Fase 5 — relatório pós-render e comparação de versões.
7. Fase 6 — desempenho, interface e distribuição.

## Regra para fechar uma fase

Uma fase só deve ser marcada como concluída quando:
- o código foi implementado;
- os testes relevantes passaram;
- a validação manual prevista foi feita;
- as limitações remanescentes foram documentadas;
- README/STATUS/LIMITATIONS foram atualizados quando necessário.

**Este roadmap não autoriza marcar funcionalidades como prontas apenas porque foram planejadas ou porque passaram em fixtures sintéticas.**
