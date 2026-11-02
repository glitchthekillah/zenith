const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('node:vm');
const root=process.env.ZENITH_ROOT||path.join(__dirname,'..');
const main=fs.readFileSync(path.join(root,'electron/main.js'),'utf8');
const startup=main.slice(main.indexOf('protocol.registerSchemesAsPrivileged('),main.indexOf('let win = null'));
function run(platform,disabled=''){
 const switches=new Map(disabled?[['disable-features',disabled]]:[]);
 const app={requestSingleInstanceLock:()=>true,quit(){},setAppUserModelId(){},commandLine:{getSwitchValue:key=>switches.get(key)||'',appendSwitch:(key,value)=>switches.set(key,value)}};
 vm.runInNewContext(startup,{app,process:{platform},protocol:{registerSchemesAsPrivileged(){}}});
 return switches;
}
test('Linux uses in-process audio for Discord capture',()=>assert.ok(run('linux').get('disable-features')?.split(',').includes('AudioServiceOutOfProcess')));
test('Linux preserves caller supplied disabled features',()=>{const s=run('linux','ExistingFeature,AudioServiceOutOfProcess').get('disable-features').split(',');assert.ok(s.includes('ExistingFeature'));assert.equal(s.filter(x=>x==='AudioServiceOutOfProcess').length,1)});
test('Windows audio startup remains unchanged',()=>assert.equal(run('win32','ExistingFeature').get('disable-features'),'ExistingFeature'));
test('macOS audio startup remains unchanged',()=>assert.equal(run('darwin').has('disable-features'),false));
