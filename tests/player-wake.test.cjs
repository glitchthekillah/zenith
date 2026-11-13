const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

test('steady mouse activity keeps controls awake without mutating the native aperture ancestors',()=>{
 const source=fs.readFileSync('app/js/player.js','utf8');
 const start=source.indexOf('let idleT;'),end=source.indexOf('// Seeking',start);
 let idle=false,mutations=0,scheduled,cleared=0;
 const context={root:()=>({classList:{contains:()=>idle,remove:()=>{idle=false;mutations++},add:()=>{idle=true;mutations++}}}),S:{v:{paused:false}},clearTimeout:()=>cleared++,setTimeout:fn=>(scheduled=fn,1)};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+';globalThis.wakeControls=wake;',context);
 for(let i=0;i<30;i++)context.wakeControls();
 assert.equal(mutations,0,'Moving over already-visible controls must not rebuild the transparent video aperture');
 assert.equal(cleared,30,'Mouse activity must still restart the idle timer');
 scheduled();assert.equal(idle,true);
 context.wakeControls();assert.equal(idle,false);assert.equal(mutations,2,'A real hide/show transition still changes the controls');
 context.S.loading=true;scheduled();assert.equal(idle,false,'Loading controls must remain visible');
});
