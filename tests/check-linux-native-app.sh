#!/bin/bash
set -euo pipefail
source_dir="$PWD"
package=$(find src-tauri/target/release/bundle/appimage -maxdepth 1 -name '*.AppImage' -print -quit)
work=$(mktemp -d /tmp/zenith-native-app.XXXXXXXX)
cd "$work"
if [[ -n "${ZENITH_NATIVE_APPLICATION:-}" ]]; then
  application="$ZENITH_NATIVE_APPLICATION"
  test -x "$application"
  ldd "$application" | grep 'libgstplay-1.0.so'
else
  env -u APPIMAGE_EXTRACT_AND_RUN "$source_dir/$package" --appimage-extract >/dev/null
  export APPDIR="$work/squashfs-root"
  find "$APPDIR" -name 'libgstplay-1.0.so*' -print -quit | grep .
  application="$APPDIR/AppRun"
fi
if [[ "${ZENITH_PROBE_PLAYBIN3:-0}" = 1 ]]; then
  export GST_PLAY_USE_PLAYBIN3=1
  echo 'DIAGNOSTIC selecting GstPlay playbin3'
fi
if [[ "${ZENITH_PROBE_X11_THREADS:-0}" = 1 ]]; then
  cc -shared -fPIC "$source_dir/tests/x11-thread-init-probe.c" -Wl,-z,defs -l:libX11.so.6 -o "$work/xthreads-probe.so"
  cat >"$work/zenith-thread-probe" <<EOF
#!/bin/sh
export LD_PRELOAD="$work/xthreads-probe.so"
exec "$APPDIR/AppRun" "\$@"
EOF
  chmod +x "$work/zenith-thread-probe"
  application="$work/zenith-thread-probe"
fi
mkdir -p /tmp/zenith-media-fixtures
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=blue:size=640x360:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 60 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a ac3 -ac 6 /tmp/zenith-media-fixtures/video.mkv
python3 "$source_dir/tests/linux-realistic-fixtures.py"
python3 "$source_dir/tests/linux-delayed-subtitles.py"
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 30 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a ac3 -ac 6 /tmp/zenith-media-fixtures/moving.mkv
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 5 -c:v libx265 -preset ultrafast -x265-params pools=1:frame-threads=1 -pix_fmt yuv420p10le -c:a ac3 /tmp/zenith-media-fixtures/hevc10.mkv
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 5 -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 500k -c:a libopus /tmp/zenith-media-fixtures/vp9.mkv
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 5 -c:v libaom-av1 -cpu-used 8 -row-mt 1 -threads 2 -b:v 500k -c:a libopus /tmp/zenith-media-fixtures/av1.mkv
if [[ "${ZENITH_THROTTLED_TEST:-0}" = 1 ]]; then
  export ZENITH_FIXTURE_DELAY_MS=200
  export ZENITH_FIXTURE_BYTES_PER_SECOND=$(( $(stat -c%s /tmp/zenith-media-fixtures/moving.mkv) / 15 ))
  echo "Testing delayed HTTP ranges at $ZENITH_FIXTURE_BYTES_PER_SECOND bytes/s (twice the moving fixture bitrate)"
fi
node "$source_dir/tests/media-range-server.cjs" /tmp/zenith-media-fixtures >/tmp/native-app-http.log 2>&1 &
server=$!
parec --device=zenith-test.monitor --format=s16le --rate=48000 --channels=2 >/tmp/native-app-audio.pcm &
recorder=$!
trap 'kill "$server" "$recorder" 2>/dev/null || true' EXIT
export PULSE_SINK=zenith-test LIBGL_ALWAYS_SOFTWARE=1
if [ "${ZENITH_WAYLAND_TEST:-0}" = 1 ]; then
  dbus-run-session -- python3 "$source_dir/tests/native-video-webdriver.py" "$application"
else
  dbus-run-session -- xvfb-run -a python3 "$source_dir/tests/native-video-webdriver.py" "$application"
fi
kill "$recorder"; wait "$recorder" || true
python3 - <<'PY'
import array
with open('/tmp/native-app-audio.pcm','rb') as f:data=f.read()
samples=array.array('h',data[:len(data)//2*2])
assert samples and max(abs(x) for x in samples)>32,'Native app produced no audible output'
print('PASS shipped native app audible audio')
PY
