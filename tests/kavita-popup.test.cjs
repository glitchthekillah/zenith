const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs'),vm=require('vm');
const root=require('path').join(__dirname,'..');
const main=fs.readFileSync(root+'/electron/main.js','utf8');
const block=main.slice(main.indexOf("  ipcMain.handle('web-login'"),main.indexOf("  ipcMain.handle('confirm'"));
test('cookie handoff verifies app session before closing the popup and resolving login',async()=>{
 let handler,w,events=[],verify;const verified=new Promise(r=>verify=r);
 class Window{constructor(){w=this;this.closed=false;this.listeners={};this.webContents={getURL:()=> 'https://kavita.test/home',executeJavaScript:async()=>({cookie:true,username:'glitch',apiKey:'image-test'}),session:{cookies:{get:async()=>[{name:'auth',value:'test-cookie'}]}},on:(name,fn)=>this.listeners[name]=fn,setWindowOpenHandler:()=>{}}}isDestroyed(){return this.closed}close(){events.push('close');this.closed=true;this.listeners.closed?.()}on(name,fn){this.listeners[name]=fn}loadURL(){}}
 const context={WINDOW_ICON:"test-icon.ico",URL,BrowserWindow:Window,win:{},probeScript:'test-probe',ipcMain:{handle:(_,fn)=>handler=fn},setInterval:()=>1,clearInterval:()=>{},http:{importCookies:(session,origin,cookies)=>{assert.equal(origin,'https://kavita.test');assert.equal(session,'desktop');assert.equal(cookies[0].name,'auth');events.push('import')},request:async()=>{events.push('verify');await verified;return {ok:true,body:JSON.stringify({username:'glitch'})}}}};
 vm.runInNewContext(block,context);const login=handler({},'https://kavita.test');const check=w.listeners['did-finish-load']();await new Promise(setImmediate);assert.equal(w.closed,false);verify();await check;assert.equal((await login).username,'glitch');assert.deepEqual(events,['import','verify','close']);
});




test('Jellyfin redirect is ignored until the popup returns to authenticated Kavita',async()=>{
 let handler,w,current='https://zenithkavita.glitchthekillah.com/login',signedIn=false,probes=0,imports=0;
 class Window{constructor(){w=this;this.closed=false;this.listeners={};this.webContents={getURL:()=>current,executeJavaScript:async()=>{probes++;return signedIn?{cookie:true,username:'glitch',apiKey:'image-test'}:null},session:{cookies:{get:async()=>[{name:'auth',value:'test-cookie'}]}},on:(n,f)=>this.listeners[n]=f,setWindowOpenHandler:()=>{}}}isDestroyed(){return this.closed}close(){this.closed=true;this.listeners.closed?.()}on(n,f){this.listeners[n]=f}loadURL(){}}
 const c={WINDOW_ICON:'test.ico',URL,BrowserWindow:Window,win:{},probeScript:'test',ipcMain:{handle:(_,f)=>handler=f},setInterval:()=>1,clearInterval(){},http:{importCookies(){imports++},request:async()=>({ok:true,body:JSON.stringify({username:'glitch'})})}};
 vm.runInNewContext(block,c);const login=handler({},'https://zenithkavita.glitchthekillah.com');await w.listeners['did-finish-load']();assert.equal(w.closed,false);assert.equal(probes,1);
 current='https://zenithshelfarr.glitchthekillah.com/interaction/test';signedIn=true;await w.listeners['did-finish-load']();assert.equal(probes,1);assert.equal(imports,0);assert.equal(w.closed,false);
 current='https://zenithkavita.glitchthekillah.com/home';await w.listeners['did-finish-load']();assert.equal((await login).username,'glitch');assert.equal(imports,1);assert.equal(w.closed,true);
});
