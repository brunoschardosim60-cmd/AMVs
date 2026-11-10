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
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import __version__
from .segmentation import SegmentationCancelled, checkpoint_path, propagate_character
from .speech import MODEL_SIZES, TranscriptionCancelled, transcribe

MODULES: dict[str, str] = {
    "beats": "librosa",
    "scenes": "scenedetect",
    "speech": "faster_whisper",
    "separation": "demucs",
    "segmentation": "sam2",
}


class TranscriptionRequest(BaseModel):
    path: str = Field(min_length=1)
    model: str = "small"
    language: str | None = None


class SegmentationPoint(BaseModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    label: int = Field(ge=0, le=1)


class SegmentationRequest(BaseModel):
    path: str = Field(min_length=1)
    ffmpeg_path: str = Field(min_length=1)
    output_dir: str = Field(min_length=1)
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)
    fps_num: int = Field(gt=0, le=120)
    fps_den: int = Field(gt=0, le=1001)
    seed_frame: int = Field(ge=0)
    points: list[SegmentationPoint] = Field(min_length=1, max_length=32)
    cache_key: str = Field(pattern=r"^[a-f0-9]{64}$")


class SegmentationJob:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.cancelled = threading.Event()
        self.status = "queued"
        self.progress = 0.0
        self.result: dict[str, Any] | None = None
        self.error: str | None = None

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "status": self.status,
                "progress": self.progress,
                "result": self.result,
                "error": self.error,
            }


class SpeechJob:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.cancelled = threading.Event()
        self.status = "queued"
        self.progress = 0.0
        self.duration = 0.0
        self.result: dict[str, Any] | None = None
        self.error: str | None = None

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "status": self.status,
                "progress": self.progress,
                "duration": self.duration,
                "result": self.result,
                "error": self.error,
            }


def module_status() -> dict[str, dict[str, object]]:
    out: dict[str, dict[str, object]] = {}
    for name, package in MODULES.items():
        required = ("sam2", "torch", "PIL") if name == "segmentation" else (package,)
        missing = [module for module in required if importlib.util.find_spec(module) is None]
        if name == "segmentation":
            checkpoint = checkpoint_path()
            if not checkpoint.is_file():
                missing.append(f"checkpoint {checkpoint.name}")
        out[name] = {
            "available": not missing,
            "requires": ", ".join(required),
            "reason": None if not missing else f"pacotes não instalados: {', '.join(missing)}",
        }
    return out


def create_app(token: str) -> FastAPI:
    app = FastAPI(title="AMV Studio Analyzer", version=__version__)
    jobs: dict[str, SpeechJob] = {}
    jobs_lock = threading.Lock()
    segmentation_jobs: dict[str, SegmentationJob] = {}
    segmentation_jobs_lock = threading.Lock()

    def auth(authorization: str | None = Header(default=None)) -> None:
        if authorization != f"Bearer {token}":
            raise HTTPException(status_code=401, detail="token inválido")

    @app.get("/health", dependencies=[Depends(auth)])
    def health() -> dict[str, object]:
        return {"ok": True, "version": __version__, "python": sys.version.split()[0]}

    @app.get("/modules", dependencies=[Depends(auth)])
    def modules() -> dict[str, dict[str, object]]:
        return module_status()

    def validate_request(request: TranscriptionRequest) -> Path:
        if request.model not in MODEL_SIZES:
            raise HTTPException(status_code=422, detail=f"modelo inválido; opções: {', '.join(sorted(MODEL_SIZES))}")
        if request.language is not None and (
            len(request.language) not in (2, 3) or not request.language.isascii() or not request.language.isalpha()
        ):
            raise HTTPException(status_code=422, detail="idioma deve ser um código ISO de 2 ou 3 letras")
        path = Path(request.path)
        if not path.is_file():
            raise HTTPException(status_code=404, detail="arquivo de mídia não encontrado")
        return path

    @app.post("/speech/jobs", dependencies=[Depends(auth)])
    def start_speech_job(request: TranscriptionRequest) -> dict[str, str]:
        path = validate_request(request)
        job_id = uuid.uuid4().hex
        job = SpeechJob()
        with jobs_lock:
            jobs[job_id] = job

        def run() -> None:
            with job.lock:
                job.status = "running"
            try:
                if job.cancelled.is_set():
                    raise TranscriptionCancelled("transcrição cancelada")
                result = transcribe(
                    str(path),
                    request.model,
                    request.language,
                    cancelled=job.cancelled.is_set,
                    on_progress=lambda done, total: update_progress(job, done, total),
                )
                with job.lock:
                    job.result = result
                    job.status = "completed"
            except TranscriptionCancelled:
                with job.lock:
                    job.status = "cancelled"
            except RuntimeError as exc:
                with job.lock:
                    job.error = str(exc)
                    job.status = "failed"
            except Exception as exc:
                with job.lock:
                    job.error = f"falha na transcrição: {exc}"
                    job.status = "failed"

        threading.Thread(target=run, name=f"speech-{job_id[:8]}", daemon=True).start()
        return {"job_id": job_id}

    @app.get("/speech/jobs/{job_id}", dependencies=[Depends(auth)])
    def speech_job_status(job_id: str) -> dict[str, Any]:
        with jobs_lock:
            job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job de transcrição não encontrado")
        return job.snapshot()

    @app.delete("/speech/jobs/{job_id}", dependencies=[Depends(auth)])
    def cancel_speech_job(job_id: str) -> dict[str, str]:
        with jobs_lock:
            job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job de transcrição não encontrado")
        job.cancelled.set()
        return {"status": "cancelling"}

    @app.post("/segmentation/jobs", dependencies=[Depends(auth)])
    def start_segmentation_job(request: SegmentationRequest) -> dict[str, str]:
        media_path = Path(request.path)
        ffmpeg_path = Path(request.ffmpeg_path)
        if not media_path.is_file():
            raise HTTPException(status_code=404, detail="arquivo de vídeo não encontrado")
        if not ffmpeg_path.is_file():
            raise HTTPException(status_code=404, detail="FFmpeg empacotado não encontrado")
        if request.end_s <= request.start_s:
            raise HTTPException(status_code=422, detail="o fim do intervalo deve ser posterior ao início")
        if request.end_s - request.start_s > 180 * request.fps_den / request.fps_num:
            raise HTTPException(status_code=422, detail="o intervalo excede 180 quadros")
        if not any(point.label == 1 for point in request.points):
            raise HTTPException(status_code=422, detail="adicione ao menos um ponto positivo")
        job_id = uuid.uuid4().hex
        job = SegmentationJob()
        with segmentation_jobs_lock:
            segmentation_jobs[job_id] = job

        def run() -> None:
            with job.lock:
                job.status = "running"
            try:
                result = propagate_character(
                    media_path=request.path,
                    ffmpeg_path=request.ffmpeg_path,
                    output_dir=request.output_dir,
                    start_s=request.start_s,
                    end_s=request.end_s,
                    fps_num=request.fps_num,
                    fps_den=request.fps_den,
                    seed_frame=request.seed_frame,
                    points=[point.model_dump() for point in request.points],
                    cache_key=request.cache_key,
                    cancelled=job.cancelled,
                    on_progress=lambda done, total: update_segmentation_progress(job, done, total),
                )
                with job.lock:
                    job.result = result
                    job.progress = 1.0
                    job.status = "completed"
            except SegmentationCancelled:
                with job.lock:
                    job.status = "cancelled"
            except Exception as exc:
                with job.lock:
                    job.error = f"falha no isolamento do personagem: {exc}"
                    job.status = "failed"

        threading.Thread(target=run, name=f"segmentation-{job_id[:8]}", daemon=True).start()
        return {"job_id": job_id}

    @app.get("/segmentation/jobs/{job_id}", dependencies=[Depends(auth)])
    def segmentation_job_status(job_id: str) -> dict[str, Any]:
        with segmentation_jobs_lock:
            job = segmentation_jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job de isolamento não encontrado")
        return job.snapshot()

    @app.delete("/segmentation/jobs/{job_id}", dependencies=[Depends(auth)])
    def cancel_segmentation_job(job_id: str) -> dict[str, str]:
        with segmentation_jobs_lock:
            job = segmentation_jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="job de isolamento não encontrado")
        job.cancelled.set()
        return {"status": "cancelling"}

    return app


def update_progress(job: SpeechJob, done: float, total: float) -> None:
    with job.lock:
        job.progress = max(0.0, done)
        job.duration = max(0.0, total)


def update_segmentation_progress(job: SegmentationJob, done: float, total: float) -> None:
    with job.lock:
        job.progress = max(job.progress, min(1.0, done / total if total > 0 else 0.0))


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
