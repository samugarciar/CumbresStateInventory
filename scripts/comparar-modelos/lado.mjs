import fs from 'node:fs';
const D=process.argv[2];
const casos=JSON.parse(fs.readFileSync(D+'/casos.json','utf8'));
const res=process.argv.slice(3).map(e=>[e,Object.fromEntries(JSON.parse(fs.readFileSync(`${D}/res-${e}.json`,'utf8')).map(r=>[r.id,r]))]);
const corto=s=>(s||'').replace(/\s+/g,' ').slice(0,700);
casos.forEach((c,i)=>{
  console.log(`\n######## ${i+1} [${new Date(c.fecha).toLocaleString('es-CO',{timeZone:'America/Bogota'})}]`);
  const prev=c.previos.slice(0,3).reverse().map(p=>`  ${p.rol}: ${corto(p.contenido).slice(0,220)}`).join('\n');
  console.log(prev);
  console.log(`>> CLIENTE: ${corto(c.mensaje)}`);
  console.log(`-- 4.1 (prod) [${c.herramientas_original.join(',')}]: ${corto(c.original)}`);
  for(const [e,m] of res){const r=m[c.id]; console.log(`-- ${e} [${r?.herramientas?.join(',')??''}] ${r?.segundos?.toFixed(0)}s: ${r?.error?'ERROR '+r.error.slice(0,200):corto(r?.output)}`);}
});
