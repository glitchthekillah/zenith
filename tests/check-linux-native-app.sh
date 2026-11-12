#!/bin/bash
set -euo pipefail
source_dir="$PWD"
package=$(find src-tauri/target/release/bundle/appimage -maxdepth 1 -name '*.AppImage' -print -quit)
work=$(mktemp -d /tmp/zenith-native-app.XXXXXXXX)
cd "$work"
env -u APPIMAGE_EXTRACT_AND_RUN "$source_dir/$package" --appimage-extract >/dev/null
export APPDIR="$work/squashfs-root"
mkdir -p /tmp/zenith-media-fixtures
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=blue:size=640x360:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 60 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a ac3 -ac 6 /tmp/zenith-media-fixtures/video.mkv
python3 "$source_dir/tests/linux-realistic-fixtures.py"
python3 "$source_dir/tests/linux-delayed-subtitles.py"
node "$source_dir/tests/media-range-server.cjs" /tmp/zenith-media-fixtures >/tmp/native-app-http.log 2>&1 &
server=$!
parec --device=zenith-test.monitor --format=s16le --rate=48000 --channels=2 >/tmp/native-app-audio.pcm &
recorder=$!
trap 'kill "$server" "$recorder" 2>/dev/null || true' EXIT
export PULSE_SINK=zenith-test LIBGL_ALWAYS_SOFTWARE=1
if [ "${ZENITH_WAYLAND_TEST:-0}" = 1 ]; then
  dbus-run-session -- python3 "$source_dir/tests/native-video-webdriver.py" "$APPDIR/AppRun"
else
  dbus-run-session -- xvfb-run -a python3 "$source_dir/tests/native-video-webdriver.py" "$APPDIR/AppRun"
fi
kill "$recorder"; wait "$recorder" || true
python3 - <<'PY'
import array
with open('/tmp/native-app-audio.pcm','rb') as f:data=f.read()
samples=array.array('h',data[:len(data)//2*2])
assert samples and max(abs(x) for x in samples)>32,'Native app produced no audible output'
print('PASS shipped native app audible audio')
PY
