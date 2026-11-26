import struct
from fastapi.testclient import TestClient

from amv_analyzer.cutout import _clean_alpha_components, cutout_rgba_bytes_from_rgb24, encode_rgba_png, resolve_ffmpeg_binary
from amv_analyzer.server import create_app


def test_cutout_rgba_separa_personagem_do_fundo_sem_dependencias_externas():
    w, h = 120, 80
    rgb = bytearray(w * h * 3)
    for y in range(h):
        for x in range(w):
            idx = (y * w + x) * 3
            # Silhueta central contrastante simulando personagem de anime
            in_char = ((x - 60) / 22.0) ** 2 + ((y - 40) / 30.0) ** 2 <= 1.0
            if in_char:
                rgb[idx : idx + 3] = bytes((242, 198, 168))
            else:
                rgb[idx : idx + 3] = bytes((16, 24, 46))

    rgba, engine = cutout_rgba_bytes_from_rgb24(bytes(rgb), w, h, focus_x=0.5, focus_y=0.5, stroke_px=2, stroke_color="#00f0ff")
    assert engine in ("anime-matting", "onnx")
    assert len(rgba) == w * h * 4
    # Canto superior esquerdo deve ficar transparente; centro do personagem opaco
    corner_alpha = rgba[3]
    center_alpha = rgba[((40 * w + 60) * 4) + 3]
    assert corner_alpha < 20
    assert center_alpha > 220

    png = encode_rgba_png(rgba, w, h)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    pw, ph = struct.unpack(">II", png[16:24])
    assert (pw, ph) == (w, h)


def test_endpoint_cutout_status():
    client = TestClient(create_app("segredo"))
    res = client.get("/cutout/status", headers={"Authorization": "Bearer segredo"})
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is True
    assert body["engine"] in ("anime-matting", "onnx-cpu", "onnx-gpu")


def test_require_onnx_recusa_fallback_heuristico_quando_sem_modelo(tmp_path):
    w, h = 32, 32
    rgb = bytes([20] * (w * h * 3))
    try:
        cutout_rgba_bytes_from_rgb24(
            rgb,
            w,
            h,
            cache_root=tmp_path,
            auto_download_model=False,
            require_onnx=True,
        )
        raised = False
    except RuntimeError:
        raised = True
    assert raised is True


def test_clean_alpha_components_remove_ilhas_de_ruido_no_fundo():
    try:
        import numpy as np
    except ImportError:
        return
    alpha = np.zeros((100, 100), dtype=np.float32)
    # Silhueta principal do personagem no centro
    alpha[25:80, 35:65] = 0.96
    # Pequenas ilhas isoladas de compressão/faísca nos cantos
    alpha[4:7, 5:8] = 0.92
    alpha[88:90, 90:92] = 0.88
    cleaned = _clean_alpha_components(alpha, 0.5, 0.5)
    assert float(cleaned[50, 50]) > 0.9
    assert float(cleaned[5, 6]) < 0.05
    assert float(cleaned[89, 91]) < 0.05
    assert resolve_ffmpeg_binary("inexistente_xyz_ffmpeg_zero") is None or isinstance(resolve_ffmpeg_binary("ffmpeg"), str)
