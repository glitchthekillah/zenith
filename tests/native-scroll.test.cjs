const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const root=process.env.ZENITH_SOURCE||path.join(__dirname,'..');
function environment({focus=true,reduce=false,webgl=true}={}){
 let time=0,draws=0,raf=[],timerId=0;const timers=new Map(),listeners={},classes=new Set(),sizes=[];
 const classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)};
 const gl=new Proxy({getProgramParameter:()=>true,getExtension:()=>null,drawArrays:()=>draws++},{get:(o,k)=>k in o?o[k]:(()=>({}))});
 const canvas={getContext:()=>webgl?gl:null,remove(){},get width(){return sizes.at(-1)||0},set width(n){sizes.push(n)},height:0};
 const app={addEventListener:(name,fn,options)=>{listeners['app:'+name]={fn,options}}};
 const doc={body:{classList},documentElement:{dataset:{},},hidden:false,hasFocus:()=>focus,getElementById:id=>id==='sky2'?canvas:id==='app'?app:null,addEventListener:(name,fn)=>{listeners['doc:'+name]={fn}}};
 const context={document:doc,window:{},innerWidth:1200,innerHeight:800,devicePixelRatio:1,localStorage:{getItem:()=>null},matchMedia:()=>({matches:reduce}),performance:{now:()=>time},MutationObserver:class{constructor(fn){this.fn=fn}observe(){}},addEventListener:(name,fn)=>{listeners[name]={fn}},requestAnimationFrame:fn=>raf.push(fn),setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,at:time+delay});return timerId},clearTimeout:id=>timers.delete(id)};
 vm.createContext(context);
 const run=file=>vm.runInContext(fs.readFileSync(path.join(root,'app/js',file),'utf8'),context);
 function step(dt){time+=dt;const pending=raf;raf=[];pending.forEach(fn=>fn(time));for(const [id,t]of timers)if(t.at<=time){timers.delete(id);t.fn()}}
 return {run,step,context,classes,sizes,listeners,get draws(){return draws},scroll(){listeners['app:scroll'].fn({target:app})}};
}
test('scroll activity is passive and clears after the final event',()=>{const e=environment();e.run('scroll.js');e.scroll();assert(e.classes.has('scrolling'));assert.equal(e.listeners['app:scroll'].options.passive,true);assert.equal(e.listeners['app:scroll'].options.capture,true);e.step(150);e.scroll();e.step(150);assert(e.classes.has('scrolling'));e.step(51);assert(!e.classes.has('scrolling'))});
test('background draws less often during a continuous native scroll',()=>{const e=environment();e.run('scroll.js');e.run('sky.js');for(let i=0;i<120;i++)e.step(1000/120);const idle=e.draws;for(let i=0;i<120;i++){e.scroll();e.step(1000/120)}const moving=e.draws-idle;assert(moving<idle,`idle=${idle}, scrolling=${moving}`);assert(moving>=15)});
test('unfocused redraw throttling never shrinks the background',()=>{const e=environment({focus:false});e.run('sky.js');for(let i=0;i<1000;i++)e.step(17);assert.equal(e.sizes.length,1);assert.equal(e.sizes[0],600)});
test('reduced motion draws once and playback does not loop',()=>{const r=environment({reduce:true});r.run('sky.js');for(let i=0;i<100;i++)r.step(17);assert.equal(r.draws,1);const p=environment();p.classes.add('playing');p.run('sky.js');for(let i=0;i<100;i++)p.step(17);assert.equal(p.draws,1)});
test('scrolling preserves click targets and keyboard focus styling',()=>{const css=fs.readFileSync(path.join(root,'app/css/app.css'),'utf8');assert.match(css,/body\.scrolling[^{}]*\.card:hover[^{}]*\.art/);const rules=css.match(/body\.scrolling[^{}]*\{[^}]*\}/g)||[];assert(rules.length);assert(!rules.some(r=>/pointer-events\s*:\s*none/.test(r)));assert(rules.every(r=>/:not\(:focus-visible\)/.test(r)))});
