import threading

import pytest

np = pytest.importorskip("numpy")
torch = pytest.importorskip("torch")
Image = pytest.importorskip("PIL.Image")

from amv_analyzer import segmentation


class FakePredictor:
    def __init__(self, cancelled=None):
        self.cancelled = cancelled

    def init_state(self, **kwargs):
        return {}

    def add_new_points_or_box(self, *args, **kwargs):
        return None

    def propagate_in_video(self, state, *, start_frame_idx, reverse):
        indexes = range(2, -1, -1) if reverse else range(3)
        for index in indexes:
            values = np.full((1, 1, 8, 8), -8, dtype=np.float32)
            values[:, :, 2:6, 2:6] = 8
            yield index, [1], torch.from_numpy(values)
            if self.cancelled:
                self.cancelled.set()
                return


@pytest.fixture
def extracted_frames(tmp_path, monkeypatch):
    frames = tmp_path / "decoded"
    frames.mkdir()
    paths = []
    for index in range(3):
        path = frames / f"{index:05d}.jpg"
        Image.new("RGB", (8, 8), (index * 40, 0, 0)).save(path)
        paths.append(path)

    def extract(_ffmpeg, _media, _frames_dir, _start, _duration, _fps_num, _fps_den, _max_side, _cancelled, progress):
        progress(1, 1)
        return paths

    monkeypatch.setattr(segmentation, "_extract_frames", extract)
    return paths


def run_job(tmp_path, frames, predictor, progress=None):
    media = tmp_path / "source.mp4"
    ffmpeg = tmp_path / "ffmpeg.exe"
    media.touch()
    ffmpeg.touch()
    return segmentation.propagate_character(
        media_path=str(media),
        ffmpeg_path=str(ffmpeg),
        output_dir=str(tmp_path / "cutout"),
        start_s=0,
        end_s=1,
        fps_num=3,
        fps_den=1,
        seed_frame=1,
        points=[{"x": 3, "y": 3, "label": 1}],
        cache_key="b" * 64,
        cancelled=threading.Event(),
        on_progress=progress or (lambda _done, _total: None),
        predictor_factory=lambda: predictor,
    )


def test_propagates_masks_to_rgba_png_and_reuses_cache(tmp_path, extracted_frames):
    progress = []
    result = run_job(tmp_path, extracted_frames, FakePredictor(), lambda done, _total: progress.append(done))
    output = tmp_path / "cutout"
    assert result["frameCount"] == 3
    assert result["engine"] == "sam2.1-hiera-tiny"
    assert progress[0] == 0.2
    assert progress[-1] == 1
    assert all(previous <= current for previous, current in zip(progress, progress[1:]))
    with Image.open(output / "rgba" / "00001.png") as frame:
        assert frame.mode == "RGBA"
        assert frame.getpixel((3, 3))[3] > 250
        assert frame.getpixel((0, 0))[3] < 5
    with Image.open(output / "masks" / "00001.png") as mask:
        assert mask.mode == "L"
    assert run_job(tmp_path, extracted_frames, None)["outputDir"] == str(output)


def test_cancel_removes_incomplete_output(tmp_path, extracted_frames):
    cancelled = threading.Event()
    predictor = FakePredictor(cancelled)
    media = tmp_path / "source.mp4"
    ffmpeg = tmp_path / "ffmpeg.exe"
    media.touch()
    ffmpeg.touch()
    with pytest.raises(segmentation.SegmentationCancelled):
        segmentation.propagate_character(
            media_path=str(media),
            ffmpeg_path=str(ffmpeg),
            output_dir=str(tmp_path / "cancelled"),
            start_s=0,
            end_s=1,
            fps_num=3,
            fps_den=1,
            seed_frame=0,
            points=[{"x": 3, "y": 3, "label": 1}],
            cache_key="c" * 64,
            cancelled=cancelled,
            on_progress=lambda _done, _total: None,
            predictor_factory=lambda: predictor,
        )
    assert not (tmp_path / "cancelled").exists()
    assert not (tmp_path / "cancelled.partial").exists()
