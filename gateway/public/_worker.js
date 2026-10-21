// This entry point forwards only to the archive service in the same account.
const WEB_ORIGIN='https://liuhaoyuray.github.io';
const UPSTREAM='https://scholarship-archive-data.liuhaoyuray.workers.dev';
export default {async fetch(request,env){
 const url=new URL(request.url),origin=request.headers.get('Origin');
 if(origin&&origin!==WEB_ORIGIN)return new Response('请求来源无效',{status:403});
 if(!/^\/(api|archive)\//.test(url.pathname))return new Response('档案数据连接入口',{status:404});
 if(!['GET','HEAD','POST','OPTIONS'].includes(request.method))return new Response(null,{status:405});
 const cors={'Access-Control-Allow-Origin':WEB_ORIGIN,'Vary':'Origin','Access-Control-Expose-Headers':'Content-Disposition,Content-Length,Accept-Ranges,Content-Range','X-Robots-Tag':'noindex, nofollow'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET,HEAD,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-Archive-Token,Range','Access-Control-Max-Age':'600'}});
 try {
  const forwarded=new Request(UPSTREAM+url.pathname+url.search,request);
  const result=await env.ARCHIVE.fetch(forwarded);
  const headers=new Headers(result.headers);for(const [key,value] of Object.entries(cors))headers.set(key,value);
  return new Response(result.body,{status:result.status,headers});
 }catch{
  return Response.json({error:'档案数据连接暂时中断，请稍后重试'},{status:502,headers:{...cors,'Cache-Control':'no-store'}});
 }
}};
