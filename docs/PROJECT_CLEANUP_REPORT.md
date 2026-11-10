# Relatório de organização e limpeza do AMV Studio

**Inventário realizado em:** 2026-11-09
**Repositório:** raiz atual do checkout Git (`AMVs-work`, branch `main`)
**Commit observado:** `61eeb49`

## Resultado

A raiz atual do repositório já é a pasta mestre solicitada. O monorepo tem separação funcional adequada e os caminhos Tauri, workspace pnpm e sidecar Python dependem dessa estrutura. Não foi necessário criar um segundo checkout, mover código ou inventar pastas vazias.

Esta execução foi deliberadamente não destrutiva: nenhum arquivo foi removido ou movido, nenhuma dependência foi instalada e nenhum ambiente foi alterado. O inventário e a simulação de limpeza foram documentados; os itens que poderiam liberar espaço aguardam aprovação.

## Estrutura anterior e organização adotada

Estrutura observada:

```text
AMVs-work/                   # checkout Git e pasta mestre
  .github/                   # CI e release
  apps/desktop/               # React, Vite e Tauri
    src-tauri/                # Rust, configuração, sidecars e ícones
    dev/                      # harness local e E2E
  packages/                   # lógica TypeScript pura por domínio
  services/analyzer/          # sidecar Python, testes e empacotamento
  fixtures/                   # mídia sintética gerada para testes
  docs/                       # estado, decisões, limitações e relatórios
  scripts/                    # geração de fixtures e obtenção de FFmpeg
  package.json, pnpm-lock.yaml, pnpm-workspace.yaml
  node_modules/               # dependências regeneráveis, ignoradas pelo Git
```

Mapeamento para as categorias propostas:

| Categoria conceitual | Localização atual | Ação |
|---|---|---|
| `app/` | `apps/desktop/` | Manter: nome e localização fazem parte da configuração do monorepo. |
| `backend/` | `services/analyzer/` | Manter: usado pelo empacotamento Python e pela configuração Tauri. |
| `runtime/`, `models/` | Não há runtime/modelos de produção no checkout. O runtime de avaliação está fora dele. | Não criar diretórios vazios nem mover modelos de teste para o produto. |
| `assets/` | Ícones em `apps/desktop/src-tauri/icons/`, fontes por dependência npm e fixtures sintéticas em `fixtures/`. | Manter junto dos consumidores atuais. |
| `projects/` | Projetos do usuário são arquivos `.amvproj` escolhidos pelo usuário. | Não armazenar projetos pessoais no repositório. |
| `docs/` | `docs/` | Já centralizado. |
| `tests/` | `test/` e `tests/` junto a cada pacote/serviço. | Manter co-localizado com o código que valida. |
| `scripts/` | `scripts/` e scripts de desenvolvimento em `apps/desktop/dev/`. | Manter: mover o harness separaria seus caminhos e dependências. |
| `build/` | Saídas ficam nos locais convencionais `dist/`, `target/` e `services/analyzer/build/`. | Geradas localmente/CI; não centralizar sem alterar configurações de build. |
| `cache/`, `backups/` | Cache e recuperação são escolhidos por projeto/usuário em tempo de execução. | Não direcionar cache ou backups de usuários ao checkout. |

O diretório raiz é chamado `AMVs-work` nesta máquina, mas não é necessário renomeá-lo para que o projeto funcione. Os caminhos de código são relativos ao repositório; nenhum caminho absoluto desta máquina foi introduzido.

## Inventário e classificação

Classificação:

1. **NECESSÁRIO** — manter.
2. **NECESSÁRIO, MAS DESORGANIZADO** — reorganizar somente se referências/consumidores forem atualizados com segurança.
3. **OPCIONAL** — manter separado do produto.
4. **OBSOLETO** — possível remoção somente após verificação e aprovação.
5. **DESCONHECIDO** — não remover até esclarecer uso e propriedade.

| Item | Localização observada | Classificação | Evidência / decisão |
|---|---|---:|---|
| Código desktop, Tauri e workflows | `apps/desktop/`, `.github/` | 1 | Fonte do app, permissões, sidecars e CI/release. |
| Pacotes TypeScript | `packages/` | 1 | Workspace compartilhado; importado pelo desktop e testado individualmente. |
| Analisador Python e testes | `services/analyzer/` | 1 | Tem configuração de dependências e script de empacotamento; Tauri aponta para seu recurso empacotado. |
| `pnpm-lock.yaml`, manifests e `Cargo.lock` | raiz, workspace e `apps/desktop/src-tauri/` | 1 | Reprodutibilidade do frontend e Rust. |
| `node_modules/` | raiz do checkout, ignorado | 3 | ~150,73 MiB medidos; reproduzível pelo lockfile, mas necessário para builds/testes atuais. Candidato de limpeza sujeito a aprovação. |
| FFmpeg e FFprobe Windows | `apps/desktop/src-tauri/binaries/`, ignorado | 1 | Dois sidecars, ~316,14 MiB. Tauri declara ambos como `externalBin`; script `scripts/fetch-ffmpeg.mjs` os baixa/recria. Não remover ou mover: builds locais atuais dependem deles. |
| Fixtures geradas | `fixtures/generated/`, ignoradas | 1 | ~2,82 MiB; mídia sintética usada pelos testes e regenerável por `pnpm fixtures`. Manter para testes locais por enquanto. |
| Relatórios e comparativos | `docs/` | 1/3 | Relatórios SAM2 e SkyTNT registram validações diferentes; não são duplicatas. Imagens sintéticas do benchmark somam menos de 1 MB. |
| Clone oficial SkyTNT e ambientes do estudo | `%USERPROFILE%\\Videos\\AMV-SAM2-Quality\\runtime\\` | 3 | Clone Git limpo (`55d8740`), dois ambientes Python e modelos. Recursos de avaliação; não pertencem ao runtime do app. Preservar. |
| Vídeo e áudio originais do usuário | `%USERPROFILE%\\Videos\\AMV-SAM2-Quality\\` | 3 | Aproximadamente 393,7 MiB combinados. Dados pessoais/de teste únicos; não mover nem apagar. |
| Resultados visuais de avaliação | `%USERPROFILE%\\Videos\\AMV-SAM2-Quality\\resultados\\` | 3 | 178 arquivos, ~217 MiB. Evidências únicas; não apagar. |
| Pesos de teste ISNet/SAM2 e ONNX | `%USERPROFILE%\\Videos\\AMV-SAM2-Quality\\runtime\\models\\` | 3 | Inclui `isnetis.ckpt`, `sam2.1_hiera_tiny.pt` e `skytnt_isnetis.onnx`. Não estão no pacote de produção. Checkpoint ISNet tem SHA-256 oficial confirmado no inventário anterior. Preservar. |
| Cache Hugging Face | `%USERPROFILE%\\.cache\\huggingface\\` | 3/5 | ~486 MB observados, contendo `Systran/faster-whisper-small`. Pode ser utilizado pelo fluxo de transcrição; cache de modelo, preservar. |
| Cache global uv | `%LOCALAPPDATA%\\uv\\` | 5 | ~2,84 GB observados. Cache compartilhado; não foi provado que os pacotes sejam exclusivos do AMV Studio. Não limpar. |
| Cache de downloads uv | `%APPDATA%\\uv\\` | 5 | ~117 MB observados; pode conter runtimes Python compartilhados. Não limpar. |
| Python 3.14 e 3.12 | instalações de usuário do Windows e uv | 5 | Disponíveis no host, sem evidência suficiente para atribuir cada instalação apenas ao AMV Studio. Não mover. |
| Node/Corepack | `C:\\Program Files\\nodejs\\` | 5 | Instalação compartilhada do sistema. Não mover. O `pnpm@10.28.0` é selecionado via Corepack pelo `packageManager`. |
| Rust/Cargo | não encontrados no PATH | 5 | `Cargo.lock` existe, mas `cargo`/`rustc`/`rustup` não foram encontrados. Compilação Tauri local não validada neste host. Não instalar sem solicitação. |

Não foi confirmada dependência npm não utilizada nem duplicata removível. O código e a dependência opcional SAM2 continuam no repositório como protótipo. A configuração de empacotamento foi separada para não incluir SAM2/PyTorch/checkpoint na distribuição; nenhum arquivo de modelo ou ambiente existente foi apagado.

## Recursos externos relacionados

Foi inspecionado apenas o diretório de testes conhecido, sem varrer indiscriminadamente pastas pessoais:

| Localização | Conteúdo resumido | Tamanho observado | Tratamento |
|---|---|---:|---|
| `%USERPROFILE%\\Videos\\AMV-SAM2-Quality\\` | Originais, resultados, clone do código SkyTNT, dois ambientes Python e pesos. | ~2,87 GiB (3,08 GB decimais) | Preservar; não centralizar em `models/` do produto nem duplicar arquivos grandes. |
| `%USERPROFILE%\\.cache\\huggingface\\` | Cache `faster-whisper-small`. | ~463,7 MiB (486 MB decimais) | Preservar; o cache pode ser consumido por transcrição. |
| `%LOCALAPPDATA%\\uv\\` e `%APPDATA%\\uv\\` | Cache/runtime de ferramenta Python compartilhada. | ~2,96 GiB | Não atribuído ao produto com segurança; não alterar. |
| `%USERPROFILE%\\.local\\bin\\uv.exe` | Executável do gerenciador uv. | Ferramenta externa | Compartilhada pelo usuário; não mover. |
| `%USERPROFILE%\\AppData\\Local\\Python\\` e `%APPDATA%\\uv\\python\\` | Python 3.14 e CPython 3.12.13. | Instalações externas | Não mover; o projeto declara Python `>=3.11`. |

O clone e ambientes de `AMV-SAM2-Quality` são infraestrutura de experimento, não dependências de inicialização do app. Os arquivos originais e resultados não foram abertos/alterados nesta limpeza.

## Dependências centralizadas e versões

O frontend usa o workspace pnpm e o lockfile na raiz. `pnpm-lock.yaml` e `Cargo.lock` estão versionados; `node_modules/` e os binários FFmpeg são saídas locais ignoradas pelo Git. Python usa `pyproject.toml` com grupos opcionais, sem lockfile Python dedicado no checkout.

O inventário de versões diretas e limites declarados está em [DEPENDENCY_INVENTORY.md](./DEPENDENCY_INVENTORY.md).

## Simulação de limpeza — nenhuma exclusão executada

| Candidato | Espaço potencial observado | Reconstruível? | Risco / decisão |
|---|---:|---|---|
| `node_modules/` | ~150,73 MiB | Sim, com Node/Corepack e lockfile. | Remover interrompe builds/testes até reinstalar; aguarda aprovação explícita. |
| FFmpeg/FFprobe sidecars | ~316,14 MiB | Sim, pelo script e release externa checksum-verified. | Necessários a testes e desenvolvimento local; não remover nesta limpeza. |
| `fixtures/generated/` | ~2,82 MiB | Sim, pelo gerador versionado. | Testes usam esses arquivos; manter até prova de geração no setup padrão. |
| Ambientes Python de avaliação | dentro dos ~2,27 GiB do runtime experimental | Parcialmente, mas requer recriar versões/pesos e condições de avaliação. | Tem dados e ambientes especializados; não remover nem centralizar. |
| `resultados/`, originais e pesos de avaliação | ~217 MiB de resultados; ~393,7 MiB de mídia e pesos adicionais | Não plenamente; resultados e originais são únicos. | Preservar sem exceção. |
| Cache de modelo/uv | ~3,42 GiB combinados em áreas de usuário | Alguns itens baixáveis, outros compartilhados. | Não é possível atribuir propriedade/uso exclusivo. Não limpar. |

**Espaço liberado nesta execução: 0 bytes.** Nenhum arquivo foi removido. A medição do checkout inteiro antes da documentação foi ~501.476.009 bytes (478,2 MiB; inclui `.git`, dependências ignoradas e FFmpeg); como não houve remoção, a diferença esperada após esta etapa é zero, acrescida apenas dos dois documentos de inventário.

## Verificações

- Git: `main` estava sincronizada com `origin/main`, sem alterações locais antes do inventário; histórico preservado.
- Conteúdo versionado: 230 arquivos; `.git` ~2,73 MiB; nenhum segundo repositório criado.
- FFmpeg/FFprobe: binários locais presentes e executáveis; versão reportada `n9.0.2-48-gd4070a14ce-20261108`.
- Dependências Node: `pnpm@10.28.0` resolvido pelo Corepack; versões presentes conferem com o lockfile.
- Testes do workspace: 270 passaram no checkout, usando `AMV_FFMPEG` e `AMV_FFPROBE` apontando para os sidecars locais.
- Typecheck do workspace e build frontend: passaram no checkout.
- Backend Python: o ambiente isolado de SAM2 não tem FastAPI, Uvicorn, pytest ou httpx; não há `.venv` do analisador no checkout. O servidor/testes Python não foram iniciados e nenhuma dependência foi instalada.
- Modelos: pesos SkyTNT/SAM2 encontrados apenas no diretório de avaliação externo; não foram copiados para o produto.
- Tauri nativo: não compilado, pois `cargo`/`rustc` não estão disponíveis no PATH.
- `git diff --check`: executado após gerar este relatório e o inventário de dependências.

## Pendências e aprovação necessária

1. `node_modules/` será mantido, conforme decisão do usuário; não há exclusão autorizada.
2. Decidir se os ~3,08 GB de `AMV-SAM2-Quality` devem continuar como workspace de avaliação separado. Não recomendo movê-los ao repositório: duplicaria conteúdo e misturaria artefatos temporários/modelos com o produto.
3. Revisar separadamente a limpeza de caches globais uv/Hugging Face. Não foram alterados porque podem servir outros projetos.
4. Disponibilizar Rust/Cargo na máquina, caso a compilação Tauri local seja requisito desta reorganização.
5. Se o objetivo for remover recursos de segmentação do produto, pedir uma auditoria de referências e decisão funcional separada; nada foi removido neste relatório.

## Atualização: distribuição do sidecar

- Decisão de implementação: SAM2 foi reprovado visualmente como recortador confiável; sua dependência e o código de experimento permanecem opcionais, mas o runtime Windows não deve conter PyTorch, TorchVision, SAM 2, ONNX Runtime ou o checkpoint.
- O empacotador agora exclui esses módulos, não baixa pesos e o smoke test verifica ausência de SAM2/PyTorch e do checkpoint específico. Também exige disponibilidade de fala e decodifica um WAV sintético.
- Nenhum arquivo antigo em `services/analyzer/build/`, cache externo ou workspace do usuário foi apagado; a economia real e o tamanho pós-build ainda dependem de executar o empacotamento Windows.
- Pendência anterior 5 substituída: o protótipo não é removido do repositório; apenas deixa de ser distribuído até haver um recortador aprovado.

### Validação do incremento de editor/distribuição

- Testes TS dos workspaces: 277 passaram, incluindo o teste adicional de undo/reordenação; `corepack pnpm -r typecheck` passou.
- Build frontend desktop passou. O Vite avisou que o bundle JS principal tem 758,18 kB minificado.
- Testes Python do analisador: 13 passaram e 1 foi ignorado por depender do runtime opcional SAM2/PyTorch/Pillow, ausente neste ambiente; `py_compile` passou.
- `git diff --check` passou.
- O build PyInstaller atualizado não foi executado porque PyInstaller não está instalado neste Python. Assim, a exclusão de módulos está configurada e coberta pelo smoke test do script, mas o tamanho real pós-build ainda não foi medido.
- Tauri nativo continua sem validação local porque Rust/Cargo não estão disponíveis no PATH.
