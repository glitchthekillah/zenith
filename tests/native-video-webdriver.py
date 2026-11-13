"""Drive the shipped Linux app and its real GTK surface, not a Chromium mock."""
import array,base64,json,os,pathlib,subprocess,sys,time,urllib.request

def request(method,path,data=None):
    body=None if data is None else json.dumps(data).encode()
    req=urllib.request.Request('http://127.0.0.1:4444'+path,data=body,method=method,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=100) as response: result=json.load(response)
    value=result.get('value',result)
    if isinstance(value,dict) and value.get('error'):raise RuntimeError(value)
    return value

driver=subprocess.Popen(['tauri-driver'],stdout=open('/tmp/native-app-driver.log','w'),stderr=subprocess.STDOUT)
session=None
try:
    for _ in range(50):
        try:request('GET','/status');break
        except Exception:time.sleep(.2)
    created=request('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'wry','tauri:options':{'application':str(pathlib.Path(sys.argv[1]).resolve())}}}})
    session=created['sessionId'];base='/session/'+session
    request('POST',base+'/timeouts',{'script':90000})
    def js(code):return request('POST',base+'/execute/sync',{'script':code,'args':[]})
    def async_js(code):
        result=request('POST',base+'/execute/async',{'script':'const done=arguments[arguments.length-1];(async()=>{'+code+'})().then(value=>done({value}),e=>done({error:String(e),stack:e.stack}));','args':[]})
        assert 'error' not in result,result
        return result.get('value')
    for _ in range(100):
        if js('return !!window.__TAURI__?.core && !!document.body'):break
        time.sleep(.1)
    if os.environ.get('ZENITH_PROBE_BUFFERS') == '1':
        results=[]
        # Use the public factory injection hook. Tauri's invoke property is
        # read-only, so assigning a replacement silently does nothing.
        for seconds,byte_limit in [(15,64*1024*1024),(3,64*1024*1024),(3,4*1024*1024)]:
            async_js('''
              const {openNativeVideo,waitNativeVideo}=await import(new URL('js/native-video.js',document.baseURI));
              const {attachTauriBackend}=await import(new URL('vendor/native-video.js',document.baseURI));
              document.body.innerHTML='<video id="probe" style="position:fixed;left:40px;top:80px;width:640px;height:360px"></video>';
              const v=document.getElementById('probe'),abort=new AbortController();
              const controller=await openNativeVideo(v,{url:'http://127.0.0.1:18488/moving.mkv',controls:[],signal:abort.signal},(element,options)=>{
                options.playback.linux.buffer={maxSeconds:'''+str(seconds)+''',maxBytes:'''+str(byte_limit)+'''};
                return attachTauriBackend(element,options);
              });
              window.bufferProbe={v,controller,abort};await waitNativeVideo(v,abort.signal);return true;
            ''')
            for target in [18,4,23,9]:
                began=time.monotonic()
                async_js('await bufferProbe.controller.seek('+str(target)+');return true;')
                resumed=False
                while time.monotonic()-began<20:
                    quality=js('return bufferProbe.controller.playbackQuality()')
                    if quality['presentedFrames']>2 and target+.35<quality['mediaTimeSeconds']<target+4:
                        resumed=True;break
                    time.sleep(.2)
                stats=async_js('return await bufferProbe.controller.stats();')
                result={'seconds':seconds,'bytes':byte_limit,'target':target,'elapsed':round(time.monotonic()-began,2),'resumed':resumed,'stats':stats}
                results.append(result);print('BUFFER PROBE',json.dumps(result),flush=True)
            async_js('await bufferProbe.controller.destroy();return true;')
        print('BUFFER PROBE COMPLETE',json.dumps(results),flush=True)
        sys.exit(0)
    async_js('''
      const {openNativeVideo,waitNativeVideo}=await import(new URL('js/native-video.js',document.baseURI));
      document.body.innerHTML='<div style="position:fixed;inset:0;background:black"><video id="native-test" style="position:absolute;left:40px;top:80px;width:640px;height:360px"></video><button id="native-pause" data-air-video-controls style="position:absolute;left:50px;top:100px">Pause</button></div>';
      const v=document.getElementById('native-test'),abort=new AbortController();
      v.muted=true;
      const controller=await openNativeVideo(v,{url:'http://127.0.0.1:18488/delayed.mkv',controls:[document.getElementById('native-pause')],signal:abort.signal});
      window.nativeTest={v,controller,abort,errors:[]};controller.on('error',e=>nativeTest.errors.push(String(e.detail)));
      document.getElementById('native-pause').onclick=()=>v.paused?v.play():v.pause();
      await waitNativeVideo(v,abort.signal);
      return {width:v.videoWidth,duration:v.duration};
    ''')
    def until(expression,timeout=20):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            if js('return '+expression):return
            time.sleep(.2)
        raise AssertionError('Timed out: '+expression+'; '+json.dumps(js('const v=document.querySelector("#player video")||nativeTest.v;return {time:v.currentTime,width:v.videoWidth,errors:nativeTest.errors}')))
    until('nativeTest.v.currentTime>2 && nativeTest.controller.playbackQuality().presentedFrames>10')
    print('PASS shipped native surface decoded frames',js('return nativeTest.controller.playbackQuality()'),flush=True)
    def audio_peak():
        data=pathlib.Path('/tmp/native-app-audio.pcm').read_bytes()[-48000:]
        samples=array.array('h',data[:len(data)//2*2])
        return max((abs(sample) for sample in samples),default=0)
    assert audio_peak()<16,'A source opened muted produced audio'
    js('nativeTest.v.muted=false')
    deadline=time.monotonic()+5
    while audio_peak()<32 and time.monotonic()<deadline:time.sleep(.1)
    assert audio_peak()>32,'Unmuting a source opened muted did not restore audible audio'
    print('PASS source opened muted unmutes with audible audio',flush=True)
    js('document.getElementById("native-pause").click()');time.sleep(.5)
    paused=js('return {paused:nativeTest.v.paused,time:nativeTest.v.currentTime}');assert paused['paused'],paused
    time.sleep(.7);assert abs(js('return nativeTest.v.currentTime')-paused['time'])<.3
    js('document.getElementById("native-pause").click()');until('!nativeTest.v.paused')
    if os.environ.get('ZENITH_FOCUS_CONTROLS') != '1':
        async_js('await nativeTest.controller.seek(30);const subtitle=nativeTest.controller.tracks.find(t=>t.kind==="subtitle");if(subtitle)await nativeTest.controller.selectTrack("subtitle",subtitle.id);return true;')
        until('nativeTest.v.currentTime>32')
        for target in [5,27,30]:
            async_js('await nativeTest.controller.seek('+str(target)+');const subtitle=nativeTest.controller.tracks.find(t=>t.kind==="subtitle"&&t.selected);if(subtitle)await nativeTest.controller.selectTrack("subtitle",subtitle.id);return true;')
            until('nativeTest.v.currentTime>'+str(target+.35))
        print('PASS repeated seeking and restoring the already selected subtitle',flush=True)
        async_js('await nativeTest.controller.setPlaybackRate(1.5);return true;')
        pending=js('return nativeTest.v.currentTime')
        until('nativeTest.v.currentTime>'+str(pending+.4),timeout=15)
        before=js('return nativeTest.v.currentTime');time.sleep(1.5)
        assert js('return nativeTest.v.currentTime')-before>1.5
        assert js('return nativeTest.v.playbackRate')==1.5
        print('PASS pause, resume, seek, PGS and playback speed',flush=True)
    async_js('await window.zenithDesktop.win("fullscreen",true);return true;')
    time.sleep(.5);until('nativeTest.controller.playbackQuality().presentedFrames>20')
    async_js('await window.zenithDesktop.win("fullscreen",false);return true;')
    request('POST',base+'/window/rect',{'width':1000,'height':700})
    time.sleep(.5)
    assert not js('return nativeTest.errors.length'),js('return nativeTest.errors')
    if not os.environ.get('ZENITH_WAYLAND_TEST'):
        subprocess.run(['import','-window','root','/tmp/native-app-surface.png'],check=True)
        rect=request('GET',base+'/window/rect')
        point=f"p{{{int(rect['x'])+360},{int(rect['y'])+140}}}"
        color=subprocess.check_output(['convert','/tmp/native-app-surface.png','-format',f'%[fx:{point}.b],%[fx:{point}.r],%[fx:{point}.g]','info:'],text=True)
        blue,red,green=map(float,color.split(','));assert blue>.5 and red<.3 and green<.3,('native video is not visibly composited',color)
        print('PASS native video is visible beneath HTML controls',flush=True)
    if os.environ.get('ZENITH_FOCUS_CONTROLS') != '1':
        async_js('nativeTest.endedEvents=0;nativeTest.v.addEventListener("ended",()=>nativeTest.endedEvents++);await nativeTest.controller.seek(58);return true;')
        until('nativeTest.v.ended && nativeTest.endedEvents===1',timeout=15)
        async_js('await nativeTest.controller.play();return true;')
        until('!nativeTest.v.ended && nativeTest.v.currentTime>.5 && nativeTest.v.currentTime<5')
        print('PASS natural end-of-file event and replay',flush=True)
    async_js('nativeTest.abort.abort();await nativeTest.controller.destroy();return true;')
    until('!document.documentElement.classList.contains("tauri-native-video")',timeout=5)
    print('PASS fullscreen, resize, controls and native surface cleanup',flush=True)
    metadata=async_js('''
      const core=await import(new URL('js/core.js',document.baseURI));
      const player=await import(new URL('js/player.js',document.baseURI));
      core.settings.groups=[{id:'fixture',name:'Fixture',servers:{jellyfin:{url:'http://127.0.0.1:18488',token:'synthetic',userId:'fixture'}}}];
      core.groups.use('fixture');core.settings.app.discord=false;
      core.settings.playback.rate=1;core.settings.playback.subtitles='off';
      const source={Id:'fixture',Container:'mkv',SupportsDirectPlay:true,DefaultAudioStreamIndex:1,DefaultSubtitleStreamIndex:-1,MediaStreams:[{Index:0,Type:'Video',Codec:'h264',Width:640,Height:360},{Index:1,Type:'Audio',Codec:'ac3',Language:'eng',IsDefault:true}]};
      window.zenithDesktop.http=async(url)=>({ok:true,status:200,headers:{'content-type':'application/json'},body:JSON.stringify(url.includes('PlaybackInfo')?{MediaSources:[source],PlaySessionId:'fixture'}:{Items:[],Valid:false})});
      // Restore the real page structure removed by the surface-only test.
      document.body.innerHTML='<div id="app"><main id="view">Fixture library</main></div><div id="player" hidden></div><div id="toasts"></div>';
      window.uiMetadataEvents=[];
      const observed=new WeakSet();
      const observeMetadata=()=>{for(const v of document.querySelectorAll('#player video'))if(!observed.has(v)){
        observed.add(v);v.addEventListener('loadedmetadata',()=>uiMetadataEvents.push({width:v.videoWidth,duration:v.duration}));
      }};
      const observer=new MutationObserver(observeMetadata);observer.observe(document.body,{childList:true,subtree:true});observeMetadata();
      window.playerUiTest={player,source};
      await player.play({Id:'fixture',Name:'Moving video fixture',Type:'Movie',RunTimeTicks:600000000,MediaSources:[source],UserData:{}},{start:0});
      observer.disconnect();const v=document.querySelector("#player video");return {width:v.videoWidth,duration:v.duration,events:uiMetadataEvents};
    ''')
    assert metadata['width']==1280 and abs(metadata['duration']-30)<.15,('New title accepted previous-source metadata',metadata)
    assert metadata['events'] and all(event['width']==1280 and abs(event['duration']-30)<.15 for event in metadata['events']),('loadedmetadata exposed the previous source',metadata)
    until('document.querySelector("#player video").currentTime>2')
    # Exercise the GTK/WebKit input route rather than dispatching DOM events.
    # An overlay can pass DOM-only checks while swallowing real mouse input.
    time.sleep(3.2)
    request('POST',base+'/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','duration':100,'origin':'viewport','x':300,'y':250}]}]})
    until('Number(getComputedStyle(document.querySelector(".pl-ui")).opacity)>.9',timeout=4)
    button=js('const r=document.querySelector("[data-p=settings]").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}')
    request('POST',base+'/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','duration':100,'origin':'viewport',**button},{'type':'pointerDown','button':0},{'type':'pointerUp','button':0}]}]})
    until('!!document.querySelector(".pl-menu")',timeout=4)
    request('DELETE',base+'/actions')
    js('document.querySelector("[data-p=settings]").click()')
    until('!document.querySelector(".pl-menu")',timeout=4)
    print('PASS real pointer wakes controls and opens settings through GTK',flush=True)
    for target in [18,4,23,9]:
        began=time.monotonic()
        js('document.querySelector("#player video").currentTime='+str(target))
        if target==18 and os.environ.get('ZENITH_THROTTLED_TEST')=='1':
            until('!document.querySelector(".pl-center").hidden',timeout=4)
            until('Number(getComputedStyle(document.querySelector(".pl-ui")).opacity)>.9',timeout=4)
            button=js('const r=document.querySelector("[data-p=settings]").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}')
            request('POST',base+'/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','duration':100,'origin':'viewport',**button},{'type':'pointerDown','button':0},{'type':'pointerUp','button':0}]}]})
            until('!!document.querySelector(".pl-menu")',timeout=3)
            js('document.querySelector("[data-p=settings]").click()')
            until('!document.querySelector(".pl-menu")',timeout=3)
            print('PASS real player remains interactive and shows loading while a network seek is pending',flush=True)
        until('Math.abs(document.querySelector("#player video").currentTime-'+str(target)+')<2',timeout=12)
        time.sleep(.5)
        before=js('return document.querySelector("#player video").currentTime')
        until('document.querySelector("#player video").currentTime>'+str(before+.4),timeout=12)
        if not os.environ.get('ZENITH_WAYLAND_TEST'):
            image='/tmp/native-app-after-seek.png'
            subprocess.run(['import','-window','root',image],check=True)
            mean=float(subprocess.check_output(['convert',image,'-gravity','center','-crop','200x120+0+0','+repage','-colorspace','Gray','-format','%[fx:mean]','info:'],text=True))
            assert mean>.04,('Seeking advanced the clock but left a black picture',target,mean)
        print('PASS actual player seek resumed picture',target,'elapsed',round(time.monotonic()-began,2),flush=True)
    if not os.environ.get('ZENITH_WAYLAND_TEST'):
        window_rect=request('GET',base+'/window/rect')
        video_rect=js('const r=document.querySelector("#player video").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}')
        crop=f"{int(video_rect['width']*.2)}x{int(video_rect['height']*.35)}+{int(window_rect['x']+video_rect['x']+video_rect['width']*.15)}+{int(window_rect['y']+video_rect['y']+video_rect['height']*.25)}"
        for sample in range(6):
            image=f'/tmp/native-app-player-frame-{sample}.png'
            subprocess.run(['import','-window','root',image],check=True)
            mean=float(subprocess.check_output(['convert',image,'-crop',crop,'+repage','-colorspace','Gray','-format','%[fx:mean]','info:'],text=True))
            assert mean>.04,('Native picture disappeared behind the actual player UI',sample,mean)
            time.sleep(.15)
        print('PASS native moving picture remains visible behind the actual player UI',flush=True)
    def capture_ui(name):
        image='/tmp/native-app-'+name+'.png'
        encoded=request('GET',base+'/screenshot')
        pathlib.Path(image).write_bytes(base64.b64decode(encoded))
        return image
    js('document.querySelector("#player video").pause();document.querySelector("#player").dispatchEvent(new MouseEvent("mousemove",{bubbles:true}))')
    assert js('return !document.querySelector(".pl-menu")'),'Menu should be closed before taking the closed reference'
    time.sleep(.5)
    closed=capture_ui('controls')
    js('document.querySelector("[data-p=settings]").click()')
    time.sleep(.5)
    opened=capture_ui('menu')
    rect=js('const r=document.querySelector(".pl-menu").getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}')
    assert rect['width']>100 and rect['height']>40,rect
    crop=f"{rect['width']}x{rect['height']}+{rect['x']}+{rect['y']}"
    difference=float(subprocess.check_output(['convert',closed,opened,'-compose','difference','-composite','-crop',crop,'+repage','-colorspace','Gray','-format','%[fx:mean]','info:'],text=True))
    assert difference>.003,('Menu exists in DOM but its pixels were not presented',difference)
    print('PASS actual player menu visibly changes the rendered pixels',difference,flush=True)
    js('document.querySelector("[data-p=settings]").click();document.querySelector("#player video").play()')
    for cycle in range(3):
        js('document.querySelector("#player").dispatchEvent(new MouseEvent("mousemove",{bubbles:true}));document.querySelector("[data-p=settings]").click()')
        assert js('return !!document.querySelector(".pl-menu")')
        time.sleep(.5)
        js('document.querySelector("[data-p=settings]").click()')
        async_js('await playerUiTest.player.close(true);await playerUiTest.player.play({Id:"fixture",Name:"Replacement fixture",Type:"Movie",RunTimeTicks:600000000,MediaSources:[playerUiTest.source],UserData:{}},{start:0});return true;')
        until('document.querySelector("#player video").currentTime>1')
    assert not js('return !!document.querySelector(".pl-error")')
    async_js('await playerUiTest.player.close(true);return true;')
    print('PASS actual player UI, menus and repeated title changes',flush=True)
    for source,codec,audio in [('hevc10','hevc','ac3'),('vp9','vp9','opus'),('av1','av1','opus')]:
        async_js('playerUiTest.source.Id='+json.dumps(source)+';playerUiTest.source.MediaStreams[0].Codec='+json.dumps(codec)+';playerUiTest.source.MediaStreams[1].Codec='+json.dumps(audio)+';await playerUiTest.player.play({Id:"fixture",Name:"Codec compatibility",Type:"Movie",RunTimeTicks:50000000,MediaSources:[playerUiTest.source],UserData:{}},{start:0});return true;')
        until('document.querySelector("#player video").currentTime>1 && document.querySelector("#player video").videoWidth>=320')
        assert not js('return !!document.querySelector(".pl-error")'),source
        if not os.environ.get('ZENITH_WAYLAND_TEST'):
            image=f'/tmp/native-app-codec-{source}.png'
            subprocess.run(['import','-window','root',image],check=True)
            mean=float(subprocess.check_output(['convert',image,'-crop',crop,'+repage','-colorspace','Gray','-format','%[fx:mean]','info:'],text=True))
            assert mean>.04,('Codec progressed but its picture was black',source,mean)
        print('PASS original-file native codec compatibility',source,flush=True)
    async_js('await playerUiTest.player.close(true);return true;')
finally:
    if session:
        try:request('DELETE','/session/'+session)
        except Exception:pass
    driver.terminate()
    try:driver.wait(timeout=5)
    except subprocess.TimeoutExpired:driver.kill()
