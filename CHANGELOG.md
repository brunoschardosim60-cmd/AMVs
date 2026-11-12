# Novidades

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
