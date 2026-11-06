# AGENTS.md — AMV Studio

Este arquivo é lido no início de TODA sessão de desenvolvimento. Ele define o produto, a arquitetura travada, as regras e o protocolo de trabalho. Não altere decisões marcadas como **[TRAVADO]** sem registrar o motivo em `docs/DECISIONS.md`.

---

## 1. Produto em uma frase

App desktop para criar Anime Music Videos: o usuário importa episódios e uma música, escolhe o estilo, e pode editar tudo manualmente numa timeline multipista ou pedir para a IA gerar uma primeira montagem — que vira clipes comuns, 100% editáveis, na mesma timeline.

Ao redor do editor existem três módulos integrados (§11):
- **Assistente de IA**: entende comandos em português, responde sobre o clipe selecionado, propõe mudanças com prévia exata, comparação A/B e aprovação parcial, e aprende o estilo do usuário (com controle para desativar).
- **Music Hub**: biblioteca local forte para importar, ouvir, organizar por gênero, emoção, BPM e intensidade, comparar e escolher músicas sem sair do app.
- **Translation Studio**: importar letras e legendas, transcrever, sincronizar, traduzir e editar.

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
- **Biblioteca musical local completa** (§11.3 "Biblioteca local"): importar arquivos/pastas, tags, análise automática, organizar, filtros, player persistente, detalhe da faixa e modo comparação. Ela vem aqui, e não na fase do Music Hub, porque depende só da análise de áudio e é usada pelo Auto AMV.

**Fase 5 — Auto AMV**
- Algoritmo do §5.1 gerando nova versão editável com `reason` por clipe.
- Cenas obrigatórias/excluídas, duração alvo, regenerar intervalo.

**Fase 6 — Central de IA + Assistente** (§11.1, §11.2)
- Central de modelos: provedores, chaves no cofre do sistema, teste de conexão, módulos liga/desliga.
- Assistente com ferramentas de leitura e de proposta (`ChangeSet`).
- Prévia exata (adicionado/removido/movido/alterado), comparação A/B (lado a lado e alternada), aprovação parcial com dependências e revalidação, undo em um passo.
- Chat contextual: "Perguntar à IA" em clipe, marcador, intervalo e faixa.
- Memória criativa (§11.8) com a tela "O que a IA aprendeu" e o interruptor para desativar.
- Suíte de testes do assistente com LLM simulado (respostas gravadas) — determinística, roda no CI.

**Fase 7 — Music Hub** (§11.3, §11.4)
- Tela completa do Music Hub sobre a biblioteca local já pronta (playlists, histórico, fila, busca).
- Spike de YouTube e Spotify (risco §3.9) → integrar o que funcionar oficialmente; documentar o que não funcionar.
- Recomendação contextual com justificativa.

**Fase 8 — Translation Studio** (§11.5)
- Importar SRT/ASS/VTT/LRC/TXT com detecção de codificação; exportar nos mesmos formatos e ASS bilíngue.
- Sincronização: alinhamento automático com confiança por linha, modo toque, offset/esticar, ajuste fino na mini-timeline.
- Transcrição + detecção de idioma, tradução com glossário, editor lado a lado com versões por linha, legendas na timeline com paridade preview/export.

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

**`ChangeSet`** = lista de itens; cada item tem `Command`s (§4.1), `kind` (`add` | `remove` | `move` | `modify`), `reason`, `dependsOn: itemId[]` e o `baseVersion` do projeto em que foi gerado. O assistente nunca altera o projeto fora desse fluxo. Não existe ferramenta de escrita direta.

#### Prévia exata das alterações

Antes de qualquer aprovação, a tela de revisão mostra **tudo** que vai mudar:
- **Na timeline**, sobre a edição atual: adicionados em verde (clipes fantasma), removidos em vermelho riscado, movidos com seta da posição antiga para a nova, alterados com contorno amarelo.
- **Na lista de revisão**, um item por mudança, em linguagem clara e com valores exatos: "Adicionar *Golpe final* em V1, 01:12,0–01:13,2", "Remover clipe 14 (00:42,1–00:43,6)", "Mover fala *Eu não vou perder* de 00:58,3 para 01:10,4", "Volume da música: −6 dB → −14 dB entre 01:10,4 e 01:12,0".
- Resumo no topo: "3 adicionados · 1 removido · 2 movidos · 4 alterados".
- Clicar num item leva o playhead até ele e destaca o clipe.

#### Comparação A/B

- A proposta é aplicada numa **cópia em memória** do projeto (comandos são puros, então é barato). O projeto real não muda.
- **Modo lado a lado**: dois previews sincronizados no mesmo playhead — A (atual) e B (proposta) —, em resolução reduzida para caber no desempenho. Áudio de um lado por vez, com troca por tecla.
- **Modo alternado** (para PCs mais fracos): um preview só, com tecla para alternar A/B no mesmo instante.
- Botão "tocar só os trechos alterados": monta um loop com as regiões afetadas, com 2 s de margem antes e depois.

#### Aprovação parcial

- Cada item tem caixa de seleção; também dá para aceitar ou recusar por trilha ou por tipo ("aceitar só os cortes", "recusar todos os efeitos").
- **Dependências são respeitadas**: desmarcar um item desmarca os que dependem dele, explicando o motivo ("o efeito 7 é aplicado no clipe adicionado no item 3"). Nada aplica um comando órfão.
- Antes de aplicar, o subconjunto escolhido é **revalidado** (sem sobreposições ilegais, clipes dentro da mídia de origem). Se algo ficou inválido, mostrar e não aplicar.
- A prévia e o A/B se atualizam em tempo real conforme as seleções.
- Se o projeto mudou desde que a proposta foi gerada (`baseVersion` diferente), reaplicar sobre a versão atual quando não houver conflito; havendo conflito, marcar os itens afetados e oferecer "pedir nova proposta".
- O que for aplicado vira **um único grupo de undo**, com `origin: 'ai'`. Itens aceitos e recusados ficam registrados para a memória criativa (§11.8).

#### Chat contextual

- Clique direito em clipe, marcador, seleção de intervalo ou faixa da biblioteca → **"Perguntar à IA"**. O painel abre com um chip anexado ao campo de mensagem ("Clipe 14 · V1 · 00:42,1–00:43,6"), que pode ser removido.
- O contexto do chip inclui: propriedades do clipe, trecho de origem e análise da cena, clipes vizinhos, seção da música e beats naquele tempo, falas no intervalo. Com modelo multimodal, também quadros do clipe — enviados para serviço externo só com a permissão do §11.2 ligada.
- Perguntas como "como posso melhorar essa cena?" recebem resposta com diagnóstico concreto (corte 0,3 s depois do beat, cena repetida aos 00:31, cena de intensidade baixa num refrão) e terminam com propostas clicáveis, que viram `ChangeSet` com o fluxo acima.

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

Funções gerais da tela: busca com filtros (gênero, emoção, intensidade, BPM, duração), player integrado, fila, playlists, favoritos, histórico, página de artista/álbum quando o provedor fornecer.

#### Biblioteca local — prioridade do Music Hub

É a parte mais importante do Music Hub e precisa funcionar muito bem antes de qualquer provedor de streaming.

**Importar**
- Arquivos soltos, pastas inteiras (recursivo) e arrastar e soltar. **Pastas monitoradas** opcionais detectam músicas novas sozinhas.
- Formatos: MP3, WAV, FLAC, M4A/AAC, OGG/Opus.
- Ler tags embutidas (título, artista, álbum, gênero, ano, capa).
- Referência ao arquivo original, sem copiar. Duplicatas detectadas por hash. Arquivo movido → relocalizar como nos projetos.

**Analisar** (automático, em background, com cache — §4.2 e §5)
- BPM com confiança, beats/downbeats, curva de energia, seções (intro, verso, refrão, drop, final), posição do drop, loudness, presença de voz, duração.
- **Intensidade** = número derivado da curva de energia (real, reproduzível).
- **Emoção**: etiqueta do usuário. Pode haver sugestão automática, sempre marcada como sugestão e com confiança; nunca vira dado sem o usuário confirmar.
- Estado visível por faixa: "na fila", "analisando 40%", "pronta", "erro (ver log)".

**Organizar**
- Gênero, emoção, tags livres, favoritos, nota (1–5), observações, playlists e coleções por projeto ("músicas candidatas do AMV X").
- Editar vários de uma vez (selecionar 20 faixas → marcar "épica").
- Colunas: "usada em quais projetos" e "data de importação".

**Encontrar**
- Filtros combináveis: faixa de BPM, faixa de intensidade, emoção, gênero, tags, duração, "tem drop", favoritas, não usadas ainda.
- Ordenar por qualquer coluna. Visão em lista (tabela) e em grade (capas).
- Desempenho com milhares de faixas: lista virtualizada e índices no SQLite.

**Ouvir**
- Player persistente (§6) com fila, sem sair do app.
- Detalhe da faixa: waveform com seções e drop marcados, curva de energia, clicar numa seção para tocar dali, loop de seção.

**Comparar e escolher**
- Selecionar de 2 a 4 faixas → **modo comparação**: curvas de energia lado a lado (alinhadas pelo início ou pelo drop), BPM, seções, duração e pontuação de compatibilidade com o projeto atual (§11.4).
- Audição A/B: pular para a mesma seção em cada faixa ("ouvir o drop de cada uma") com uma tecla.
- "Escolher para o projeto" coloca a faixa na trilha de música e já traz os marcadores de beats e seções.

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
4. **Arquivos**: importar/exportar (`packages/subtitles`, com teste de round-trip para cada formato).
5. **Timeline**: legendas viram clipes de texto numa trilha de legendas. Preview e exportação usam o **mesmo renderizador ASS** (libass no FFmpeg; no preview, libass compilado para WebAssembly) para paridade.

#### Importar letras e legendas

- Formatos: **SRT, ASS/SSA, VTT, LRC** (incluindo LRC com tempo por palavra), **TXT** (letra sem tempo) e texto colado.
- Detectar a codificação do arquivo (UTF-8, UTF-8 com BOM, Shift-JIS, Windows-1252 — legendas de anime vêm em todas essas) e mostrar uma prévia antes de confirmar.
- ASS: preservar estilos, posições e efeitos de karaokê ao importar e exportar.
- Uma legenda/letra importada fica ligada a um asset (episódio ou música). Pode haver várias por asset (idiomas, versões).

#### Sincronizar

- **Alinhamento automático** de texto sem tempo (letra em TXT): transcrever com timestamps por palavra (com separação de voz antes, para música), casar o texto conhecido com o reconhecido e gerar tempos por linha. Cada linha recebe confiança; as de confiança baixa ficam destacadas para revisão.
- **Modo toque**: tocar o áudio e apertar uma tecla no início de cada linha (outra no fim, opcional), com opção de reduzir a velocidade da reprodução.
- **Ajuste global**: deslocar tudo (offset) e esticar/comprimir (corrige legendas feitas para outra taxa de quadros, como 23,976 × 25).
- **Ajuste fino**: arrastar início e fim de cada linha numa mini-timeline com waveform, com snapping para início de voz e beats; deslocar linhas selecionadas.

#### Editar traduções

- Original e tradução lado a lado, linha a linha, tocando o trecho ao selecionar a linha.
- Mais de uma versão por linha (ex.: "literal" e "adaptada para AMV"), escolhendo qual vai para a timeline.
- Glossário do projeto (nomes, golpes, termos que não se traduzem), aplicado na tradução automática.
- Avisos de legibilidade: caracteres por segundo, linhas longas, sobreposição de tempos.
- Marcação de linha "revisada"; tradução automática nunca sobrescreve linha revisada.
- Exportar: SRT/VTT por idioma, LRC, ASS bilíngue (dois estilos) e "queimar" na exportação do vídeo.

Para músicas: letras só das fontes do §7. Original e tradução lado a lado, sincronizadas e acompanhando a reprodução. "Explicar significado" e "sugerir frases curtas para o AMV" via LLM, sobre o texto que o usuário forneceu.

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

### 11.8 Memória criativa

A IA aprende o estilo do usuário a partir do que ele **faz**, não de adivinhação. É estatística local e transparente, não treinamento de modelo.

**O que é observado** (eventos gravados localmente, em SQLite):
- itens de `ChangeSet` aceitos e recusados, por tipo (corte, efeito, transição, troca de cena, música);
- edições manuais feitas logo depois de uma montagem da IA (ex.: encurtou os clipes do drop → prefere cortes mais rápidos ali);
- músicas escolhidas e descartadas (BPM, intensidade, gênero, emoção);
- efeitos e transições usados, com frequência e parâmetros;
- duração média de clipe por seção da música e por estilo.

**O que é derivado** — preferências legíveis, cada uma com quantidade de evidências:
- "Em drops de AMVs de luta, prefere cortes de 2 beats (18 edições)";
- "Raramente aceita glitch (aceitou 1 de 9)";
- "Escolhe músicas entre 130 e 150 BPM com drop antes de 1:20 (7 escolhas)".

Uma preferência só passa a valer depois de um mínimo de evidências (configurável, padrão 5). O cálculo é determinístico e tem testes.

**Onde é usada**
- Ajusta os pesos e os parâmetros padrão do Auto AMV (§5.1) e a pontuação de músicas (§11.4).
- Entra como um resumo curto no contexto do assistente.
- Toda proposta influenciada por ela diz isso no `reason` ("cortes de 2 beats — sua preferência em drops de luta").

**Controle do usuário** (tela "O que a IA aprendeu")
- Ver todas as preferências em linguagem simples, com as evidências.
- Editar, desativar ou apagar cada uma; "esquecer tudo".
- Interruptor geral para **desativar** a memória criativa (para de registrar e para de usar).
- Opção por projeto: "não aprender com este projeto".
- Fica só no computador. O resumo só vai para um LLM externo se a permissão de envio externo (§11.2) estiver ligada.
