"""Fast anime character frame cutout with ONNX DirectML GPU acceleration and zero-Pillow raw RGB24 + PNG RGBA pipeline."""
from __future__ import annotations

import hashlib
import importlib.util
import math
import os
import struct
import subprocess
import sys
import threading
import zlib
from pathlib import Path
from typing import Any

_session_lock = threading.Lock()
_cached_onnx: tuple[str, Any, list[str]] | None = None


def cutout_model_path() -> Path | None:
    configured = os.environ.get("AMV_CUTOUT_MODEL")
    if configured and Path(configured).is_file():
        return Path(configured)
    roots = []
    if getattr(sys, "frozen", False):
        roots.append(Path(sys.executable).resolve().parent / "models")
    roots.append(Path(__file__).resolve().parents[1] / "build" / "models")
    for root in roots:
        for name in ("birefnet-lite.onnx", "rmbg-1.4.onnx", "cutout.onnx", "isnetis.onnx"):
            candidate = root / name
            if candidate.is_file():
                return candidate
    return None


def cutout_engine_status() -> dict[str, Any]:
    model = cutout_model_path()
    providers: list[str] = []
    if importlib.util.find_spec("onnxruntime") is not None:
        try:
            import onnxruntime as ort  # type: ignore
            providers = list(ort.get_available_providers())
        except Exception:
            pass
    has_dml = "DmlExecutionProvider" in providers
    has_cuda = "CUDAExecutionProvider" in providers
    return {
        "available": True,
        "engine": "onnx-gpu" if (model and (has_dml or has_cuda)) else ("onnx-cpu" if model else "anime-matting"),
        "model": str(model.name) if model else None,
        "providers": providers,
    }


def _parse_hex_rgb(color: str) -> tuple[int, int, int]:
    c = color.strip().lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) != 6:
        return (255, 255, 255)
    try:
        return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))
    except ValueError:
        return (255, 255, 255)


def encode_rgba_png(rgba_bytes: bytes, width: int, height: int) -> bytes:
    """Codifica bytes RGBA8 em um PNG válido usando apenas stdlib (`struct` + `zlib`)."""
    stride = width * 4
    if len(rgba_bytes) != stride * height:
        raise ValueError("tamanho RGBA incompatível com width × height")
    raw_rows = bytearray()
    for y in range(height):
        raw_rows.append(0)  # filtro PNG None
        start = y * stride
        raw_rows.extend(rgba_bytes[start : start + stride])

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw_rows), level=6)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _load_onnx_session(model_path: Path) -> tuple[Any, list[str]]:
    global _cached_onnx
    key = str(model_path.resolve())
    with _session_lock:
        if _cached_onnx and _cached_onnx[0] == key:
            return _cached_onnx[1], _cached_onnx[2]
        import onnxruntime as ort  # type: ignore

        avail = ort.get_available_providers()
        preferred = [p for p in ("DmlExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider") if p in avail]
        sess = ort.InferenceSession(str(model_path), providers=preferred or ["CPUExecutionProvider"])
        active = list(sess.get_providers())
        _cached_onnx = (key, sess, active)
        return sess, active


def _onnx_alpha_numpy(rgb_np: Any, model_path: Path) -> Any | None:
    try:
        import numpy as np  # type: ignore

        sess, _ = _load_onnx_session(model_path)
        inp = sess.get_inputs()[0]
        shape = inp.shape
        target = int(shape[2]) if isinstance(shape[2], int) and shape[2] > 0 else 640
        h, w = rgb_np.shape[:2]
        scale = min(target / max(1, w), target / max(1, h))
        nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        yy = np.clip(np.round(np.linspace(0, h - 1, nh)).astype(np.int32), 0, h - 1)
        xx = np.clip(np.round(np.linspace(0, w - 1, nw)).astype(np.int32), 0, w - 1)
        resized = rgb_np[yy[:, None], xx[None, :]].astype(np.float32) / 255.0
        canvas = np.zeros((target, target, 3), dtype=np.float32)
        ox, oy = (target - nw) // 2, (target - nh) // 2
        canvas[oy : oy + nh, ox : ox + nw] = resized
        tensor = np.transpose(canvas, (2, 0, 1))[None, ...]
        raw = sess.run(None, {inp.name: tensor})[0]
        mask = np.squeeze(raw).astype(np.float32)
        if mask.min() < 0 or mask.max() > 1.05:
            mask = 1.0 / (1.0 + np.exp(-np.clip(mask, -20, 20)))
        cropped = mask[oy : oy + nh, ox : ox + nw]
        iy = np.clip(np.round(np.linspace(0, nh - 1, h)).astype(np.int32), 0, nh - 1)
        ix = np.clip(np.round(np.linspace(0, nw - 1, w)).astype(np.int32), 0, nw - 1)
        alpha = np.clip(cropped[iy[:, None], ix[None, :]], 0.0, 1.0)
        if float((alpha >= 0.35).mean()) < 0.03:
            return None
        return alpha
    except Exception:
        return None


def _cutout_numpy(
    rgb_bytes: bytes,
    width: int,
    height: int,
    focus_x: float,
    focus_y: float,
    stroke_px: int,
    stroke_color: str,
) -> tuple[bytes, str]:
    import numpy as np  # type: ignore

    rgb_np = np.frombuffer(rgb_bytes, dtype=np.uint8).reshape((height, width, 3))
    model = cutout_model_path()
    alpha = _onnx_alpha_numpy(rgb_np, model) if model else None
    engine = "onnx" if alpha is not None else "anime-matting"
    if alpha is None:
        arr = rgb_np.astype(np.float32) / 255.0
        bw = max(2, int(round(width * 0.07)))
        bh = max(2, int(round(height * 0.07)))
        borders = np.concatenate(
            [
                arr[:bh, :, :].reshape(-1, 3),
                arr[:, :bw, :].reshape(-1, 3),
                arr[:, width - bw :, :].reshape(-1, 3),
            ],
            axis=0,
        )
        q20, q50, q80 = np.percentile(borders, [20, 50, 80], axis=0)
        bg_dist = np.minimum(
            np.minimum(np.linalg.norm(arr - q20[None, None, :], axis=2), np.linalg.norm(arr - q50[None, None, :], axis=2)),
            np.linalg.norm(arr - q80[None, None, :], axis=2),
        )
        gray = 0.2126 * arr[:, :, 0] + 0.7152 * arr[:, :, 1] + 0.0722 * arr[:, :, 2]
        gx = np.zeros_like(gray)
        gy = np.zeros_like(gray)
        gx[:, 1:-1] = np.abs(gray[:, 2:] - gray[:, :-2])
        gy[1:-1, :] = np.abs(gray[2:, :] - gray[:-2, :])
        edges = np.clip((gx + gy) * 2.4, 0.0, 1.0)
        yy, xx = np.mgrid[0:height, 0:width]
        nx = (xx / max(1.0, width - 1.0) - focus_x) / 0.33
        ny = (yy / max(1.0, height - 1.0) - focus_y) / 0.46
        ellipse = np.clip(1.35 - (nx * nx + ny * ny), 0.0, 1.0)
        score = (np.clip(bg_dist * 2.5, 0.0, 1.2) + edges * 0.45) * (0.25 + 0.75 * ellipse)
        alpha = np.clip((score - 0.25) / 0.32, 0.0, 1.0)
        core = np.clip(1.0 - (nx * nx * 2.2 + ny * ny * 2.0), 0.0, 1.0)
        alpha = np.maximum(alpha, core * np.clip(bg_dist * 3.0 + edges, 0.0, 1.0)).astype(np.float32)

    if stroke_px > 0:
        dil = alpha.copy()
        r = max(1, min(8, int(stroke_px)))
        for dy in (-r, 0, r):
            for dx in (-r, 0, r):
                if dx == 0 and dy == 0:
                    continue
                shifted = np.zeros_like(alpha)
                sy0, sy1 = max(0, dy), height + min(0, dy)
                sx0, sx1 = max(0, dx), width + min(0, dx)
                shifted[sy0:sy1, sx0:sx1] = alpha[sy0 - dy : sy1 - dy, sx0 - dx : sx1 - dx]
                dil = np.maximum(dil, shifted)
        ring = np.clip(dil - alpha, 0.0, 1.0)
        sr, sg, sb = _parse_hex_rgb(stroke_color)
        total_a = np.clip(alpha + ring, 0.0, 1.0)
        safe_a = np.maximum(total_a, 1e-5)
        out = np.zeros((height, width, 4), dtype=np.uint8)
        out[:, :, 0] = np.clip((rgb_np[:, :, 0] * alpha + sr * ring) / safe_a, 0, 255).astype(np.uint8)
        out[:, :, 1] = np.clip((rgb_np[:, :, 1] * alpha + sg * ring) / safe_a, 0, 255).astype(np.uint8)
        out[:, :, 2] = np.clip((rgb_np[:, :, 2] * alpha + sb * ring) / safe_a, 0, 255).astype(np.uint8)
        out[:, :, 3] = np.clip(total_a * 255.0, 0, 255).astype(np.uint8)
        return out.tobytes(), engine

    out = np.dstack([rgb_np, np.clip(alpha * 255.0, 0, 255).astype(np.uint8)])
    return out.tobytes(), engine


def _cutout_stdlib(
    rgb_bytes: bytes,
    width: int,
    height: int,
    focus_x: float,
    focus_y: float,
    stroke_px: int,
    stroke_color: str,
) -> tuple[bytes, str]:
    """Fallback 100% stdlib Python quando nem NumPy está instalado."""
    bw = max(1, int(width * 0.07))
    bh = max(1, int(height * 0.07))
    r_sum = g_sum = b_sum = count = 0
    for y in range(0, bh, 2):
        for x in range(0, width, 4):
            idx = (y * width + x) * 3
            r_sum += rgb_bytes[idx]
            g_sum += rgb_bytes[idx + 1]
            b_sum += rgb_bytes[idx + 2]
            count += 1
    bg_r = (r_sum / max(1, count)) / 255.0
    bg_g = (g_sum / max(1, count)) / 255.0
    bg_b = (b_sum / max(1, count)) / 255.0
    sr, sg, sb = _parse_hex_rgb(stroke_color)
    alpha_buf = [0.0] * (width * height)
    for y in range(height):
        ny = (y / max(1.0, height - 1.0) - focus_y) / 0.46
        for x in range(width):
            nx = (x / max(1.0, width - 1.0) - focus_x) / 0.33
            idx = (y * width + x) * 3
            r = rgb_bytes[idx] / 255.0
            g = rgb_bytes[idx + 1] / 255.0
            b = rgb_bytes[idx + 2] / 255.0
            dist = math.sqrt((r - bg_r) ** 2 + (g - bg_g) ** 2 + (b - bg_b) ** 2)
            ell = max(0.0, min(1.0, 1.35 - (nx * nx + ny * ny)))
            score = min(1.2, dist * 2.5) * (0.25 + 0.75 * ell)
            a = max(0.0, min(1.0, (score - 0.24) / 0.32))
            alpha_buf[y * width + x] = a

    out = bytearray(width * height * 4)
    rad = max(0, min(4, int(stroke_px)))
    for y in range(height):
        for x in range(width):
            p = y * width + x
            a = alpha_buf[p]
            ring = 0.0
            if rad > 0 and a < 0.98:
                dmax = a
                for dy in (-rad, 0, rad):
                    yy = y + dy
                    if 0 <= yy < height:
                        for dx in (-rad, 0, rad):
                            xx = x + dx
                            if 0 <= xx < width:
                                v = alpha_buf[yy * width + xx]
                                if v > dmax:
                                    dmax = v
                ring = max(0.0, dmax - a)
            ta = min(1.0, a + ring)
            idx3 = p * 3
            idx4 = p * 4
            if ta > 1e-4:
                out[idx4] = min(255, int((rgb_bytes[idx3] * a + sr * ring) / ta))
                out[idx4 + 1] = min(255, int((rgb_bytes[idx3 + 1] * a + sg * ring) / ta))
                out[idx4 + 2] = min(255, int((rgb_bytes[idx3 + 2] * a + sb * ring) / ta))
                out[idx4 + 3] = min(255, int(ta * 255))
    return bytes(out), "anime-matting"


def cutout_rgba_bytes_from_rgb24(
    rgb_bytes: bytes,
    width: int,
    height: int,
    *,
    focus_x: float = 0.5,
    focus_y: float = 0.46,
    stroke_px: int = 4,
    stroke_color: str = "#ffffff",
) -> tuple[bytes, str]:
    if len(rgb_bytes) != width * height * 3:
        raise ValueError("buffer RGB24 inválido")
    if importlib.util.find_spec("numpy") is not None:
        return _cutout_numpy(rgb_bytes, width, height, focus_x, focus_y, stroke_px, stroke_color)
    return _cutout_stdlib(rgb_bytes, width, height, focus_x, focus_y, stroke_px, stroke_color)


def extract_and_cutout_frame(
    *,
    media_path: str,
    ffmpeg_path: str,
    output_dir: str,
    time_s: float,
    focus_x: float = 0.5,
    focus_y: float = 0.46,
    stroke_px: int = 4,
    stroke_color: str = "#ffffff",
) -> dict[str, Any]:
    out_root = Path(output_dir)
    out_root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(
        f"{media_path}|{time_s:.3f}|{focus_x:.2f}|{focus_y:.2f}|{stroke_px}|{stroke_color}".encode("utf-8")
    ).hexdigest()[:16]
    out_png = out_root / f"cutout-{digest}.png"
    if out_png.is_file() and out_png.stat().st_size > 128:
        header = out_png.read_bytes()[:24]
        if len(header) >= 24 and header[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", header[16:24])
            return {"path": str(out_png), "width": int(w), "height": int(h), "engine": "cache"}

    # Descobre a dimensão escalada via ffprobe ou extrai em largura fixa par 960x540 mantendo proporção via PPM
    cmd = [
        ffmpeg_path, "-hide_banner", "-nostdin", "-loglevel", "error",
        "-ss", f"{max(0.0, time_s):.3f}", "-i", media_path,
        "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-f", "image2pipe", "-vcodec", "ppm", "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or len(proc.stdout) < 32:
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"FFmpeg não conseguiu extrair o quadro para recorte: {err}")

    data = proc.stdout
    if not data.startswith(b"P6"):
        raise RuntimeError("formato PPM inesperado do FFmpeg")
    # Parse cabeçalho PPM P6 (ignorando comentários #)
    pos = 2
    tokens: list[bytes] = []
    while len(tokens) < 3 and pos < len(data):
        while pos < len(data) and data[pos] in b" \t\r\n":
            pos += 1
        if pos < len(data) and data[pos : pos + 1] == b"#":
            while pos < len(data) and data[pos : pos + 1] != b"\n":
                pos += 1
            continue
        start = pos
        while pos < len(data) and data[pos] not in b" \t\r\n":
            pos += 1
        if pos > start:
            tokens.append(data[start:pos])
    pos += 1  # único byte de whitespace após maxval (255)
    w = int(tokens[0])
    h = int(tokens[1])
    rgb_bytes = data[pos : pos + w * h * 3]
    rgba_bytes, engine = cutout_rgba_bytes_from_rgb24(
        rgb_bytes,
        w,
        h,
        focus_x=focus_x,
        focus_y=focus_y,
        stroke_px=stroke_px,
        stroke_color=stroke_color,
    )
    png_bytes = encode_rgba_png(rgba_bytes, w, h)
    out_png.write_bytes(png_bytes)
    return {"path": str(out_png), "width": w, "height": h, "engine": engine}
