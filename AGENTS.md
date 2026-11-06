# AGENTS.md — AMV Studio

Este arquivo é lido no início de TODA sessão de desenvolvimento. Ele define o produto, a arquitetura travada, as regras e o protocolo de trabalho. Não altere decisões marcadas como **[TRAVADO]** sem registrar o motivo em `docs/DECISIONS.md`.

---

## 1. Produto em uma frase

App desktop para criar Anime Music Videos: o usuário importa episódios e uma música, escolhe o estilo, e pode editar tudo manualmente numa timeline multipista ou pedir para a IA gerar uma primeira montagem — que vira clipes comuns, 100% editáveis, na mesma timeline.

Ao redor do editor existem três módulos integrados (§11): um **assistente de IA** que entende comandos em português e propõe mudanças aprováveis, um **Music Hub** para buscar, ouvir e escolher músicas, e um **Translation Studio** para transcrever, traduzir e legendar.

**A IA é o editor assistente. O usuário é o diretor.**

Princípios:
1. O editor funciona inteiro sem IA. IA é uma camada opcional por cima.
2. Tudo que a IA gera vira dado normal do projeto (clipes, marcadores, keyframes). Não existe "montagem caixa-preta".
3. Toda decisão automática guarda uma justificativa legível (`reason`) e uma confiança (`confidence`).
4. Arquivos originais nunca são modificados.
5. O que o preview mostra é o que a exportação entrega (ver §4.4).

---

## 2. Stack **[TRAVADO]**

| Camada | Escolha |
|---|---|
| Shell desktop | **Tauri 2** (Rust mínimo: janela, diálogo de arquivos, spawn de sidecars, asset protocol) |
| UI | React + TypeScript (strict) + Vite + Tailwind |
| Estado | Zustand (ou equivalente) com **sistema de comandos** para undo/redo |
| Validação do projeto | Zod — schema único compartilhado |
| Mídia | **FFmpeg + FFprobe empacotados como sidecar** (não depender de FFmpeg do sistema) |
| Backend de análise | **Python sidecar** (FastAPI em `127.0.0.1`, porta aleatória, token por sessão) |
| Banco local | SQLite (biblioteca, cache, jobs). O projeto em si é um arquivo JSON |
| Testes | Vitest (TS), pytest (Python), Playwright para fluxos da UI, testes de render com FFmpeg real |
| CI | GitHub Actions com runner **Windows** (alvo principal) |

Alvo principal: **Windows 10/11 com WebView2**. macOS/Linux depois, sem bloquear a arquitetura.

### Layout do repositório

```
/apps/desktop          # Tauri + React
  /src-tauri           # Rust: comandos mínimos, sidecars, permissões
  /src
    /editor            # timeline, preview, comandos, store
    /features          # home, wizard, biblioteca, export, music-hub, translation, assistant, ai-settings
    /ui                # design system
/packages/project      # schema Zod do projeto, migrações, tipos, comandos puros (sem React)
/packages/render       # project.json -> grafo de render -> argumentos FFmpeg (puro, testável)
/packages/assistant    # ferramentas do assistente, adaptadores de provedores de LLM, ChangeSet (puro)
/packages/music        # interface MusicProvider + provedores (local, YouTube, Spotify, catálogos)
/packages/subtitles    # parse/serialização SRT/ASS/LRC, modelo de legenda (puro)
/services/analyzer     # Python: jobs de análise (cenas, áudio, fala, transcrição, tradução, IA)
/docs                  # STATUS.md, DECISIONS.md, ARCHITECTURE.md, LIMITATIONS.md
/fixtures              # mídia de teste pequena GERADA por script (nunca anime real)
```

Os pacotes em `/packages` não importam React nem Tauri. São lógica pura e são onde ficam a maior parte dos testes.

---

## 3. Riscos técnicos conhecidos (leia antes de projetar qualquer coisa)

1. **WebView2 não toca MKV e não toca HEVC/H.265 de forma confiável.** Anime costuma vir em MKV, HEVC, 10-bit, às vezes VFR. → O preview **nunca** usa o arquivo original. Todo vídeo importado gera um **proxy** H.264 8-bit `yuv420p`, CFR, resolução reduzida (ex.: 540p/720p), GOP curto (keyframe a cada ~0,5 s) para seek rápido. Áudio do proxy em AAC.
2. **`<video>.currentTime` não é preciso quadro a quadro.** → O tempo do projeto é a fonte da verdade; o preview é "melhor esforço". Para pausa/scrub, buscar o quadro exato via thumbnail/frame extraído pelo FFmpeg quando necessário. Avaliar WebCodecs numa fase posterior, não na Fase 1.
3. **VFR (taxa de quadros variável).** → Detectar no FFprobe (comparar `r_frame_rate` e `avg_frame_rate`, ou contar quadros). Proxies e render normalizam para CFR. Registrar no metadado do asset.
4. **Tempo em float acumula erro.** → Todo tempo no projeto é **inteiro em microssegundos** (`us`). Conversão para frames só na borda (UI e render), usando o FPS do projeto como racional (`30000/1001`, não `29.97`).
5. **Divergência preview × exportação** dos efeitos. → Cada efeito é definido uma vez numa spec (§4.4) com duas implementações (WebGL e filtro FFmpeg) e teste de paridade.
6. **Análise pesada em CPU** (Demucs, Whisper, CLIP) pode levar minutos por episódio. → Tudo é job em background, cancelável, com progresso real, resultado em cache por hash do arquivo + versão do modelo.
7. **Arquivos grandes.** Episódios de 1–4 GB. → Nunca ler arquivo inteiro na memória, nem no JS nem no Python. Acesso via FFmpeg/streams e asset protocol do Tauri com range requests.
8. **Streaming não vira mídia do projeto.** Música do YouTube ou do Spotify só pode ser **ouvida** pelos players/SDKs oficiais; não é possível (nem permitido) extrair o áudio para a timeline ou para a exportação. → No app, faixa de streaming é "referência". Para usar no AMV, o usuário importa um arquivo que possui. A UI deixa essa diferença explícita.
9. **Players oficiais dentro do Tauri podem não funcionar.** Hipóteses a verificar no primeiro dia da fase do Music Hub: o embed do YouTube pode recusar a origem `tauri://`/`http://tauri.localhost` (exige referer/origem válida); o Spotify Web Playback SDK exige conta Premium e DRM (Widevine), que o WebView2 provavelmente não oferece; endpoints do Spotify de *audio features* e *recommendations* foram restritos para apps novos. → Fazer um spike de 1 dia, registrar resultado em `DECISIONS.md` e, se não funcionar, cair para: metadados + busca via API oficial e botão "abrir no app/site do provedor". Nunca contornar com scraping ou extração.
10. **LLM não mexe no projeto diretamente.** → O assistente só lê por ferramentas e só propõe mudanças como `ChangeSet` (lista de `Command`s), que o usuário aprova (§11.1).

---

## 4. Arquitetura do núcleo

### 4.1 Modelo do projeto (`packages/project`)

Arquivo `.amvproj` = JSON versionado (`schemaVersion`) + pasta de cache ao lado. Esboço:

```ts
Project {
  schemaVersion: number
  id, name, createdAt, updatedAt
  settings: { width, height, fps: { num, den }, sampleRate, background }
  assets: Asset[]            // referência ao original, nunca cópia
  tracks: Track[]            // kind: 'video' | 'audio' | 'text', ordem, locked, hidden, muted
  clips: Clip[]              // ver abaixo
  markers: Marker[]          // beat, downbeat, section, speech, scene, user
  analysis: AnalysisRef[]    // resultados de IA/algoritmos, com versão do modelo
  versions: VersionRef[]     // alternativas geradas (Auto AMV)
}

Asset { id, path, hash (parcial: tamanho + primeiros/últimos MB), kind, probe: {...}, proxyPath?, status: 'ok'|'missing'|'processing' }

Clip {
  id, trackId, assetId?,      // texto não tem asset
  timelineStartUs, durationUs,
  sourceInUs, sourceOutUs,
  speed,                      // 1.0 = normal; speed ramp via keyframes
  transform: { x, y, scale, rotation, opacity, crop },
  audio: { gainDb, fadeInUs, fadeOutUs, pitchSemitones },
  effects: EffectInstance[],
  transitionIn?: TransitionInstance,
  keyframes: Record<paramPath, Keyframe[]>,
  origin: 'user' | 'ai',
  reason?: string, confidence?: number
}
```

Regras:
- **Toda mutação é um `Command`** puro (`apply(project) → project`, `invert`). Undo/redo, histórico, autosave e "aplicar sugestão da IA" usam o mesmo mecanismo.
- **Migrações**: toda mudança de schema incrementa `schemaVersion` e adiciona uma migração com teste.
- Ao abrir: validar com Zod, rodar migrações, checar existência dos assets; ausentes ficam `missing` e o usuário pode relocalizar (casando por hash).
- Autosave a cada N segundos e a cada comando, em arquivo temporário + rename atômico. Arquivo de recuperação após crash.

### 4.2 Jobs e sidecars

- O frontend nunca chama FFmpeg diretamente. Ele pede um job (`probe`, `proxy`, `thumbnails`, `waveform`, `render`, `analyze:*`).
- Fila com prioridade (probe > thumbnails > waveform > proxy > análise), limite de concorrência, cancelamento real (matar processo), progresso real (parse de `-progress pipe:1` do FFmpeg).
- Resultados em cache em `<cache>/<assetHash>/<tipo>-<versão>`.
- O sidecar Python é opcional: se não subir, o app funciona sem IA e mostra o motivo.

### 4.3 Waveform e miniaturas

- Waveform: FFmpeg decodifica para PCM mono em baixa taxa → Python/TS calcula picos (min/max por bucket) em **vários níveis de zoom** → arquivo binário em cache. A timeline desenha em `<canvas>`, nunca em DOM por amostra.
- Miniaturas: strip de thumbnails por asset em cache, geradas sob demanda pelo zoom.

### 4.4 Preview e render — fonte única de verdade

`packages/render` converte o projeto em um **grafo de render** intermediário (lista de segmentos, camadas, efeitos com parâmetros resolvidos por tempo). Esse grafo tem dois consumidores:

1. **Preview**: compositor em Canvas/WebGL que lê o grafo e desenha a partir dos `<video>` dos proxies.
2. **Exportação**: gerador de `filter_complex` do FFmpeg que lê o mesmo grafo e usa os arquivos **originais**.

Cada efeito/transição é registrado assim:

```ts
EffectSpec {
  id: 'zoom_in', params: ParamSchema,
  webgl: (ctx, params, t) => void,
  ffmpeg: (params, t0, t1) => string   // trecho de filtergraph
  parityTolerance: number              // SSIM mínimo aceito
}
```

Efeito que não tem as duas implementações **não entra** na biblioteca (ou entra marcado "só exportação" com aviso visível).

Teste de paridade: renderizar quadros-chave via FFmpeg e via preview headless, comparar SSIM.

---

## 5. Camada de análise e IA (`services/analyzer`)

Cada módulo é independente, desligável, com interface fixa e saída com `confidence`. Os nomes de bibliotecas abaixo são **candidatos a avaliar** — verificar versão, licença e compatibilidade com Windows antes de adotar, e registrar em `DECISIONS.md`.

| Módulo | Sem IA (padrão) | Com IA (opcional) |
|---|---|---|
| Cortes de cena | PySceneDetect (ContentDetector/AdaptiveDetector) | — |
| Intensidade visual | diferença entre quadros / fluxo óptico em baixa resolução | — |
| Batidas e BPM | librosa (onset, beat_track) | modelos de beat tracking mais precisos (ex.: família Beat This) |
| Estrutura da música (intro, refrão, drop) | energia RMS + novidade espectral + segmentação | modelos de estrutura musical |
| Fala / gritos / silêncio | VAD (ex.: Silero) + energia | faster-whisper com timestamps por palavra |
| Separação voz/música | — | Demucs (lento em CPU: avisar estimativa de tempo) |
| Tipo de cena (luta, explosão, emoção) | heurísticas de movimento/brilho | zero-shot com CLIP/SigLIP em quadros amostrados |
| Personagens | — | detecção de rosto de anime + embeddings + **agrupamento**; o usuário dá nome aos grupos. Nunca afirmar identidade. |
| Justificativas em texto | templates | LLM local opcional (ex.: via Ollama) |

Regras:
- Amostrar quadros (ex.: 2–4 fps em baixa resolução), nunca processar todos os quadros.
- Nada é enviado para serviço externo sem opt-in explícito por projeto.
- Resultado incerto aparece como incerto na UI (badge de confiança), nunca como fato.

### 5.1 Auto AMV — algoritmo determinístico primeiro

O "GERAR MEU AMV" é um problema de **atribuição com restrições**, não um prompt para LLM:

1. Música → seções com rótulo e energia, beats e downbeats.
2. Cenas → segmentos com `intensity`, `type`, `hasSpeech`, `characters`, duração útil.
3. Para cada seção, definir ritmo de corte (ex.: intro = 2–4 compassos por corte, refrão = 1 compasso, drop = 1–2 beats) conforme estilo e intensidade escolhidos.
4. Pontuar cada par (slot da música, trecho de cena) por compatibilidade de energia, tipo pedido pelo estilo, variedade (penalizar repetição e cenas vizinhas), cenas obrigatórias/excluídas.
5. Resolver por guloso com backtracking ou programação dinâmica. Cortes sempre em beat/downbeat.
6. Regra especial do drop: procurar fala/grito marcante para os ~1–3 s antes do drop; inserir na trilha de vozes; criar keyframes de ducking na música; colocar o trecho de maior impacto exatamente no drop.
7. Saída = lista de `Command`s aplicados numa **nova versão** do projeto. Cada clipe recebe `origin: 'ai'` e `reason` (ex.: "Drop em 01:12 — cena de intensidade 0.91, golpe detectado").
8. "Regerar só esta parte" = rodar o mesmo algoritmo restrito a um intervalo, mantendo o resto travado.

Parâmetros do algoritmo ficam num arquivo de configuração por estilo (Luta, Épico, Romântico…), editável e testável.

### 5.2 Recomendação de músicas

Ver §11.4 (Smart Music Discovery). Resumo: a recomendação com dados reais de BPM, energia e estrutura funciona sobre a **biblioteca local**; provedores de streaming entram como busca e referência.

---

## 6. Interface

Identidade própria, escura, cinematográfica: grafite/cinza profundo, roxo e azul como acento, bordas sutis, tipografia moderna, animações curtas. Parecer software de edição, não painel administrativo. Sem cards gigantes, sem gradiente exagerado, sem botão decorativo.

Layout do editor: mídia/biblioteca à esquerda, preview ao centro, propriedades à direita, timeline embaixo. Painéis redimensionáveis, layout salvo por usuário.

Navegação global (shell do app, sempre presente):
- Barra lateral fina com: Início, Editor, Biblioteca, Music Hub, Translation Studio, Configurações de IA.
- **Barra de player persistente** no rodapé do shell: continua tocando ao trocar de tela. Pausa automaticamente quando o preview do editor começa a tocar (um áudio por vez).
- **Painel do assistente** recolhível à direita, disponível em todas as telas, com contexto da tela atual.
- Tudo numa janela só; nada abre janela externa, exceto o login OAuth de provedores (que exige o navegador do sistema).

Atalhos configuráveis (Espaço, S, Delete, Ctrl+Z/Ctrl+Shift+Z, Ctrl+C/V/D, setas quadro a quadro, Home/End). Atalhos ficam ativos só quando o foco está no editor, não em campos de texto.

Todo botão visível funciona. Funcionalidade ainda não implementada **não aparece** (ou aparece desabilitada com tooltip "em breve" — nunca com comportamento falso).

---

## 7. Direitos autorais

- O app não baixa episódios nem músicas.
- O usuário importa o que possui ou tem permissão de usar.
- Aviso de direitos autorais no assistente de exportação/publicação.
- Streaming: só reprodução pelos players oficiais, respeitando termos, login e região. Sem download, sem gravação do áudio, sem scraping.
- Letras de músicas: exibidas só quando vêm de provedor licenciado com API ou de arquivo/texto fornecido pelo próprio usuário (`.lrc`, `.txt`, colado). O app não busca letras em sites sem licença nem as armazena em cache compartilhado.
- `/fixtures` contém apenas mídia sintética gerada por script (barras de cor, tons, ruído, fala sintetizada). Nunca commitar trechos de anime ou música comercial no repositório.

---

## 8. Fases e critérios de pronto

Cada fase só termina quando **todos** os critérios passam em teste automatizado ou checklist manual registrada em `docs/STATUS.md`.

**Fase 1 — Fundação**
- Repo no layout do §2, CI verde no Windows, sidecar FFmpeg/FFprobe empacotado e executando.
- Tela inicial: novo projeto, abrir, recentes (com miniatura, data, duração).
- Importar MP4/MOV/MKV/WEBM/MP3/WAV/FLAC/PNG/JPG; mostrar duração, resolução, FPS (incluindo aviso de VFR), codec, tamanho.
- Gerar proxy, thumbnails e waveform em background com progresso real e cancelamento.
- Salvar e reabrir projeto com resultado idêntico (teste de round-trip). Asset ausente → relocalizar.

**Fase 2 — Editor**
- Timeline multipista com zoom, régua, playhead, snapping (bordas de clipe, marcadores, playhead).
- Mover, aparar, dividir, copiar, colar, duplicar, excluir, multisseleção, travar/ocultar/silenciar trilha.
- Preview sincronizado com a timeline usando proxies.
- Painel de propriedades com transformações e volume.
- Undo/redo de todos os comandos; autosave; recuperação após crash.

**Fase 3 — Processamento**
- Gerador de `filter_complex` a partir do grafo; exportar MP4 H.264 + AAC.
- Teste: projeto sintético conhecido → arquivo exportado com duração, número de quadros e cortes nos tempos esperados (verificado com FFprobe + detecção de cena no resultado).
- Primeiros efeitos com paridade preview/export: fade, cross dissolve, flash branco, zoom, shake.
- Mixer: ganho, fades, ducking por keyframe.

**Fase 4 — Análise**
- Beats/BPM, seções, cortes de cena, VAD — sem IA pesada.
- Marcadores na timeline, editáveis.
- Módulos com IA atrás de checagem de instalação e toggle global "desativar IA".

**Fase 5 — Auto AMV**
- Algoritmo do §5.1 gerando nova versão editável com `reason` por clipe.
- Cenas obrigatórias/excluídas, duração alvo, regenerar intervalo.

**Fase 6 — Central de IA + Assistente** (§11.1, §11.2)
- Central de modelos: provedores, chaves no cofre do sistema, teste de conexão, módulos liga/desliga.
- Assistente com ferramentas de leitura e de proposta (`ChangeSet`), prévia visual, aprovação, undo em um passo.
- Suíte de testes do assistente com LLM simulado (respostas gravadas) — determinística, roda no CI.

**Fase 7 — Music Hub** (§11.3, §11.4)
- Biblioteca musical local com player persistente, playlists, favoritos, histórico, fila, BPM/energia da análise.
- Spike de YouTube e Spotify (risco §3.9) → integrar o que funcionar oficialmente; documentar o que não funcionar.
- Recomendação contextual com justificativa.

**Fase 8 — Translation Studio** (§11.5)
- Transcrição + detecção de idioma, tradução, editor lado a lado, SRT/ASS/LRC importar/exportar, legendas na timeline com paridade preview/export.

**Fase 9 — Integração e polimento**
- Fluxo completo do §11.6 funcionando ponta a ponta.
- Mais efeitos/presets, H.265/ProRes quando o FFmpeg empacotado suportar, 1440p/4K, perfis de exportação, performance.

---

## 9. Protocolo de cada sessão

1. Ler `AGENTS.md`, `docs/STATUS.md` e `docs/DECISIONS.md`.
2. Escolher **uma** tarefa da fase atual em `STATUS.md`.
3. Implementar com testes. Rodar a suíte relevante e o app.
4. Commits pequenos, mensagem em português, prefixo convencional (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`).
5. Atualizar `STATUS.md` (feito / em andamento / pendente / bloqueado) e registrar limitações em `LIMITATIONS.md`.
6. Nunca marcar como feito algo que não foi executado e testado. Se um teste foi pulado, dizer qual e por quê.

## 10. Regras inegociáveis

- Sem botões falsos, processamento simulado, timeline decorativa ou dados fictícios apresentados como reais.
- Não esconder erros: erro de FFmpeg/Python aparece para o usuário com mensagem útil e log completo acessível.
- Não modificar arquivos originais.
- Não tornar a IA obrigatória nem limitar o usuário à edição da IA.
- Não reescrever módulos inteiros sem necessidade; preferir mudanças incrementais.
- Não adicionar dependência nova sem anotar em `DECISIONS.md` (motivo, licença, tamanho).

---

## 11. Ecossistema integrado — Assistente, Música e Tradução

Três módulos ao redor do editor, compartilhando o mesmo projeto e o mesmo contexto. Nenhum deles é obrigatório: o editor continua funcionando com todos desligados ou offline.

### 11.1 AI Assistant

Painel lateral persistente (§6), conversa em português, histórico salvo por projeto em `<projeto>.amvproj.d/assistant/` (fora do JSON do projeto, para não inchar o arquivo).

**Contexto enviado ao modelo** — um resumo compacto gerado a cada turno, nunca o JSON inteiro:
- tela atual e seleção (clipes, intervalo, marcador);
- resumo da timeline (trilhas, clipes com tempo/origem/`reason`, seções da música);
- música atual (BPM, seções, drop) e cenas disponíveis (top N por relevância);
- o resto é buscado sob demanda pelas ferramentas.

**Ferramentas** (`packages/assistant`, tipadas com Zod, mesmas usadas por testes):

| Tipo | Exemplos | Efeito |
|---|---|---|
| Leitura | `get_timeline`, `get_selection`, `find_scenes(filtro)`, `get_music_analysis`, `list_assets`, `search_music(filtro)` | nenhum |
| Análise | `analyze_pacing`, `find_weak_points` (cortes fora do beat, cenas repetidas, trechos longos sem corte, picos de volume) | nenhum; retorna achados com tempo e motivo |
| Proposta | `propose_change(...)`, `propose_replace_scene`, `propose_retime_cuts(ritmo)`, `propose_add_effect(beat)`, `propose_move_clip_before(marker)` | retorna um **`ChangeSet`** |
| Externa | `translate_text`, `transcribe_range` | delega ao Translation Studio |

**`ChangeSet`** = lista de `Command`s (§4.1) + descrição + `reason` por item. Fluxo:
1. O assistente propõe; nada muda no projeto.
2. A UI mostra a prévia: diff na timeline (clipes fantasma em outra cor) e lista legível ("mover fala 'Eu não vou perder' para 01:10,4 — 1,6 s antes do drop").
3. O usuário aprova tudo, aprova parte ou recusa.
4. Aplicado como **um único grupo de undo**, com `origin: 'ai'`.

O assistente nunca altera o projeto sem esse fluxo. Não existe ferramenta de escrita direta.

Comandos que precisam funcionar (viram casos de teste): "deixe os cortes mais rápidos", "coloque essa fala antes do drop", "encontre outra cena para esse trecho", "adicione um efeito de câmera nessa batida", "traduza essa frase", "encontre uma música mais agressiva", "analise meu AMV e encontre pontos fracos". Referências como "essa", "esse trecho" e "nessa batida" se resolvem pela seleção e pelo playhead.

### 11.2 Central de IA e modelos

Tela de configurações onde cada **função** escolhe seu provedor/modelo de forma independente:

| Função | Local (padrão quando disponível) | Externo (opcional) |
|---|---|---|
| Conversa (assistente) | Ollama | provedores compatíveis com API de chat + tool calling |
| Análise de vídeo | modelos do §5 | — (vídeo não sai do computador sem opt-in explícito) |
| Análise de áudio | modelos do §5 | — |
| Transcrição | faster-whisper | APIs de transcrição |
| Tradução | LLM local ou modelo de tradução local | APIs de tradução |
| Recomendação musical | algoritmo + análise local | LLM para justificativa |

Requisitos:
- Adaptador por provedor atrás de uma interface única (`chat`, `toolCall`, `stream`, `countTokens`, `listModels`, `healthCheck`).
- **API keys no cofre do sistema** (Windows Credential Manager via crate de keyring no Tauri). Nunca em JSON, `localStorage`, log ou projeto.
- Botão "testar conexão" com resultado real; status por módulo (disponível / não instalado / sem chave / erro).
- Consumo: tokens contados por chamada e custo **estimado** a partir de uma tabela de preços editável pelo usuário (preços mudam; não embutir como verdade).
- Toggle global "desativar IA" e toggle "permitir envio para serviços externos" (desligado por padrão).
- Modelo local ausente → explicar como instalar; nunca travar o app.

### 11.3 Music Hub

Tela no estilo de app de streaming (busca, capas, listas), com identidade do AMV Studio.

Arquitetura: interface `MusicProvider` em `packages/music`:

```ts
MusicProvider {
  id, name, capabilities: { search, play, metadata, preview, importable }
  search(query, filters) / getTrack(id) / getPlaybackHandle(id)
  requiresAuth, authenticate()
}
```

Provedores, em ordem de implementação:
1. **Local** — arquivos do usuário. Único com `importable: true` garantido. Recebe BPM, energia e seções da análise (§5).
2. **Bibliotecas livres/licenciadas** — só as que tiverem API oficial e licença explícita para uso em vídeo; a licença de cada faixa aparece na tela e é gravada no asset ao importar.
3. **YouTube** — busca via API oficial (chave do usuário), reprodução via player oficial embutido, se o spike do risco §3.9 passar. `importable: false`.
4. **Spotify** — busca e metadados via API oficial com login OAuth (PKCE); reprodução só se o SDK funcionar no WebView2, senão "abrir no Spotify". `importable: false`.

Funções da tela: busca com filtros (gênero, emoção, intensidade, BPM, duração), player integrado, fila, playlists, favoritos, histórico, página de artista/álbum quando o provedor fornecer.

BPM e intensidade só aparecem quando vierem de **análise real** do arquivo local ou de campo oficial do provedor. Para faixas de streaming sem esses dados, mostrar "não disponível" — nunca estimar e exibir como fato.

Ligação com a timeline: faixa local → "usar no projeto" adiciona na trilha de música; "ouvir este trecho na timeline" posiciona o player no trecho correspondente. Faixa de streaming → "salvar como referência" e aviso de que é preciso importar o arquivo para usá-la.

### 11.4 Smart Music Discovery

Pontuação, não adivinhação:
- Entrada: estilo e intensidade escolhidos, duração alvo, perfil das cenas analisadas (intensidade média, picos, quantidade de luta/emoção), anime/personagens informados pelo usuário.
- Para faixas locais: casa curva de energia da música com curva de intensidade das cenas, BPM compatível com o ritmo de corte do estilo (§5.1), existência e posição do drop, duração.
- Categorias (luta, épica, romântica, emocional, sombria, motivacional, clímax, cinematográfica) são **filtros sobre esses atributos**, configuráveis por arquivo, não listas fixas de músicas.
- Justificativa sempre derivada dos dados ("drop em 1:08, energia sobe 40% no pré-refrão, 140 BPM combina com cortes de 2 beats"). LLM pode reescrever em linguagem natural, nunca inventar atributo.
- Streaming: recomendação limitada a busca por gênero/termos e ao que a API oficial fornecer; marcar como "sugestão sem análise de áudio".

### 11.5 Translation Studio

Pipeline:
1. **Transcrição + idioma**: faster-whisper com timestamps por palavra sobre o áudio de um asset ou de um intervalo (com separação de voz opcional antes).
2. **Tradução**: segmento a segmento, com contexto (falas vizinhas, glossário de nomes do anime definido pelo usuário para não traduzir nomes próprios e golpes).
3. **Editor lado a lado**: original × tradução, edição manual, ajuste de tempos arrastando, marcação "revisado".
4. **Arquivos**: importar/exportar SRT, ASS e LRC (`packages/subtitles`, com teste de round-trip). ASS preserva estilos.
5. **Timeline**: legendas viram clipes de texto numa trilha de legendas. Preview e exportação usam o **mesmo renderizador ASS** (libass no FFmpeg; no preview, libass compilado para WebAssembly) para paridade.

Para músicas: letras só das fontes do §7. Original e tradução lado a lado, sincronizadas quando houver `.lrc` ou transcrição. "Explicar significado" e "sugerir frases curtas para o AMV" via LLM, sobre o texto que o usuário forneceu.

### 11.6 Fluxo integrado (teste de aceitação ponta a ponta)

1. Importar episódio → análise em background.
2. Music Hub recomenda faixas locais com justificativa; usuário ouve no player persistente e escolhe.
3. Translation Studio mostra a letra/tradução disponível e transcreve as falas do episódio.
4. Assistente lista os melhores momentos (usando análise de cenas e falas).
5. "GERAR MEU AMV" cria nova versão (§5.1).
6. Timeline com todos os elementos editáveis; usuário pede ajustes ao assistente (via `ChangeSet`) e edita à mão.
7. Exportar.

Esse fluxo vira um teste automatizado com fixtures sintéticas e LLM simulado, mais um roteiro manual com mídia real do usuário (fora do repositório).

### 11.7 Regras do ecossistema

- Nenhuma tela de provedor sem integração real: se um provedor não está configurado ou o spike falhou, ele não aparece (ou aparece como "não configurado", com o motivo).
- Toda chamada externa é visível num log de atividade da Central de IA (o quê, para quem, quando, tamanho), sem conteúdo de chaves.
- Falha de rede ou de provedor nunca trava o editor nem corrompe o projeto.
