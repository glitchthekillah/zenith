const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('node:vm'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../app/js/blurhash.js'),'utf8').replace(/^export /gm,'')+'\nglobalThis.api={decode,collect,hashes};';
const c={Math,Uint8ClampedArray,Map,Object,Array,Error};vm.createContext(c);vm.runInContext(src,c);const {decode,collect,hashes}=c.api;
test('decodes the reference blurhash',()=>{const px=decode('LEHV6nWB2yk8pyo0adR*.7kCMdnj',8,8);assert.equal(px.length,256);
 // top-left of the reference image is a warm brown-pink
 assert.ok(px[0]>100&&px[0]<220&&px[3]===255,String([...px.slice(0,4)]))});
test('bad hashes throw instead of drawing junk',()=>{assert.throws(()=>decode('abc',4,4));assert.throws(()=>decode('LEHV6nWB2yk8pyo0adR*.7kCMdn',4,4))});
test('hashes are collected from item lists by tag',()=>{collect({Items:[{ImageBlurHashes:{Primary:{t1:'LEHV6nWB2yk8pyo0adR*.7kCMdnj'},Thumb:{t2:'x'}}}]});assert.equal(hashes.get('t1'),'LEHV6nWB2yk8pyo0adR*.7kCMdnj');assert.equal(hashes.get('t2'),'x')});
