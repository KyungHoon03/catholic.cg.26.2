// 두 기기의 Pages 비교와 구분한 로컬 검증. 실제 GPU와 측정 방식을 기록한다.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),key='cg-week7-profile-v1';
const evidence={date:'2026-10-15',scope:'Local functional verification; not the required two-device Pages comparison',browser:'Microsoft Edge headless',viewport:[1440,1000],sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'task2.js'))).digest('hex'),cases:[],measurements:[],errors:[],failedResponses:[]};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const assert=(ok,message)=>{if(!ok)throw Error(message);};
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',e=>{if(e.type()==='error')evidence.errors.push(e.text());});
  page.on('response',r=>{if(r.status()>=400)evidence.failedResponses.push(r.url());});
  await page.addInitScript(()=>{
   const get=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){
    const gl=get.call(this,type,...args);if(type!=='webgl2'||!gl||window.check)return gl;
    window.check={links:[]};const link=gl.linkProgram.bind(gl);
    gl.linkProgram=p=>{link(p);window.check.links.push({ok:gl.getProgramParameter(p,gl.LINK_STATUS),log:gl.getProgramInfoLog(p)});};return gl;
   };
  });
  const url='http://127.0.0.1:'+server.address().port+'/task2.html';
  async function ready(){await page.waitForFunction(()=>window.check?.links.length===2&&document.querySelector('#status').textContent);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
  async function settings(){return page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('#ui select,#ui input')].map(el=>[el.closest('[data-id]').dataset.id,el.type==='checkbox'?el.checked:el.value])));}
  async function set(values){for(const [id,value] of Object.entries(values)){const el=page.locator('[data-id="'+id+'"] '+(id==='advanced'?'input':'select'));if(id==='advanced')await el.setChecked(value);else await el.selectOption(String(value));}await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
  async function capture(name){await ready();const state=await page.evaluate(()=>{const gl=document.querySelector('#cv').getContext('webgl2');return {links:window.check.links,error:gl.getError(),size:[gl.drawingBufferWidth,gl.drawingBufferHeight],profile:document.querySelector('#profile').textContent,status:document.querySelector('#status').textContent};});
   assert(state.links.every(l=>l.ok)&&state.error===0,name+' WebGL failure');
   const canvas=await page.locator('#cv').screenshot();const hash=crypto.createHash('sha256').update(canvas).digest('hex');
   await page.screenshot({path:path.join(root,'images','task2-'+name+'.png')});
   evidence.cases.push({name,...state,settings:await settings(),hash});return hash;
  }
  async function measure(name){console.log('Measuring '+name);await page.locator('#measure').click();await page.waitForFunction(()=>!document.querySelector('#measure').disabled,null,{timeout:180000});
   assert(await page.locator('#result tbody tr').count()===3,'Measurement failed: '+await page.locator('#result').innerText());
   const result={name,settings:await settings(),status:await page.locator('#status').innerText(),rows:await page.locator('#result tbody tr').allTextContents()};evidence.measurements.push(result);console.log(JSON.stringify(result));await capture(name);return result;
  }
  await page.goto(url);await ready();evidence.environment=await page.evaluate(()=>{const gl=document.querySelector('#cv').getContext('webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),gpuTimer:!!gl.getExtension('EXT_disjoint_timer_query_webgl2')};});console.log(JSON.stringify(evidence.environment));
  assert(await page.locator('#save-profile').isDisabled(),'Unmeasured settings can be saved');
  const local=await capture('local');await set({mode:'1'});const ray=await capture('ray');await set({mode:'2'});const traced=await capture('path');assert(local!==ray&&ray!==traced,'Modes do not differ');
  await set({resolution:'320',samples:'4',bounces:'1',advanced:false});await measure('save-candidate');
  const saved=await settings();await page.locator('#save-profile').click();assert((await page.locator('#profile-status').innerText()).includes('저장했습니다'),'Profile save failed');
  await page.reload();await ready();assert(JSON.stringify(saved)===JSON.stringify(await settings()),'Reload did not restore settings');await capture('saved-reload');
  await set({samples:'8'});assert(await page.locator('#save-profile').isDisabled(),'Unmeasured edit can be saved');
  await set({resolution:'640',samples:'8',bounces:'2',advanced:true});for(let i=1;i<=3;i++)await measure('common-'+i);
  for(const resolution of ['960','1280','1920']){await set({resolution});await measure('resolution'+resolution);}
  for(const samples of ['16','32']){await set({resolution:'640',samples});await measure('samples'+samples);}
  for(const bounces of ['3','4']){await set({samples:'8',bounces});await measure('bounces'+bounces);}
  await set({bounces:'2',advanced:false});await measure('advanced-off');
  // 적정값을 확정하지 않고 결합 고부하의 실제 비용도 별도로 기록한다.
  await set({resolution:'1280',samples:'16',bounces:'3',advanced:true});await measure('combined-load');
  // 형식 오류와 저장소 차단은 일회용 브라우저 문맥에서 시험한다.
  await page.evaluate(k=>localStorage.setItem(k,'{bad json'),key);await page.reload();await ready();assert((await page.locator('#profile-status').innerText()).includes('읽지 못해'),'Malformed profile not handled');await capture('invalid-profile');
  await page.evaluate(k=>localStorage.setItem(k,JSON.stringify({mode:'2',resolution:'999',samples:'4',bounces:'1',advanced:false})),key);await page.reload();await ready();assert((await page.locator('#profile-status').innerText()).includes('형식'),'Unsupported saved values not rejected');
  await page.locator('#clear-profile').click();await page.reload();await ready();assert((await page.locator('#profile').innerText()).includes('시작 기본값'),'Clear did not restore default');
  await page.setViewportSize({width:390,height:844});await capture('mobile-layout');
  const blocked=await browser.newContext();const blockedPage=await blocked.newPage();await blockedPage.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('storage blocked');};});await blockedPage.goto(url);await blockedPage.waitForFunction(()=>document.querySelector('#status').textContent);assert((await blockedPage.locator('#profile-status').innerText()).includes('읽지 못해'),'Storage blocked fallback failed');await blocked.close();
  assert(!evidence.errors.length&&!evidence.failedResponses.length,'Browser errors');console.log(JSON.stringify({cases:evidence.cases.length,measurements:evidence.measurements.length,errors:evidence.errors,failedResponses:evidence.failedResponses}));
 }finally{fs.writeFileSync(path.join(__dirname,'task2-results.json'),JSON.stringify(evidence,null,2));if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
