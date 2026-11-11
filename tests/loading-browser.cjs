// End-to-end loading check with local fake media; no real account or server.
const {chromium}=require('playwright'),{spawn}=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.ZENITH_APP_ROOT||path.join(__dirname,'..'),fixtures=process.env.FIXTURES;
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
   if(data.url.includes('/Shows/NextUp'))await new Promise(r=>setTimeout(r,900));
   await route.continue();
  });
  await new Promise(r=>setTimeout(r,500));
  let t=Date.now();await page.goto('http://127.0.0.1:18484/#/home');
  await page.locator('#view .card:not(.skeleton)').first().waitFor({timeout:4000});console.log('Home first titles:',Date.now()-t,'ms (secondary server pending)');
  await page.evaluate(()=>{window.__hello=document.querySelector('.hello');window.__search=document.querySelector('#top-search input');});
  await page.waitForFunction(()=>document.querySelector('.hello-stats')?.textContent.includes('up next'));
  assert.equal(await page.evaluate(()=>window.__hello===document.querySelector('.hello')),true,'Home greeting was recreated during loading');
  assert.equal(await page.evaluate(()=>window.__search===document.querySelector('#top-search input')),true,'top search field was recreated during loading');
  console.log('Home greeting and top search DOM stay stable');
  t=Date.now();await page.locator('nav a[href="#/movies"]').click();
  await page.locator('#lib-grid .card:not(.skeleton)').first().waitFor({timeout:1500});console.log('Movies first titles:',Date.now()-t,'ms (genres and secondary server pending)');
  t=Date.now();await page.locator('#lib-grid a[href*="/item/"] b').first().click();
  await page.locator('.detail-in button[data-play]').first().waitFor({timeout:1500});console.log('Movie Play available:',Date.now()-t,'ms (recommendations and other copies pending)');
  await page.locator('.detail-in button[data-play]').first().click();
  await page.waitForFunction(()=>{const v=document.querySelector('#player video');return v&&v.currentTime>0&&v.videoWidth>0;},{},{timeout:6000});
  console.log('Playback: video decoded and advanced');
  await page.locator('#player [data-p="close"]').click();
  t=Date.now();await page.locator('#top-search input').fill('Starfall');await page.locator('#top-search input').press('Enter');
  await page.locator('#view .card:not(.skeleton) b').first().waitFor({timeout:1500});console.log('Search first results:',Date.now()-t,'ms (secondary server pending)');
  const original=await page.evaluate(async()=>{const c=await import('/js/core.js');c.groups.use('g1');return (await import('/js/jellyfin.js')).item('m0');});
  const good={...original,Id:'copy0'},bad={...original,Id:'m0',Name:'Wrong movie',ProviderIds:{Tmdb:'different'}};const played=[];
  await page.unroute('**/api/http');
  await page.route('**/api/http',async route=>{
    const data=route.request().postDataJSON();
    if(data.url.includes(':8097')){
      let answer;
      if(data.url.includes('AnyProviderIdEquals='))answer={Items:[bad,good],TotalRecordCount:2};
      else if(new URL(data.url).pathname.endsWith('/Items/copy0'))answer=good;
      if(answer){await route.fulfill({json:{ok:true,status:200,headers:{'content-type':'application/json'},body:JSON.stringify(answer),base64:false}});return;}
      if(data.url.includes('/PlaybackInfo'))played.push(data.url);
      const response=await route.fetch({postData:JSON.stringify({...data,url:data.url.replace(':8097',':8096')})});await route.fulfill({response});return;
    }
    await route.continue();
  });
  await page.route('http://127.0.0.1:8097/**',route=>route.continue({url:route.request().url().replace(':8097',':8096')}));
  await page.evaluate(()=>{location.hash='#/item/m0@g1';});
  await page.locator('.copy[href="#/item/copy0@g2"]').waitFor({timeout:2000});
  assert.equal(await page.locator('.copy[href="#/item/m0@g2"]').count(),0,'wrong movie offered as a copy');
  await page.locator('.copy[href="#/item/copy0@g2"]').click();
  await page.waitForFunction(()=>location.hash==='#/item/copy0@g2'&&document.querySelector('.detail h1')?.textContent==='Starfall');
  await page.locator('.detail-in button[data-play]').click();
  await page.waitForFunction(()=>{const v=document.querySelector('#player video');return v&&v.currentTime>0&&v.videoWidth>0;},{},{timeout:6000});
  assert(played.some(url=>url.includes('/Items/copy0/PlaybackInfo')),'playback was sent to a different copy');
  console.log('Server switch: same movie, correct destination ID, playback verified');
  assert.deepEqual(errors,[]);console.log('Browser errors: 0');
 } finally {if(browser)await browser.close();for(const c of children)c.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
