"""Exercise local direct-file decoding in real WebKitGTK, not Chromium mocks."""
import functools
import http.server
import json
import os
import pathlib
import subprocess
import tempfile
import threading
import time

import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, GLib, WebKit2


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check_media(directory, filename, port, profile_source):
    page_name = 'check-' + filename + '.html'
    page = pathlib.Path(directory) / page_name
    page.write_text('''<!doctype html><video id="v" muted autoplay playsinline></video><script>'''
                    + 'const desktop=false;\n' + profile_source + '\nwindow.profile=deviceProfile();'
                    + 'const v=document.getElementById("v");v.src=' + json.dumps(f'http://127.0.0.1:{port}/{filename}')
                    + ';v.play().catch(e=>window.playError=e.message);</script>', encoding='utf-8')
    window = Gtk.Window()
    view = WebKit2.WebView()
    view.get_settings().set_media_playback_requires_user_gesture(False)
    window.add(view)
    window.set_default_size(400, 280)
    window.show_all()
    result = {'done': False}
    deadline = time.monotonic() + 18
    busy = False

    def received(webview, async_result, _data):
        nonlocal busy
        try:
            value = webview.run_javascript_finish(async_result).get_js_value().to_string()
            state = json.loads(value)
            if state.get('error') or state.get('playError'):
                result.update(done=True, failure=state)
                Gtk.main_quit()
            elif state.get('width', 0) > 0 and state.get('time', 0) > .35:
                result.update(done=True, state=state)
                Gtk.main_quit()
        except Exception as error:
            result['last_error'] = str(error)
        finally:
            busy = False

    def poll():
        nonlocal busy
        if result['done']:
            return False
        if time.monotonic() > deadline:
            result.update(done=True, failure={'timeout': True, 'last_error': result.get('last_error')})
            Gtk.main_quit()
            return False
        if not busy:
            busy = True
            view.run_javascript("JSON.stringify({src:document.querySelector('video')?.currentSrc,width:document.querySelector('video')?.videoWidth,time:document.querySelector('video')?.currentTime,error:document.querySelector('video')?.error?.code,playError:window.playError,profile:window.profile})", None, received, None)
        return True

    view.load_uri(f'http://127.0.0.1:{port}/{page_name}')
    timer = GLib.timeout_add(200, poll)
    Gtk.main()
    GLib.source_remove(timer)
    window.destroy()
    assert 'failure' not in result, (filename, result)
    assert result['state']['src'].endswith('/' + filename), result
    profile = result['state']['profile']
    assert not profile['TranscodingProfiles']
    container, audio = ('mkv', 'ac3') if filename.endswith('.mkv') else ('mp4', 'aac')
    assert any(container in p['Container'].split(',') and 'h264' in p['VideoCodec'].split(',') and audio in p['AudioCodec'].split(',') for p in profile['DirectPlayProfiles']), ('decoded file excluded from profile', filename, profile)
    print(json.dumps({'file': filename, 'decoded_width': result['state']['width'], 'advanced_seconds': result['state']['time'], 'direct_play_profile': profile['DirectPlayProfiles']}), flush=True)


def main():
    for plugin in ['avdec_h264', 'avdec_ac3', 'matroskademux', 'qtdemux']:
        subprocess.run(['gst-inspect-1.0', plugin], check=True, stdout=subprocess.DEVNULL)
    source = pathlib.Path('app/js/jellyfin.js').read_text(encoding='utf-8')
    profile_source = source[source.index('function deviceProfile('):source.index('// Returns { url')]
    with tempfile.TemporaryDirectory(prefix='zenith-media-check-') as directory:
        for extension, audio in [('mkv', 'ac3'), ('mp4', 'aac')]:
            command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=5.1:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', audio]
            if extension == 'mp4':
                command += ['-movflags', '+faststart']
            subprocess.run(command + [str(pathlib.Path(directory) / ('video.' + extension))], check=True)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=directory))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for filename in ['video.mp4', 'video.mkv']:
                check_media(directory, filename, server.server_port, profile_source)
        finally:
            server.shutdown()
            server.server_close()
    print('WebKitGTK decoded original H.264/AAC MP4 and H.264/AC-3 MKV files; no server or conversion endpoint involved.', flush=True)


if __name__ == '__main__':
    main()
