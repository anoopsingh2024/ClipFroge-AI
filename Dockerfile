FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        fonts-dejavu-core \
        fonts-noto-core \
        python3 \
        python-is-python3 \
        python3-venv \
        espeak-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./
RUN npm run build \
    && npm prune --omit=dev \
    && python3 -m venv /opt/clipforge-venv \
    && /opt/clipforge-venv/bin/python -m pip install --no-cache-dir -r ai_engine/requirements.txt \
    && mkdir -p uploads outputs

ENV NODE_ENV=production \
    CLIPFORGE_FFMPEG=/usr/bin/ffmpeg \
    CLIPFORGE_FFPROBE=/usr/bin/ffprobe \
    CLIPFORGE_PYTHON=/opt/clipforge-venv/bin/python \
    PUBLIC_BACKEND_URL=https://clipfroge-ai-1.onrender.com \
    PORT=5000

EXPOSE 5000

CMD ["npm", "start"]
