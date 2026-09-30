/* 학생 확장 시작점. 여기에 본인이 설계한 관찰 인터페이스를 구현하세요.
   제공 기준 버전은 이 파일을 비워 둔 상태입니다.

   const viewer = window.InspectionViewer;
   viewer.controls.state: target, distance, rotation(쿼터니언), fov
   viewer.controls.camera(): 현재 eye/target/up
   viewer.controls.home(): 기본 카메라로 복귀
   viewer.model.poi: 주요 지점의 id/name/position/size/yaw/group
   viewer.model.comparisons: O1/O2 비교 대상 members와 관찰 방향 viewDirection
   viewer.model.tasks: 표지 관찰 6건 + 직교 비교 2건
   viewer.hidden: 일시적으로 숨길 id 또는 group을 담는 Set
   viewer.drawView({eye,target,up,fov,orthographic,halfHeight}, [x,y,w,h])
     : viewport는 CSS 픽셀이 아닌 canvas.width/height 기준, 원점은 왼쪽 아래
   viewer.render = (viewer) => { ... } : 기본 한 화면 그리기를 대체할 선택적 콜백
   document.querySelector('#student-ui'): 본인이 만든 UI를 넣을 자리

   기본 이벤트를 바꾸려면 d04-inspection-controls.js를 수정해도 됩니다.
   중요한 정보는 실제 구조물과 함께 관찰하도록 하고, 답만 목록에 표시하지 마세요.
*/
(() => {
  'use strict';
  const viewer=window.InspectionViewer; // 제공된 모델과 렌더러를 재사용한다.
  if(!viewer)return; // WebGL을 사용할 수 없으면 확장 실행을 멈춘다.
  const {controls,canvas,model}=viewer; // 카메라 조작, 화면, 관찰 데이터를 가져온다.
  const ui=document.querySelector('#student-ui'); // 제공된 학생 UI 영역에 버튼을 넣는다.
  const status=document.querySelector('#view-status'); // 현재 대상과 투영을 표시할 자리다.
  let comparison=null; // null이면 자유 원근 관찰, 값이 있으면 축 고정 직교 관찰이다.
  let current=null; // 선택 대상 이름을 전체 복귀 후에도 보여 주기 위해 저장한다.
  let overview=true; // 전체 복귀 화면에서는 마지막 대상의 위치를 마커로 표시한다.
  let lastAspect=0; // 창 비율이 바뀌면 표지가 잘리지 않도록 거리를 보정한다.
  const marker=document.querySelector('#target-marker'); // 전체에서 선택 지점을 찾는 위치 표시다.

  function readingDistance(poi,aspect) {
    const halfHeight=Math.max(poi.size[1]/.32,poi.size[0]/(.84*aspect)); // 높이 16%, 폭 42% 이내로 담아 주변 장치도 남긴다.
    return halfHeight/Math.tan(controls.state.fov*Math.PI/360); // h=d*tan(FOV/2)를 d에 대해 푼다.
  }

  function describe(suffix='') {
    const name=overview?'전체 구조':current.id+' '+current.name; // 전체 복귀 후에도 상세 화면으로 잘못 표시하지 않는다.
    status.textContent=name+' · '+(comparison?'직교':'원근')+suffix; // 답 대신 현재 화면과 투영 방식을 알려 준다.
  }
  function button(label,action) {
    const element=document.createElement('button'); // 각 관찰 지점을 선택할 버튼이다.
    element.type='button'; // 폼 제출 없이 카메라만 조작한다.
    element.className='btn'; // 시작 코드의 버튼 스타일을 따른다.
    element.textContent=label; // 번호와 장치 이름으로 목적지를 구별한다.
    element.addEventListener('click',()=>{
      action(); // 선택한 카메라 동작을 실행한다.
      controls.state.actions++; // 추가 UI 클릭도 기존 조작 카운터에 포함한다.
      if(innerWidth<=900)status.scrollIntoView({block:'start'}); // 좁은 화면에서는 선택 결과가 있는 화면으로 돌아간다.
    });
    ui.appendChild(element); // 목록에 실제로 조작 가능한 버튼을 추가한다.
  }
  function reset() {
    comparison=null; // 전체 복귀 시 직교 투영을 해제한다.
    overview=true; // 전체 보기에서는 위치 마커를 표시한다.
    status.textContent='전체 구조 · 원근'+(current?' · 마지막 선택: '+current.id+' '+current.name:''); // 현재 화면과 마지막 선택을 구분한다.
    if(innerWidth<=900)status.scrollIntoView({block:'start'}); // 아래쪽 복귀 버튼을 눌러도 전체 장면이 보인다.
  }
  document.querySelector('#home').addEventListener('click',reset); // 기존 home()과 같은 버튼을 사용한다.
  canvas.addEventListener('keydown',event=>{
    if(event.key==='Home')reset(); // 키보드 복귀도 투영 상태를 초기화한다.
  });
  button('화면 바로 세우기',()=>{
    const camera=controls.camera(); // 현재 eye와 target을 읽는다.
    controls.lookAt(camera.eye,camera.target); // 같은 시선을 세계의 위쪽 기준에 맞춰 정렬한다.
    describe(' · 기울기 정렬'); // 정렬 후에도 현재 대상 이름을 유지한다.
  });
  for(const poi of model.poi) {
    button(poi.id+' '+poi.name,()=>{
      comparison=null; // 표지는 공간감을 유지하는 원근 투영으로 관찰한다.
      current=poi; // 선택한 장치 정보를 상태에 저장한다.
      overview=false; // 상세 화면에서는 중앙 마커가 글자를 가리지 않게 한다.
      controls.state.fov=45; // 모든 표지에서 같은 수직 시야각을 사용한다.
      const aspect=canvas.clientWidth/canvas.clientHeight; // 실제 관찰 화면의 가로세로 비율이다.
      const distance=readingDistance(poi,aspect); // 명판 크기에 맞춰 읽을 수 있는 거리로 접근한다.
      const normal=[Math.sin(poi.yaw),0,Math.cos(poi.yaw)]; // 표지의 앞면 방향이며 뒤쪽 P5도 처리한다.
      const eye=poi.position.map((v,i)=>v+normal[i]*distance); // 표지 앞에서 표지 중심을 바라본다.
      controls.lookAt(eye,poi.position); // 대상 위치를 화면 중심과 회전 중심으로 설정한다.
      describe(); // 현재 선택된 지점과 투영 방식을 표시한다.
    });
  }
  for(const item of model.comparisons) {
    button(item.id+(item.id==='O1'?' 전면 직교':' 오른쪽 측면 직교'),()=>{
      comparison=item; // 직교 관찰 모드에서 축 정렬을 유지한다.
      current=item; // 비교 대상 이름을 표시한다.
      overview=false; // 직교 비교에서는 대상 모서리를 가리지 않는다.
      const eye=item.position.map((v,i)=>v-item.viewDirection[i]*12); // 시선 반대쪽 12m에 카메라를 놓는다.
      controls.lookAt(eye,item.position); // O1은 +z, O2는 +x에서 바라본다.
      describe(); // 현재 직교 관찰 중임을 알린다.
    });
  }
  for(const type of ['pointerdown','keydown']) {
    canvas.addEventListener(type,event=>{
      const rotate=type==='pointerdown' ? event.button===0&&!event.shiftKey : event.key.startsWith('Arrow'); // 회전 입력만 구분한다.
      if(comparison&&rotate)event.stopImmediatePropagation(); // 비교 중 정면과 측면 방향이 틀어지는 것을 막는다.
    },true); // 기본 트랙볼 처리보다 먼저 회전 여부를 검사한다.
  }
  viewer.render=()=>{
    const aspect=canvas.width/canvas.height; // 리사이즈된 실제 캔버스 비율을 사용한다.
    if(lastAspect&&aspect!==lastAspect&&current&&!overview&&!comparison) {
      controls.state.distance*=readingDistance(current,aspect)/readingDistance(current,lastAspect); // 수동 확대 비율은 유지하며 창 비율 변화만 보정한다.
    }
    lastAspect=aspect; // 다음 프레임에서 비율 변화 여부를 비교한다.
    const camera=controls.camera(); // 선택 후에도 기존 드래그·이동·거리 상태를 사용한다.
    camera.orthographic=Boolean(comparison); // 관찰 목적에 따라 투영만 전환한다.
    camera.halfHeight=Math.max(3,2.6/aspect)*controls.state.distance/12; // 좁은 창에서도 두 대상을 같은 배율로 함께 담는다.
    controls.state.halfHeight=camera.orthographic?camera.halfHeight:null; // 직교 평행 이동도 실제 시야 높이를 사용한다.
    viewer.drawView(camera); // 제공 lookAt과 투영 행렬로 실제 구조물을 그린다.
    marker.hidden=true; // 화면 밖이나 상세 화면에서는 위치 표시를 숨긴다.
    if(overview&&current) {
      const view=D.M4.create(); // 월드 좌표를 카메라 기준으로 옮길 행렬이다.
      D.M4.lookAt(view,camera.eye,camera.target,camera.up); // 실제 그리기와 같은 뷰 행렬을 구한다.
      const p=current.position; // 마지막 관찰 지점의 월드 좌표다.
      const v=[0,1,2].map(i=>view[i]*p[0]+view[i+4]*p[1]+view[i+8]*p[2]+view[i+12]); // 월드 지점에 뷰 행렬을 곱한다.
      const h=-v[2]*Math.tan(controls.state.fov*Math.PI/360); // 지점 깊이에서 원근 시야의 반높이다.
      const x=v[0]/(h*aspect),y=v[1]/h; // 원근 나눗셈으로 화면의 -1~1 좌표를 구한다.
      if(v[2]<0&&Math.abs(x)<1&&Math.abs(y)<1) {
        marker.hidden=false; // 카메라 앞의 화면 내부 지점만 표시한다.
        marker.style.left=(x+1)*50+'%'; // NDC의 -1~1을 CSS의 0~100%로 바꾼다.
        marker.style.top=(1-y)*50+'%'; // CSS의 아래쪽 y 방향에 맞게 뒤집는다.
        marker.textContent=current.id+' 위치'; // 깊이 가림과 관계없는 위치 안내이며 표지 답은 표시하지 않는다.
      }
    }
  };
  describe(); // 첫 화면은 전체 구조의 원근 관찰이다.
})();
