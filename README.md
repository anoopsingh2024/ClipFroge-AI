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

YouTube/Facebook imports do not check for a `yt-dlp` update on every request.
Update `yt-dlp` as part of deployment maintenance, or temporarily set
`CLIPFORGE_YTDLP_AUTO_UPDATE=true` to enable the per-import update check.
When an import needs MP4 normalization, ClipForge tries a lossless stream-copy
remux first and only re-encodes if the source codecs are not MP4-compatible.

Automatic highlights are 30–60 seconds long. Each clip also gets a distinct
color-gradient background palette (including black/orange, green, blue/cyan,
purple/pink, and other combinations), blended with the blurred source layer.
The selected palette is returned as `backgroundStyle` and `backgroundColors`
in each clip's metadata.

The timeline interest graph also contributes directly to clip ranking. Local
graph peaks are detected by prominence, added as a scoring signal, and exposed
as `interestPeak`/`peakProminence` on timeline points. The upload timeline
highlights selected clip regions and graph peaks with a legend.

## Create an illustrated video from text

Open **Text to Video** in the home-page navigation to paste text or upload a
`.txt`/`.md` file. The local renderer creates a one-minute, six-scene cartoon
or documentary-style illustrated storyboard, offline system-voice narration,
one of the included CC0 music tracks, and synthesized transition sounds. It
does not generate AI footage or animated characters; the scene art is drawn
locally and the narration uses voices installed on the computer.

Install the updated backend Python requirements with
`backend\ai-venv\Scripts\pip install -r backend\ai_engine\requirements.txt`
from the repository root on Windows. Choose English or Hindi narration in the
page; Hindi requires a Hindi speech voice installed in Windows speech
settings. Generated video is written to `backend/outputs`.

## Public VPS deployment

The app needs a server reachable from the internet; `localhost` only works on
the computer running the app. A single Ubuntu 24.04 VPS can host the Angular
site, Express API, FFmpeg and Python AI engine. For video jobs, choose at least
8 GB RAM and 100 GB SSD; the first AI run downloads the Faster-Whisper model.

1. Create a VPS with a public IPv4 address. A domain is optional, but point its
   DNS `A` record to the server if you want HTTPS and a friendly shareable URL.
2. On the VPS, install Node.js 22, Python, FFmpeg, Nginx and Git:

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt update
   sudo apt install -y nodejs python3 python3-venv python3-pip ffmpeg nginx git
   ```

3. Clone this repository to `/opt/clipforge-ai`, then build both apps and
   install the Python AI dependencies:

   ```bash
   sudo git clone https://github.com/anoopsingh2024/ClipFroge-AI.git /opt/clipforge-ai
   cd /opt/clipforge-ai/backend
   npm ci
   npm run build
   python3 -m venv ai-venv
   ai-venv/bin/pip install -r ai_engine/requirements.txt
   cd ../frontend
   npm ci
   npm run build
   ```

   If the repository is private, clone using a server-side SSH deploy key; do
   not put a GitHub token in the clone URL.
4. Create writable media folders and publish the Angular build:

   ```bash
   sudo mkdir -p /var/www/clipforge/frontend/browser
   sudo cp -a /opt/clipforge-ai/frontend/dist/frontend/browser/. /var/www/clipforge/frontend/browser/
   sudo mkdir -p /opt/clipforge-ai/backend/uploads /opt/clipforge-ai/backend/outputs
   sudo chown -R www-data:www-data /opt/clipforge-ai/backend/uploads /opt/clipforge-ai/backend/outputs
   ```
5. Create the backend environment file and copy the template:

   ```bash
   sudo mkdir -p /etc/clipforge
   sudo cp /opt/clipforge-ai/backend/.env.example /etc/clipforge/backend.env
   ```

   Set
   `FRONTEND_ORIGIN` and `PUBLIC_BACKEND_URL` to your public domain (or
   `http://YOUR_SERVER_IP` without a domain), and verify FFmpeg, FFprobe, and
   Python paths. On Ubuntu these are `/usr/bin/ffmpeg`, `/usr/bin/ffprobe`,
   and `/opt/clipforge-ai/backend/ai-venv/bin/python`. Use
   `deploy/clipforge-backend.service.example` as the systemd service at
   `/etc/systemd/system/clipforge-backend.service`.
6. Copy `deploy/nginx-clipforge.conf.example` to
   `/etc/nginx/sites-available/clipforge`, replace
   `YOUR_DOMAIN_OR_PUBLIC_IP`, then enable it:

   ```bash
   sudo ln -s /etc/nginx/sites-available/clipforge /etc/nginx/sites-enabled/clipforge
   sudo nginx -t
   sudo systemctl enable --now clipforge-backend
   sudo systemctl reload nginx
   ```
7. Allow inbound ports 22 and 80 (and 443 for HTTPS) in the VPS firewall.
   Keep backend port 5000 private; the included service listens only on
   `127.0.0.1`. For a domain, install Certbot with
   `sudo apt install -y certbot python3-certbot-nginx`, then run
   `sudo certbot --nginx -d YOUR_DOMAIN`.

The Nginx config supports 1 GB uploads and long-running video processing.
After deployment, the URL `https://YOUR_DOMAIN` (or `http://YOUR_SERVER_IP`)
is reachable from other phones, laptops and networks. This is an open public
service with no sign-in; monitor server resources and costs.

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