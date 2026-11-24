# Status do Projeto — AMV Studio (v0.6.31)

| Área | Status | Observações |
|---|---|---|
| Editor de timeline (corte, edição rápida, undo/redo, exportação FFmpeg) | **Estável** | Testado por suítes automatizadas (`@amv/project`, `@amv/render`, `@amv/desktop`). |
| Análise musical (`@amv/analysis`) | **Estável** | Detecta BPM, batidas, drops, pausas, andamento variável (`tempoVariable`) e compasso (`3/4`, `4/4`, `6/8`). |
| Geração automática de AMV (`@amv/automv`) | **Estável** | Inclui subdivisão de planos longos, diferenciação entre letra e fala, preservação de cor em lutas e auto-reparo pós-geração. |
| Legendas, letras e tradução (`@amv/subtitles`, `@amv/assistant`) | **Estável** | Tradução gratuita em lote paralelo com cache em memória e disco (`translate-cache.json`); alinhamento por Whisper com `vad_filter=False` e botão **Auto-sync** nas batidas. |
| Instalador Windows (Tauri NSIS) | **Estável** | Apenas NSIS `currentUser` (`%LOCALAPPDATA%\AMV Studio`); atualizações substituem a mesma pasta sem duplicar instalações. |
| Visão semântica (personagem / emoção) | **Parcial** | Pipeline e prompts testados com mocks; ainda pendente validação sistemática com modelo de visão real. |
| Preview interativo no Windows (WebView2) | **Pendente de teste manual** | Coberto por build/typecheck/CI, mas reprodução de vídeo/áudio e codecs reais dependem do checklist em [TESTE_MANUAL_WINDOWS.md](./TESTE_MANUAL_WINDOWS.md). |
| Recorte de personagem (SAM2) | **Experimental / Arquivado** | Código permanece apenas como protótipo marcado com `experimental: true` no analyzer e **não** entra no instalador. |
