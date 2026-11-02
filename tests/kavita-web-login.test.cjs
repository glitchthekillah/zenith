const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require("fs");let probeScript;try{({probeScript}=require("../shared/kavita-web-login"))}catch{probeScript=fs.readFileSync("../electron/main.js","utf8").match(/executeJavaScript\(`([^`]+)`\)/)[1]}
function probe(user,ok=true){const c={localStorage:{length:0},fetch:async()=>({ok,json:async()=>user})};return vm.runInNewContext(probeScript,c);}
test('cookie SSO yields a login without a bearer token',async()=>{const r=await probe({username:'glitch',authKeys:[{name:'image-only',key:'image-test'},{name:'opds',key:'opds-test'}]});assert.equal(r.cookie,true);assert.equal(r.username,'glitch');assert.equal(r.apiKey,'image-test')});
test('signed-out popup remains open',async()=>assert.equal(await probe({},false),null));
test('invalid account response is not a completed login',async()=>assert.equal(await probe({}),null));



