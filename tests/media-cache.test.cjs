const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function client(){
 let finish,calls=0;const server={url:'https://media.test',token:'first',userId:'u'};
 const c={Map,Date,JSON,Promise,deviceId:'test',VERSION:'test',settings:{},groups:{srv:()=>server},desktop:null,navigator:{},collect(){},
   http:()=>{calls++;return new Promise(r=>finish=r);}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname+'/../app/js/jellyfin.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.request=api;',c);
 return {c,server,resolve:x=>finish(x),calls:()=>calls};
}
test('repeated media GETs share a request and return independent objects',async()=>{
 const x=client(),a=x.c.request('/item'),b=x.c.request('/item');
 assert.equal(x.calls(),1);x.resolve({Name:'Movie'});const [one,two]=await Promise.all([a,b]);
 one._g='other';assert.equal(two._g,undefined);
 assert.equal((await x.c.request('/item')).Name,'Movie');assert.equal(x.calls(),1);
});
test('different sign-ins never share cached responses',async()=>{
 const x=client(),a=x.c.request('/item');x.resolve({Name:'First'});await a;
 x.server.token='second';const b=x.c.request('/item');assert.equal(x.calls(),2);x.resolve({Name:'Second'});assert.equal((await b).Name,'Second');
});
test('changing watched or favorite state invalidates cached media',async()=>{
 const x=client(),a=x.c.request('/item');x.resolve({Name:'Before'});await a;
 const post=x.c.request('/watched',{method:'POST'});x.resolve({});await post;
 const b=x.c.request('/item');assert.equal(x.calls(),3);x.resolve({Name:'After'});await b;
});
