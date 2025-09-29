# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.55.1-jammy as base
# Playwright image includes Chromium + dependencies; add ffmpeg (full) & optional noVNC stack
USER root

# Avoid interactive tzdata prompt (x11vnc/novnc dependency chain may pull it in)
ENV DEBIAN_FRONTEND=noninteractive \
        TZ=Etc/UTC

RUN apt-get update && apt-get install -y --no-install-recommends \
        tzdata \
        ffmpeg \
        xvfb \
        x11vnc \
        novnc \
        websockify \
    && ln -fs /usr/share/zoneinfo/$TZ /etc/localtime \
    && dpkg-reconfigure --frontend noninteractive tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

# Install deps (prefer npm if no lock) - ignoring optional playwright deps because base has them
RUN if [ -f package-lock.json ]; then npm ci; \
    elif [ -f yarn.lock ]; then yarn --frozen-lockfile; \
    elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm i --frozen-lockfile; \
    else npm install; fi

COPY . .
RUN npm run build

ENV DISPLAY=:99 \
    NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true

# Expose optional noVNC/websockify port (disabled by default). User must -p to map.
EXPOSE 6080

# Entry script handles xvfb-run, node process & signal forwarding
ENTRYPOINT ["bash", "./scripts/entrypoint.sh"]
