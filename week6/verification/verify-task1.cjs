// 최종 파일과 같은 시점에서 단계별 셰이더·슬라이더 결과를 실제 실행한다.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'task1.js'),'utf8');
let stage=5;
function stageSource(){
 let code=source;
 if(stage<5)code=code.replace(/ \/\/ 5단계:[\s\S]*?(?= color=max)/,'');
 if(stage<4)code=code.replace(/ \/\/ 4단계:[\s\S]*?(?= \/\/ 2단계: Phong)/,'');
 if(stage<3)code=code.replace(/ \/\/ 3단계:[\s\S]*?(?= \/\/ [24]단계:)/,'');
 return code.replace('텍스처 로딩 완료 · 1~5단계 구현','텍스처 로딩 완료 · 비교 '+stage+'단계');
}
const server=http.createServer((req,res)=>{
 if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{
  const data=file.endsWith('task1.js')?stageSource():fs.readFileSync(file);
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
  res.setHeader('Cache-Control','no-store');res.end(data);
 }catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 const evidence={date:'2026-10-15',browser:'Microsoft Edge headless / SwiftShader',viewport:[1440,1000],
  task1SHA256:crypto.createHash('sha256').update(source).digest('hex'),cases:[],errors:[],failedResponses:[]};
 try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>evidence.errors.push(e.message));
  page.on('console',e=>{if(e.type()==='error')evidence.errors.push(e.text());});
  page.on('response',r=>{if(r.status()>=400)evidence.failedResponses.push(r.url());});
  await page.addInitScript(()=>{
   const get=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){
    const gl=get.call(this,type,...args);if(type!=='webgl2'||!gl)return gl;
    window.check={links:[],errors:[],frames:0};let program;
    const use=gl.useProgram.bind(gl);gl.useProgram=p=>{program=p;use(p);};
    const link=gl.linkProgram.bind(gl);gl.linkProgram=p=>{link(p);window.check.links.push(gl.getProgramParameter(p,gl.LINK_STATUS));};
    const draw=gl.drawElements.bind(gl);gl.drawElements=(...a)=>{
     draw(...a);window.check.frames++;const error=gl.getError();if(error)window.check.errors.push(error);
     if(!window.captureNext)return;window.captureNext=false;
     const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
     gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
     let hash=2166136261;for(let i=0;i<pixels.length;i+=16)for(let j=0;j<3;j++)hash=Math.imul(hash^pixels[i+j],16777619);
     const uniforms={};for(const name of ['uRough','uMetal','uNormalStrength','uPower','uAmbient','uEnvPower','uEye']){
      const loc=gl.getUniformLocation(program,name);uniforms[name]=loc?Array.from([gl.getUniform(program,loc)]).flatMap(x=>ArrayBuffer.isView(x)?Array.from(x):x):null;
     }
     window.frameResult={hash:hash>>>0,uniforms,links:[...window.check.links],errors:[...window.check.errors]};
    };return gl;
   };
  });
  const url='http://127.0.0.1:'+server.address().port+'/task1.html';
  async function load(){await page.goto(url);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('로딩 완료')&&window.check.frames>2);}
  async function set(id,value){await page.locator('[data-id="'+id+'"] input').evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);}
  async function capture(name){
   await page.evaluate(()=>{window.frameResult=null;window.captureNext=true;});await page.waitForFunction(()=>window.frameResult);
   const state=await page.evaluate(()=>window.frameResult);await page.screenshot({path:path.join(root,'images','task1-'+name+'.png')});
   evidence.cases.push({name,stage,...state});if(state.errors.length||state.links.some(v=>!v))throw Error(name+' GL failure');return state;
  }
  function different(a,b){if(a.hash===b.hash)throw Error('Same rendered pixels: '+a.name+' / '+b.name);}
  for(stage=2;stage<=5;stage++){await load();await capture('stage'+stage);}
  stage=5;await load();
  await set('normal',0);const normal0=await capture('normal0');await set('normal',5);const normal5=await capture('normal5');different(normal0,normal5);
  await set('normal',0);await set('env',0);await set('ambient',0);await set('rough',.15);const smooth=await capture('rough015');await set('rough',1);const rough=await capture('rough1');different(smooth,rough);
  await set('metal',0);const dielectric=await capture('metal0');await set('metal',1);const metal=await capture('metal1');different(dielectric,metal);
  await set('power',0);await set('env',0);const dark=await capture('all-off');await set('env',2);const env=await capture('environment-only');different(dark,env);
  await set('env',0);await set('ambient',.5);const ambient=await capture('ambient-only');different(dark,ambient);different(env,ambient);
  await load();for(const material of ['wood_planks','rock_boulder_dry','rusty_metal_04']){await page.locator('#ui select').selectOption(material);await capture(material);}
  await page.mouse.move(600,450);await page.mouse.down();await page.mouse.move(680,490,{steps:5});await page.mouse.up();await page.mouse.wheel(0,-120);await capture('camera-moved');
  if(evidence.errors.length||evidence.failedResponses.length)throw Error('Browser errors');
  console.log(JSON.stringify({cases:evidence.cases.length,errors:evidence.errors,failedResponses:evidence.failedResponses,hashes:evidence.cases.map(x=>[x.name,x.hash])}));
 }finally{
  fs.writeFileSync(path.join(__dirname,'task1-results.json'),JSON.stringify(evidence,null,2));
  if(browser)await browser.close();await new Promise(r=>server.close(r));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
