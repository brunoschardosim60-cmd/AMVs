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
    assert set(status) == {"beats", "scenes", "speech", "separation"}
    for info in status.values():
        assert isinstance(info["available"], bool)
        if not info["available"]:
            assert "não instalado" in info["reason"]


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
