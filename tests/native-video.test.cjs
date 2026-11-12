const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function subject(){const c={DOMException,AbortController,EventTarget,Event,setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(fs.readFileSync('app/js/native-video.js','utf8').replace(/^export /gm,'')+'\nglobalThis.subject={openNativeVideo,nativeTrackId,waitNativeVideo};',c);return c.subject;}
test('native attachment receives only the original URL, controls and bounded buffer settings',async()=>{
 const calls=[],video={},controls={},abort=new AbortController(),controller={destroy:async()=>{}};
 const result=await subject().openNativeVideo(video,{url:'https://media.test/Videos/item/stream?static=true',controls,signal:abort.signal},async(v,o)=>{calls.push({v,o});return controller});
 assert.equal(result,controller);assert.equal(calls[0].v,video);assert.equal(calls[0].o.source.uri,'https://media.test/Videos/item/stream?static=true');assert.equal(calls[0].o.controlRegions,controls);assert.equal(calls[0].o.playback.engine,'gstreamer');assert.equal(calls[0].o.playback.linux.buffer.maxBytes,64*1024*1024);
});
test('a late native attachment is destroyed when its owning load has been cancelled',async()=>{
 const abort=new AbortController();let release,destroyed=0;const ready=new Promise(r=>release=r);
 const promise=subject().openNativeVideo({}, {url:'https://media.test/original',signal:abort.signal},()=>ready);
 abort.abort();release({destroy:async()=>destroyed++});await assert.rejects(promise,{name:'AbortError'});assert.equal(destroyed,1);
});
test('already-cancelled loads never allocate a native surface',async()=>{
 const abort=new AbortController();abort.abort();let called=false;
 await assert.rejects(subject().openNativeVideo({}, {url:'https://media.test/original',signal:abort.signal},async()=>{called=true}),{name:'AbortError'});assert.equal(called,false);
});
test('global Jellyfin file indices map to tracks within their own kind',()=>{
 const controller={tracks:[{id:'v',kind:'video'},{id:'a1',kind:'audio'},{id:'s1',kind:'subtitle'},{id:'a2',kind:'audio'}]};
 assert.equal(subject().nativeTrackId(controller,'audio',7,[{index:1},{index:7}]),'a2');
 assert.equal(subject().nativeTrackId(controller,'subtitle',12,[{index:9,external:true},{index:12}]),'s1');
 assert.equal(subject().nativeTrackId(controller,'subtitle',9,[{index:9,external:true},{index:12}]),undefined);
 assert.equal(subject().nativeTrackId(controller,'subtitle',null,[{index:12}]),undefined);
});
test('resume waits for decoded video metadata, not merely native allocation',async()=>{
 const video=Object.assign(new EventTarget(),{videoWidth:0,readyState:0});let ready=false;
 const promise=subject().waitNativeVideo(video,new AbortController().signal).then(()=>ready=true);
 video.dispatchEvent(new Event('loadedmetadata'));await Promise.resolve();assert.equal(ready,false);
 video.videoWidth=640;video.readyState=4;video.dispatchEvent(new Event('canplay'));await promise;assert.equal(ready,true);
});
test('closing during native preroll cancels the wait',async()=>{
 const video=Object.assign(new EventTarget(),{videoWidth:0,readyState:0}),abort=new AbortController();
 const promise=subject().waitNativeVideo(video,abort.signal);abort.abort();await assert.rejects(promise,{name:'AbortError'});
});
