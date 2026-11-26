# Status do Projeto — AMV Studio (v0.9.5)

| Área | Status | Evidência / Observações |
|---|---|---|
| Núcleo do projeto, histórico undo/redo e persistência atômica (`@amv/project`, `session.ts`) | **Estável (validado com mídia sintética)** | Schema Zod versionado, migrações, autosave, recuperação e proteção contra corrida em undo/redo de importação. |
| Pipeline de mídia e proxies (`@amv/media`) | **Estável (validado com mídia sintética + FFmpeg real)** | Probe, pôster, tira de miniaturas, waveform multi-nível e proxy H.264 CFR com GOP curto. |
| Preview interativo no editor (`player.ts`, `Preview.tsx`, `textLayer.ts`) | **Aguardando confirmação em mídia real** | Pool limitado abaixo do teto de conexões do WebView2, sprites de texto pré-aquecidos e proteção contra auto-seek. Seguir [VALIDACAO_REAL.md](./VALIDACAO_REAL.md) e [TESTE_MANUAL_WINDOWS.md](./TESTE_MANUAL_WINDOWS.md). |
| Gerador automático e avaliação técnica (`@amv/automv`) | **Estável em suíte sintética; correlação humana pendente** | Torneio multi-candidato, auto-reparo, leitura audiovisual e blindagem contra `NaN`/listas vazias. Correlação humana pendente em [VALIDACAO_REAL.md](./VALIDACAO_REAL.md). |
| Tipografia e legendas (`@amv/subtitles`, `textLayer.ts`, `rasterizeText.ts`) | **Estável (validado com mídia sintética)** | Fontes locais embutidas, estilos anime, alinhamento de letras, tradução com cache e exportação PNG/sequência. |
| Exportação FFmpeg (`@amv/render`) | **Estável (validado com mídia sintética + FFmpeg real)** | H.264, H.265 e ProRes, mesclagem RGBA, ducking de voz, `voiceIsolation`, `echoTail` e verificação pós-render. |
| Sidecar Python (`services/analyzer`) | **Opcional com fallback local** | Transcrição Whisper e recorte `/cutout/frame` degradam para caminhos locais em caso de indisponibilidade, cancelamento ou timeout. |
| Instalador Windows (Tauri NSIS `currentUser`) | **Configurado em CI** | Instalação em pasta única em `%LOCALAPPDATA%\AMV Studio`. |
