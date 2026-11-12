const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('native EOS is authoritative even when the final video packet is shorter than container duration',()=>{
 const c={};vm.createContext(c);vm.runInContext(fs.readFileSync('third-party/air-native-video/guest-js/native-ended.ts','utf8').replace(/^export /gm,'')+'\nglobalThis.ended=isNativeEnded;',c);
 assert.equal(c.ended({ended:true,durationSeconds:60.032,currentTimeSeconds:60}),true);
 assert.equal(c.ended({ended:false,durationSeconds:60,currentTimeSeconds:60}),false);
 assert.equal(c.ended({durationSeconds:60,currentTimeSeconds:60}),true);
 assert.equal(c.ended({live:true,durationSeconds:0,currentTimeSeconds:60}),false);
 assert.equal(c.ended(undefined),false);
});
