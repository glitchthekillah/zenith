#!/usr/bin/env bash
# Actual Qt Quick/WebEngine + MpvQt playback in a CI X11 or Wayland/Pulse session.
set -euo pipefail
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
: "${ZENITH_QT_PLAYER:?Set ZENITH_QT_PLAYER to the built or packaged helper launcher}"
case "${CI:-}" in 1|true) ;; *) echo 'Qt CDP tests require CI=true; remote debugging is never enabled for normal playback.' >&2; exit 1;; esac
test -x "$ZENITH_QT_PLAYER"
if [[ "${ZENITH_QT_WAYLAND:-0}" = 1 ]]; then
  : "${WAYLAND_DISPLAY:?Run inside a Wayland compositor session}"
  export QT_QPA_PLATFORM=wayland ZENITH_QT_DIAGNOSTICS=1
else
  : "${DISPLAY:?Run in an X11 session (xvfb-run is supported)}"
  command -v import >/dev/null
fi
for tool in node python3 ffmpeg ffprobe parec pactl; do command -v "$tool" >/dev/null; done
node -e 'if(Number(process.versions.node.split(".")[0])<22||typeof WebSocket!=="function")throw Error("Node 22+ global WebSocket required")'
python3 -c 'from PIL import Image'
export ZENITH_QT_ARTIFACTS="${ZENITH_QT_ARTIFACTS:-$(mktemp -d /tmp/zenith-qt-player.XXXXXXXX)}"
mkdir -p "$ZENITH_QT_ARTIFACTS" /tmp/zenith-media-fixtures
export PULSE_SINK="${PULSE_SINK:-zenith-qt-test}"
sink_module=''
cleanup() { if [[ -n "$sink_module" ]]; then pactl unload-module "$sink_module" || true; fi; }
trap cleanup EXIT
if ! pactl list short sinks | awk '{print $2}' | grep -Fxq "$PULSE_SINK"; then
  sink_module=$(pactl load-module module-null-sink sink_name="$PULSE_SINK")
fi
# Public, hash-pinned subtitle data is shared with the GTK comparison harness.
ffmpeg -y -hide_banner -loglevel error -f lavfi -i color=c=blue:size=640x360:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 60 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a ac3 -ac 6 /tmp/zenith-media-fixtures/video.mkv
python3 "$source_dir/tests/linux-realistic-fixtures.py"
python3 "$source_dir/tests/linux-delayed-subtitles.py"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 30 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a ac3 -ac 6 /tmp/zenith-media-fixtures/moving.mkv
# The caller chooses software GL versus the physical graphics stack. Never
# silently force software rendering in a purported hardware test.
export QTWEBENGINE_REMOTE_DEBUGGING=127.0.0.1:9223
export QT_SCALE_FACTOR=1 QT_AUTO_SCREEN_SCALE_FACTOR=0
node "$source_dir/tests/qt-player-cdp.mjs" "$ZENITH_QT_PLAYER" "$source_dir/app"
echo "Qt runtime evidence: $ZENITH_QT_ARTIFACTS"
