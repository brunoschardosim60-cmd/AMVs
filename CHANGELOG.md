# Novidades

## 0.6.31

**Auto-reparo pós-geração, anti-repetição de cenas, tradução em lote com cache em disco, diferenciação visual entre letra e fala, andamento variável/compasso e instalador em pasta única.**

- **Auto-reparo automático na revisão (`autoRepairAssembly`):** a revisão pós-geração executa até 2 passadas automáticas para suavizar saltos de luminosidade (`±0,65 EV`), mesclar micro-cortes abaixo de 180 ms quando há margem na fonte e eliminar sobreposições de legendas, reportando o que foi corrigido automaticamente.
- **Anti-repetição e cor preservada em lutas:** planos longos (`>= 4 s`) são subdivididos em trechos não sobrepostos, intervalos usados são rastreados para não repetir o mesmo recorte, cenas muito escuras são evitadas nas pontas e lutas/estilos de impacto mantêm cores vivas (sem vinheta escura indevida).
- **Diferenciação visual entre letra da música e legenda de fala:** quando ambos aparecem no mesmo AMV, a legenda da fala recebe estilo, fonte, cor e posição vertical distintos da letra da música.
- **Tradução rápida em lote + cache persistente:** `translateLinesFree` agrupa até 14 linhas em 4 requisições paralelas, pula trechos já em português e persiste traduções em disco (`translate-cache.json`) para reuso instantâneo.
- **Sincronia musical e de letras aprimorada:** detecção de andamento variável (`tempoVariable`) com rastreador de batidas relaxado e compassos `3/4`, `4/4` e `6/8` em `@amv/analysis`; novo botão **Auto-sync** no painel de Legendas para alinhar deslocamento global às batidas detectadas.
- **Pasta única no Windows (NSIS `currentUser`):** instalador consolidado em `%LOCALAPPDATA%\AMV Studio` (removido MSI duplicado), sobrescrevendo a mesma pasta a cada atualização.
- **Documentação consolidada e SAM2 marcado como experimental:** remoção de roadmaps duplicados, arquivamento dos benchmarks de SAM2 em `docs/archive/`, atualização de `docs/STATUS.md` e `docs/LIMITATIONS.md`, e criação do checklist `docs/TESTE_MANUAL_WINDOWS.md`.

## 0.6.30

**Edição direta na Timeline, falas em narração por cima dos cortes de ação (`voiceover`) e prévia visual ao vivo da tipografia.**

- **Edição Direta pela Timeline:** clicar em qualquer clipe da timeline (`Legendas`, `V1`/`V2`, `Música`) seleciona o clipe, move o playhead para mostrar no Preview, abre automaticamente o painel de **Propriedades** já posicionado na seção principal (`Texto` no topo com botão `Traduzir PT-BR`, `ClipRangePreview` no topo para vídeo e `Áudio` no topo) e exibe a **Barra de Edição Rápida** logo abaixo da barra `Adicionar` (texto editável inline, tradução unitária ou da trilha inteira para PT-BR, estilo, tamanho, posição, corte, velocidade, enquadramento e transição). Duplo clique ou o botão **Modificar** abre o modal completo com `ClipRangePreview`, ajuste livre de entrada/saída e seletor de cenas do episódio (`Usar esta cena`).
- **Falas em Narração sobre Cortes de Ação (`voiceover` / `hybrid`):** novo seletor **Modo das falas** (`Narração sobre cenas de ação (estilo Edit)`, `Misto (cena no drop + narração na ação)` e `Mostrar cena original da fala`), ampliando o limite para até 6 falas distribuídas antes e depois do drop sobre os cortes rápidos na batida em `V1`, com destaque palavra a palavra sincronizado (`wordAnimation`) e punch de entrada nas legendas das falas.
- **Prévia Visual Ao Vivo da Tipografia ("Como fica na tela"):** cartão de prévia em tempo real e 6 pílulas visuais clicáveis (`IMPACTO`, `NEON`, `ÉPICO`, `MANGÁ`, `CINEMA`, `DIÁLOGO`) no gerador automático, além de amostra visual ao vivo ao lado do seletor de estilos na aba `Biblioteca > Legendas`.

## 0.6.29

**Arquitetura Music-First, tipografia cinética explosiva na batida, tradução PT-BR garantida em 5 camadas e prévias completas de Cenas e Falas.**

- **Arquitetura Music-First:** a fila de processamento (`session.ts`) prioriza a análise musical antes dos vídeos; o diálogo de geração agora coloca **1. Música (guia o corte e o ritmo)** e o **Modo guiado pela música** (`Batida + Letra Cinética`, `Puro Ritmo & Batida`, `Batida + Versos`, `História + Clímax`) no topo, extraindo, sincronizando e traduzindo a letra antes de escolher cenas visuais compatíveis em bilíngue (EN + PT-BR).
- **Tipografia Cinética Explosiva (`kinetic-words`):** modo de explosão por palavras-chave (1–2 palavras em caixa alta centralizadas na tela, `transform.y = 0`) cravadas na batida com animação punch de escala (`1.28 → 1.0`), fontes de impacto (`Impact`, `Cinzel`, `Trebuchet MS`), contorno espaçado alinhado (`strokeSpaced`) e brilho neon sem caixa preta.
- **Tradução PT-BR Garantida em 5 Camadas:** escopo HTTP ampliado (`https://**`) em `capabilities/default.json`, fallback `globalThis.fetch` no wrapper Tauri, endpoint secundário (`clients5.google.com`) em `translate.ts`, tradução automática ao importar/extrair em `SubtitlesPanel.tsx` e passe de verificação pós-`generateAmv` (`translateGeneratedClips`) garantindo que nenhuma legenda ou letra fique sem conversão para Português quando PT-BR está ativo.
- **Prévias de Cenas e Falas Completas:** sidebar da Biblioteca ampliada para `300px`, timestamps/durações preservados sem corte pelo nome do arquivo, fusão de falas curtas fragmentadas (`<= 0,85 s`) e player de prévia customizado (`Só trecho` / `Contínuo`, expansão `-0.5s` / `+1s`, `Início`/`Fim` desbloqueados e botão `Ampliar` em modal).
- **Limpeza de UI:** remoção de blocos de texto explicativos redundantes no gerador e seletor compacto de estilos de legenda.

## 0.6.28

**Prévia em 1080p nativo, áudio contínuo sem efeito gangorra nas falas, narrativa com início/meio/fim e legendas sem tarja preta.**

- **Qualidade 1080p na Prévia:** o editor e a Biblioteca (`Mídia`, `Cenas` e `Falas`) agora usam `Original` e `100%` por padrão para vídeos H.264/VP9/AV1 8-bit compatíveis (`.mp4`/`.mov`/`.webm`), eliminando o aspecto borrado do proxy 540p/50%.
- **Música sem disputar com a voz:** os intervalos de ducking automático e manual agora fundem pausas curtas entre falas (`<= 2,2 s`–`2,5 s`), mantendo a música suavemente abaixada durante todo o bloco de diálogo em vez de subir e descer a cada segundo. No modo Discurso, o áudio embutido de `V1` também é silenciado para evitar eco.
- **Começo, meio e fim consistentes:** corrige `recommendStyle` para que episódios longos com lutas não caiam automaticamente em `Discurso` P&B, ordena cronologicamente as falas escolhidas no modo Discurso e abre janela progressiva no modo Luta para percorrer abertura, clímax e desfecho do confronto.
- **Legendas limpas sem cobrir hardsubs:** remove a tarja preta opaca (`box`) das legendas de fala mantendo contorno forte + sombra, e adiciona a opção `Escrever legenda das falas na tela` para desativar facilmente em episódios que já têm legenda gravada no vídeo.

## 0.6.27

**Prévia com áudio na Biblioteca, tradução automática garantida para PT-BR, reconhecimento ampliado de falas e alinhamento de letras entre idiomas.**

- **Prévia com vídeo e áudio antes de editar:** todas as abas da Biblioteca (`Mídia`, `Cenas` e `Falas`) agora permitem assistir e escutar episódios, músicas, cenas cortadas e falas diretamente no painel (com botão de repetir trecho e `+ Na timeline`). Redimensionar a qualidade do preview também redesenha o quadro pausado na hora.
- **Mais falas captadas e sempre em Português:** ajusta os parâmetros do Silero VAD e amplia o fallback sem VAD quando o episódio retorna poucas falas, além de preencher falas extras mesmo em músicas energéticas e aumentar o padrão de 1 para 2 falas.
- **Tradução automática garantida sem chave externa:** falas em japonês/inglês (tanto na geração quanto na aba `Falas` ou `Legendas`) agora são traduzidas automaticamente para Português (Brasil) mesmo sem configurar Ollama/API paga no Assistente, e os textos traduzidos ficam salvos na aba `Biblioteca > Falas`.
- **Letra da música em PT alinhada mesmo com áudio em inglês e extração direta:** permite colar letra em Português sobre música em inglês/japonês, traduz automaticamente versos extraídos do vocal com `Extrair letra do áudio (PT-BR)` e promove tempos por palavra para destacar a tipografia animada na tela.
- **Tipografia Anime também nas falas:** o preset tipográfico escolhido no gerador (`Anime · impacto`, `Anime · neon`, `Anime · mangá`, `Anime · ouro épico`, `Anime · diálogo`) passa a estilizar também as legendas das falas dos personagens.

## 0.6.26

**Letras sincronizadas de verdade, falas visíveis, filtro estrito de personagem/luta, tipografia anime e recortes cinematográficos.**

- **Sincronização de letras corrigida:** desliga o filtro VAD do Whisper ao transcrever vocais cantados (com fallback automático sem VAD quando vazio), tolera pequenas variações de transcrição em música cantada, importa diretamente letras coladas com tempos (.LRC/.SRT/.VTT) e sincroniza automaticamente letras digitadas ao clicar em Gerar AMV.
- **Falas dos personagens preservadas:** corrige o bloqueio que escondia legendas em português/inglês em animes com áudio original japonês, encaixa falas mesmo em músicas energéticas ou sem drop e evita retranscrever episódios que já têm legendas embutidas.
- **Respeito rigoroso a luta e personagem escolhidos:** falas e preenchimentos de fallback nunca mais misturam cenas ou falas de outra luta nem de outro personagem quando você escolhe uma luta específica ou filtra por personagem.
- **Tipografia Anime e recortes rápidos:** 5 novos estilos de tipografia (`Anime · diálogo`, `Anime · impacto`, `Anime · neon`, `Anime · mangá`, `Anime · ouro épico`) disponíveis na geração, no Inspetor e na aba Legendas; presets de 1 clique no Inspetor (`Destaque 1,16×`, `Close 1,32×`, `Cinemascope`, `Painel Mangá`, `Punch no corte` e `Zoom dramático`) e movimento de câmera suave em planos longos e falas.
- **Motor de montagem e editor evoluídos:** pontuação por continuidade/contraste de paleta de cor, encaixe cena×slot, respiro narrativo e anti-monotonia; sugestão de cenas por letra/clima/quadros via IA configurada; ideias de música (YouTube/Spotify); comparador A/B de trecho; prévia Proxy/Original com liberação de GPU/áudio; avaliador audiovisual com início atrasado, encerramento abrupto (com correção 1-clique) e score por dimensão.

## 0.6.25

**Detecta travamento da forma de onda mesmo quando o FFmpeg continua enviando pequenos blocos de dados.**

- O watchdog agora exige avanço real de pelo menos 5 segundos de áudio em até 90 segundos, em vez de reiniciar com qualquer byte recebido.
- Mostra o tempo de áudio decodificado na lista de tarefas para diferenciar progresso lento de travamento.
- Informa erro específico quando o FFmpeg não avança e interrompe somente a geração da forma de onda.

## 0.6.24

**Evita travamentos indefinidos na geração da forma de onda.**

- Limita a decodificação ao tempo de duração informado para o arquivo, evitando processar caudas de áudio fora da timeline.
- Detecta quando o FFmpeg deixa de enviar PCM por 90 segundos, encerra somente o job da forma de onda e permite que a importação continue.
- Corrige uma condição de corrida no cancelamento do sidecar durante sua inicialização.

## 0.6.23

**Letras digitadas e legendas automáticas traduzidas no Gerar AMV.**

- Permite escrever ou colar a letra diretamente no gerador e sincronizar os versos com a música por meio de transcrição local; os arquivos .LRC e .SRT continuam compatíveis.
- Usa os tempos reconhecidos para alinhar as linhas. Trechos que não correspondem à transcrição são sinalizados, sem inventar marcações de tempo.
- Transcreve localmente as falas das faixas de áudio dos episódios e permite manter o idioma original ou traduzir para português (Brasil), inglês, espanhol, francês, japonês, alemão, italiano, coreano e chinês.
- Preserva o texto original junto da tradução e evita exibir legendas incompatíveis com a faixa de áudio selecionada.
- Armazena transcrições em cache para reduzir reconhecimentos repetidos e remove arquivos WAV temporários após salvar o resultado.

## 0.6.22

**Direção editorial e seleção de cenas mais consistentes no Auto AMV.**

- Define um objetivo editorial antes da montagem e aplica as prioridades/limites na seleção de cenas, não apenas na descrição do estilo.
- Adiciona storyboard por seção musical, com origem, função narrativa e justificativa para os cortes.
- Inclui uma segunda revisão técnica da montagem, com evidências e estados verificado, parcial ou indisponível; só corrige automaticamente problemas seguros.
- Permite análise semântica profunda de todas as cenas como opção explícita; completa também a análise visual local pendente antes da geração.
- Melhora a seleção de falas, favorecendo frases completas e específicas sem descartar gritos que realmente tenham impacto.
- Torna o foco em luta mais cuidadoso com a ordem das sequências e com rótulos visuais que indicam cenas que não são combate.

## 0.6.21

**Continuidade de personagens mais consistente entre cortes.**

- O Auto AMV agora considera personagens confiavelmente identificados nos últimos planos, não apenas no corte imediatamente anterior.
- Reaparições do mesmo personagem em múltiplos planos recentes recebem um bônus moderado de continuidade; cenas sem evidência confiável não são penalizadas.
- Mantida a distinção entre evidência visual confirmada e rótulos incertos: a heurística não inventa identidade nem força continuidade.

## 0.6.20

**Melhorias na montagem automática, continuidade visual e estabilidade do render.**

- Seleção de cenas com melhor cobertura da timeline, reserva segura e alertas quando não há material adequado.
- Melhor posicionamento de letras em impactos, com preservação dos tempos de palavras.
- Movimento de câmera discreto em planos longos e cortes alinhados aos frames.
- Pontuação visual mais criteriosa para brilho, exposição e movimento.
- Medição de fala associada à faixa de áudio correta, evitando compensação cruzada entre idiomas.
- Escalonamento final Lanczos e correções de render.
- Atualização automática preparada para esta versão.

## Não lançado — refinamentos do Auto AMV (14/11/2026)

- **Cobertura de timeline com segurança:** slots sem escolha tentam uma cena de reserva, mas respeitam o limite de fonte de 0,6×; se nenhuma cena couber, o gerador avisa em vez de ultrapassar a cena original.
- **Letras preservadas:** letras que cruzam um impacto podem terminar antes dele ou começar depois; linhas curtas tentam permanecer por 0,9 s sem invadir a próxima linha.
- **Movimento mais orgânico:** push-in/pull-out discreto em planos longos sem movimento de impacto; cortes curtos não recebem zoom automático.
- **Cortes alinhados a frames:** fronteiras dos slots são quantizadas à taxa racional do projeto para evitar cortes entre quadros.
- **Seleção de cenas:** pontuação penaliza visibilidade muito baixa, superexposição e planos quase parados em trechos musicais agitados; cenas marcadas como quase pretas ficam em reserva e só entram se nenhum plano normal couber no slot.
- **Cor com moderação:** exposição/sombras são levantadas em cenas escuras utilizáveis; contraste/saturação ou vinheta variam levemente com energia quando o estilo não fornece uma grade.
- **Vozes mais consistentes:** a análise estima dB RMS p90 na banda vocal por fala; o ganho compensa diferenças entre episódios com limite de ±4 dB somente quando a faixa medida é a faixa escolhida. Não é medição LUFS nem substitui escuta/true-peak.
  A versão de análise do episódio passa de e3 para e4 para recalcular o dado em caches antigos.
- **Render mais nítido:** escalonamento final usa Lanczos. Proxy continua em 540p/CRF 26 para preservar fluidez e espaço; não aumentamos seu custo por padrão.

## 0.6.19

**Geração de vídeo garantida de primeira, fim de repetições em vídeos longos (45s+), transições suaves sem telas pretas e progresso da IA**
- **Geração de vídeo garantida de primeira tentativa**: Adiciona fallback inteligente que puxa tomadas dinâmicas do restante do episódio caso a seleção de luta fique restrita, além de tolerância adaptativa de cadência (`len * 0.45`), garantindo que a timeline sempre receba clipes de vídeo e áudio completos de primeira, sem nunca gerar apenas a faixa de música.
- **Eliminação da repetição dos últimos 15 segundos em vídeos longos (45s / 60s)**: Quando uma luta isolada possui menos segundos de material do que a duração desejada do AMV, o motor agora complementa automaticamente o conjunto com as próximas sequências dinâmicas do episódio e cicla suavemente as cenas menos utilizadas, sem nunca ficar travado nos cortes finais da tomada.
- **Remoção de telas pretas prolongadas nas transições**: Substitui o mergulho escuro (`dip_black`) de 0,7s em cenas calmas por `dissolve` suave e cortes diretos de ritmo natural; `dip_black` fica restrito a saltos de contraste extremo e com duração máxima de 0,2s.
- **Decaimento animado no efeito de separação RGB (*glitch*)**: O efeito `rgb_split` agora diminui gradualmente sua intensidade ao longo do tempo do impacto, criando um efeito de pulso orgânico no drop.
- **Indicador de progresso e síntese multi-etapas da IA**: O diálogo de geração agora apresenta um overlay com o progresso de cada fase da inteligência (mapeamento de batidas, exame de personagens e coreografia, casamento semântico de letras e sincronia de golpes), mostrando com clareza o processamento e a análise profunda executada.

## 0.6.18

**Inteligência semântica de letra vs cena, presets inteligentes por episódio, capa heroica automática e suporte bilíngue (PT/EN)**
- **Casamento semântico automático de letra com cena (determinístico e local)**: Motor de análise semântica que relaciona versos da música com as características visuais e narrativas das cenas (7 temas fundamentais: combate/confronto, poder/determinação, fogo/chamas, escuridão/noite, luz/brilho, emoção/dor/lágrimas e velocidade/movimento), além de cruzar falas do personagem que coincidam com a letra da música. Funciona de forma 100% local, instantânea e sem depender de APIs externas.
- **Preset inteligente de configuração por episódio ("Configuração Ideal")**: Analisa o anime e a música para gerar um perfil personalizado pré-ajustado em um clique na interface (estilo recomendado, intensidade dos cortes calibrada por BPM, direção editorial, duração sugerida, foco em luta, falas marcantes e idioma). O usuário pode aplicar todas as configurações ideais com um único botão ("Aplicar Tudo Ajustado").
- **Seleção inteligente de capa heroica (Hero Cover Frame)**: Algoritmo que escolhe automaticamente o melhor quadro do episódio/luta para servir de pôster e capa, avaliando exposição equilibrada (evitando clarões estourados e telas pretas), nitidez/densidade de bordas, centralização do personagem (`centerOfVisualMass`) e o ápice coreográfico de impacto.
- **Proteção contra mistura desordenada de personagens**: Reforça a continuidade narrativa penalizando a troca repentina de personagens e lutas distintas sem justificativa musical (`-0.28`), mantendo sequências coerentes e conectadas.
- **Suporte a legendas bilíngues (Português e Inglês)**: O sistema de legendas cinéticas agora suporta e detecta faixas de legendas em português (`pt`/`por`) e inglês (`en`/`eng`), armazenando os textos traduzidos e mantendo a fala original sincronizada.

## 0.6.17

**Geração de AMV aprimorada: inteligência de luta, recortes focados nos personagens, legendas cinéticas com tradução e continuidade coreográfica**
- **Inteligência de luta vs momentos calmos**: Discriminação explícita de cenas de combate e impacto nos momentos de alta energia musical (≥ 70%), penalizando cenas calmas no clímax e reservando cenas atmosféricas/diálogos para aberturas e estrofes calmas (≤ 35%).
- **Recorte inteligente focado no personagem ("Punch-in" e enquadramento)**: Centraliza dinamicamente os personagens no quadro com zoom de ênfase de 8% a 14% guiado pelo centro de massa visual (`centerOfVisualMass`) em golpes, falas e momentos de impacto.
- **Continuidade coreográfica de combate ("Cenas Conectadas")**: Bonifica cortes sequenciais imediatos (< 4 s) dentro da mesma sequência de batalha, preservando a fluidez da ação e a direção do movimento.
- **Legendas cinéticas e suporte a tradução em português**: Integra legendas com tipografia dinâmica, brilho (*glow*), gradientes de cor no clímax e detecção automática de traduções em português (`pt`) das falas dos episódios, exibindo o texto traduzido e preservando o idioma original nos metadados.
- **Efeito rítmico de separação RGB (*glitch*)**: Adiciona efeito de separação cromática RGB de curta duração em impactos no drop e golpes de combate de alta energia.

## 0.6.16

**Elimina congelamento/lentidão no player e acelera renderização de vídeo**
- **Elimina seeks repetitivos a cada 50 ms**: Corrige a dependência de re-render no componente `Preview`, que disparava `setProject` e `needsSeek` continuamente a cada avanço do playhead, causando travamento do decodificador de vídeo.
- **Renderização direta de vídeo sem cópias intermediárias**: O frame de vídeo agora é desenhado diretamente no canvas principal da GPU sem clonagem desnecessária para buffers de 2D em cada frame.
- **Aceleração direta de cor por GPU**: Gradações de cor simples (brilho, contraste, saturação e exposição) agora utilizam filtros compostos diretamente pelo hardware sem roundtrips caros de textura WebGL2/CPU.
- **Limite otimizado de decodificadores**: Ajusta os slots de mídia ativos para respeitar os limites de sessões de hardware D3D11/Media Foundation no Windows.

## 0.6.15

**Aceleração de cortes pré-drop, micro-pulsos de batida e transições dinâmicas**
- **Correção da cadência de cortes pré-drop**: Corrige o cálculo da distância temporal até o drop em faixas de música com offset inicial (`drop - cur`), ativando a aceleração frenética de cortes nos 2,5 segundos que antecedem o impacto do clímax.
- **Micro-pulsos de batida ("Beat Punch")**: Adiciona uma animação sutil de pulso de escala (2 a 4% com decaimento suave em ~110 ms) em cortes que coincidem com acentos de graves e entradas energéticas.
- **Transição de impacto luminoso (`dip_white`)**: Aplica clarões de transição expressivos em cortes de impacto fora do drop com movimento de câmera compatível.
- **Contraste dramático no drop**: O algoritmo de pontuação favorece transições de iluminação contrastante (cena escura de tensão seguida de clímax visual iluminado) na entrada do drop.

## 0.6.14

**Aprimora o algoritmo de geração de AMV (enquadramento, anti-repetição, pontos de corte inteligentes e transições)**
- **Progressão fluida de enquadramento**: Premia transições naturais de escala de plano (aberto → médio → primeiro plano) e penaliza saltos abruptos ou planos repetidos em sequência.
- **Anti-repetição inteligente**: Penaliza cenas e sequências reutilizadas recentemente na mesma geração, garantindo maior variedade visual.
- **Seleção inteligente de ponto de entrada (`srcIn`)**: Em cenas mais longas que o corte musical, centraliza a ação nos momentos de pico de velocidade/movimento ou impacto, em vez de um corte aleatório.
- **Transição de zoom dinâmico**: Adiciona efeito de zoom rápido para cortes de impacto fora do drop com movimento de câmera detectado.
- **Beam Search adaptativo**: Aumenta o espaço de busca quando há mais candidatos, explorando melhores combinações narrativas.

## 0.6.13

**Corrige o carregamento do vídeo recortado e elimina travamento/tela preta no player**
- Sincroniza o primeiro corte gerado pelo Auto AMV diretamente no preview e reposiciona o playhead ao aplicar.
- Corrige o loop infinito de seek no preview eliminando o congelamento e a tela preta ao reproduzir.
- Aumenta os slots de mídia ativos, protege elementos em reprodução contra descarte no mesmo quadro e evita conexões concorrentes desnecessárias para áudios inaudíveis.
- Otimiza o processamento de cor com fallback acelerado por GPU 2D e adiciona buffer preservado no WebGL2.

## 0.6.12

**Estabiliza o preview e respeita a faixa de áudio selecionada**
- Reduz seeks corretivos repetidos no áudio durante a reprodução, evitando cortes e vibração; mantém a correção de drift visual em desvios grandes.
- Gera proxies AAC para faixas alternativas do vídeo e usa o `streamIndex` escolhido no preview e na montagem automática.
- Preserva o último quadro válido enquanto o próximo quadro é buscado, evitando flashes pretos durante seeks.
- Testes automatizados passaram; reprodução manual no WebView2 e validação com o episódio/música do usuário ainda precisam ser feitas.

## 0.6.11

**Corrige a abertura e a mixagem do estilo Discurso**
- A primeira fala e sua imagem agora começam em 0 s, sem quadro preto inicial.
- A música permanece no ganho normal fora das falas e abaixa temporariamente durante cada trecho falado, voltando em seguida.
- Testes de regressão cobrem o início da imagem e a curva de ducking da música.

## 0.6.10

**Editor visual e montagem de ação mais cuidadosos**
- A interface do editor, preview, timeline, tela inicial e ferramentas recebeu uma atualização visual consistente, mantendo os fluxos e estados reais existentes.
- O Auto AMV pode posicionar recortes dentro do plano conforme eventos de movimento local confiáveis, sem cruzar o corte original.
- A geração oferece rampas de velocidade condicionadas à ação e ao FPS medido: desaceleração breve em impactos e aceleração em preparações visuais confiáveis. Fontes VFR ou com cadência insuficiente não recebem slow motion automático.
- Zoom animado no impacto e tremida curta deixam de ser sorteados: dependem de evidência de ação e sincronização musical. O golpe continua alinhado à batida quando a rampa é aceita.
- A atualização automática foi validada ao atualizar o app instalado de v0.6.9 para v0.6.10; a conferência completa do editor no WebView2 e a comparação com mídia real autorizada continuam pendentes.

## 0.6.9

**Montagem mais contínua e áudio mais previsível**
- Quando as cenas preferidas não servem para um corte, a montagem procura alternativas próximas na mesma sequência antes de saltar para outra parte do episódio. A reutilização preserva o progresso narrativo e evita reiniciar a cronologia.
- As curvas manuais de volume para falas/drop não recebem também o ducking automático, evitando reduções duplicadas. O preview e a exportação respeitam o modo definido no clipe.
- A comparação local com episódio e música completos melhorou a continuidade e os golpes sinalizados como sincronizados; ainda há repetição, saltos e um quadro preto a revisar. Consulte a limitação documentada antes de exportar.

## 0.6.8

**Música, letra e cena mais conectadas**
- A biblioteca ranqueia faixas pela análise real e pela compatibilidade da energia com as cenas escolhidas, e explica os motivos.
- A análise semântica opcional relaciona até seis versos sincronizados com cenas e diálogos amostrados; correspondências fortes influenciam a montagem e podem manter a legenda sobre um impacto. Exige ação explícita e pode consumir cota do modelo.
- Falas com maior pontuação de impacto aparecem em fonte maior.
- Tradução automática de letras ainda não está ligada à geração: para exibir uma letra traduzida, importe um arquivo temporizado já traduzido.

## 0.6.7

**Estilo aberto e montagem com mais ritmo**
- O modo **Aberto · o app escolhe** recomenda um estilo a partir do BPM, energia, cenas, falas, letra sincronizada e rótulos visuais já analisados; mostra o motivo e não usa chamadas extras de IA.
- Novo estilo **Impacto rápido**: cortes podem acontecer a cada meia batida e favorecem cenas marcadas como ação/impacto; em músicas lentas, o limite mínimo evita cortes quase invisíveis.
- Seleção de episódios na geração ganhou ações Todos/Nenhum e mostra quantas cenas e lutas foram analisadas por episódio. A geração considera só os episódios marcados e procura as melhores lutas disponíveis.
- O estilo Emocional dá mais peso a cenas calmas e, quando a análise visual opcional existe, a cenas rotuladas como tristeza/calma.

## 0.6.6

**Revisar e montar cenas**
- A aba Cenas permite pré-visualizar cada trecho pelo proxy, marcar vários e ajustar início/fim antes de montar.
- "Juntar e adicionar" coloca os trechos em sequência no fim da trilha de vídeo; cada cena continua um clipe editável separado e o conjunto pode ser desfeito de uma vez.
- As configurações de IA agora rolam dentro da janela quando a tela é baixa, mantendo Salvar e Cancelar sempre acessíveis.

## 0.6.5

**Frases e letras mais integradas ao AMV**
- Falas longas entram em grupos curtos de palavras, com animação pop e saída em fade no mesmo ritmo da fala.
- Letras aparecem em frases curtas, com destaque dourado e entrada pop; se o começo do verso estiver muito perto, o texto encaixa na batida mais próxima.
- Trechos de letra são omitidos durante falas e impactos importantes, incluindo o drop, para não competir com o momento visual. O app informa quando isso acontecer.
- Animações em textos curtos agora ajustam a duração ao tempo do clipe para aparecerem por completo.

## 0.6.4

**Sincronizar letras sem tempo**
- Importe um arquivo `.txt` com uma linha por verso e selecione o clipe da música na trilha Música.
- O faster-whisper transcreve a faixa de áudio localmente; o app compara as palavras reconhecidas com os versos em ordem, respeitando o ponto de entrada e a velocidade do clipe.
- Os versos encontrados viram clipes de texto editáveis na timeline. O app informa as linhas incertas ou não encontradas; revise a sincronização antes de exportar.
- O áudio original não é modificado nem enviado. O modelo pode precisar ser baixado na primeira execução; canto e pronúncia ainda podem afetar a precisão.

## 0.6.3

**Conferir e corrigir as batidas**
- A biblioteca mostra as batidas sobre a curva de energia da música; a timeline do editor continua mostrando batidas, compassos e drops.
- Corrija BPM detectado pela metade ou pelo dobro com ×2 / ÷2, ou toque quatro vezes junto com a música para definir BPM e fase.
- A correção atualiza a grade completa, os compassos, o BPM exibido e o cache compartilhado da faixa, valendo também para montagens futuras. O áudio original não é alterado.
- A correção manual é de andamento constante; músicas com mudanças de tempo ainda precisam de detecção por trechos.

## Transcrição local com progresso e seleção de áudio (0.6.3)

- O painel de legendas permite escolher episódio, stream de áudio, modelo e idioma, e inserir as falas como clipes de texto editáveis nos trechos correspondentes do episódio. O stream escolhido é extraído para WAV mono no cache; o original nunca é alterado.
- Se já houver legendas no mesmo trecho, o app pede confirmação antes de substituí-las.
- O app inicia o analisador local autenticado com token aleatório e porta local; o áudio não é enviado para provedores externos.
- A API usa jobs `POST /speech/jobs`, `GET /speech/jobs/{id}` e `DELETE /speech/jobs/{id}` para progresso por segmento e cancelamento. O app tenta cancelar cooperativamente e encerra o processo do analisador se o job não parar em 5 s.
- Usa faster-whisper em CPU/int8, com modelos `tiny`, `base`, `small`, `medium` ou `large-v3`; idioma pode ser automático ou informado.
- O runtime Windows é empacotado com PyInstaller no instalador; o CI também testa a API empacotada. Os pesos do modelo continuam sendo baixados sob demanda na primeira transcrição. A validação com áudio/modelo reais ainda está pendente.

## 0.6.2

**Encaixe de cenas com contexto de música**
- A análise visual considera o estilo/intensidade escolhidos, BPM, seções, drop e até seis frases de impacto da letra importada; quando disponíveis, também recebe as falas/legendas do trecho analisado.
- Cada cena agora recebe rótulos estruturados de ação, emoção, intensidade visual e confiança, além de personagem/luta. A montagem combina a intensidade visual com a análise local e favorece ação no refrão/drop e cenas mais calmas em trechos suaves.
- O áudio e o vídeo completos nunca são enviados: somente quadros amostrados e o contexto textual/musical resumido. Serviço externo continua dependendo do consentimento nas configurações de IA; Ollama mantém os dados localmente.
- A análise visual é refeita nesta versão para produzir os novos rótulos. A qualidade com uma chave Gemini e mídia real ainda precisa de validação.

## 0.6.1

**Análise visual detalhada**
- Em "Gerar meu AMV", escolha entre priorizar só cenas de luta ou analisar todas as cenas do episódio.
- O modo detalhado usa 3 quadros por cena, inclui cenas escuras, não tem o limite de 120 cenas e reanalisa cenas que antes só tinham uma amostra.
- As amostras são combinadas para reduzir rótulos inconsistentes; a estimativa de quadros/chamadas aparece antes de iniciar. Análise interrompida pode ser retomada.
- Reconhecimento de personagens ainda depende do modelo de visão e não garante identidade; na nuvem, os quadros são enviados ao provedor e podem gerar custo.

## 0.6.0 (incluído na 0.6.1)

**Sincronia com a música**
- **Drop com precisão de batida**: o drop era procurado só a cada 4 compassos, então um drop fora dessa grade era perdido (3 de 7 casos de teste) ou detectado 1,4–1,8 s atrasado, e o clarão/tremida caía quase 2 s fora do momento certo. Agora o drop é achado no primeiro golpe forte.
- Corrigido um desvio de ~24 ms: toda batida era detectada adiantada em relação ao golpe real. Agora o erro médio é ~0,2 ms (pior caso ~5 ms, antes 36 ms). As músicas são reanalisadas sozinhas na primeira vez.
- **Ajuste fino da sincronia**: na geração, antecipe ou atrase cortes, drop e falas em até 500 ms sem deslocar a música. Útil para corrigir um atraso constante; não elimina deriva em faixas com andamento variável.
- **Golpe na batida**: cada cena forte entra com o instante do impacto logo depois do corte (no drop, quase junto), em vez de o corte cair em qualquer ponto da cena.
- **Trecho da música que combina**: o app compara trechos da música com a força das cenas escolhidas e sugere os 3 melhores (com o motivo). "Automático" usa o melhor.

**Não misturar lutas**
- O app agora separa cada episódio em **lutas** (trechos contínuos de ação) e, no modo **Focar na luta** (padrão), monta o vídeo numa luta só, em ordem. Se uma luta não tem cenas suficientes, junta a próxima mais forte. Você também pode marcar quais lutas usar. **Misturar cenas** volta ao comportamento antigo.
- Falas só entram se forem da luta escolhida.
- Limite: separa por ritmo e cortes, não reconhece personagens (isso pede um modelo de visão).

**Efeitos sonoros**
- O app gera efeitos de AMV por código (sem arquivos de terceiros, sem direitos autorais): **subida** até o drop, **impacto** exatamente no drop, **golpes** nas pancadas e **whoosh** nos cortes. São seletivos (espaçados, mais fortes primeiro), nunca ficam por cima de uma fala e entram na trilha "Efeitos". Ligar/desligar em "Efeitos sonoros".
- Conferido no vídeo exportado: a diferença entre a versão com e sem efeitos é silêncio até a subida, que cresce até o drop, e o impacto cai a ~25 ms do degrau de energia da música.

**Análise cena a cena com visão (IA)**
- Botão "Analisar cenas com IA" no Gerar meu AMV: manda quadros das cenas de luta (6 por chamada) a um modelo com visão (Claude, GPT-4o, ou llava/qwen2.5vl no Ollama) e descobre **quem aparece** e **se é luta**. Escolha os personagens e a montagem usa só cenas deles; cenas que não são luta saem dos golpes fortes. Mostra a estimativa de custo antes; retoma de onde parou; com modelo local nada sai do PC.

**Falas e áudio**
- Escolha de 0 a 4 falas intercaladas; a música abaixa sozinha em cada uma e volta depois.
- O aviso "2 faixas de áudio" é sobre o arquivo do anime (ex.: japonês + português), não sobre a música. O app usa a faixa **original (japonês)** por padrão, tanto na análise quanto na fala, e você pode trocar para a dublagem.

**Legendas**
- **Troca de idioma**: Traduzir (9 idiomas) usa o modelo de IA do Assistente (Ollama, Claude, OpenAI). O texto original fica guardado: dá para trocar de idioma de novo ou voltar ao original, e a exportação sai no idioma escolhido.

**Interface (achados reproduzindo o app num navegador com FFmpeg real)**
- O botão **Importar** do painel de mídia era empurrado para fora do painel e ficava atrás do preview (inclicável): agora é uma linha própria.
- A trilha **Efeitos** ficava escondida atrás de rolagem: a timeline agora abre com altura para todas as trilhas.
- O diálogo Gerar meu AMV agora tem 3 colunas (as opções novas ficavam abaixo da dobra).
- O `Dialog` não rouba mais o foco para o botão Fechar a cada atualização.
- O **Assistente** virou uma janela flutuante: arraste pelo cabeçalho, redimensione, minimize para uma bolinha. Não ocupa mais espaço e o painel de propriedades não some quando ele abre.

## 0.5.5

- Preview no formato certo: projeto vertical (ou quadrado) aparece inteiro na tela, sem cortar.
- Episódio horizontal em projeto vertical já entra **preenchendo** a tela (sem faixas pretas enormes). Nas propriedades do clipe há **Encaixar / Preencher**; com vários clipes selecionados (Ctrl+A) arruma todos de uma vez.
- Preview mais leve: reaproveita o vídeo entre os cortes do mesmo episódio (antes abria um por clipe).

## 0.5.4

Correção: a análise de episódios longos parava em 33% ("Analisando cenas e falas"). Agora o FFmpeg grava os dados num arquivo temporário em vez de mandar mais de 1 milhão de mensagens para a tela.

## 0.5.2

Correção: "Novo projeto" travava com "Esta tela encontrou um erro" (erro #185).

## 0.5.1

Correção: a tela podia travar com "Esta tela encontrou um erro" (erro #185) enquanto o app analisava músicas e episódios.

## 0.5.0

**Assistente** (botão no topo do projeto): peça em português, por exemplo "deixe os cortes mais rápidos", "coloque um grito antes do drop", "troque essa cena por uma mais forte", "clarão nas batidas" ou "analise meu AMV". Ele mostra a proposta item por item. Você escolhe o que entra, testa na timeline e aplica, e Ctrl+Z desfaz.
- Funciona sem internet com pedidos diretos.
- Para conversar livremente e pedir ideias de episódios, ligue um modelo na engrenagem: Ollama no seu PC (grátis), Claude, OpenAI ou outro compatível. A chave fica no cofre do Windows.

**Músicas** (ícone de nota na barra da esquerda): sua biblioteca de músicas.
- Adicione pastas inteiras. O app mede BPM, intensidade e drop de cada uma.
- Filtre, crie playlists, favorite, dê nota e marque a emoção.
- Compare curvas de energia e ouça pelo player do rodapé, que continua tocando em qualquer tela.
- **Recomendadas** sugere a melhor para cada tema (Motivação, Luta, Triste, Épico, Romântico, Letra) e explica o porquê. O Gerar meu AMV também sugere músicas da biblioteca.

**Legendas** (aba no painel da esquerda do editor):
- Importe .srt, .ass, .vtt ou .lrc. A letra .lrc já entra alinhada com a música.
- "Do episódio" encaixa as falas originais embaixo de cada cena.
- Dá para editar o texto, ajustar o tempo, trocar o estilo (Legenda, Destaque, Palavra, Letra) e exportar SRT/VTT/LRC.

## 0.4.0

**Gerar meu AMV**: escolha a música, os episódios e o estilo (Hype/Luta, Superação, Letra na tela, Discurso motivacional, Emocional), a intensidade e a duração. O app analisa a música (BPM, batidas, drop) e os episódios (cenas, movimento, falas e gritos, legendas embutidas) e monta o vídeo com cortes na batida, a cena mais forte no drop, uma fala marcante logo antes do drop com a música abaixando, efeitos e legendas. Tudo vira clipes normais e editáveis, cada um com o motivo da escolha. "Gerar outra versão" faz uma montagem diferente; a anterior fica guardada em Versões.
Abas Cenas e Falas mostram os melhores momentos de cada episódio para arrastar para a timeline.
Correções: travamento ao analisar mídia e erro com nomes de arquivo com acentos.

## 0.3.0

Exportar vídeo (MP4 H.264, H.265 ou MOV ProRes, até 4K) a partir dos arquivos originais. Efeitos: zoom, câmera tremendo, clarão, surgir/sumir no preto, desfoque, cor, separação RGB e vinheta. Transições: dissolver e passar pelo preto/branco. Textos com contorno, sombra e animação de entrada/saída (tecla T). Volume até +12 dB, escolha da faixa de áudio (japonês/português) e abaixar a música por keyframes.

## 0.2.0

Editor: timeline com trilhas de vídeo, áudio e legenda, preview sincronizado, arrastar mídia, mover, aparar, dividir (S), copiar, colar e duplicar, propriedades do clipe (tempo, velocidade, posição, escala, rotação, opacidade, volume e fades).

## 0.1.2

Quando algo dá errado, o app mostra o erro com um botão para copiar os detalhes, em vez de ficar com a tela vazia. Erros também ficam registrados no arquivo erros.log.

## 0.1.1

Atualização automática: o AMV Studio agora avisa quando há versão nova e se atualiza com um clique.

## 0.1.0

Primeira versão: projetos, importação de mídia com proxies, miniaturas e forma de onda, mídia ausente e relocalização, salvamento automático.
