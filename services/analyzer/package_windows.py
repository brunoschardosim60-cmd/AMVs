"""Build and smoke-test the bundled Windows analyzer runtime."""
from __future__ import annotations

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


def build() -> None:
    if os.name != "nt":
        raise RuntimeError("o runtime do instalador precisa ser empacotado no Windows")
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    RESOURCE_ROOT.mkdir(parents=True, exist_ok=True)
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
        "--exclude-module",
        "sam2",
        "--exclude-module",
        "torch",
        "--exclude-module",
        "torchvision",
        "--exclude-module",
        "onnxruntime",
        str(ROOT / "package_entry.py"),
    ]
    subprocess.run(command, cwd=ROOT, check=True)
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
        segmentation = modules.get("segmentation", {})
        if segmentation.get("available"):
            raise RuntimeError("o runtime SAM 2 não deve ser incluído no pacote distribuído")
        reason = segmentation.get("reason", "")
        if "sam2" not in reason or "torch" not in reason:
            raise RuntimeError("SAM 2 e PyTorch devem estar ausentes do runtime empacotado")
        if any(OUTPUT.rglob("sam2.1_hiera_tiny.pt")):
            raise RuntimeError("o checkpoint SAM 2.1 Tiny foi incluído no pacote")
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
