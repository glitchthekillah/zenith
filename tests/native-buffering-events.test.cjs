const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');

test('native buffering notifies the actual video controls once and resumes them without changing play intent',async()=>{
 const file=path.resolve('third-party/air-native-video/guest-js/index.ts');
 const source=fs.readFileSync(file,'utf8').replace('class NativeSurfaceVideoController extends EventTarget implements BackendVideoController {','export class NativeSurfaceVideoController extends EventTarget implements BackendVideoController { async testPoll(){this.#metadataReady=true;await this.#poll()} testSnapshot(value){this.#snapshot=value}');
 const compiled=await build({stdin:{contents:source,resolveDir:path.dirname(file),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const previousWindow=globalThis.window,previousFrame=globalThis.requestAnimationFrame;
 const snapshot=buffering=>({tracks:[],playing:true,buffering,currentTimeSeconds:10,durationSeconds:100,videoWidth:1280});
 let next=snapshot(true);
 try{
  globalThis.window={__TAURI_INTERNALS__:{invoke:async()=>next},setTimeout:()=>1,clearTimeout:()=>{}};
  globalThis.requestAnimationFrame=()=>1;
  const {NativeSurfaceVideoController}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const video=Object.assign(new EventTarget(),{volume:1,muted:false,style:{objectFit:'contain',transform:'none',transformOrigin:'center'}});
  const c=new NativeSurfaceVideoController(video,{source:'https://fixture.test/original',autoplay:true});
  c.testSnapshot(snapshot(false));
  const events=[];for(const name of ['waiting','playing','pause'])video.addEventListener(name,()=>events.push(name));
  await c.testPoll();await c.testPoll();next=snapshot(false);await c.testPoll();
  assert.deepEqual(events,['waiting','playing']);
  events.length=0;next=snapshot(true);await c.testPoll();await c.play();await c.testPoll();
  assert.deepEqual(events,['waiting'],'play while already buffering must not announce playback resumed');
 }finally{globalThis.window=previousWindow;globalThis.requestAnimationFrame=previousFrame;}
});
