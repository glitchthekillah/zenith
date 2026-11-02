const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const root=process.env.ZENITH_ROOT||require('path').join(__dirname,'..');
const source=n=>fs.readFileSync(root+'/app/js/'+n+'.js','utf8');
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function series(covers){const routes={};const c={settings:{app:{volumeCovers:covers}},route:(n,f)=>routes[n]=f,document:{addEventListener(){}},kv:{ready:()=>true,series:async()=>({name:'Test',pages:20}),metadata:async()=>({}),volumes:async()=>[{id:1,name:'1',minNumber:1,chapters:[{id:11,number:'-100000',pages:10}]},{id:2,name:'2',minNumber:2,chapters:[{id:22,number:'-100000',pages:10}]}],continuePoint:async()=>null,cover:()=>'/series.jpg',chapterCover:id=>'/cover/'+id},esc,icon:()=>'',plural:(n,x)=>n+' '+x};vm.createContext(c);vm.runInContext(source('read').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),c);return routes.series(1);}
function episode(previews,extra={}){let s=source('watch');s=s.slice(s.indexOf('async function seasonsBlock('),s.indexOf('async function boxsetBlock('));const c={settings:{app:{episodePreviews:previews}},jf:{seasons:async()=>[{Id:'s',Name:'Season 1',UserData:{}}],episodes:async()=>[{Id:'e',Name:'Episode',IndexNumber:1,UserData:{},...extra}],img:()=>'/still.jpg',trickplayUrl:()=>'/sprite.jpg'},remember:x=>x,esc,icon:()=>'',fmtRuntime:()=>'',desktop:false};vm.createContext(c);vm.runInContext(s,c);return c.seasonsBlock({Id:'show'});}
test('new installs enable both visual settings',()=>{const s=source('core');assert.match(s,/volumeCovers:\s*true/);assert.match(s,/episodePreviews:\s*true/)});
test('volume covers preserve individual artwork and reading targets',async()=>{const h=await series(true);assert.match(h,/volume-covers/);assert.match(h,/\/cover\/11/);assert.match(h,/\/cover\/22/);assert.match(h,/data-read="22"/)});
test('turning volume covers off removes images but keeps entries readable',async()=>{const h=await series(false);const entries=h.slice(h.indexOf('<section class="row">'));assert.doesNotMatch(entries,/<img/);assert.match(entries,/data-read="11"/)});
test('episodes have a wide left preview when enabled',async()=>assert.match(await episode(true),/episode-preview/));
test('turning episode previews off uses compact rows without thumbnail requests',async()=>{const h=await episode(false);assert.match(h,/episodes compact/);assert.doesNotMatch(h,/still.jpg/)});
test('missing trickplay retains episode still image',async()=>{const h=await episode(true);assert.match(h,/still.jpg/);assert.doesNotMatch(h,/data-trickplay=/)});
module.exports={series,episode};


test('existing opt-outs survive the settings defaults merge',()=>{
 const s=source('core'),part=s.slice(s.indexOf("const KEY ="),s.indexOf('// A stable id'));
 const c={localStorage:{getItem:()=>JSON.stringify({app:{volumeCovers:false,episodePreviews:false}}),setItem(){}}};vm.createContext(c);vm.runInContext(part.replace(/^export /gm,'')+'\n globalThis.result=settings;',c);
 assert.equal(c.result.app.volumeCovers,false);assert.equal(c.result.app.episodePreviews,false);
});
test('episode hover selects thumbnail sheets and coordinates without crossing sheet boundaries',()=>{
 const s=source('watch'),part=s.slice(s.indexOf('function episodeTrickplay'),s.indexOf('async function boxsetBlock'));
 const c={jf:{trickplayUrl:(_id,_width,sheet)=>'/sprite-'+sheet}};vm.createContext(c);vm.runInContext(part,c);
 const tp=c.episodeTrickplay({Id:'e',Trickplay:{src:{320:{Width:320,Height:180,TileWidth:2,TileHeight:2,ThumbnailCount:8}}}});
 assert.equal(c.episodeFrame(tp,3).url,'/sprite-0');assert.equal(c.episodeFrame(tp,3).x,1);assert.equal(c.episodeFrame(tp,3).y,1);
 assert.equal(c.episodeFrame(tp,4).url,'/sprite-1');assert.equal(c.episodeFrame(tp,4).x,0);assert.equal(c.episodeFrame(tp,4).y,0);
 assert.equal(c.episodeTrickplay({Trickplay:{src:{320:{Width:0}}}}),null);
});


test('Look settings expose both enabled toggles and save a changed preference',async()=>{
 const routes={},listeners={},settings={theme:'dark',servers:{},app:{volumeCovers:true,episodePreviews:true},playback:{}};let saved=0;
 const c={matchMedia:()=>({addEventListener(){}}),settings,route:(n,f)=>routes[n]=f,document:{addEventListener:(n,f)=>listeners[n]=f},desktop:null,on(){},esc,icon:()=>'',save:()=>saved++,toast(){},VERSION:'test',jf:{ready:()=>false},kv:{ready:()=>false},seerr:{ready:()=>false},rq:{provider:()=>null}};
 vm.createContext(c);vm.runInContext(source('settings').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),c);
 const h=await routes.settings('');
 assert.match(h,/Volume covers/);assert.match(h,/Episode previews/);assert.match(h,/data-set="app.volumeCovers" checked/);assert.match(h,/data-set="app.episodePreviews" checked/);
 listeners.change({target:{closest:()=>({dataset:{set:'app.volumeCovers'},type:'checkbox',checked:false})}});
 assert.equal(settings.app.volumeCovers,false);assert.equal(saved,1);
});




