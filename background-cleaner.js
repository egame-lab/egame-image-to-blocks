// Some websites copy a PREVIEW image whose gray/white checkerboard is real RGB
// pixels. A CSS transparency grid is not part of image data; a pasted preview is.
// This deliberately changes only images with strong evidence of a regular 2-D
// alternating checkerboard, avoiding transparent PNGs and ordinary backgrounds.
(function(global){
'use strict';
function recoverCheckerboard(source){
  const width=source.naturalWidth||source.width, height=source.naturalHeight||source.height;
  if(!width||!height)return {detected:false,reason:'empty'};
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(source,0,0);
  const image=g.getImageData(0,0,width,height), p=image.data;
  const n=width*height, step=Math.max(1,Math.floor(Math.sqrt(n/90000))), hist=new Int32Array(256);
  let sample=0, realTransparent=0;
  for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step){
    const i=(y*width+x)*4,r=p[i],gr=p[i+1],b=p[i+2],a=p[i+3];
    sample++;if(a<250){realTransparent++;continue;}
    if(Math.max(r,gr,b)-Math.min(r,gr,b)<=4&&r>=175)hist[Math.round((r+gr+b)/3)]++;
  }
  if(realTransparent>sample*.01)return {detected:false,reason:'already-transparent'};
  const peaks=Array.from({length:81},(_,i)=>i+175).sort((a,b)=>hist[b]-hist[a]);
  const light=peaks[0], dark=peaks.find(v=>Math.abs(v-light)>=12&&hist[v]>=sample*.025);
  if(dark==null||hist[light]<sample*.04)return {detected:false,reason:'no-two-colors'};
  const near=(x,y)=>{
    const i=(y*width+x)*4;
    if(p[i+3]<248||Math.max(p[i],p[i+1],p[i+2])-Math.min(p[i],p[i+1],p[i+2])>8)return -1;
    const v=(p[i]+p[i+1]+p[i+2])/3;
    return Math.abs(v-light)<=5?0:Math.abs(v-dark)<=5?1:-1;
  };
  const maxSide=Math.min(64,Math.floor(Math.min(width,height)/3));
  let best=null;
  const dx=Math.max(2,Math.floor(width/33)),dy=Math.max(2,Math.floor(height/33));
  for(let side=3;side<=maxSide;side++){
    let hits=0,quad=0,probes=0;
    for(let y=2;y+side<height;y+=dy)for(let x=2;x+side<width;x+=dx){
      probes++;
      const a=near(x,y),b=near(x+side,y),d=near(x,y+side),e=near(x+side,y+side);
      if(a<0||b<0||d<0||e<0)continue;
      quad++;
      if(a===e&&b===d&&a!==b)hits++;
    }
    if(hits>=Math.max(16,probes*.03)&&hits/Math.max(1,quad)>.82){
      if(!best||hits>best.hits)best={side,hits,quad,probes};
    }
  }
  if(!best)return {detected:false,reason:'not-checkerboard'};
  let cleared=0;
  // Clear genuine checkerboard RGB, but do not touch the dark logo/colored art.
  // A pixel bordering artwork might be antialiased; leaving it opaque is safer
  // than punching holes in potentially intentional white regions.
  for(let i=0;i<p.length;i+=4){
    if(p[i+3]<245)continue;
    const r=p[i],gr=p[i+1],b=p[i+2];
    if(Math.max(r,gr,b)-Math.min(r,gr,b)>9)continue;
    const v=(r+gr+b)/3;
    if(Math.abs(v-light)<=7||Math.abs(v-dark)<=7){p[i]=p[i+1]=p[i+2]=0;p[i+3]=0;cleared++;}
  }
  if(cleared<n*.06)return {detected:false,reason:'too-few-background-pixels'};
  g.putImageData(image,0,0);
  return {detected:true,canvas:c,cleared,total:n,square:best.side,colors:[light,dark]};
}
global.recoverFlattenedCheckerboard=recoverCheckerboard;
if(typeof module==='object'&&module.exports)module.exports={recoverCheckerboard};
})(typeof window!=='undefined'?window:globalThis);
