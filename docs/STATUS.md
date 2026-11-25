# Status do Projeto — AMV Studio (v0.7.0)

| Área | Status | Observações |
|---|---|---|
| Tipografia Pro (`Anton`, `Bebas Neue`, `Cinzel`, `Montserrat`, 3D, Hero Word, RGB Split, Sheen, Depth Text) | **Estável** | Fontes embutidas no app; Preview e Exportação usam o mesmo renderizador Canvas. |
| Cortes, Auto-Reframe Anime, `zoom_through`, Overscan de Shake e Velocity suave | **Estável** | Detector local `subjectFocus` + pan dinâmico, reserva de OP/ED e `minterpolate` seletivo em slow-motion. |
| Falas limpas (`voiceIsolation`, `echoTail`) e Sincronia Percussiva/Vocal | **Estável** | Isolamento central + eco pré-drop no FFmpeg, ponderação percussiva em `music.ts` e pré-filtro vocal no Whisper. |
| Recorte de Personagem + Letra Atrás (`V2` + `behindCutout`) | **Estável** | Funciona de imediato via matting local (Python/Canvas) e acelera automaticamente via ONNX DirectML GPU se houver modelo `.onnx` em `models/`. |
| Instalador Windows (Tauri NSIS `currentUser`) | **Estável** | Pasta única em `%LOCALAPPDATA%\AMV Studio`, sobrescrevendo ao atualizar. |
| Preview interativo no Windows (WebView2) | **Pendente de teste manual** | Seguir roteiro em [TESTE_MANUAL_WINDOWS.md](./TESTE_MANUAL_WINDOWS.md). |
| Visão semântica por LLM externo | **Opcional** | Sem chave configurada, o app opera 100% offline com `local-vision` (`subjectFocus`, movimento e cor). |
