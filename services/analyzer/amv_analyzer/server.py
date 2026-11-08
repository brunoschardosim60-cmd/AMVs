"""Loopback API do analisador local.

Escuta apenas em 127.0.0.1, usa uma porta aleatória e autentica cada requisição
com um token aleatório da sessão. O modelo de fala é opcional e carrega sob demanda.
"""
from __future__ import annotations

import importlib.util
import json
import secrets
import socket
import sys
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import __version__
from .speech import MODEL_SIZES, transcribe

MODULES: dict[str, str] = {
    "beats": "librosa",
    "scenes": "scenedetect",
    "speech": "faster_whisper",
    "separation": "demucs",
}


class TranscriptionRequest(BaseModel):
    path: str = Field(min_length=1)
    model: str = "small"
    language: str | None = None


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

    @app.post("/speech/transcribe", dependencies=[Depends(auth)])
    def speech_transcribe(request: TranscriptionRequest) -> dict[str, object]:
        if request.model not in MODEL_SIZES:
            raise HTTPException(status_code=422, detail=f"modelo inválido; opções: {', '.join(sorted(MODEL_SIZES))}")
        if request.language is not None and (
            len(request.language) not in (2, 3) or not request.language.isascii() or not request.language.isalpha()
        ):
            raise HTTPException(status_code=422, detail="idioma deve ser um código ISO de 2 ou 3 letras")
        if not Path(request.path).is_file():
            raise HTTPException(status_code=404, detail="arquivo de mídia não encontrado")
        try:
            return transcribe(request.path, request.model, request.language)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return app


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def main() -> None:
    import uvicorn

    token = secrets.token_urlsafe(32)
    port = free_port()
    print(json.dumps({"event": "ready", "port": port, "token": token}), flush=True)
    uvicorn.run(create_app(token), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
