export function createConnection(bases,fetcher=fetch,{probeTimeout=30000}={}){
 const endpoints=[...new Set(bases.filter(Boolean).map(x=>String(x).replace(/\/$/,'')))];
 let active=endpoints[0]||'',ready=false,connecting,probedMeta;
 function unavailable(write=false){const e=Error(write?'连接中断，操作结果尚未确认。请刷新核验记录后再试，避免重复提交。':'暂时无法连接档案库。请点击“重新连接”重试，或换一个网络后再试。');e.code='ARCHIVE_CONNECTION';return e}
 async function select(){
  if(ready)return active;
  if(!connecting)connecting=(async()=>{
   if(!endpoints.length)throw unavailable();
   const controllers=endpoints.map(()=>new AbortController());
   try{
    const winner=await Promise.any(endpoints.map(async(base,i)=>{
     const timer=setTimeout(()=>controllers[i].abort(),probeTimeout);
     try{const r=await fetcher(base+'/archive/meta.json',{signal:controllers[i].signal,cache:'no-store',redirect:'error'});if(!r.ok)throw Error('unavailable');const m=await r.json();if(!Number.isFinite(m.students)||!Number.isFinite(m.files))throw Error('invalid archive');return {base,meta:m}}finally{clearTimeout(timer)}
    }));active=winner.base;probedMeta=winner.meta;ready=true;return active;
   }catch{throw unavailable()}finally{controllers.forEach((c,i)=>{if(!ready||endpoints[i]!==active)c.abort()});connecting=null}
  })();
  return connecting;
 }
 async function request(input,options){
  await select();
  const original=String(input),base=endpoints.find(b=>original===b||original.startsWith(b+'/'));
  if(!base)throw Error('无效档案地址');
  if(new URL(original).pathname==='/archive/meta.json'&&probedMeta)return Response.json(probedMeta);
  const suffix=original.slice(base.length),write=!['GET','HEAD'].includes(String(options?.method||'GET').toUpperCase());
  try{return await fetcher(active+suffix,options)}catch{ready=false;throw unavailable(write)}
 }
 return {fetch:request,url:path=>active+path,connect:select};
}
