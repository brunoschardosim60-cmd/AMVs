# Melhorias do gerador de AMV — diagnóstico e pendências

## Feito neste patch
1. **Trechos vazios (preto)** — `packages/automv/src/generate.ts`: `rescueSlot` escolhe cena de reserva quando o planejador devolve `null` ou o score rejeita a cena. Teste: `sem buracos na timeline` (falhava antes: só 6 clips para 60 s).
2. **Letras** — linhas que cruzam impacto são deslocadas (`lyricEnd`/`a`) em vez de omitidas. Teste: `letra longa que cruza o drop...`.
3. **Efeitos** — `slowPushCurve` + pulso leve em energia 0,5–0,8. Teste: `movimento contínuo`.
4. **Qualidade** — proxy 720p/CRF 23 (`media/src/args.ts`), `lanczos` em `args.ts` e `render/src/video.ts`.

## Pendente (não feito, precisa do app rodando)
- **Letra automática**: hoje só entra letra importada (.lrc/.srt). O Whisper já existe em `SubtitlesPanel.tsx` (`transcribeAsset`); falta um botão "Transcrever da música" no `GenerateDialog.tsx`. Cantado, o Whisper erra bastante: preferir buscar LRC.
- **Validar com mídia real**: toda a validação até aqui é com mídia sintética (ver `docs/LIMITATIONS.md`). Gerar 2–3 AMVs de episódios reais e conferir preto, letras e efeitos no export.
- **Paridade preview x export** dos efeitos no WebView2 (também em `LIMITATIONS.md`).
- **Cenas `escura`** continuam excluídas do pool; com pouco material isso encolhe a variedade. Considerar penalizar em vez de excluir.

## Observação
O `dip_black` automático já era raro (só `cinematic`/`discurso`, cena calma, ≤ 0,2 s desde a 0.6.19), então não é a causa principal do preto.