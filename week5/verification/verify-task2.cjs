// 동일한 화면에서 실제 키 입력으로 각 광원을 껐다 켜고 제출 캡처를 만든다.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'task2.html'), 'utf8');
const server = http.createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(html);
});

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true,
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
    await page.goto('http://127.0.0.1:'+server.address().port+'/task2.html');
    await page.waitForFunction(()=>gl.getProgramParameter(program,gl.LINK_STATUS));
    const evidence={date:'2026-10-08',browser:'Microsoft Edge headless / SwiftShader',
      viewport:[1440,1000],task2SHA256:crypto.createHash('sha256').update(html).digest('hex'),cases:[],errors};
    async function capture(name) {
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      const state=await page.evaluate(()=>{
        render();
        const pixels=new Uint8Array(canvas.width*canvas.height*4);
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]+pixels[i+1]+pixels[i+2];
        return {on:{...on},linked:gl.getProgramParameter(program,gl.LINK_STATUS),error:gl.getError(),
          pixelSum:sum,uniforms:{point:gl.getUniform(program,U.uOn1),directional:gl.getUniform(program,U.uOn2)},cam:{...cam}};
      });
      if(state.error)throw Error('WebGL error: '+name);
      await page.screenshot({path:path.join(root,'images','task2-'+name+'.png')});
      evidence.cases.push({name,...state});
      return state;
    }
    const final=await capture('final');
    await page.keyboard.press('1');
    const noPoint=await capture('point-off');
    if(noPoint.on.l1 || !noPoint.on.l2 || noPoint.uniforms.point!==false)throw Error('Point toggle failed');
    await page.keyboard.press('1');await page.keyboard.press('2');
    const noDirectional=await capture('directional-off');
    if(!noDirectional.on.l1 || noDirectional.on.l2 || noDirectional.uniforms.directional!==false)throw Error('Directional toggle failed');
    await page.keyboard.press('1');
    const ambient=await capture('both-off');
    if(ambient.on.l1 || ambient.on.l2)throw Error('Both-off failed');
    if(new Set([final.pixelSum,noPoint.pixelSum,noDirectional.pixelSum,ambient.pixelSum]).size!==4)throw Error('Light images did not change');
    await page.keyboard.press('1');await page.keyboard.press('2');
    await page.mouse.move(650,450);await page.mouse.down();await page.mouse.move(710,430,{steps:6});await page.mouse.up();
    await page.mouse.wheel(0,-120);
    await page.waitForFunction(()=>cam.dist!==11);
    evidence.camera=await page.evaluate(()=>({...cam,error:gl.getError()}));
    evidence.materials=await page.evaluate(()=>ROCKS);
    if(evidence.camera.yaw===0.2 || evidence.camera.error)throw Error('Camera check failed');
    if(errors.length)throw Error(errors.join('\n'));
    fs.writeFileSync(path.join(__dirname,'task2-results.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify(evidence,null,2));
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
