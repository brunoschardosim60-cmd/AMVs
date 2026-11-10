# Arquitetura atual

Este documento descreve o código existente do AMV Studio; não é uma promessa de funcionalidades futuras. O estado testado e os limites de cada parte estão em [STATUS.md](./STATUS.md) e [LIMITATIONS.md](./LIMITATIONS.md).

## Camadas e dependências

```text
apps/desktop (React + Tauri)
  ├─ features/   telas e interação
  ├─ core/       sessões, bibliotecas locais, exportação e orquestração
  └─ platform/   adaptadores Tauri e interfaces substituíveis em testes
       ├─ @amv/project
       ├─ @amv/media
       ├─ @amv/analysis
       ├─ @amv/automv
       ├─ @amv/render
       ├─ @amv/assistant, @amv/music, @amv/subtitles
       └─ @amv/sfx, @amv/sound-design

services/analyzer   sidecar Python opcional para transcrição e análise
```

Os pacotes de `packages/` mantêm a lógica principal fora de React e Tauri. A interface do sistema (`Platform`) permite testar operações de arquivos, processos, diálogos e serviços sem acoplar o domínio à implementação do desktop.

## Projeto, edição e persistência

- `packages/project` define o schema Zod versionado do `.amvproj`, migrações, validação, comandos puros e undo/redo. Assets apontam para arquivos originais; clipes, trilhas, efeitos, keyframes, marcadores, anotações e versões são dados do projeto.
- Cada edição passa por comandos serializáveis; grupos de comandos são atômicos. `apps/desktop/src/core/session.ts` coordena abrir, salvar, autosave, recuperação, snapshots, relink e jobs de mídia da sessão.
- Preferências gerais e bibliotecas locais ficam na pasta de dados do aplicativo. Arquivos de trabalho derivados (proxies, thumbnails, áudio extraído e análises) ficam no cache e podem ser refeitos. As referências de análise no projeto apontam para esses resultados; os arquivos de cache não são o conteúdo canônico da timeline.
- Perfis criativos reutilizáveis ficam em `perfis-criativos.json` na pasta de dados do aplicativo; os modelos padrão são fornecidos pelo código e os perfis do usuário são validados antes de persistir.

## Mídia e análise

- `packages/media` encapsula FFprobe/FFmpeg, geração de proxy, thumbnails, waveform, inspeção e fila/cancelamento de jobs.
- `packages/analysis` calcula cortes e sinais de áudio/episódio, extrai descritores visuais locais, estima movimento aparente e interpreta resultados opcionais de visão. Evidências externas de visão são opcionais; processamento local e sinais de confiança permanecem distintos.
- Análises pesadas são reutilizadas pelo hash do asset e versões do analisador. O hash atual é parcial (tamanho e regiões do arquivo), não uma identidade criptográfica integral do conteúdo.
- O sidecar `services/analyzer` é opcional. Transcrição local usa modelos baixados sob demanda; provedores de visão/LLM só são usados quando configurados e autorizados.

### Fluxo real de análise e geração

1. `ProjectSession.importFiles` inspeciona os arquivos e inicia `process` em segundo plano. Após FFprobe e os artefatos necessários, `analyze` procura `analysis-{versão}.json` no cache por hash. Cache encontrado é carregado; cache ausente executa e persiste a análise. A geração não inicia essa análise sob demanda.
2. `analyzeMusicFile` decodifica o áudio para PCM mono e calcula mapa musical heurístico (batidas, downbeats, energia, seções/eventos). `analyzeEpisodeFile` lê legendas textuais quando disponíveis, extrai sinais de voz do áudio e roda `frameStats` sobre o vídeo completo em baixa resolução para cortes e estatísticas; não é uma análise semântica de cada cena.
3. Rótulos semânticos de personagens/ação por visão não são necessários nem executados automaticamente ao clicar Gerar. Análise visual local e rotulagem por modelo são opções separadas no diálogo, incrementais e retomáveis via cache.
4. `GenerateDialog` passa à `generateAmv` as análises já presentes em `assetRuntime`. `generateAmv` planeja slots, pontua candidatos, escolhe a sequência e cria comandos síncronos; não decodifica mídia nem faz inferência. Por isso, o clique pode terminar em menos de um segundo quando os passos pesados terminaram antes ou foram cacheados.
5. Antes deste gate, episódios selecionados ainda sem resultado eram omitidos de `inputs` enquanto outro episódio pronto permitia gerar. Agora a geração (incluindo regeneração localizada) aguarda a análise de todos os arquivos selecionados; falhas são exibidas e podem ser tentadas novamente, ou o usuário pode desmarcar explicitamente os arquivos.

Esta auditoria não encontrou medição por etapa, relatório persistido por geração, modos de profundidade distintos, gate de suficiência semântica/continuidade nem comparação de qualidade entre planos. Logo, “análise completa” aqui significa apenas os analisadores locais atuais e as informações opcionais realmente presentes, não compreensão narrativa integral nem garantia artística.

## Montagem automática

`packages/automv` transforma análises e opções do usuário em comandos comuns do projeto:

1. Define intervalo musical e slots usando batidas, seções, energia e eventos analisados.
2. Cria candidatos a partir das cenas elegíveis, aplicando filtros explícitos e dados disponíveis.
3. Usa `scoring.ts` para pontuar evidências musicais, visuais, narrativas, de continuidade e diversidade.
4. `sequence-planner.ts` escolhe uma sequência completa com regras de cronologia e busca limitada.
5. Gera comandos editáveis, justificativas e avisos; regeneração localizada aplica os comandos somente após comparação e aprovação.

Os scores são valores de ranking, não probabilidades nem notas de qualidade. Emoção, personagem e enquadramento só influenciam quando os metadados correspondentes existem e satisfazem os limiares de confiança. Os perfis criativos ajustam intenção e pesos desses sinais; não criam rótulos que a análise não produziu.

O relatório audiovisual é outra função do mesmo pacote: aponta problemas verificáveis pela timeline e declara cobertura parcial ou indisponível quando falta evidência. Ele ainda não compara pixels do preview com um arquivo exportado.

## Preview, render e áudio

- `apps/desktop/src/features/editor` compõe a timeline no preview a partir dos proxies e dados do projeto.
- `packages/render` constrói o plano de render e os filtros de FFmpeg a partir do projeto. Exportação gera um temporário, valida metadados e decodificação e só então publica a saída.
- O projeto guarda especificações de efeitos e transições; o preview e o render usam implementações correspondentes. A existência de implementações paralelas não comprova paridade universal: verificações visuais no WebView2 e com mídia autorizada ainda são necessárias.
- A exportação e a pré-escuta renderizada usam a cadeia FFmpeg de mixagem. O monitoramento em tempo real no preview usa Web Audio e possui diferenças conhecidas documentadas em `LIMITATIONS.md`.

## Extensibilidade e limites atuais

Os pacotes puros e os adaptadores são pontos de extensão internos; atualmente não existe runtime de plugins de terceiros. Isso evita carregar código externo no processo do editor sem uma necessidade validada.

Ainda não há um modelo local de entendimento narrativo completo, uma memória adaptativa do usuário, um índice reconstruível unificado de todo o conhecimento por projeto, nem benchmark sistemático no hardware-alvo. O storyboard dedicado também não existe como etapa separada; o planejamento e a timeline atual são as fontes reais de montagem. Consulte [STATUS.md](./STATUS.md) e [LIMITATIONS.md](./LIMITATIONS.md) antes de tratar qualquer uma dessas áreas como concluída.
