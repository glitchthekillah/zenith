const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
function tracks(playback={}){const c={settings:{playback:{audioLang:'eng',subLang:'eng',subtitles:'smart',...playback}}};vm.createContext(c);vm.runInContext(fs.readFileSync('app/js/tracks.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.api={pickAudio,pickSub,cueHtml};',c);return c.api;}
const audio=[{index:1,lang:'jpn',isDefault:true},{index:2,lang:'en',label:'English commentary'},{index:3,lang:'eng',label:'English'}];const subs=[{index:4,lang:'eng',textBased:true},{index:5,lang:'en',forced:true,textBased:true}];
test('preferred English audio skips commentary and the Japanese default',()=>assert.equal(tracks().pickAudio(audio,1),3));
test('file-default preference keeps the file audio selection',()=>assert.equal(tracks({audioLang:'default'}).pickAudio(audio,1),1));
test('foreign audio enables full English subtitles',()=>assert.equal(tracks().pickSub(subs,audio[0]),4));
test('English audio uses only forced English subtitles in smart mode',()=>assert.equal(tracks().pickSub(subs,audio[2]),5));
test('subtitle off overrides matching tracks',()=>assert.equal(tracks({subtitles:'off'}).pickSub(subs,audio[0]),null));
test('subtitle always selects full subtitles for English audio',()=>assert.equal(tracks({subtitles:'always'}).pickSub(subs,audio[2]),4));
test('cue markup keeps italics and strips executable tags',()=>{const h=tracks().cueHtml('<i>Hello</i><img src=x onerror=alert(1)>');assert.equal(h,'<i>Hello</i>')});
async function start(rewatch,episodes){const s=fs.readFileSync('app/js/watch.js','utf8');const part=s.slice(s.indexOf('export async function startEpisode'),s.indexOf('// ── Actions on cards'));const c={groups:{active:()=>({id:'g'}),run:(_g,f)=>f(),tag:(_g,x)=>x},settings:{app:{rewatch}},jf:{allEpisodes:async()=>episodes},remember:x=>x};vm.createContext(c);vm.runInContext(part.replace('export ',''),c);return c.startEpisode('show');}
const episodes=()=>[1,2,3].map(n=>({Id:String(n),IndexNumber:n,ParentIndexNumber:1,UserData:{Played:true,LastPlayedDate:n===1?'2026-11-03T02:00:00Z':'2026-10-01T00:00:00Z'}}));
test('rewatch continues after the most recently finished episode',async()=>assert.equal((await start(true,episodes())).Id,'2'));
test('rewatch disabled retains the normal completed-series restart',async()=>assert.equal((await start(false,episodes())).Id,'1'));
test('a more recent partial episode takes priority over finished episodes',async()=>{const e=episodes();e[2].UserData={Played:false,PlaybackPositionTicks:100,LastPlayedDate:'2026-11-03T03:00:00Z'};assert.equal((await start(true,e)).Id,'3')});
