const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('node:vm'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../app/js/desktop.js'),'utf8');
function load({migrate,stored}={}){
 const calls=[],handlers=[],store=new Map(stored||[]),docListeners={};let dragged=0;
 const T={core:{invoke:async(cmd,args)=>{calls.push([cmd,args]);return {ok:true}}},event:{listen:(n,fn)=>handlers.push([n,fn])},window:{getCurrentWindow:()=>({startDragging:async()=>{dragged++}})}};
 const body={classList:{contains:c=>c==='mini'&&!!load.mini}};
 const c={window:{__TAURI__:T,__zenithMigrate:migrate},localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v)},document:{body,addEventListener:(n,fn)=>docListeners[n]=fn}};
 vm.runInNewContext(src,c);
 return {d:c.window.zenithDesktop,calls,handlers,store,docListeners,dragged:()=>dragged};
}
test('browser without Tauri gets no bridge',()=>{const c={window:{}};vm.runInNewContext(src,c);assert.equal(c.window.zenithDesktop,undefined)});
test('calls map to Rust commands with named arguments',async()=>{const {d,calls}=load();
 await d.http('https://a.test',{method:'POST'});await d.win('mini',true);await d.win('state');await d.discord(null);await d.notify('t');await d.download({id:'1',url:'u'});await d.webLogin('https://k.test');
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['http',{url:'https://a.test',opts:{method:'POST'}}],['win',{action:'mini',arg:true}],['win',{action:'state',arg:null}],['discord_set',{activity:null}],['notify_cmd',{title:'t',body:null}],['download',{job:{id:'1',url:'u'}}],['web_login',{url:'https://k.test'}]])});
test('events reach listeners as (channel, data)',()=>{const {d,handlers}=load();const got=[];d.on((ch,x)=>got.push([ch,x]));assert.equal(handlers[0][0],'zenith');handlers[0][1]({payload:{channel:'window',data:{mini:true}}});assert.deepEqual(got,[['window',{mini:true}]])});
test('old Electron settings are copied once and never over new ones',()=>{
 const a=load({migrate:{zenith:'{"x":1}','zenith-device':'abc'}});assert.equal(a.store.get('zenith'),'{"x":1}');assert.equal(a.store.get('zenith-device'),'abc');assert.ok(a.calls.some(c=>c[0]==='migrated'));
 const b=load({migrate:{zenith:'old'},stored:[['zenith','new']]});assert.equal(b.store.get('zenith'),'new');assert.ok(b.calls.some(c=>c[0]==='migrated'))});
test('title bar drags after the mouse moves, its buttons do not',()=>{const {docListeners,dragged}=load();const el=(sel)=>({closest:s=>s.split(',').map(x=>x.trim()).includes(sel)?{}:null});
 const go=(target,detail=1,dx=10)=>{docListeners.mousedown({button:0,detail,target,screenX:0,screenY:0});docListeners.mousemove({buttons:1,screenX:dx,screenY:0});docListeners.mouseup({})};
 go(el('#titlebar'),1,2);assert.equal(dragged(),0);
 go(el('#titlebar'));assert.equal(dragged(),1);
 go(el('.tb-buttons'));go(el('#titlebar'),2);assert.equal(dragged(),1)});
