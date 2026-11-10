"""SAM 2 video-mask propagation and alpha-sequence generation."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Callable

MODEL_CONFIG = "configs/sam2.1/sam2.1_hiera_t.yaml"
CHECKPOINT_NAME = "sam2.1_hiera_tiny.pt"
MAX_FRAMES = 180
MAX_SIDE = 1280


class SegmentationCancelled(Exception):
    pass


def checkpoint_path() -> Path:
    configured = os.environ.get("AMV_SAM2_CHECKPOINT")
    if configured:
        return Path(configured)
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "models" / CHECKPOINT_NAME
    return Path(__file__).resolve().parents[1] / "build" / "models" / CHECKPOINT_NAME


def _extract_frames(
    ffmpeg_path: str,
    media_path: Path,
    frames_dir: Path,
    start_s: float,
    duration_s: float,
    fps_num: int,
    fps_den: int,
    max_side: int,
    cancelled: threading.Event,
    on_progress: Callable[[float, float], None],
) -> list[Path]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    output = frames_dir / "%05d.jpg"
    scale = f"scale='min({max_side},iw)':'min({max_side},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
    args = [
        ffmpeg_path, "-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:1", "-nostats",
        "-ss", str(start_s), "-i", str(media_path), "-t", str(duration_s),
        "-vf", f"fps={fps_num}/{fps_den},{scale}", "-q:v", "1", "-start_number", "0", str(output),
    ]
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    try:
        assert process.stdout is not None
        for line in process.stdout:
            if cancelled.is_set():
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                raise SegmentationCancelled("recorte de quadros cancelado")
            key, _, value = line.strip().partition("=")
            if key == "out_time_us":
                on_progress(min(float(value) / 1e6, duration_s), duration_s)
        stderr = process.stderr.read() if process.stderr else ""
        if process.wait() != 0:
            raise RuntimeError(f"FFmpeg não conseguiu preparar os quadros: {stderr.strip()}")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        if process.stdout:
            process.stdout.close()
        if process.stderr:
            process.stderr.close()
    frames = sorted(frames_dir.glob("*.jpg"))
    if not frames:
        raise RuntimeError("o intervalo selecionado não contém quadros para segmentar")
    if len(frames) > MAX_FRAMES:
        raise ValueError(f"o intervalo contém {len(frames)} quadros; limite atual: {MAX_FRAMES}")
    return frames


def _load_predictor(checkpoint: Path) -> Any:
    try:
        import torch
        import numpy
        from PIL import Image
        from sam2.build_sam import build_sam2_video_predictor
    except ImportError as exc:
        raise RuntimeError("isolamento indisponível: o runtime SAM 2 não está instalado") from exc
    if not checkpoint.is_file():
        raise RuntimeError(f"checkpoint SAM 2.1 Tiny ausente: {checkpoint}")
    torch.set_num_threads(max(1, min(6, os.cpu_count() or 1)))
    predictor = build_sam2_video_predictor(MODEL_CONFIG, str(checkpoint), device="cpu")
    predictor.eval()
    return predictor


_predictor: Any | None = None
_predictor_lock = threading.Lock()


def _get_predictor() -> Any:
    global _predictor
    with _predictor_lock:
        if _predictor is None:
            _predictor = _load_predictor(checkpoint_path())
        return _predictor


def propagate_character(
    *,
    media_path: str,
    ffmpeg_path: str,
    output_dir: str,
    start_s: float,
    end_s: float,
    fps_num: int,
    fps_den: int,
    seed_frame: int,
    points: list[dict[str, float | int]],
    cache_key: str,
    cancelled: threading.Event,
    on_progress: Callable[[float, float], None],
    predictor_factory: Callable[[], Any] = _get_predictor,
) -> dict[str, Any]:
    media = Path(media_path)
    if not media.is_file():
        raise FileNotFoundError(f"arquivo de vídeo não encontrado: {media}")
    if not Path(ffmpeg_path).is_file():
        raise FileNotFoundError(f"FFmpeg empacotado não encontrado: {ffmpeg_path}")
    if end_s <= start_s:
        raise ValueError("o fim do intervalo deve ser posterior ao início")
    duration_s = end_s - start_s
    if duration_s > MAX_FRAMES * fps_den / fps_num:
        raise ValueError(f"o intervalo excede o limite de {MAX_FRAMES} quadros")
    if not points or not any(point["label"] == 1 for point in points):
        raise ValueError("adicione ao menos um ponto positivo sobre o personagem")
    if not re.fullmatch(r"[a-f0-9]{64}", cache_key):
        raise ValueError("chave de cache inválida")
    try:
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("isolamento indisponível: instale o extra segmentation") from exc

    destination = Path(output_dir).resolve()
    partial = destination.with_name(destination.name + ".partial")
    if destination.exists():
        manifest_path = destination / "manifest.json"
        if manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("cacheKey") == cache_key:
                return {**manifest, "outputDir": str(destination)}
        raise FileExistsError(f"já existe um resultado diferente em {destination}")
    if partial.exists():
        shutil.rmtree(partial)

    frames_dir = partial / "frames"
    rgba_dir = partial / "rgba"
    masks_dir = partial / "masks"
    partial.mkdir(parents=True)
    completed = False
    try:
        frames = _extract_frames(
            ffmpeg_path, media, frames_dir, start_s, duration_s, fps_num, fps_den, MAX_SIDE,
            cancelled, lambda done, total: on_progress(0.2 * done / max(total, 1e-6), 1.0),
        )
        if cancelled.is_set():
            raise SegmentationCancelled("segmentação cancelada")
        if len(frames) > MAX_FRAMES:
            raise ValueError(f"o intervalo excede o limite de {MAX_FRAMES} quadros")
        if seed_frame < 0 or seed_frame >= len(frames):
            raise ValueError("o quadro inicial está fora do intervalo escolhido")
        with Image.open(frames[0]) as first:
            width, height = first.size
        for point in points:
            if point["x"] < 0 or point["y"] < 0 or point["x"] >= width or point["y"] >= height:
                raise ValueError("um ponto de seleção está fora do quadro")
            if point["label"] not in (0, 1):
                raise ValueError("o tipo do ponto deve ser positivo (1) ou negativo (0)")

        if cancelled.is_set():
            raise SegmentationCancelled("segmentação cancelada")
        predictor = predictor_factory()
        if cancelled.is_set():
            raise SegmentationCancelled("segmentação cancelada")
        state = predictor.init_state(video_path=str(frames_dir), offload_video_to_cpu=True, offload_state_to_cpu=True)
        if cancelled.is_set():
            raise SegmentationCancelled("segmentação cancelada")
        point_coords = [[point["x"], point["y"]] for point in points]
        point_labels = [point["label"] for point in points]
        predictor.add_new_points_or_box(
            state, frame_idx=seed_frame, obj_id=1, points=point_coords, labels=point_labels,
            normalize_coords=True, clear_old_points=True,
        )
        logits_by_frame: dict[int, np.ndarray] = {}
        for reverse in (False, True):
            for frame_index, object_ids, logits in predictor.propagate_in_video(
                state, start_frame_idx=seed_frame, reverse=reverse,
            ):
                if cancelled.is_set():
                    raise SegmentationCancelled("propagação da máscara cancelada")
                if 1 in object_ids:
                    object_index = object_ids.index(1)
                    logits_by_frame[frame_index] = logits[object_index, 0].detach().cpu().float().numpy()
                    on_progress(0.2 + 0.55 * len(logits_by_frame) / len(frames), 1.0)
        if cancelled.is_set():
            raise SegmentationCancelled("propagação da máscara cancelada")
        if len(logits_by_frame) != len(frames):
            missing = sorted(set(range(len(frames))) - set(logits_by_frame))
            raise RuntimeError(f"o rastreamento não produziu máscara para {len(missing)} quadros")

        rgba_dir.mkdir()
        masks_dir.mkdir()
        review_frames: list[int] = []
        previous_area: float | None = None
        for frame_index, frame_path in enumerate(frames):
            logits = np.clip(logits_by_frame[frame_index], -12, 12)
            alpha = (255 / (1 + np.exp(-logits))).astype(np.uint8)
            area = float((logits > 0).mean())
            if area < 0.002 or area > 0.98 or (
                previous_area is not None and abs(area - previous_area) > max(0.08, previous_area * 0.75)
            ):
                review_frames.append(frame_index)
            previous_area = area
            with Image.open(frame_path) as source:
                rgba = source.convert("RGBA")
                if alpha.shape != (height, width):
                    alpha_image = Image.fromarray(alpha).resize((width, height), Image.Resampling.BILINEAR)
                else:
                    alpha_image = Image.fromarray(alpha)
                rgba.putalpha(alpha_image)
                rgba.save(rgba_dir / f"{frame_index:05d}.png")
                alpha_image.save(masks_dir / f"{frame_index:05d}.png")
            on_progress(0.75 + 0.25 * (frame_index + 1) / len(frames), 1.0)

        manifest = {
            "cacheKey": cache_key,
            "engine": "sam2.1-hiera-tiny",
            "engineVersion": "2b90b9f5ceec907a1c18123530e92e794ad901a4",
            "width": width,
            "height": height,
            "fps": {"num": fps_num, "den": fps_den},
            "frameCount": len(frames),
            "seedFrame": seed_frame,
            "reviewFrames": review_frames,
            "rgbaPattern": "rgba/%05d.png",
            "maskPattern": "masks/%05d.png",
        }
        (partial / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        frames_dir_path = partial / "frames"
        if frames_dir_path.exists():
            shutil.rmtree(frames_dir_path)
        partial.replace(destination)
        completed = True
        return {**manifest, "outputDir": str(destination)}
    finally:
        if not completed and partial.exists():
            shutil.rmtree(partial)
