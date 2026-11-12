"""Reproduce the reported stream layout without uploading private library media."""
import hashlib
import json
import pathlib
import subprocess
import urllib.request

root = pathlib.Path('/tmp/zenith-media-fixtures')
root.mkdir(exist_ok=True)
sample = root / 'pgs-source.mkv'
with urllib.request.urlopen('https://samples.ffmpeg.org/sub/PGS/supsample.mkv', timeout=30) as response:
    sample.write_bytes(response.read(100000))
assert hashlib.sha256(sample.read_bytes()).hexdigest() == 'e6c8f93f57d0371603704d7e7b16933e6c4c5df669da42b42a2a84de881e0f27'
packets = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 's:0', '-show_packets', '-of', 'json', str(sample)]))['packets']
first = float(next(p['pts_time'] for p in packets if 'pts_time' in p))
subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(root / 'video.mkv'), '-itsoffset', str(-first), '-i', str(sample), '-map', '0:v:0', '-map', '0:a:0', '-map', '1:s:0', '-c', 'copy', '-t', '4', '-disposition:s:0', 'default', str(root / 'pgs.mkv')], check=True)
streams = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(root / 'pgs.mkv')]))['streams']
assert any(s['codec_name'] == 'hdmv_pgs_subtitle' and s['disposition']['default'] for s in streams)
for label, source in [('pgs', 'pgs.mkv'), ('route', 'video.mkv'), ('pgs-route', 'pgs.mkv')]:
    uri = source if label == 'pgs' else '/Videos/fixture/stream?static=true&file=' + source
    (root / (label + '.html')).write_text('<!doctype html><video autoplay controls playsinline src="' + uri + '"></video><script>document.querySelector("video").play().catch(e=>window.playError=e.name+": "+e.message)</script>')
for label, name in [('https-mp4', 'video.mp4'), ('https-mkv', 'video.mkv'), ('https-pgs', 'pgs.mkv')]:
    (root / (label + '.html')).write_text('<!doctype html><video autoplay controls playsinline src="https://localhost:18489/' + name + '"></video><script>document.querySelector("video").play().catch(e=>window.playError=e.name+": "+e.message)</script>')
print(json.dumps({'fixture': 'synthetic h264/ac3 plus public FFmpeg PGS sample', 'streams': [s['codec_name'] for s in streams]}), flush=True)
