const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{build}=require('esbuild');

test('native aperture ignores unchanged ancestor attributes but still reacts to real styling changes',async()=>{
 const file=path.resolve('third-party/air-native-video/guest-js/native-surface-compositor.ts');
 const compiled=await build({stdin:{contents:fs.readFileSync(file,'utf8')+'\nexport {nativeCoordinateMutation as ignoredMutation};',resolveDir:path.dirname(file),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const previousDocument=globalThis.document,previousElement=globalThis.Element;
 class Element {constructor(attributes={}){this.attributes=attributes}getAttribute(name){return this.attributes[name]??null}}
 try{
  globalThis.Element=Element;const root=new Element();globalThis.document={documentElement:root};
  const {ignoredMutation}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const player=new Element({class:'player',style:'color:white'});
  assert.equal(ignoredMutation({target:player,attributeName:'class',oldValue:'player'}),true,'No-op class updates must not rebuild masks');
  assert.equal(ignoredMutation({target:player,attributeName:'style',oldValue:'color:white'}),true);
  assert.equal(ignoredMutation({target:player,attributeName:'class',oldValue:'player idle'}),false,'Real visibility changes remain observable');
  assert.equal(ignoredMutation({target:player,attributeName:'style',oldValue:'color:black'}),false);
  root.attributes.style='color:white;--tauri-native-video-left:10px';
  assert.equal(ignoredMutation({target:root,attributeName:'style',oldValue:'color:white;--tauri-native-video-left:5px'}),true);
  assert.equal(ignoredMutation({target:root,attributeName:'style',oldValue:'color:black;--tauri-native-video-left:5px'}),false);
 }finally{globalThis.document=previousDocument;globalThis.Element=previousElement;}
});
