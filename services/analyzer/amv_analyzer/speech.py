"""Local speech transcription with optional faster-whisper runtime."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

MODEL_SIZES = {"tiny", "base", "small", "medium", "large-v3"}
_models: dict[str, Any] = {}


class TranscriptionCancelled(Exception):
    pass


def _load_model(size: str) -> Any:
    if size not in MODEL_SIZES:
        raise ValueError(f"modelo inválido: {size}")
    if size not in _models:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError("transcrição indisponível: instale o extra opcional amv-analyzer[speech]") from exc
        _models[size] = WhisperModel(size, device="cpu", compute_type="int8")
    return _models[size]


def transcribe(
    path: str,
    model_size: str = "small",
    language: str | None = None,
    *,
    model_loader: Callable[[str], Any] = _load_model,
    cancelled: Callable[[], bool] = lambda: False,
    on_progress: Callable[[float, float], None] = lambda _done, _total: None,
) -> dict[str, Any]:
    """Transcribe one media file without reading its contents into application memory."""
    if model_size not in MODEL_SIZES:
        raise ValueError(f"modelo inválido: {model_size}")
    media = Path(path)
    if not media.is_file():
        raise FileNotFoundError(f"arquivo de mídia não encontrado: {path}")

    model = model_loader(model_size)
    segments, info = model.transcribe(
        str(media),
        language=language or None,
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
    )
    result: list[dict[str, Any]] = []
    duration = max(0.0, float(getattr(info, "duration", 0.0)))
    on_progress(0.0, duration)
    for segment in segments:
        if cancelled():
            raise TranscriptionCancelled("transcrição cancelada")
        text = str(segment.text).strip()
        start = max(0.0, float(segment.start))
        end = max(start, float(segment.end))
        if not text or end <= start:
            continue
        words = []
        for word in getattr(segment, "words", None) or ():
            word_text = str(word.word).strip()
            raw_start = getattr(word, "start", None)
            raw_end = getattr(word, "end", None)
            if not isinstance(raw_start, (int, float)) or not isinstance(raw_end, (int, float)):
                continue
            word_start = max(start, float(raw_start))
            word_end = min(end, max(word_start, float(raw_end)))
            if word_text and word_end > word_start:
                words.append({"start": word_start, "end": word_end, "text": word_text})
        result.append({"start": start, "end": end, "text": text, "words": words})
        on_progress(min(end, duration) if duration else end, duration)
    if cancelled():
        raise TranscriptionCancelled("transcrição cancelada")

    return {
        "language": getattr(info, "language", None),
        "language_probability": float(getattr(info, "language_probability", 0.0)),
        "duration": duration,
        "segments": result,
    }
