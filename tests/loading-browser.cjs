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
   {id:'g1',name:'Fast',servers:{jellyfin:{url:'http://127.0.0.1:8096',token:'tok',userId:'u1'},ask:{url:'http://127.0.0.1:3300',name:'Test'}}},
   {id:'g2',name:'Slow',servers:{jellyfin:{url:'http://127.0.0.1:8097',token:'tok',userId:'u1'}}}
  ],app:{liveSky:false},playback:{audioLang:'default',subtitles:'off'},profile:{name:'Test'}})));
  const catalog=[{key:'movie:101',type:'movie',id:101,title:'Ajin film',status:'none'},{key:'tv:102',type:'tv',id:102,title:'Ajin show',status:'none'},{key:'tv:103',type:'tv',anime:true,id:103,title:'Ajin anime',status:'none'},{key:'manga:104',type:'manga',id:104,title:'Ajin manga',status:'available'},{key:'comic:105',type:'comic',id:105,title:'American comic',status:'none'},{key:'book:106',type:'book',id:106,title:'Ajin novel',status:'none'}];let catalogSearches=0;
  const answerCatalog=async(route,data)=>{
    if(!data.url.includes(':3300'))return false;
    const p=new URL(data.url).pathname;let result={items:[]};
    if(p==='/api/search'){catalogSearches++;result={video:catalog.filter(x=>['movie','tv'].includes(x.type)),reading:catalog.filter(x=>!['movie','tv'].includes(x.type))};}
    else if(p==='/api/discover')result={items:catalog,page:1,more:false};
    else if(p==='/api/me')result={name:'Test'};
    await route.fulfill({json:{ok:true,status:200,headers:{'content-type':'application/json'},body:JSON.stringify(result),base64:false}});return true;
  };
  await page.route('**/api/http',async route=>{
   const data=route.request().postDataJSON();
   if(await answerCatalog(route,data))return;
   if(data.url.includes(':8096')&&data.url.includes('/Items/Resume')){const response=await route.fetch();const envelope=await response.json();const payload=JSON.parse(envelope.body);payload.Items[0].Name='I Got a Cheat Skill in Another World and Became Unrivaled in the Real World, Too — A Very Long Title That Must Remain Fully Readable';envelope.body=JSON.stringify(payload);await route.fulfill({json:envelope});return;}
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
  for(const width of [1280,760,420]){await page.setViewportSize({width,height:820});await page.waitForTimeout(80);const bounds=await page.locator('.hello-resume').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1,offscreen:el.getBoundingClientRect().right>innerWidth}));assert.equal(bounds.overflow,false,'long Resume title clips at '+width);assert.equal(bounds.offscreen,false,'Resume action exceeds viewport at '+width);}
  await page.setViewportSize({width:1280,height:820});console.log('Long Resume title wraps without clipping at desktop and narrow widths');
  await page.locator('#hero .hero-slide:not([hidden]) .hero-art img').waitFor();
  for(const width of [1280,760]){await page.setViewportSize({width,height:820});const geometry=await page.locator('#hero .hero-slide:not([hidden])').evaluate(el=>{const a=el.querySelector('.hero-art').getBoundingClientRect(),t=el.querySelector('.hero-in').getBoundingClientRect();const h=el.closest('#hero').getBoundingClientRect();return {separate:innerWidth>860?t.right<=a.left+1:a.bottom<=t.top+1,flush:innerWidth<=860||(Math.abs(a.top-h.top)<=2&&Math.abs(a.bottom-h.bottom)<=2&&Math.abs(a.right-h.right)<=2),fit:getComputedStyle(el.querySelector('img')).objectFit};});assert.equal(geometry.separate,true,'hero art overlaps text');assert.equal(geometry.fit,'contain','hero banner is cropped');assert.equal(geometry.flush,true,'banner does not fill the red-box area flush to the outer edges');assert.equal(await page.locator('#hero').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(0, 0, 0)','hero box is not pitch black');}
  await page.setViewportSize({width:1280,height:820});
  if(process.env.ZENITH_REVIEW_DIR){require('fs').mkdirSync(process.env.ZENITH_REVIEW_DIR,{recursive:true});await page.locator('#hero').screenshot({path:path.join(process.env.ZENITH_REVIEW_DIR,'hero.png')});}
  console.log('Hero banner stays complete in a separate side panel and stacks on narrow windows');
  const slideDots=page.locator('#hero [data-hero]');
  assert(await slideDots.count()>1,'carousel fixture needs multiple slides');
  await slideDots.nth(1).click();
  await page.waitForTimeout(100);
  const blend=await page.locator('#hero .hero-slide:not([hidden])').evaluate(el=>({opacity:Number(getComputedStyle(el).opacity),inert:el.inert,hidden:el.getAttribute('aria-hidden')}));
  assert(blend.opacity>0&&blend.opacity<1,'slide switch must crossfade rather than cut');
  assert.equal(blend.inert,false);assert.equal(blend.hidden,'false');
  assert.equal(await page.locator('#hero .hero-slide[hidden]').evaluateAll(els=>els.every(el=>el.inert&&el.getAttribute('aria-hidden')==='true')),true,'inactive slide controls remain accessible');
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#hero .hero-slide:not([hidden])').evaluate(el=>getComputedStyle(el).opacity),'1');
  const seam=await page.locator('#hero .hero-slide:not([hidden]) .hero-art').evaluate(el=>({gradient:getComputedStyle(el,'::after').backgroundImage,clicks:getComputedStyle(el,'::after').pointerEvents}));
  assert.match(seam.gradient,/linear-gradient/);assert.equal(seam.clicks,'none');
  await page.emulateMedia({reducedMotion:'reduce'});await slideDots.first().click();
  assert.equal(await page.locator('#hero .hero-slide:not([hidden])').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await page.emulateMedia({reducedMotion:'no-preference'});
  console.log('Hero crossfades smoothly, inactive controls stay inert, seam fades into black and reduced motion is respected');

  t=Date.now();await page.locator('nav a[href="#/movies"]').click();
  await page.locator('#lib-grid .card:not(.skeleton)').first().waitFor({timeout:1500});console.log('Movies first titles:',Date.now()-t,'ms (genres and secondary server pending)');
  t=Date.now();await page.locator('#lib-grid a[href*="/item/"] b').first().click();
  await page.locator('.detail-in button[data-play]').first().waitFor({timeout:1500});console.log('Movie Play available:',Date.now()-t,'ms (recommendations and other copies pending)');
  await page.locator('.copies-loading[role="status"]').waitFor({timeout:1000});
  assert.match(await page.locator('.copy-pending').textContent(),/Checking available servers/);
  assert.equal(await page.locator('.copy-spinner').evaluate(el=>getComputedStyle(el).animationName),'spin');
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
    if(await answerCatalog(route,data))return;
    if(data.url.includes(':8097')){
      let answer;
      if(data.url.includes('AnyProviderIdEquals='))answer={Items:[bad],TotalRecordCount:1};
      else if(new URL(data.url).searchParams.get('SearchTerm')==='Starfall')answer={Items:[good],TotalRecordCount:1};
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
  assert.equal(await page.locator('.copies-loading').count(),0,'server loading indicator remained after results arrived');
  console.log('Server picker shows animated loading feedback and clears it when verified options arrive');
  await page.locator('.copy[href="#/item/copy0@g2"]').click();
  await page.waitForFunction(()=>location.hash==='#/item/copy0@g2'&&document.querySelector('.detail h1')?.textContent==='Starfall');
  await page.locator('.detail-in button[data-play]').click();
  await page.waitForFunction(()=>{const v=document.querySelector('#player video');return v&&v.currentTime>0&&v.videoWidth>0;},{},{timeout:6000});
  assert(played.some(url=>url.includes('/Items/copy0/PlaybackInfo')),'playback was sent to a different copy');
  console.log('Server switch: same movie, correct destination ID, playback verified');
  await page.locator('#player [data-p="close"]').click();
  await page.locator('nav a[href="#/request"]').click();
  await page.locator('#rq-search input').fill('Ajin');await page.locator('#rq-search input').press('Enter');
  await page.getByRole('heading',{name:'Movies and shows (3)',exact:true}).waitFor({timeout:2000});
  await page.getByRole('heading',{name:'Books, manga and comics (3)',exact:true}).waitFor();
  assert.equal(await page.locator('[data-request-category]').count(),7);
  const beforeFilters=catalogSearches;
  for(const [kind,title] of [['anime','Ajin anime'],['manga','Ajin manga'],['comic','American comic'],['book','Ajin novel']]){await page.locator(`[data-request-category="${kind}"]`).click();assert.equal(await page.locator('#view .category-results .card').count(),1);assert.equal(await page.locator('#view .category-results .card b').textContent(),title);}
  await page.locator('[data-request-category="all"]').click();assert.equal(catalogSearches,beforeFilters,'changing category repeated the request');
  if(process.env.ZENITH_REVIEW_DIR)await page.locator('#view').screenshot({path:path.join(process.env.ZENITH_REVIEW_DIR,'requests.png')});
  console.log('Request categories separate anime, books, manga and comics with counts; filters need no new search');
  await page.locator('#top-search input').fill('Ajin');await page.locator('#top-search input').press('Enter');
  await page.locator('[data-search-category="manga"]').click();await page.getByRole('heading',{name:'Manga (1)',exact:true}).waitFor({timeout:2000});
  assert.equal(await page.locator('#view .category-results .card b').textContent(),'Ajin manga');
  console.log('Global app search uses the same category layout');
  assert.deepEqual(errors,[]);console.log('Browser errors: 0');
 } finally {if(browser)await browser.close();for(const c of children)c.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
