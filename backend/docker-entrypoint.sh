#!/bin/sh
set -eu

mkdir -p "$CLIPFORGE_UPLOAD_DIR" "$CLIPFORGE_OUTPUT_DIR" "$HF_HOME"
chown node:node "$CLIPFORGE_UPLOAD_DIR" "$CLIPFORGE_OUTPUT_DIR" "$HF_HOME"

exec gosu node "$@"
