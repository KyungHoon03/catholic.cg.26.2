// 실제 task1.html에서 비교 조건만 바꾸어 Edge 실행 캡처를 만든다.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const finalHtml = fs.readFileSync(path.join(root, 'task1.html'), 'utf8');
const imageDir = path.join(root, 'images');
fs.mkdirSync(imageDir, { recursive: true });
const allowMaxExperiment = process.argv.includes('--max-experiment');

// 수업 원문 코드가 주석에도 있으므로, 줄 앞에 //가 없는 실행 코드만 바꾼다.
function replaceCode(html, before, after) {
  const escaped = before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('^([ \\t]*)' + escaped, 'm');
  if (!pattern.test(html)) throw new Error('비교할 실행 코드를 찾을 수 없음: ' + before);
  return html.replace(pattern, (_, indent) => indent + after);
}

function variant(name) {
  if (name === 'live') return finalHtml;
  let html = finalHtml.replace('const t = (performance.now() - startTime) / 1000;', 'const t = 2.0;');
  if (/^stage[0-3]$/.test(name) || name === 'max-removed') {
    const stage = name === 'max-removed' ? 1 : Number(name.slice(-1));
    html = replaceCode(html, 'vNormal = uNormalMat * aNormal;', 'vNormal = mat3(uModel) * aNormal;');
    const output = ['uBaseColor', 'diffuse', 'ambient + diffuse', 'ambient + diffuse + specular'][stage];
    html = replaceCode(html, 'fragColor = vec4(ambient + (diffuse + specular) * att, 1.0);', 'fragColor = vec4(' + output + ', 1.0);');
  }
  if (name === 'max-removed') html = replaceCode(html, 'float lambert = max(dot(N, L), 0.0);', 'float lambert = dot(N, L);');
  if (name === 'ambient0') html = replaceCode(html, 'vec3 ambient = 0.08 * uBaseColor;', 'vec3 ambient = 0.0 * uBaseColor;');
  if (name === 'ambient04') html = replaceCode(html, 'vec3 ambient = 0.08 * uBaseColor;', 'vec3 ambient = 0.4 * uBaseColor;');
  if (name.startsWith('normal-')) {
    html = replaceCode(html, 'm = Mat4.multiply(m, Mat4.scale(1.3, 1.3, 1.3));', 'm = Mat4.multiply(m, Mat4.scale(0.7, 2.2, 0.7));');
    if (name === 'normal-model') html = replaceCode(html, 'vNormal = uNormalMat * aNormal;', 'vNormal = mat3(uModel) * aNormal;');
  }
  if (name === 'near-light' || name === 'far-light') html = html.replace('const t = 2.0;', 'const t = 0.0;');
  if (name === 'near-light') html = html.replace('[Math.cos(t * 0.4) * 5.0, 3.6, Math.sin(t * 0.4) * 5.0]', '[0, 3.3, 0]');
  if (name === 'point-overhead' || name === 'spot') html = html.replace('[Math.cos(t * 0.4) * 5.0, 3.6, Math.sin(t * 0.4) * 5.0]', '[0, 6, 0]');
  return html;
}

const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').searchParams.get('case') || 'live';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(variant(name));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel:'msedge', headless:true,
    args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const context = await browser.newContext({viewport:{width:1440,height:1000}, deviceScaleFactor:1});
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console', e=>{if(e.type()==='error') errors.push(e.text());});
  const evidence={date:'2026-10-08',browser:'Microsoft Edge headless / SwiftShader',viewport:[1440,1000],fixedTime:2,cases:[],errors};
  const base = 'http://127.0.0.1:' + server.address().port;
  async function open(name, key) {
    await page.goto(base + '/?case=' + name);
    await page.waitForFunction(()=>typeof gl !== 'undefined' && gl.getProgramParameter(program,gl.LINK_STATUS));
    if(key) await page.keyboard.press(key);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  async function capture(name, file, key) {
    await open(name,key);
    const state = await page.evaluate(()=>{
      render();
      const pixels=new Uint8Array(canvas.width*canvas.height*4);
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let total=0;for(let i=0;i<pixels.length;i+=4)total+=pixels[i]+pixels[i+1]+pixels[i+2];
      return {linked:gl.getProgramParameter(program,gl.LINK_STATUS),webglError:gl.getError(),lightType,cam:{...cam},pixelSum:total};
    });
    if(state.webglError!==0)throw Error('WebGL error '+name);
    await page.screenshot({path:path.join(imageDir,file+'.png')});
    evidence.cases.push({name,file:'images/'+file+'.png',fixedTime:(name==='near-light'||name==='far-light')?0:2,...state});
    return state;
  }
  if(process.argv.includes('--max-only')) {
    const withMax=await capture('stage1','task1-stage1');
    const withoutMax=await capture('max-removed','task1-max-removed');
    const comparison={pixelSumWithMax:withMax.pixelSum,pixelSumWithoutMax:withoutMax.pixelSum,
      screenshotBytesEqual:fs.readFileSync(path.join(imageDir,'task1-stage1.png')).equals(
        fs.readFileSync(path.join(imageDir,'task1-max-removed.png')))};
    const previous=JSON.parse(fs.readFileSync(path.join(__dirname,'results.json'),'utf8'));
    previous.cases=previous.cases.filter(x=>!evidence.cases.some(y=>x.file===y.file)).concat(evidence.cases);
    previous.maxComparison=comparison;
    previous.errors.push(...errors);
    if(errors.length)throw Error(errors.join('\n'));
    fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(previous,null,2));
    console.log(JSON.stringify({cases:evidence.cases,comparison,errors},null,2));
    await browser.close();server.close();return;
  }
  if(process.argv.includes('--additional')) {
    await capture('far-light','task1-far-light');
    await capture('near-light','task1-near-light');
    if(allowMaxExperiment)await capture('max-removed','task1-max-removed');
    const previous=JSON.parse(fs.readFileSync(path.join(__dirname,'results.json'),'utf8'));
    previous.cases=previous.cases.filter(x=>!evidence.cases.some(y=>x.file===y.file)).concat(evidence.cases);
    previous.errors.push(...errors);
    fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(previous,null,2));
    console.log(JSON.stringify(evidence,null,2));
    await browser.close();server.close();return;
  }
  await capture('stage0','task1-stage0');
  for(let i=1;i<=4;i++)await capture('stage'+i,'task1-stage'+i);
  if(allowMaxExperiment)await capture('max-removed','task1-max-removed');
  await capture('ambient0','task1-ambient0');
  await capture('ambient04','task1-ambient04');
  await capture('normal-model','task1-normal-model');
  await capture('normal-correct','task1-normal-correct');
  await capture('stage4','task1-point');
  await capture('stage4','task1-directional','2');
  await capture('point-overhead','task1-point-overhead');
  await capture('spot','task1-spot','3');
  await capture('far-light','task1-far-light');
  await capture('near-light','task1-near-light');
  await open('stage4');
  await page.screenshot({path:path.join(imageDir,'task1-view-before.png')});
  const cameraBefore=await page.evaluate(()=>({...cam}));
  await page.mouse.move(650,450);await page.mouse.down();await page.mouse.move(760,430,{steps:8});await page.mouse.up();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  await page.screenshot({path:path.join(imageDir,'task1-view-after.png')});
  const cameraAfter=await page.evaluate(()=>({...cam}));
  await page.mouse.wheel(0,-160);
  await page.waitForFunction(before=>cam.dist!==before,cameraAfter.dist);
  evidence.camera={before:cameraBefore,after:cameraAfter,zoom:await page.evaluate(()=>cam.dist)};
  evidence.normalMatrix=await page.evaluate(()=>{
    const m=Mat4.multiply(Mat4.rotateY(0.6),Mat4.scale(0.7,2.2,0.7));
    const n=Mat4.normalFromMat4(m);
    const tangent=[m[0],m[1],m[2]];
    const normal=[n[6],n[7],n[8]];
    return {dot:tangent.reduce((s,v,i)=>s+v*normal[i],0),matrix:Array.from(n)};
  });
  if(Math.abs(evidence.normalMatrix.dot)>1e-6)throw Error('Normal is not perpendicular');
  await open('live');
  const a=await page.evaluate(()=>{render();return Array.from(gl.getUniform(program,U.uLightPos));});
  await page.waitForTimeout(450);
  const b=await page.evaluate(()=>{render();return Array.from(gl.getUniform(program,U.uLightPos));});
  evidence.animation={before:a,after:b,changed:a.some((v,i)=>v!==b[i])};
  if(!evidence.animation.changed)throw Error('Light does not animate');
  for(const [key,type] of [['2',1],['3',2],['1',0]]) {
    await page.keyboard.press(key);
    await page.waitForFunction(type=>lightType===type,type);
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  evidence.mobile=await page.evaluate(()=>({width:canvas.width,height:canvas.height,error:gl.getError()}));
  await page.screenshot({path:path.join(imageDir,'task1-mobile.png')});
  if(errors.length)throw Error(errors.join('\n'));
  fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
  await browser.close();server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1);});
