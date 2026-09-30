// Run with NODE_PATH pointing to an installed Playwright package directory.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const results = { date: new Date().toISOString(), method: 'Automated browser checks; not student observation times', checks: [], baseline: [], improved: [], errors: [], resourceWarnings: [] };
const base = 'http://127.0.0.1:8000/week4/';
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a => a.map(v=>v/Math.hypot(...a));
(async()=>{
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
    page.on('pageerror',e=>results.errors.push(e.message));
    page.on('console',msg=>{
      if(msg.type()!=='error')return;
      const entry={message:msg.text(),url:msg.location().url};
      if(entry.url.endsWith('/favicon.ico'))results.resourceWarnings.push(entry);
      else results.errors.push(entry);
    });
    const settle = ()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const shot = async name=>{await settle();await page.screenshot({path:path.join(root,'images',name+'.png'),fullPage:true});};
    const state = ()=>page.evaluate(()=>({ ...InspectionViewer.controls.state, camera:InspectionViewer.controls.camera() }));
    const check = (name,ok)=>{assert.ok(ok,name);results.checks.push(name);};
    await page.goto(base+'baseline/?theme=light');
    await page.waitForFunction(()=>window.InspectionViewer&&document.querySelector('#cv').width>100);
    await shot('baseline-overview');
    const tasks = await page.evaluate(()=>InspectionViewer.model.tasks.map(t=>({id:t.id,position:t.position})));
    // These source-informed UI trials are diagnostics, not naive user observations.
    for(const task of tasks){
      await page.locator('#home').click();
      const s=await state();
      const bounds=await page.locator('#cv').boundingBox();
      const z=norm(s.camera.eye.map((v,i)=>v-s.target[i]));
      const right=norm(cross(s.camera.up,z));
      const up=norm(cross(z,right));
      const delta=task.position.map((v,i)=>v-s.target[i]);
      const unit=2*s.distance*Math.tan(s.fov*Math.PI/360)/bounds.height;
      const start={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
      const dx=-dot(delta,right)/unit,dy=dot(delta,up)/unit;
      await page.mouse.move(start.x,start.y);
      await page.mouse.down({button:'right'});
      await page.mouse.move(start.x+dx,start.y+dy,{steps:12});
      await page.mouse.up({button:'right'});
      await page.mouse.move(start.x,start.y);
      const desired=Math.max(.5,dot(delta,z)+(task.id.startsWith('O')?7:3));
      await page.mouse.wheel(0,Math.log(desired/30)/.001);
      await page.waitForTimeout(150);
      await shot('baseline-'+task.id.toLowerCase());
      results.baseline.push({id:task.id,state:await state(),method:'Home, source-informed right-drag, wheel; no claim of unaided completion'});
    }
    await page.locator('#home').click();
    let bounds=await page.locator('#cv').boundingBox();
    await page.mouse.move(bounds.x+bounds.width*.72,bounds.y+bounds.height*.25);
    await page.mouse.down();
    await page.mouse.move(bounds.x+bounds.width*.35,bounds.y+bounds.height*.65,{steps:15});
    await page.mouse.up();
    await shot('baseline-tilted');
    await page.goto(base+'improved/?theme=light');
    await page.waitForFunction(()=>window.InspectionViewer&&document.querySelectorAll('#student-ui button').length===9);
    const home=await state();
    await shot('improved-overview');
    for(const task of tasks){
      await page.locator('#home').click();
      await page.locator('#measure').click();
      await page.getByRole('button',{name:new RegExp('^'+task.id+' ')}).click();
      await settle();
      const s=await state();
      check(task.id+' target matches provided model',s.target.every((v,i)=>Math.abs(v-task.position[i])<1e-6));
      check(task.id+' additional click counted',s.actions===1);
      check(task.id+' finite camera',s.camera.eye.every(Number.isFinite));
      await shot('improved-'+task.id.toLowerCase());
      results.improved.push({id:task.id,state:s});
    }
    const orthoBefore=await state();
    await page.locator('#cv').focus();
    await page.keyboard.press('ArrowLeft');
    check('Orthographic direction remains aligned',JSON.stringify((await state()).rotation)===JSON.stringify(orthoBefore.rotation));
    await page.keyboard.press('Home');
    check('Home key restores distance and target',(await state()).distance===30&&JSON.stringify((await state()).target)===JSON.stringify(home.target));
    await page.getByRole('button',{name:/^P3 /}).click();
    bounds=await page.locator('#cv').boundingBox();
    await page.mouse.move(bounds.x+bounds.width*.70,bounds.y+bounds.height*.3);
    await page.mouse.down();
    await page.mouse.move(bounds.x+bounds.width*.4,bounds.y+bounds.height*.65,{steps:12});
    await page.mouse.up();
    const tilted=await state();
    await shot('improved-before-straighten');
    await page.getByRole('button',{name:'화면 바로 세우기'}).click();
    const straight=await state();
    check('Straighten preserves eye',straight.camera.eye.every((v,i)=>Math.abs(v-tilted.camera.eye[i])<1e-6));
    check('Straighten preserves target',JSON.stringify(straight.target)===JSON.stringify(tilted.target));
    const back=norm(straight.camera.eye.map((v,i)=>v-straight.target[i]));
    const expectedUp=norm(cross(back,norm(cross([0,1,0],back))));
    check('Straighten aligns projected world up',dot(straight.camera.up,expectedUp)>.99999);
    await shot('improved-after-straighten');
    await page.locator('#home').click();
    await shot('improved-return-p3');
    check('Overview marker visible',await page.locator('#target-marker').isVisible());
    await page.getByRole('button',{name:/^P3 /}).click();
    await shot('revision-after-p3');
    const finalDistance=(await state()).distance;
    await page.evaluate(()=>{InspectionViewer.controls.state.distance=3;});
    await shot('revision-distance3-p3');
    await page.evaluate(distance=>{InspectionViewer.controls.state.distance=distance;},finalDistance);
    const selected=await state();
    await page.locator('#cv').focus();
    await page.keyboard.press('ArrowLeft');
    check('Manual rotation works after point selection',JSON.stringify((await state()).rotation)!==JSON.stringify(selected.rotation));
    await page.keyboard.press('+');
    check('Manual zoom works after point selection',(await state()).distance<selected.distance);
    const pixels=await page.evaluate(()=>{
      const v=InspectionViewer;v.render();const data=new Uint8Array(v.canvas.width*v.canvas.height*4);
      v.gl.readPixels(0,0,v.canvas.width,v.canvas.height,v.gl.RGBA,v.gl.UNSIGNED_BYTE,data);
      const colors=new Set();for(let i=0;i<data.length;i+=4*997)colors.add(data.slice(i,i+3).join(','));
      return {colors:colors.size,error:v.gl.getError()};
    });
    check('WebGL canvas nonblank',pixels.colors>8);
    check('No WebGL errors',pixels.error===0);
    await page.setViewportSize({width:390,height:844});
    for(const id of ['P1','P3','O1','O2']){
      await page.getByRole('button',{name:new RegExp('^'+id+' ')}).click();
      await page.evaluate(()=>scrollTo(0,0));
      await shot('mobile-'+id.toLowerCase());
      check('Mobile '+id+' no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      check('Mobile '+id+' canvas nonblank',await page.evaluate(()=>{
        const v=InspectionViewer;v.render();const data=new Uint8Array(v.canvas.width*v.canvas.height*4);
        v.gl.readPixels(0,0,v.canvas.width,v.canvas.height,v.gl.RGBA,v.gl.UNSIGNED_BYTE,data);
        const colors=new Set();for(let i=0;i<data.length;i+=4*331)colors.add(data.slice(i,i+3).join(','));
        return colors.size>8&&v.gl.getError()===0;
      }));
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(base+'verification/sketches.html');
    for(const id of ['a','b'])await page.locator('#sketch-'+id).screenshot({path:path.join(root,'images','sketch-'+id+'.png')});
    check('No browser JavaScript or console errors',results.errors.length===0);
  } finally {
    fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(results,null,2));
    await browser.close();
  }
  console.log(JSON.stringify({checks:results.checks.length,errors:results.errors}));
})().catch(e=>{console.error(e);process.exitCode=1;});
