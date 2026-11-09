(() => {
'use strict';
const $ = id => document.getElementById(id);
const canvas=$('editorCanvas'), overlay=$('editorOverlay'), stage=$('editorStage'), viewport=$('editorViewport');
const ctx=canvas.getContext('2d',{willReadFrequently:true}), ox=overlay.getContext('2d');
const pixelGridCanvas=$('editorPixelGrid'), pixelGridCtx=pixelGridCanvas.getContext('2d');
let paintCtx=ctx,activePaintId=null,baseOrder=0,baseVisible=true,baseOrderManual=false;
const tool=$('editorTool'), color=$('editorColor'), alpha=$('editorAlpha'), brush=$('editorBrush'), brushRange=$('editorBrushRange'), zoom=$('editorZoom');
// Slider and numeric input control the same brush size, including the eraser.
brushRange.addEventListener('input',()=>{brush.value=brushRange.value;});
brush.addEventListener('input',()=>{const n=Number(brush.value);if(Number.isFinite(n)&&n>=1)brushRange.value=String(Math.min(64,Math.round(n)));});
brush.addEventListener('change',()=>{const n=Math.min(64,Math.max(1,Math.round(Number(brush.value)||1)));brush.value=String(n);brushRange.value=String(n);});
// Cursor must be applied to the actual top canvas as well as the viewport.
// The overlay receives pointer events; a permanent CSS crosshair used to hide resize cursors.
const resizeCursors={n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize',nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize'};
function setEditCursor(cursor){viewport.style.cursor=cursor;overlay.style.cursor=cursor;}

let scale=1,panX=0,panY=0,interaction=null,space=false,selection=null,floating=null,layers=[],nextLayerId=1,history=[],future=[],dirty=false;
let dialogKind='image',baseRatio=1,settingDimensions=false,initialFloatTransform=null;
const duplicateImage=source=>{const c=document.createElement('canvas');c.width=source.width;c.height=source.height;c.getContext('2d').drawImage(source,0,0);return c;};
// The currently selected painting target may be the original canvas, a paint layer,
// or an imported picture. Picture layers keep their own bitmap, position, and size.
function activePaint(){return layers.find(l=>l.id===activePaintId)||null;}
function picturePaintTarget(){const layer=activePaint();return layer&&layer.type!=='paint'?layer:null;}
function refreshPaintCtx(){
  const layer=activePaint();
  paintCtx=layer&&layer.image instanceof HTMLCanvasElement
    ?layer.image.getContext('2d',{willReadFrequently:true}):ctx;
  // Draw tools use workspace coordinates. A picture's bitmap is local to its
  // positioned rectangle, so translate the drawing context, not the image itself.
  paintCtx.setTransform(1,0,0,1,layer&&layer.type!=='paint'&&paintCtx!==ctx?-layer.x:0,
                               layer&&layer.type!=='paint'&&paintCtx!==ctx?-layer.y:0);
}
function preparePicturePixels(){
  const layer=picturePaintTarget();
  if(!layer)return;
  const w=Math.max(1,Math.round(layer.w)),h=Math.max(1,Math.round(layer.h));
  if(layer.image instanceof HTMLCanvasElement&&layer.image.width===w&&layer.image.height===h){refreshPaintCtx();return;}
  // Rasterize once at the displayed size, not when merely selecting a photo.
  // This keeps the original image intact until the first real edit and makes
  // pencil, eraser, flood fill and shape tools operate on the same pixels.
  const bitmap=document.createElement('canvas');bitmap.width=w;bitmap.height=h;
  const c=bitmap.getContext('2d',{willReadFrequently:true});c.imageSmoothingEnabled=false;
  c.drawImage(layer.image,0,0,w,h);
  layer.image=bitmap;layer.w=w;layer.h=h;
  refreshPaintCtx();
}

function getStack(){return [...layers.slice(0,baseOrder),{isBase:true},...layers.slice(baseOrder)];}
function redraw(){drawOverlay();}
function switchToBase(){activePaintId=null;refreshPaintCtx();baseVisible=true;baseOrder=layers.length;}
function reorderLayer(item,dir){const stack=getStack(),i=stack.findIndex(x=>x===item||(item?.isBase&&x.isBase));const n=i+dir;if(n<0||n>=stack.length)return;const movedBase=!!(stack[i].isBase||stack[n].isBase);checkpoint();[stack[i],stack[n]]=[stack[n],stack[i]];baseOrder=stack.findIndex(x=>x.isBase);if(movedBase)baseOrderManual=true;layers=stack.filter(x=>!x.isBase);dirty=true;syncButtons();redraw();refreshInfo();}
function createPaintLayer(){checkpoint();const bitmap=document.createElement('canvas');bitmap.width=canvas.width;bitmap.height=canvas.height;const layer={id:nextLayerId++,type:'paint',name:`繪圖圖層 ${layers.filter(l=>l.type==='paint').length+1}`,image:bitmap,x:0,y:0,w:canvas.width,h:canvas.height,visible:true};layers.push(layer);activePaintId=layer.id;floating=null;tool.value='pencil';refreshPaintCtx();dirty=true;syncButtons();redraw();notice('已新增空白繪圖圖層，現在可以直接在上面畫圖。');}
let noticeTimer;
function notice(message,problem=false){const el=$('editorNotice');el.textContent=message;el.hidden=false;el.classList.toggle('error',problem);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{el.hidden=true;},6500);}
const visible=layer=>layer.visible!==false;
// Keep the original editing resolution until the user explicitly converts it to E-game pixels.
// A maximum dimension and pixel budget protect browsers from extremely large images.
const MAX=4096, MAX_PIXELS=8388608, clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function fitToEditorLimits(w,h){
  const scale=Math.min(1,MAX/w,MAX/h,Math.sqrt(MAX_PIXELS/(w*h)));
  return {w:Math.max(1,Math.floor(w*scale)),h:Math.max(1,Math.floor(h*scale)),limited:scale<1};
}
function hasBasePixels(){
  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  for(let i=3;i<data.length;i+=4)if(data[i]!==0)return true;
  return false;
}
const pointInside=p=>p.x>=0&&p.y>=0&&p.x<canvas.width&&p.y<canvas.height;
const bounded=p=>({x:clamp(p.x,0,canvas.width-1),y:clamp(p.y,0,canvas.height-1)});
// Work in stage coordinates, not the viewport border-box. The border is part of
// getBoundingClientRect(), and previously displaced mouse coordinates and clipped edge handles.
const getPixelPos=e=>{const r=stage.getBoundingClientRect();return {x:Math.floor((e.clientX-r.left)/scale),y:Math.floor((e.clientY-r.top)/scale)};};
const coord=e=>{const r=stage.getBoundingClientRect();return {x:(e.clientX-r.left)/scale,y:(e.clientY-r.top)/scale};};
function fit(){const w=viewport.clientWidth,h=viewport.clientHeight;scale=clamp(Math.min((w-32)/canvas.width,(h-32)/canvas.height),.1,16);panX=(w-canvas.width*scale)/2;panY=(h-canvas.height*scale)/2;updateView();}
// A pixel grid is meaningful only when each editing pixel is large enough to see.
// Below 800% it is deliberately unavailable instead of substituting an arbitrary
// 10/20/50 px guide that could be mistaken for the real pixel resolution.
function drawPixelGrid(){
  const enabled=scale>=8&&$('editorGrid').checked;
  pixelGridCanvas.hidden=!enabled;
  viewport.classList.toggle('editor-pixel-grid-on',enabled);
  if(!enabled)return;
  const w=viewport.clientWidth, h=viewport.clientHeight;
  if(pixelGridCanvas.width!==w||pixelGridCanvas.height!==h){
    pixelGridCanvas.width=w;pixelGridCanvas.height=h;
  }
  const g=pixelGridCtx;
  g.clearRect(0,0,w,h);
  // Render grid in screen pixels, not the zoomed 400x400 drawing bitmap:
  // a subpixel line drawn on the bitmap would nearly disappear at 800% zoom.
  const l=Math.max(0,panX), t=Math.max(0,panY);
  const r=Math.min(w,panX+canvas.width*scale), b=Math.min(h,panY+canvas.height*scale);
  if(r<=l||b<=t)return;
  g.save();g.beginPath();g.rect(l,t,r-l,b-t);g.clip();
  g.beginPath();g.strokeStyle='rgba(94,67,43,.29)';g.lineWidth=1;
  const x0=Math.max(1,Math.ceil((l-panX)/scale));
  const x1=Math.min(canvas.width-1,Math.floor((r-panX)/scale));
  const y0=Math.max(1,Math.ceil((t-panY)/scale));
  const y1=Math.min(canvas.height-1,Math.floor((b-panY)/scale));
  for(let x=x0;x<=x1;x++){
    const screenX=Math.round(panX+x*scale)+.5;
    g.moveTo(screenX,t);g.lineTo(screenX,b);
  }
  for(let y=y0;y<=y1;y++){
    const screenY=Math.round(panY+y*scale)+.5;
    g.moveTo(l,screenY);g.lineTo(r,screenY);
  }
  g.stroke();g.restore();
}
function syncPixelGrid(){
  const input=$('editorGrid'), available=scale>=8;
  // Below 800%, pause rendering instead of resetting the user's preference.
  // Keep the checked state while the control is temporarily unavailable so
  // that the 1×1 pixel grid returns automatically at 800% or above.
  input.disabled=!available;
  const hint=$('editorGridZoomHint');
  if(hint){
    hint.hidden=available;
    hint.textContent=input.checked?'低於 800% 暫停':'800%↑';
  }
  drawPixelGrid();
}
function updateView(){stage.style.width=canvas.width+'px';stage.style.height=canvas.height+'px';stage.style.transform=`translate(${panX}px,${panY}px) scale(${scale})`;syncPixelGrid();drawOverlay();refreshInfo();}
function matchOverlay(){if(overlay.width!==canvas.width||overlay.height!==canvas.height){overlay.width=canvas.width;overlay.height=canvas.height;}updateView();$('editorDims').textContent=`${canvas.width} × ${canvas.height}`;}
function getState(){return paintCtx.getImageData(0,0,paintCtx.canvas.width,paintCtx.canvas.height);}
// Layer objects retain their source images and can be repositioned without touching the base bitmap.
function snapshot(){return {bitmap:ctx.getImageData(0,0,canvas.width,canvas.height),layers:layers.map(layer=>({...layer,image:layer.image instanceof HTMLCanvasElement?duplicateImage(layer.image):layer.image})),activeId:floating?.id??null,activePaintId,baseOrder,baseVisible,baseOrderManual,tool:tool.value};}
function checkpoint(){window.editorInvalidateConversion?.();history.push(snapshot());if(history.length>25)history.shift();future=[];}
function restore(state){
  // Restoring a stroke does not change the canvas dimensions. Re-running fit()
  // for every undo used to reset the zoom/pan and reflow nearby controls.
  const oldWidth=canvas.width,oldHeight=canvas.height;
  const mobile=window.matchMedia?.('(pointer: coarse)').matches;
  const viewportTop=mobile?viewport.getBoundingClientRect().top:null;
  initialFloatTransform=null;window.editorInvalidateConversion?.();
  const img=state.bitmap;canvas.width=img.width;canvas.height=img.height;ctx.putImageData(img,0,0);
  layers=state.layers.map(layer=>({...layer,image:layer.image instanceof HTMLCanvasElement?duplicateImage(layer.image):layer.image}));
  floating=layers.find(layer=>layer.id===state.activeId)||null;
  activePaintId=state.activePaintId??null;baseOrder=state.baseOrder??0;
  baseVisible=state.baseVisible!==false;baseOrderManual=!!state.baseOrderManual;
  refreshPaintCtx();selection=null;tool.value=state.tool||'pencil';
  matchOverlay();
  if(canvas.width!==oldWidth||canvas.height!==oldHeight)fit();
  syncButtons();syncFloatFields();dirty=true;refreshInfo();
  // If undo changes the selected-image toolbar height, keep the editor canvas
  // at the same screen location rather than letting the page jump.
  if(mobile&&Number.isFinite(viewportTop)){
    const delta=viewport.getBoundingClientRect().top-viewportTop;
    if(Math.abs(delta)>1)window.scrollBy({top:delta,behavior:'instant'});
  }
}
function undo(){if(!history.length)return;future.push(snapshot());restore(history.pop());}
function redo(){if(!future.length)return;history.push(snapshot());restore(future.pop());}
function changeCanvas(w,h,kind='image',method='nearest',anchor='center'){
  // Manually choosing an editing canvas size takes priority over auto-fit on a later import.
  if($('editorAutoCanvas'))$('editorAutoCanvas').checked=false;
  w=clamp(Math.round(w),1,MAX);h=clamp(Math.round(h),1,MAX);
  if(w*h>MAX_PIXELS){notice('尺寸過大：編輯畫布最多約 838 萬像素，請減少寬度或高度。',true);return;}
  if(w===canvas.width&&h===canvas.height)return;
  checkpoint();const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);
  const oldW=canvas.width,oldH=canvas.height;canvas.width=w;canvas.height=h;ctx.imageSmoothingEnabled=method==='smooth';
  if(kind==='image')ctx.drawImage(copy,0,0,w,h);
  else ctx.drawImage(copy,anchor==='center'?Math.floor((w-copy.width)/2):0,anchor==='center'?Math.floor((h-copy.height)/2):0);
  ctx.imageSmoothingEnabled=false;const dx=anchor==='center'?Math.floor((w-oldW)/2):0,dy=anchor==='center'?Math.floor((h-oldH)/2):0;
  for(const layer of layers){if(layer.type==='paint'){const old=layer.image;const dest=document.createElement('canvas');dest.width=w;dest.height=h;const c=dest.getContext('2d');c.imageSmoothingEnabled=method==='smooth';if(kind==='image')c.drawImage(old,0,0,w,h);else c.drawImage(old,dx,dy);layer.image=dest;layer.x=0;layer.y=0;layer.w=w;layer.h=h;}else if(kind==='image'){layer.x=Math.round(layer.x*w/oldW);layer.y=Math.round(layer.y*h/oldH);layer.w=Math.max(1,Math.round(layer.w*w/oldW));layer.h=Math.max(1,Math.round(layer.h*h/oldH));}else{layer.x+=dx;layer.y+=dy;}}refreshPaintCtx();
  selection=null;dirty=true;matchOverlay();fit();syncButtons();syncFloatFields();
}
function rgba(){const v=color.value;return [parseInt(v.slice(1,3),16),parseInt(v.slice(3,5),16),parseInt(v.slice(5,7),16),clamp(+alpha.value||0,0,255)];}
// Each pixel is overwritten with its requested RGBA value. Transparent strokes do not accumulate Alpha.
function pixel(x,y,erase=false){const size=clamp(+brush.value||1,1,64),left=x-Math.floor((size-1)/2),top=y-Math.floor((size-1)/2);paintCtx.clearRect(left,top,size,size);if(!erase){const c=rgba();if(c[3]){paintCtx.fillStyle=`rgba(${c[0]},${c[1]},${c[2]},${c[3]/255})`;paintCtx.fillRect(left,top,size,size);}}}
function line(a,b,erase=false){a=bounded(a);b=bounded(b);let x=a.x,y=a.y,dx=Math.abs(b.x-x),dy=Math.abs(b.y-y),sx=x<b.x?1:-1,sy=y<b.y?1:-1,err=dx-dy;for(;;){pixel(x,y,erase);if(x===b.x&&y===b.y)break;const e2=2*err;if(e2>-dy){err-=dy;x+=sx;}if(e2<dx){err+=dx;y+=sy;}}}
function rect(a,b,solid=false){a=bounded(a);b=bounded(b);const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),r=Math.max(a.x,b.x),bottom=Math.max(a.y,b.y);if(solid){for(let yy=y;yy<=bottom;yy++)line({x,y:yy},{x:r,y:yy});}else{line({x,y},{x:r,y});line({x,y:bottom},{x:r,y:bottom});line({x,y},{x,y:bottom});line({x:r,y},{x:r,y:bottom});}}
// Raster shape tools: drawn in the base bitmap, with drag preview restored from a
// saved image on every move. Keeping pixel operations central preserves alpha and undo.
const shapeNames={line:'直線',rect:'矩形框',solidRect:'實心矩形',circle:'圓形',ellipse:'橢圓',arrow:'箭頭'};
const isShapeTool=value=>Object.prototype.hasOwnProperty.call(shapeNames,value);
function circleEnd(a,b){
  const dx=b.x-a.x,dy=b.y-a.y,span=Math.min(Math.abs(dx),Math.abs(dy));
  return {x:a.x+(dx<0?-span:span),y:a.y+(dy<0?-span:span)};
}
function ellipseRaster(a,b,solid=false){
  a=bounded(a);b=bounded(b);
  const x0=Math.min(a.x,b.x),x1=Math.max(a.x,b.x),y0=Math.min(a.y,b.y),y1=Math.max(a.y,b.y);
  if(x0===x1&&y0===y1){pixel(x0,y0);return;}
  if(x0===x1||y0===y1){line({x:x0,y:y0},{x:x1,y:y1});return;}
  const cx=(x0+x1)/2,cy=(y0+y1)/2,rx=(x1-x0)/2,ry=(y1-y0)/2;
  if(solid){
    const c=rgba();
    paintCtx.fillStyle=`rgba(${c[0]},${c[1]},${c[2]},${c[3]/255})`;
    for(let y=y0;y<=y1;y++){
      const norm=(y-cy)/ry,reach=rx*Math.sqrt(Math.max(0,1-norm*norm));
      const left=Math.max(x0,Math.ceil(cx-reach)),right=Math.min(x1,Math.floor(cx+reach));
      if(left>right)continue;
      paintCtx.clearRect(left,y,right-left+1,1);
      if(c[3])paintCtx.fillRect(left,y,right-left+1,1);
    }
    return;
  }
  // Trace connected integer line segments to avoid gaps at low pixel resolutions.
  const count=Math.max(24,Math.min(24000,Math.ceil(2*Math.PI*Math.max(rx,ry)*1.6)));
  let first=null,last=null;
  for(let t=0;t<=count;t++){
    const theta=t*2*Math.PI/count;
    const next={x:Math.round(cx+rx*Math.cos(theta)),y:Math.round(cy+ry*Math.sin(theta))};
    if(!first)first=next;
    if(last&&(last.x!==next.x||last.y!==next.y))line(last,next);
    last=next;
  }
  if(first&&last)line(last,first);
}
function arrowRaster(a,b){
  a=bounded(a);b=bounded(b);
  line(a,b);
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
  if(length<2)return;
  const headLen=Math.min(36,Math.max(4,length*.28));
  const angle=Math.atan2(dy,dx),spread=Math.PI/5;
  for(const dir of [-1,1]){
    const theta=angle+Math.PI+dir*spread;
    line(b,{x:Math.round(b.x+headLen*Math.cos(theta)),y:Math.round(b.y+headLen*Math.sin(theta))});
  }
}
function drawShape(value,a,b){
  if(value==='line')line(a,b);
  else if(value==='rect'||value==='solidRect')rect(a,b,value==='solidRect');
  else if(value==='circle')ellipseRaster(a,circleEnd(a,b),$('editorShapeFilled').checked);
  else if(value==='ellipse')ellipseRaster(a,b,$('editorShapeFilled').checked);
  else if(value==='arrow')arrowRaster(a,b);
}
// A flood-fill click on a pixel that already has the chosen RGBA value is
// not an edit. In particular, it must not discard a pending Ctrl+Y redo step.
function fillIsNoop(p){
  const expected=rgba(),picture=picturePaintTarget();
  let data;
  if(picture){
    const px=Math.floor(p.x-picture.x),py=Math.floor(p.y-picture.y);
    if(px<0||py<0||px>=picture.w||py>=picture.h)return true;
    const sample=document.createElement('canvas');sample.width=1;sample.height=1;
    const sg=sample.getContext('2d',{willReadFrequently:true});sg.imageSmoothingEnabled=false;
    sg.drawImage(picture.image,-px,-py,picture.w,picture.h);
    data=sg.getImageData(0,0,1,1).data;
  }else{
    const target=activePaint();
    const source=target?.type==='paint'?target.image.getContext('2d',{willReadFrequently:true}):ctx;
    data=source.getImageData(p.x,p.y,1,1).data;
  }
  return expected.every((value,index)=>value===data[index]);
}
function fill(p){if(!pointInside(p))return;const picture=picturePaintTarget();if(picture){p={x:p.x-picture.x,y:p.y-picture.y};}const img=getState(),d=img.data,w=img.width,h=img.height;if(p.x<0||p.y<0||p.x>=w||p.y>=h)return;const start=(p.y*w+p.x)*4,old=d.slice(start,start+4),replacement=rgba();if(old.every((v,i)=>v===replacement[i]))return;const q=[p.y*w+p.x],seen=new Uint8Array(w*h);let head=0;while(head<q.length){let k=q[head++];if(seen[k])continue;seen[k]=1;const j=k*4;if(d[j]!==old[0]||d[j+1]!==old[1]||d[j+2]!==old[2]||d[j+3]!==old[3])continue;d.set(replacement,j);const x=k%w,y=(k/w)|0;if(x)q.push(k-1);if(x<w-1)q.push(k+1);if(y)q.push(k-w);if(y<h-1)q.push(k+w);}paintCtx.putImageData(img,0,0);redraw();}
function pick(p){if(!pointInside(p))return;const d=compositeCanvas().getContext('2d').getImageData(p.x,p.y,1,1).data;color.value='#'+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('');alpha.value=d[3];markSwatch();}
// Crop rectangles use integer image pixels. Fixed-ratio rectangles are always
// clamped as a WHOLE before positioning: clipping X/Y independently distorts ratios.
function ratioParts(){const v=$('editorCropRatio').value;return v==='1'?[1,1]:v.startsWith('1.333')?[4,3]:v.startsWith('1.777')?[16,9]:null;}
function getBox(a,b){
  const ax=clamp(Math.floor(a.x),0,canvas.width),ay=clamp(Math.floor(a.y),0,canvas.height);
  const bx=clamp(Math.floor(b.x),0,canvas.width),by=clamp(Math.floor(b.y),0,canvas.height);
  const parts=ratioParts();
  if(!parts){const x=Math.min(ax,bx),y=Math.min(ay,by),w=Math.abs(bx-ax),h=Math.abs(by-ay);return w&&h?{x,y,w,h}:null;}
  const [unitW,unitH]=parts;
  const sx=b.x<ax?-1:1,sy=b.y<ay?-1:1;
  const roomX=sx>0?canvas.width-ax:ax,roomY=sy>0?canvas.height-ay:ay;
  const maxUnits=Math.min(roomX/unitW,roomY/unitH);
  // Start at one complete ratio unit; after that, allow smooth 1px adjustments.
  // Exact 4:3 or 16:9 can be impossible at arbitrary integer pixel dimensions,
  // so round both dimensions together (<1px geometric deviation) at the end.
  if(maxUnits<1)return null;
  const units=clamp(Math.max(Math.abs(b.x-ax)/unitW,Math.abs(b.y-ay)/unitH),1,maxUnits);
  const w=Math.round(units*unitW),h=Math.round(units*unitH);
  return {x:sx>0?ax:ax-w,y:sy>0?ay:ay-h,w,h};
}
function getHandle(rect,p){
  const z=Math.max(1,11/scale),mx=rect.x+rect.w/2,my=rect.y+rect.h/2;
  const handles=[['nw',rect.x,rect.y],['n',mx,rect.y],['ne',rect.x+rect.w,rect.y],['e',rect.x+rect.w,my],['se',rect.x+rect.w,rect.y+rect.h],['s',mx,rect.y+rect.h],['sw',rect.x,rect.y+rect.h],['w',rect.x,my]];
  for(const [name,x,y] of handles)if(Math.abs(x-p.x)<=z&&Math.abs(y-p.y)<=z)return name;
  return null;
}
function contains(rect,p){return p.x>=rect.x&&p.y>=rect.y&&p.x<rect.x+rect.w&&p.y<rect.y+rect.h;}
function updateCrop(rect){selection=rect;$('editorCropApply').disabled=!rect||!rect.w||!rect.h;$('editorCropReadout').textContent=rect?`保留：${rect.w} × ${rect.h} 像素｜左上 (${rect.x}, ${rect.y})`:'尚未選取範圍';drawOverlay();}
function layerThumb(image){
  const c=document.createElement('canvas');c.width=45;c.height=45;
  const g=c.getContext('2d');g.imageSmoothingEnabled=false;
  const w=sourceWidth(image),h=sourceHeight(image),fit=Math.min(43/w,43/h);
  g.drawImage(image,(45-w*fit)/2,(45-h*fit)/2,w*fit,h*fit);
  return c;
}
function renderLayers(){
  const panel=$('editorLayersPanel'),list=$('editorLayersList');panel.hidden=false;
  $('editorLayerCount').textContent=`${layers.length+1} 個圖層`;
  $('layersBadge').textContent=layers.length+1;
  list.replaceChildren();
  const stack=getStack();
  for(let index=stack.length-1;index>=0;index--){
    const layer=stack[index],isBase=!!layer.isBase,isPaint=isBase||layer.type==='paint';
    const selected=isBase?activePaintId===null&&!floating:(activePaintId===layer.id||layer===floating);
    const isVisible=isBase?baseVisible:visible(layer);
    const row=document.createElement('div');row.className='editor-layer-row'+(selected?' active':'')+(isVisible?'':' is-hidden');
    const select=document.createElement('button');select.type='button';select.className='editor-layer-select';
    select.appendChild(layerThumb(isBase?canvas:layer.image));
    const label=document.createElement('span');label.className='layer-text';
    const title=document.createElement('span');title.className='layer-title';title.textContent=isBase?'原始畫布':layer.name||`圖層 ${layer.id}`;
    const subtitle=document.createElement('span');subtitle.className='layer-subtitle';subtitle.textContent=isBase?'可繪圖・可調整順序':isPaint?'可繪圖・透明圖層':`${layer.w} × ${layer.h} px・可直接編輯`;
    label.append(title,subtitle);
    if(selected){const current=document.createElement('span');current.className='layer-current';current.textContent=isPaint||activePaintId===layer.id?'繪圖中':'選取中';label.appendChild(current);}
    select.appendChild(label);select.setAttribute('aria-pressed',String(selected));
    select.title=isPaint?'選取後用鉛筆、橡皮擦或圖案工具在這層畫圖':'選取圖片以移動或縮放；點鉛筆、橡皮擦即可直接修改圖片';
    select.onclick=()=>{
      if(!isVisible){notice('請先顯示這個圖層。');return;}
      if(isPaint){activePaintId=isBase?null:layer.id;floating=null;tool.value='pencil';refreshPaintCtx();syncButtons();redraw();}
      else selectLayer(layer);
    };
    const controls=document.createElement('div');controls.className='editor-layer-controls';
    const eye=document.createElement('button');eye.type='button';eye.textContent=isVisible?'隱藏':'顯示';eye.title=isVisible?'隱藏圖層':'顯示圖層';eye.setAttribute('aria-label',eye.title);
    eye.classList.add('layer-action-visibility');
    eye.onclick=()=>{checkpoint();if(isBase)baseVisible=!baseVisible;else layer.visible=!visible(layer);if(isVisible&&floating===layer)floating=null;if(isVisible&&activePaintId===layer.id){activePaintId=null;refreshPaintCtx();}dirty=true;syncButtons();redraw();refreshInfo();};
    for(const [direction,label2] of [[1,'上移'],[-1,'下移']]){
      const btn=document.createElement('button');btn.type='button';btn.textContent=label2;btn.title=`${label2}一層`;btn.classList.add(direction>0?'layer-action-up':'layer-action-down');
      btn.disabled=index+direction<0||index+direction>=stack.length;
      btn.onclick=()=>{if(!btn.disabled)reorderLayer(layer,direction);};controls.appendChild(btn);
    }
    controls.appendChild(eye);
    const del=document.createElement('button');del.type='button';del.textContent=isBase?'清除':'刪除';del.className='is-danger layer-action-remove';del.title=isBase?'清空原始畫布（可復原）':'刪除此圖層（可復原）';
    del.onclick=()=>{checkpoint();if(isBase){ctx.clearRect(0,0,canvas.width,canvas.height);}else{layers=layers.filter(x=>x!==layer);if(floating===layer)floating=null;if(activePaintId===layer.id)activePaintId=null;baseOrder=Math.min(baseOrder,layers.length);refreshPaintCtx();}dirty=true;syncButtons();redraw();refreshInfo();notice(isBase?'原始畫布已清空，可復原。':'已刪除圖層，可復原。');};controls.appendChild(del);
    row.append(select,controls);list.appendChild(row);
  }
}

function syncButtons(){const crop=tool.value==='crop';$('editorCropOptions').hidden=!crop;$('editorPaintOptions').hidden=crop||tool.value==='hand'||tool.value==='layer';$('editorBrushControl').hidden=['picker','fill','solidRect'].includes(tool.value);$('editorFloatOptions').hidden=!floating;$('editorFloatingActions').hidden=!floating;$('editorCropActions').hidden=!crop;
  $('editorShapeOptions').hidden=!['circle','ellipse'].includes(tool.value);
  $('editorShapeSelectedLabel').textContent=shapeNames[tool.value]||'圖案設定';
  $('editorShapesMenu').classList.toggle('tool-selected',isShapeTool(tool.value));
  $('editorShapesMenu').querySelector('summary').title=isShapeTool(tool.value)?`目前：${shapeNames[tool.value]}。按此切換圖案工具。`:'選擇直線、矩形、圓、橢圓或箭頭';
  for(const b of document.querySelectorAll('[data-tool]'))b.classList.toggle('active',b.dataset.tool===tool.value);
  $('editorModeLabel').textContent=tool.value==='layer'?(floating?($('editorFloatLock').checked?'調整圖片：拖曳圖片移動；控制點縮放（鎖定比例）':'調整圖片：拖曳圖片移動；控制點自由縮放'):'調整圖片：點選要移動或縮放的圖片'):({pencil:'鉛筆：拖曳繪製像素',eraser:'橡皮擦：清除像素透明度',fill:'填色：填滿連續同色區',picker:'滴管：擷取像素 RGB 與 Alpha',line:'直線：拖曳繪製',rect:'矩形：拖曳繪製框線',solidRect:'實心矩形：拖曳繪製',circle:'圓形：拖曳畫出等寬高的圓',ellipse:'橢圓：拖曳自由改變長寬',arrow:'箭頭：從起點拖向箭頭方向',crop:'裁切：亮框內保留，暗區刪除',hand:'移動畫面：只改變觀看位置，不移動圖片'}[tool.value]||'像素畫板');
  if(tool.value!=='layer'&&tool.value!=='hand'&&tool.value!=='crop'&&picturePaintTarget())$('editorModeLabel').textContent+=`｜正在編輯「${picturePaintTarget().name||'圖片圖層'}」`;
  setEditCursor(tool.value==='layer'?'move':tool.value==='hand'?'grab':tool.value==='crop'?'crosshair':tool.value==='picker'?'crosshair':'crosshair');$('editorCropApply').disabled=!selection;renderLayers();
}
function setTool(value){
  if(value!=='crop')selection=null;
  if(value==='layer'){
    // Return to moving/resizing the same imported picture, not an unrelated layer.
    const image=picturePaintTarget();
    if(image){selectLayer(image);return;}
  }else if(floating){
    // Switching from picture adjustment to the pencil/eraser keeps that picture
    // as the editing target. Previously this silently switched to the base canvas.
    activePaintId=floating.id;
    floating=null;
    refreshPaintCtx();
  }
  tool.value=value;
  if(isShapeTool(value))$('editorShapesMenu').open=false;
  syncButtons();drawOverlay();
}

function selectLayer(layer){initialFloatTransform={id:layer.id,x:layer.x,y:layer.y,w:layer.w,h:layer.h};activePaintId=null;refreshPaintCtx();floating=layer;tool.value='layer';selection=null;syncButtons();syncFloatFields();drawOverlay();}
function drawOverlay(){ox.clearRect(0,0,overlay.width,overlay.height);
  ox.save();ox.imageSmoothingEnabled=false;for(const layer of getStack()){if(layer.isBase){if(baseVisible)ox.drawImage(canvas,0,0);}else if(visible(layer))ox.drawImage(layer.image,layer.x,layer.y,layer.w,layer.h);}ox.restore();
  if(selection&&tool.value==='crop'){
    ox.save();ox.fillStyle='rgba(12,24,40,.55)';ox.fillRect(0,0,canvas.width,canvas.height);ox.clearRect(selection.x,selection.y,selection.w,selection.h);
    ox.strokeStyle='#238fff';ox.lineWidth=2/scale;ox.setLineDash([7/scale,4/scale]);ox.strokeRect(selection.x,selection.y,selection.w,selection.h);ox.setLineDash([]);
    for(const x of [selection.x,selection.x+selection.w])for(const y of [selection.y,selection.y+selection.h]){const n=Math.max(2,6/scale);ox.fillStyle='#fff';ox.strokeStyle='#238fff';ox.lineWidth=1/scale;ox.fillRect(x-n/2,y-n/2,n,n);ox.strokeRect(x-n/2,y-n/2,n,n);}
    ox.restore();
  }
  if(floating){ox.save();
    // Low-contrast blue outlines are difficult to distinguish from the transparent checkerboard.
    // Use a dark under-stroke and warm brass selection accents instead.
    ox.strokeStyle='rgba(36,19,9,.88)';ox.lineWidth=3/scale;ox.setLineDash([]);ox.strokeRect(floating.x,floating.y,floating.w,floating.h);
    ox.strokeStyle='#f0c66d';ox.lineWidth=2/scale;ox.setLineDash([6/scale,4/scale]);ox.strokeRect(floating.x,floating.y,floating.w,floating.h);ox.setLineDash([]);
    const n=Math.max(1.4,11/scale),mx=floating.x+floating.w/2,my=floating.y+floating.h/2;
    const handles=[[floating.x,floating.y],[mx,floating.y],[floating.x+floating.w,floating.y],[floating.x+floating.w,my],[floating.x+floating.w,floating.y+floating.h],[mx,floating.y+floating.h],[floating.x,floating.y+floating.h],[floating.x,my]];
    for(const [x,y] of handles){ox.fillStyle='#fff3d6';ox.strokeStyle='#6b371a';ox.lineWidth=1.5/scale;ox.fillRect(x-n/2,y-n/2,n,n);ox.strokeRect(x-n/2,y-n/2,n,n);}
    ox.restore();}
}
function refreshInfo(p){$('editorInfo').textContent=`${canvas.width}×${canvas.height}｜${Math.round(scale*100)}%｜游標：${p&&pointInside(p)?`${p.x}, ${p.y}`:'—'}${dirty?'｜尚未轉換':''}`;}
function prepareDraw(e){const p=getPixelPos(e);if(!pointInside(p))return;if(tool.value==='picker'){pick(p);return;}if(tool.value==='crop'){
    const cp=coord(e),handle=selection?getHandle(selection,cp):null;
    if(selection&&handle){interaction={kind:'crop-handle',handle,initial:{...selection},p:cp};}
    else if(selection&&contains(selection,cp)){interaction={kind:'crop-move',initial:{...selection},p:cp};}
    else{interaction={kind:'crop-new',p:cp};updateCrop(null);}
    overlay.setPointerCapture(e.pointerId);return;
  }
  // A selected imported image is directly editable; a click outside its image
  // rectangle must not secretly paint onto the original canvas.
  const picture=picturePaintTarget();
  if(picture&&!contains(picture,p)){
    notice('目前選取「'+(picture.name||'圖片圖層')+'」；請在圖片範圍內繪圖，或於圖層管理選取「原始畫布」。');
    return;
  }
  if(tool.value==='fill' && fillIsNoop(p))return;
  checkpoint();dirty=true;
  if(picture)preparePicturePixels();
  if(!activePaint() && !baseVisible)baseVisible=true;
  if(activePaint() && !visible(activePaint()))activePaint().visible=true;
  if(activePaintId===null&&!baseOrderManual)baseOrder=layers.length;
  if(tool.value==='fill'){fill(p);syncButtons();refreshInfo(p);return;}
  interaction={kind:'draw',tool:tool.value,start:p,last:p,snapshot:isShapeTool(tool.value)?getState():null};overlay.setPointerCapture(e.pointerId);
  if(['pencil','eraser'].includes(tool.value))pixel(p.x,p.y,tool.value==='eraser');redraw();refreshInfo(p);
}
function moveDrawing(e){const p=bounded(getPixelPos(e)),i=interaction;if(!i)return;
  // Selecting a layer is not an edit: only create an undo step after real dragging.
  if((i.kind==='float-move'||i.kind==='float-handle')&&!i.hasMoved&&(e.clientX!==i.clientX||e.clientY!==i.clientY)){
    checkpoint();i.hasMoved=true;
  }
  if(i.kind==='draw'){
    if(['pencil','eraser'].includes(i.tool)){line(i.last,p,i.tool==='eraser');i.last=p;}
    else if(i.snapshot){paintCtx.putImageData(i.snapshot,0,0);drawShape(i.tool,i.start,p);}
  }else if(i.kind==='crop-new'){updateCrop(getBox(i.p,coord(e)));}
  else if(i.kind==='crop-move'){const cur=coord(e),dx=Math.round(cur.x-i.p.x),dy=Math.round(cur.y-i.p.y);updateCrop({...i.initial,x:clamp(i.initial.x+dx,0,canvas.width-i.initial.w),y:clamp(i.initial.y+dy,0,canvas.height-i.initial.h)});}
  else if(i.kind==='crop-handle'){
    const s=i.initial,p2=coord(e),h=i.handle;const opposite={x:h.includes('w')?s.x+s.w:s.x,y:h.includes('n')?s.y+s.h:s.y};const next=getBox(opposite,p2);if(next)updateCrop(next);
  }else if(i.kind==='float-move'){
    // Gesture deltas are screen-based rather than relative to a moving layout.
    const dx=(e.clientX-i.clientX)/i.startScale,dy=(e.clientY-i.clientY)/i.startScale;
    floating.x=Math.round(i.initial.x+dx);floating.y=Math.round(i.initial.y+dy);
    // Keep at least a small draggable area visible even when pushed past an edge.
    const visibleX=Math.min(floating.w,Math.max(6,Math.ceil(16/scale)));
    const visibleY=Math.min(floating.h,Math.max(6,Math.ceil(16/scale)));
    floating.x=clamp(floating.x,visibleX-floating.w,canvas.width-visibleX);
    floating.y=clamp(floating.y,visibleY-floating.h,canvas.height-visibleY);
    if(dx||dy)dirty=true;drawOverlay();syncFloatFields();}
  else if(i.kind==='float-handle'){
    const r=i.initial,h=i.handle,now={x:i.p.x+(e.clientX-i.clientX)/i.startScale,y:i.p.y+(e.clientY-i.clientY)/i.startScale},lock=$('editorFloatLock').checked;
    if(e.clientX!==i.clientX||e.clientY!==i.clientY)dirty=true;
    if(['e','w'].includes(h)){
      if(h==='e'){floating.x=r.x;floating.w=Math.max(1,Math.round(now.x-r.x));}
      else{const right=r.x+r.w;floating.w=Math.max(1,Math.round(right-now.x));floating.x=right-floating.w;}
      if(lock){const ratio=r.w/r.h;const newH=Math.max(1,Math.round(floating.w/ratio));const cy=r.y+r.h/2;floating.h=newH;floating.y=Math.round(cy-newH/2);}else{floating.y=r.y;floating.h=r.h;}
    }else if(['n','s'].includes(h)){
      if(h==='s'){floating.y=r.y;floating.h=Math.max(1,Math.round(now.y-r.y));}
      else{const bottom=r.y+r.h;floating.h=Math.max(1,Math.round(bottom-now.y));floating.y=bottom-floating.h;}
      if(lock){const ratio=r.w/r.h;const newW=Math.max(1,Math.round(floating.h*ratio));const cx=r.x+r.w/2;floating.w=newW;floating.x=Math.round(cx-newW/2);}else{floating.x=r.x;floating.w=r.w;}
    }else{
      const opposite={x:h.includes('w')?r.x+r.w:r.x,y:h.includes('n')?r.y+r.h:r.y};
      let dx=now.x-opposite.x,dy=now.y-opposite.y;
      floating.x=Math.round(Math.min(opposite.x,opposite.x+dx));floating.y=Math.round(Math.min(opposite.y,opposite.y+dy));
      floating.w=Math.max(1,Math.round(Math.abs(dx)));floating.h=Math.max(1,Math.round(Math.abs(dy)));
      if(lock){const ratio=r.w/r.h;const w=Math.max(1,Math.round(Math.abs(dx))),h2=Math.max(1,Math.round(Math.abs(dy)));if(w/ratio>h2)floating.h=Math.max(1,Math.round(w/ratio));else floating.w=Math.max(1,Math.round(h2*ratio));floating.x=h.includes('w')?opposite.x-floating.w:opposite.x;floating.y=h.includes('n')?opposite.y-floating.h:opposite.y;}
    }
    drawOverlay();syncFloatFields();
  }
  if(i.kind==='draw')redraw();
  refreshInfo(getPixelPos(e));
}
function floatDown(e){const p=coord(e);let h=floating?getHandle(floating,p):null;
  if(!h){const hit=[...layers].reverse().find(layer=>visible(layer)&&contains(layer,p));if(hit&&hit!==floating){selectLayer(hit);h=getHandle(floating,p);}}
  if(!floating){return;}
  // Opening the selected-image toolbar can push the viewport down during pointerdown.
  // Store the original screen coordinates and gesture scale so a stationary click
  // never moves the layer on pointerup (and dragging stays accurate after reflow).
  const gesture={initial:{...floating},p,clientX:e.clientX,clientY:e.clientY,startScale:scale};
  if(h){interaction={kind:'float-handle',handle:h,...gesture};setEditCursor(resizeCursors[h]);}
  else if(contains(floating,p)){interaction={kind:'float-move',...gesture};setEditCursor('grabbing');}
  else{floating=null;syncButtons();drawOverlay();return;}
  overlay.setPointerCapture(e.pointerId);
}
function panDown(e){interaction={kind:'pan',x:e.clientX,y:e.clientY};setEditCursor('grabbing');viewport.setPointerCapture(e.pointerId);e.preventDefault();}
viewport.addEventListener('pointerdown',e=>{
  // A brush-size slider or number input can retain keyboard focus after painting.
  // Re-focus the canvas on pointerdown so Ctrl+Z undoes the new stroke instead
  // of the previous change to the brush-size input.
  if(e.button===0||e.button===1)viewport.focus({preventScroll:true});
  if(e.button===1||e.button===2||space||tool.value==='hand'){panDown(e);return;}
  if(e.button!==0)return;
  // Edge handles often sit precisely on the outside boundary of the canvas;
  // event.target is then the viewport, not the overlay. They must still resize.
  if(tool.value==='layer' && floating && getHandle(floating,coord(e))){e.preventDefault();floatDown(e);return;}
  if(e.target===viewport){panDown(e);return;}
  if(e.target!==overlay)return;
  e.preventDefault();if(tool.value==='layer')floatDown(e);else prepareDraw(e);
});
viewport.addEventListener('pointermove',e=>{
  if(interaction?.kind==='pan'){panX+=e.clientX-interaction.x;panY+=e.clientY-interaction.y;interaction.x=e.clientX;interaction.y=e.clientY;updateView();return;}
  if(interaction)moveDrawing(e);else {
    if(tool.value==='layer'){
      const p=coord(e),handle=floating?getHandle(floating,p):null;
      setEditCursor(handle?resizeCursors[handle]:(floating&&contains(floating,p)?'move':'default'));
    }
    refreshInfo(getPixelPos(e));
  }
});
function endPointer(e){if(!interaction)return;const wasLayer=interaction.kind==='float-move'||interaction.kind==='float-handle';const wasDraw=interaction.kind==='draw';if(interaction.kind!=='pan')moveDrawing(e);interaction=null;if(wasLayer||wasDraw){renderLayers();redraw();}if(tool.value==='layer'){const p=coord(e),handle=floating?getHandle(floating,p):null;setEditCursor(handle?resizeCursors[handle]:(floating&&contains(floating,p)?'move':'default'));}else setEditCursor(tool.value==='hand'?'grab':'crosshair');refreshInfo(getPixelPos(e));}
viewport.addEventListener('pointerup',endPointer);viewport.addEventListener('pointercancel',()=>{interaction=null;setEditCursor(tool.value==='hand'?'grab':tool.value==='layer'?'move':'crosshair');});viewport.addEventListener('contextmenu',e=>e.preventDefault());
viewport.addEventListener('wheel',e=>{e.preventDefault();const r=viewport.getBoundingClientRect(),x=e.clientX-r.left-viewport.clientLeft,y=e.clientY-r.top-viewport.clientTop,old=scale;scale=clamp(scale*(e.deltaY<0?1.25:.8),.1,48);panX=x-(x-panX)*scale/old;panY=y-(y-panY)*scale/old;updateView();},{passive:false});
for(const b of document.querySelectorAll('[data-tool]'))b.addEventListener('click',()=>setTool(b.dataset.tool));
$('editorGrid').onchange=syncPixelGrid;
if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>drawPixelGrid()).observe(viewport);
else window.addEventListener('resize',drawPixelGrid);
$('editorFit').onclick=()=>{zoom.value='fit';fit();};
zoom.onchange=()=>{if(zoom.value==='fit')fit();else{scale=+zoom.value;panX=(viewport.clientWidth-canvas.width*scale)/2;panY=(viewport.clientHeight-canvas.height*scale)/2;updateView();}};
$('editorUndo').onclick=undo;$('editorRedo').onclick=redo;
$('editorNew').onclick=()=>openDialog('new',{w:400,h:400,lock:false});
$('editorAddPaintLayer').onclick=createPaintLayer;
$('editorClear').onclick=()=>{if(!window.confirm('確定要清空整張畫布（包含所有貼圖）？\n可以在清除後按「復原」還原。'))return;checkpoint();ctx.clearRect(0,0,canvas.width,canvas.height);layers=[];baseOrder=0;baseVisible=true;baseOrderManual=false;activePaintId=null;refreshPaintCtx();floating=null;selection=null;dirty=true;syncButtons();drawOverlay();refreshInfo();notice('已清空畫布，可按 Ctrl+Z 復原。');};
$('editorCropStart').onclick=()=>updateCrop(null);
$('editorCropCancel').onclick=()=>{selection=null;setTool('pencil');};
$('editorCropRatio').onchange=()=>{if(selection){const a={x:selection.x,y:selection.y},b={x:selection.x+selection.w,y:selection.y+selection.h};updateCrop(getBox(a,b));}};
$('editorCropApply').onclick=()=>{if(!selection)return;const s=selection;checkpoint();const data=ctx.getImageData(s.x,s.y,s.w,s.h);
  layers=layers.map(layer=>{const x=Math.max(s.x,layer.x),y=Math.max(s.y,layer.y),right=Math.min(s.x+s.w,layer.x+layer.w),bottom=Math.min(s.y+s.h,layer.y+layer.h);if(right<=x||bottom<=y)return null;
    const cropped=document.createElement('canvas');cropped.width=right-x;cropped.height=bottom-y;const c=cropped.getContext('2d');c.imageSmoothingEnabled=false;c.drawImage(layer.image,layer.x-x,layer.y-y,layer.w,layer.h);
    return {...layer,image:cropped,x:x-s.x,y:y-s.y,w:cropped.width,h:cropped.height};}).filter(Boolean);
  canvas.width=s.w;canvas.height=s.h;ctx.putImageData(data,0,0);floating=null;activePaintId=null;baseOrder=Math.min(baseOrder,layers.length);refreshPaintCtx();selection=null;dirty=true;matchOverlay();fit();setTool('pencil');};
// PNG/XML receives the composed image, but exporting never destroys editable layers.
function compositeCanvas(){const result=document.createElement('canvas');result.width=canvas.width;result.height=canvas.height;const c=result.getContext('2d');c.imageSmoothingEnabled=false;for(const layer of getStack()){if(layer.isBase){if(baseVisible)c.drawImage(canvas,0,0);}else if(visible(layer))c.drawImage(layer.image,layer.x,layer.y,layer.w,layer.h);}return result;}
window.pixelEditorQuickPreview = () => ({ image:compositeCanvas(), hasContent: layers.some(visible)||(baseVisible&&hasBasePixels()) });

$('editorSave').onclick=()=>{const a=document.createElement('a');a.download='egame-pixel-art.png';a.href=compositeCanvas().toDataURL('image/png');a.click();notice('PNG 已開始下載。');};
$('editorCopyImage').onclick=async()=>{
  const button=$('editorCopyImage');
  if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined'){
    notice('此瀏覽器或頁面不支援直接複製圖片。請改用 HTTPS／localhost 開啟，並允許剪貼簿權限。',true);return;
  }
  try{
    button.disabled=true;
    const blob=await new Promise((resolve,reject)=>compositeCanvas().toBlob(b=>b?resolve(b):reject(Error('PNG 產生失敗')),'image/png'));
    await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
    notice('已複製目前完整圖片（PNG），可直接貼到其他程式。');
  }catch(err){notice('複製失敗：請確認瀏覽器允許剪貼簿圖片權限。亦可使用「下載 PNG」。',true);}
  finally{button.disabled=false;}
};
$('editorApply').onclick=async()=>{currentImageUrl=compositeCanvas().toDataURL('image/png');dirty=false;refreshInfo();await runConversion(true);};
$('editorApplyBelow').onclick=()=>{$('editorApply').click();};
function deselectLayer(){initialFloatTransform=null;floating=null;syncButtons();drawOverlay();}
function removeLayer(){if(!floating)return;checkpoint();layers=layers.filter(layer=>layer!==floating);floating=null;dirty=true;syncButtons();drawOverlay();refreshInfo();notice('已刪除此圖，可按 Ctrl+Z 復原。');}
function commitFloating(){
  if(!floating)return;
  if(!baseVisible){notice('原始畫布目前隱藏。請先顯示原始畫布，再將圖片合併進去。',true);return;}
  const layer=floating,pos=layers.indexOf(layer);
  if(pos<0)return;
  // Merging non-adjacent layers into a single bitmap would change the draw
  // order of everything sandwiched between them. Avoid silent data changes.
  const photoStackPos=pos<baseOrder?pos:pos+1;
  if(Math.abs(photoStackPos-baseOrder)!==1){
    notice('這張圖片與原始畫布之間還有其他圖層；請先將兩者移成相鄰，再合併。',true);
    return;
  }
  const merged=document.createElement('canvas');merged.width=canvas.width;merged.height=canvas.height;
  const mg=merged.getContext('2d');mg.imageSmoothingEnabled=false;
  if(pos<baseOrder){ // picture was BELOW the original canvas
    mg.drawImage(layer.image,layer.x,layer.y,layer.w,layer.h);
    mg.drawImage(canvas,0,0);
  }else{ // picture was ABOVE the original canvas
    mg.drawImage(canvas,0,0);
    mg.drawImage(layer.image,layer.x,layer.y,layer.w,layer.h);
  }
  checkpoint();
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(merged,0,0);
  layers.splice(pos,1);
  if(pos<baseOrder)baseOrder--;
  baseOrderManual=true;
  floating=null;initialFloatTransform=null;activePaintId=null;refreshPaintCtx();
  dirty=true;syncButtons();redraw();refreshInfo();
}
function mergeAllLayers(){if(!layers.some(visible))return;const combined=compositeCanvas();checkpoint();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(combined,0,0);layers=layers.filter(layer=>!visible(layer));baseOrder=layers.length;baseVisible=true;floating=null;activePaintId=null;refreshPaintCtx();dirty=true;syncButtons();redraw();refreshInfo();}
$('editorFloatingApply').onclick=deselectLayer;
$('editorImagePaint').onclick=()=>{if(!floating)return;setTool('pencil');notice('現在直接編輯所選圖片；鉛筆、橡皮擦、填色和圖案都會作用在這張圖片上。');};
$('editorFloatReset').onclick=()=>{
  const start=initialFloatTransform;
  if(!floating||!start||floating.id!==start.id)return;
  if(['x','y','w','h'].every(k=>floating[k]===start[k])){notice('圖片已是本次選取時的位置與大小。');return;}
  checkpoint();for(const k of ['x','y','w','h'])floating[k]=start[k];
  dirty=true;syncFloatFields();drawOverlay();renderLayers();refreshInfo();
  notice('已還原本次選取後的移動與縮放，可按 Ctrl+Z 復原。');
};
$('editorFloatingCancel').onclick=removeLayer;
$('editorLayerMerge').onclick=commitFloating;
$('editorMergeAll').onclick=mergeAllLayers;
$('editorTransformImage').onclick=()=>{
  if(!layers.length){
    const picture=document.createElement('canvas');picture.width=canvas.width;picture.height=canvas.height;picture.getContext('2d').drawImage(canvas,0,0);
    checkpoint();ctx.clearRect(0,0,canvas.width,canvas.height);
    const l={id:nextLayerId++,name:'整張圖片',image:picture,x:0,y:0,w:canvas.width,h:canvas.height,visible:true};
    layers.push(l);baseOrder=0;dirty=true;selectLayer(l);notice('已選取整張圖片：拖曳四角調整。取消「維持圖片原比例」可自由拉伸。');return;
  }
  if(layers.length===1&&visible(layers[0])){
    // If base pixels also exist, include them instead of selecting just the overlay.
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let hasBase=false;for(let i=3;i<data.length;i+=4)if(data[i]){hasBase=true;break;}
    if(!hasBase){selectLayer(layers[0]);notice('已選取目前圖片；可調整位置與大小，或點鉛筆／橡皮擦直接修改這張圖。');return;}
  }
  if(!window.confirm('將所有目前可見內容整理成「一張可調整圖片」？\n原本的獨立圖層會合併為一層；可按 Ctrl+Z 復原。'))return;
  const picture=compositeCanvas();checkpoint();ctx.clearRect(0,0,canvas.width,canvas.height);layers=[];baseOrder=0;baseOrderManual=false;activePaintId=null;refreshPaintCtx();
  const l={id:nextLayerId++,name:'整張圖片',image:picture,x:0,y:0,w:canvas.width,h:canvas.height,visible:true};
  layers.push(l);dirty=true;selectLayer(l);notice('整張圖片已可以在畫布上移動及拉伸。');
};
const palette=[['黑','#000000'],['白','#ffffff'],['灰','#808080'],['紅','#ff0000'],['橙','#ff8800'],['黃','#ffff00'],['綠','#00cc00'],['青','#00cccc'],['藍','#0066ff'],['紫','#9900ff'],['粉','#ff66aa'],['棕','#996633']];
const swatches=$('editorSwatches');
function markSwatch(){for(const b of swatches.querySelectorAll('button'))b.classList.toggle('selected',b.dataset.color===color.value.toLowerCase());}
for(const [name,hex] of palette){
  const b=document.createElement('button');b.type='button';b.title=`${name} ${hex}`;b.setAttribute('aria-label',b.title);b.dataset.color=hex;b.style.backgroundColor=hex;
  b.onclick=()=>{color.value=hex;alpha.value=255;markSwatch();};swatches.appendChild(b);
}
color.addEventListener('input',markSwatch);markSwatch();
for(const button of document.querySelectorAll('[data-canvas-preset]'))button.addEventListener('click',()=>{
  const v=+button.dataset.canvasPreset,kind=$('editorPresetMode').value;
  changeCanvas(v,v,kind);
  notice(kind==='image'?`已把圖片縮放為 ${v} × ${v}。可 Ctrl+Z 復原。`:`已把畫布邊界改為 ${v} × ${v}。可 Ctrl+Z 復原。`);
});
function syncFloatFields(){
  if(!floating)return;
  const hint=$('editorFloatSource');
  if(hint)hint.textContent=`來源解析度：${sourceWidth(floating.image)} × ${sourceHeight(floating.image)} px（編輯尺寸：${floating.w} × ${floating.h}）`;
  for(const [id,v] of [['editorFloatX',floating.x],['editorFloatY',floating.y],['editorFloatW',floating.w],['editorFloatH',floating.h]])$(id).value=v;
  syncFloatLockState();
}
const sourceWidth=image=>image.naturalWidth||image.width,sourceHeight=image=>image.naturalHeight||image.height;
function syncFloatLockState(){
  const lock=$('editorFloatLock'), inline=$('editorFloatLockInline'), text=$('editorFloatingStateText');
  if(inline&&inline.checked!==lock.checked)inline.checked=lock.checked;
  if(text)text.textContent=lock.checked?'拖曳移動；控制點等比例縮放。按「編輯圖片像素」可直接修改。':'拖曳移動；側邊控制點自由拉伸。按「編輯圖片像素」可直接修改。';
}
for(const id of ['editorFloatX','editorFloatY','editorFloatW','editorFloatH']){
  const field=$(id);
  field.addEventListener('focus',()=>{field.dataset.editLayer=String(floating?.id??'');field.dataset.editStarted='0';});
  // Input updates the selected layer immediately, rather than waiting for blur.
  // This also prevents a pending change event from accidentally modifying the next pasted layer.
  field.addEventListener('input',()=>{
    if(!floating||field.dataset.editLayer!==String(floating.id))return;
    if(!field.value.trim()||field.value==='-')return;
    const n=Math.round(Number(field.value));if(!Number.isFinite(n))return;
    if(field.dataset.editStarted!=='1'){checkpoint();field.dataset.editStarted='1';}
    if(id==='editorFloatX')floating.x=n;
    if(id==='editorFloatY')floating.y=n;
    if(id==='editorFloatW'){floating.w=Math.max(1,n);if($('editorFloatLock').checked)floating.h=Math.max(1,Math.round(floating.w*sourceHeight(floating.image)/sourceWidth(floating.image)));}
    if(id==='editorFloatH'){floating.h=Math.max(1,n);if($('editorFloatLock').checked)floating.w=Math.max(1,Math.round(floating.h*sourceWidth(floating.image)/sourceHeight(floating.image)));}
    dirty=true;drawOverlay();renderLayers();refreshInfo();
    for(const otherId of ['editorFloatX','editorFloatY','editorFloatW','editorFloatH'])if(otherId!==id)$(otherId).value=floating[otherId.slice(-1).toLowerCase()];
  });
  field.addEventListener('change',()=>{field.dataset.editStarted='0';if(floating&&field.dataset.editLayer===String(floating.id))syncFloatFields();});
}
$('editorFloatLock').addEventListener('change',()=>{syncFloatLockState();syncButtons();});
$('editorFloatLockInline').addEventListener('change',e=>{$('editorFloatLock').checked=e.target.checked;syncFloatLockState();syncButtons();});
syncFloatLockState();
$('editorFloatRecover').onclick=()=>{
  if(!floating)return;
  const x=Math.round((canvas.width-floating.w)/2),y=Math.round((canvas.height-floating.h)/2);
  if(floating.x===x&&floating.y===y){notice('這張圖片已位於畫布中央。');return;}
  checkpoint();floating.x=x;floating.y=y;dirty=true;
  syncFloatFields();drawOverlay();renderLayers();refreshInfo();
  notice('已將圖片移回畫布中央，保留原本大小。可以 Ctrl+Z 復原。');
};
$('editorFloatFit').onclick=()=>{if(!floating)return;checkpoint();const f=floating,ratio=Math.min(canvas.width/sourceWidth(f.image),canvas.height/sourceHeight(f.image));f.w=Math.max(1,Math.round(sourceWidth(f.image)*ratio));f.h=Math.max(1,Math.round(sourceHeight(f.image)*ratio));f.x=Math.floor((canvas.width-f.w)/2);f.y=Math.floor((canvas.height-f.h)/2);dirty=true;syncFloatFields();drawOverlay();renderLayers();refreshInfo();};
const decode=src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src;});
window.pixelEditorLoad=async (src,mode='float',name='')=>{
  const img=await decode(src);
  let picture=img;
  if($('editorCleanPaste')?.checked&&window.recoverFlattenedCheckerboard){
    const result=window.recoverFlattenedCheckerboard(img);
    if(result.detected){
      picture=result.canvas;
      $('editorCleanNote').textContent=`已移除 ${result.cleared.toLocaleString()} 個假棋盤背景像素。原圖層仍可移動或縮放。`;
      window.showMessage?.('已辨識並去除圖片中實際存在的棋盤背景。', 'success');
    }
  }
  const srcW=sourceWidth(picture),srcH=sourceHeight(picture);
  const size=fitToEditorLimits(srcW,srcH);
  if(mode==='quick-replace'){
    // A new image in quick mode intentionally replaces the old project, not silently stacks layers.
    const hadContent=layers.length>0||hasBasePixels();
    if(hadContent&&!window.confirm('要以新圖片取代目前畫布與所有圖層嗎？\n可按 Ctrl+Z 復原。'))return;
    checkpoint();
    canvas.width=size.w;canvas.height=size.h;
    ctx.clearRect(0,0,size.w,size.h);
    layers=[];baseOrder=0;baseVisible=true;baseOrderManual=false;activePaintId=null;refreshPaintCtx();floating=null;selection=null;
    const layer={id:nextLayerId++,name:name?name.replace(/\.[^.]+$/,'').slice(0,24):'快速貼圖',image:picture,x:0,y:0,w:size.w,h:size.h,visible:true};
    layers.push(layer);dirty=true;
    matchOverlay();fit();selectLayer(layer);refreshInfo();
    notice(size.limited?`來源圖片 ${srcW}×${srcH} 超過編輯安全上限，畫布已等比例縮小為 ${size.w}×${size.h}；原圖仍在圖層內。`:`已載入 ${srcW}×${srcH} 原圖，轉換時才會調整輸出解析度。`,size.limited);
    window.dispatchEvent(new CustomEvent('egame:content-change'));
    return;
  }
  if(mode==='float'){
    // Only the first import into an empty workspace adjusts the canvas. Any
    // subsequent pasted image stays on its own independently moveable layer.
    const autoSize=$('editorAutoCanvas')?.checked && layers.length===0 && !hasBasePixels();
    checkpoint();
    if(autoSize){
      canvas.width=size.w;canvas.height=size.h;
      ctx.imageSmoothingEnabled=false;
      // No bitmap was present; keep source image pixels in the editable layer.
      // Resizing the workspace must not downsample the source to 80px.
      matchOverlay();fit();
    }
    const ratio=autoSize?1:Math.min(1,canvas.width/srcW,canvas.height/srcH);
    const w=autoSize?size.w:Math.max(1,Math.round(srcW*ratio));
    const h=autoSize?size.h:Math.max(1,Math.round(srcH*ratio));
    const layer={id:nextLayerId++,name:name?name.replace(/\.[^.]+$/,'').slice(0,24):'貼上圖片',image:picture,x:Math.floor((canvas.width-w)/2),y:Math.floor((canvas.height-h)/2),w,h,visible:true};
    layers.push(layer);dirty=true;selectLayer(layer);refreshInfo();window.dispatchEvent(new CustomEvent('egame:content-change'));
    if(autoSize)notice(size.limited?`圖片 ${srcW}×${srcH} 超過編輯安全上限，已等比例調整為 ${size.w}×${size.h}。原圖仍保存在圖層來源中。`:`已按照原圖 ${srcW}×${srcH} 建立編輯畫布，直到轉換積木時才縮至輸出解析度。`,size.limited);
    else notice(`已加入可移動貼圖（來源 ${srcW}×${srcH}）；畫布維持 ${canvas.width}×${canvas.height}，可調整圖層大小。`);
    return;
  }
  if(!window.confirm('這將以新圖片取代整個畫布和現有圖層，確定要繼續嗎？'))return;
  checkpoint();canvas.width=size.w;canvas.height=size.h;ctx.clearRect(0,0,size.w,size.h);ctx.imageSmoothingEnabled=false;ctx.drawImage(picture,0,0,size.w,size.h);layers=[];floating=null;activePaintId=null;baseOrder=0;baseVisible=true;baseOrderManual=false;refreshPaintCtx();selection=null;dirty=true;matchOverlay();fit();setTool('pencil');
  if(size.limited)notice(`來源圖片 ${srcW}×${srcH} 超過編輯上限，已按比例調整為 ${size.w}×${size.h}。`,true);window.dispatchEvent(new CustomEvent('egame:content-change'));
};
window.pixelEditorPaste = src => window.pixelEditorLoad(src,'float');
$('editorCleanLayer').onclick=()=>{
  if(!floating)return;
  const cleaned=window.recoverFlattenedCheckerboard?.(floating.image);
  if(!cleaned?.detected){
    $('editorCleanNote').textContent='這張圖層沒有偵測到規律的灰白棋盤格。若背景仍是格紋，請使用含真實透明度的 PNG 原圖。';
    return;
  }
  checkpoint();floating.image=cleaned.canvas;dirty=true;
  $('editorCleanNote').textContent=`已去除 ${cleaned.cleared.toLocaleString()} 個棋盤背景像素，可按 Ctrl+Z 復原。`;
  drawOverlay();refreshInfo();
};
const dialog=$('editorSizeDialog');
function drawSizePreview(){
  const w=clamp(Math.round(+$('editorWidth').value||1),1,MAX),h=clamp(Math.round(+$('editorHeight').value||1),1,MAX);
  const image=compositeCanvas();
  const canvases=[[$('editorSizeBefore'),canvas.width,canvas.height,'before'],[$('editorSizeAfter'),w,h,'after']];
  for(const [el,cw,ch,which] of canvases){
    const g=el.getContext('2d');g.clearRect(0,0,el.width,el.height);
    g.fillStyle='#edf2f7';g.fillRect(0,0,el.width,el.height);
    const cell=12;
    for(let y=0;y<el.height;y+=cell)for(let x=0;x<el.width;x+=cell)if(((x/cell+y/cell)&1)===0){g.fillStyle='#fff';g.fillRect(x,y,cell,cell);}
    const drawW=clamp(cw,1,MAX),drawH=clamp(ch,1,MAX),factor=Math.min(174/drawW,106/drawH);
    const left=(el.width-drawW*factor)/2,top=(el.height-drawH*factor)/2;
    g.save();g.beginPath();g.rect(left,top,drawW*factor,drawH*factor);g.clip();
    g.imageSmoothingEnabled=$('editorSampling').value==='smooth';
    if(which==='before')g.drawImage(image,left,top,drawW*factor,drawH*factor);
    else if(dialogKind==='image')g.drawImage(image,left,top,drawW*factor,drawH*factor);
    else if(dialogKind==='canvas'){
      const ax=$('editorAnchor').value==='center'?(drawW-image.width)/2:0;
      const ay=$('editorAnchor').value==='center'?(drawH-image.height)/2:0;
      g.drawImage(image,left+ax*factor,top+ay*factor,image.width*factor,image.height*factor);
    }
    g.restore();g.strokeStyle='#3d77c4';g.lineWidth=2;g.strokeRect(left,top,drawW*factor,drawH*factor);
  }
  $('editorPreviewTip').textContent=dialogKind==='image'?`內容由 ${canvas.width}×${canvas.height} 縮放至 ${w}×${h}，可能拉伸變形。`:dialogKind==='canvas'?`內容不變，畫布邊界由 ${canvas.width}×${canvas.height} 變為 ${w}×${h}；超出邊界會裁掉。`:`建立 ${w}×${h} 透明空白畫布，原圖需確認才會清空。`;
}
function openDialog(kind,opts={}){
  dialogKind=kind;baseRatio=canvas.width/canvas.height;
  settingDimensions=true;$('editorWidth').value=opts.w||canvas.width;$('editorHeight').value=opts.h||canvas.height;
  $('editorLockRatio').checked=opts.lock??(kind==='image');settingDimensions=false;
  $('editorDialogTitle').textContent=kind==='new'?'建立空白畫布':kind==='image'?'縮放／拉伸圖片':'擴大／裁小畫布';
  $('editorDialogHelp').textContent=kind==='new'?'新建會清除目前圖片與圖層，但會先要求確認。':kind==='image'?'縮放整張圖片的內容；長寬可以自由調整，也可指定正方形。':'只更動畫布範圍，圖片本身不拉伸；新增空白區或裁掉邊界外內容。';
  $('editorSamplingWrap').hidden=kind!=='image';$('editorAnchorWrap').hidden=kind!=='canvas';
  $('editorDialogApply').textContent=kind==='new'?'建立新畫布…':'套用尺寸';
  dialog.hidden=false;drawSizePreview();$('editorWidth').focus();
}
$('editorImageSizeOpen').onclick=()=>openDialog('image');$('editorCanvasSizeOpen').onclick=()=>openDialog('canvas');
$('editorDialogCancel').onclick=()=>dialog.hidden=true;
dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.hidden=true;});
for(const id of ['editorWidth','editorHeight'])$(id).addEventListener('input',()=>{
  if(!settingDimensions&&$('editorLockRatio').checked){
    settingDimensions=true;const k=+$(id).value||1;
    if(id==='editorWidth')$('editorHeight').value=clamp(Math.round(k/baseRatio),1,MAX);
    else $('editorWidth').value=clamp(Math.round(k*baseRatio),1,MAX);
    settingDimensions=false;
  }
  drawSizePreview();
});
for(const b of document.querySelectorAll('[data-dialog-ratio]'))b.addEventListener('click',()=>{
  const r=b.dataset.dialogRatio;
  if(r==='free'){$('editorLockRatio').checked=false;drawSizePreview();return;}
  baseRatio=r==='original'?canvas.width/canvas.height:+r;
  $('editorLockRatio').checked=true;
  $('editorHeight').value=clamp(Math.round((+$('editorWidth').value||80)/baseRatio),1,MAX);
  drawSizePreview();
});
for(const b of document.querySelectorAll('[data-dialog-size]'))b.addEventListener('click',()=>{
  $('editorWidth').value=$('editorHeight').value=b.dataset.dialogSize;
  baseRatio=1;$('editorLockRatio').checked=true;drawSizePreview();
});
$('editorSampling').addEventListener('change',drawSizePreview);
$('editorAnchor').addEventListener('change',drawSizePreview);
$('editorDialogApply').onclick=()=>{
  const w=clamp(Math.round(+$('editorWidth').value||canvas.width),1,MAX),h=clamp(Math.round(+$('editorHeight').value||canvas.height),1,MAX);
  if(w*h>MAX_PIXELS){notice('畫布最多約 838 萬像素，請選擇較小的尺寸。',true);return;}
  if(dialogKind==='new'){
    if(!window.confirm('建立新空白畫布會清除現在的圖片及全部圖層。\n確定建立新畫布嗎？（仍可按 Ctrl+Z 復原）'))return;
    checkpoint();if($('editorAutoCanvas'))$('editorAutoCanvas').checked=false;canvas.width=w;canvas.height=h;ctx.clearRect(0,0,w,h);layers=[];floating=null;activePaintId=null;baseOrder=0;baseVisible=true;baseOrderManual=false;refreshPaintCtx();selection=null;dirty=true;matchOverlay();fit();setTool('pencil');notice(`已建立 ${w} × ${h} 的新空白畫布。`);
  }else changeCanvas(w,h,dialogKind,$('editorSampling').value,$('editorAnchor').value);
  dialog.hidden=true;
};
document.addEventListener('keydown',e=>{const typing=/INPUT|TEXTAREA|SELECT/.test(e.target.tagName);if(e.code==='Space'&&!typing){space=true;e.preventDefault();}
  if(e.key==='Escape'){if(!dialog.hidden){dialog.hidden=true;return;}if(floating){deselectLayer();return;}if(tool.value==='crop'){selection=null;setTool('pencil');return;}}
  if(!typing&&floating&&tool.value==='layer'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(dirs[e.key]){e.preventDefault();checkpoint();floating.x+=dirs[e.key][0]*(e.shiftKey?10:1);floating.y+=dirs[e.key][1]*(e.shiftKey?10:1);dirty=true;syncFloatFields();drawOverlay();refreshInfo();return;}
    if(e.key==='Delete'){e.preventDefault();removeLayer();return;}
  }
  if((e.ctrlKey||e.metaKey)&&!typing){if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}if(e.key.toLowerCase()==='y'){e.preventDefault();redo();}}
  if(!typing&&!e.ctrlKey&&!e.metaKey&&!e.altKey){const shortcuts={p:'pencil',e:'eraser',g:'fill',i:'picker',l:'line',r:'rect',o:'circle',u:'ellipse',a:'arrow',c:'crop',h:'hand',v:'layer'};if(shortcuts[e.key.toLowerCase()])setTool(shortcuts[e.key.toLowerCase()]);}
});document.addEventListener('keyup',e=>{if(e.code==='Space')space=false;});window.addEventListener('blur',()=>space=false);
matchOverlay();fit();syncButtons();
})();
