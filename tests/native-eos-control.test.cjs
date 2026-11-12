const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
test('a control response that first observes EOS cannot swallow the ended event',async()=>{
 const file=path.resolve('third-party/air-native-video/guest-js/index.ts');
 // Expose one private poll entry only in this in-memory test bundle, not the shipped adapter.
 const source=fs.readFileSync(file,'utf8').replace('class NativeSurfaceVideoController extends EventTarget implements BackendVideoController {','export class NativeSurfaceVideoController extends EventTarget implements BackendVideoController { async testPoll(){await this.#poll()}');
 const compiled=await build({stdin:{contents:source,resolveDir:path.dirname(file),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const oldWindow=globalThis.window,oldFrame=globalThis.requestAnimationFrame;
 const snapshot={ended:true,durationSeconds:60.032,currentTimeSeconds:60,bufferedSeconds:60,playing:false,videoWidth:640,videoHeight:360,tracks:[]};
 globalThis.window={__TAURI_INTERNALS__:{invoke:async()=>structuredClone(snapshot)}};globalThis.requestAnimationFrame=()=>1;
 try{
  const {NativeSurfaceVideoController}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const video=Object.assign(new EventTarget(),{volume:1,muted:false,style:{objectFit:'contain',transform:'none',transformOrigin:'center'}});
  const controller=new NativeSurfaceVideoController(video,{source:'https://media.test/original',autoplay:true});let ended=0;
  video.addEventListener('ended',()=>ended++);
  await controller.setVolume(.5); // This response, rather than polling, drains the native EOS.
  await controller.testPoll();assert.equal(ended,1);
  await controller.testPoll();assert.equal(ended,1,'EOS must not repeat on every poll');
  snapshot.ended=false;snapshot.currentTimeSeconds=0;snapshot.playing=true;
  await controller.setVolume(.5);await controller.testPoll();assert.equal(ended,1);
  snapshot.ended=true;snapshot.currentTimeSeconds=60;snapshot.playing=false;
  await controller.setVolume(.7);await controller.testPoll();assert.equal(ended,2,'A replay gets its own end event');
 }finally{globalThis.window=oldWindow;globalThis.requestAnimationFrame=oldFrame;}
});
test('a pending native poll cannot publish events after disposal',async()=>{
 const file=path.resolve('third-party/air-native-video/guest-js/index.ts');
 const source=fs.readFileSync(file,'utf8').replace('class NativeSurfaceVideoController extends EventTarget implements BackendVideoController {','export class NativeSurfaceVideoController extends EventTarget implements BackendVideoController { async testPoll(){await this.#poll()} testDispose(){this.#destroyed=true}');
 const compiled=await build({stdin:{contents:source,resolveDir:path.dirname(file),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const oldWindow=globalThis.window,oldFrame=globalThis.requestAnimationFrame;let resolveStats;
 globalThis.window={__TAURI_INTERNALS__:{invoke:()=>new Promise(resolve=>{resolveStats=resolve})}};globalThis.requestAnimationFrame=()=>1;
 try{
  const {NativeSurfaceVideoController}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const video=Object.assign(new EventTarget(),{volume:1,muted:false,style:{objectFit:'contain',transform:'none',transformOrigin:'center'}});
  const controller=new NativeSurfaceVideoController(video,{source:'https://media.test/original',autoplay:true});const events=[];
  for(const type of ['ended','timeupdate','loadedmetadata','pause','progress'])video.addEventListener(type,()=>events.push(type));
  const pending=controller.testPoll();controller.testDispose();
  resolveStats({ended:true,durationSeconds:60.032,currentTimeSeconds:60,bufferedSeconds:60,playing:false,videoWidth:640,videoHeight:360,tracks:[]});
  await pending;assert.deepEqual(events,[],'Disposed media must not end or update the replacement session');
 }finally{globalThis.window=oldWindow;globalThis.requestAnimationFrame=oldFrame;}
});
