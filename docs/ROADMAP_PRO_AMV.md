# Roadmap: editor profissional de AMVs

## Auditoria do que já existe

| Área | Estado atual | Lacuna principal |
|---|---|---|
| Editor, timeline, commands/undo e render FFmpeg | Funcional e não destrutivo; clipes de texto são dados normais do projeto. | A validação ponta a ponta no WebView2 e a paridade visual em mídia real continuam pendentes. |
| Tipografia | `textLayer.ts` é compartilhado pelo preview e pela rasterização da exportação; há tamanho, cor, contorno, sombra e animações de entrada/saída. | Sem layout/fundo configuráveis, realce por palavra, estilos de palavra ou revisão temporal individual. |
| Legendas e letras | SRT/ASS/VTT/LRC podem virar clipes editáveis; alinhamento local de TXT usa timestamps de palavras do Whisper como sugestão. | O parser ASS remove tags de karaokê; os tempos de palavra são descartados ao criar legendas; não há revisão por palavra. |
| Diálogo | faster-whisper já solicita timestamps de palavra e segmento. | O fluxo para a timeline conserva só o segmento e a interface não distingue tempo de frase de tempo por palavra. |
| Música e montagem | BPM, batidas, seções, energia, drops, cenas e geração automática já existem; recomendações locais consideram intensidade. | Andamento variável e correlação semântica dependem de validação real; a detecção de golpe é heurística. |
| Efeitos | Zoom, tremida, flash, cor, blur, separação/mixagem e alguns efeitos sintetizados já existem. | Biblioteca profissional, LUTs, mais transições e áudio do usuário ainda não existem; não devem ser aplicados aleatoriamente. |
| Isolamento de personagem | Há um protótipo Python de SAM2 com saída de máscaras/PNG RGBA e job local; não está ligado à UI, projeto ou render. | Falta validar extração FFmpeg, consumo de memória, qualidade em mídia autorizada, empacotamento, correção manual e integração à timeline/render. |

## Fases e dependências

| Fase | Escopo | Dependências | Critérios de aceitação |
|---|---|---|---|
| 1. Tipografia cinética e revisão de palavras (esta entrega) | Presets independentes para letra, diálogo e impacto; fundos, layout e controles editáveis; ingestão de tempos ASS/LRC/Whisper; revisão manual por palavra. | Migração compatível do projeto e renderizador compartilhado existente. | Projeto v1 migra sem perda; tempos ASS/LRC/Whisper mantêm origem e incerteza; revisão altera um comando undoável; preview e exportação usam o mesmo renderer; build e testes passam. A comparação visual no WebView2 continua pendente. |
| 2. Narrativa musical dirigida | Eventos de preparação/golpe, beat/drop, fala e letra; escolhas com justificativa e confiança; controles para aceitar/rejeitar; ajustes a tempo variável. | Análises atuais e validação humana de fala/letra e de música real. | Sem evento confiável não há efeito automático correspondente; cada sugestão informa evidência/confiança; conjunto autorizado de faixas e cenas mede erro de sincronização e precisão dos impactos. |
| 3. Biblioteca de efeitos e transições | Motion blur, rampas de velocidade/zoom, glitch, aberração cromática, light leaks, grading/LUT e transições selecionáveis; importação de elementos/áudio do usuário. | Specs compartilhadas de efeito e testes de paridade do preview/export. | Cada efeito publicado tem implementação em ambos os lados ou é identificado como só exportação; teste de render com FFmpeg real; intensidade/frequência configuráveis e undo. |
| 4. Spike de isolamento temporal de personagem | SAM 2.1 Hiera Tiny selecionado para teste CPU no Windows; há inferência sintética e API protótipo. | Medir memória/latência e qualidade real; validar FFmpeg e build do instalador. | O smoke test sintético não fecha o gate. Só avançar após medição reproduzível, qualidade revisada e instalador validado. |
| 5. Recorte, correção e composição | Job temporal de máscara alfa em cache, edição manual de máscara, camadas/fundo, contorno/glow/sombra e movimento; manter originais intactos. | Fase 4 aprovada; integração ao render plan e ciclo de vida de jobs. | Máscaras propagadas em sequência de quadros, editáveis/recalculáveis; cancelar não deixa cache parcial; teste de export alfa/compósito e undo; qualidade revisada em sequência real autorizada. |
| 6. Mixer e aceitação profissional | Paridade preview/export para seleção de faixa, ganho por clipe/trilha, mute/solo, fades, ducking e SFX; revisão final de desempenho/UX. | Base existente de áudio e testes no Windows/WebView2. | Matriz de cenários A/V automatizada; teste manual em WebView2 com áudio e vídeo reais autorizados; sem clipping nas medições de saída e sem arquivos originais modificados. |

### Fase 1: escopo implementado nesta execução

- `Lyrics Cinematic`, `Dialogue Dramatic` e `Impact Typography` são presets de configuração, não efeitos automáticos obrigatórios.
- A camada de texto conserva palavra, intervalo relativo ao clipe, origem (`ASS`, `LRC`, `Whisper` ou edição manual), confiança quando disponível e overrides visuais.
- O renderer único desenha palavra ativa, fundo (nenhum, faixa, caixa translúcida ou quadro preto), alinhamento, margem/largura e espaçamento; preview e exportação chamam o mesmo código.
- O inspetor permite selecionar/escutar uma palavra, ajustar seu intervalo e editar seu realce. Segmentos sem tempos por palavra permanecem como frase; não se inventam tempos distribuindo a duração.
- Projetos antigos migram para defaults que preservam o visual atual.

## Spike de recorte temporal: SAM 2.1 selecionado para teste, não para produção

O usuário escolheu SAM 2.1 Hiera Tiny, teste em CPU e runtime/pesos no instalador principal. O código e o checkpoint consultados são Apache-2.0. O upstream recomenda WSL para Windows e documenta extensão CUDA opcional. Neste host Windows, o sidecar PyInstaller processou via FFmpeg um clipe sintético de três quadros 256×256 a 1 fps em 13,95 s após iniciar o serviço, acompanhando o objeto em movimento. O bundle descompactado mede 745,9 MiB e o working set amostrado foi ~1.079 MiB; cancelamento real também foi validado. Isso não valida qualidade em anime nem desempenho a 24/30 fps; o instalador Tauri ainda não foi construído.

Para fechar o gate, medir:

1. Windows 10/11 nativo e GPU sem CUDA (CPU/DirectML, se tecnicamente suportado), além de GPU NVIDIA quando disponível;
2. tempo por quadro/trecho, pico de RAM e VRAM, inicialização, tamanho do runtime e checkpoint;
3. estabilidade de identidade/contorno em cortes, oclusão, motion blur e cenas de anime;
4. edição por pontos positivos/negativos e propagação após corrigir um quadro;
5. cancelamento, cache por hash + versão do modelo/configuração e retomada sem corromper resultados;
6. licença de código, pesos e demais dependências, com obrigações de redistribuição.

As dependências e o workflow do instalador foram alterados para incluir SAM2, mas o bundle PyInstaller ainda está em validação. Não enviar quadros para nuvem nem declarar o recurso disponível antes de validar memória, FFmpeg real, qualidade autorizada e instalador. O estado detalhado está em [ROADMAP_CHARACTER_CUTOUT.md](./ROADMAP_CHARACTER_CUTOUT.md).

## Fora do escopo desta entrega

Nenhuma UI de isolamento, correção manual, camada de timeline, composição de preview ou exportação está implementada nesta fase. O backend é protótipo e a lista acima é plano, não promessa de funcionalidade disponível.

## Referências técnicas

- SAM 2, repositório e guia oficial: https://github.com/facebookresearch/sam2
- Licença de código SAM 2: https://github.com/facebookresearch/sam2/blob/main/LICENSE

## Ajuste incremental: ganho positivo no preview

- **Problema:** o inspetor aceitava ganho de até +12 dB, mas o player dependia de `HTMLMediaElement.volume`, que não representa ganho acima da unidade.
- **Desenvolvimento:** preservar o cálculo existente de clipe/trilha/fades/keyframes e aplicá-lo por `GainNode`; uma compressão de pico no master reduz clipping audível. Falhas ao preparar ou iniciar o áudio são notificadas.
- **Arquivos:** `apps/desktop/src/features/editor/player.ts`, `Preview.tsx`, `Inspector.tsx` e `apps/desktop/test/player-audio.test.ts`; estado e limitação registrados em `docs/STATUS.md` e `docs/LIMITATIONS.md`.
- **Integração:** o áudio continua vindo dos mesmos proxies e trilhas, sem alterar projeto, exportação ou comandos de edição. A faixa escolhida (`streamIndex`) ainda só é aplicada na exportação.
- **Validação:** testes focados de ganho/fades/mute-solo/keyframes, typecheck e build desktop; a verificação manual no WebView2 permanece pendente.
