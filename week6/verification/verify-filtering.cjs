// 수업 d06-texture.html의 로컬 사본: 의존 파일 경로만 ../demo.*로 변경했다.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 try{res.setHeader('Content-Type',path.extname(file)==='.html'?'text/html; charset=utf-8':path.extname(file)==='.js'?'application/javascript':'text/css');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 const evidence={date:'2026-10-15',source:'https://cg.catholic.ac.kr/~mgchoi/CG/demos/d06-texture.html',browser:'Microsoft Edge headless / SwiftShader',viewport:[1440,1000],cases:[],errors:[]};
 try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',e=>{if(e.type()==='error')evidence.errors.push(e.text());});
  await page.addInitScript(()=>{
   const get=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){
    const gl=get.call(this,type,...args);if(type!=='webgl2'||!gl)return gl;let program;
    window.check={links:[],errors:[],frames:0};
    const link=gl.linkProgram.bind(gl);gl.linkProgram=p=>{link(p);window.check.links.push(gl.getProgramParameter(p,gl.LINK_STATUS));};
    const use=gl.useProgram.bind(gl);gl.useProgram=p=>{program=p;use(p);};
    const draw=gl.drawElements.bind(gl);gl.drawElements=(...a)=>{
     draw(...a);window.check.frames++;const error=gl.getError();if(error)window.check.errors.push(error);
     if(!window.captureNext)return;window.captureNext=false;
     const px=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,px);
     let hash=2166136261;for(let i=0;i<px.length;i+=16)for(let j=0;j<3;j++)hash=Math.imul(hash^px[i+j],16777619);
     const ext=gl.getExtension('EXT_texture_filter_anisotropic');
     window.frameResult={hash:hash>>>0,min:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER),mag:gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER),
      aniso:ext?gl.getTexParameter(gl.TEXTURE_2D,ext.TEXTURE_MAX_ANISOTROPY_EXT):1,maxAniso:ext?gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT):1,
      vp:Array.from(gl.getUniform(program,gl.getUniformLocation(program,'uVP'))),errors:[...window.check.errors],links:[...window.check.links]};
    };return gl;
   };
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/verification/d06-texture-reference.html');
  await page.waitForFunction(()=>window.check?.frames>2);
  const input=id=>page.locator('[data-id="'+id+'"] input');
  async function set(id,v){await input(id).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},v);}
  async function capture(name){await page.evaluate(()=>{window.frameResult=null;window.captureNext=true;});await page.waitForFunction(()=>window.frameResult);
   const result=await page.evaluate(()=>window.frameResult);await page.screenshot({path:path.join(root,'images','filter-'+name+'.png')});
   evidence.cases.push({name,...result});if(result.errors.length||result.links.some(v=>!v))throw Error('GL error');return result;
  }
  const hashes=[];
  for(const mode of ['NEAREST','LINEAR','LINEAR_MIPMAP_LINEAR']){await page.locator('[data-id="min"] select').selectOption(mode);hashes.push((await capture(mode.toLowerCase())).hash);}
  if(new Set(hashes).size!==3)throw Error('Filters did not change rendered pixels');
  await set('height',.5);await set('repeat',32);const low=await capture('aniso1');
  await set('aniso',Math.min(8,low.maxAniso));await capture('aniso8');
  await input('move').check();await page.waitForTimeout(300);const before=await capture('moving-before');await page.waitForTimeout(300);const after=await capture('moving-after');
  if(JSON.stringify(before.vp)===JSON.stringify(after.vp))throw Error('Camera did not move');
  await input('move').uncheck();
  if(evidence.errors.length)throw Error(evidence.errors.join('\n'));
  console.log(JSON.stringify({cases:evidence.cases.length,maxAniso:low.maxAniso,errors:evidence.errors}));
 }finally{fs.writeFileSync(path.join(__dirname,'filtering-results.json'),JSON.stringify(evidence,null,2));if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
