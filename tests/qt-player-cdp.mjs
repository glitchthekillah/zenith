// No browser substitute: inspect the WebEngine embedded in the actual helper.
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile), sleep = ms => new Promise(r => setTimeout(r, ms));
const require = createRequire(import.meta.url);
const {createServer: mediaServer} = require('./media-range-server.cjs');
const [application, assets] = process.argv.slice(2);
const wayland=process.env.ZENITH_QT_WAYLAND==='1';
assert(application && assets, 'Usage: node qt-player-cdp.mjs HELPER ASSETS');
assert(['1', 'true'].includes(process.env.CI), 'CDP is restricted to CI');
assert.equal(process.env.QTWEBENGINE_REMOTE_DEBUGGING, '127.0.0.1:9223');
if(wayland){assert(process.env.WAYLAND_DISPLAY,'Wayland compositor required');assert.equal(process.env.QT_QPA_PLATFORM,'wayland');assert.equal(process.env.ZENITH_QT_DIAGNOSTICS,'1');}
assert.equal(typeof WebSocket, 'function', 'Node 22+ required');
const artifacts = path.resolve(process.env.ZENITH_QT_ARTIFACTS || '/tmp/zenith-qt-player');
await mkdir(artifacts, {recursive:true});
const log = (name, detail = '') => console.log(`PASS ${name}`, detail);
const requests = [], failures = [], events = [];
const sources = Object.fromEntries(['blue','moving','pgs'].map(id => [id, {
  Id:id, Container:'mkv', SupportsDirectPlay:true, SupportsDirectStream:false,
  DefaultAudioStreamIndex:1, DefaultSubtitleStreamIndex:id==='pgs'?2:-1,
  MediaStreams:[{Index:0, Type:'Video', Codec:'h264', Width:id==='moving'?1280:640, Height:id==='moving'?720:360},
    {Index:1, Type:'Audio', Codec:'ac3', Language:'eng', IsDefault:true, Channels:6},
    ...(id==='pgs'?[{Index:2, Type:'Subtitle', Codec:'pgssub', Language:'eng', IsDefault:true, IsTextSubtitleStream:false}]:[])],
}]));
let active = 'blue';
const item = id => ({Id:'fixture', Name:`Qt ${id} original-file fixture`, Type:'Movie', RunTimeTicks:(id==='moving'?30:60)*1e7, MediaSources:[sources[id]], UserData:{}});
const media = mediaServer('/tmp/zenith-media-fixtures');
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/Videos/') && url.pathname.endsWith('/stream')) {
    requests.push({method:req.method, path:url.pathname, range:req.headers.range, static:url.searchParams.get('static')});
    if (url.searchParams.get('static')!=='true') failures.push('Non-static media request');
    const id = url.searchParams.get('MediaSourceId');
    req.url = id==='pgs'?'/delayed.mkv':id==='moving'?'/moving.mkv':'/video.mkv';
    media.emit('request', req, res); return;
  }
  if (/master\.m3u8|Transcod|\/hls\//i.test(req.url)) failures.push('Server conversion requested');
  let body=''; for await (const chunk of req) body+=chunk;
  requests.push({method:req.method,path:url.pathname,body:body?JSON.parse(body):null});
  let result = {Items:[],Valid:false};
  if (url.pathname.includes('/PlaybackInfo')) {
    const profile = JSON.parse(body);
    if (profile.EnableTranscoding!==false || profile.EnableDirectStream!==false || profile.DeviceProfile?.TranscodingProfiles?.length!==0) failures.push('PlaybackInfo permits server conversion');
    result = {MediaSources:[sources[active]],PlaySessionId:'qt-fixture-session'};
  } else if (url.pathname==='/Users/fixture') result={Id:'fixture',Name:'CI fixture',Policy:{EnableMediaPlayback:true}};
  else if (url.pathname==='/System/Info/Public') result={ServerName:'CI Jellyfin fixture',Version:'10.10.7',Id:'qt-fixture'};
  else if (url.pathname==='/Items/fixture' || url.pathname==='/Users/fixture/Items/fixture') result=item(active);
  res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify(result));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url=`http://127.0.0.1:${server.address().port}`;
const group={id:'qt-fixture',name:'Qt fixture',servers:{jellyfin:{url,token:'synthetic-qt-fixture',userId:'fixture'}}};
const bootstrap={settings:{groups:[group],playback:{directPlay:true,volume:1,rate:1,subtitles:'off',autoplayNext:false},app:{discord:false,notify:false}},deviceId:'qt-fixture-device',group,item:item(active),options:{start:0,queue:[]}};
const audioFile=path.join(artifacts,'audio.pcm');
const recorder=spawn('parec',[`--device=${process.env.PULSE_SINK}.monitor`,'--format=s16le','--rate=48000','--channels=2'],{stdio:['ignore','pipe','inherit']});
recorder.stdout.pipe(createWriteStream(audioFile));
const child=spawn(application,['--assets',path.resolve(assets)],{stdio:['pipe','pipe','pipe']});
child.stderr.pipe(createWriteStream(path.join(artifacts,'helper.stderr.log')));
let output=''; child.stdout.on('data',chunk=>{ output+=chunk; let end; while((end=output.indexOf('\n'))>=0){const line=output.slice(0,end);output=output.slice(end+1);try{events.push(JSON.parse(line));}catch{failures.push('Non-JSON helper stdout');}} });
let childError; child.on('error',e=>{childError=e;});
child.stdin.write(JSON.stringify(bootstrap)+'\n');
let socket, serial=0; const pending=new Map();
async function until(check, label, timeout=20000) {
  const end=Date.now()+timeout; let last;
  while(Date.now()<end){
    if(childError) throw childError;
    assert.equal(child.signalCode,null,`Helper terminated by ${child.signalCode} during ${label}`);
    assert.equal(child.exitCode,null,`Helper exited during ${label}: ${child.exitCode}`);
    try { last=await check(); if(last)return last; } catch(e){last=e.message+(e.cause?' '+String(e.cause):'');}
    await sleep(150);
  }
  throw Error(`Timed out: ${label}; last=${JSON.stringify(last)}`);
}
function command(method,params={}) {
  const id=++serial;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},20000);
    pending.set(id,{resolve,reject,timer}); socket.send(JSON.stringify({id,method,params}));
  });
}
async function js(expression) {
  const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  assert(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
  assert(!r.result?.subtype?.includes('error'), r.result?.description);
  return r.result?.value;
}
const state=()=>js(`(()=>{const v=document.querySelector('#player video');return v?{time:v.currentTime,duration:v.duration,width:v.videoWidth,paused:v.paused,ended:v.ended,error:v.error?.message}:null})()`);
const native=(action,args={})=>js(`window.zenithQt.call(${JSON.stringify(action)},${JSON.stringify(args)})`);
async function audioPeak() {
  const bytes=await readFile(audioFile); let peak=0;
  for(let i=Math.max(0,bytes.length-24000);i+1<bytes.length;i+=2)peak=Math.max(peak,Math.abs(bytes.readInt16LE(i)));
  return peak;
}
async function capture(name){
  const file=path.join(artifacts,`${name}.png`);
  if(wayland){
    // grabWindow captures the composed QQuickWindow, including MpvQt movie and
    // WebEngine UI. A WebEngine/CDP page screenshot would omit the movie.
    const frame=await native('diagnostic.capture');
    assert(frame&&typeof frame.png==='string','Missing native Wayland capture');
    const png=Buffer.from(frame.png,'base64');
    assert(png.length>24&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Invalid native capture PNG');
    assert.equal(png.readUInt32BE(16),frame.width);assert.equal(png.readUInt32BE(20),frame.height);
    const viewport=await js('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
    assert.equal(viewport.dpr,1,'Native window coordinate assertions require scale factor 1');
    assert.equal(frame.width,viewport.width,'Qt capture and CDP viewport widths differ');
    assert.equal(frame.height,viewport.height,'Qt capture and CDP viewport heights differ');
    await writeFile(file,png);
  }else await exec('import',['-window','root',file]);
  return file;
}
async function blueFrame(name) {
  const image=await capture(name);
  const point=await js(`(()=>{const r=document.querySelector('#player video').getBoundingClientRect();return [Math.round(${wayland?'0':'screenX'}+r.x+r.width*.55),Math.round(${wayland?'0':'screenY'}+r.y+r.height*.4)]})()`);
  await exec('python3',['-c',`from PIL import Image\nimport json,sys\nr,g,b=Image.open(sys.argv[1]).convert('RGB').getpixel(tuple(json.loads(sys.argv[2])))\nassert b>200 and r<45 and g<45,('Native movie absent after window/seek transition',r,g,b)`,image,JSON.stringify(point)]);
}
async function pointer(point,type='mouseMoved') {await command('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:type==='mouseMoved'?'none':'left',clickCount:type==='mouseMoved'?0:1});}
async function click(selector){const p=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await pointer(p);await pointer(p,'mousePressed');await pointer(p,'mouseReleased');}
async function progress(label, target) {
  const initial=await until(async()=>{const s=await state();return s&&!s.paused&&s.width>0&&(target===undefined||Math.abs(s.time-target)<4)?s:null;},`${label} ready`);
  await until(async()=>{const s=await state();return s&&!s.error&&s.time>initial.time+1.1;},`${label} advances`);
  await until(async()=>await audioPeak()>32, `${label} audible`);
}
async function replace(id) {
  active=id;
  await js(`(async()=>{const p=await import(new URL('js/player.js',document.baseURI));await p.close(true);await p.play(${JSON.stringify(item(id))},{start:0});return true})()`);
  await until(async()=>{const s=await state();return s?.width===(id==='moving'?1280:640)&&s.time>.3;},`${id} replacement metadata`);
}
// Analyze actual root-window pixels (X11) or composed QQuickWindow (Wayland).
// CDP screenshots alone omit the native film.
// Keep reference opaque icon coordinates separately for EACH icon and EACH row
// through its lower quarter; a sliced bottom row cannot hide in an average.
const pixelScript=String.raw`
import json,sys
from PIL import Image
spec=json.loads(sys.argv[1]);ref=Image.open(spec['reference']).convert('RGB');cur=Image.open(spec['actual']).convert('RGB')
ox,oy=spec['offset'];vx,vy=spec['movie'];r,g,b=cur.getpixel((round(ox+vx),round(oy+vy)))
assert b>200 and r<45 and g<45,('movie lost beneath HTML',r,g,b)
for rect in spec['icons']:
 x,y,w,h=rect; rows={};allpoints=[]
 for py in range(y,y+h):
  for px in range(x,x+w):
   if min(ref.getpixel((ox+px,oy+py)))>220:rows.setdefault(py,[]).append((ox+px,oy+py));allpoints.append((ox+px,oy+py))
 assert len(allpoints)>5,('icon reference lacks opaque strokes',rect,len(allpoints))
 for name,points in [('all',allpoints),('bottom',sum([v for k,v in rows.items() if k>=max(rows)-max(1,(max(rows)-min(rows))//4)],[]))]+[(str(k),v) for k,v in rows.items() if len(v)>=3]:
  missing=sum(min(cur.getpixel(p))<160 for p in points)/len(points)
  assert missing<.10,('sliced opaque icon',rect,name,missing)
print('movie blue; all opaque icon rows intact')
`;

try {
  // Refuse to attach to a stale Chromium/other helper debugger.
  const targets=await until(async()=>{const r=await fetch('http://127.0.0.1:9223/json/list');return await r.json();},'Qt CDP endpoint');
  const target=await until(async()=>{const list=await(await fetch('http://127.0.0.1:9223/json/list')).json();return list.find(t=>t.type==='page'&&t.url.includes('qt-player.html'));},'trusted player page');
  assert(target.webSocketDebuggerUrl,JSON.stringify(targets));
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')console.error('Fixture page exception:',JSON.stringify(m.params));if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  await command('Runtime.enable');
  await until(()=>js(`!!window.zenithQt?.controller && !!document.querySelector('#player video')`),'Qt player adapter');
  assert.equal(await js('window.zenithQt.backend'),'qt-mpv');
  const info=await native('bootstrap');
  assert.match(info.qtVersion,/^6\./,'Native bridge must report actual Qt version');
  const maps=await readFile(`/proc/${child.pid}/maps`,'utf8');
  assert.match(maps,/libQt6WebEngineCore/); assert.match(maps,/libMpvQt/i); assert.match(maps,/libmpv\.so/);
  const loaded=await js(`performance.getEntriesByType('resource').map(x=>x.name)`);
  assert(loaded.some(x=>x.includes('/js/player.js')),'Real player.js not loaded');
  assert(loaded.some(x=>x.includes('/js/qt-native-video.js')),'Qt native adapter not loaded');
  assert(!loaded.some(x=>/\/vendor\/native-video|\/tauri-native-video/.test(x)),'GTK native adapter loaded');
  assert(!await js(`document.documentElement.classList.contains('tauri-native-video')`),'GTK aperture class present');
  await until(()=>events.some(e=>e.type==='ready'),'helper ready protocol');
  await progress('original blue film');
  log('actual Qt/MpvQt/libmpv backend and original playback',info.qtVersion);
  await click('[data-p=settings]');
  await until(()=>js(`!!document.querySelector('.pl-menu')`),'real settings pointer click');
  await click('[data-p=settings]');
  await until(()=>js(`!document.querySelector('.pl-menu')`),'settings dismissed');
  await pointer({x:300,y:200});
  await until(()=>js(`Number(getComputedStyle(document.querySelector('.pl-ui')).opacity)>.9`),'controls visible');
  const geometry=await js(`(()=>{const boxes=[...document.querySelectorAll('.pl-row button svg')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>8&&r.height>8);const v=document.querySelector('#player video').getBoundingClientRect();const targets=[...document.querySelectorAll('.pl-row button,.pl-seek')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0).map(r=>({x:r.x+r.width/2,y:r.y+r.height/2}));return{icons:boxes.map(r=>[Math.floor(r.x),Math.floor(r.y),Math.ceil(r.width),Math.ceil(r.height)]),movie:[v.x+v.width*.55,v.y+v.height*.4],targets,offset:[Math.round(window.screenX),Math.round(window.screenY)],dpr:devicePixelRatio}})()`);
  if(wayland)geometry.offset=[0,0];
  assert.equal(geometry.dpr,1,'Pixel assertions require scale factor 1');
  assert(geometry.icons.length>=4,'Missing actual player icons');assert(geometry.targets.length>=5);
  const reference=await capture('controls-reference');
  let moving=true;
  const motion=(async()=>{let step=0;while(moving){await pointer(geometry.targets[step++%geometry.targets.length]);await sleep(12);}})();
  try {
    for(let i=0;i<12;i++){
      const actual=await capture(`hover-${i}`);
      await exec('python3',['-c',pixelScript,JSON.stringify({...geometry,reference,actual})]);
    }
  } finally {moving=false;await motion;}
  log('simultaneous real hover preserves movie and every opaque icon row');
  const before=await js('({w:innerWidth,h:innerHeight})');
  assert.equal((await native('win',{action:'fullscreen',arg:true})).fullscreen,true);
  await progress('fullscreen film');await blueFrame('fullscreen');
  assert.equal((await native('win',{action:'fullscreen',arg:false})).fullscreen,false);
  await native('win',{action:'mini',arg:true});
  await until(()=>js(`innerWidth<${before.w} || innerHeight<${before.h}`),'native mini resize');
  await progress('resized film');await blueFrame('mini');
  await native('win',{action:'mini',arg:false});
  log('fullscreen and native resize keep film advancing');
  await replace('moving');await progress('moving original');
  // A moving fixture proves new pictures, rather than only a ticking clock.
  const a=await capture('moving-before');await sleep(800);const b=await capture('moving-after');
  const center=await js(`(()=>{const r=document.querySelector('#player video').getBoundingClientRect();return [Math.round(${wayland?'0':'screenX'}+r.x+r.width*.3),Math.round(${wayland?'0':'screenY'}+r.y+r.height*.3),Math.round(r.width*.4),Math.round(r.height*.3)]})()`);
  await exec('python3',['-c',`from PIL import Image,ImageChops,ImageStat\nimport json,sys\nx,y,w,h=json.loads(sys.argv[3]);box=(x,y,x+w,y+h)\na=Image.open(sys.argv[1]).convert('RGB').crop(box);b=Image.open(sys.argv[2]).convert('RGB').crop(box)\nassert max(ImageStat.Stat(ImageChops.difference(a,b)).mean)>3,'Moving movie presents stale pixels'`,a,b,JSON.stringify(center)]);
  for(const target of [18,4,23,9]){
    await js(`window.zenithQt.controller.seek(${target})`);await progress(`moving seek ${target}`,target);
    const first=await capture(`seek-${target}-before`);await sleep(600);const second=await capture(`seek-${target}-after`);
    await exec('python3',['-c',`from PIL import Image,ImageChops,ImageStat\nimport json,sys\nx,y,w,h=json.loads(sys.argv[3]);box=(x,y,x+w,y+h)\na=Image.open(sys.argv[1]).convert('RGB').crop(box);b=Image.open(sys.argv[2]).convert('RGB').crop(box)\nassert max(ImageStat.Stat(ImageChops.difference(a,b)).mean)>3,'Seek clock advances but movie pixels are frozen'`,first,second,JSON.stringify(center)]);
  }
  log('backward/forward seeks resume actual moving pictures and audio');
  await replace('pgs');
  await until(()=>js(`window.zenithQt.controller.tracks.some(t=>t.kind==='subtitle')`),'sparse PGS track');
  await js(`(async()=>{const c=window.zenithQt.controller,t=c.tracks.find(t=>t.kind==='subtitle');await c.selectTrack('subtitle',t.id);return true})()`);
  let pgsStep=0;
  for(const target of [30,5,27,30,4]){await js(`window.zenithQt.controller.seek(${target})`);await progress(`sparse PGS seek ${target}`,target);await blueFrame(`pgs-${pgsStep++}-${target}`);}
  await js(`window.zenithQt.controller.selectTrack('subtitle',null)`);
  await progress('PGS disabled');
  log('real sparse PGS toggles and repeated seeks do not stall');
  assert(requests.some(r=>r.range),'libmpv did not exercise HTTP byte ranges');
  assert(requests.some(r=>r.path.includes('/PlaybackInfo')),'Player bypassed Jellyfin negotiation');
  assert.deepEqual(failures,[]);
  assert(!events.some(e=>e.type==='error'),'Helper emitted protocol error');
  child.stdin.write('{"type":"close"}\n');
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Helper did not close')),10000);child.once('close',(code)=>{clearTimeout(timer);code===0?resolve():reject(Error(`Close exited ${code}`));});});
  assert(events.some(e=>e.type==='closed'),'Missing closed protocol event');
  const stderr=await readFile(path.join(artifacts,'helper.stderr.log'),'utf8');
  assert(!stderr.includes(group.servers.jellyfin.token),'Helper stderr leaked server credentials');
  assert(!JSON.stringify(events).includes(group.servers.jellyfin.token),'Helper stdout leaked server credentials');
  log('strict original files and clean helper close');
} catch(error) {
  const probes=[['sockets','ss',['-ltnp']],['debug-http','curl',['--max-time','3','-v','http://127.0.0.1:9223/json/list']],['threads','sudo',['-n','gdb','-batch','-ex','set pagination off','-ex','thread apply all bt','-p',String(child.pid)]]];
  for(const [name,program,args] of probes){
    try {const result=await exec(program,args,{timeout:15000,maxBuffer:2*1024*1024});await writeFile(path.join(artifacts,name+'.txt'),result.stdout+'\n'+result.stderr);}
    catch(probe){await writeFile(path.join(artifacts,name+'.txt'),String(probe.stdout||'')+'\n'+String(probe.stderr||probe.message));}
  }
  if(!wayland){try{await exec('import',['-window','root',path.join(artifacts,'failed-root.png')]);}catch{}}
  throw error;
} finally {
  socket?.close(); for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Test closing'));} pending.clear();
  if(child.exitCode===null)child.kill('SIGKILL');
  recorder.kill('SIGTERM');server.closeAllConnections();server.close();
  await writeFile(path.join(artifacts,'requests.json'),JSON.stringify(requests,null,2));
  await writeFile(path.join(artifacts,'events.json'),JSON.stringify(events,null,2));
}
