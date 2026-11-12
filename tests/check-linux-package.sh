#!/bin/bash
set -euo pipefail
source_dir="$PWD"
package=$(find src-tauri/target/release/bundle/appimage -maxdepth 1 -name '*.AppImage' -print -quit)
test -n "$package"
work=$(mktemp -d /tmp/zenith-package-test.XXXXXXXX)
server_pid=''
record_pid=''
cleanup() {
  if [ -n "$record_pid" ]; then kill "$record_pid" 2>/dev/null || true; fi
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
cd "$work"
env -u APPIMAGE_EXTRACT_AND_RUN "$source_dir/$package" --appimage-extract >/dev/null
export APPDIR="$work/squashfs-root"
runtime=$(env -u WPE_SHELL_MEDIA_DISK_CACHE_SIZE_BYTES "$APPDIR/AppRun" --zenith-media-runtime)
echo "Shipped runtime: $runtime"
export WPE_SHELL_MEDIA_DISK_CACHE_SIZE_BYTES=$(node -e 'const x=JSON.parse(process.argv[1]);if(x.mediaBufferBytes!==33554432||x.version!==process.argv[2])process.exit(1);console.log(x.mediaBufferBytes)' "$runtime" "$(node -p "require('$source_dir/package.json').version")")
test "$WPE_SHELL_MEDIA_DISK_CACHE_SIZE_BYTES" = 33554432
mkdir fixtures
for audio in aac ac3; do
  if [ "$audio" = ac3 ]; then ext=mkv; else ext=mp4; fi
  ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=1920x1080:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 4 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a "$audio" -ac 6 "fixtures/video.$ext"
  printf '<!doctype html><video autoplay controls playsinline src="video.%s"></video><script>document.querySelector("video").play().catch(e=>window.playError=e.name+": "+e.message)</script>' "$ext" > "fixtures/$ext.html"
done
node "$source_dir/tests/media-range-server.cjs" "$work/fixtures" >http.log 2>&1 &
server_pid=$!
gcc -Wno-deprecated-declarations "$source_dir/tests/linux-webkit-probe.c" -o probe $(pkg-config --cflags --libs webkit2gtk-4.1)
cp probe "$APPDIR/usr/bin/zenith"
export PULSE_SINK=zenith-test
for ext in mp4 mkv; do
  parec --device=zenith-test.monitor --format=s16le --rate=48000 --channels=2 >"$work/$ext.pcm" &
  record_pid=$!
  ZENITH_PROBE_URL="http://127.0.0.1:18488/$ext.html" dbus-run-session -- xvfb-run -a "$APPDIR/AppRun"
  kill "$record_pid"; wait "$record_pid" || true; record_pid=''
  /usr/bin/python3 - "$work/$ext.pcm" <<'PY'
import array,sys
with open(sys.argv[1],'rb') as stream:
    data=stream.read()
samples=array.array('h',data[:len(data)//2*2])
assert samples and max(abs(x) for x in samples)>32, 'No audible synthetic audio reached the output sink'
print('Verified original-file video progress and non-silent audio:',sys.argv[1].split('/')[-1])
PY
done
