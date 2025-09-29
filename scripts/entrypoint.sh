#!/usr/bin/env bash
set -euo pipefail

if [[ "${DEBUG:-}" != "" ]]; then
  set -x
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: page-stream --ingest <SRT/RTMP URI> [--url <page>] [options...]"
fi

# Forward refresh requests: touch /tmp/refresh or kill -HUP <pid>
REFRESH_FIFO=/tmp/page_refresh_fifo
if [[ ! -p "$REFRESH_FIFO" ]]; then
  mkfifo "$REFRESH_FIFO"
fi

LIGHT_NOVNC=${LIGHTWEIGHT_NOVNC:-0}

if [[ "$LIGHT_NOVNC" != "1" ]]; then
  # Launch Xvfb background (normal mode)
  XVFB_W=${WIDTH:-1280}
  XVFB_H=${HEIGHT:-720}
  XVFB_D=${DISPLAY:-:99}
  Xvfb $XVFB_D -screen 0 ${XVFB_W}x${XVFB_H}x24 -ac +extension RANDR +extension GLX 2>/dev/null &
  XVFB_PID=$!
  trap 'kill $XVFB_PID 2>/dev/null || true' EXIT
else
  # In lightweight mode we don't start Xvfb or browser (test mode should skip heavy startup anyway)
  echo "[lightweight] Skipping Xvfb (test mode)"
fi

# Optional noVNC stack
if [[ "${ENABLE_NOVNC:-0}" == "1" ]]; then
  echo "[noVNC] Enabling VNC + web socket bridge (port 6080)"
  if [[ "$LIGHT_NOVNC" == "1" ]]; then
    # Lightweight fallback server (HTTP only) for host-based tests without websockify/x11vnc
    node -e 'require("http").createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/plain"});res.end("noVNC test placeholder\n");}).listen(6080,"127.0.0.1",()=>console.error("[noVNC] fallback HTTP started (lightweight)"));' &
    FALLBACK_PID=$!
    trap 'kill $FALLBACK_PID 2>/dev/null || true' EXIT
  else
    # Start x11vnc and websockify if available
    x11vnc -display ${XVFB_D:-:99} -nopw -forever -shared -rfbport 5900 -localhost &
    X11VNC_PID=$!
    trap 'kill $X11VNC_PID 2>/dev/null || true' EXIT
    if command -v websockify >/dev/null 2>&1; then
      websockify --web /usr/share/novnc/ 6080 localhost:5900 &
      WEBSOCKIFY_PID=$!
      trap 'kill $WEBSOCKIFY_PID 2>/dev/null || true' EXIT
    else
      echo "[noVNC] WARNING: websockify not found, using lightweight fallback"
      node -e 'require("http").createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/plain"});res.end("noVNC fallback (no websockify)\n");}).listen(6080,"127.0.0.1",()=>console.error("[noVNC] fallback HTTP started"));' &
      FALLBACK_PID=$!
      trap 'kill $FALLBACK_PID 2>/dev/null || true' EXIT
    fi
  fi
  # Readiness probe (works for both real and fallback)
  for i in {1..60}; do
    if bash -c 'exec 3<>/dev/tcp/127.0.0.1/6080' 2>/dev/null; then
      echo -e "GET / HTTP/1.0\r\n\r\n" >&3 || true
      sleep 0.1
      echo "[noVNC] ready (after ${i} attempts)" >&2
      if [[ "${EXIT_AFTER_READY:-0}" == "1" && "${LIGHTWEIGHT_NOVNC:-0}" == "1" ]]; then
        echo "[noVNC] exiting after readiness (test mode)" >&2
        # Allow background processes to flush
        sleep 0.1
        exit 0
      fi
      break
    fi
    sleep 0.25
    if [[ $i -eq 60 ]]; then
      echo "[noVNC] WARNING: readiness probe timed out" >&2
    fi
  done
fi

# Start node process
node dist/index.js "$@" &
APP_PID=$!

# Relay HUP to refresh
while true; do
  if read line < "$REFRESH_FIFO"; then
    echo "Received refresh request via fifo" >&2
    kill -HUP "$APP_PID" || true
  fi
done &
FIFO_LOOP_PID=$!
trap 'kill $FIFO_LOOP_PID 2>/dev/null || true' EXIT

# When container receives HUP -> refresh
trap 'echo "Container caught HUP -> refreshing"; kill -HUP $APP_PID' HUP
# Graceful stop
trap 'echo "Stopping..."; kill -TERM $APP_PID; wait $APP_PID || true; exit 0' TERM INT

wait $APP_PID
