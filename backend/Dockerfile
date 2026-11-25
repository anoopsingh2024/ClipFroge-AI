FROM node:22-bookworm-slim

ENV PYTHONUNBUFFERED=1
ENV CLIPFORGE_PYTHON=/opt/clipforge-ai/ai-venv/bin/python
ENV CLIPFORGE_FFMPEG=/usr/bin/ffmpeg
ENV CLIPFORGE_FFPROBE=/usr/bin/ffprobe
ENV CLIPFORGE_UPLOAD_DIR=/var/data/uploads
ENV CLIPFORGE_OUTPUT_DIR=/var/data/outputs
ENV HF_HOME=/var/data/huggingface

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
       gosu \
       python3 \
       python3-pip \
       python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/clipforge-ai/backend

COPY package*.json ./
RUN npm ci

COPY ai_engine/requirements.txt ./ai_engine/requirements.txt
RUN python3 -m venv /opt/clipforge-ai/ai-venv \
    && /opt/clipforge-ai/ai-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/clipforge-ai/ai-venv/bin/pip install --no-cache-dir -r ai_engine/requirements.txt

COPY . .
RUN npm run build \
    && mkdir -p /var/data/uploads /var/data/outputs \
    && chown -R node:node /var/data /opt/clipforge-ai

COPY docker-entrypoint.sh /usr/local/bin/clipforge-entrypoint
RUN chmod 755 /usr/local/bin/clipforge-entrypoint

ENTRYPOINT ["/usr/local/bin/clipforge-entrypoint"]
CMD ["npm", "start"]
