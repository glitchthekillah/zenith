const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
function subject(){const s=fs.readFileSync('app/js/watch.js','utf8');const part=s.slice(s.indexOf('const pid ='),s.indexOf('const placeNames ='));const c={settings:{groups:[{id:'own'},{id:'friend'}]}};vm.createContext(c);vm.runInContext(part.replace(/^export /gm,'')+'\nglobalThis.subject={merge,titleKey};',c);return c.subject;}
const movie=(id,g,provider,date)=>({Id:id,_g:g,Type:'Movie',Name:'Same title',ProviderIds:provider,UserData:date?{LastPlayedDate:date}:{}});
test('matching provider IDs combine copies across servers',()=>{const r=subject().merge([movie('1','own',{Tmdb:'42'}),movie('2','friend',{Tmdb:'42'})]);assert.equal(r.length,1);assert.equal(r[0]._copies.length,2)});
test('same names with different provider IDs remain distinct',()=>assert.equal(subject().merge([movie('1','own',{Tmdb:'42'}),movie('2','friend',{Tmdb:'43'})]).length,2));
test('missing provider IDs do not merge by title alone',()=>assert.equal(subject().merge([movie('1','own',{}),movie('2','friend',{})]).length,2));
test('most recently watched copy is selected',()=>assert.equal(subject().merge([movie('1','own',{Tmdb:'42'},'2026-11-01'),movie('2','friend',{Tmdb:'42'},'2026-11-03')])[0].Id,'2'));
test('first server is preferred when neither copy has watch history',()=>assert.equal(subject().merge([movie('2','friend',{Tmdb:'42'}),movie('1','own',{Tmdb:'42'})])[0].Id,'1'));
