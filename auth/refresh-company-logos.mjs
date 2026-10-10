import fs from 'node:fs';
const registry=JSON.parse(fs.readFileSync('auth/company-brands.json','utf8'));
const folder='jobfinder/shared/static/company-logos';
await Promise.allSettled(Object.entries(registry).map(async([name,entry])=>{
 try{
  const origin='https://'+entry.domain;
  const homepage=await fetch(origin,{signal:AbortSignal.timeout(10000)});
  const html=await homepage.text();
  const links=[...html.matchAll(/<link\b[^>]*>/gi)].filter(m=>/rel=["'][^"']*icon/i.test(m[0])).map(m=>m[0].match(/href=["']([^"']+)/i)?.[1]).filter(Boolean);
  const candidates=[...links, '/apple-touch-icon.png','/favicon.ico'].map(path=>new URL(path,origin).href);
  for(const candidate of candidates){
   try{const response=await fetch(candidate,{signal:AbortSignal.timeout(6000)});const mime=response.headers.get('content-type')?.split(';')[0];const extensions={'image/png':'png','image/jpeg':'jpg','image/x-icon':'ico','image/vnd.microsoft.icon':'ico','image/webp':'webp'};if(!response.ok||!extensions[mime])continue;const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length<50||bytes.length>1000000)continue;const filename=entry.domain.replace(/[^a-z0-9.-]/g,'')+'.'+extensions[mime];fs.writeFileSync(folder+'/'+filename,bytes);entry.logo='/static/company-logos/'+filename;entry.logoSource=candidate;console.log(name+': official brand icon saved');return}catch{/* Try another official icon. */}
  }
  console.log(name+': official icon not available');
 }catch{console.log(name+': website unavailable')}
}));
fs.writeFileSync('auth/company-brands.json',JSON.stringify(registry,null,2)+'\n');
