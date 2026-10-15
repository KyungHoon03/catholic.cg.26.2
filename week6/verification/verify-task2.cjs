// 실습 2 원본을 HTTP 실행하고 두 조건·마스크·비교·자전을 검사한다.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 const evidence={date:'2026-10-15',browser:'Microsoft Edge headless / SwiftShader',viewport:[1440,1000],
  sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'task2.js'))).digest('hex'),cases:[],errors:[],failedResponses:[]};
 try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',e=>{if(e.type()==='error')evidence.errors.push(e.text());});
  page.on('response',r=>{if(r.status()>=400)evidence.failedResponses.push(r.url());});
  await page.addInitScript(()=>{
   const get=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){
    const gl=get.call(this,type,...args);if(type!=='webgl2'||!gl)return gl;let program;
    window.check={links:[],errors:[],frames:0};
    const link=gl.linkProgram.bind(gl);gl.linkProgram=p=>{link(p);window.check.links.push(gl.getProgramParameter(p,gl.LINK_STATUS));};
    const use=gl.useProgram.bind(gl);gl.useProgram=p=>{program=p;use(p);};
    const draw=gl.drawElements.bind(gl);gl.drawElements=(...a)=>{
     draw(...a);const error=gl.getError();if(error)window.check.errors.push(error);
     const uniform=name=>gl.getUniform(program,gl.getUniformLocation(program,name));
     if(uniform('uSun')===1)return;window.check.frames++;
     if(!window.captureNext)return;window.captureNext=false;
     const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
     gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
     let hash=2166136261,grayCount=0,graySum=0;
     for(let i=0;i<pixels.length;i+=16){for(let j=0;j<3;j++)hash=Math.imul(hash^pixels[i+j],16777619);
      if(pixels[i]===pixels[i+1]&&pixels[i]===pixels[i+2]){grayCount++;graySum+=pixels[i];}}
     window.frameResult={hash:hash>>>0,grayCount,grayMean:grayCount?graySum/grayCount:0,
      heat:uniform('uHeat'),deposit:uniform('uDeposit'),view:uniform('uView'),baseline:uniform('uBaseline'),
      model:Array.from(uniform('uModel')),eye:Array.from(uniform('uEye')),links:[...window.check.links],errors:[...window.check.errors]};
    };return gl;
   };
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/task2.html');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('로딩 완료')&&window.check.frames>2);
  const input=id=>page.locator('[data-id="'+id+'"] input');
  async function set(id,v){await input(id).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},v);}
  async function mode(v){await page.locator('[data-id="view"] select').selectOption(String(v));}
  async function capture(name){await page.evaluate(()=>{window.frameResult=null;window.captureNext=true;});await page.waitForFunction(()=>window.frameResult);
   const state=await page.evaluate(()=>window.frameResult);await page.screenshot({path:path.join(root,'images','task2-'+name+'.png')});
   evidence.cases.push({name,...state});if(state.errors.length||state.links.some(v=>!v))throw Error(name+' GL failure');return state;}
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  await input('rotate').uncheck();await set('deposit',0);
  const dryMeans=[];
  for(const v of [0,50,100]){await set('heat',v);await mode(0);await capture('heat'+v);await mode(1);dryMeans.push((await capture('dry-mask'+v)).grayMean);}
  assert(dryMeans[0]<dryMeans[1]&&dryMeans[1]<dryMeans[2],'Dry mask not growing');
  await set('heat',50);await mode(1);const dryBefore=await capture('dry-independent-before');
  await set('deposit',100);const dryAfter=await capture('dry-independent-after');assert(dryBefore.hash===dryAfter.hash,'Second condition changed dry mask');
  const volcanicMeans=[];
  for(const v of [0,50,100]){await set('deposit',v);await mode(0);await capture('deposit'+v);await mode(2);volcanicMeans.push((await capture('volcanic-mask'+v)).grayMean);}
  assert(volcanicMeans[0]<volcanicMeans[1]&&volcanicMeans[1]<volcanicMeans[2],'Volcanic mask not growing');
  await set('heat',100);await set('deposit',100);await mode(0);const changed=await capture('changed');
  await input('baseline').check();const base=await capture('baseline');
  assert(changed.hash!==base.hash,'Surface comparison unchanged');assert(JSON.stringify(changed.model)===JSON.stringify(base.model),'Baseline moved planet');assert(JSON.stringify(changed.eye)===JSON.stringify(base.eye),'Baseline moved eye');
  await input('baseline').uncheck();await set('normal',0);const normal0=await capture('normal0');await set('normal',2);const normal2=await capture('normal2');assert(normal0.hash!==normal2.hash,'Normal map unchanged');
  await set('power',30);await capture('light30');await set('power',4);await capture('light4');await set('power',18);
  await input('rotate').check();await page.waitForTimeout(350);const rotating=await capture('rotating');await page.waitForTimeout(350);const rotated=await capture('rotated');assert(JSON.stringify(rotating.model)!==JSON.stringify(rotated.model),'Rotation stopped');
  await input('rotate').uncheck();const stopped=await capture('stopped');await page.waitForTimeout(200);const stoppedAgain=await capture('stopped-again');assert(JSON.stringify(stopped.model)===JSON.stringify(stoppedAgain.model),'Rotation pause failed');
  await page.setViewportSize({width:390,height:844});await capture('mobile');
  assert(!evidence.errors.length&&!evidence.failedResponses.length,'Browser loading or JavaScript errors');
  console.log(JSON.stringify({cases:evidence.cases.length,dryMeans,volcanicMeans,errors:evidence.errors,failedResponses:evidence.failedResponses}));
 }finally{fs.writeFileSync(path.join(__dirname,'task2-results.json'),JSON.stringify(evidence,null,2));if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
