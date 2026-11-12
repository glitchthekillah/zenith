const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('native rate selection updates the media facade before settings read it back',async()=>{
 const source=fs.readFileSync('third-party/air-native-video/guest-js/index.ts','utf8');
 const method=source.slice(source.indexOf('  async setPlaybackRate('),source.indexOf('  async seek(')).replace('rate: number','rate').replace(': Promise<void>','');
 const c={Event};vm.createContext(c);vm.runInContext(`class Rate {#rate=1;#platform='linux';element={dispatchEvent(){}};get rate(){return this.#rate}#control(){return new Promise(resolve=>this.release=resolve)}#acceptSnapshot(value){return value}${method}};globalThis.subject=new Rate()`,c);
 const pending=c.subject.setPlaybackRate(1.5);assert.equal(c.subject.rate,1.5);c.subject.release({});await pending;
});
