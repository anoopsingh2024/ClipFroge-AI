import argparse
import json
import math
import os
import random
import subprocess
import sys
import wave
import struct
import time
from pathlib import Path

import cv2
import numpy as np
from faster_whisper import WhisperModel

# ============================================================
# CLIPFORGE AI - AUTO HIGHLIGHTS + MUSIC + FILTERS + ANIMATION
# ============================================================
BASE_DIR = Path(__file__).resolve().parent.parent
FFMPEG = os.environ.get("CLIPFORGE_FFMPEG", r"C:\ffmpeg\bin\ffmpeg.exe")
FFPROBE = os.environ.get("CLIPFORGE_FFPROBE", r"C:\ffmpeg\bin\ffprobe.exe")
OUTPUT_DIR = BASE_DIR / "outputs"
TEMP_DIR = OUTPUT_DIR / "_analysis"
MUSIC_DIR = BASE_DIR / "music"
MUSIC_CATALOG = MUSIC_DIR / "catalog.json"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

MAX_CLIPS = 10
MIN_CLIP_DURATION = 30.0
MAX_CLIP_DURATION = 60.0
MIN_INTEREST_SCORE = float(os.environ.get("CLIPFORGE_MIN_SCORE", "16"))
WHISPER_MODEL_NAME = os.environ.get("CLIPFORGE_WHISPER_MODEL", "small")
PROCESS_DEADLINE = None
MUSIC_SELECTION_COUNTER = 0

BACKGROUND_BLUR_RADIUS = max(
    1, int(os.environ.get("CLIPFORGE_BACKGROUND_BLUR", "35"))
)
BACKGROUND_BLUR_PASSES = max(
    1, int(os.environ.get("CLIPFORGE_BACKGROUND_BLUR_PASSES", "2"))
)
BACKGROUND_PALETTES = [
    ("black-orange", (20, 10, 4), (0, 115, 255)),
    ("emerald-green", (8, 42, 18), (70, 190, 95)),
    ("navy-cyan", (48, 18, 8), (230, 160, 35)),
    ("purple-pink", (65, 20, 55), (210, 105, 235)),
    ("charcoal-lime", (24, 27, 16), (90, 210, 175)),
    ("deep-blue-gold", (55, 24, 12), (40, 165, 245)),
    ("teal-coral", (40, 65, 12), (105, 115, 245)),
    ("burgundy-amber", (35, 12, 42), (35, 145, 255)),
    ("slate-mint", (38, 35, 25), (145, 210, 115)),
    ("indigo-sunset", (65, 24, 38), (80, 105, 245)),
]
EFFECT_INTENSITY = os.environ.get(
    "CLIPFORGE_EFFECT_INTENSITY", "medium"
).strip().lower()
if EFFECT_INTENSITY not in {"low", "medium", "high"}:
    EFFECT_INTENSITY = "medium"

FILTER_PRESETS = {
    "cinematic_teal_orange": (
        "eq=contrast=1.08:saturation=1.05:gamma=0.98,"
        "colorbalance=rs=0.035:gs=0.006:bs=-0.025"
    ),
    "hollywood_warm": (
        "eq=contrast=1.06:saturation=1.04:brightness=0.008:gamma=1.01,"
        "colorbalance=rs=0.035:gs=0.012:bs=-0.018"
    ),
    "dark_cinematic": (
        "eq=contrast=1.12:brightness=-0.035:saturation=0.94:gamma=0.96,"
        "colorbalance=bs=0.025:rs=-0.012"
    ),
    "moody_blue": (
        "eq=contrast=1.08:brightness=-0.018:saturation=0.94:gamma=0.98,"
        "colorbalance=bs=0.055:gs=0.008:rs=-0.025"
    ),
    "film_look": (
        "eq=contrast=1.05:saturation=1.02:gamma=0.99,"
        "curves=all='0/0 0.25/0.21 0.75/0.79 1/1'"
    ),
    "vintage_cinema": (
        "eq=contrast=1.03:saturation=0.84:brightness=0.012:gamma=1.02,"
        "colorbalance=rs=0.035:gs=0.008:bs=-0.025"
    ),
    "dramatic_contrast": (
        "eq=contrast=1.16:saturation=1.03:brightness=-0.012:gamma=0.96"
    ),
    "vibrant": "eq=contrast=1.05:saturation=1.16:gamma=1.01",
    "natural": "eq=contrast=1.02:saturation=1.03:brightness=0.004",
    "warm": (
        "eq=contrast=1.04:saturation=1.03:gamma=1.01,"
        "colorbalance=rs=0.028:gs=0.008:bs=-0.015"
    ),
    "cool": (
        "eq=contrast=1.04:saturation=0.98:gamma=1.01,"
        "colorbalance=bs=0.035:rs=-0.015"
    ),
    "bright": "eq=brightness=0.035:contrast=1.02:gamma=1.02",
    "soft": "eq=contrast=0.96:saturation=0.98:brightness=0.012:gamma=1.02",
    "high_contrast": "eq=contrast=1.14:saturation=1.04:gamma=0.97",
    "rich_colors": "eq=contrast=1.06:saturation=1.12:gamma=1.0",
    "clean_creator": "eq=contrast=1.04:saturation=1.06:brightness=0.006",
    "modern_lifestyle": (
        "eq=contrast=1.05:saturation=1.08:brightness=0.008:gamma=1.01,"
        "colorbalance=rs=0.012:bs=-0.008"
    ),
    "travel_look": "eq=contrast=1.07:saturation=1.10:brightness=0.01:gamma=1.02",
    "professional_portrait": (
        "eq=contrast=1.03:saturation=1.02:brightness=0.006:gamma=1.01,"
        "colorbalance=rs=0.012:gs=0.004:bs=-0.008"
    ),
    "gaming_punchy": "eq=contrast=1.13:saturation=1.15:brightness=0.004:gamma=0.98",
    "retro": (
        "eq=contrast=0.98:saturation=0.82:brightness=0.018:gamma=1.03,"
        "colorbalance=rs=0.045:gs=0.01:bs=-0.03"
    ),
    "vintage": "curves=vintage,eq=contrast=1.02:saturation=0.86:gamma=1.02",
    "dreamy_glow": (
        "eq=brightness=0.012:contrast=0.98:saturation=1.01,"
        "unsharp=5:5:0.22:3:3:0.08"
    ),
    "neon": "eq=contrast=1.12:saturation=1.22:gamma=0.98",
    "black_white": "hue=s=0,eq=contrast=1.08:gamma=0.98",
    "sepia": (
        "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:"
        ".272:.534:.131,eq=contrast=1.03:brightness=0.012"
    ),
    "soft_glow": (
        "eq=brightness=0.018:contrast=0.98:saturation=1.01,"
        "unsharp=5:5:0.18:3:3:0.05"
    ),
    "hdr_style": "eq=contrast=1.12:saturation=1.10:gamma=0.96",
}

EFFECT_PRESETS = {
    "smooth_zoom_in": None,
    "smooth_zoom_out": None,
    "dynamic_punch_in": None,
    "subtle_camera_movement": None,
    "subtle_shake": (
        "crop=iw-8:ih-8:x='4+2*sin(2*PI*t*1.7)':"
        "y='4+2*cos(2*PI*t*1.3)',scale=720:1280:flags=lanczos"
    ),
    "flash_transition": "eq=brightness=0.018",
    "fade_in_out": None,
    "cinematic_vignette": "vignette=PI/5",
    "soft_glow": "unsharp=5:5:0.18:3:3:0.05",
    "motion_blur": "tblend=all_mode=average:all_opacity=0.16",
    "rgb_split": "rgbashift=rh=2:bh=-2",
    "light_leak": "eq=brightness=0.012:saturation=1.03",
    "film_grain": "noise=alls=4:allf=t+u",
    "slow_motion": None,
}

INTEREST_WORDS = {
    "amazing", "important", "secret", "why", "how", "best", "worst",
    "never", "always", "mistake", "problem", "solution", "truth",
    "finally", "surprise", "wow", "unbelievable", "incredible",
    "देखो", "क्यों", "कैसे", "सच", "गलती", "जरूरी", "कमाल",
    "शानदार", "खास", "ध्यान", "अरे", "वाह"
}
MOOD_WORDS = {
    "funny": {"funny", "joke", "laugh", "comedy", "haha", "मजेदार", "हंसी"},
    "motivational": {"success", "goal", "motivation", "believe", "hard", "work",
                     "मेहनत", "सफलता", "मंजिल", "हौसला"},
    "cinematic": {"amazing", "beautiful", "incredible", "story", "emotional",
                  "खूबसूरत", "भावुक", "कहानी"},
    "calm": {"peace", "relax", "calm", "nature", "शांति", "आराम", "प्रकृति"},
}


def log(message):
    print(message, file=sys.stderr, flush=True)


def check_deadline():
    if PROCESS_DEADLINE is not None and time.monotonic() >= PROCESS_DEADLINE:
        raise TimeoutError("ClipForge processing time limit reached.")


def run_command(command):
    check_deadline()
    timeout = None if PROCESS_DEADLINE is None else max(1, PROCESS_DEADLINE - time.monotonic())
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=timeout
        )
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError("Processing time limit reached during FFmpeg operation.") from exc
    if result.returncode != 0:
        details = result.stderr or result.stdout or "Unknown FFmpeg error"
        raise RuntimeError(details[-7000:])
    return result.stdout


def probe_streams(video_path):
    raw = run_command([
        FFPROBE, "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(video_path)
    ])
    data = json.loads(raw)
    streams = data.get("streams", [])
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video_stream:
        raise RuntimeError("Input does not contain a video stream.")
    return data, video_stream, any(s.get("codec_type") == "audio" for s in streams)


def get_video_duration(video_path):
    raw = run_command([
        FFPROBE, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)
    ]).strip()
    duration = float(raw)
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("Could not determine video duration.")
    return duration


def normalized(values):
    if not values:
        return []
    low, high = min(values), max(values)
    if high - low < 1e-9:
        return [0.0] * len(values)
    return [max(0.0, min(1.0, (float(v) - low) / (high - low))) for v in values]


def second_range(start, end, length):
    first = max(0, int(math.floor(start)))
    last = min(length, int(math.ceil(end)))
    return range(first, max(first, last))


def extract_audio_energy(video_path, duration, has_audio):
    count = int(math.ceil(duration))
    if not has_audio:
        return [0.0] * count
    wav_path = TEMP_DIR / (Path(video_path).stem + "_analysis.wav")
    try:
        run_command([
            FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video_path),
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav_path)
        ])
        values = []
        with wave.open(str(wav_path), "rb") as wav:
            rate = wav.getframerate()
            for _ in range(count):
                frames = wav.readframes(rate)
                if not frames:
                    values.append(0.0)
                    continue
                usable = len(frames) // 2
                samples = struct.unpack("<" + "h" * usable, frames[:usable * 2])
                values.append(math.sqrt(sum(x * x for x in samples) / max(1, len(samples))))
        return values
    except Exception as exc:
        log("Audio analysis skipped: " + str(exc))
        return [0.0] * count
    finally:
        wav_path.unlink(missing_ok=True)


def analyze_visual_motion(video_path, duration):
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError("OpenCV could not open the input video.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    count = int(math.ceil(duration))
    motion = [0.0] * count
    previous = None
    step = 8 if duration < 600 else 12
    try:
        for sec in range(0, count, step):
            check_deadline()
            frame_no = min(int(sec * fps), max(0, total_frames - 1))
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
            ok, frame = cap.read()
            if not ok:
                continue
            gray = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2GRAY)
            score = 0.0 if previous is None else float(cv2.absdiff(gray, previous).mean())
            for offset in range(step):
                if sec + offset < count:
                    motion[sec + offset] = score
            previous = gray
    finally:
        cap.release()
    return motion


def detect_scenes(video_path, duration):
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return []
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = 8 if duration >= 600 else 5
    interval = max(1, int(fps * step))
    previous, markers = None, []
    try:
        for frame_no in range(0, max(total, 1), interval):
            check_deadline()
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
            ok, frame = cap.read()
            if not ok:
                continue
            gray = cv2.cvtColor(cv2.resize(frame, (96, 54)), cv2.COLOR_BGR2GRAY)
            if previous is not None and cv2.absdiff(gray, previous).mean() > 32:
                markers.append(frame_no / fps)
            previous = gray
    finally:
        cap.release()
    log(f"Scene changes detected: {len(markers)}")
    return markers


def build_timeline(duration, energy, motion, scene_markers):
    bins = int(math.ceil(duration))
    energy_norm = normalized((energy + [0.0] * bins)[:bins])
    motion_norm = normalized((motion + [0.0] * bins)[:bins])
    scene_signal = [0.0] * bins
    for marker in scene_markers:
        idx = int(marker)
        if 0 <= idx < bins:
            scene_signal[idx] = 1.0
            if idx > 0:
                scene_signal[idx - 1] = max(scene_signal[idx - 1], 0.5)
    timeline = []
    for sec in range(bins):
        score = 0.45 * energy_norm[sec] + 0.35 * motion_norm[sec] + 0.20 * scene_signal[sec]
        timeline.append({
            "time": sec, "speech": round(energy_norm[sec], 4),
            "audioEnergy": round(energy_norm[sec], 4),
            "visualMotion": round(motion_norm[sec], 4),
            "sceneChange": round(scene_signal[sec], 4),
            "keywordCue": 0.0, "interest": round(score, 4)
        })
    return timeline


def score_candidates(duration, timeline):
    if duration < MIN_CLIP_DURATION or not timeline:
        return []
    candidates = []
    for length in (6.0, 8.0, 10.0, 12.0, 15.0):
        start = 0.0
        while start + length <= duration:
            end = start + length
            rows = [timeline[i] for i in second_range(start, end, len(timeline))]
            if rows:
                values = sorted(row["interest"] for row in rows)
                mean_score = sum(values) / len(values)
                peak_score = values[min(len(values) - 1, int(len(values) * 0.75))]
                active_ratio = sum(value >= 0.20 for value in values) / len(values)
                speech_score = sum(row["speech"] for row in rows) / len(rows)
                score = (
                    0.55 * mean_score
                    + 0.20 * peak_score
                    + 0.15 * active_ratio
                    + 0.10 * speech_score
                )
                candidates.append({
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "duration": length,
                    "interestScore": round(score * 100, 1),
                    "features": {
                        "meanInterest": round(mean_score, 3),
                        "peakInterest": round(peak_score, 3),
                        "activeRatio": round(active_ratio, 3),
                        "speech": round(speech_score, 3)
                    }
                })
            start += 2.0

    if not candidates:
        return []

    candidates.sort(
        key=lambda item: (item["interestScore"], item["duration"]),
        reverse=True
    )
    percentile_index = min(len(candidates) - 1, int(len(candidates) * 0.60))
    threshold = max(MIN_INTEREST_SCORE, candidates[percentile_index]["interestScore"])
    ranked = [item for item in candidates if item["interestScore"] >= threshold]
    fallback_ranked = [item for item in candidates if item["interestScore"] < threshold]

    # Keep short, high-interest source moments independent; assemble them into
    # watchable 30-60 second montages instead of returning source-time windows.
    selected_segments = []

    def add_non_overlapping(items, required_duration=None):
        source_duration = sum(item["duration"] for item in selected_segments)
        for item in items:
            if any(
                item["start"] < old["end"] + 0.25
                and item["end"] > old["start"] - 0.25
                for old in selected_segments
            ):
                continue
            selected_segments.append(item)
            source_duration += item["duration"]
            if len(selected_segments) >= MAX_CLIPS * 12:
                break
            if required_duration is not None and source_duration >= required_duration:
                break

    add_non_overlapping(ranked)
    minimum_source_duration = MIN_CLIP_DURATION + 3.0
    if sum(item["duration"] for item in selected_segments) < minimum_source_duration:
        add_non_overlapping(
            fallback_ranked,
            required_duration=minimum_source_duration
        )

    selected_segments.sort(key=lambda item: item["interestScore"], reverse=True)
    used = set()
    montages = []
    transition = 0.28
    for _ in range(MAX_CLIPS):
        available = [
            (index, item) for index, item in enumerate(selected_segments)
            if index not in used
        ]
        if not available:
            break

        chosen = []
        output_duration = 0.0
        for index, item in available:
            next_duration = output_duration + item["duration"]
            if chosen:
                next_duration -= transition
            if next_duration > MAX_CLIP_DURATION:
                continue
            chosen.append((index, item))
            output_duration = next_duration
            if output_duration >= 40.0:
                break

        if output_duration < MIN_CLIP_DURATION:
            break

        for index, _ in chosen:
            used.add(index)
        parts = sorted((item for _, item in chosen), key=lambda item: item["start"])
        weighted_score = sum(
            item["interestScore"] * item["duration"] for item in parts
        ) / sum(item["duration"] for item in parts)
        montages.append({
            "start": parts[0]["start"],
            "end": parts[-1]["end"],
            "duration": round(output_duration, 2),
            "interestScore": round(weighted_score, 1),
            "features": {
                "segments": len(parts),
                "meanInterest": round(
                    sum(item["features"]["meanInterest"] for item in parts) / len(parts), 3
                )
            },
            "segments": [
                {"start": item["start"], "end": item["end"]}
                for item in parts
            ]
        })
    if not montages and duration <= MAX_CLIP_DURATION:
        values = [row["interest"] for row in timeline]
        average_score = sum(values) / len(values)
        montages.append({
            "start": 0.0,
            "end": round(duration, 2),
            "duration": round(duration, 2),
            "interestScore": round(average_score * 100, 1),
            "features": {"fallback": "source-too-short-to-build-montage"},
            "segments": [{"start": 0.0, "end": round(duration, 2)}]
        })
    return montages


def transcribe_selected_clips(video_path, clips, has_audio):
    if not has_audio or not clips:
        return [], "none"
    log(f"Loading Whisper model: {WHISPER_MODEL_NAME}")
    model = WhisperModel(WHISPER_MODEL_NAME, device="cpu", compute_type="int8")
    transcript, language = [], "unknown"
    for index, clip in enumerate(clips, 1):
        check_deadline()
        source_parts = clip.get("segments") or [
            {"start": clip["start"], "end": clip["end"]}
        ]
        for part_index, part in enumerate(source_parts, 1):
            part_start = float(part["start"])
            part_duration = float(part["end"]) - part_start
            wav_path = TEMP_DIR / (
                f"{Path(video_path).stem}-clip-{index:02d}-part-{part_index:02d}.wav"
            )
            try:
                run_command([
                    FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
                    "-ss", str(part_start), "-i", str(video_path),
                    "-t", str(part_duration), "-vn", "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", str(wav_path)
                ])
                segments, info = model.transcribe(
                    str(wav_path),
                    language=None,
                    task="transcribe",
                    word_timestamps=True,
                    vad_filter=True,
                    beam_size=5,
                    temperature=0.0,
                    condition_on_previous_text=True,
                    compression_ratio_threshold=2.4,
                    log_prob_threshold=-1.0,
                    no_speech_threshold=0.6,
                )
                language = getattr(info, "language", None) or language
                for segment in segments:
                    words = [{
                        "text": word.word.strip(),
                        "start": float(word.start) + part_start,
                        "end": float(word.end) + part_start
                    } for word in (segment.words or [])]
                    transcript.append({
                        "start": float(segment.start) + part_start,
                        "end": float(segment.end) + part_start,
                        "text": segment.text.strip(), "words": words
                    })
            finally:
                wav_path.unlink(missing_ok=True)
    return transcript, language


def ass_time(seconds):
    total = max(0, int(round(seconds * 100)))
    return f"{total // 360000}:{(total % 360000) // 6000:02d}:{(total % 6000) // 100:02d}.{total % 100:02d}"


def escape_ass(value):
    return value.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", " ")


def create_ass_captions(transcript, clip_start, clip_end, ass_path, source_segments=None):
    header = r"""[Script Info]
Title: ClipForge AI Captions
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
PlayResX: 720
PlayResY: 1280
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,47,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,43,43,220,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    count = 0
    source_parts = source_segments or [{"start": clip_start, "end": clip_end}]
    output_cursor = 0.0
    for part_index, part in enumerate(source_parts):
        part_start = float(part["start"])
        part_end = float(part["end"])
        words = []
        for segment in transcript:
            for word in segment.get("words", []):
                if word["end"] <= part_start or word["start"] >= part_end:
                    continue
                source_start = max(float(word["start"]), part_start)
                source_end = min(float(word["end"]), part_end)
                words.append({
                    "text": word["text"],
                    "start": output_cursor + source_start - part_start,
                    "end": output_cursor + source_end - part_start,
                    "sourceStart": source_start
                })
        words.sort(key=lambda word: word["sourceStart"])
        for offset in range(0, len(words), 4):
            group = words[offset:offset + 4]
            if not group:
                continue
            start = group[0]["start"]
            end = group[-1]["end"]
            if end <= start:
                continue
            caption_parts = []
            for word in group:
                centiseconds = max(1, int((word["end"] - word["start"]) * 100))
                caption_parts.append(rf"{{\kf{centiseconds}}}{escape_ass(word['text'])}")
            caption = r"{\an2\bord5\shad3\fscx88\fscy88\t(0,120,\fscx108\fscy108)\t(120,220,\fscx100\fscy100)}" + " ".join(caption_parts)
            lines.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{caption}")
            count += 1
        output_cursor += part_end - part_start
        if part_index < len(source_parts) - 1:
            output_cursor -= 0.28
    ass_path.write_text("\n".join(lines), encoding="utf-8-sig")
    return count


def escape_filter_path(file_path):
    value = str(Path(file_path).resolve()).replace("\\", "/")
    return value.replace(":", r"\:").replace("'", r"\'")


def analyze_profile(video_path):
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError("Could not analyze video profile.")
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    samples = []
    sample_count = min(12, max(1, total))
    try:
        for i in range(sample_count):
            pos = int(i * max(total - 1, 0) / max(sample_count - 1, 1))
            cap.set(cv2.CAP_PROP_POS_FRAMES, pos)
            ok, frame = cap.read()
            if ok:
                small = cv2.resize(frame, (160, 90))
                hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
                gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                samples.append((float(hsv[:, :, 2].mean()), float(hsv[:, :, 1].mean()), float(gray.std())))
    finally:
        cap.release()
    if samples:
        brightness = sum(x[0] for x in samples) / len(samples)
        saturation = sum(x[1] for x in samples) / len(samples)
        contrast = sum(x[2] for x in samples) / len(samples)
    else:
        brightness, saturation, contrast = 128.0, 100.0, 50.0
    return {
        "width": width, "height": height, "fps": round(fps, 2),
        "brightness": round(brightness, 2), "saturation": round(saturation, 2),
        "contrast": round(contrast, 2)
    }


def choose_visual_treatment(profile, interest_score, mood):
    """Choose one restrained grade and a few mood-appropriate effects."""
    brightness = profile["brightness"]
    saturation = profile["saturation"]
    contrast = profile["contrast"]

    if mood == "funny":
        filter_name = "vibrant" if saturation < 125 else "clean_creator"
        effects = ["dynamic_punch_in", "subtle_shake"]
    elif mood == "motivational":
        filter_name = "hollywood_warm" if brightness < 185 else "dramatic_contrast"
        effects = ["smooth_zoom_in", "flash_transition"]
    elif mood == "calm":
        filter_name = "soft" if saturation > 70 else "professional_portrait"
        effects = ["smooth_zoom_in", "fade_in_out", "soft_glow"]
    else:
        filter_name = "cinematic_teal_orange"
        effects = ["smooth_zoom_in", "cinematic_vignette", "film_grain"]

    if brightness < 75:
        filter_name = "bright" if mood == "calm" else "hollywood_warm"
    elif brightness > 220:
        filter_name = "dark_cinematic" if mood == "cinematic" else "natural"
    elif saturation > 180:
        filter_name = "natural"

    if contrast < 28 and "soft_glow" not in effects:
        effects.append("soft_glow")
    if interest_score >= 80 and mood in {"funny", "motivational"}:
        effects.append("dynamic_punch_in")

    if EFFECT_INTENSITY == "low":
        effects = effects[:1]
    elif EFFECT_INTENSITY == "medium":
        effects = effects[:3]
    else:
        effects = effects[:4]

    return filter_name, list(dict.fromkeys(effects))


def build_effect_filters(effect_names, duration, mood):
    """Resolve metadata effect names into safe FFmpeg filters."""
    filters = []
    for name in effect_names:
        if name in {"smooth_zoom_in", "dynamic_punch_in", "smooth_zoom_out", "slow_motion"}:
            continue
        if name == "fade_in_out":
            filters.extend([
                "fade=t=in:st=0:d=0.45",
                f"fade=t=out:st={max(0.45, duration - 0.65):.3f}:d=0.65",
            ])
            continue
        if name == "flash_transition":
            filters.append("eq=brightness=0.018")
            continue
        preset = EFFECT_PRESETS.get(name)
        if preset:
            filters.append(preset)
    if mood == "calm" and "fade_in_out" not in effect_names:
        filters.extend([
            "fade=t=in:st=0:d=0.35",
            f"fade=t=out:st={max(0.35, duration - 0.55):.3f}:d=0.55",
        ])
    return filters


def zoom_expression(mood, effect_names):
    if "smooth_zoom_out" in effect_names:
        return (
            "min(1.035,1.035-0.025*(0.5-0.5*cos(2*PI*on/240)))"
        )
    if mood == "funny" or "dynamic_punch_in" in effect_names:
        return "min(1.055,1+0.035*(0.5-0.5*cos(2*PI*on/180)))"
    return "min(1.045,1+0.025*(0.5-0.5*cos(2*PI*on/240)))"


def create_clip_background(output_path, index):
    """Create a repeatable, varied gradient palette for each rendered highlight."""
    name, start_bgr, end_bgr = BACKGROUND_PALETTES[(index - 1) % len(BACKGROUND_PALETTES)]
    height, width = 1280, 720
    y, x = np.mgrid[0:height, 0:width].astype(np.float32)
    blend = np.clip((y / (height - 1)) * 0.7 + (x / (width - 1)) * 0.3, 0, 1)
    start = np.asarray(start_bgr, dtype=np.float32)
    end = np.asarray(end_bgr, dtype=np.float32)
    gradient = start[None, None, :] * (1 - blend[:, :, None]) + end[None, None, :] * blend[:, :, None]

    glow = np.exp(
        -(((x - width * 0.72) / (width * 0.58)) ** 2
          + ((y - height * 0.28) / (height * 0.38)) ** 2)
    )[:, :, None]
    gradient = np.clip(gradient + glow * np.asarray(end_bgr, dtype=np.float32)[None, None, :] * 0.18, 0, 255)
    if not cv2.imwrite(str(output_path), gradient.astype(np.uint8)):
        raise RuntimeError(f"Unable to create background gradient: {output_path}")
    return name, f"#{start_bgr[2]:02x}{start_bgr[1]:02x}{start_bgr[0]:02x}", f"#{end_bgr[2]:02x}{end_bgr[1]:02x}{end_bgr[0]:02x}"


def classify_mood(transcript, clip, timeline):
    text = " ".join(
        seg.get("text", "").lower() for seg in transcript
        if seg["end"] > clip["start"] and seg["start"] < clip["end"]
    )
    tokens = set(text.split())
    for mood in ("funny", "motivational", "cinematic", "calm"):
        if tokens.intersection(MOOD_WORDS[mood]) or any(
            cue in text for cue in MOOD_WORDS[mood] if len(cue) > 3
        ):
            return mood
    rows = [r for r in timeline if clip["start"] <= r["time"] < clip["end"]]
    if not rows:
        return "cinematic"
    avg_motion = sum(r["visualMotion"] for r in rows) / len(rows)
    avg_energy = sum(r["audioEnergy"] for r in rows) / len(rows)
    if avg_motion > 0.55 or avg_energy > 0.60:
        return "motivational"
    if avg_motion < 0.20 and avg_energy < 0.20:
        return "calm"
    return "cinematic"


def is_valid_audio_file(path):
    """Return True only when FFprobe confirms the file has an audio stream."""
    if not path.is_file():
        return False
    try:
        raw = subprocess.run(
            [FFPROBE, "-v", "error", "-select_streams", "a:0",
             "-show_entries", "stream=codec_type", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15
        )
        return raw.returncode == 0 and "audio" in raw.stdout.lower()
    except Exception as exc:
        log("Music validation failed: " + str(exc))
        return False


def choose_music_track(mood):
    """
    Prefer eligible tracks from catalog.json.
    If no catalog track is eligible, use the user's local motivational.mp3.
    The fallback's license is not assumed; user must verify usage rights.
    """
    allowed = {"CC0", "PUBLIC_DOMAIN", "ROYALTY_FREE_COMMERCIAL"}
    valid = []

    if MUSIC_CATALOG.is_file():
        try:
            catalog = json.loads(MUSIC_CATALOG.read_text(encoding="utf-8-sig"))
            tracks = catalog if isinstance(catalog, list) else catalog.get("tracks", []) if isinstance(catalog, dict) else []
            for item in tracks:
                if not isinstance(item, dict) or item.get("commercial_use") is not True:
                    continue
                license_type = str(item.get("license_type") or item.get("licenseType") or "").upper()
                if license_type not in allowed:
                    continue
                filename = item.get("filename", "")
                if not isinstance(filename, str) or not filename or Path(filename).name != filename:
                    continue
                track_path = MUSIC_DIR / filename
                if not is_valid_audio_file(track_path):
                    log("Catalog music missing or invalid: " + filename)
                    continue
                moods = item.get("moods", item.get("mood", []))
                if isinstance(moods, str):
                    moods = [moods]
                moods = [str(x).strip().lower() for x in moods] if isinstance(moods, list) else []
                valid.append((track_path, item, mood.lower() in moods))
        except Exception as exc:
            log("Music catalog could not be read: " + str(exc))

    global MUSIC_SELECTION_COUNTER
    exact = [entry for entry in valid if entry[2]]
    candidates = exact or valid
    chosen = None
    if candidates:
        offset = MUSIC_SELECTION_COUNTER % len(candidates)
        chosen = [candidates[offset]]
        MUSIC_SELECTION_COUNTER += 1
    if chosen:
        track_path, metadata, _ = chosen[0]
        log(f"Background music selected from catalog: {track_path.name}")
        return track_path, {
            "filename": track_path.name,
            "title": metadata.get("title", track_path.stem),
            "licenseType": metadata.get("license_type") or metadata.get("licenseType"),
            "attribution": metadata.get("attribution", ""),
            "mood": mood,
            "source": "catalog"
        }

    # Local fallback for the file supplied by the user.
    fallback = MUSIC_DIR / "motivational.mp3"
    if is_valid_audio_file(fallback):
        log("Background music selected: motivational.mp3")
        return fallback, {
            "filename": fallback.name,
            "title": "motivational",
            "licenseType": "User-provided; verify usage rights",
            "attribution": "Check the original music license and attribution requirements.",
            "mood": mood,
            "source": "local-fallback"
        }

    log("No valid background music found. Expected music/motivational.mp3 or an eligible catalog track.")
    return None, None


def _render_clip_part(input_path, clip, index, transcript, profile, timeline, output_dir, has_audio):
    stem = Path(input_path).stem
    clip_name = f"{stem}-highlight-{index:02d}.mp4"
    output_path = output_dir / clip_name
    ass_path = output_dir / f"{stem}-highlight-{index:02d}.ass"
    background_path = output_dir / f"{stem}-highlight-{index:02d}-background.png"
    background_name, background_color_start, background_color_end = create_clip_background(
        background_path, index
    )

    mood = classify_mood(transcript, clip, timeline)
    filter_name, effects = choose_visual_treatment(
        profile, clip["interestScore"], mood
    )
    music_path, music_info = choose_music_track(mood)
    caption_count = create_ass_captions(transcript, clip["start"], clip["end"], ass_path)
    duration = float(clip["duration"])
    blur = (
        f"luma_radius={BACKGROUND_BLUR_RADIUS}:"
        f"luma_power={BACKGROUND_BLUR_PASSES}:"
        f"chroma_radius={BACKGROUND_BLUR_RADIUS}:"
        f"chroma_power={BACKGROUND_BLUR_PASSES}"
    )
    zoom = zoom_expression(mood, effects)

    video_chain = (
        "[0:v]split=2[bgsrc][fgsrc];"
        "[bgsrc]scale=720:1280:force_original_aspect_ratio=increase,"
        f"crop=720:1280,boxblur={blur},"
        "eq=brightness=-0.025:saturation=0.98[bg];"
        "[1:v]scale=720:1280,format=rgba[palette];"
        "[bg][palette]blend=all_mode=normal:all_opacity=0.72[coloredbg];"
        "[fgsrc]scale=720:1280:force_original_aspect_ratio=decrease[fg];"
        "[coloredbg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,"
        f"zoompan=z='{zoom}':"
        "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=24[vbase]"
    )
    filters = [FILTER_PRESETS[filter_name]]
    filters.extend(build_effect_filters(effects, duration, mood))
    if caption_count:
        filters.append(f"ass=filename='{escape_filter_path(ass_path)}'")
    filters.append("format=yuv420p")
    video_chain += ";[vbase]" + ",".join(filters) + "[vout]"

    command = [
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        "-ss", str(clip["start"]), "-i", str(input_path)
    ]
    command += ["-loop", "1", "-framerate", "24", "-i", str(background_path)]
    music_input_index = 2
    if music_path:
        command += ["-stream_loop", "-1", "-i", str(music_path)]
    command += ["-t", str(duration)]

    if has_audio and music_path:
        audio_chain = (
            f"[0:a:0]atrim=duration={duration},asetpts=PTS-STARTPTS,"
            "aresample=44100,volume=1.0[voice];"
            f"[{music_input_index}:a:0]atrim=duration={duration},asetpts=PTS-STARTPTS,"
            "aresample=44100,volume=0.12,"
            "afade=t=in:st=0:d=1.0,"
            f"afade=t=out:st={max(0.0, duration - 2.0)}:d=2.0[music];"
            "[voice][music]amix=inputs=2:duration=first:dropout_transition=2,"
            "loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
        )
        command += ["-filter_complex", video_chain + ";" + audio_chain,
                    "-map", "[vout]", "-map", "[aout]"]
    elif has_audio:
        command += [
            "-filter_complex", video_chain, "-map", "[vout]", "-map", "0:a:0",
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11"
        ]
    elif music_path:
        audio_chain = (
            f"[{music_input_index}:a:0]atrim=duration={duration},asetpts=PTS-STARTPTS,"
            "aresample=44100,volume=0.16,afade=t=in:st=0:d=1.0,"
            f"afade=t=out:st={max(0.0, duration - 2.0)}:d=2.0,"
            "loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
        )
        command += ["-filter_complex", video_chain + ";" + audio_chain,
                    "-map", "[vout]", "-map", "[aout]"]
    else:
        command += ["-filter_complex", video_chain, "-map", "[vout]", "-an"]

    command += [
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24",
        "-r", "24", "-threads", "0", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        "-movflags", "+faststart", str(output_path)
    ]
    try:
        run_command(command)
    finally:
        ass_path.unlink(missing_ok=True)
        background_path.unlink(missing_ok=True)

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError(f"FFmpeg did not create output clip: {clip_name}")

    return {
        "filename": clip_name, "path": f"/outputs/{clip_name}",
        "duration": clip["duration"], "start": clip["start"], "end": clip["end"],
        "interestScore": clip["interestScore"], "features": clip.get("features", {}),
        "mood": mood, "music": music_info, "captionCount": caption_count,
        "autoEdited": True,
        "framing": "9:16-blurred-background-with-fitted-foreground",
        "filter": filter_name,
        "backgroundStyle": background_name,
        "backgroundColors": [background_color_start, background_color_end],
        "selectedEffects": effects,
        "effects": effects,
        "backgroundBlur": {
            "enabled": True,
            "intensity": BACKGROUND_BLUR_RADIUS,
            "passes": BACKGROUND_BLUR_PASSES,
            "scope": "background-layer-only"
        },
        "animation": "mood-aware-smooth-zoom-on-final-composition"
    }


def render_clip(input_path, clip, index, transcript, profile, timeline, output_dir, has_audio):
    source_parts = clip.get("segments") or [
        {"start": clip["start"], "end": clip["end"]}
    ]
    stem = Path(input_path).stem
    clip_name = f"{stem}-highlight-{index:02d}.mp4"
    output_path = output_dir / clip_name
    temp_dir = output_dir / f".{stem}-highlight-{index:02d}-parts"
    temp_dir.mkdir(parents=True, exist_ok=True)
    rendered_parts = []
    part_metadata = []
    transition_duration = 0.28
    render_completed = False

    try:
        for part_index, part in enumerate(source_parts, 1):
            part_clip = {
                "start": float(part["start"]),
                "end": float(part["end"]),
                "duration": round(float(part["end"]) - float(part["start"]), 2),
                "interestScore": clip["interestScore"],
                "features": clip.get("features", {})
            }
            metadata = _render_clip_part(
                input_path,
                part_clip,
                index * 100 + part_index,
                transcript,
                profile,
                timeline,
                temp_dir,
                has_audio
            )
            rendered_parts.append(temp_dir / metadata["filename"])
            part_metadata.append(metadata)

        input_args = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y"]
        video_filters = []
        audio_filters = []
        durations = []
        audio_presence = []
        for part_index, part_path in enumerate(rendered_parts):
            input_args.extend(["-i", str(part_path)])
            durations.append(get_video_duration(part_path))
            audio_presence.append(probe_streams(part_path)[2])
            video_filters.append(
                f"[{part_index}:v:0]fps=24,format=yuv420p,settb=AVTB,"
                f"setpts=PTS-STARTPTS[v{part_index}]"
            )
            if audio_presence[-1]:
                audio_filters.append(
                    f"[{part_index}:a:0]aresample=44100,"
                    f"aformat=sample_fmts=fltp:channel_layouts=stereo,"
                    f"asetpts=PTS-STARTPTS[a{part_index}]"
                )

        joined_video = "v0"
        montage_duration = durations[0]
        for part_index in range(1, len(rendered_parts)):
            offset = montage_duration - transition_duration
            joined_label = f"vjoin{part_index}"
            video_filters.append(
                f"[{joined_video}][v{part_index}]"
                f"xfade=transition=fade:duration={transition_duration}:"
                f"offset={offset:.3f}[{joined_label}]"
            )
            montage_duration += durations[part_index] - transition_duration
            joined_video = joined_label
        video_filters.append(f"[{joined_video}]format=yuv420p[vout]")

        if any(audio_presence) and not all(audio_presence):
            raise RuntimeError("Rendered montage parts have inconsistent audio streams.")
        if audio_presence and all(audio_presence):
            joined_audio = "a0"
            for part_index in range(1, len(rendered_parts)):
                joined_label = f"ajoin{part_index}"
                audio_filters.append(
                    f"[{joined_audio}][a{part_index}]"
                    f"acrossfade=d={transition_duration}:c1=tri:c2=tri"
                    f"[{joined_label}]"
                )
                joined_audio = joined_label
            audio_filters.append(f"[{joined_audio}]anull[aout]")

        input_args.extend([
            "-t", f"{montage_duration:.3f}",
            "-filter_complex", ";".join(video_filters + audio_filters),
            "-map", "[vout]"
        ])
        if audio_presence and all(audio_presence):
            input_args.extend(["-map", "[aout]"])
        else:
            input_args.append("-an")
        input_args.extend([
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24",
            "-r", "24", "-threads", "0", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
            "-movflags", "+faststart", str(output_path)
        ])
        run_command(input_args)
        render_completed = True
    finally:
        for part_path in rendered_parts:
            part_path.unlink(missing_ok=True)
        for temp_file in temp_dir.iterdir():
            temp_file.unlink(missing_ok=True)
        temp_dir.rmdir()
        if not render_completed:
            output_path.unlink(missing_ok=True)

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError(f"FFmpeg did not create montage clip: {clip_name}")

    first = part_metadata[0]
    return {
        **first,
        "filename": clip_name,
        "path": f"/outputs/{clip_name}",
        "duration": round(montage_duration, 2),
        "start": clip["start"],
        "end": clip["end"],
        "interestScore": clip["interestScore"],
        "features": clip.get("features", {}),
        "segments": source_parts,
        "montage": len(source_parts) > 1,
        "transitions": max(0, len(source_parts) - 1),
        "backgroundStyles": [item["backgroundStyle"] for item in part_metadata],
        "filter": ", ".join(dict.fromkeys(item["filter"] for item in part_metadata)),
        "selectedEffects": list(dict.fromkeys(
            effect for item in part_metadata for effect in item["selectedEffects"]
        )),
        "effects": list(dict.fromkeys(
            effect for item in part_metadata for effect in item["effects"]
        )),
        "animation": "animated-crossfade-cuts-with-mood-aware-zoom"
    }


def process_video(input_path):
    global PROCESS_DEADLINE
    started = time.monotonic()
    input_path = Path(input_path).resolve()

    if not Path(FFMPEG).is_file():
        raise RuntimeError("FFmpeg not found: " + FFMPEG)
    if not Path(FFPROBE).is_file():
        raise RuntimeError("FFprobe not found: " + FFPROBE)
    if not input_path.is_file():
        raise RuntimeError("Input video not found: " + str(input_path))

    _, _, has_audio = probe_streams(input_path)
    duration = get_video_duration(input_path)
    if duration < MIN_CLIP_DURATION:
        raise RuntimeError(f"Source video must be at least {MIN_CLIP_DURATION:.0f} seconds.")

    configured_timeout = os.environ.get("CLIPFORGE_PROCESS_TIMEOUT_SECONDS", "").strip()
    if configured_timeout:
        try:
            budget = int(configured_timeout)
            if budget < 60:
                raise ValueError
        except ValueError as exc:
            raise RuntimeError("CLIPFORGE_PROCESS_TIMEOUT_SECONDS must be an integer >= 60.") from exc
    else:
        budget = max(600, min(3600, int(duration * 1.5)))
    PROCESS_DEADLINE = started + budget

    log(f"Processing {duration:.1f}s video | max clips={MAX_CLIPS} | audio={has_audio}")
    energy = extract_audio_energy(input_path, duration, has_audio)
    motion = analyze_visual_motion(input_path, duration)
    scenes = detect_scenes(input_path, duration)
    profile = analyze_profile(input_path)
    timeline = build_timeline(duration, energy, motion, scenes)
    clips = score_candidates(duration, timeline)

    if not clips:
        raise RuntimeError(
            "No highlight candidates found. Try lowering CLIPFORGE_MIN_SCORE "
            "in backend/.env (for example, CLIPFORGE_MIN_SCORE=10)."
        )

    transcript, language = transcribe_selected_clips(input_path, clips, has_audio)
    for clip in clips:
        source_parts = clip.get("segments") or [
            {"start": clip["start"], "end": clip["end"]}
        ]
        text_for_clip = " ".join(
            seg.get("text", "") for seg in transcript
            if any(
                seg["end"] > part["start"] and seg["start"] < part["end"]
                for part in source_parts
            )
        ).lower()
        keyword_hits = sum(1 for word in INTEREST_WORDS if word in text_for_clip)
        clip["features"]["keywordHits"] = keyword_hits
        if keyword_hits:
            clip["interestScore"] = round(min(99.0, clip["interestScore"] + min(8, keyword_hits * 1.5)), 1)

    for row in timeline:
        row["selectedClip"] = any(
            part["start"] <= row["time"] < part["end"]
            for clip in clips
            for part in clip.get("segments", [{"start": clip["start"], "end": clip["end"]}])
        )

    log(f"Selected {len(clips)} highlight(s). Rendering...")
    random.shuffle(BACKGROUND_PALETTES)
    rendered = []
    for index, clip in enumerate(clips, 1):
        check_deadline()
        log(f"Rendering {index}/{len(clips)}: {clip['start']:.1f}-{clip['end']:.1f}s score={clip['interestScore']}")
        rendered.append(render_clip(
            input_path, clip, index, transcript, profile, timeline, OUTPUT_DIR, has_audio
        ))

    check_deadline()
    PROCESS_DEADLINE = None
    return {
        "success": True, "language": language, "duration": round(duration, 2),
        "hasAudio": has_audio, "sceneChangesDetected": len(scenes),
        "totalClips": len(rendered), "maxClips": MAX_CLIPS, "clips": rendered,
        "timeline": timeline, "videoProfile": profile,
        "analysis": {
            "signals": ["audioEnergy", "visualMotion", "sceneChanges", "selectedClip"],
            "minimumInterestScore": MIN_INTEREST_SCORE,
            "backgroundBlur": {
                "enabled": True,
                "intensity": BACKGROUND_BLUR_RADIUS,
                "passes": BACKGROUND_BLUR_PASSES,
            },
            "effectIntensity": EFFECT_INTENSITY,
            "note": "Heuristic audio/visual highlight ranking; not human-level semantic understanding."
        },
        "filename": rendered[0]["filename"], "clipStart": rendered[0]["start"],
        "clipEnd": rendered[0]["end"],
        "captionCount": sum(item["captionCount"] for item in rendered)
    }


def main():
    parser = argparse.ArgumentParser(description="ClipForge AI video highlight editor")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=False)
    args = parser.parse_args()
    try:
        result = process_video(args.input)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        log("AI PROCESSING FAILED: " + str(error))
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
