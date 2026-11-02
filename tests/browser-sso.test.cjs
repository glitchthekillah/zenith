const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('node:vm');
const root=process.env.ZENITH_ROOT||require('path').join(__dirname,'..');
const src=n=>fs.readFileSync(root+'/app/js/'+n,'utf8');
test('website sign-in control is available in the browser',()=>{const s=src('settings.js');assert.equal(s.includes("k === 'kavita' && desktop ?"),false)});
function bridge({marked=true,account={username:'glitch',authKeys:[{name:'opds',key:'test-opds'},{name:'image-only',key:'test-image'}]}}={}){
 const sent=[],calls=[],listeners={};let closed=false;const storage=new Map(),nonce='a'.repeat(32),opener={postMessage:(m,o)=>sent.push({m,o})};
 const c={URLSearchParams,URL,Date,JSON,console,location:{search:marked?'?zenith-connect='+nonce:'',origin:'https://zenithkavita.glitchthekillah.com'},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},window:{opener,addEventListener:(n,f)=>listeners[n]=f,close:()=>closed=true},setInterval:()=>1,clearInterval(){},fetch:async(url)=>{calls.push(url);return {ok:true,json:async()=>url.includes('Plugin')?{token:'test-token',refreshToken:'test-refresh'}:account}}};
 vm.createContext(c);vm.runInContext(src('kavita-bridge.js'),c);return {sent,calls,listeners,opener,closed:()=>closed,nonce};
}
test('Kavita SSO exchanges an existing key and posts only to Zenith',async()=>{const t=bridge();await new Promise(setImmediate);assert.equal(t.sent.length,1);assert.equal(t.sent[0].o,'https://zenith.glitchthekillah.com');assert.equal(t.sent[0].m.login.token,'test-token');assert.equal(t.sent[0].m.login.apiKey,'test-image');assert.equal(t.closed(),false)});
test('ordinary Kavita browsing does not initiate a handoff',async()=>{const t=bridge({marked:false});await new Promise(setImmediate);assert.equal(t.calls.length,0)});
test('popup closes only for matching acknowledgement from its Zenith opener',async()=>{const t=bridge();await new Promise(setImmediate);const msg={source:t.opener,origin:'https://evil.test',data:{type:'zenith-kavita-accepted',nonce:t.nonce}};t.listeners.message(msg);assert.equal(t.closed(),false);t.listeners.message({...msg,origin:'https://zenith.glitchthekillah.com'});assert.equal(t.closed(),true)});

function client(){
 const listeners={},messages=[];let closed=false,verified=0,opened='';
 const popup={closed:false,postMessage:(m,o)=>messages.push({m,o}),close:()=>{closed=true;popup.closed=true}};
 const c={URL,crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},window:{open:url=>{opened=url;return popup},addEventListener:(n,f)=>listeners[n]=f,removeEventListener:n=>delete listeners[n]},setInterval:()=>1,clearInterval(){},setTimeout:()=>2,clearTimeout(){}};
 vm.createContext(c);vm.runInContext(src('web-login.js').replace(/^export /gm,''),c);
 const promise=c.browserWebLogin('https://zenithkavita.glitchthekillah.com',async r=>{verified++;return r});
 return {promise,listeners,popup,messages,closed:()=>closed,verified:()=>verified,opened:()=>opened};
}
test('Zenith verifies the popup login then acknowledges and closes it',async()=>{
 const t=client();await t.listeners.message({source:t.popup,origin:'https://zenithkavita.glitchthekillah.com',data:{type:'zenith-kavita-login',nonce:'a'.repeat(32),login:{token:'test-token',username:'glitch'}}});
 assert.equal((await t.promise).username,'glitch');assert.equal(t.verified(),1);assert.equal(t.closed(),true);assert.equal(t.messages[0].o,'https://zenithkavita.glitchthekillah.com');assert.match(t.opened(),/zenith-connect=aaaaaaaa/);
});
test('Zenith ignores login messages from a different origin or popup',async()=>{
 const t=client(),data={type:'zenith-kavita-login',nonce:'a'.repeat(32),login:{token:'test-token',username:'glitch'}};
 await t.listeners.message({source:t.popup,origin:'https://evil.test',data});await t.listeners.message({source:{},origin:'https://zenithkavita.glitchthekillah.com',data});
 assert.equal(t.verified(),0);assert.equal(t.closed(),false);
 await t.listeners.message({source:t.popup,origin:'https://zenithkavita.glitchthekillah.com',data});await t.promise;
});

