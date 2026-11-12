"""Run the same audible WebKit playback check in host and AppRun environments."""
import functools
import http.server
import os
from pathlib import Path
import threading

root = Path(os.environ['ZENITH_SOURCE'])
scope = {'__name__': 'packaged_probe'}
code = (root / 'tests/linux-playback.py').read_text()
code = code.replace('<video id="v" muted autoplay playsinline>', '<video id="v" autoplay playsinline>')
code = code.replace("state.get('time', 0) > .35", "state.get('time', 0) > 1.5")
exec(compile(code, 'linux-playback.py', 'exec'), scope)
source = (root / 'app/js/jellyfin.js').read_text()
profile = source[source.index('function deviceProfile('):source.index('// Returns { url')]
directory = os.environ['ZENITH_FIXTURES']
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(scope['QuietHandler'], directory=directory))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    for name in ['video.mp4', 'video.mkv']:
        scope['check_media'](directory, name, server.server_port, profile)
finally:
    server.shutdown()
    server.server_close()
print('PASS audible original-file playback:', os.environ.get('APPDIR', 'native host'), flush=True)
