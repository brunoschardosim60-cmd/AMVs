# Status

Fase atual: **1 — Fundação** — concluída. CI verde no Windows (FFmpeg 9.0.2, 50 testes TS + 3 Python, instalador gerado). Falta só o teste manual no PC do Bruno.

## Fase 1 — Fundação

| Item | Estado | Como foi verificado |
|---|---|---|
| Monorepo (pnpm), TS strict, Vitest, pytest | feito | `pnpm typecheck`, `pnpm test` |
| Modelo do projeto: schema v1, µs inteiros, FPS racional | feito | testes `packages/project` |
| Comandos com inverso, histórico undo/redo, transações | feito | testes: todo comando + inverso = original; batch atômico; projeto nunca mutado |
| Salvar/abrir com round-trip idêntico, migrações, erros claros | feito | testes de serialização |
| FFmpeg/FFprobe como sidecar do Tauri | feito | app real rodando no Linux (Xvfb) processou mídia pelo sidecar; Windows: CI baixa build GPL do BtbN com checksum |
| Probe: MP4/MOV/MKV/WEBM/MP3/WAV/FLAC/PNG/JPG, VFR, 10-bit, capa de MP3, idiomas | feito | testes com FFmpeg real em fixtures sintéticas |
| Proxy H.264 8-bit CFR, GOP ~0,5 s, progresso real, cancelamento | feito | teste mede intervalo de keyframes; cancelar não deixa arquivo pela metade |
| Pôster, folha de miniaturas (com fallback HEVC), waveform multinível | feito | testes; waveform acha os 16 cliques de 120 BPM |
| Fila de jobs: prioridade, concorrência, cancelamento, dedupe | feito | testes |
| Cache por hash parcial; reabrir não reprocessa | feito | teste de sessão |
| Tela inicial: novo, abrir, continuar, recentes, favoritos | feito | captura de tela do app real |
| Importação (botão, Ctrl+I, arrastar e soltar) com metadados e avisos | feito | captura de tela do app real; testes de sessão |
| Mídia ausente: aviso, localizar arquivo (confere hash), procurar numa pasta | feito | testes de sessão + captura de tela |
| Autosave a cada 30 s e recuperação após queda | feito | teste de sessão |
| Atalhos: Ctrl+N/O/S/Shift+S/I/Z/Shift+Z/Y; bloqueio de atalhos do navegador | feito | código; verificação manual pendente no Windows |
| Aviso ao fechar com alterações não salvas | feito | código; verificação manual pendente no Windows |
| Sidecar Python opcional (esqueleto: saúde, módulos, token) | feito | pytest |
| CI no Windows: testes + instalador NSIS/MSI | feito | run 42305866809 verde; o 1º run pegou uma diferença do FFmpeg 9 nas miniaturas de HEVC, já corrigida |

### Pendente de verificação no Windows
- Reprodução do proxy no painel de detalhes (WebView2). No Linux de desenvolvimento não dá para testar: o WebKitGTK não toca mídia pelo protocolo de arquivos do Tauri.
- Diálogos nativos de abrir/salvar e o arrastar e soltar no Explorer.

## Distribuição
| Item | Estado | Como foi verificado |
|---|---|---|
| Atualização automática (plugin updater, assinatura minisign) | feito | Release v0.1.1 publicada com `latest.json` e `.sig` |
| Publicar versão: `node scripts/release.mjs x.y.z --push` (branch `release`) | feito | workflow Release verde |

## Fase 2 — Editor (em andamento)

| Item | Estado | Como foi verificado |
|---|---|---|
| Operações: inserir, dividir, aparar, mover em grupo com sobrescrita, excluir (com/sem fechar buraco), copiar/colar/duplicar, encaixe | feito | 18 testes em `packages/project/test/edit.test.ts` |
| Timeline: régua, trilhas, travar/ocultar/silenciar, zoom (Ctrl+roda, botões, "ajustar tudo"), miniaturas e forma de onda nos clipes | feito | app real no Linux (Xvfb) |
| Arrastar mídia da biblioteca para a timeline (eventos de ponteiro, não HTML5 DnD) | feito | app real; bug de clipe duplicado achado e corrigido |
| Arrastar clipes (entre trilhas do mesmo tipo), aparar pelas bordas, encaixe com linha guia | feito | app real |
| Preview: player sincronizado com proxies, composição em canvas (posição, escala, rotação, opacidade, recorte, texto) | feito | Chromium headless com vídeo de tempo gravado: quadro certo em 3 posições, incluindo tocando |
| Painel de propriedades: tempo, velocidade, deslizar origem, transformar, volume e fades | feito | app real |
| Atalhos: Espaço, S, Delete (Shift = fechar buraco), Ctrl+C/X/V/D/A, setas (Shift = 10 quadros), Home/End, +/− | feito | app real (parcial) |
| Preview de vídeo no Windows (WebView2) | pendente | depende do teste do Bruno |

### Limitações da Fase 2
- Volume acima de 0 dB e escolha da faixa de áudio (episódios com japonês/português) chegam com o mixer na Fase 3: o preview usa a primeira faixa do proxy.
- Adicionar texto pela interface ainda não existe (o preview já desenha clipes de texto).
