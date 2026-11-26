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
# CLIPFORGE AI - MEMORY-OPTIMIZED AUTO HIGHLIGHTS + AUTO EDIT
# Preserves: 10 clips, timeline scoring, captions, music,
# 9:16 blurred background, filters, mood effects and zoom.
# ============================================================

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "outputs"
TEMP_DIR = OUTPUT_DIR / "_analysis"
MUSIC_DIR = BASE_DIR / "music"
MUSIC_CATALOG = MUSIC_DIR / "catalog.json"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

def find_binary(env_name, names):
    configured = os.environ.get(env_name, "").strip()
    if configured:
        return configured
    for name in names:
        from shutil import which
        found = which(name)
        if found:
            return found
    return names[0]

FFMPEG = find_binary("CLIPFORGE_FFMPEG", ["ffmpeg.exe", "ffmpeg"])
FFPROBE = find_binary("CLIPFORGE_FFPROBE", ["ffprobe.exe", "ffprobe"])

MAX_CLIPS = 10
MIN_CLIP_DURATION = 30.0
MAX_CLIP_DURATION = 60.0
CANDIDATE_STEP = 8.0
MIN_INTEREST_SCORE = float(os.environ.get("CLIPFORGE_MIN_SCORE", "16"))
WHISPER_MODEL_NAME = os.environ.get("CLIPFORGE_WHISPER_MODEL", "tiny")
WHISPER_INSTANCE = None
PROCESS_DEADLINE = None
MUSIC_SELECTION_COUNTER = 0

BACKGROUND_BLUR_RADIUS = max(1, int(os.environ.get("CLIPFORGE_BACKGROUND_BLUR", "20")))
BACKGROUND_BLUR_PASSES = max(1, int(os.environ.get("CLIPFORGE_BACKGROUND_BLUR_PASSES", "1")))
EFFECT_INTENSITY = os.environ.get("CLIPFORGE_EFFECT_INTENSITY", "low").strip().lower()
if EFFECT_INTENSITY not in {"low", "medium", "high"}:
    EFFECT_INTENSITY = "low"

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

FILTER_PRESETS = {
    "cinematic_teal_orange": "eq=contrast=1.08:saturation=1.05:gamma=0.98,colorbalance=rs=0.035:gs=0.006:bs=-0.025",
    "hollywood_warm": "eq=contrast=1.06:saturation=1.04:brightness=0.008:gamma=1.01,colorbalance=rs=0.035:gs=0.012:bs=-0.018",
    "dark_cinematic": "eq=contrast=1.12:brightness=-0.035:saturation=0.94:gamma=0.96",
    "dramatic_contrast": "eq=contrast=1.16:saturation=1.03:brightness=-0.012:gamma=0.96",
    "vibrant": "eq=contrast=1.05:saturation=1.16:gamma=1.01",
    "natural": "eq=contrast=1.02:saturation=1.03:brightness=0.004",
    "bright": "eq=brightness=0.035:contrast=1.02:gamma=1.02",
    "soft": "eq=contrast=0.96:saturation=0.98:brightness=0.012:gamma=1.02",
    "clean_creator": "eq=contrast=1.04:saturation=1.06:brightness=0.006",
    "professional_portrait": "eq=contrast=1.03:saturation=1.02:brightness=0.006",
    "gaming_punchy": "eq=contrast=1.13:saturation=1.15:brightness=0.004:gamma=0.98",
    "retro": "eq=contrast=0.98:saturation=0.82:brightness=0.018:gamma=1.03",
    "black_white": "hue=s=0,eq=contrast=1.08:gamma=0.98",
    "sepia": "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
    "soft_glow": "eq=brightness=0.018:contrast=0.98:saturation=1.01,unsharp=5:5:0.18:3:3:0.05",
    "moody_blue": "eq=contrast=1.08:brightness=-0.018:saturation=0.94,colorbalance=bs=0.055:gs=0.008:rs=-0.025",
    "film_look": "eq=contrast=1.05:saturation=1.02:gamma=0.99",
    "vintage_cinema": "eq=contrast=1.03:saturation=0.84:brightness=0.012",
    "warm": "eq=contrast=1.04:saturation=1.03:gamma=1.01",
    "cool": "eq=contrast=1.04:saturation=0.98:gamma=1.01",
    "high_contrast": "eq=contrast=1.14:saturation=1.04:gamma=0.97",
    "rich_colors": "eq=contrast=1.06:saturation=1.12",
    "modern_lifestyle": "eq=contrast=1.05:saturation=1.08:brightness=0.008",
    "travel_look": "eq=contrast=1.07:saturation=1.10:brightness=0.01",
    "dreamy_glow": "eq=brightness=0.012:contrast=0.98,unsharp=5:5:0.22:3:3:0.08",
    "neon": "eq=contrast=1.12:saturation=1.22",
    "hdr_style": "eq=contrast=1.12:saturation=1.10:gamma=0.96",
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
    "motivational": {"success", "goal", "motivation", "believe", "hard", "work", "मेहनत", "सफलता", "मंजिल", "हौसला"},
    "cinematic": {"amazing", "beautiful", "incredible", "story", "emotional", "खूबसूरत", "भावुक", "कहानी"},
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
        result = subprocess.run(command, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError("Processing time limit reached during FFmpeg operation.") from exc
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "Command failed")[-7000:])
    return result.stdout

def probe_streams(path):
    raw = run_command([FFPROBE, "-v", "error", "-show_streams", "-show_format",
                       "-of", "json", str(path)])
    data = json.loads(raw)
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video:
        raise RuntimeError("Input does not contain a video stream.")
    return data, video, any(s.get("codec_type") == "audio" for s in streams)

def get_video_duration(path):
    raw = run_command([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                       "-of", "default=noprint_wrappers=1:nokey=1", str(path)]).strip()
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
    return [max(0.0, min(1.0, (float(v)-low)/(high-low))) for v in values]

def second_range(start, end, length):
    return range(max(0, int(math.floor(start))), min(length, int(math.ceil(end))))

def extract_audio_energy(path, duration, has_audio):
    count = int(math.ceil(duration))
    if not has_audio:
        return [0.0] * count
    wav_path = TEMP_DIR / (Path(path).stem + "_analysis.wav")
    try:
        run_command([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
                     "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav_path)])
        values = []
        with wave.open(str(wav_path), "rb") as wav:
            rate = wav.getframerate()
            for _ in range(count):
                frames = wav.readframes(rate)
                if not frames:
                    values.append(0.0)
                    continue
                usable = len(frames) // 2
                samples = struct.unpack("<" + "h" * usable, frames[:usable*2])
                values.append(math.sqrt(sum(x*x for x in samples) / max(1, len(samples))))
        return values
    except Exception as exc:
        log("Audio analysis skipped: " + str(exc))
        return [0.0] * count
    finally:
        wav_path.unlink(missing_ok=True)

def analyze_visual_motion(path, duration):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError("OpenCV could not open the input video.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    count = int(math.ceil(duration))
    motion, previous = [0.0] * count, None
    step = 8 if duration < 600 else 12
    try:
        for sec in range(0, count, step):
            check_deadline()
            cap.set(cv2.CAP_PROP_POS_FRAMES, min(int(sec*fps), max(0, total-1)))
            ok, frame = cap.read()
            if not ok:
                continue
            gray = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2GRAY)
            score = 0.0 if previous is None else float(cv2.absdiff(gray, previous).mean())
            for offset in range(step):
                if sec + offset < count:
                    motion[sec+offset] = score
            previous = gray
    finally:
        cap.release()
    return motion

def detect_scenes(path, duration):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return []
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    interval = max(1, int(fps * (8 if duration >= 600 else 5)))
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
    en = normalized((energy + [0.0]*bins)[:bins])
    mn = normalized((motion + [0.0]*bins)[:bins])
    scene = [0.0]*bins
    for marker in scene_markers:
        idx = int(marker)
        if 0 <= idx < bins:
            scene[idx] = 1.0
            if idx > 0:
                scene[idx-1] = max(scene[idx-1], 0.5)
    timeline = []
    for sec in range(bins):
        score = .45*en[sec] + .35*mn[sec] + .20*scene[sec]
        timeline.append({"time": sec, "speech": round(en[sec],4),
                         "audioEnergy": round(en[sec],4), "visualMotion": round(mn[sec],4),
                         "sceneChange": round(scene[sec],4), "keywordCue": 0.0,
                         "interest": round(score,4)})
    peaks = []
    for i, row in enumerate(timeline):
        val = row["interest"]
        if val < max(.20, MIN_INTEREST_SCORE/100):
            continue
        neighbors = [x["interest"] for x in timeline[max(0,i-2):i] +
                     timeline[i+1:i+3]]
        if not neighbors or not (val >= max(neighbors) and val > min(neighbors)):
            continue
        outer = timeline[max(0,i-5):max(0,i-2)] + timeline[i+3:i+6]
        baseline = sorted(x["interest"] for x in outer)
        baseline = baseline[len(baseline)//2] if baseline else 0.0
        prominence = val-baseline
        if prominence >= .04:
            peaks.append({"index": i, "interest": val, "prominence": prominence})
    accepted = []
    for item in sorted(peaks, key=lambda x:(x["prominence"],x["interest"]), reverse=True):
        if not any(abs(item["index"]-p["index"]) < 3 for p in accepted):
            accepted.append(item)
    for p in accepted:
        timeline[p["index"]]["interestPeak"] = True
        timeline[p["index"]]["peakProminence"] = round(p["prominence"],4)
    return timeline

def score_candidates(duration, timeline):
    if duration < MIN_CLIP_DURATION or not timeline:
        return []
    windows = []
    if duration <= MAX_CLIP_DURATION:
        windows = [(0.0, duration)]
    else:
        start = 0.0
        while start <= duration-MIN_CLIP_DURATION:
            for length in (30.,35.,40.,45.,50.,55.,60.):
                end = min(duration, start+length)
                if MIN_CLIP_DURATION <= end-start <= MAX_CLIP_DURATION:
                    windows.append((start,end))
            start += CANDIDATE_STEP
    candidates = []
    for start,end in windows:
        rows = [timeline[i] for i in second_range(start,end,len(timeline))]
        if not rows:
            continue
        vals = sorted(r["interest"] for r in rows)
        mean = sum(vals)/len(vals)
        peak = vals[min(len(vals)-1,int(len(vals)*.75))]
        active = sum(v >= .20 for v in vals)/len(vals)
        speech = sum(r["speech"] for r in rows)/len(rows)
        gp = [r for r in rows if r.get("interestPeak")]
        gps = sum(r["interest"] for r in gp)/len(gp) if gp else 0.0
        gprom = sum(r["peakProminence"] for r in gp)/len(gp) if gp else 0.0
        bonus = min(1.0,gps+gprom*.5)
        score = .50*mean + .20*peak + .12*active + .08*speech + .10*bonus
        percent = score*100
        if percent < MIN_INTEREST_SCORE:
            continue
        candidates.append({"start":round(start,2),"end":round(end,2),
            "duration":round(end-start,2),"interestScore":round(percent,1),
            "features":{"meanInterest":round(mean,3),"peakInterest":round(peak,3),
                "activeRatio":round(active,3),"speech":round(speech,3),
                "timelineGraphPeaks":len(gp),"timelineGraphPeakScore":round(bonus,3)}})
    candidates.sort(key=lambda x:x["interestScore"], reverse=True)
    selected = []
    for item in candidates:
        if any(item["start"] < old["end"]+1.5 and item["end"] > old["start"]-1.5
               for old in selected):
            continue
        selected.append(item)
        if len(selected) >= MAX_CLIPS:
            break
    return sorted(selected,key=lambda x:x["start"])

def get_whisper_model():
    global WHISPER_INSTANCE
    if WHISPER_INSTANCE is None:
        log(f"Loading Whisper model once: {WHISPER_MODEL_NAME}")
        WHISPER_INSTANCE = WhisperModel(
            WHISPER_MODEL_NAME, device="cpu", compute_type="int8",
            cpu_threads=max(1,int(os.environ.get("CLIPFORGE_WHISPER_THREADS","2"))),
            num_workers=1
        )
        log("Whisper model loaded.")
    return WHISPER_INSTANCE

def transcribe_selected_clips(video_path, clips, has_audio):
    if not has_audio or not clips:
        return [], "none"
    model = get_whisper_model()
    transcript, language = [], "unknown"
    for index, clip in enumerate(clips,1):
        check_deadline()
        wav_path = TEMP_DIR / f"{Path(video_path).stem}-clip-{index:02d}.wav"
        try:
            run_command([FFMPEG,"-hide_banner","-loglevel","error","-y",
                "-ss",str(clip["start"]),"-i",str(video_path),"-t",str(clip["duration"]),
                "-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",str(wav_path)])
            segments, info = model.transcribe(
                str(wav_path), language=None, task="transcribe",
                word_timestamps=True, vad_filter=True, beam_size=1,
                temperature=0.0, condition_on_previous_text=False,
                compression_ratio_threshold=2.4, log_prob_threshold=-1.0,
                no_speech_threshold=0.6
            )
            language = getattr(info,"language",None) or language
            for seg in segments:
                words = [{"text":w.word.strip(),"start":float(w.start)+clip["start"],
                          "end":float(w.end)+clip["start"]} for w in (seg.words or [])]
                transcript.append({"start":float(seg.start)+clip["start"],
                    "end":float(seg.end)+clip["start"],"text":seg.text.strip(),"words":words})
        finally:
            wav_path.unlink(missing_ok=True)
    return transcript,language

def ass_time(seconds):
    total=max(0,int(round(seconds*100)))
    return f"{total//360000}:{(total%360000)//6000:02d}:{(total%6000)//100:02d}.{total%100:02d}"

def escape_ass(value):
    return value.replace("\\","\\\\").replace("{","\\{").replace("}","\\}").replace("\n"," ")

def create_ass_captions(transcript, clip_start, clip_end, ass_path):
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
    lines=[header]; count=0
    for seg in transcript:
        words=[w for w in seg.get("words",[]) if w["end"]>clip_start and w["start"]<clip_end]
        for offset in range(0,len(words),4):
            group=words[offset:offset+4]
            if not group: continue
            start=max(group[0]["start"],clip_start)-clip_start
            end=min(group[-1]["end"],clip_end)-clip_start
            if end<=start: continue
            parts=[]
            for word in group:
                cs=max(1,int((word["end"]-word["start"])*100))
                parts.append(rf"{{\kf{cs}}}{escape_ass(word['text'])}")
            caption=r"{\an2\bord5\shad3\fscx88\fscy88\t(0,120,\fscx108\fscy108)\t(120,220,\fscx100\fscy100)}"+" ".join(parts)
            lines.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{caption}")
            count+=1
    ass_path.write_text("\n".join(lines),encoding="utf-8-sig")
    return count

def escape_filter_path(path):
    value=str(Path(path).resolve()).replace("\\","/")
    return value.replace(":","\\:").replace("'","\\'")

def analyze_profile(path):
    cap=cv2.VideoCapture(str(path))
    if not cap.isOpened(): raise RuntimeError("Could not analyze video profile.")
    width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps=cap.get(cv2.CAP_PROP_FPS) or 30.; total=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    samples=[]
    try:
        for i in range(min(12,max(1,total))):
            pos=int(i*max(total-1,0)/max(min(12,max(1,total))-1,1))
            cap.set(cv2.CAP_PROP_POS_FRAMES,pos); ok,frame=cap.read()
            if ok:
                small=cv2.resize(frame,(160,90)); hsv=cv2.cvtColor(small,cv2.COLOR_BGR2HSV)
                gray=cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
                samples.append((float(hsv[:,:,2].mean()),float(hsv[:,:,1].mean()),float(gray.std())))
    finally: cap.release()
    if samples:
        brightness=sum(x[0] for x in samples)/len(samples)
        saturation=sum(x[1] for x in samples)/len(samples)
        contrast=sum(x[2] for x in samples)/len(samples)
    else: brightness,saturation,contrast=128.,100.,50.
    return {"width":width,"height":height,"fps":round(fps,2),
        "brightness":round(brightness,2),"saturation":round(saturation,2),"contrast":round(contrast,2)}

def classify_mood(transcript,clip,timeline):
    text=" ".join(s.get("text","").lower() for s in transcript
        if s["end"]>clip["start"] and s["start"]<clip["end"])
    tokens=set(text.split())
    for mood in ("funny","motivational","cinematic","calm"):
        if tokens.intersection(MOOD_WORDS[mood]) or any(c in text for c in MOOD_WORDS[mood] if len(c)>3):
            return mood
    rows=[r for r in timeline if clip["start"]<=r["time"]<clip["end"]]
    if not rows: return "cinematic"
    motion=sum(r["visualMotion"] for r in rows)/len(rows)
    energy=sum(r["audioEnergy"] for r in rows)/len(rows)
    if motion>.55 or energy>.60: return "motivational"
    if motion<.20 and energy<.20: return "calm"
    return "cinematic"

def choose_visual_treatment(profile,score,mood):
    brightness=profile["brightness"]; saturation=profile["saturation"]; contrast=profile["contrast"]
    if mood=="funny": name="vibrant" if saturation<125 else "clean_creator"; effects=["dynamic_punch_in","subtle_shake"]
    elif mood=="motivational": name="hollywood_warm" if brightness<185 else "dramatic_contrast"; effects=["smooth_zoom_in","flash_transition"]
    elif mood=="calm": name="soft" if saturation>70 else "professional_portrait"; effects=["smooth_zoom_in","fade_in_out","soft_glow"]
    else: name="cinematic_teal_orange"; effects=["smooth_zoom_in","cinematic_vignette","film_grain"]
    if brightness<75: name="bright" if mood=="calm" else "hollywood_warm"
    elif brightness>220: name="dark_cinematic" if mood=="cinematic" else "natural"
    elif saturation>180: name="natural"
    if contrast<28 and "soft_glow" not in effects: effects.append("soft_glow")
    if score>=80 and mood in {"funny","motivational"}: effects.append("dynamic_punch_in")
    limit={"low":1,"medium":3,"high":4}[EFFECT_INTENSITY]
    return name,list(dict.fromkeys(effects[:limit]))

def build_effect_filters(names,duration,mood):
    filters=[]
    for name in names:
        if name in {"smooth_zoom_in","dynamic_punch_in","smooth_zoom_out","slow_motion","subtle_camera_movement"}: continue
        if name=="fade_in_out":
            filters += ["fade=t=in:st=0:d=0.45",f"fade=t=out:st={max(.45,duration-.65):.3f}:d=.65"]
        elif name=="flash_transition": filters.append("eq=brightness=0.018")
        elif name=="cinematic_vignette": filters.append("vignette=PI/5")
        elif name=="film_grain": filters.append("noise=alls=4:allf=t+u")
        elif name=="subtle_shake": filters.append("crop=iw-8:ih-8:x='4+2*sin(2*PI*t*1.7)':y='4+2*cos(2*PI*t*1.3)',scale=720:1280:flags=lanczos")
        elif name=="soft_glow": filters.append("unsharp=5:5:0.18:3:3:0.05")
    if mood=="calm" and "fade_in_out" not in names:
        filters += ["fade=t=in:st=0:d=0.35",f"fade=t=out:st={max(.35,duration-.55):.3f}:d=.55"]
    return filters

def zoom_expression(mood,effects):
    if "smooth_zoom_out" in effects: return "min(1.035,1.035-0.025*(0.5-0.5*cos(2*PI*on/240)))"
    if mood=="funny" or "dynamic_punch_in" in effects: return "min(1.055,1+0.035*(0.5-0.5*cos(2*PI*on/180)))"
    return "min(1.045,1+0.025*(0.5-0.5*cos(2*PI*on/240)))"

def create_clip_background(path,index):
    name,start_bgr,end_bgr=BACKGROUND_PALETTES[(index-1)%len(BACKGROUND_PALETTES)]
    height,width=1280,720
    y,x=np.mgrid[0:height,0:width].astype(np.float32)
    blend=np.clip((y/(height-1))*.7+(x/(width-1))*.3,0,1)
    start=np.asarray(start_bgr,dtype=np.float32); end=np.asarray(end_bgr,dtype=np.float32)
    gradient=start[None,None,:]*(1-blend[:,:,None])+end[None,None,:]*blend[:,:,None]
    glow=np.exp(-(((x-width*.72)/(width*.58))**2+((y-height*.28)/(height*.38))**2))[:,:,None]
    gradient=np.clip(gradient+glow*end[None,None,:]*.18,0,255)
    if not cv2.imwrite(str(path),gradient.astype(np.uint8)):
        raise RuntimeError(f"Unable to create background gradient: {path}")
    return name,f"#{start_bgr[2]:02x}{start_bgr[1]:02x}{start_bgr[0]:02x}",f"#{end_bgr[2]:02x}{end_bgr[1]:02x}{end_bgr[0]:02x}"

def is_valid_audio_file(path):
    if not path.is_file(): return False
    try:
        result=subprocess.run([FFPROBE,"-v","error","-select_streams","a:0",
            "-show_entries","stream=codec_type","-of","default=nw=1:nk=1",str(path)],
            capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=15)
        return result.returncode==0 and "audio" in result.stdout.lower()
    except Exception as exc:
        log("Music validation failed: "+str(exc)); return False

def choose_music_track(mood):
    allowed={"CC0","PUBLIC_DOMAIN","ROYALTY_FREE_COMMERCIAL"}; valid=[]
    if MUSIC_CATALOG.is_file():
        try:
            catalog=json.loads(MUSIC_CATALOG.read_text(encoding="utf-8-sig"))
            tracks=catalog if isinstance(catalog,list) else catalog.get("tracks",[]) if isinstance(catalog,dict) else []
            for item in tracks:
                if not isinstance(item,dict) or item.get("commercial_use") is not True: continue
                license_type=str(item.get("license_type") or item.get("licenseType") or "").upper()
                if license_type not in allowed: continue
                filename=item.get("filename","")
                if not isinstance(filename,str) or not filename or Path(filename).name!=filename: continue
                track=MUSIC_DIR/filename
                if not is_valid_audio_file(track): continue
                moods=item.get("moods",item.get("mood",[]))
                if isinstance(moods,str): moods=[moods]
                moods=[str(x).strip().lower() for x in moods] if isinstance(moods,list) else []
                valid.append((track,item,mood.lower() in moods))
        except Exception as exc: log("Music catalog could not be read: "+str(exc))
    global MUSIC_SELECTION_COUNTER
    exact=[x for x in valid if x[2]]; candidates=exact or valid
    if candidates:
        track,meta,_=candidates[MUSIC_SELECTION_COUNTER%len(candidates)]
        MUSIC_SELECTION_COUNTER+=1
        log("Background music selected from catalog: "+track.name)
        return track,{"filename":track.name,"title":meta.get("title",track.stem),
            "licenseType":meta.get("license_type") or meta.get("licenseType"),
            "attribution":meta.get("attribution",""),"mood":mood,"source":"catalog"}
    fallback=MUSIC_DIR/"motivational.mp3"
    if is_valid_audio_file(fallback):
        log("Background music selected: motivational.mp3")
        return fallback,{"filename":fallback.name,"title":"motivational",
            "licenseType":"User-provided; verify usage rights",
            "attribution":"Check the original music license and attribution requirements.",
            "mood":mood,"source":"local-fallback"}
    log("No valid background music found.")
    return None,None

def render_clip(input_path,clip,index,transcript,profile,timeline,output_dir,has_audio):
    stem=Path(input_path).stem
    clip_name=f"{stem}-highlight-{index:02d}.mp4"
    output_path=output_dir/clip_name
    ass_path=output_dir/f"{stem}-highlight-{index:02d}.ass"
    bg_path=output_dir/f"{stem}-highlight-{index:02d}-background.png"
    bg_name,bg_start,bg_end=create_clip_background(bg_path,index)
    mood=classify_mood(transcript,clip,timeline)
    filter_name,effects=choose_visual_treatment(profile,clip["interestScore"],mood)
    music_path,music_info=choose_music_track(mood)
    caption_count=create_ass_captions(transcript,clip["start"],clip["end"],ass_path)
    duration=float(clip["duration"])
    blur=f"luma_radius={BACKGROUND_BLUR_RADIUS}:luma_power={BACKGROUND_BLUR_PASSES}:chroma_radius={BACKGROUND_BLUR_RADIUS}:chroma_power={BACKGROUND_BLUR_PASSES}"
    zoom=zoom_expression(mood,effects)
    video_chain=(
        "[0:v]split=2[bgsrc][fgsrc];"
        "[bgsrc]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,"
        f"boxblur={blur},eq=brightness=-0.025:saturation=0.98[bg];"
        "[1:v]scale=720:1280,format=rgba[palette];"
        "[bg][palette]blend=all_mode=normal:all_opacity=0.72[coloredbg];"
        "[fgsrc]scale=720:1280:force_original_aspect_ratio=decrease[fg];"
        "[coloredbg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,"
        f"zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=24[vbase]"
    )
    filters=[FILTER_PRESETS.get(filter_name,FILTER_PRESETS["natural"])]
    filters.extend(build_effect_filters(effects,duration,mood))
    if caption_count: filters.append(f"ass=filename='{escape_filter_path(ass_path)}'")
    filters.append("format=yuv420p")
    video_chain+=";[vbase]"+",".join(filters)+"[vout]"
    command=[FFMPEG,"-hide_banner","-loglevel","error","-y",
        "-filter_threads","1","-filter_complex_threads","1",
        "-ss",str(clip["start"]),"-i",str(input_path),
        "-loop","1","-framerate","24","-i",str(bg_path)]
    music_index=2
    if music_path: command += ["-stream_loop","-1","-i",str(music_path)]
    command += ["-t",str(duration)]
    if has_audio and music_path:
        audio=(f"[0:a:0]atrim=duration={duration},asetpts=PTS-STARTPTS,aresample=44100,volume=1.0[voice];"
            f"[{music_index}:a:0]atrim=duration={duration},asetpts=PTS-STARTPTS,aresample=44100,volume=0.12,"
            f"afade=t=in:st=0:d=1.0,afade=t=out:st={max(0.,duration-2.):.3f}:d=2.0[music];"
            "[voice][music]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
        command += ["-filter_complex",video_chain+";"+audio,"-map","[vout]","-map","[aout]"]
    elif has_audio:
        command += ["-filter_complex",video_chain,"-map","[vout]","-map","0:a:0",
                    "-af","loudnorm=I=-16:TP=-1.5:LRA=11"]
    elif music_path:
        audio=(f"[{music_index}:a:0]atrim=duration={duration},asetpts=PTS-STARTPTS,aresample=44100,"
            f"volume=0.16,afade=t=in:st=0:d=1.0,afade=t=out:st={max(0.,duration-2.):.3f}:d=2.0,"
            "loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
        command += ["-filter_complex",video_chain+";"+audio,"-map","[vout]","-map","[aout]"]
    else:
        command += ["-filter_complex",video_chain,"-map","[vout]","-an"]
    command += ["-c:v","libx264","-preset","ultrafast","-crf","24",
        "-r","24","-threads",os.environ.get("CLIPFORGE_FFMPEG_THREADS","2"),
        "-pix_fmt","yuv420p","-c:a","aac","-b:a","128k","-ar","44100",
        "-movflags","+faststart",str(output_path)]
    try:
        run_command(command)
    finally:
        ass_path.unlink(missing_ok=True); bg_path.unlink(missing_ok=True)
    if not output_path.exists() or output_path.stat().st_size==0:
        raise RuntimeError(f"FFmpeg did not create output clip: {clip_name}")
    return {"filename":clip_name,"path":f"/outputs/{clip_name}",
        "duration":clip["duration"],"start":clip["start"],"end":clip["end"],
        "interestScore":clip["interestScore"],"features":clip.get("features",{}),
        "mood":mood,"music":music_info,"captionCount":caption_count,"autoEdited":True,
        "framing":"9:16-blurred-background-with-fitted-foreground","filter":filter_name,
        "backgroundStyle":bg_name,"backgroundColors":[bg_start,bg_end],
        "selectedEffects":effects,"effects":effects,
        "backgroundBlur":{"enabled":True,"intensity":BACKGROUND_BLUR_RADIUS,
            "passes":BACKGROUND_BLUR_PASSES,"scope":"background-layer-only"},
        "animation":"mood-aware-smooth-zoom-on-final-composition"}

def process_video(input_path):
    global PROCESS_DEADLINE
    global FFMPEG, FFPROBE
    started=time.monotonic(); input_path=Path(input_path).resolve()
    # Resolve Linux Render and Windows local FFmpeg paths safely.
    from shutil import which
    ffmpeg_path=FFMPEG if Path(FFMPEG).is_file() else which("ffmpeg")
    ffprobe_path=FFPROBE if Path(FFPROBE).is_file() else which("ffprobe")
    if not ffmpeg_path: raise RuntimeError("FFmpeg not found. Install FFmpeg or set CLIPFORGE_FFMPEG.")
    if not ffprobe_path: raise RuntimeError("FFprobe not found. Install FFmpeg or set CLIPFORGE_FFPROBE.")
    # Keep global command paths consistent with resolved executable paths.
    FFMPEG,FFPROBE=ffmpeg_path,ffprobe_path
    if not input_path.is_file(): raise RuntimeError("Input video not found: "+str(input_path))
    _,_,has_audio=probe_streams(input_path)
    duration=get_video_duration(input_path)
    if duration<MIN_CLIP_DURATION:
        raise RuntimeError(f"Source video must be at least {MIN_CLIP_DURATION:.0f} seconds.")
    configured=os.environ.get("CLIPFORGE_PROCESS_TIMEOUT_SECONDS","").strip()
    if configured:
        try:
            budget=int(configured)
            if budget<60: raise ValueError
        except ValueError as exc:
            raise RuntimeError("CLIPFORGE_PROCESS_TIMEOUT_SECONDS must be an integer >= 60.") from exc
    else: budget=max(600,min(3600,int(duration*1.5)))
    PROCESS_DEADLINE=started+budget
    log(f"Processing {duration:.1f}s video | max clips={MAX_CLIPS} | audio={has_audio}")
    energy=extract_audio_energy(input_path,duration,has_audio)
    motion=analyze_visual_motion(input_path,duration)
    scenes=detect_scenes(input_path,duration)
    profile=analyze_profile(input_path)
    timeline=build_timeline(duration,energy,motion,scenes)
    clips=score_candidates(duration,timeline)
    if not clips:
        raise RuntimeError("No highlight candidates found. Try CLIPFORGE_MIN_SCORE=10.")
    transcript,language=transcribe_selected_clips(input_path,clips,has_audio)
    for clip in clips:
        text_for_clip=" ".join(s.get("text","") for s in transcript
            if s["end"]>clip["start"] and s["start"]<clip["end"]).lower()
        hits=sum(1 for word in INTEREST_WORDS if word in text_for_clip)
        clip["features"]["keywordHits"]=hits
        if hits: clip["interestScore"]=round(min(99.,clip["interestScore"]+min(8,hits*1.5)),1)
    for row in timeline:
        row["selectedClip"]=any(c["start"]<=row["time"]<c["end"] for c in clips)
    log(f"Selected {len(clips)} highlight(s). Rendering...")
    random.shuffle(BACKGROUND_PALETTES)
    rendered=[]
    for index,clip in enumerate(clips,1):
        check_deadline()
        log(f"Rendering {index}/{len(clips)}: {clip['start']:.1f}-{clip['end']:.1f}s score={clip['interestScore']}")
        rendered.append(render_clip(input_path,clip,index,transcript,profile,timeline,OUTPUT_DIR,has_audio))
    check_deadline()
    PROCESS_DEADLINE=None
    return {"success":True,"language":language,"duration":round(duration,2),
        "hasAudio":has_audio,"sceneChangesDetected":len(scenes),
        "totalClips":len(rendered),"maxClips":MAX_CLIPS,"clips":rendered,
        "timeline":timeline,"videoProfile":profile,
        "analysis":{"signals":["audioEnergy","visualMotion","sceneChanges",
            "timelineGraphPeaks","selectedClip"],"minimumInterestScore":MIN_INTEREST_SCORE,
            "backgroundBlur":{"enabled":True,"intensity":BACKGROUND_BLUR_RADIUS,
                "passes":BACKGROUND_BLUR_PASSES},"effectIntensity":EFFECT_INTENSITY,
            "note":"Heuristic audio/visual highlight ranking; not human-level semantic understanding."},
        "filename":rendered[0]["filename"],"clipStart":rendered[0]["start"],
        "clipEnd":rendered[0]["end"],"captionCount":sum(x["captionCount"] for x in rendered)}

def main():
    parser=argparse.ArgumentParser(description="ClipForge AI video highlight editor")
    parser.add_argument("--input",required=True)
    parser.add_argument("--output",required=False)
    args=parser.parse_args()
    try:
        result=process_video(args.input)
        print(json.dumps(result,ensure_ascii=False))
    except Exception as error:
        log("AI PROCESSING FAILED: "+str(error))
        print(json.dumps({"success":False,"error":str(error)},ensure_ascii=False))
        sys.exit(1)
    finally:
        global PROCESS_DEADLINE
        PROCESS_DEADLINE=None

if __name__=="__main__":
    main()
