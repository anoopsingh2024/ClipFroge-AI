#!/bin/sh
set -eu

CLIPFORGE_PYTHON=/opt/clipforge-ai/backend/ai-venv/bin/python
CLIPFORGE_YTDLP=/opt/clipforge-ai/backend/ai-venv/bin/yt-dlp
export CLIPFORGE_PYTHON CLIPFORGE_YTDLP

if [ ! -x "$CLIPFORGE_PYTHON" ] || [ ! -x "$CLIPFORGE_YTDLP" ]; then
  echo "ClipForge AI virtualenv is missing Python or yt-dlp." >&2
  exit 1
fi

mkdir -p "$CLIPFORGE_UPLOAD_DIR" "$CLIPFORGE_OUTPUT_DIR" "$HF_HOME"
chown node:node "$CLIPFORGE_UPLOAD_DIR" "$CLIPFORGE_OUTPUT_DIR" "$HF_HOME"

gosu node "$CLIPFORGE_PYTHON" -c 'import yt_dlp'
gosu node "$CLIPFORGE_YTDLP" --version

exec gosu node "$@"
