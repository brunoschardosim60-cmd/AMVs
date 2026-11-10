"""Build and smoke-test the bundled Windows analyzer runtime."""
from __future__ import annotations

import hashlib
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
RESOURCE_ROOT = REPO / "apps" / "desktop" / "src-tauri" / "resources"
OUTPUT = RESOURCE_ROOT / "analyzer"
WORK = ROOT / "build" / "pyinstaller"
CHECKPOINT = ROOT / "build" / "models" / "sam2.1_hiera_tiny.pt"
CHECKPOINT_URL = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt"
CHECKPOINT_SHA256 = "7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as checkpoint:
        while chunk := checkpoint.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_checkpoint() -> None:
    if CHECKPOINT.is_file():
        if sha256_file(CHECKPOINT) == CHECKPOINT_SHA256:
            return
        CHECKPOINT.unlink()

    CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
    partial = CHECKPOINT.with_suffix(".pt.part")
    digest = hashlib.sha256()
    request = urllib.request.Request(CHECKPOINT_URL, headers={"User-Agent": "AMV-Studio"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    if digest.hexdigest() != CHECKPOINT_SHA256:
        partial.unlink(missing_ok=True)
        raise RuntimeError("checksum SHA-256 do checkpoint SAM 2.1 Tiny não confere")
    partial.replace(CHECKPOINT)


def build() -> None:
    if os.name != "nt":
        raise RuntimeError("o runtime do instalador precisa ser empacotado no Windows")
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    RESOURCE_ROOT.mkdir(parents=True, exist_ok=True)
    ensure_checkpoint()
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--console",
        "--name",
        "analyzer",
        "--distpath",
        str(RESOURCE_ROOT),
        "--workpath",
        str(WORK),
        "--specpath",
        str(WORK),
        "--paths",
        str(ROOT),
        "--collect-all",
        "uvicorn",
        "--collect-all",
        "faster_whisper",
        "--collect-all",
        "ctranslate2",
        "--collect-all",
        "av",
        "--collect-all",
        "sam2",
        "--collect-binaries",
        "torch",
        "--collect-binaries",
        "torchvision",
        "--collect-all",
        "onnxruntime",
        str(ROOT / "package_entry.py"),
    ]
    subprocess.run(command, cwd=ROOT, check=True)
    (OUTPUT / "models").mkdir(parents=True, exist_ok=True)
    shutil.copy2(CHECKPOINT, OUTPUT / "models" / CHECKPOINT.name)
    (OUTPUT / ".gitkeep").touch()


def smoke_test() -> None:
    executable = OUTPUT / "analyzer.exe"
    process = subprocess.Popen(
        [str(executable)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
    )
    ready_line: queue.Queue[str] = queue.Queue()

    def read_ready_line() -> None:
        assert process.stdout is not None
        ready_line.put(process.stdout.readline())

    reader = threading.Thread(target=read_ready_line, daemon=True)
    reader.start()
    try:
        try:
            line = ready_line.get(timeout=30)
        except queue.Empty as exc:
            raise RuntimeError("o analisador empacotado não anunciou a porta em 30 s") from exc
        if not line:
            raise RuntimeError(f"o analisador empacotado encerrou (código {process.poll()})")
        ready = json.loads(line)
        token = ready.get("token")
        port = ready.get("port")
        if not isinstance(token, str) or not isinstance(port, int):
            raise RuntimeError("resposta de inicialização inválida do analisador empacotado")
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/modules",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            modules = json.loads(response.read())
        if not modules.get("speech", {}).get("available"):
            raise RuntimeError("faster-whisper não está disponível no runtime empacotado")
        if not modules.get("segmentation", {}).get("available"):
            raise RuntimeError("SAM 2 não está disponível no runtime empacotado")
        if not (OUTPUT / "models" / CHECKPOINT.name).is_file():
            raise RuntimeError("o checkpoint SAM 2.1 Tiny não foi empacotado")
        from faster_whisper.audio import decode_audio

        with tempfile.TemporaryDirectory(prefix="amv-analyzer-smoke-") as directory:
            audio_path = Path(directory) / "smoke.wav"
            with wave.open(str(audio_path), "wb") as audio_file:
                audio_file.setnchannels(1)
                audio_file.setsampwidth(2)
                audio_file.setframerate(16000)
                audio_file.writeframes(b"\0" * 8000)
            samples = decode_audio(str(audio_path))
        if samples.size != 4000:
            raise RuntimeError(f"decodificação de áudio inesperada: {samples.size} amostras")
        print("Runtime Python empacotado respondeu à API e decodificou áudio sintético.")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)


if __name__ == "__main__":
    build()
    smoke_test()
