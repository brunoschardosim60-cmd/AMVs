# Roadmap — AMV Studio

> Documento único e consolidado de prioridades do projeto (substitui os antigos `MELHORIAS-AMV*.md` e roadmaps duplicados).

## Entregue até v0.6.31

- **Montagem automática orientada por música e narrativa:** detecção de batidas, drops, pausas, andamento variável (`tempoVariable`) e compasso (`3/4`, `4/4`, `6/8`).
- **Auto-reparo pós-geração:** correção automática (até 2 passadas) de saltos de luminosidade, micro-cortes `< 180 ms` e sobreposição de legendas na revisão criativa.
- **Anti-repetição e cor preservada:** subdivisão de planos longos em trechos não sobrepostos, rastreamento de intervalos usados e preservação de cores vivas em lutas (sem vinheta escura desnecessária).
- **Falas em voiceover + diferenciação visual:** narração por cima dos cortes musicais (`voiceover` / `hybrid` / `scene`) e diferenciação automática entre letra da música e legenda de fala quando ambas aparecem no mesmo AMV.
- **Tipografia com prévia ao vivo e tradução rápida:** prévia visual de estilos no modal, tradução gratuita em lote paralelo com cache em disco (`translate-cache.json`) e botão **Auto-sync** para alinhar legendas às batidas.
- **Edição direta na timeline:** barra rápida no clipe selecionado (`TimelineQuickEditBar`) e modal de troca/modificação (`TimelineClipModifyModal`).
- **Instalador único no Windows:** NSIS `currentUser` em `%LOCALAPPDATA%\AMV Studio`, sobrescrevendo a mesma pasta a cada atualização.

## Próximos marcos

1. **Validação real de visão (LLM multimodal):** testar classificação de personagem/emoção com modelo real (OpenAI / Gemini / Ollama) em cenas reais de anime e medir precisão.
2. **Verificação manual completa no Windows WebView2:** executar integralmente o checklist de [TESTE_MANUAL_WINDOWS.md](./TESTE_MANUAL_WINDOWS.md) em uma instalação limpa.
3. **Separação vocal (Demucs) opcional:** facilitar alinhamento de letra em músicas com instrumental pesado.
4. **Recorte de personagem (experimental):** manter fora do instalador até existir um modelo de segmentação em anime aprovado em qualidade e desempenho (benchmarks arquivados em `docs/archive/`).
