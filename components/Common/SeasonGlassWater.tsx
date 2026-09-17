"use client";

import {useEffect, useRef} from "react";

/**
 * Turns the supplied glass-water footage into a transparent overlay at runtime.
 * The original footage has a bright background, so we derive alpha from luminance
 * and keep only the darker, moving water structures. This avoids white boxes,
 * white halos and the gray side areas from the source footage.
 */
export default function SeasonGlassWater(){
  const canvasRef=useRef<HTMLCanvasElement|null>(null);
  const videoRef=useRef<HTMLVideoElement|null>(null);

  useEffect(()=>{
    const canvas=canvasRef.current;
    const video=videoRef.current;
    if(!canvas||!video)return;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    if(!ctx)return;

    let raf=0;
    let disposed=false;
    let prev:Uint8Array|null=null;
    let width=640;
    let height=360;

    const resize=()=>{
      const scale=Math.min(1,640/(video.videoWidth||768));
      width=Math.max(320,Math.round((video.videoWidth||768)*scale));
      height=Math.max(180,Math.round((video.videoHeight||432)*scale));
      canvas.width=width;
      canvas.height=height;
    };

    const render=()=>{
      if(disposed)return;
      if(video.readyState>=2 && video.videoWidth){
        if(canvas.width!==width||canvas.height!==height)resize();
        ctx.drawImage(video,0,0,width,height);
        const image=ctx.getImageData(0,0,width,height);
        const d=image.data;
        const current=new Uint8Array(width*height);
        for(let p=0,i=0;i<d.length;i+=4,p++){
          const r=d[i],g=d[i+1],b=d[i+2];
          const l=(0.2126*r+0.7152*g+0.0722*b);
          current[p]=l;
          // Bright source background -> fully transparent. Dark water -> visible.
          let darkness=Math.max(0,Math.min(1,(178-l)/138));
          darkness=Math.pow(darkness,0.82);
          // Suppress details that do not move between frames.
          const motion=prev?Math.min(1,Math.abs(l-prev[p])/26):1;
          const motionGate=0.08+0.92*Math.sqrt(motion);
          let alpha=Math.round(255*darkness*motionGate*0.86);
          if(alpha<4)alpha=0;
          d[i]=Math.min(105,r);
          d[i+1]=Math.min(118,g);
          d[i+2]=Math.min(128,b);
          d[i+3]=alpha;
        }
        ctx.putImageData(image,0,0);
        prev=current;
      }
      raf=requestAnimationFrame(render);
    };

    const onMeta=()=>resize();
    const onEnded=()=>{
      // Never fade the overlay. Restart on the first frame; the canvas itself
      // remains transparent during the tiny seek so no white flash is visible.
      try{video.currentTime=0;void video.play()}catch{}
    };
    video.addEventListener("loadedmetadata",onMeta);
    video.addEventListener("ended",onEnded);
    video.muted=true;
    video.loop=false;
    video.playsInline=true;
    void video.play().catch(()=>{});
    raf=requestAnimationFrame(render);

    return()=>{
      disposed=true;
      cancelAnimationFrame(raf);
      video.removeEventListener("loadedmetadata",onMeta);
      video.removeEventListener("ended",onEnded);
    };
  },[]);

  return <>
    <video ref={videoRef} className="season-glass-source" src="/season-rain/autumn-glass-rain.mp4" muted playsInline preload="auto" aria-hidden="true" />
    <canvas ref={canvasRef} className="season-glass-water-canvas" aria-hidden="true" />
  </>;
}
