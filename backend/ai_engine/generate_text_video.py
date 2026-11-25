import argparse
from array import array
from contextlib import redirect_stdout
import json
import math
import os
import random
import re
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASE_DIR = Path(__file__).resolve().parent.parent
MUSIC_DIR = BASE_DIR / "music"
MUSIC_CATALOG = MUSIC_DIR / "catalog.json"
FFMPEG = os.environ.get(
    "CLIPFORGE_FFMPEG",
    r"C:\ffmpeg\bin\ffmpeg.exe" if os.name == "nt" else "/usr/bin/ffmpeg",
)
WIDTH = 720
HEIGHT = 1280
SCENE_SECONDS = 10
SCENE_COUNT = 6
MAX_SCENE_WORDS = 20
STOP_WORDS = set(
    "a an the and or but is are was were be been being to of in on for with "
    "as by from at this that these those it its into about after before then "
    "hai hain tha thi the ek ke ka ki ko se par aur mein".split()
)


def log(message):
    print(message, file=sys.stderr, flush=True)


def run_command(command):
    result = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "Media command failed.")[-5000:])


def word_chunks(text):
    words = text.split()
    chunks = []
    for offset in range(0, len(words), MAX_SCENE_WORDS):
        phrase = " ".join(words[offset:offset + MAX_SCENE_WORDS]).strip()
        if phrase:
            chunks.append(phrase)
    return chunks


def create_storyboard(text):
    sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?।])\s+|\n+", text)
        if sentence.strip()
    ]
    if not sentences:
        sentences = [text.strip()]

    frequencies = {}
    for word in re.findall(r"\w+", text.lower(), flags=re.UNICODE):
        if len(word) > 2 and word not in STOP_WORDS:
            frequencies[word] = frequencies.get(word, 0) + 1

    ranked = []
    for index, sentence in enumerate(sentences):
        tokens = [
            word for word in re.findall(r"\w+", sentence.lower(), flags=re.UNICODE)
            if len(word) > 2 and word not in STOP_WORDS
        ]
        if not tokens:
            continue
        distinct_score = sum(1 + math.log(frequencies.get(word, 1)) for word in set(tokens))
        position_bonus = 1.4 if index == 0 else (1.1 if index == len(sentences) - 1 else 1)
        ranked.append((distinct_score * position_bonus / math.sqrt(len(tokens)), index, sentence))

    selected = [
        sentence for _, _, sentence in sorted(
            sorted(ranked, reverse=True)[:SCENE_COUNT], key=lambda item: item[1]
        )
    ]
    chunks = []
    for sentence in selected:
        chunks.extend(word_chunks(sentence))
    if len(chunks) < SCENE_COUNT:
        source_words = (
            " ".join(selected) if len(selected) >= SCENE_COUNT else text
        ).split()
        if len(source_words) >= SCENE_COUNT:
            chunks = [
                " ".join(
                    source_words[round(index * len(source_words) / SCENE_COUNT):
                                round((index + 1) * len(source_words) / SCENE_COUNT)]
                )
                for index in range(SCENE_COUNT)
            ]
        else:
            chunks = word_chunks(text)
    if not chunks:
        chunks = [text]

    chunks = chunks[:SCENE_COUNT]
    while len(chunks) < SCENE_COUNT:
        chunks.append(chunks[-1])
    return chunks


def load_font(size, bold=False):
    candidates = []
    if os.name == "nt":
        candidates.extend([
            r"C:\Windows\Fonts\Nirmala.ttf",
            r"C:\Windows\Fonts\NirmalaB.ttf",
            r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
            r"C:\Windows\Fonts\segoeui.ttf",
        ])
    else:
        candidates.extend([
            "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf" if bold
            else "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
            else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ])
    for candidate in candidates:
        if os.path.exists(candidate):
            try:
                return ImageFont.truetype(candidate, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def wrap_text(text, font, max_width, draw):
    lines = []
    line = ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if line and draw.textbbox((0, 0), candidate, font=font)[2] > max_width:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines


def draw_character(draw, x, ground_y, palette, scene_index, documentary):
    skin = (245, 196, 155)
    shirt = palette["accent"] if not documentary else (231, 173, 92)
    head_y = ground_y - 185
    draw.ellipse((x - 37, head_y - 37, x + 37, head_y + 37), fill=skin, outline=(34, 30, 48), width=5)
    draw.rounded_rectangle((x - 48, head_y + 38, x + 48, ground_y - 72), radius=25, fill=shirt)
    arm_offset = 16 if scene_index % 2 else -16
    draw.line((x - 35, head_y + 65, x - 76, head_y + 120 + arm_offset), fill=skin, width=18)
    draw.line((x + 35, head_y + 65, x + 76, head_y + 120 - arm_offset), fill=skin, width=18)
    draw.line((x - 20, ground_y - 75, x - 40, ground_y), fill=(42, 48, 70), width=20)
    draw.line((x + 20, ground_y - 75, x + 40, ground_y), fill=(42, 48, 70), width=20)
    eye_y = head_y - 3
    draw.ellipse((x - 14, eye_y, x - 7, eye_y + 8), fill=(30, 35, 50))
    draw.ellipse((x + 7, eye_y, x + 14, eye_y + 8), fill=(30, 35, 50))


def render_scene(path, text, index, style):
    documentary = style == "documentary"
    palettes = [
        ((38, 89, 143), (223, 177, 115), (255, 207, 97)),
        ((58, 112, 145), (126, 174, 123), (239, 151, 92)),
        ((63, 76, 134), (184, 130, 113), (241, 195, 91)),
        ((36, 112, 126), (82, 155, 151), (247, 177, 83)),
        ((90, 83, 132), (189, 133, 104), (245, 207, 111)),
        ((37, 73, 111), (114, 139, 151), (251, 175, 91)),
    ]
    sky, land, accent = palettes[index % len(palettes)]
    if documentary:
        sky = tuple(int(channel * 0.48) for channel in sky)
        land = tuple(int(channel * 0.60) for channel in land)
    palette = {"accent": accent}

    image = Image.new("RGB", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    for y in range(HEIGHT):
        ratio = y / HEIGHT
        split = 0.62
        start, end = (sky, land) if ratio >= split else ((13, 20, 42), sky)
        local_ratio = (ratio - split) / (1 - split) if ratio >= split else ratio / split
        color = tuple(int(start[channel] * (1 - local_ratio) + end[channel] * local_ratio) for channel in range(3))
        draw.line((0, y, WIDTH, y), fill=color)
    ground_y = 840
    draw.ellipse((500, 140 + index * 20, 610, 250 + index * 20), fill=accent)
    draw.polygon([(0, 825), (145, 520 + index * 12), (330, 820), (470, 560), (720, 835)], fill=land)
    draw.polygon([(0, 930), (230, 680), (430, 920), (590, 720), (720, 890), (720, 1280), (0, 1280)], fill=tuple(min(255, c + 16) for c in land))

    for cloud_x in (90, 380, 610):
        cloud_y = 275 + (cloud_x + index * 31) % 115
        cloud_color = (221, 231, 242) if documentary else (248, 248, 255)
        draw.ellipse((cloud_x, cloud_y, cloud_x + 84, cloud_y + 34), fill=cloud_color)
        draw.ellipse((cloud_x + 20, cloud_y - 18, cloud_x + 67, cloud_y + 30), fill=cloud_color)

    if index % 3 == 0:
        for tree_x in (85, 635):
            draw.rectangle((tree_x - 8, ground_y - 130, tree_x + 8, ground_y + 10), fill=(83, 60, 49))
            draw.ellipse((tree_x - 56, ground_y - 205, tree_x + 56, ground_y - 92), fill=(51, 142, 106))
            draw.ellipse((tree_x - 39, ground_y - 250, tree_x + 43, ground_y - 145), fill=(66, 163, 115))
    elif index % 3 == 1:
        for building_x, building_w, building_h in ((32, 90, 225), (550, 130, 310), (145, 60, 160)):
            draw.rectangle((building_x, ground_y - building_h, building_x + building_w, ground_y), fill=(47, 57, 79))
            for window_y in range(ground_y - building_h + 25, ground_y - 20, 52):
                for window_x in range(building_x + 17, building_x + building_w - 8, 34):
                    draw.rectangle((window_x, window_y, window_x + 12, window_y + 20), fill=accent)
    else:
        for wave_y in range(710, 900, 45):
            draw.arc((20, wave_y, 700, wave_y + 90), 0, 180, fill=(128, 208, 216), width=5)

    draw_character(draw, WIDTH // 2, ground_y + 30, palette, index, documentary)

    panel_top = 925
    panel_color = (14, 21, 40) if documentary else (26, 28, 48)
    draw.rounded_rectangle((38, panel_top, WIDTH - 38, HEIGHT - 38), radius=34, fill=panel_color, outline=accent, width=3)
    label_font = load_font(25, bold=True)
    text_font = load_font(30)
    title = f"SCENE {index + 1:02d}  /  {'FIELD NOTES' if documentary else 'STORY WORLD'}"
    draw.text((68, panel_top + 35), title, font=label_font, fill=accent)
    lines = wrap_text(text, text_font, WIDTH - 140, draw)[:5]
    for line_index, line in enumerate(lines):
        draw.text((68, panel_top + 94 + line_index * 48), line, font=text_font, fill=(247, 245, 239))
    footer_font = load_font(20)
    draw.text((68, HEIGHT - 80), "CLIPFORGE  •  60 SECOND STORY", font=footer_font, fill=(181, 188, 206))
    image.save(path, format="PNG", optimize=True)


def choose_music():
    if not MUSIC_CATALOG.exists():
        raise RuntimeError("The included background music catalog is missing.")
    catalog = json.loads(MUSIC_CATALOG.read_text(encoding="utf-8"))
    allowed = {"CC0", "PUBLIC_DOMAIN", "ROYALTY_FREE_COMMERCIAL"}
    tracks = [
        track for track in catalog
        if track.get("commercial_use") is True
        and str(track.get("licenseType", "")).upper() in allowed
        and (MUSIC_DIR / track.get("filename", "")).is_file()
    ]
    if not tracks:
        raise RuntimeError("No approved background music tracks are available.")
    return random.choice(tracks)


def choose_voice(language):
    import pyttsx3

    engine = pyttsx3.init()
    voices = engine.getProperty("voices") or []
    matches = []
    for voice in voices:
        voice_id = str(voice.id).lower()
        voice_name = str(voice.name).lower()
        voice_languages = []
        for item in voice.languages or []:
            if isinstance(item, bytes):
                item = item.decode("utf-8", errors="ignore")
            voice_languages.append(str(item).lower())
        if language == "hi" and (
            voice_name.startswith("hindi") or
            voice_id.endswith("/hi") or
            any(item == "hi" or item.startswith("hi-") for item in voice_languages) or
            any(term in voice_name for term in ("kalpana", "hemant"))
        ):
            matches.append(voice)
        elif language == "en" and (
            voice_name.startswith("english") or
            "/en-" in voice_id or
            voice_id.endswith("/en") or
            any(item == "en" or item.startswith("en-") for item in voice_languages)
        ):
            matches.append(voice)
    if language == "hi" and not matches:
        engine.stop()
        raise RuntimeError(
            "No offline Hindi voice is installed. Install a Hindi speech voice in Windows Settings "
            "(Time & language > Speech) and try again."
        )
    selected = matches[0] if matches else (voices[0] if voices else None)
    if selected is None:
        engine.stop()
        raise RuntimeError("No offline system speech voice is installed.")
    engine.setProperty("voice", selected.id)
    engine.setProperty("rate", 168 if language == "en" else 155)
    return engine, selected.name


def synthesize_effects(output_path):
    sample_rate = 22050
    frames = array("h")
    for sample_index in range(sample_rate * 60):
        current_time = sample_index / sample_rate
        local_time = current_time % SCENE_SECONDS
        sample = 0.0
        if 0.12 <= local_time <= 0.85:
            progress = (local_time - 0.12) / 0.73
            frequency = 190 + 620 * progress
            envelope = math.sin(math.pi * progress) * (1 - progress * 0.35)
            sample += 0.20 * envelope * math.sin(2 * math.pi * frequency * (local_time - 0.12))
        if 0.78 <= local_time <= 1.08:
            progress = local_time - 0.78
            sample += 0.08 * math.exp(-progress * 11) * math.sin(2 * math.pi * 880 * progress)
        frames.append(int(max(-1, min(1, sample)) * 32767))
    with wave.open(str(output_path), "wb") as audio_file:
        audio_file.setnchannels(1)
        audio_file.setsampwidth(2)
        audio_file.setframerate(sample_rate)
        audio_file.writeframes(frames.tobytes())


def create_voice_track(chunks, language, work_dir, output_path):
    engine, voice_name = choose_voice(language)
    voice_files = []
    try:
        for index, chunk in enumerate(chunks):
            voice_path = work_dir / f"voice-{index:02d}.wav"
            engine.save_to_file(chunk, str(voice_path))
            engine.runAndWait()
            if not voice_path.is_file() or voice_path.stat().st_size == 0:
                raise RuntimeError("Offline speech synthesis did not create narration audio.")
            voice_files.append(voice_path)
    finally:
        engine.stop()

    command = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y"]
    for voice_path in voice_files:
        command.extend(["-i", str(voice_path)])
    filters = []
    for index in range(len(voice_files)):
        filters.append(
            f"[{index}:a]aresample=44100,apad,atrim=duration={SCENE_SECONDS},"
            f"asetpts=PTS-STARTPTS[v{index}]"
        )
    concat_inputs = "".join(f"[v{index}]" for index in range(len(voice_files)))
    filters.append(f"{concat_inputs}concat=n={len(voice_files)}:v=0:a=1[aout]")
    command.extend([
        "-filter_complex", ";".join(filters), "-map", "[aout]",
        "-t", str(SCENE_SECONDS * SCENE_COUNT), str(output_path)
    ])
    run_command(command)
    return voice_name


def create_video(text, style, language, output_path):
    chunks = create_storyboard(text)
    work_dir = Path(tempfile.mkdtemp(prefix="clipforge-story-"))
    silent_video = work_dir / "scenes.mp4"
    voice_track = work_dir / "narration.wav"
    effects_track = work_dir / "effects.wav"
    concat_file = work_dir / "scenes.txt"
    try:
        log("Creating six illustrated story scenes.")
        scene_paths = []
        for index, chunk in enumerate(chunks):
            scene_path = work_dir / f"scene-{index:02d}.png"
            render_scene(scene_path, chunk, index, style)
            scene_paths.append(scene_path)

        concat_lines = []
        for scene_path in scene_paths:
            escaped = str(scene_path).replace("\\", "/").replace("'", "'\\''")
            concat_lines.extend([f"file '{escaped}'", f"duration {SCENE_SECONDS}"])
        escaped_last = str(scene_paths[-1]).replace("\\", "/").replace("'", "'\\''")
        concat_lines.append(f"file '{escaped_last}'")
        concat_file.write_text("\n".join(concat_lines) + "\n", encoding="utf-8")
        run_command([
            FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "concat", "-safe", "0", "-i", str(concat_file),
            "-vf", "fps=24,format=yuv420p", "-t", "60",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
            str(silent_video)
        ])

        voice_name = create_voice_track(chunks, language, work_dir, voice_track)
        synthesize_effects(effects_track)
        music = choose_music()
        music_path = MUSIC_DIR / music["filename"]
        log(f"Mixing voice, licensed music and scene sound effects ({music['title']}).")
        run_command([
            FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(silent_video),
            "-i", str(voice_track),
            "-stream_loop", "-1", "-i", str(music_path),
            "-i", str(effects_track),
            "-filter_complex",
            "[1:a]volume=1.0[voice];"
            "[2:a]atrim=duration=60,volume=0.15,afade=t=in:st=0:d=1,"
            "afade=t=out:st=57:d=3[music];"
            "[3:a]volume=0.40[sfx];"
            "[voice][music][sfx]amix=inputs=3:duration=first:dropout_transition=2,"
            "alimiter=limit=0.95[aout]",
            "-map", "0:v:0", "-map", "[aout]",
            "-t", "60", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", str(output_path)
        ])
        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg did not create the final video.")
        return {
            "success": True,
            "scenes": chunks,
            "voice": voice_name,
            "music": music.get("title", music_path.stem),
        }
    finally:
        import shutil
        shutil.rmtree(work_dir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description="Create a local illustrated one-minute text video")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        text = request.get("text", "").strip()
        style = request.get("style", "")
        language = request.get("language", "")
        if not text:
            raise ValueError("Text cannot be empty.")
        if style not in {"cartoon", "documentary"}:
            raise ValueError("Choose cartoon or documentary style.")
        if language not in {"en", "hi"}:
            raise ValueError("Choose English or Hindi narration.")
        with redirect_stdout(sys.stderr):
            result = create_video(text, style, language, Path(args.output))
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        log(f"Text video generation failed: {error}")
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
