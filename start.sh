#!/bin/sh
# Lunar Landing Site Navigator: serve the app locally and open it in the browser.
# Usage: ./start.sh [port]        (default port 8000; stop with Ctrl+C)
# Needs only Python 3. All data the app uses is already in web/data/.
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
PY="$(command -v python3 || command -v python)"
if [ -z "$PY" ]; then
  echo "Python 3 is needed to serve the app: https://www.python.org/downloads/"
  echo "Any static web server works too; serve this folder and open /web/."
  exit 1
fi
URL="http://localhost:$PORT/web/"
echo "Lunar Landing Site Navigator: $URL"
echo "Press Ctrl+C to stop. If the port is busy, run: ./start.sh 8080"
(
  sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
) >/dev/null 2>&1 &
exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
