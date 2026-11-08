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


def test_transcribe_api_valida_arquivo_e_repassa_opcoes(tmp_path, monkeypatch):
    media = tmp_path / "episode.mkv"
    media.touch()
    monkeypatch.setattr(
        server,
        "transcribe",
        lambda path, model, language: {
            "language": language,
            "segments": [{"start": 1.0, "end": 2.0, "text": "Olá.", "words": []}],
        },
    )
    client = TestClient(create_app("segredo"))
    headers = {"Authorization": "Bearer segredo"}

    response = client.post(
        "/speech/transcribe",
        headers=headers,
        json={"path": str(media), "model": "medium", "language": "pt"},
    )

    assert response.status_code == 200
    assert response.json()["segments"][0]["text"] == "Olá."


def test_transcribe_api_rejeita_arquivo_ausente_e_opcoes_invalidas(tmp_path):
    client = TestClient(create_app("segredo"))
    headers = {"Authorization": "Bearer segredo"}

    missing = client.post(
        "/speech/transcribe",
        headers=headers,
        json={"path": str(tmp_path / "missing.mkv")},
    )
    bad_model = client.post(
        "/speech/transcribe",
        headers=headers,
        json={"path": str(tmp_path / "missing.mkv"), "model": "bad"},
    )
    bad_language = client.post(
        "/speech/transcribe",
        headers=headers,
        json={"path": str(tmp_path / "missing.mkv"), "language": "portuguese"},
    )

    assert missing.status_code == 404
    assert bad_model.status_code == 422
    assert bad_language.status_code == 422


def test_transcribe_api_explica_quando_whisper_nao_esta_instalado(tmp_path, monkeypatch):
    media = tmp_path / "episode.mkv"
    media.touch()

    def unavailable(*_):
        raise RuntimeError("instale o extra speech")

    monkeypatch.setattr(server, "transcribe", unavailable)
    client = TestClient(create_app("segredo"))

    response = client.post(
        "/speech/transcribe",
        headers={"Authorization": "Bearer segredo"},
        json={"path": str(media)},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "instale o extra speech"
