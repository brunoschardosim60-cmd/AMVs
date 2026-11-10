# Inventário de dependências do AMV Studio

**Inventário realizado em:** 2026-11-09
**Fonte de versões:** manifests, `pnpm-lock.yaml`, `Cargo.lock` e ambientes de avaliação presentes.

## Ferramentas de desenvolvimento observadas

| Ferramenta | Versão/localização observada | Uso / observação |
|---|---|---|
| Node.js | 24.14.0 em `C:\\Program Files\\nodejs\\node.exe` | Runtime compartilhado do sistema para Vite, scripts e Corepack. |
| Corepack / pnpm | Corepack 0.34.6; `pnpm@10.28.0` | Versão exigida por `package.json`; dependências são resolvidas via lockfile. |
| Python | Python 3.14 de usuário e CPython 3.12.13 gerenciado por uv | Instalações externas; não foram movidas nem assumidas como dependências exclusivas do AMV Studio. |
| uv | 0.10.12 em `%USERPROFILE%\\.local\\bin\\uv.exe` | Ferramenta compartilhada. Seu cache não foi limpo. |
| Rust/Cargo | `cargo`, `rustc` e `rustup` não encontrados no PATH | O projeto fixa `rust-version = "1.80"` e tem `Cargo.lock`; build Tauri nativo não foi verificado localmente. |
| FFmpeg / FFprobe | `n9.0.2-48-gd4070a14ce-20261108`, sidecars locais no diretório Tauri | Windows x64; executáveis `ffmpeg-x86_64-pc-windows-msvc.exe` e `ffprobe-x86_64-pc-windows-msvc.exe`. |

## Dependências diretas do workspace pnpm

Versões abaixo são as resolvidas no `node_modules` atual; dependências de workspace locais são identificadas como `workspace:*`. O lockfile é a fonte de reprodutibilidade.

### Aplicativo desktop

| Dependência | Versão resolvida/declarada | Papel |
|---|---:|---|
| React / React DOM | 19.3.1 | UI |
| Zustand | 5.1.0 | Estado |
| Vite | 7.3.7 | Build/dev server |
| TypeScript | 5.9.3 | Linguagem/typecheck |
| Tauri API / CLI | 2.12.4 | Integração desktop |
| Tauri plugins: dialog, fs, http, opener, process, shell, updater | 2.8.4 / 2.7.1 / 2.8.3 / 2.7.2 / 2.4.0 / 2.6.0 / 2.14.1 | APIs nativas |
| Tailwind CSS / `@tailwindcss/vite` | 4.3.5 / 4.3.5 | Estilos |
| `@vitejs/plugin-react` | 5.2.0 | Integração React/Vite |
| `lucide-react` | 1.70.0 | Ícones |
| `@fontsource-variable/manrope` | 5.3.0 | Fonte local empacotada |
| `vitest` | 3.2.7 | Testes |
| `@types/react`, `@types/react-dom`, `@types/node` | 19.3.0, 19.3.0, 22.20.5 | Tipos de desenvolvimento |

### Pacotes TypeScript locais

`@amv/desktop` usa os pacotes locais `@amv/analysis`, `@amv/assistant`, `@amv/automv`, `@amv/media`, `@amv/music`, `@amv/project`, `@amv/render`, `@amv/sfx` e `@amv/subtitles`. As dependências entre eles são `workspace:*`, portanto não são cópias externas independentes.

Dependência externa direta dos pacotes puros:

| Dependência | Versão resolvida | Consumidor |
|---|---:|---|
| Zod | 3.25.76 | `@amv/project` |
| TypeScript | 5.9.3 | Todos os pacotes TS |
| Vitest | 3.2.7 | Suítes TS |

Os detalhes de dependências transitivas estão fixados em `pnpm-lock.yaml`; não há evidência nesta auditoria para remover pacotes do lockfile com segurança.

## Dependências Rust/Tauri

`apps/desktop/src-tauri/Cargo.toml` declara Rust edition 2021 e `rust-version = "1.80"`. Versões diretas são faixas de major e o `Cargo.lock` (147.716 bytes) fixa a resolução concreta:

| Crate | Versão declarada |
|---|---:|
| `tauri`, `tauri-build` | 2.12.5 / 2.7.4 |
| Plugins Tauri dialog/fs/shell/process/opener/http/updater | 2.8.4 / 2.7.1 / 2.6.0 / 2.4.0 / 2.7.2 / 2.8.3 / 2.14.1 |
| `serde`, `serde_json` | 1.0.229 / 1.0.154 |
| `keyring` | 3.6.3 |

O alvo `keyring` habilita os backends nativos Windows/macOS/Linux. O host atual não tem `cargo`/`rustc` acessíveis; a compilação Tauri não foi executada durante o inventário.

## Dependências Python

Fonte: `services/analyzer/pyproject.toml`, sem lockfile Python de produção no checkout.

| Grupo | Dependência | Restrição declarada | Observação |
|---|---|---|---|
| Base | FastAPI | `>=0.115` | Serviço local do analisador |
| Base | Uvicorn | `>=0.30` | Servidor ASGI |
| `dev` | pytest | `>=8` | Testes Python |
| `dev` | httpx | `>=0.27` | Testes HTTP |
| `speech` | faster-whisper | `>=1.1,<2` | Opcional; baixa modelo sob demanda |
| `speech` | av | `>=11,<19` | Limite inferior a PyAV 19 exigido pela API usada |
| `segmentation` | torch / torchvision | `==2.5.1` / `==0.20.1` | Extra opcional para desenvolvimento/testes do protótipo; excluído do runtime distribuído |
| `segmentation` | SAM 2 | commit `2b90b9f5ceec907a1c18123530e92e794ad901a4` | Dependência VCS opcional para experimento; PyInstaller a exclui e não empacota o checkpoint |
| `package` | PyInstaller | `>=6.10,<7` | Empacotamento sidecar |
| Build | setuptools | `>=69` | Backend de build |

Ambientes de avaliação externos observados:

| Ambiente | Python / pacotes conhecidos | Situação |
|---|---|---|
| `%USERPROFILE%\\Videos\\AMV-SAM2-Quality\\runtime\\venv` | Python 3.12.13; PyTorch 2.5.1+cpu; TorchVision 0.20.1+cpu; SAM-2 1.0; NumPy 2.5.4; Pillow 13.0.0 | Ambiente da validação SAM2/PyTorch; fora do repo, não é movido. |
| `%USERPROFILE%\\Videos\\AMV-SAM2-Quality\\runtime\\skytnt-onnx-venv` | Python 3.12.13; `torch` não instalado | Ambiente de teste ONNX; opcional e separado. |

Esses ambientes não substituem um lockfile do sidecar de produção. Eles são recursos de pesquisa e precisam permanecer no local atual até decisão explícita sobre preservação/arquivamento.

## FFmpeg e recursos grandes

- O app espera sidecars em `apps/desktop/src-tauri/binaries/` com nomes específicos do target. Tauri os declara em `externalBin`.
- `scripts/fetch-ffmpeg.mjs` baixa build GPL para Windows, valida SHA-256 publicado e copia os dois executáveis ao diretório esperado.
- A cópia local totaliza aproximadamente 316,14 MB e está ignorada pelo Git.
- Não existe modelo de IA versionado no checkout. Pesos ISNet/SAM2 estão no workspace de avaliação externo; não são dependências de produção aprovadas.
- O bundle de distribuição do analisador exclui explicitamente `sam2`, `torch`, `torchvision` e `onnxruntime`; o código-fonte e o extra `segmentation` permanecem. O tamanho do novo bundle ainda precisa ser medido após build Windows.
- Os workflows de CI/release instalam somente os extras `speech,package`; `segmentation` não é baixado durante a geração do instalador. Os testes específicos do protótipo SAM2 requerem instalar explicitamente o extra opcional.

## Notas de controle

- Recriar `node_modules` exige Node/Corepack e `corepack pnpm install --frozen-lockfile`.
- Recriar sidecars FFmpeg exige acesso à release externa e ao utilitário `tar` do Windows; o script verifica checksum.
- Para tornar o ambiente Python do produto reproduzível, avaliar e adotar um lockfile Python separado em uma mudança dedicada. Esta limpeza não alterou dependências.
- Não foram removidas dependências, modelos nem recursos nesta auditoria.
