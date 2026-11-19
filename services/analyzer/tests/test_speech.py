from types import SimpleNamespace
from threading import Event

import pytest

from amv_analyzer.speech import TranscriptionCancelled, transcribe


class FakeModel:
    def __init__(self):
        self.options = None

    def transcribe(self, path, **options):
        self.options = (path, options)
        words = [
            SimpleNamespace(word=" Olá", start=0.1, end=0.4),
            SimpleNamespace(word=" mundo!", start=0.4, end=0.8),
        ]
        segments = [
            SimpleNamespace(start=-0.1, end=1.0, text=" Olá mundo! ", words=words),
            SimpleNamespace(start=1.0, end=1.0, text=" ", words=[]),
        ]
        return segments, SimpleNamespace(language="pt", language_probability=0.98, duration=2.0)


def test_transcribe_returns_segments_and_word_timestamps(tmp_path):
    media = tmp_path / "episode.mkv"
    media.write_bytes(b"synthetic test input")
    model = FakeModel()

    result = transcribe(str(media), "base", "pt", model_loader=lambda size: model)

    assert result == {
        "language": "pt",
        "language_probability": 0.98,
        "duration": 2.0,
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": "Olá mundo!",
                "words": [
                    {"start": 0.1, "end": 0.4, "text": "Olá"},
                    {"start": 0.4, "end": 0.8, "text": "mundo!"},
                ],
            }
        ],
    }
    assert model.options == (
        str(media),
        {"language": "pt", "beam_size": 5, "vad_filter": True, "word_timestamps": True},
    )


def test_transcribe_rejects_missing_media_and_invalid_model(tmp_path):
    with pytest.raises(FileNotFoundError, match="não encontrado"):
        transcribe(str(tmp_path / "missing.mkv"), model_loader=lambda _: None)

    media = tmp_path / "episode.mkv"
    media.touch()
    with pytest.raises(ValueError, match="modelo inválido"):
        transcribe(str(media), "unknown", model_loader=lambda _: None)


def test_transcribe_reports_progress_and_cancels_between_segments(tmp_path):
    media = tmp_path / "episode.mkv"
    media.touch()
    model = FakeModel()
    cancelled = Event()
    progress = []

    def report_progress(done, total):
        progress.append((done, total))
        if done >= 1:
            cancelled.set()

    with pytest.raises(TranscriptionCancelled, match="cancelada"):
        transcribe(
            str(media),
            model_loader=lambda _: model,
            cancelled=cancelled.is_set,
            on_progress=report_progress,
        )

    assert progress == [(0.0, 2.0), (1.0, 2.0)]


def test_transcribe_retries_without_vad_when_vad_returns_empty(tmp_path):
    media = tmp_path / "song.wav"
    media.touch()
    calls = []

    class SingingModel:
        def transcribe(self, path, **options):
            calls.append(options)
            if options.get("vad_filter", True):
                return [], SimpleNamespace(language="en", language_probability=0.0, duration=3.0)
            words = [SimpleNamespace(word=" Rise", start=0.5, end=1.0)]
            return [SimpleNamespace(start=0.5, end=1.0, text=" Rise", words=words)], SimpleNamespace(language="en", language_probability=0.82, duration=3.0)

    result = transcribe(str(media), "small", model_loader=lambda _: SingingModel())
    assert len(calls) == 2
    assert calls[0]["vad_filter"] is True
    assert calls[1]["vad_filter"] is False
    assert calls[1]["condition_on_previous_text"] is False
    assert len(result["segments"]) == 1
    assert result["segments"][0]["text"] == "Rise"


def test_transcribe_retries_without_vad_when_vad_is_sparse_on_long_audio(tmp_path):
    media = tmp_path / "episode.wav"
    media.touch()
    calls = []

    class SparseVadModel:
        def transcribe(self, path, vad_parameters=None, **options):
            calls.append((options, vad_parameters))
            if options.get("vad_filter", True):
                return [SimpleNamespace(start=16.7, end=18.2, text=" One line", words=[])], SimpleNamespace(language="ja", language_probability=0.9, duration=300.0)
            return [
                SimpleNamespace(start=16.7, end=18.2, text=" One line", words=[]),
                SimpleNamespace(start=25.0, end=27.0, text=" Two", words=[]),
                SimpleNamespace(start=40.0, end=42.5, text=" Three", words=[]),
                SimpleNamespace(start=65.0, end=68.0, text=" Four", words=[]),
                SimpleNamespace(start=90.0, end=93.0, text=" Five", words=[]),
            ], SimpleNamespace(language="ja", language_probability=0.9, duration=300.0)

    result = transcribe(str(media), "small", model_loader=lambda _: SparseVadModel())
    assert len(calls) == 2
    assert calls[0][0]["vad_filter"] is True
    assert calls[0][1] is not None and calls[0][1]["threshold"] == 0.28
    assert calls[1][0]["vad_filter"] is False
    assert len(result["segments"]) == 5
