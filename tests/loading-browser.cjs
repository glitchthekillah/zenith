// End-to-end loading check with local fake media; no real account or server.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),fixtures=process.env.FIXTURES;
const children=[];
const start=(file,env={})=>{const c=spawn(process.execPath,[file],{cwd:root,env:{...process.env,...env},stdio:'ignore'});children.push(c);return c;};
(async()=>{
 let browser;
 try {
  start('tests/mock-servers.js',{FIXTURES:fixtures});
  start('server/serve.js',{PORT:'18484',ZENITH_HOSTS:'http://127.0.0.1:8096'});
  browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('zenith',JSON.stringify({groups:[
   {id:'g1',name:'Fast',servers:{jellyfin:{url:'http://127.0.0.1:8096',token:'tok',userId:'u1'}}},
   {id:'g2',name:'Slow',servers:{jellyfin:{url:'http://127.0.0.1:8097',token:'tok',userId:'u1'}}}
  ],app:{liveSky:false},playback:{audioLang:'default',subtitles:'off'},profile:{name:'Test'}})));
  await page.route('**/api/http',async route=>{
   const data=route.request().postDataJSON();
   // Deliberately leave optional recommendations, genres and server 2 unanswered.
   if(data.url.includes(':8097')||data.url.includes('/Similar')||data.url.includes('/Genres'))return;
   await route.continue();
  });
  await new Promise(r=>setTimeout(r,500));
  let t=Date.now();await page.goto('http://127.0.0.1:18484/#/home');
  await page.locator('#view .card').first().waitFor({timeout:4000});console.log('Home first titles:',Date.now()-t,'ms (secondary server pending)');
  t=Date.now();await page.locator('nav a[href="#/movies"]').click();
  await page.locator('#lib-grid .card:not(.skeleton)').first().waitFor({timeout:1500});console.log('Movies first titles:',Date.now()-t,'ms (genres and secondary server pending)');
  t=Date.now();await page.locator('#lib-grid a[href*="/item/"] b').first().click();
  await page.locator('.detail-in button[data-play]').first().waitFor({timeout:1500});console.log('Movie Play available:',Date.now()-t,'ms (recommendations and other copies pending)');
  await page.locator('.detail-in button[data-play]').first().click();
  await page.waitForFunction(()=>{const v=document.querySelector('#player video');return v&&v.currentTime>0&&v.videoWidth>0;},{},{timeout:6000});
  console.log('Playback: video decoded and advanced');
  assert.deepEqual(errors,[]);console.log('Browser errors: 0');
 } finally {if(browser)await browser.close();for(const c of children)c.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
