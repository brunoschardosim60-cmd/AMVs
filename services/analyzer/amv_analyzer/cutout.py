"""Anime character cutout engine powered by IS-Net Anime ONNX (DirectML GPU / CPU) with moving VP9-alpha video and RGBA PNG output."""
from __future__ import annotations

from collections import deque
import hashlib
import importlib.util
import math
import os
import shutil
import struct
import subprocess
import sys
import threading
import urllib.request
import zlib
from pathlib import Path
from typing import Any

_session_lock = threading.Lock()
_download_lock = threading.Lock()
_cached_onnx: tuple[str, Any, list[str]] | None = None

ISNET_MODEL_FILENAME = "isnetis.onnx"
ISNET_MODEL_URLS: tuple[str, ...] = (
    "https://huggingface.co/skytnt/anime-seg/resolve/main/isnetis.onnx",
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx",
)
MIN_VALID_ONNX_BYTES = 40_000_000


def _default_user_models_dir() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "amv-studio" / "models"
    return Path.home() / ".cache" / "amv-studio" / "models"


def resolve_ffmpeg_binary(requested: str = "ffmpeg") -> str | None:
    if requested:
        req_path = Path(requested)
        if req_path.is_file():
            return str(req_path)
    env_ff = os.environ.get("AMV_FFMPEG")
    if env_ff and Path(env_ff).is_file():
        return env_ff
    env_dir = os.environ.get("AMV_FFMPEG_DIR")
    if env_dir:
        for name in ("ffmpeg.exe", "ffmpeg"):
            cand = Path(env_dir) / name
            if cand.is_file():
                return str(cand)

    exe = Path(sys.executable).resolve()
    search_dirs = [
        exe.parent,
        exe.parent.parent,
        exe.parent.parent.parent,
        Path(__file__).resolve().parents[3] / "apps" / "desktop" / "src-tauri" / "binaries",
    ]
    for folder in search_dirs:
        if not folder.is_dir():
            continue
        for name in ("ffmpeg.exe", "ffmpeg", "ffmpeg-x86_64-pc-windows-msvc.exe"):
            cand = folder / name
            if cand.is_file():
                return str(cand)

    return shutil.which(requested) or shutil.which("ffmpeg")


def cutout_model_path(extra_cache_dir: Path | None = None) -> Path | None:
    configured = os.environ.get("AMV_CUTOUT_MODEL")
    if configured and Path(configured).is_file():
        return Path(configured)
    roots: list[Path] = []
    if getattr(sys, "frozen", False):
        roots.append(Path(sys.executable).resolve().parent / "models")
    roots.append(Path(__file__).resolve().parents[1] / "build" / "models")
    if extra_cache_dir is not None:
        roots.append(extra_cache_dir / "models")
    roots.append(_default_user_models_dir())
    for root in roots:
        for name in ("isnetis.onnx", "isnet-anime.onnx", "birefnet-lite.onnx", "rmbg-1.4.onnx", "cutout.onnx"):
            candidate = root / name
            if candidate.is_file() and candidate.stat().st_size >= 1_000_000:
                return candidate
    return None


def ensure_cutout_model(cache_root: Path | None = None, *, auto_download: bool = True) -> Path | None:
    existing = cutout_model_path(cache_root)
    if existing is not None or not auto_download:
        return existing
    if importlib.util.find_spec("onnxruntime") is None:
        return None

    with _download_lock:
        existing = cutout_model_path(cache_root)
        if existing is not None:
            return existing
        target_dir = (cache_root / "models") if cache_root is not None else _default_user_models_dir()
        target_dir.mkdir(parents=True, exist_ok=True)
        dest = target_dir / ISNET_MODEL_FILENAME
        part = target_dir / f"{ISNET_MODEL_FILENAME}.{os.getpid()}.part"
        last_err: Exception | None = None
        for url in ISNET_MODEL_URLS:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "AMV-Studio/0.9"})
                total = 0
                with urllib.request.urlopen(req, timeout=90) as resp, part.open("wb") as out_f:
                    while True:
                        chunk = resp.read(256 * 1024)
                        if not chunk:
                            break
                        out_f.write(chunk)
                        total += len(chunk)
                if total < MIN_VALID_ONNX_BYTES:
                    raise RuntimeError(f"download incompleto do modelo de recorte ({total} bytes)")
                os.replace(part, dest)
                return dest
            except Exception as exc:
                last_err = exc
                try:
                    if part.exists():
                        part.unlink()
                except OSError:
                    pass
        if last_err is not None:
            raise RuntimeError(f"não foi possível baixar o modelo IS-Net Anime: {last_err}") from last_err
        return None


def cutout_engine_status() -> dict[str, Any]:
    model = cutout_model_path()
    providers: list[str] = []
    has_ort = importlib.util.find_spec("onnxruntime") is not None
    if has_ort:
        try:
            import onnxruntime as ort  # type: ignore
            providers = list(ort.get_available_providers())
        except Exception:
            has_ort = False
    has_dml = "DmlExecutionProvider" in providers
    has_cuda = "CUDAExecutionProvider" in providers
    engine = (
        "onnx-gpu"
        if (has_ort and (has_dml or has_cuda))
        else ("onnx-cpu" if has_ort else "anime-matting")
    )
    return {
        "available": True,
        "neuralReady": bool(has_ort and model is not None),
        "canAutoDownload": bool(has_ort),
        "engine": engine,
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
        raw_rows.append(0)
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


def _resize_bilinear_2d_or_3d(arr: Any, out_h: int, out_w: int) -> Any:
    import numpy as np  # type: ignore

    in_h, in_w = arr.shape[:2]
    if in_h == out_h and in_w == out_w:
        return arr.astype(np.float32)
    ys = np.linspace(0.0, max(0.0, in_h - 1.0), out_h, dtype=np.float32)
    xs = np.linspace(0.0, max(0.0, in_w - 1.0), out_w, dtype=np.float32)
    y0 = np.floor(ys).astype(np.int32)
    x0 = np.floor(xs).astype(np.int32)
    y1 = np.minimum(y0 + 1, in_h - 1)
    x1 = np.minimum(x0 + 1, in_w - 1)
    wy = (ys - y0).astype(np.float32)
    wx = (xs - x0).astype(np.float32)
    if arr.ndim == 3:
        wy = wy[:, None, None]
        wx = wx[None, :, None]
    else:
        wy = wy[:, None]
        wx = wx[None, :]
    src = arr.astype(np.float32)
    top = src[y0[:, None], x0[None, :]] * (1.0 - wx) + src[y0[:, None], x1[None, :]] * wx
    bot = src[y1[:, None], x0[None, :]] * (1.0 - wx) + src[y1[:, None], x1[None, :]] * wx
    return top * (1.0 - wy) + bot * wy


def _clean_alpha_components(alpha: Any, focus_x: float, focus_y: float) -> Any:
    """Remove ilhas de ruído isoladas no fundo e fecha pequenos buracos internos no personagem."""
    import numpy as np  # type: ignore

    h, w = alpha.shape
    scale = min(1.0, 220.0 / max(1, max(h, w)))
    gh = max(16, int(round(h * scale)))
    gw = max(16, int(round(w * scale)))
    small = _resize_bilinear_2d_or_3d(alpha, gh, gw)
    fg = small >= 0.22
    visited = np.zeros((gh, gw), dtype=bool)
    comps: list[tuple[list[tuple[int, int]], float]] = []
    fx = gh * max(0.15, min(0.85, focus_y))
    fy = gw * max(0.15, min(0.85, focus_x))

    for y in range(gh):
        for x in range(gw):
            if not fg[y, x] or visited[y, x]:
                continue
            q: deque[tuple[int, int]] = deque([(y, x)])
            visited[y, x] = True
            pts: list[tuple[int, int]] = []
            sum_y = 0.0
            sum_x = 0.0
            peak_a = 0.0
            while q:
                cy, cx = q.popleft()
                pts.append((cy, cx))
                sum_y += cy
                sum_x += cx
                val = float(small[cy, cx])
                if val > peak_a:
                    peak_a = val
                for ny in (cy - 1, cy, cy + 1):
                    if ny < 0 or ny >= gh:
                        continue
                    for nx in (cx - 1, cx, cx + 1):
                        if nx < 0 or nx >= gw or visited[ny, nx] or not fg[ny, nx]:
                            continue
                        visited[ny, nx] = True
                        q.append((ny, nx))
            cy_mean = sum_y / len(pts)
            cx_mean = sum_x / len(pts)
            dist_focus = math.hypot((cy_mean - fx) / gh, (cx_mean - fy) / gw)
            weight = len(pts) * (0.55 + 0.45 * peak_a) * max(0.35, 1.15 - dist_focus * 0.85)
            comps.append((pts, weight))

    if not comps:
        return alpha

    max_area = max(len(c[0]) for c in comps)
    best_weight = max(c[1] for c in comps)
    min_keep_area = max(6, int(gh * gw * 0.008))
    keep_grid = np.zeros((gh, gw), dtype=np.float32)
    for pts, weight in comps:
        if len(pts) >= max(min_keep_area, int(max_area * 0.16)) or weight >= best_weight * 0.32:
            for py, px in pts:
                keep_grid[py, px] = 1.0

    # Dilata 2 células na grade reduzida para preservar fios de cabelo, espadas e correntes conectados ao sujeito
    dil = keep_grid.copy()
    for _ in range(2):
        nxt = dil.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                sy0, sy1 = max(0, dy), gh + min(0, dy)
                sx0, sx1 = max(0, dx), gw + min(0, dx)
                nxt[sy0:sy1, sx0:sx1] = np.maximum(nxt[sy0:sy1, sx0:sx1], dil[sy0 - dy : sy1 - dy, sx0 - dx : sx1 - dx])
        dil = nxt

    keep_full = _resize_bilinear_2d_or_3d(dil, h, w)
    cleaned = alpha * np.clip(keep_full * 1.25, 0.0, 1.0)
    # Suaviza degraus de subamostragem apenas na borda semitransparente e zera névoa residual < 0.04
    cleaned = np.where(cleaned < 0.04, 0.0, np.where(cleaned > 0.965, 1.0, cleaned)).astype(np.float32)
    pad = np.pad(cleaned, 1, mode="edge")
    box3 = (
        pad[:-2, :-2] + pad[:-2, 1:-1] + pad[:-2, 2:]
        + pad[1:-1, :-2] + pad[1:-1, 1:-1] * 2.0 + pad[1:-1, 2:]
        + pad[2:, :-2] + pad[2:, 1:-1] + pad[2:, 2:]
    ) / 10.0
    edge_band = (cleaned > 0.03) & (cleaned < 0.94)
    return np.where(edge_band, box3, cleaned).astype(np.float32)


def _onnx_alpha_numpy(rgb_np: Any, model_path: Path, focus_x: float = 0.5, focus_y: float = 0.46) -> tuple[Any, str] | None:
    try:
        import numpy as np  # type: ignore

        sess, active_providers = _load_onnx_session(model_path)
        inp = sess.get_inputs()[0]
        shape = inp.shape
        target = int(shape[2]) if len(shape) >= 3 and isinstance(shape[2], int) and shape[2] > 0 else 1024
        h, w = rgb_np.shape[:2]
        scale = min(target / max(1, w), target / max(1, h))
        nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        resized = _resize_bilinear_2d_or_3d(rgb_np, nh, nw) / 255.0
        canvas = np.zeros((target, target, 3), dtype=np.float32)
        ox, oy = (target - nw) // 2, (target - nh) // 2
        canvas[oy : oy + nh, ox : ox + nw] = resized
        tensor = np.transpose(canvas, (2, 0, 1))[None, ...]
        outputs = sess.run(None, {inp.name: tensor})
        raw = outputs[0]
        mask = np.squeeze(raw).astype(np.float32)
        if mask.ndim == 3:
            mask = mask[0]
        if float(mask.min()) < -0.01 or float(mask.max()) > 1.05:
            mask = 1.0 / (1.0 + np.exp(-np.clip(mask, -20.0, 20.0)))
        cropped = np.clip(mask[oy : oy + nh, ox : ox + nw], 0.0, 1.0)
        alpha = np.clip(_resize_bilinear_2d_or_3d(cropped, h, w), 0.0, 1.0)
        if float((alpha >= 0.3).mean()) < 0.015:
            return None
        refined = _clean_alpha_components(alpha, focus_x, focus_y)
        is_gpu = any(p in active_providers for p in ("DmlExecutionProvider", "CUDAExecutionProvider"))
        return refined, ("onnx-gpu" if is_gpu else "onnx-cpu")
    except Exception:
        return None


def _compose_rgba_numpy(rgb_np: Any, alpha: Any, stroke_px: int, stroke_color: str) -> bytes:
    import numpy as np  # type: ignore

    h, w = alpha.shape
    # Descontaminação leve de cor na borda: puxa RGB de vizinhos internos mais opacos para eliminar halo escuro
    rgb_f = rgb_np.astype(np.float32)
    a_exp = alpha[:, :, None]
    prem = rgb_f * a_exp
    p_rgb = np.pad(prem, ((1, 1), (1, 1), (0, 0)), mode="edge")
    p_a = np.pad(alpha, 1, mode="edge")[:, :, None]
    sum_rgb = (
        p_rgb[:-2, :-2] + p_rgb[:-2, 1:-1] + p_rgb[:-2, 2:]
        + p_rgb[1:-1, :-2] + p_rgb[1:-1, 1:-1] + p_rgb[1:-1, 2:]
        + p_rgb[2:, :-2] + p_rgb[2:, 1:-1] + p_rgb[2:, 2:]
    )
    sum_a = (
        p_a[:-2, :-2] + p_a[:-2, 1:-1] + p_a[:-2, 2:]
        + p_a[1:-1, :-2] + p_a[1:-1, 1:-1] + p_a[1:-1, 2:]
        + p_a[2:, :-2] + p_a[2:, 1:-1] + p_a[2:, 2:]
    )
    decontam = np.where((a_exp > 0.04) & (a_exp < 0.88) & (sum_a > 0.25), sum_rgb / np.maximum(sum_a, 1e-4), rgb_f)
    clean_rgb = np.clip(decontam, 0.0, 255.0)

    if stroke_px > 0:
        dil = alpha.copy()
        r = max(1, min(8, int(stroke_px)))
        for dy in (-r, 0, r):
            for dx in (-r, 0, r):
                if dx == 0 and dy == 0:
                    continue
                shifted = np.zeros_like(alpha)
                sy0, sy1 = max(0, dy), h + min(0, dy)
                sx0, sx1 = max(0, dx), w + min(0, dx)
                shifted[sy0:sy1, sx0:sx1] = alpha[sy0 - dy : sy1 - dy, sx0 - dx : sx1 - dx]
                dil = np.maximum(dil, shifted)
        ring = np.clip(dil - alpha, 0.0, 1.0)
        sr, sg, sb = _parse_hex_rgb(stroke_color)
        total_a = np.clip(alpha + ring, 0.0, 1.0)
        safe_a = np.maximum(total_a, 1e-5)
        out = np.zeros((h, w, 4), dtype=np.uint8)
        out[:, :, 0] = np.clip((clean_rgb[:, :, 0] * alpha + sr * ring) / safe_a, 0, 255).astype(np.uint8)
        out[:, :, 1] = np.clip((clean_rgb[:, :, 1] * alpha + sg * ring) / safe_a, 0, 255).astype(np.uint8)
        out[:, :, 2] = np.clip((clean_rgb[:, :, 2] * alpha + sb * ring) / safe_a, 0, 255).astype(np.uint8)
        out[:, :, 3] = np.clip(total_a * 255.0, 0, 255).astype(np.uint8)
        return out.tobytes()

    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[:, :, :3] = clean_rgb.astype(np.uint8)
    out[:, :, 3] = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    return out.tobytes()


def _cutout_stdlib_synthetic_only(
    rgb_bytes: bytes,
    width: int,
    height: int,
    focus_x: float,
    focus_y: float,
    stroke_px: int,
    stroke_color: str,
) -> tuple[bytes, str]:
    """Usado exclusivamente em testes sintéticos de buffer quando ONNX não foi carregado."""
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
            alpha_buf[y * width + x] = max(0.0, min(1.0, (score - 0.24) / 0.32))

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
    stroke_px: int = 0,
    stroke_color: str = "#ffffff",
    cache_root: Path | None = None,
    auto_download_model: bool = False,
    require_onnx: bool = False,
) -> tuple[bytes, str]:
    if len(rgb_bytes) != width * height * 3:
        raise ValueError("buffer RGB24 inválido")
    if importlib.util.find_spec("numpy") is not None:
        import numpy as np  # type: ignore

        rgb_np = np.frombuffer(rgb_bytes, dtype=np.uint8).reshape((height, width, 3))
        model = ensure_cutout_model(cache_root, auto_download=auto_download_model)
        onnx_res = _onnx_alpha_numpy(rgb_np, model, focus_x, focus_y) if model is not None else None
        if onnx_res is not None:
            alpha, engine = onnx_res
            return _compose_rgba_numpy(rgb_np, alpha, stroke_px, stroke_color), engine
    if require_onnx:
        raise RuntimeError("recorte neural ONNX (IS-Net Anime) indisponível para este quadro")
    return _cutout_stdlib_synthetic_only(rgb_bytes, width, height, focus_x, focus_y, stroke_px, stroke_color)


def _parse_ppm_frame(data: bytes) -> tuple[int, int, bytes]:
    if not data.startswith(b"P6"):
        raise RuntimeError("formato PPM inesperado do FFmpeg")
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
    pos += 1
    w = int(tokens[0])
    h = int(tokens[1])
    expected = w * h * 3
    rgb_bytes = data[pos : pos + expected]
    if len(rgb_bytes) != expected:
        raise RuntimeError("quadro PPM truncado ao extrair imagem para recorte")
    return w, h, rgb_bytes


def extract_and_cutout_frame(
    *,
    media_path: str,
    ffmpeg_path: str,
    output_dir: str,
    time_s: float,
    focus_x: float = 0.5,
    focus_y: float = 0.46,
    stroke_px: int = 0,
    stroke_color: str = "#ffffff",
) -> dict[str, Any]:
    resolved_ff = resolve_ffmpeg_binary(ffmpeg_path)
    if not resolved_ff:
        raise RuntimeError("FFmpeg não encontrado para extrair o quadro de recorte")
    out_root = Path(output_dir)
    out_root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(
        f"v2|{media_path}|{time_s:.3f}|{focus_x:.2f}|{focus_y:.2f}|{stroke_px}|{stroke_color}".encode("utf-8")
    ).hexdigest()[:16]
    out_png = out_root / f"cutout-{digest}.png"
    if out_png.is_file() and out_png.stat().st_size > 128:
        header = out_png.read_bytes()[:24]
        if len(header) >= 24 and header[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", header[16:24])
            return {"path": str(out_png), "width": int(w), "height": int(h), "engine": "onnx-cache"}

    cmd = [
        resolved_ff, "-hide_banner", "-nostdin", "-loglevel", "error",
        "-ss", f"{max(0.0, time_s):.3f}", "-i", media_path,
        "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-f", "image2pipe", "-vcodec", "ppm", "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or len(proc.stdout) < 32:
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"FFmpeg não conseguiu extrair o quadro para recorte: {err}")

    w, h, rgb_bytes = _parse_ppm_frame(proc.stdout)
    rgba_bytes, engine = cutout_rgba_bytes_from_rgb24(
        rgb_bytes,
        w,
        h,
        focus_x=focus_x,
        focus_y=focus_y,
        stroke_px=stroke_px,
        stroke_color=stroke_color,
        cache_root=out_root.parent,
        auto_download_model=True,
        require_onnx=True,
    )
    part_png = out_root / f"cutout-{digest}.{os.getpid()}.part.png"
    part_png.write_bytes(encode_rgba_png(rgba_bytes, w, h))
    os.replace(part_png, out_png)
    return {"path": str(out_png), "width": w, "height": h, "engine": engine}


def extract_and_cutout_clip(
    *,
    media_path: str,
    ffmpeg_path: str,
    output_dir: str,
    start_s: float,
    duration_s: float,
    fps: float = 24.0,
    focus_x: float = 0.5,
    focus_y: float = 0.46,
    stroke_px: int = 0,
    stroke_color: str = "#ffffff",
) -> dict[str, Any]:
    """Segmenta quadro a quadro um trecho curto de vídeo com IS-Net Anime e gera WebM VP9 transparente (yuva420p)."""
    if importlib.util.find_spec("numpy") is None or importlib.util.find_spec("onnxruntime") is None:
        raise RuntimeError("onnxruntime e numpy são necessários para o recorte em vídeo de personagem")
    import numpy as np  # type: ignore

    resolved_ff = resolve_ffmpeg_binary(ffmpeg_path)
    if not resolved_ff:
        raise RuntimeError("FFmpeg não encontrado para recortar o clipe")

    out_root = Path(output_dir)
    out_root.mkdir(parents=True, exist_ok=True)
    safe_dur = max(0.12, min(2.5, float(duration_s)))
    safe_fps = max(12.0, min(30.0, float(fps)))
    digest = hashlib.sha256(
        f"clip-v2|{media_path}|{start_s:.3f}|{safe_dur:.3f}|{safe_fps:.2f}|{focus_x:.2f}|{focus_y:.2f}|{stroke_px}|{stroke_color}".encode("utf-8")
    ).hexdigest()[:16]
    out_webm = out_root / f"cutout-clip-{digest}.webm"
    if out_webm.is_file() and out_webm.stat().st_size > 512:
        return {"path": str(out_webm), "engine": "onnx-cache"}

    model = ensure_cutout_model(out_root.parent, auto_download=True)
    if model is None:
        raise RuntimeError("modelo IS-Net Anime indisponível")

    # Descobre a resolução escalada par (<= 960 px) com 1 quadro PPM rápido
    probe_cmd = [
        resolved_ff, "-hide_banner", "-nostdin", "-loglevel", "error",
        "-ss", f"{max(0.0, start_s):.3f}", "-i", media_path,
        "-frames:v", "1", "-vf", "scale='trunc(min(960,iw)/2)*2':'trunc(ow/a/2)*2'",
        "-f", "image2pipe", "-vcodec", "ppm", "pipe:1",
    ]
    probe_proc = subprocess.run(probe_cmd, capture_output=True)
    if probe_proc.returncode != 0 or len(probe_proc.stdout) < 32:
        raise RuntimeError("não foi possível medir o quadro do vídeo para recorte")
    w, h, _ = _parse_ppm_frame(probe_proc.stdout)
    frame_bytes_len = w * h * 3

    dec_cmd = [
        resolved_ff, "-hide_banner", "-nostdin", "-loglevel", "error",
        "-ss", f"{max(0.0, start_s):.3f}", "-t", f"{safe_dur + 0.04:.3f}", "-i", media_path,
        "-vf", f"fps={safe_fps:.4f}:round=near,scale={w}:{h}:flags=bilinear",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ]
    raw_proc = subprocess.run(dec_cmd, capture_output=True)
    if raw_proc.returncode != 0 or len(raw_proc.stdout) < frame_bytes_len:
        err = raw_proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"FFmpeg falhou ao decodificar trecho para recorte: {err}")

    total_frames = len(raw_proc.stdout) // frame_bytes_len
    if total_frames < 1:
        raise RuntimeError("nenhum quadro decodificado no intervalo do recorte")

    part_webm = out_root / f"cutout-clip-{digest}.{os.getpid()}.part.webm"
    enc_cmd = [
        resolved_ff, "-y", "-hide_banner", "-nostdin", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", f"{safe_fps:.4f}", "-i", "pipe:0",
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "21",
        "-deadline", "realtime", "-cpu-used", "4", "-auto-alt-ref", "0",
        str(part_webm),
    ]
    enc_proc = subprocess.Popen(enc_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    assert enc_proc.stdin is not None

    prev_rgb: Any | None = None
    prev_alpha: Any | None = None
    engine_used = "onnx-cpu"
    valid_frames = 0
    try:
        for idx in range(total_frames):
            chunk = raw_proc.stdout[idx * frame_bytes_len : (idx + 1) * frame_bytes_len]
            rgb_np = np.frombuffer(chunk, dtype=np.uint8).reshape((h, w, 3))
            res = _onnx_alpha_numpy(rgb_np, model, focus_x, focus_y)
            if res is None:
                alpha = prev_alpha if prev_alpha is not None else np.zeros((h, w), dtype=np.float32)
            else:
                alpha, engine_used = res
                valid_frames += 1
                if prev_alpha is not None and prev_rgb is not None:
                    diff = np.mean(np.abs(rgb_np.astype(np.float32) - prev_rgb), axis=2)
                    still = diff < 16.0
                    alpha = np.where(still, alpha * 0.82 + prev_alpha * 0.18, alpha).astype(np.float32)
            prev_rgb = rgb_np.astype(np.float32)
            prev_alpha = alpha
            rgba_frame = _compose_rgba_numpy(rgb_np, alpha, stroke_px, stroke_color)
            enc_proc.stdin.write(rgba_frame)
        enc_proc.stdin.close()
        stderr_bytes = enc_proc.stderr.read() if enc_proc.stderr else b""
        ret = enc_proc.wait(timeout=60)
        if ret != 0 or valid_frames == 0 or not part_webm.is_file():
            err_msg = stderr_bytes.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"falha ao codificar vídeo transparente de recorte: {err_msg or 'sem máscara válida'}")
        os.replace(part_webm, out_webm)
        return {"path": str(out_webm), "width": w, "height": h, "frames": total_frames, "engine": engine_used}
    except Exception:
        if enc_proc.poll() is None:
            enc_proc.kill()
            enc_proc.wait(timeout=5)
        try:
            if part_webm.exists():
                part_webm.unlink()
        except OSError:
            pass
        raise
