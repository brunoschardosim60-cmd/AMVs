# Novidades

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
