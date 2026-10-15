// 최종 파일을 HTTP 실행한다. 단계 0~2는 응답 사본에서 미구현 함수를 재현한다.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'task1.js'),'utf8');
let stage=3;
function stagedSource(){
 let code=source;
 if(stage<3)code=code.replace(/vec3 shade\(vec3 ro,vec3 rd,float t,int id\)\{[\s\S]*?\n  \}/,'vec3 shade(vec3 ro,vec3 rd,float t,int id){return surfaceColor(id,ro+t*rd);\n  }');
 if(stage<2)code=code.replace(/float hitSphere\(vec3 ro,vec3 rd,vec3 center,float radius\)\{[\s\S]*?\n  \}/,'float hitSphere(vec3 ro,vec3 rd,vec3 center,float radius){return -1.0;\n  }');
 if(stage<1)code=code.replace(/vec3 cameraRay\(vec2 pixel,vec3 eye\)\{[\s\S]*?\n  \}/,'vec3 cameraRay(vec2 pixel,vec3 eye){return vec3(0.0,0.0,-1.0);\n  }');
 return code;
}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const file=path.resolve(root,'.'+url.pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(file===path.join(root,'task1.js')?stagedSource():fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
const evidence={date:'2026-10-15',browser:'Microsoft Edge headless / SwiftShader',viewport:[1440,1000],sha256:crypto.createHash('sha256').update(source).digest('hex'),cases:[],errors:[],failedResponses:[]};
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>a.map(v=>v/Math.hypot(...a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
// 실제 uniform과 같은 카메라 광선으로 비교 픽셀의 가장 앞 물체를 찾는다.
function objectStats(frame){
 const forward=norm(sub([0,0,-1.8],frame.eye)),right=norm(cross(forward,[0,1,0])),up=cross(right,forward);
 const objects=Array.from({length:5},()=>({count:0,sum:0}));
 for(const [x,y,r,g,b] of frame.samples){
  const uv=[(2*(x+.5)-frame.width)/frame.height,(2*(y+.5)-frame.height)/frame.height];
  const rd=norm(forward.map((v,i)=>1.7*v+uv[0]*right[i]+uv[1]*up[i]));
  let nearest=1e20,id=-1;
  for(let i=0;i<3;i++){
   const body=frame.bodies.slice(i*4,i*4+4),oc=sub(frame.eye,body),halfB=dot(oc,rd),disc=halfB*halfB-dot(oc,oc)+body[3]*body[3];
   if(disc<0)continue;let t=-halfB-Math.sqrt(disc);if(t<=.002)t=-halfB+Math.sqrt(disc);
   if(t>.002&&t<nearest){nearest=t;id=i;}
  }
  for(const wall of [3,4]){
   const axis=wall===3?1:2,plane=wall===3?-1.12:-4.5;
   if(Math.abs(rd[axis])<=.0001)continue;
   const t=(plane-frame.eye[axis])/rd[axis],p=frame.eye.map((v,i)=>v+t*rd[i]);
   const inside=Math.abs(p[0])<3&&(wall===3?p[2]>-4.5&&p[2]<.8:p[1]>-1.12&&p[1]<1.85);
   if(t>.002&&t<nearest&&inside){nearest=t;id=wall;}
  }
  if(id>=0){objects[id].count++;objects[id].sum+=(r+g+b)/3;}
 }
 return objects.map(o=>({count:o.count,mean:o.count?o.sum/o.count:0}));
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',e=>{if(e.type()==='error')evidence.errors.push(e.text());});
  page.on('response',r=>{if(r.status()>=400)evidence.failedResponses.push(r.url());});
  await page.addInitScript(()=>{
   const get=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){
    const gl=get.call(this,type,...args);if(type!=='webgl2'||!gl)return gl;
    window.check={links:[],errors:[],frames:0};let program;
    const link=gl.linkProgram.bind(gl);gl.linkProgram=p=>{link(p);window.check.links.push({ok:gl.getProgramParameter(p,gl.LINK_STATUS),log:gl.getProgramInfoLog(p)});};
    const use=gl.useProgram.bind(gl);gl.useProgram=p=>{program=p;use(p);};
    const draw=gl.drawArrays.bind(gl);gl.drawArrays=(...a)=>{
     draw(...a);const error=gl.getError();if(error)window.check.errors.push(error);
     const uniform=name=>{const location=gl.getUniformLocation(program,name);return location===null?null:gl.getUniform(program,location);};
     const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
     const samples=[];let hash=2166136261;
     for(let y=0;y<h;y+=4)for(let x=0;x<w;x+=4){const i=(y*w+x)*4;samples.push([x,y,pixels[i],pixels[i+1],pixels[i+2]]);for(let j=0;j<3;j++)hash=Math.imul(hash^pixels[i+j],16777619);}
     window.check.frames++;
     const bodies=[0,1,2].flatMap(i=>Array.from(uniform('uBodies['+i+']')||[0,0,0,0]));
     window.frame={hash:hash>>>0,samples,width:w,height:h,eye:Array.from(uniform('uEye')||[0,0,0]),bodies,shadow:uniform('uShadow'),frames:window.check.frames,links:window.check.links,errors:window.check.errors};
    };return gl;
   };
  });
  async function capture(name){
   await page.waitForFunction(()=>window.frame&&document.querySelector('#status').textContent);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const f=await page.evaluate(()=>window.frame);assert(f.links.every(l=>l.ok)&&!f.errors.length,name+' WebGL error');
   await page.screenshot({path:path.join(root,'images',name+'.png')});
   const {samples,...rest}=f;const result={name,stage,...rest,objects:objectStats(f)};evidence.cases.push(result);return result;
  }
  const url='http://127.0.0.1:'+server.address().port+'/task1.html';
  for(stage=0;stage<=3;stage++){await page.goto(url);await capture('task1-stage'+stage);}
  stage=3;
  const shadow=page.locator('[data-id="shadow"] input');
  await page.locator('#solar').click();const solarOn=await capture('task1-solar-on');
  await shadow.uncheck();const solarOff=await capture('task1-solar-off');
  assert(solarOn.hash!==solarOff.hash,'Solar shadow did not change pixels');
  assert(solarOn.objects[1].mean<solarOff.objects[1].mean,'Planet did not darken in solar eclipse');
  await page.locator('#lunar').click();const lunarOff=await capture('task1-lunar-off');
  await shadow.check();const lunarOn=await capture('task1-lunar-on');
  assert(lunarOn.objects[2].count>0&&lunarOn.objects[2].mean<lunarOff.objects[2].mean,'Moon did not darken in lunar eclipse');
  for(const pair of [[solarOn,solarOff],[lunarOn,lunarOff]]){
   assert(JSON.stringify(pair[0].eye)===JSON.stringify(pair[1].eye)&&JSON.stringify(pair[0].bodies)===JSON.stringify(pair[1].bodies),'Shadow comparison moved scene');
   assert(pair[0].objects[0].mean===pair[1].objects[0].mean,'Star emission changed with shadows');
  }
  await page.locator('#play').click();await page.waitForTimeout(350);const moving=await capture('task1-orbit-before');await page.waitForTimeout(350);const moved=await capture('task1-orbit-after');
  assert(JSON.stringify(moving.bodies)!==JSON.stringify(moved.bodies),'Orbit did not move');
  await page.locator('#play').click();const stopped=await capture('task1-orbit-paused');await page.waitForTimeout(200);
  assert(JSON.stringify(stopped.bodies)===JSON.stringify((await page.evaluate(()=>window.frame)).bodies),'Pause failed');
  const canvas=await page.locator('#cv').boundingBox();
  await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width/2+80,canvas.y+canvas.height/2+40,{steps:5});await page.mouse.up();
  const dragged=await capture('task1-camera-drag');assert(JSON.stringify(stopped.eye)!==JSON.stringify(dragged.eye),'Camera drag failed');
  await page.mouse.wheel(0,-120);await page.waitForTimeout(150);const zoom=await capture('task1-camera-zoom');assert(JSON.stringify(dragged.eye)!==JSON.stringify(zoom.eye),'Wheel failed');
  await page.locator('#solar').click();await page.setViewportSize({width:390,height:844});await capture('task1-mobile');
  assert(!evidence.errors.length&&!evidence.failedResponses.length,'Browser errors');
  console.log(JSON.stringify({cases:evidence.cases.length,solarPlanet:[solarOn.objects[1],solarOff.objects[1]],lunarMoon:[lunarOn.objects[2],lunarOff.objects[2]],errors:evidence.errors,failedResponses:evidence.failedResponses}));
 }finally{fs.writeFileSync(path.join(__dirname,'task1-results.json'),JSON.stringify(evidence,null,2));if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
