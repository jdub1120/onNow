FROM node:24.1.0-alpine
# tzdata for timezone, net-tools, and python3/py3-pip for the optional Apple TV sidecar (pyatv)
RUN apk update
RUN apk add tzdata
RUN apk add net-tools
RUN apk add python3 py3-pip

ENV NODE_ENV=production

# PosterX talks to Plex, Jellyfin, Emby, and Kodi over HTTP(S) from settings (no extra image packages).
# In Docker, set the media server "host" to a container name on a shared network, or host.docker.internal
# (see docker-compose.yml extra_hosts and docker-compose.media-servers.example.yml).
#
# Persist these on the host (see docker-compose.yml):
#   /usr/src/app/config  — settings.json, cache/, ads/, ads-view/, custom-pictures/, *.db, etc.

WORKDIR /usr/src/app
COPY ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]
RUN npm install --production --silent && mv node_modules ../

# Apple TV sidecar (pyatv) — dedicated venv, since Alpine's system Python is "externally
# managed" (PEP 668) and refuses a bare `pip install`. POSTERR_APPLETV_PYTHON tells Node
# which interpreter to spawn; without it, the feature just stays disabled.
# pyatv's chacha20poly1305-reuseable dependency compiles a native (cffi) extension, so a
# C/C++ toolchain is needed at build time only — removed again afterward to keep the image slim.
COPY sidecar/requirements.txt ./sidecar/requirements.txt
RUN apk add --no-cache --virtual .appletv-build-deps gcc g++ musl-dev libffi-dev python3-dev && \
    python3 -m venv /opt/appletv-venv && \
    /opt/appletv-venv/bin/pip install --no-cache-dir -r sidecar/requirements.txt && \
    apk del .appletv-build-deps
ENV POSTERR_APPLETV_PYTHON=/opt/appletv-venv/bin/python3

COPY . .

RUN mkdir -p config/cache/imagecache config/cache/mp3cache config/cache/randomthemes config/ads config/ads-view config/custom-pictures/default public/custom

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=15s CMD node healthcheck.js > /dev/null || exit 1
CMD ["node", "index.js"]