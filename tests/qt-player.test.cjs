const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function load(name,exports){const context={EventTarget,Event,DOMException,AbortController,URL,setTimeout,clearTimeout,console};vm.createContext(context);vm.runInContext(fs.readFileSync(`app/js/${name}.js`,'utf8').replace(/^export /gm,'')+`\nglobalThis.subject={${exports}};`,context);return context.subject;}
function transport(){const listeners=new Set(),calls=[];return {calls,call:async(action,args)=>{calls.push({action,args});return action==='media.open'?{generation:7}:{};},on(fn){listeners.add(fn);return()=>listeners.delete(fn)},send(data){for(const fn of listeners)fn('media',data)}};}
function video(){return Object.assign(new EventTarget(),{currentTime:0,volume:.7,muted:false,playbackRate:1,play(){},pause(){},load(){}});}
test('Qt adapter mirrors decoded snapshots and ignores obsolete generations',async()=>{
 const qt=transport(),v=video();let metadata=0,ended=0;v.addEventListener('loadedmetadata',()=>metadata++);v.addEventListener('ended',()=>ended++);
 const c=await load('qt-native-video','openQtNativeVideo').openQtNativeVideo(v,{url:'https://media.test/original'},qt);
 qt.send({generation:6,currentTime:99,width:100,height:100});assert.equal(v.currentTime,0);
 qt.send({generation:7,currentTime:2,duration:100,width:640,height:360,paused:false,buffering:false,tracks:[{kind:'audio',id:2}]});
 assert.equal(v.currentTime,2);assert.equal(v.videoWidth,640);assert.equal(v.readyState,4);assert.equal(v.paused,false);assert.equal(metadata,1);assert.equal(c.tracks[0].id,2);
 qt.send({generation:7,currentTime:100,ended:true});qt.send({generation:7,currentTime:100,ended:true});assert.equal(ended,1);await c.destroy();
});
test('seek intent is sent without fabricating playback progress and properties restore on destroy',async()=>{
 const qt=transport(),v=video(),oldPlay=v.play;
 const c=await load('qt-native-video','openQtNativeVideo').openQtNativeVideo(v,{url:'https://media.test/original'},qt);
 qt.send({generation:7,currentTime:3});v.currentTime=60;assert.equal(v.currentTime,3);assert.equal(qt.calls.at(-1).args.position,60);
 v.volume=.2;v.muted=true;v.playbackRate=1.5;await v.play();v.pause();await c.selectTrack('subtitle',undefined);
 assert.equal(qt.calls.find(c=>c.action==='media.rate').args.value,1.5);assert.equal(qt.calls.at(-1).args.kind,'subtitle');
 await c.destroy();assert.equal(v.play,oldPlay);assert.equal(v.volume,.7);assert.equal(Object.hasOwn(v,'videoWidth'),false);
});
test('seeking waits for an actual target snapshot and ignores old progress after a seek request',async()=>{
 const qt=transport(),v=video();let seeked=0;v.addEventListener('seeked',()=>seeked++);
 const c=await load('qt-native-video','openQtNativeVideo').openQtNativeVideo(v,{url:'https://media.test/original'},qt);
 qt.send({generation:7,currentTime:3,duration:100});await c.seek(60);
 qt.send({generation:7,currentTime:3,duration:100});qt.send({generation:7,currentTime:3.1,duration:100});
 assert.equal(v.currentTime,3.1);assert.equal(v.seeking,true);assert.equal(seeked,0);
 qt.send({generation:7,currentTime:60.2,duration:100});assert.equal(v.currentTime,60.2);assert.equal(v.seeking,false);assert.equal(seeked,1);
 await c.seek(15);qt.send({generation:7,currentTime:60.2,seeking:true});assert.equal(seeked,1);
 qt.send({generation:7,currentTime:14,seeking:false});assert.equal(v.currentTime,14);assert.equal(v.seeking,false);assert.equal(seeked,2);
 await c.destroy();
});
test('cancelling an unresolved open stops its generation and never leaves an adapter attached',async()=>{
 const qt=transport(),v=video(),abort=new AbortController();let release;const original=qt.call;qt.call=(action,args)=>action==='media.open'?new Promise(r=>release=r):original(action,args);
 const pending=load('qt-native-video','openQtNativeVideo').openQtNativeVideo(v,{url:'https://media.test/original',signal:abort.signal},qt);abort.abort();release({generation:7});
 await assert.rejects(pending,{name:'AbortError'});assert.equal(qt.calls.at(-1).action,'media.stop');assert.equal(qt.calls.at(-1).args.generation,7);assert.equal(Object.hasOwn(v,'videoWidth'),false);
});
test('native failures notify controller and element with a credential-free error',async()=>{
 const qt=transport(),v=video();const c=await load('qt-native-video','openQtNativeVideo').openQtNativeVideo(v,{url:'https://media.test/original'},qt);let failure,events=0;
 c.on('error',e=>failure=e);v.addEventListener('error',()=>events++);qt.send({generation:7,error:'https://private.test?token=secret'});
 assert.equal(events,1);assert.equal(failure.detail.message,'Original-file playback failed.');assert.equal(v.error.message,failure.detail.message);await c.destroy();
});
test('an early snapshot is replayed after open and replacement rejects a late source',async()=>{
 const qt=transport(),v=video();let release;const call=qt.call;qt.call=(action,args)=>action==='media.open'?new Promise(r=>release=r):call(action,args);
 const open=load('qt-native-video','openQtNativeVideo').openQtNativeVideo;
 const first=open(v,{url:'https://media.test/first'},qt);const firstRelease=release;
 const second=open(v,{url:'https://media.test/second'},qt);await Promise.resolve();await Promise.resolve();
 qt.send({generation:8,width:1280,height:720,currentTime:12,paused:false});release({generation:8});const c=await second;
 firstRelease({generation:7});await assert.rejects(first,{name:'AbortError'});assert.equal(v.currentTime,12);assert.equal(qt.controller,c);
 qt.send({generation:7,width:640,currentTime:90});assert.equal(v.currentTime,12);await c.destroy();
});
test('pre-cancelled and non-network sources do not allocate a media session',async()=>{
 const qt=transport(),v=video(),abort=new AbortController();abort.abort();const open=load('qt-native-video','openQtNativeVideo').openQtNativeVideo;
 await assert.rejects(open(v,{url:'https://media.test/a',signal:abort.signal},qt),{name:'AbortError'});
 await assert.rejects(open(v,{url:'file:///private'},qt),/HTTP/);assert.equal(qt.calls.length,0);
});
test('handoff cancellation closes a late owned id and cannot cancel a replacement',async()=>{
 let listener,release;const closed=[];const desktop={on(fn){listener=fn;return()=>{}},qtPlay:()=>new Promise(r=>release=r),qtClose:async id=>closed.push(id)};
 const h=load('qt-handoff','createQtHandoff').createQtHandoff(desktop);const first=h.play({item:{Id:'a'}});const firstRelease=release;
 const second=h.play({item:{Id:'b'}});firstRelease({id:'a'});await assert.rejects(first,{name:'AbortError'});release({id:'b'});await second;
 listener('qt-player-closed',{id:'a'});assert.equal(h.isOpen(),true);assert.deepEqual(closed,['a']);await h.close();assert.deepEqual(closed,['a','b']);
});
test('handoff handles close events that beat the qtPlay response',async()=>{
 let listener,release,notification;const h=load('qt-handoff','createQtHandoff').createQtHandoff({on(fn){listener=fn;return()=>{}},qtPlay:()=>new Promise(r=>release=r),qtClose:async()=>{}},{onClosed:data=>notification=data});
 const pending=h.play({});listener('qt-player-closed',{id:'early',error:'Playback helper stopped.'});release({id:'early'});
 await assert.rejects(pending,/Playback helper stopped/);assert.equal(h.isOpen(),false);assert.equal(notification.id,'early');
});
test('an abort closes its owned session and removes its event subscription on disposal',async()=>{
 let listener,unsubscribed=0;const closed=[],abort=new AbortController();
 const h=load('qt-handoff','createQtHandoff').createQtHandoff({on(fn){listener=fn;return()=>unsubscribed++},qtPlay:async()=>({id:'owned'}),qtClose:async id=>closed.push(id)});
 await h.play({},{signal:abort.signal});abort.abort();await Promise.resolve();assert.equal(h.isOpen(),false);assert.deepEqual(closed,['owned']);
 listener('qt-player-closed',{id:'owned'});await h.destroy();assert.equal(unsubscribed,1);await assert.rejects(h.play({}),{name:'AbortError'});
});
test('cancellation while a predecessor closes never allocates the cancelled replacement',async()=>{
 let release,count=0;const abort=new AbortController();
 const h=load('qt-handoff','createQtHandoff').createQtHandoff({on(){return()=>{}},qtPlay:async()=>({id:String(++count)}),qtClose:id=>id==='1'?new Promise(r=>release=r):Promise.resolve()});
 await h.play({});const pending=h.play({},{signal:abort.signal});abort.abort();release();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(count,1);assert.equal(h.isOpen(),false);
});
test('bootstrap stores only the active group before core imports and bridge correlates replies',async()=>{
 const {seedQtBootstrap,createQtBridge}=load('qt-player','seedQtBootstrap,createQtBridge'),values=new Map();
 seedQtBootstrap({item:{Id:'movie'},group:{id:'g2',servers:{jellyfin:{token:'active'}}},settings:{groups:[{id:'private'}],servers:{token:'private'},playback:{rate:1.5}},deviceId:'stable'},{setItem:(k,v)=>values.set(k,v)});
 assert.equal(values.get('zenith-device'),'stable');const saved=JSON.parse(values.get('zenith'));assert.deepEqual(saved.groups.map(g=>g.id),['g2']);assert.equal(saved.servers,undefined);
 let complete,event,request;const bridge=createQtBridge({completed:{connect(fn){complete=fn}},event:{connect(fn){event=fn}},request(...args){request=args}});
 let received;bridge.on((ch,data)=>received=[ch,data]);const reply=bridge.call('bootstrap');complete('wrong',{ok:true,data:1});complete(request[0],{ok:true,data:{item:2}});assert.equal((await reply).item,2);event('media-key',{data:'toggle'});assert.equal(received[0],'media-key');
});
test('Qt startup waits for bootstrap before loading shared state and closes through the existing player',async()=>{
 const {startQtPlayer}=load('qt-player','startQtPlayer'),values=new Map(),calls=[],exitArgs=[];let complete,events,request,coreListener,played,closed=0;
 const bridge={completed:{connect(fn){complete=fn}},event:{connect(fn){events=fn}},request(id,action,args){calls.push(action);if(action==='exit')exitArgs.push(args);if(action==='bootstrap')request=id;else complete(id,{ok:true,data:{}})}};
 const doc=Object.assign(new EventTarget(),{hasFocus:()=>true,body:{classList:{contains:()=>false}}});
 const scope={qt:{webChannelTransport:{}},QWebChannel:function(t,ready){ready({objects:{bridge}})},localStorage:{setItem:(k,v)=>values.set(k,v)},document:doc};
 const promise=startQtPlayer(scope,async path=>{
   assert.equal(values.get('zenith-device'),'device');assert.equal(scope.zenithDesktop.qtPlayer,true);
   return path==='./core.js'?{settings:{playback:{volume:.42,rate:1.25,subtitleSize:130}},groups:{use(id){assert.equal(id,'active')}},on(name,fn){coreListener=fn}}:{play:async(item,options)=>{played={item,options}},close:async()=>{closed++;coreListener({open:false})}};
 });
 await Promise.resolve();assert.equal(played,undefined);complete(request,{ok:true,data:{deviceId:'device',group:{id:'active'},settings:{},item:{Id:'movie'},options:{start:12},selection:{sub:'off'},qtVersion:'6.8.3'}});
 await promise;assert.equal(played.item.Id,'movie');assert.equal(played.options.start,12);assert.equal(played.options.selection.sub,'off');assert.equal(scope.zenithQt.qtVersion,'6.8.3');
 let key;scope.zenithDesktop.on((ch,data)=>{if(ch==='media-key')key=data});events('media-key',{key:'MediaPlayPause'});assert.equal(key,'toggle');
 events('close-request',{});await Promise.resolve();assert.equal(closed,1);assert.ok(calls.includes('exit'));assert.equal(exitArgs[0]?.playback?.volume,.42);assert.equal(exitArgs[0]?.playback?.subtitleSize,130);
});
test('mini dragging starts only after movement outside interactive player controls',()=>{
 const {bindQtWindowDrag}=load('qt-player','bindQtWindowDrag'),calls=[],doc=Object.assign(new EventTarget(),{body:{classList:{contains:()=>true}}});
 bindQtWindowDrag(doc,{call:async(...args)=>calls.push(args)});
 const target={closest:selector=>selector==='#player'?{}:null};
 function send(type,props){const event=new Event(type);Object.assign(event,props);Object.defineProperty(event,'target',{value:target});doc.dispatchEvent(event)}
 send('mousedown',{button:0,detail:1,screenX:10,screenY:10});send('mousemove',{buttons:1,screenX:11,screenY:10});assert.equal(calls.length,0);
 send('mousemove',{buttons:1,screenX:16,screenY:10});assert.equal(calls[0][0],'win');assert.equal(calls[0][1].action,'drag');
 target.closest=selector=>selector==='#player'||selector.includes('button')?{}:null;
 send('mousedown',{button:0,detail:1,screenX:10,screenY:10});send('mousemove',{buttons:1,screenX:20,screenY:10});assert.equal(calls.length,1);
});
