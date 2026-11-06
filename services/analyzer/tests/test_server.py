from fastapi.testclient import TestClient

from amv_analyzer.server import create_app, free_port, module_status


def test_exige_token():
    client = TestClient(create_app("segredo"))
    assert client.get("/health").status_code == 401
    assert client.get("/health", headers={"Authorization": "Bearer errado"}).status_code == 401
    r = client.get("/health", headers={"Authorization": "Bearer segredo"})
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_modulos_informam_disponibilidade_real():
    status = module_status()
    assert set(status) == {"beats", "scenes", "speech", "separation"}
    for info in status.values():
        assert isinstance(info["available"], bool)
        if not info["available"]:
            assert "não instalado" in info["reason"]


def test_porta_livre_local():
    assert 1024 < free_port() < 65536
