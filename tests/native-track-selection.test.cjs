const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');
const snapshot=()=>({tracks:[{id:'a',index:1,kind:'audio',selected:true},{id:'b',index:2,kind:'audio',selected:false},{id:'s',index:3,kind:'subtitle',selected:true}],playing:true,currentTimeSeconds:30});
async function controller(invoke){
 const file=path.resolve('third-party/air-native-video/guest-js/index.ts');
 const source=fs.readFileSync(file,'utf8').replace('class NativeSurfaceVideoController extends EventTarget implements BackendVideoController {','export class NativeSurfaceVideoController extends EventTarget implements BackendVideoController { testSnapshot(value){this.#snapshot=value}');
 const compiled=await build({stdin:{contents:source,resolveDir:path.dirname(file),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 globalThis.window={__TAURI_INTERNALS__:{invoke}};
 const {NativeSurfaceVideoController}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 const video=Object.assign(new EventTarget(),{volume:1,muted:false,style:{objectFit:'contain',transform:'none',transformOrigin:'center'}});
 const result=new NativeSurfaceVideoController(video,{source:'https://media.test/original',autoplay:true});
 result.testSnapshot(snapshot());
 return result;
}
test('reselecting an already active audio or subtitle track sends no native stream switch',async()=>{
 const previous=globalThis.window,calls=[];
 try{const c=await controller(async(_command,payload)=>{calls.push(payload);return snapshot()});await c.selectTrack('audio','a');await c.selectTrack('subtitle','s');assert.deepEqual(calls,[]);}finally{globalThis.window=previous;}
});
test('an in-flight selection must not swallow a request to restore the previous track',async()=>{
 const previous=globalThis.window,calls=[];let finish;
 try{
  const c=await controller(async(_command,payload)=>{calls.push(payload.payload.index);if(calls.length===1)await new Promise(r=>finish=r);return snapshot()});
  const first=c.selectTrack('audio','b');const second=c.selectTrack('audio','a');assert.deepEqual(calls,[2,1]);finish();await Promise.all([first,second]);
 }finally{globalThis.window=previous;}
});
