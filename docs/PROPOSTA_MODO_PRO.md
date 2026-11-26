# Proposta — Agrupamento de Recursos Avançados ("Modo Pro")

> **Status:** APENAS PROPOSTA (Fase 4). **Não implementar na UI sem aprovação explícita do usuário.** Nenhum recurso existente seria removido; apenas a superfície inicial ficaria enxuta.

---

## 1. Problema atual

Ao longo das versões `0.7.x`–`0.9.x`, diversos controles especializados foram expostos simultaneamente na barra do Preview, nos cabeçalhos da Timeline, no painel de Legendas, no Inspector e no diálogo `Gerar meu AMV`. Para quem só quer cumprir o fluxo principal (**importar música → importar episódio → gerar → ajustar cortes → exportar**), o excesso de botões concorrentes aumenta a carga cognitiva e a chance de cliques acidentais.

---

## 2. Fluxo Essencial (sempre visível por padrão)

Mantém 100% da operação direta em até 4 passos claros:

1. **Mídia:** importar música(s) e episódio(s), ver status do proxy/análise e arrastar para a timeline.
2. **Gerar meu AMV (visão compacta):**
   - Escolha de **Música** (e trecho sugerido), **Episódios**, **Estilo** (ou `Modo Livre` em 1 clique) e **Letra opcional** (colar/importar).
   - Botão principal **Gerar meu AMV**.
3. **Editar (Timeline + Preview + Inspector essencial):**
   - Reproduzir/pausar, cortar (`S`), mover/aparar clipes, desfazer/refazer, trocar trecho de cena, editar texto/estilo de legenda na tela e ajustar volume.
4. **Exportar:** escolher preset (`1080p MP4`, `9:16 Vertical`, `4K`) e exportar.

---

## 3. O que passaria para trás da chave `Modo Pro`

Um único seletor persistido nas preferências locais da UI (`uiMode: 'essencial' | 'pro'`, padrão `'essencial'`, alternável no topo do editor sem recarregar o projeto). Projetos que já contenham camadas avançadas (`V2`, automações, efeitos) continuam reproduzindo e exportando **exatamente igual** nos dois modos — o modo controla apenas a exibição dos painéis/ações avançadas:

| Recurso avançado | Onde aparece hoje | Comportamento proposto |
|---|---|---|
| **Raio-X ao vivo (HUD no Preview)** | Botão `Raio-X` na barra superior do Preview (`Preview.tsx`) | Visível apenas no `Modo Pro` (desligado por padrão em ambos os modos). |
| **Central de Leitura e Diagnóstico 5D** | Diálogo `Qualidade` / `Harmonizar` em lote (`QualityDialog.tsx`) | No modo essencial, exibe apenas um indicador simples (`Pronto para exportar` ou `N avisos — corrigir em 1 clique`); o detalhamento das 5 dimensões e cobertura técnica abre no `Modo Pro`. |
| **Torneio multi-candidato detalhado** | Placar de sementes/candidatos e controles finos de direção/ênfase em `GenerateDialog.tsx` | No modo essencial, o gerador roda com os padrões recomendados e aplica o vencedor; comparação manual de candidatos, semente (`seed`), perfis criativos customizados e direção editorial ficam numa gaveta `Opções Pro`. |
| **Recorte manual de personagem em `V2` + `Atrás V2`** | Botões `Recortar V2` e `Atrás V2` na barra flutuante do Preview e no Inspector (`cutout.ts`) | A geração automática continua usando destaque em `V2` quando apropriado; os controles manuais de recorte/máscara (`subject-focus`, `manga-slash`, `behindCutout`) aparecem no `Modo Pro`. |
| **Solo / Audition por clipe (`O`) e Solo por trilha** | Barra flutuante do Preview, barra rápida da Timeline e cabeçalhos de trilha | Atalho de teclado permanece ativo para usuários avançados; botões dedicados de `Ouvir cena` / `Solo` aparecem no `Modo Pro` (mantendo `Mudo` visível sempre). |
| **Isolamento vocal (`voiceIsolation`), cauda de eco (`echoTail`) e edição sílaba a sílaba** | Seções avançadas de Áudio e Texto no `Inspector.tsx` e fatia rápida no `SubtitlesPanel.tsx` | Agrupados em subpainel recolhido `Áudio/Tipografia Pro`, visível quando `Modo Pro` está ligado (ou quando o clipe selecionado já possui o parâmetro ativo). |

---

## 4. Código experimental sem uso no instalador

- **Segmentação de vídeo por SAM 2 (`services/analyzer/amv_analyzer/segmentation.py`):**
  - **Estado atual:** marcado no servidor do sidecar (`server.py`) com `experimental: true` e **não** empacotado com checkpoints no instalador NSIS Windows (que usa matting local em `cutout.py` / `cutout.ts` ou modelos leves `.onnx` opcionais colocados pelo usuário em `models/`).
  - **Tratamento recomendado:** manter explicitamente documentado como experimental em `docs/LIMITATIONS.md` (sem expor botão de SAM 2 na UI) e, caso não seja retomado após a validação real da Fase 2, mover `segmentation.py` e seus testes para `experimental/sam2/` numa rodada específica aprovada.

---

## 5. Decisão pendente do usuário

1. Aprovar ou ajustar a divisão **Essencial × Modo Pro** da tabela acima?
2. O padrão inicial para instalações existentes deve ser `'essencial'` (com aviso único indicando onde ligar o `Modo Pro`) ou `'pro'`?
