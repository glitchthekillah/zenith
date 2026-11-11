const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=n=>fs.readFileSync(__dirname+'/../app/js/'+n+'.js','utf8');
const never=()=>new Promise(()=>{}),flush=()=>new Promise(setImmediate);
function watch(overrides={}) {
  const routes={},jobs=[],g={id:'g1',servers:{jellyfin:{}}};
  const groups={active:()=>g,with:k=>k==='jellyfin'?[g]:[],run:(_g,f)=>f(),tag:(_g,x)=>x,byId:()=>g,many:()=>false,use:()=>g};
  const c={console,Map,Set,Promise,setTimeout,clearTimeout,setInterval,clearInterval,
    settings:{app:{},playback:{},groups:[g]},groups,splitId:x=>x,gsuf:()=>'',
    route:(n,f)=>routes[n]=f,on(){},emit(){},debounce:f=>f,desktop:null,
    document:{addEventListener(){},createElement:()=>({}),head:{append(){}}},
    $:()=>null,$$:()=>[],esc:x=>String(x??''),icon:()=>'',fmtRuntime:()=>'',plural:(n,x)=>`${n} ${x}`,loading:()=>'<p>Loading</p>',
    defer:(run,fallback='')=>{jobs.push(run);return `<div>${fallback}</div>`;},
    jf:{ready:()=>true,item:async()=>({Id:'movie',Name:'A movie',Type:'Movie',MediaSources:[],UserData:{}}),img:()=>'',similar:never,views:never,genres:never},
    kv:{},rq:{provider:()=>false},player:{isOpen:()=>false},...overrides};
  vm.createContext(c);vm.runInContext(source('watch').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),c);
  c.prePlay=async()=>'';
  return {c,routes,jobs};
}
test('movie page exposes Play without waiting for recommendations or other servers',async()=>{
  const w=watch();let html;
  w.routes.item('movie').then(x=>html=x);
  await flush();
  assert.ok(html?.includes('data-play="movie"'),'movie page is blocked by optional network requests');
});
test('Movies tab renders before library metadata answers',async()=>{
  const w=watch();let html;w.routes.movies().then(x=>html=x);await flush();
  assert.ok(html?.includes('lib-grid'),'tab is blocked by Views/Genres');
});
test('Home returns a mountable page before any connected service answers',async()=>{
  const w=watch();w.c.jf.resume=never;w.c.jf.nextUp=never;
  let html;Promise.resolve(w.routes.home()).then(x=>html=x);await flush();
  assert.ok(typeof html==='string'&&html.length,'Home is waiting for the slowest service');
});
test('Home displays a fast server without waiting for another server',async()=>{
  const w=watch();const fast={id:'fast'},slow={id:'slow'};let active=fast,painted='';
  w.c.groups.with=k=>k==='jellyfin'?[fast,slow]:[];
  w.c.groups.run=(g,f)=>{const prev=active;active=g;try{return f();}finally{active=prev;}};
  w.c.jf.resume=()=>active===slow?never():Promise.resolve([{Id:'a',Name:'Fast movie',Type:'Movie'}]);
  for(const name of ['nextUp','views'])w.c.jf[name]=()=>active===slow?never():Promise.resolve([]);
  w.c.jf.items=()=>active===slow?never():Promise.resolve({Items:[]});
  w.c.card=it=>it.Name;w.c.greeting=()=>'';
  w.routes.home();w.jobs[0](h=>painted+=h,()=>true);await flush();
  assert.match(painted,/Fast movie/,'Home is still held by another server');
});
test('library shows the responding server while another server is still pending',async()=>{
  const grid={dataset:{},innerHTML:'',isConnected:true,insertAdjacentHTML(_p,h){this.innerHTML+=h;}};
  const w=watch({$:s=>s==='#lib-grid'?grid:null});
  const fast={id:'fast'},slow={id:'slow'};let active=fast;
  w.c.groups.with=()=>[fast,slow];w.c.groups.active=()=>active;
  w.c.groups.run=(g,f)=>{const prev=active;active=g;try{return f();}finally{active=prev;}};
  w.c.jf.items=()=>active===slow?never():Promise.resolve({Items:[{Id:'a',Name:'A movie',Type:'Movie',UserData:{}}],TotalRecordCount:1});
  w.c.card=it=>it.Name;
  w.c.fillLibrary(null,'Movie',{sort:'SortName',order:'Ascending',start:0},true);await flush();
  assert.match(grid.innerHTML,/A movie/,'the fast server was blocked by the slow server');
});

test('deferred sections start after mount and ignore results after navigation',async()=>{
  let finish,started=false;const slots=new Map();
  const view={setAttribute(){},removeAttribute(){},scrollTop:0,
    set innerHTML(h){for(const x of slots.values())x.isConnected=false;slots.clear();for(const m of h.matchAll(/data-defer="([^"]+)"/g))slots.set(m[1],{dataset:{defer:m[1]},isConnected:true,innerHTML:'',querySelectorAll:()=>[]});},
    querySelectorAll:()=>[...slots.values()]};
  const c={Map,Promise,console,$:()=>view,emit(){},routes:{},current:()=>({name:'a',args:[]}),window:{scrollTo(){}},loading:()=>'',errorBox:()=>'',setTimeout};
  vm.createContext(c);vm.runInContext(source('core').slice(source('core').indexOf('let renderId = 0;'),source('core').indexOf('// ── UI helpers')).replace(/^export /gm,'').replace(/window.addEventListener\('hashchange', render\);/,''),c);
  assert.equal(typeof c.defer,'function');
  c.routes.a=()=>c.defer(()=>{started=true;return new Promise(r=>finish=r);});
  await c.render();await flush();assert.equal(started,true);
  const old=[...slots.values()][0];c.routes.a=()=>'<p>Next page</p>';await c.render();finish('old response');await flush();
  assert.equal(old.innerHTML,'','a stale response changed the old page');
});
