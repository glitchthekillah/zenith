const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('native audio worklet emits bounded stereo PCM with clipping and silence output',()=>{
 const packets=[],c={AudioWorkletProcessor:class{constructor(){this.port={postMessage:p=>packets.push(p)}}},registerProcessor:(n,p)=>c.Processor=p};vm.createContext(c);vm.runInContext(fs.readFileSync('app/js/native-audio-worklet.js','utf8'),c);const p=new c.Processor();
 for(let i=0;i<8;i++){const output=new Float32Array(128).fill(1);p.process([[new Float32Array(128).fill(2),new Float32Array(128).fill(-2)]],[[output,new Float32Array(128)]]);assert(output.every(x=>x===0));}
 assert.equal(packets.length,1);assert.equal(packets[0].samples.length,2048);assert.equal(packets[0].samples[0],32767);assert.equal(packets[0].samples[1],-32768);
});
test('native audio keeps user mute separate, restores WebView sound on failure, and closes its output',async()=>{
 const listeners={},calls=[];let node,opened=false,closed=false;
 const video={volume:.5,muted:false,paused:false,captureStream:()=>({getAudioTracks:()=>[{}]}),addEventListener:(n,f)=>listeners[n]=f,removeEventListener(){}};
 class Context{constructor(){this.state='running';this.sampleRate=48000;this.audioWorklet={addModule:async()=>{}};this.destination={};}createMediaStreamSource(){return {connect(){},disconnect(){}}}createGain(){return {gain:{value:1},connect(){},disconnect(){}}}async resume(){}async close(){this.state='closed'}}
 class Node{constructor(){node=this;this.port={}}connect(){}disconnect(){}}
 const bridge={info:async()=>({platform:'win32'}),audioOpen:async()=>{opened=true;return 4},audioWrite:async()=>{calls.push('write');return calls.length===1},audioFlush:async()=>{},audioClose:async()=>{closed=true}};
 const c={AudioContext:Context,AudioWorkletNode:Node,URL,Map,WeakMap,console};vm.createContext(c);let src=fs.readFileSync('app/js/native-audio.js','utf8').replace(/^export /gm,'').replace(/import\.meta\.url/g,"'http://test/js/native-audio.js'");vm.runInContext(src+'\nglobalThis.api={attachNativeAudio,audioMuted,setAudioMuted};',c);
 const controller=c.api.attachNativeAudio(video,bridge,true);await listeners.playing();assert(opened);assert.equal(video.muted,false,'browser muted before a native packet was accepted');
 await node.port.onmessage({data:{generation:0,samples:new Int16Array(2048)}});assert.equal(video.muted,true);assert.equal(c.api.audioMuted(video),false);
 c.api.setAudioMuted(video,true);assert.equal(c.api.audioMuted(video),true);c.api.setAudioMuted(video,false);
 await node.port.onmessage({data:{generation:0,samples:new Int16Array(2048)}});assert.equal(video.muted,false,'sound was not restored when native output failed');assert(closed);controller.stop();
});

test('an old delayed native startup cannot unmute or detach a newer controller on the same video',async()=>{
 const handlers={};let node,resolveOld,opens=0,moduleLoads=0;
 const video={volume:1,muted:false,paused:false,captureStream:()=>({getAudioTracks:()=>[{}]}),addEventListener:(n,f)=>handlers[n]=f,removeEventListener(n,f){if(handlers[n]===f)delete handlers[n]}};
 class Context{constructor(){this.state='running';this.sampleRate=48000;this.audioWorklet={addModule:()=>++moduleLoads===1?new Promise(r=>resolveOld=r):Promise.resolve()};this.destination={};}createMediaStreamSource(){return{connect(){},disconnect(){}}}createGain(){return{gain:{value:1},connect(){},disconnect(){}}}async resume(){}async close(){this.state='closed'}}
 class Node{constructor(){node=this;this.port={}}connect(){}disconnect(){}}
 const bridge={info:async()=>({platform:'win32'}),audioOpen:()=>Promise.resolve(++opens),audioWrite:async()=>true,audioFlush:async()=>{},audioClose:async()=>{}};
 const c={AudioContext:Context,AudioWorkletNode:Node,URL,Map,WeakMap};vm.createContext(c);vm.runInContext(fs.readFileSync('app/js/native-audio.js','utf8').replace(/^export /gm,'').replace(/import\.meta\.url/g,"'http://test/js/native-audio.js'")+'\nglobalThis.api={attachNativeAudio,audioMuted,setAudioMuted};',c);
 const old=c.api.attachNativeAudio(video,bridge,true);const pending=handlers.playing();while(!resolveOld)await Promise.resolve();old.stop();const current=c.api.attachNativeAudio(video,bridge,true);await handlers.playing();await node.port.onmessage({data:{generation:0,samples:new Int16Array(2048)}});c.api.setAudioMuted(video,true);resolveOld(1);await pending;assert.equal(video.muted,true,'old controller unmuted newer audio');assert.equal(c.api.audioMuted(video),true,'old controller erased newer logical mute');c.api.setAudioMuted(video,false);assert.equal(video.muted,true,'unmuting exposed duplicate WebView audio');current.stop();
});

test('worklet discards the partial old generation on a seek',()=>{
 const packets=[],c={AudioWorkletProcessor:class{constructor(){this.port={postMessage:p=>packets.push(p)}}},registerProcessor:(n,p)=>c.Processor=p};vm.createContext(c);vm.runInContext(fs.readFileSync('app/js/native-audio-worklet.js','utf8'),c);const p=new c.Processor();
 for(let i=0;i<4;i++)p.process([[new Float32Array(128).fill(.9)]],[[]]);
 assert.equal(typeof p.port.onmessage,'function','worklet cannot reset partial packets');p.port.onmessage({data:{generation:1}});
 for(let i=0;i<4;i++)p.process([[new Float32Array(128).fill(.25)]],[[]]);assert.equal(packets.length,0,'pre-seek samples survived reset');
 for(let i=0;i<4;i++)p.process([[new Float32Array(128).fill(.25)]],[[]]);assert.equal(packets[0].generation,1);assert(packets[0].samples.every(x=>x===8192));
});
