# Integração das melhorias do Auto AMV

## Implementado nesta rodada

1. **Cobertura da timeline:** slots sem escolha tentam uma cena de reserva, usando o histórico de seleção e o score existente. O fallback não ignora o limite de fonte de 0,6×. Se não existir plano com duração suficiente, o slot permanece vazio e o app avisa em vez de puxar frames da próxima cena.
2. **Letras em impactos:** uma linha que cruza um impacto pode terminar antes dele ou começar após a janela. Quando há espaço, linhas curtas são estendidas até 0,9 s, sem passar do próximo cue ou de outro impacto. Timing de palavras continua vindo exclusivamente da fonte.
3. **Movimento suave:** planos longos sem keyframes de impacto recebem push-in/pull-out discreto alternado. Planos curtos, drops e keyframes já existentes não recebem movimento redundante.
4. **Alinhamento de frames:** fronteiras dos slots são quantizadas pela taxa racional do projeto; fronteiras compartilhadas usam o mesmo arredondamento.
5. **Qualidade da cena:** o score penaliza brilho muito baixo, superexposição e quase ausência de movimento em trechos musicais intensos.
6. **Cenas escuras:** a tag escura separa cenas para uma reserva. Elas só são usadas se não houver material normal elegível. Cenas utilizáveis mas escuras recebem uma correção moderada de exposição/sombras com efeitos ligados.
7. **Cor por energia:** contraste/saturação ou vinheta sutis são aplicados somente quando o estilo/perfil não oferece grade de cor.
8. **Volume das falas:** a análise registra dB RMS aproximado (percentil 90) por fala. A geração corrige o ganho em até ±4 dB. É uma primeira compensação relativa, não normalização LUFS e não garantia contra clipping.
9. **Render:** filtros de escala final usam Lanczos. O proxy segue em 540p/CRF 26 para não aumentar o custo de CPU e armazenamento durante a edição.

## Testes adicionados

- Fallback de cena sem extrapolar a duração da fonte.
- Letra deslocada após impacto e duração mínima de leitura.
- Ganho de voz limitado e compatibilidade com análises antigas.
- Movimento automático apenas com efeitos ligados.
- Snap de cortes a 30 fps com BPM 138.
- Reserva de cenas escuras e fallback quando todo o material é escuro.
- Penalidades de brilho/movimento no score.
- Estimativa de nível de fala com e sem legendas.

## Não declarar como validado ainda

- Execução das suítes no CI / máquina local após os commits.
- Render de AMVs com episódios reais autorizados.
- Inspeção no Windows/WebView2 e paridade entre preview e export.
- Escuta comparativa das falas e medição de true peak após mix.
- A reserva pode introduzir repetição ou salto narrativo; os avisos precisam ser revisados no editor.

## Itens deliberadamente não aplicados

- **Proxy 720p/CRF 23:** não foi adotado como padrão. A mudança aumenta pixels, tempo de geração e armazenamento; o proxy é para fluidez do preview, enquanto o render final recebeu o filtro Lanczos.
- **Forçar cena curta:** não foi adotado. Um fallback que desativa a validação de duração pode fazer o source range invadir outro plano e recriar o defeito corrigido na rodada anterior.
