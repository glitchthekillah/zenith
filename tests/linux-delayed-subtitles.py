"""The movie that failed has its first PGS packet at 26.406 seconds, not at zero."""
import json,pathlib,subprocess
root=pathlib.Path('/tmp/zenith-media-fixtures')
sample=root/'pgs-source.mkv'
packets=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','s:0','-show_packets','-of','json',str(sample)]))['packets']
first=float(next(p['pts_time'] for p in packets if 'pts_time' in p))
output=root/'delayed.mkv'
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(root/'video.mkv'),'-itsoffset',str(26.406-first),'-i',str(sample),'-map','0:v:0','-map','0:a:0','-map','1:s:0','-c','copy','-t','60','-disposition:s:0','default',str(output)],check=True)
packets=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','s:0','-show_packets','-of','json',str(output)]))['packets']
assert packets and 25<float(packets[0]['pts_time'])<28,packets[:1]
for mode in ['auto','metadata','playbin3','playbin3-metadata','disabled','playbin3-disabled']:
    preload='metadata' if 'metadata' in mode else 'auto'
    before='const v=document.querySelector("video");'
    if 'disabled' in mode: before+='v.textTracks.addEventListener("addtrack",e=>{e.track.mode="disabled"});'
    (root/f'delayed-{mode}.html').write_text(f'<!doctype html><video autoplay controls playsinline preload="{preload}"></video><script>'+before+'v.src="delayed.mkv";v.play().catch(e=>window.playError=e.name+": "+e.message)</script>')
print(json.dumps({'firstSubtitlePTS':packets[0]['pts_time'],'subtitlePackets':len(packets)}))
