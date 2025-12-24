#!/bin/sh
set -eu

# Compositor output resolution (after hstack of two 960x1080 sources)
OUT_W="${COMPOSITOR_WIDTH:-1920}"
OUT_H="${COMPOSITOR_HEIGHT:-1080}"

# Overscan percentage (0-50). If set, scales down content and pads to full resolution.
# Example: COMPOSITOR_OVERSCAN=5 means 5% inset on all sides (content at 90% size)
OVERSCAN="${COMPOSITOR_OVERSCAN:-0}"

# Build the filter chain
BASE_FILTER="[0:v]fps=30,setpts=N/FRAME_RATE/TB[v0];[1:v]fps=30,setpts=N/FRAME_RATE/TB[v1];[v0][v1]hstack=inputs=2"

if [ "$OVERSCAN" -gt 0 ] 2>/dev/null; then
  # Calculate scaled dimensions: factor = (100 - 2*overscan) / 100
  SCALE_W=$(( OUT_W * (100 - 2 * OVERSCAN) / 100 ))
  SCALE_H=$(( OUT_H * (100 - 2 * OVERSCAN) / 100 ))
  FILTER_COMPLEX="${BASE_FILTER},scale=${SCALE_W}:${SCALE_H},pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2[outv]"
  echo "Compositor overscan: ${OVERSCAN}% (content ${SCALE_W}x${SCALE_H} padded to ${OUT_W}x${OUT_H})"
else
  FILTER_COMPLEX="${BASE_FILTER}[outv]"
fi

while true; do
  ffmpeg -hide_banner -loglevel info \
    -fflags +genpts+igndts \
    -thread_queue_size 64 -i "srt://0.0.0.0:10001?mode=listener&latency=10000" \
    -thread_queue_size 64 -i "srt://0.0.0.0:10002?mode=listener&latency=10000" \
    -filter_complex "$FILTER_COMPLEX" \
    -map "[outv]" -map 0:a \
    -async 1 -vsync cfr -r 30 \
    -c:v libx264 -preset ultrafast -tune zerolatency -b:v 3000k -maxrate 3500k -bufsize 6000k -g 30 -keyint_min 30 -sc_threshold 0 \
    -c:a aac -b:a 128k -ar 44100 \
    -f mpegts "${COMPOSITOR_INGEST:-srt://srt-ingest:9000?streamid=composite&latency=10000}" || true
  echo "Compositor stream ended, retrying in 5 seconds..."
  sleep 5
done
