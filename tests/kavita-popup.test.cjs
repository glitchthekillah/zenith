const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs'),vm=require('vm');
const root=require('path').join(__dirname,'..');
const main=fs.readFileSync(root+'/electron/main.js','utf8');
const block=main.slice(main.indexOf("  ipcMain.handle('web-login'"),main.indexOf("  ipcMain.handle('confirm'"));
test('cookie handoff verifies app session before closing the popup and resolving login',async()=>{
 let handler,w,events=[],verify;const verified=new Promise(r=>verify=r);
 class Window{constructor(){w=this;this.closed=false;this.listeners={};this.webContents={getURL:()=> 'https://kavita.test/home',executeJavaScript:async()=>({cookie:true,username:'glitch',apiKey:'image-test'}),session:{cookies:{get:async()=>[{name:'auth',value:'test-cookie'}]}},on:(name,fn)=>this.listeners[name]=fn,setWindowOpenHandler:()=>{}}}isDestroyed(){return this.closed}close(){events.push('close');this.closed=true;this.listeners.closed?.()}on(name,fn){this.listeners[name]=fn}loadURL(){}}
 const context={URL,BrowserWindow:Window,win:{},probeScript:'test-probe',ipcMain:{handle:(_,fn)=>handler=fn},setInterval:()=>1,clearInterval:()=>{},http:{importCookies:(session,origin,cookies)=>{assert.equal(origin,'https://kavita.test');assert.equal(session,'desktop');assert.equal(cookies[0].name,'auth');events.push('import')},request:async()=>{events.push('verify');await verified;return {ok:true,body:JSON.stringify({username:'glitch'})}}}};
 vm.runInNewContext(block,context);const login=handler({},'https://kavita.test');const check=w.listeners['did-finish-load']();await new Promise(setImmediate);assert.equal(w.closed,false);verify();await check;assert.equal((await login).username,'glitch');assert.deepEqual(events,['import','verify','close']);
});


