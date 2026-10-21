import {handle} from '../backend/lib/api.mjs';
import {authorize,check,json,AppError,secureHeaders,downloadName,basename,clean} from '../backend/lib/security.mjs';
import {mintToken} from '../backend/lib/session.mjs';
import {sliceResponse} from '../docs/static/range.mjs';
const sourceFields=['id','path','actual','sha','size','ext','state','message','pages','mtime_ns'];
const observationFields=['id','source','locator','sid','name','college','award','year','year_basis','level','amount','stage','excerpt','method','record_hash'];
const all=async(db,sql,args=[])=> (await db.prepare(sql).bind(...args).all()).results;
const first=(db,sql,args=[])=>db.prepare(sql).bind(...args).first();
const run=(db,sql,args=[])=>db.prepare(sql).bind(...args).run();
const hex=data=>[...data].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function asset(request,env,path,range){
 const headers=new Headers();if(range)headers.set('Range',range);
 const r=await env.ASSETS.fetch(new Request(new URL(path,request.url),{headers}));
 check(r.ok,'该档案暂时不可用，请稍后重试',404);if(range&&r.status===200){const m=/^bytes=(\d+)-(\d+)$/.exec(range);return sliceResponse(r,Number(m[1]),Number(m[2]))}return r;
}
async function source(request,env,id){return (await asset(request,env,`/archive/sources/${id}.json`)).json()}
async function record(request,env,kind,id){
 kind+='-v2';
 check(Number.isSafeInteger(id)&&id>0,'无效记录编号');
 const offset=id%65536*12;
 const index=await asset(request,env,`/archive/${kind}/index-${String(Math.floor(id/65536)).padStart(4,'0')}.bin`,`bytes=${offset}-${offset+11}`);
 check(index.status===206,'档案读取服务尚未准备完成',503);
 const view=new DataView(await index.arrayBuffer()),block=view.getUint32(0,true),start=view.getUint32(4,true),length=view.getUint32(8,true);
 check(length>0,'找不到该记录',404);
 const data=await asset(request,env,`/archive/${kind}/${String(block).padStart(4,'0')}.bin`,`bytes=${start}-${start+length-1}`);
 check(data.status===206,'档案读取服务尚未准备完成',503);return data.json();
}
async function insertSource(db,s){
 const values=sourceFields.map(k=>k==='actual'?'':k==='mtime_ns'?0:s[k]??null);
 await run(db,`INSERT INTO sources(${sourceFields}) VALUES(${values.map(()=>'?')}) ON CONFLICT(id) DO UPDATE SET ${sourceFields.slice(1).map(k=>k+'=excluded.'+k)}`,values);
}
async function preload(request,env,body){
 let s;
 if(new URL(request.url).pathname==='/api/review'&&Number(body.id)>0){
  const o=await record(request,env,'observations',Number(body.id));s=await source(request,env,o.source);
  await insertSource(env.DB,s);
  await run(env.DB,`INSERT INTO observations(${observationFields}) VALUES(${observationFields.map(()=>'?')}) ON CONFLICT(id) DO UPDATE SET ${observationFields.slice(1).map(k=>k+'=excluded.'+k)}`,observationFields.map(k=>o[k]??null));
 }else if(body.source){
  s=await source(request,env,Number(body.source));await insertSource(env.DB,s);
  if(body.chunk_id){const ch=await record(request,env,'text',Number(body.chunk_id));check(ch.source===s.id&&ch.locator===body.locator,'原件位置不匹配');await run(env.DB,'INSERT OR REPLACE INTO chunks(id,source,locator,text,method) VALUES(?,?,?,?,?)',[ch.id,ch.source,ch.locator,ch.text,ch.method])}
 }
 return s;
}
async function original(request,env,id){
 const s=await source(request,env,id);check(s.parts?.length,'压缩包容器保留在本机，请下载其解压后的独立材料',409);
 const requested=request.headers.get('Range');let start=0,end=s.size-1;
 if(requested){const match=/^bytes=(\d*)-(\d*)$/.exec(requested);check(match&&(match[1]||match[2]),'不支持该下载范围',416);if(match[1]){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]))}else start=Math.max(0,s.size-Number(match[2]));check(start<=end&&start<s.size,'下载范围无效',416)}
 const parts=s.parts.filter(p=>p.offset<=end&&p.offset+p.length>start);
 let partIndex=0,reader;
 const stream=new ReadableStream({async pull(controller){try{while(true){if(!reader){const p=parts[partIndex++];if(!p){controller.close();return}const a=Math.max(start,p.offset)-p.offset,b=Math.min(end,p.offset+p.length-1)-p.offset;const r=await asset(request,env,p.path,`bytes=${a}-${b}`);check(r.status===206,'原件分片读取未完成',503);reader=r.body.getReader()}const {done,value}=await reader.read();if(done){reader.releaseLock();reader=null;continue}controller.enqueue(value);return}}catch(e){controller.error(e)}},async cancel(reason){await reader?.cancel(reason)}});
 const types={'.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
 const headers={...secureHeaders,'Content-Type':types[s.ext]||'application/octet-stream','Accept-Ranges':'bytes','Content-Length':String(end-start+1)};
 if(requested)headers['Content-Range']=`bytes ${start}-${end}/${s.size}`;
 if(new URL(request.url).searchParams.get('download')==='1'||!['.pdf','.jpg','.jpeg','.png'].includes(s.ext))headers['Content-Disposition']=downloadName(basename(s.path));
 let body=stream;if(typeof FixedLengthStream!=='undefined'){const fixed=new FixedLengthStream(end-start+1);stream.pipeTo(fixed.writable).catch(()=>{});body=fixed.readable}
 return new Response(body,{status:requested?206:200,headers});
}
async function exportPayload(request,env){
 const b=await request.json(),ids=b.reviews;
 check(Array.isArray(ids)&&ids.length>0&&ids.length<=30&&ids.every(Number.isSafeInteger),'请选择1至30条已核实记录');
 const rows=await all(env.DB,`SELECT r.*,o.source,o.locator,o.excerpt,o.method,o.record_hash current_hash,s.path,s.sha,s.ext,s.size,(SELECT max(id) FROM reviews r2 WHERE r2.observation=r.observation) latest_id FROM reviews r JOIN observations o ON o.id=r.observation JOIN sources s ON s.id=o.source WHERE r.id IN (${ids.map(()=>'?')})`,ids);
 check(rows.length===new Set(ids).size&&new Set(rows.map(r=>r.sid)).size===1&&new Set(rows.map(r=>r.name)).size===1,'一份证明只能包含同一学生的已核实记录');
 for(const r of rows){
  check(r.decision==='已核实'&&r.id===r.latest_id,'核验结果已更新，请刷新后重选');
  let hash=r.current_hash,sha=r.sha;
  if(r.observation>0){const offset=r.observation%16384*64,data=await asset(request,env,`/archive/hashes/${String(Math.floor(r.observation/16384)).padStart(4,'0')}.bin`,`bytes=${offset}-${offset+63}`);check(data.status===206,'档案验证服务尚未准备完成',503);const bytes=new Uint8Array(await data.arrayBuffer());hash=hex(bytes.slice(0,32));sha=hex(bytes.slice(32,64))}else sha=(await source(request,env,r.source)).sha;
  check(r.record_hash===hash&&r.source_sha===sha,'核验后原件或记录已变更，请重新核验');
 }
 const chosen=[...new Map(rows.map(r=>[JSON.stringify([r.award,r.year,r.level]),r])).values()];
 if(b.include_originals)check([...new Map(chosen.map(r=>[r.sha,r.size])).values()].reduce((a,x)=>a+x,0)<=200*1024*1024,'所选原件超过200MB，请分批导出或取消附带原件');
 const id='JZ-'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,8).toUpperCase();
 const payload={id,rows:chosen,settings:b};
 await run(env.DB,'INSERT INTO issuances VALUES(?,?,?,?)',[id,chosen[0].sid,JSON.stringify(payload),new Date().toISOString()]);return json(payload);
}
async function route(request,env){
 const path=new URL(request.url).pathname;
 await authorize(request,env);
 const rangePath=/^\/api\/range\/(text(?:-v2)?)\/(\d{4}\.bin)$/.exec(path);
 if(rangePath){const m=/^bytes=(\d+)-(\d+)$/.exec(request.headers.get('Range')||'');check(m&&Number(m[1])<=Number(m[2])&&Number(m[2])<20*1024*1024&&Number(m[2])-Number(m[1])<256*1024,'档案读取范围无效',416);const r=await asset(request,env,'/archive/'+rangePath[1]+'/'+rangePath[2],request.headers.get('Range')),bytes=await r.arrayBuffer();check(bytes.byteLength===Number(m[2])-Number(m[1])+1,'原文片段读取未完成，请重试',503);const headers=new Headers(r.headers);headers.set('Cache-Control','no-store');headers.set('Content-Length',String(bytes.byteLength));return new Response(bytes,{status:206,headers})}
 if(path==='/api/workflow/stats')return json({reviews:(await first(env.DB,'SELECT count(*) n FROM reviews')).n,issued:(await first(env.DB,'SELECT count(*) n FROM issuances')).n,token:await mintToken(env.ARCHIVE_SESSION_KEY)});
 if(path==='/api/workflow/students')return json({items:await all(env.DB,"SELECT sid,name,college,award,year FROM observations WHERE id<0 UNION SELECT sid,name,college,award,year FROM reviews WHERE id IN (SELECT max(id) FROM reviews GROUP BY observation)")});
 const student=/^\/api\/workflow\/student\/([^/]+)$/.exec(path);
 if(student){const sid=decodeURIComponent(student[1]);return json({reviews:await all(env.DB,'SELECT * FROM reviews WHERE sid=? ORDER BY id DESC',[sid]),observations:await all(env.DB,"SELECT o.*,s.path,s.sha,s.ext,s.state FROM observations o JOIN sources s ON s.id=o.source WHERE (o.sid=? AND o.id<0) OR o.id IN (SELECT observation FROM reviews WHERE sid=?)",[sid,sid])})}
 const file=/^\/api\/source\/(\d+)\/file$/.exec(path);if(file)return original(request,env,Number(file[1]));
 if(path==='/api/export'&&request.method==='POST')return exportPayload(request,env);
 if(path==='/api/history')return json({items:await all(env.DB,'SELECT id,sid,created FROM issuances ORDER BY created DESC LIMIT 100')});
 const history=/^\/api\/history\/([A-Za-z0-9-]+)\/payload$/.exec(path);
 if(history){const r=await first(env.DB,'SELECT payload FROM issuances WHERE id=?',[history[1]]);check(r,'找不到出具记录',404);return json(JSON.parse(r.payload))}
 if(['/api/review','/api/manual'].includes(path)&&request.method==='POST'){
  await preload(request,env,await request.clone().json());
  const bucket={async head(key){const sha=key.replace('original/',''),s=await first(env.DB,'SELECT * FROM sources WHERE sha=? LIMIT 1',[sha]);if(!s)return null;const current=await source(request,env,s.id);return current.parts?.length?{size:current.size,customMetadata:{sha256:current.sha}}:null}};
  return handle(request,{...env,BUCKET:bucket});
 }
 throw new AppError(404,'找不到该页面');
}
export default {async fetch(request,env){
 const origin=request.headers.get('Origin'),allowed=origin===env.ARCHIVE_WEB_ORIGIN;
 const cors=allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Expose-Headers':'Content-Disposition,Content-Length,Accept-Ranges,Content-Range','Vary':'Origin'}:{};
 if(origin&&!allowed)return new Response('请求来源无效',{status:403});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET,HEAD,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-Archive-Token,Range','Access-Control-Max-Age':'600'}});
 let response;try{response=await route(request,env)}catch(e){response=json({error:e instanceof AppError?e.message:'请求暂未完成，请稍后再试'},e.status||500)}
 const headers=new Headers(response.headers);for(const [k,v] of Object.entries(cors))headers.set(k,v);
 return new Response(response.body,{status:response.status,headers});
}};
