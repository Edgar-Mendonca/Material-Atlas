// Plot calculations without DOM or external services.
export function buildHistogram(values, requestedBins=10, logarithmic=false){
  const count=Math.max(4,Math.min(30,Number(requestedBins)||10));
  const transformed=values.filter(v=>Number.isFinite(v)&&(!logarithmic||v>0)).map(v=>logarithmic?Math.log10(v):v);
  if(!transformed.length)return {bins:[],total:0};
  let min=Math.min(...transformed),max=Math.max(...transformed);
  if(min===max){min-=0.5;max+=0.5}
  const bins=Array.from({length:count},(_,i)=>({lo:min+(max-min)*i/count,hi:min+(max-min)*(i+1)/count,n:0}));
  for(const value of transformed)bins[Math.min(count-1,Math.floor((value-min)/(max-min)*count))].n++;
  return {bins,total:transformed.length};
}

export function validWindow(window,logX=false,logY=false){
  return Boolean(window&&['xmin','xmax','ymin','ymax'].every(key=>Number.isFinite(window[key]))&&
    window.xmin<window.xmax&&window.ymin<window.ymax&&(!logX||window.xmin>0)&&(!logY||window.ymin>0));
}
