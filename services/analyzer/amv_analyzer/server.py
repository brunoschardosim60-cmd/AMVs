"""Servidor local do analisador.

Segurança: escuta só em 127.0.0.1, numa porta escolhida pelo sistema, e exige
um token gerado por sessão (o app recebe porta e token pela primeira linha do
stdout). Nada é exposto para a rede.

Fase 1: só o esqueleto (saúde e capacidades). Os módulos de análise entram na
Fase 4, cada um declarando se está disponível neste computador.
"""
from __future__ import annotations

import importlib.util
import json
import secrets
import socket
import sys

from fastapi import Depends, FastAPI, Header, HTTPException

from . import __version__

# módulo -> pacote Python que ele exige
MODULES: dict[str, str] = {
    "beats": "librosa",
    "scenes": "scenedetect",
    "speech": "faster_whisper",
    "separation": "demucs",
}


def module_status() -> dict[str, dict[str, object]]:
    out: dict[str, dict[str, object]] = {}
    for name, package in MODULES.items():
        ok = importlib.util.find_spec(package) is not None
        out[name] = {"available": ok, "requires": package, "reason": None if ok else f"pacote {package} não instalado"}
    return out


def create_app(token: str) -> FastAPI:
    app = FastAPI(title="AMV Studio Analyzer", version=__version__)

    def auth(authorization: str | None = Header(default=None)) -> None:
        if authorization != f"Bearer {token}":
            raise HTTPException(status_code=401, detail="token inválido")

    @app.get("/health", dependencies=[Depends(auth)])
    def health() -> dict[str, object]:
        return {"ok": True, "version": __version__, "python": sys.version.split()[0]}

    @app.get("/modules", dependencies=[Depends(auth)])
    def modules() -> dict[str, dict[str, object]]:
        return module_status()

    return app


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def main() -> None:
    import uvicorn

    token = secrets.token_urlsafe(32)
    port = free_port()
    # primeira linha do stdout: o app lê e conecta
    print(json.dumps({"event": "ready", "port": port, "token": token}), flush=True)
    uvicorn.run(create_app(token), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
