/* 실습 1 완성본에서 출발한 실습 2: 황토와 흑요석의 행성.
 * 태양 접근은 적도의 건조 영역, 화산 퇴적은 두 지점의 유리질 흔적을 넓힌다.
 */
(() => {
'use strict';
const cv=document.querySelector('#cv'), gl=D.context(cv); if(!gl)return;
const VS=`#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uVP,uModel;
out vec3 vP,vN,vLocal; out vec2 vUV;
void main(){
 vec4 world=uModel*vec4(aPos,1.0);
 vP=world.xyz;vLocal=aPos;vUV=aUV;
 vN=mat3(transpose(inverse(uModel)))*aNormal;
 gl_Position=uVP*world;
}`;
const FS=`#version 300 es
precision highp float;
const float PI=3.14159265;
in vec3 vP,vN,vLocal; in vec2 vUV; out vec4 outColor;
uniform sampler2D uColor,uNormal,uARM,uEnv;
uniform vec3 uEye,uLight,uTint;
uniform float uRough,uMetal,uNormalStrength,uPower,uAmbient,uEnvPower;
uniform float uHeat,uDeposit;
uniform int uSun,uView,uBaseline;

vec3 srgbToLinear(vec3 c){
 return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));
}
vec3 linearToSrgb(vec3 c){
 return mix(12.92*c,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));
}

// 2단계: 미세면의 분포 D, 반사 비율 F, 가림 G를 계산한다.
vec3 directPBR(vec3 N,vec3 V,vec3 L,vec3 base,float rough,float metal){
 float nl=max(dot(N,L),0.0), nv=max(dot(N,V),0.0);
 if(nl<=0.0 || nv<=0.0) return vec3(0.0); // 등진 면의 직접광은 0
 vec3 H=normalize(V+L);
 float nh=max(dot(N,H),0.0), vh=max(dot(V,H),0.0);
 float a=rough*rough, a2=a*a;
 float den=nh*nh*(a2-1.0)+1.0;
 float D=a2/max(PI*den*den,1e-6); // GGX 법선 분포
 float k=(rough+1.0)*(rough+1.0)/8.0;
 float G=(nl/(nl*(1.0-k)+k))*(nv/(nv*(1.0-k)+k));
 vec3 F0=mix(vec3(0.04),base,metal);
 vec3 F=F0+(1.0-F0)*pow(1.0-vh,5.0); // Schlick Fresnel
 vec3 kd=(1.0-F)*(1.0-metal); // 정반사에 배분한 만큼 확산을 줄인다.
 return (kd*base/PI+D*G*F/max(4.0*nl*nv,1e-4))*nl*uPower;
}

// 로컬 위치로 계산해 자전해도 같은 표면에 무늬가 붙는다.
float dryRegion(vec3 local,float heat){
 float latitude=abs(normalize(local).y);
 float boundary=mix(0.08,0.85,heat);
 return heat*(1.0-smoothstep(boundary-0.06,boundary+0.06,latitude));
}
float volcanicRegion(vec3 local,float amount){
 vec3 p=normalize(local);
 float d1=distance(p,normalize(vec3(0.35,0.15,1.0)));
 float d2=distance(p,normalize(vec3(-0.5,-0.25,0.9)));
 float radius=0.08+0.55*amount;
 return amount*(1.0-smoothstep(radius-0.04,radius+0.04,min(d1,d2)));
}
void main(){
 if(uSun==1){outColor=vec4(1.0,0.65,0.22,1.0);return;} // 5주차처럼 광원 표시는 자체발광
 vec3 N=normalize(vN),V=normalize(uEye-vP),L=normalize(uLight-vP);
 vec3 base=uTint;
 // UV 위치의 색을 읽고 sRGB에서 선형으로 바꾼 뒤 색 배율을 곱한다.
 base = srgbToLinear(texture(uColor, vUV).rgb) * uTint;

 float rough=uRough,metal=uMetal,ao=1.0;
 // 3단계: ARM은 색이 아닌 수치 데이터다. 배율로 원본 값을 조절한다.
 vec3 arm=texture(uARM,vUV).rgb;
 ao=arm.r;
 rough=max(arm.g*uRough,0.045);
 metal=arm.b*uMetal;

 float dry=dryRegion(vLocal,uHeat);
 float volcanic=volcanicRegion(vLocal,uDeposit);
 // 진단 화면에는 조명·톤 매핑을 적용하지 않는다.
 if(uView==1){outColor=vec4(vec3(dry),1.0);return;}
 if(uView==2){outColor=vec4(vec3(volcanic),1.0);return;}
 base*=vec3(0.45,0.65,0.5); // 기본은 녹회색 암석
 if(uBaseline==0){
  base=mix(base,vec3(0.48,0.22,0.055),dry);
  rough=mix(rough,0.95,dry);
  base=mix(base,vec3(0.025,0.035,0.045),volcanic);
  rough=mix(rough,0.16,volcanic); // 뒤에 섞는 화산 유리질 흔적이 우선한다.
 }

 // 4단계: 화면 미분으로 접선 기저를 만들고 법선을 월드 공간으로 옮긴다.
 if(uNormalStrength>0.0){
  vec3 dp1=dFdx(vP), dp2=dFdy(vP);
  vec2 du1=dFdx(vUV), du2=dFdy(vUV);
  vec3 T=cross(dp2,N)*du1.x+cross(N,dp1)*du2.x;
  vec3 B=cross(dp2,N)*du1.y+cross(N,dp1)*du2.y;
  float inv=inversesqrt(max(max(dot(T,T),dot(B,B)),1e-8));
  vec3 mapN=texture(uNormal,vUV).xyz*2.0-1.0;
  mapN.xy*=uNormalStrength;
  N=normalize(mat3(T*inv,B*inv,N)*normalize(mapN));
 }

 // 2단계: Phong을 PBR로 교체하고 AO는 간접광에만 곱한다.
 float lightDistance=length(uLight-vP);
 float attenuation=1.0/(1.0+0.18*lightDistance*lightDistance);
 vec3 color=directPBR(N,V,L,base,rough,metal)*attenuation;
 vec3 F0=mix(vec3(0.04),base,metal);
 color+=uAmbient*ao*(base*(1.0-metal)*(1.0-F0)+F0);

 // 5단계: 반사 방향을 파노라마 UV로 바꾸고 roughness로 밉 레벨을 고른다.
 vec3 reflected=reflect(-V,N);
 vec2 envUV=vec2(atan(reflected.z,reflected.x)/(2.0*PI)+0.5,
                 asin(clamp(reflected.y,-1.0,1.0))/PI+0.5);
 vec3 envColor=srgbToLinear(textureLod(uEnv,envUV,rough*7.0).rgb);
 color+=uEnvPower*ao*envColor*F0;

 color=max(color,vec3(0.0));
 color=color/(1.0+color); // HDR → 표시 범위
 outColor=vec4(linearToSrgb(color),1.0);
}`;
const prog=D.program(gl,VS,FS),U=D.uniforms(gl,prog,[
 'uVP','uEye','uLight','uTint','uRough','uMetal','uNormalStrength','uPower','uAmbient','uEnvPower',
 'uColor','uNormal','uARM','uEnv','uModel','uHeat','uDeposit','uSun','uView','uBaseline'
]);
const mesh=D.upload(gl,D.revolution(D.profiles.sphere(1,48),96));
const assets={wood_planks:['Diffuse','nor_gl','arm'],rusty_metal_04:['Diffuse','nor_gl','arm'],rock_boulder_dry:['Diffuse','nor_gl','arm']};
const textures={},jobs=[];let failed=false;
function load(name){
 const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([128,128,255,255]));
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
 jobs.push(new Promise(resolve=>{const img=new Image();img.onload=()=>{
  gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
  gl.generateMipmap(gl.TEXTURE_2D);
  if(name.startsWith('studio'))gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); // 파노라마의 위아래 끝을 연결하지 않는다.
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  resolve();
 };img.onerror=()=>{failed=true;resolve();};
 img.src='assets/week06/'+name+(name.endsWith('_arm')?'.png':'.jpg');}));
 return tex;
}
for(const [asset,kinds] of Object.entries(assets))textures[asset]=kinds.map(kind=>load(asset+'_'+kind));
const envTex=load('studio_small_09_tonemapped');
Promise.all(jobs).then(()=>{document.querySelector('#status').textContent=failed?'텍스처 로딩 실패: HTTP 서버와 파일 경로 확인':'텍스처 로딩 완료 · 황토와 흑요석의 행성';});
document.querySelector('#ui').innerHTML='';
const S=D.UI('#ui',[
 {id:'heat',label:'태양 접근',min:0,max:100,step:1,value:50,hint:'태양에 가까워지며 적도부터 건조 영역이 넓어집니다.'},
 {id:'deposit',label:'화산 퇴적',min:0,max:100,step:1,value:50,hint:'두 지점의 매끈한 유리질 흔적이 넓어집니다.'},
 {id:'view',type:'select',label:'표시',value:'0',options:[{value:'0',label:'PBR 재질'},{value:'1',label:'건조 마스크'},{value:'2',label:'화산 마스크'}]},
 {id:'baseline',type:'check',label:'기본 표면과 비교',value:false,hint:'위치·빛·시점은 유지하고 두 재질 변화만 끕니다.'},
 {id:'rotate',type:'check',label:'행성 자전',value:true},
 {id:'normal',label:'normal 강도',min:0,max:5,step:.1,value:2},
 {id:'power',label:'태양빛 세기',min:0,max:30,step:.5,value:18},
 {id:'env',label:'환경맵 반사 세기',min:0,max:3,step:.1,value:.7},
]);

const cam=D.orbit(cv,{dist:9.5,pitch:.15});
document.querySelector('#reset').onclick=()=>{cam.dist=9.5;cam.yaw=0;cam.pitch=.15;};
const view=D.M4.create(),proj=D.M4.create(),vp=D.M4.create(),model=D.M4.create();
const sun=[-2,0,0];let spin=0;
document.querySelector('#note').textContent='자전을 끄고 각 조건을 0·50·100으로 비교하세요. 건조 영역은 거칠고, 화산 흔적은 매끈합니다. 겹치면 화산 흔적이 우선합니다.';
let visible=true;new IntersectionObserver(e=>visible=e[0].isIntersecting).observe(cv);
D.loop((time,dt)=>{
 if(!visible||document.hidden)return;
 if(S.rotate)spin+=Math.min(dt,0.1)*0.22;
 D.fit(cv);gl.viewport(0,0,cv.width,cv.height);D.clearColor(gl);gl.enable(gl.DEPTH_TEST);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
 const aspect=cv.width/cv.height;
 const eye=cam.eye([0.5,0,0]);D.M4.lookAt(view,eye,[0.5,0,0],[0,1,0]);
 // 세로 화면에서는 수직 FOV를 넓혀 두 천체를 함께 담는다.
 const fov=2.0*Math.atan(Math.tan(Math.PI/8)/Math.min(aspect,1));
 D.M4.perspective(proj,fov,aspect,.1,100);D.M4.multiply(vp,proj,view);
 gl.useProgram(prog);gl.uniformMatrix4fv(U.uVP,false,vp);gl.uniform3fv(U.uEye,eye);
 gl.uniform3fv(U.uLight,sun);gl.uniform3fv(U.uTint,[1,1,1]);
 for(const [key,value] of Object.entries({uRough:1,uMetal:1,uNormalStrength:S.normal,uPower:S.power,uAmbient:.12,uEnvPower:S.env,uHeat:S.heat/100,uDeposit:S.deposit/100}))gl.uniform1f(U[key],value);
 gl.uniform1i(U.uView,Number(S.view));gl.uniform1i(U.uBaseline,S.baseline?1:0);
 [...textures.rock_boulder_dry,envTex].forEach((tex,i)=>{
  gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.uniform1i(U[['uColor','uNormal','uARM','uEnv'][i]],i);
 });
 gl.bindVertexArray(mesh.vao);
 D.M4.identity(model);D.M4.translate(model,model,sun);D.M4.scale(model,model,[.45,.45,.45]);
 gl.uniformMatrix4fv(U.uModel,false,model);gl.uniform1i(U.uSun,1);
 gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0);
 D.M4.identity(model);D.M4.translate(model,model,[3-2*S.heat/100,0,0]);D.M4.rotateY(model,model,spin);
 gl.uniformMatrix4fv(U.uModel,false,model);gl.uniform1i(U.uSun,0);
 gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0);gl.bindVertexArray(null);
});
})();
