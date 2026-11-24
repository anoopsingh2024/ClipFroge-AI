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