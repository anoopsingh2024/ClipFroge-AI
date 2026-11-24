# ClipFroge-AI

## Video rendering configuration

The AI renderer keeps the original 9:16 composition and applies the selected
grade and effects only to the final foreground/background composition. The
foreground remains a separate sharp layer while the fitted background receives
the stronger blur.

Optional environment variables:

```env
CLIPFORGE_BACKGROUND_BLUR=35
CLIPFORGE_BACKGROUND_BLUR_PASSES=2
CLIPFORGE_EFFECT_INTENSITY=medium
```

`CLIPFORGE_EFFECT_INTENSITY` accepts `low`, `medium` (default), or `high`.
Each rendered clip now reports its selected `filter`, `effects`, and
`backgroundBlur` metadata while preserving the existing `selectedEffects`
field for API compatibility.

Automatic highlights are 30–60 seconds long. Each clip also gets a distinct
color-gradient background palette (including black/orange, green, blue/cyan,
purple/pink, and other combinations), blended with the blurred source layer.
The selected palette is returned as `backgroundStyle` and `backgroundColors`
in each clip's metadata.

Highlight selection scores overlapping 6–15 second source moments using audio
energy, visual motion, scene changes, and speech, then assembles the strongest
non-overlapping moments into 30–60 second montages. Low-scoring gaps are
skipped; neighboring moments receive animated crossfade transitions. The
selected source ranges and transition count are included in each clip's
`segments` and `transitions` metadata.

## Hindi and English captions

Speech recognition uses Faster-Whisper's multilingual transcription mode with
language auto-detection, word timestamps, VAD, deterministic decoding, and a
beam size of 5. The default model is `small` instead of `tiny` to improve Hindi,
English, and mixed-language recognition. Set `CLIPFORGE_WHISPER_MODEL=medium`
in `backend/.env` for more accurate transcription when the machine has enough
memory and processing time; the model is downloaded the first time it runs.
Speech recognition cannot guarantee a completely error-free transcript, so
review captions before publishing when exact wording is important.

Available automatic grades include cinematic teal/orange, Hollywood warm,
dark cinematic, moody blue, film look, vintage cinema, dramatic contrast,
vibrant, natural, clean creator, travel, professional portrait, gaming
punchy, retro, dreamy glow, neon, black and white, sepia, soft glow, and
HDR-style.

## Automatic music library

The backend includes 60 original synthesized, royalty-safe MP3 tracks. Tracks
are selected automatically by the detected video mood:

- Motivational
- Cinematic
- Funny
- Calm

The Python renderer rotates through mood-matching catalog entries instead of
repeating the same track for every clip. Catalog tracks are validated with
FFprobe before use. The library is licensed as `CC0`/ClipForge original
synthesized material in `backend/music/catalog.json`.