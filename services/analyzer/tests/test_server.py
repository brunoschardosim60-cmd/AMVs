import time

from fastapi.testclient import TestClient

from amv_analyzer import server
from amv_analyzer.server import create_app, free_port, module_status


def test_exige_token():
    client = TestClient(create_app("segredo"))
    assert client.get("/health").status_code == 401
    assert client.get("/health", headers={"Authorization": "Bearer errado"}).status_code == 401
    response = client.get("/health", headers={"Authorization": "Bearer segredo"})
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_modulos_informam_disponibilidade_real():
    status = module_status()
    assert set(status) == {"beats", "scenes", "speech", "separation", "segmentation"}
    for info in status.values():
        assert isinstance(info["available"], bool)
        if not info["available"]:
            assert "não instalado" in info["reason"]


def test_modulo_segmentacao_exige_checkpoint(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "checkpoint_path", lambda: tmp_path / "sam2.1_hiera_tiny.pt")
    status = module_status()["segmentation"]
    assert status["available"] is False
    assert "sam2.1_hiera_tiny.pt" in status["reason"]


def test_porta_livre_local():
    assert 1024 < free_port() < 65536


def test_transcribe_job_exposes_progress_and_result(tmp_path, monkeypatch):
    media = tmp_path / "episode.mkv"
    media.touch()

    def fake_transcribe(path, model, language, *, cancelled, on_progress):
        on_progress(5, 10)
        return {"language": language, "duration": 10, "segments": [{"start": 1, "end": 2, "text": "Olá.", "words": []}]}

    monkeypatch.setattr(server, "transcribe", fake_transcribe)
    client = TestClient(create_app("segredo"))
    headers = {"Authorization": "Bearer segredo"}

    started = client.post("/speech/jobs", headers=headers, json={"path": str(media), "model": "medium", "language": "pt"})
    assert started.status_code == 200
    job_id = started.json()["job_id"]
    for _ in range(100):
        response = client.get(f"/speech/jobs/{job_id}", headers=headers)
        if response.json()["status"] == "completed":
            break
        time.sleep(0.01)

    assert response.json()["status"] == "completed"
    assert response.json()["result"]["segments"][0]["text"] == "Olá."
    assert response.json()["progress"] == 5
    assert response.json()["duration"] == 10


def test_transcribe_jobs_rejeita_arquivo_ausente_e_opcoes_invalidas(tmp_path):
    client = TestClient(create_app("segredo"))
    headers = {"Authorization": "Bearer segredo"}

    missing = client.post(
        "/speech/jobs",
        headers=headers,
        json={"path": str(tmp_path / "missing.mkv")},
    )
    bad_model = client.post(
        "/speech/jobs",
        headers=headers,
        json={"path": str(tmp_path / "missing.mkv"), "model": "bad"},
    )
    bad_language = client.post(
        "/speech/jobs",
        headers=headers,
        json={"path": str(tmp_path / "missing.mkv"), "language": "portuguese"},
    )

    assert missing.status_code == 404
    assert bad_model.status_code == 422
    assert bad_language.status_code == 422


def test_transcribe_job_explica_quando_whisper_nao_esta_instalado(tmp_path, monkeypatch):
    media = tmp_path / "episode.mkv"
    media.touch()

    def unavailable(*_, **__):
        raise RuntimeError("instale o extra speech")

    monkeypatch.setattr(server, "transcribe", unavailable)
    client = TestClient(create_app("segredo"))

    started = client.post("/speech/jobs", headers={"Authorization": "Bearer segredo"}, json={"path": str(media)})
    job_id = started.json()["job_id"]
    for _ in range(100):
        response = client.get(f"/speech/jobs/{job_id}", headers={"Authorization": "Bearer segredo"})
        if response.json()["status"] == "failed":
            break
        time.sleep(0.01)
    assert response.json()["status"] == "failed"
    assert response.json()["error"] == "instale o extra speech"


def test_cancelar_job_interrompe_iteracao(tmp_path, monkeypatch):
    media = tmp_path / "episode.mkv"
    media.touch()

    def fake_transcribe(path, model, language, *, cancelled, on_progress):
        on_progress(1, 10)
        while not cancelled():
            time.sleep(0.001)
        raise server.TranscriptionCancelled("transcrição cancelada")

    monkeypatch.setattr(server, "transcribe", fake_transcribe)
    client = TestClient(create_app("segredo"))
    headers = {"Authorization": "Bearer segredo"}
    job_id = client.post("/speech/jobs", headers=headers, json={"path": str(media)}).json()["job_id"]
    client.delete(f"/speech/jobs/{job_id}", headers=headers)
    for _ in range(100):
        response = client.get(f"/speech/jobs/{job_id}", headers=headers)
        if response.json()["status"] == "cancelled":
            break
        time.sleep(0.01)
    assert response.json()["status"] == "cancelled"


def _segmentation_payload(media, ffmpeg):
    return {
        "path": str(media),
        "ffmpeg_path": str(ffmpeg),
        "output_dir": str(media.parent / "cutout"),
        "start_s": 0,
        "end_s": 1,
        "fps_num": 24,
        "fps_den": 1,
        "seed_frame": 0,
        "points": [{"x": 10, "y": 10, "label": 1}],
        "cache_key": "a" * 64,
    }


def test_segmentation_job_exposes_real_progress_and_result(tmp_path, monkeypatch):
    media = tmp_path / "episode.mkv"
    ffmpeg = tmp_path / "ffmpeg.exe"
    media.touch()
    ffmpeg.touch()

    def fake_propagate(**kwargs):
        kwargs["on_progress"](0.5, 1)
        return {"frameCount": 24, "outputDir": kwargs["output_dir"]}

    monkeypatch.setattr(server, "propagate_character", fake_propagate)
    client = TestClient(create_app("segredo"))
    headers = {"Authorization": "Bearer segredo"}
    started = client.post("/segmentation/jobs", headers=headers, json=_segmentation_payload(media, ffmpeg))
    assert started.status_code == 200
    job_id = started.json()["job_id"]
    for _ in range(100):
        response = client.get(f"/segmentation/jobs/{job_id}", headers=headers)
        if response.json()["status"] == "completed":
            break
        time.sleep(0.01)

    assert response.json()["status"] == "completed"
    assert response.json()["progress"] == 1
    assert response.json()["result"]["frameCount"] == 24


def test_segmentation_jobs_validam_semente_intervalo_e_cancelamento(tmp_path, monkeypatch):
    media = tmp_path / "episode.mkv"
    ffmpeg = tmp_path / "ffmpeg.exe"
    media.touch()
    ffmpeg.touch()
    client = TestClient(create_app("segredo"))
    headers = {"Authorization": "Bearer segredo"}
    payload = _segmentation_payload(media, ffmpeg)

    no_positive = {**payload, "points": [{"x": 10, "y": 10, "label": 0}]}
    bad_interval = {**payload, "end_s": 0}
    assert client.post("/segmentation/jobs", headers=headers, json=no_positive).status_code == 422
    assert client.post("/segmentation/jobs", headers=headers, json=bad_interval).status_code == 422
    assert client.post("/segmentation/jobs", headers=headers, json={**payload, "ffmpeg_path": str(tmp_path / "missing.exe")}).status_code == 404

    def wait_for_cancel(**kwargs):
        kwargs["cancelled"].wait(timeout=1)
        raise server.SegmentationCancelled("cancelled")

    monkeypatch.setattr(server, "propagate_character", wait_for_cancel)
    job_id = client.post("/segmentation/jobs", headers=headers, json=payload).json()["job_id"]
    assert client.delete(f"/segmentation/jobs/{job_id}", headers=headers).status_code == 200
    for _ in range(100):
        response = client.get(f"/segmentation/jobs/{job_id}", headers=headers)
        if response.json()["status"] == "cancelled":
            break
        time.sleep(0.01)
    assert response.json()["status"] == "cancelled"
