import {mintToken} from './session.mjs';
import {AppError,check,authorize,clean,norm,sid,name,year,like,equal,csrfCookie,json,now,basename,downloadName,secureHeaders} from './security.mjs';
import {document} from './document.mjs';
import {zip,asStream,zipLength,consumeKnownLength} from './zip.mjs';
const fields={
 sources:['id','path','actual','sha','size','ext','state','message','pages','mtime_ns'],
 students:['sid','name','college','aliases','conflict'],
 observations:['id','source','locator','sid','name','college','award','year','year_basis','level','amount','stage','excerpt','method','record_hash'],
 chunks:['id','source','locator','text','method'],meta:['key','value']
};
const integer=(v,fallback=0)=>Math.max(0,Number.isSafeInteger(Number(v))?Number(v):fallback);
const shaPattern=/^[a-f0-9]{64}$/;
const all=async(db,sql,args=[])=> (await db.prepare(sql).bind(...args).all()).results;
const first=(db,sql,args=[])=>db.prepare(sql).bind(...args).first();
const run=(db,sql,args=[])=>db.prepare(sql).bind(...args).run();
async function body(request){check(Number(request.headers.get('Content-Length')||0)<8*1024*1024,'请求过大',413);return request.json()}
async function source(db,id){const s=await first(db,'SELECT * FROM sources WHERE id=?',[id]);check(s,'找不到原始材料',404);return s}
async function verifiedObject(env,s){const obj=await env.BUCKET.head('original/'+s.sha);check(obj&&obj.customMetadata?.sha256===s.sha,'该原件尚未同步完成，请稍后刷新再试',409);check(obj.size===s.size,'原件长度与档案不一致，请重新同步并核验',409);return obj}
const observationHash=async(o)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(o))))].map(x=>x.toString(16).padStart(2,'0')).join('');

async function importRequest(request,env,path){
 const db=env.DB,u=new URL(request.url);
 if(path==='/api/import/status'){
  const result={};for(const table of ['sources','students','observations','chunks','reviews','issuances'])result[table]=(await first(db,'SELECT COUNT(*) n FROM '+table)).n;
  result.meta=Object.fromEntries((await all(db,'SELECT key,value FROM meta')).map(r=>[r.key,r.value]));return json(result);
 }
 if(path==='/api/import/rows'){
  const b=await body(request),columns=fields[b.table];check(columns&&Array.isArray(b.rows)&&b.rows.length<=1000,'无效的同步批次');
  const primary=columns[0],updates=columns.slice(1).map(c=>`${c}=excluded.${c}`).join(',');
  const perStatement=Math.floor(96/columns.length),statements=[];
  for(let start=0;start<b.rows.length;start+=perStatement){
   const rows=b.rows.slice(start,start+perStatement);check(rows.every(r=>Array.isArray(r)&&r.length===columns.length),'同步字段不完整');
   const sql=`INSERT INTO ${b.table}(${columns.join(',')}) VALUES ${rows.map(()=>`(${columns.map(()=>'?').join(',')})`).join(',')} ON CONFLICT(${primary}) DO UPDATE SET ${updates}`;
   statements.push(db.prepare(sql).bind(...rows.flat()));
  }
  if(statements.length)await db.batch(statements);
  return json({ok:true,rows:b.rows.length});
 }
 if(path==='/api/import/source-reset'){
  const b=await body(request);check(Array.isArray(b.sources)&&b.sources.length<=100&&b.sources.every(Number.isSafeInteger),'无效材料列表');
  const statements=b.sources.map(id=>db.prepare('DELETE FROM chunks WHERE source=?').bind(id));
  if(statements.length)await db.batch(statements);return json({ok:true});
 }
 if(path==='/api/import/objects/exists'){
  const b=await body(request);check(Array.isArray(b.shas)&&b.shas.length<=100,'无效原件列表');
  const found=await Promise.all(b.shas.map(async sha=>{check(shaPattern.test(sha),'无效原件编号');return await env.BUCKET.head('original/'+sha)?sha:null}));
  return json({present:found.filter(Boolean)});
 }
 if(path==='/api/import/multipart/start'){
  const b=await body(request);check(shaPattern.test(b.sha),'无效原件编号');const upload=await env.BUCKET.createMultipartUpload('original/'+b.sha,{customMetadata:{sha256:b.sha}});
  return json({uploadId:upload.uploadId});
 }
 const multipart=/^\/api\/import\/multipart\/([a-f0-9]{64})\/([^/]+)(?:\/(\d+))?$/.exec(path);
 if(multipart){
  const upload=env.BUCKET.resumeMultipartUpload('original/'+multipart[1],decodeURIComponent(multipart[2]));
  if(request.method==='PUT'&&multipart[3])return json(await consumeKnownLength(request.body,Number(request.headers.get('Content-Length')),stream=>upload.uploadPart(Number(multipart[3]),stream)));
  const b=await body(request);check(Array.isArray(b.parts)&&b.parts.length<=10000,'分片信息无效');await upload.complete(b.parts);return json({ok:true});
 }
 const object=/^\/api\/import\/object\/([a-f0-9]{64})$/.exec(path);
 if(object&&request.method==='PUT'){
  await consumeKnownLength(request.body,Number(request.headers.get('Content-Length')),stream=>env.BUCKET.put('original/'+object[1],stream,{sha256:object[1],customMetadata:{sha256:object[1]}}));return json({ok:true});
 }
 throw new AppError(404,'找不到同步接口');
}

export async function handle(request,env){
 try{
  const user=await authorize(request,env),u=new URL(request.url),path=u.pathname,db=env.DB;
  check(db&&env.BUCKET,'线上档案库正在准备，请稍后再试',503);
  if(path.startsWith('/api/import/'))return await importRequest(request,env,path);
  if(path==='/api/stats'){
   const meta=Object.fromEntries((await all(db,'SELECT key,value FROM meta')).map(r=>[r.key,r.value]));
   let stats={};try{stats=JSON.parse(meta.online_stats||'{}')}catch{}
   for(const [key,table] of [['files','sources'],['students','students'],['observations','observations'],['reviews','reviews'],['issued','issuances']])stats[key]=(await first(db,'SELECT COUNT(*) n FROM '+table)).n;
   if(!stats.states)stats.states=Object.fromEntries((await all(db,'SELECT state,COUNT(*) n FROM sources GROUP BY state')).map(r=>[r.state,r.n]));
   stats.awards||=[];stats.years||=[];stats.stages||={};stats.meta={...meta,root:undefined,online_stats:undefined};
   const token=await mintToken(env.ARCHIVE_SESSION_KEY);stats.token=token;
   return json(stats);
  }
  if(path==='/api/students'){
   const q=norm(u.searchParams.get('q')||''),college=clean(u.searchParams.get('college')),clauses=[],args=[];
   if(q){clauses.push("(s.sid LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR s.aliases LIKE ? ESCAPE '\\')");args.push(...Array(3).fill(like(q)))}
   if(college){clauses.push("(s.college LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM observations o WHERE o.sid=s.sid AND o.college LIKE ? ESCAPE '\\'))");args.push(like(college),like(college))}
   const filters=[];for(const key of ['year','award'])if(u.searchParams.get(key)){filters.push('o.'+key+'=?');args.push(u.searchParams.get(key))}
   if(filters.length)clauses.push('EXISTS(SELECT 1 FROM observations o WHERE o.sid=s.sid AND '+filters.join(' AND ')+')');
   const where=clauses.length?' WHERE '+clauses.join(' AND '):'',offset=integer(u.searchParams.get('offset'));
   const total=(await first(db,'SELECT COUNT(*) n FROM students s'+where,args)).n;
   const items=await all(db,"SELECT s.*,(SELECT COUNT(DISTINCT award||year) FROM observations o WHERE o.sid=s.sid AND o.stage NOT IN ('参考材料','未获奖/放弃')) awards FROM students s"+where+" ORDER BY (s.name=''),s.name,s.sid LIMIT 50 OFFSET ?",[...args,offset]);
   return json({total,items,offset});
  }
  const student=/^\/api\/student\/([^/]+)$/.exec(path);
  if(student){
   const id=decodeURIComponent(student[1]),s=await first(db,'SELECT * FROM students WHERE sid=?',[id]);check(s,'找不到学生档案',404);
   const observations=await all(db,"SELECT o.*,s.path,s.sha,s.ext,s.state FROM observations o JOIN sources s ON s.id=o.source WHERE o.sid=? ORDER BY o.year DESC,o.award,CASE o.stage WHEN '获奖/发放记录' THEN 0 WHEN '公示材料' THEN 1 WHEN '申请/推荐' THEN 2 ELSE 3 END,o.source",[id]);
   const reviews=await all(db,'SELECT r.*,s.sha current_sha,o.record_hash current_hash FROM reviews r JOIN observations o ON o.id=r.observation JOIN sources s ON s.id=o.source WHERE r.sid=? ORDER BY r.id DESC',[id]);
   for(const r of reviews)if(r.decision==='已核实'&&(r.source_sha!==r.current_sha||r.record_hash!==r.current_hash))r.decision='待核（原件或记录变更）';
   const candidates=s.name?await all(db,"SELECT o.*,s.path,s.sha,s.ext,s.state FROM observations o JOIN sources s ON s.id=o.source WHERE o.name=? AND o.sid='' LIMIT 80",[s.name]):[];
   const evidence=await all(db,"SELECT ch.source,ch.locator,substr(ch.text,max(1,instr(ch.text,?)-80),550) excerpt,ch.method,s.path,s.ext FROM fulltext f JOIN chunks ch ON ch.id=f.rowid JOIN sources s ON s.id=ch.source WHERE fulltext MATCH ? LIMIT 150",[id,'"'+id.replaceAll('"','""')+'"']);
   return json({student:s,observations,reviews,candidates,evidence});
  }
  if(path==='/api/files'){
   const clauses=[],args=[];if(u.searchParams.get('q')){clauses.push("path LIKE ? ESCAPE '\\'");args.push(like(u.searchParams.get('q')))}if(u.searchParams.get('state')){clauses.push('state=?');args.push(u.searchParams.get('state'))}
   const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
   return json({total:(await first(db,'SELECT COUNT(*) n FROM sources'+where,args)).n,items:await all(db,'SELECT id,path,ext,size,sha,state,message,pages FROM sources'+where+' ORDER BY path LIMIT 60 OFFSET ?',[...args,integer(u.searchParams.get('offset'))])});
  }
  if(path==='/api/search'){
   const q=clean(u.searchParams.get('q')).slice(0,120),offset=integer(u.searchParams.get('offset'));if(!q)return json({items:[],offset});
   const select='SELECT ch.source,ch.locator,substr(ch.text,max(1,instr(ch.text,?)-80),600) excerpt,ch.method,s.path,s.ext FROM ';
   const items=q.length>=3?await all(db,select+'fulltext f JOIN chunks ch ON ch.id=f.rowid JOIN sources s ON s.id=ch.source WHERE fulltext MATCH ? LIMIT 60 OFFSET ?',[q,'"'+q.replaceAll('"','""')+'"',offset]):await all(db,select+"chunks ch JOIN sources s ON s.id=ch.source WHERE ch.text LIKE ? ESCAPE '\\' LIMIT 60 OFFSET ?",[q,like(q),offset]);
   return json({items,offset});
  }
  const material=/^\/api\/source\/(\d+)(?:\/(file))?$/.exec(path);
  if(material){
   const s=await source(db,Number(material[1]));
   if(material[2]){
    await verifiedObject(env,s);const headers=new Headers(secureHeaders);const types={'.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
    headers.set('Content-Type',types[s.ext]||'application/octet-stream');headers.set('Accept-Ranges','bytes');
    if(u.searchParams.get('download')==='1'||!['.pdf','.jpg','.png','.jpeg'].includes(s.ext))headers.set('Content-Disposition',downloadName(basename(s.path)));
    const object=await env.BUCKET.get('original/'+s.sha,{range:request.headers});check(object,'原件尚未同步',409);
    if(object.range){const offset=object.range.offset||0,length=object.range.length||s.size;headers.set('Content-Range',`bytes ${offset}-${offset+length-1}/${s.size}`);headers.set('Content-Length',String(length))}else headers.set('Content-Length',String(object.size));
    return new Response(object.body,{status:object.range?206:200,headers});
   }
   const chunks=await all(db,'SELECT locator,text,method FROM chunks WHERE source=? LIMIT 5000',[s.id]);const locator=u.searchParams.get('locator');if(locator&&!chunks.some(c=>c.locator===locator)){const target=await first(db,'SELECT locator,text,method FROM chunks WHERE source=? AND locator=? LIMIT 1',[s.id,locator]);if(target)chunks.unshift(target)}
   const object=await env.BUCKET.head('original/'+s.sha);s.actual=undefined;s.online_available=!!object;if(!object)s.message=(s.message||'')+'；此原件正在同步，完成后即可在线预览和下载';
   return json({source:s,chunks});
  }
  if(path==='/api/manual'&&request.method==='POST'){
   const b=await body(request),v=Object.fromEntries(['sid','name','college','award','year','level'].map(k=>[k,clean(b[k])]));v.sid=sid(v.sid);check(v.sid&&name(v.name)&&v.award,'请填写有效学号、姓名和奖项');
   const s=await source(db,integer(b.source));let chunk=await first(db,'SELECT text,method FROM chunks WHERE source=? AND locator=? LIMIT 1',[s.id,b.locator]);
   if(!chunk){const page=/^第(\d+)页$/.exec(b.locator||'');if(page&&['.pdf','.png','.jpg','.jpeg'].includes(s.ext)&&Number(page[1])>=1&&Number(page[1])<=s.pages){await verifiedObject(env,s);chunk={text:'此页尚无识别正文，请直接核对原件。',method:'人工核对原件页码'}}}
   check(chunk,'该位置无法定位原件，请先完成同步或选择有效页码');
   const existing=await first(db,'SELECT id FROM observations WHERE source=? AND locator=? AND sid=? AND name=? AND award=?',[s.id,b.locator,v.sid,v.name,v.award]);
   const id=existing?.id||-(Math.floor(Math.random()*Number.MAX_SAFE_INTEGER/4)+1),record_hash=await observationHash({...v,source:s.id,locator:b.locator,excerpt:chunk.text});
   if(!existing)await run(db,'INSERT INTO observations(id,source,locator,sid,name,college,award,year,year_basis,level,amount,stage,excerpt,method,record_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,s.id,b.locator,v.sid,v.name,v.college,v.award,v.year,'人工录入（待核）',v.level,'','待核材料',chunk.text.slice(0,2500),'人工定位登记',record_hash]);
   await run(db,'INSERT OR IGNORE INTO students VALUES(?,?,?,?,0)',[v.sid,v.name,v.college,JSON.stringify([v.name])]);return json({id});
  }
  if(path==='/api/review'&&request.method==='POST'){
   const b=await body(request);check(['已核实','排除','待核'].includes(b.decision),'请选择核验结果');check(clean(b.note)&&clean(b.reviewer),'请填写核验依据和经办人');
   const o=await first(db,'SELECT * FROM observations WHERE id=?',[b.id]);check(o,'找不到待核验记录',404);const s=await source(db,o.source);if(b.decision==='已核实')await verifiedObject(env,s);
   const v=Object.fromEntries(['sid','name','college','award','year','level'].map(k=>[k,clean(b[k]??o[k])]));v.sid=sid(v.sid);
   if(b.decision==='已核实')check(v.sid&&name(v.name)&&v.award&&year(v.year),'请确认有效学号、姓名、奖项和明确年度，如2024年或2023-2024学年');
   await run(db,'INSERT INTO reviews(observation,sid,name,college,award,year,level,decision,note,reviewer,created,source_sha,record_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[o.id,v.sid,v.name,v.college,v.award,v.year,v.level,b.decision,clean(b.note).slice(0,2000),clean(b.reviewer).slice(0,60),now(),s.sha,o.record_hash]);return json({ok:true});
  }
  if(path==='/api/export'&&request.method==='POST'){
   const b=await body(request),ids=b.reviews;check(Array.isArray(ids)&&ids.length>=1&&ids.length<=30&&ids.every(Number.isSafeInteger),'请选择1至30条已核实记录');
   const rows=await all(db,`SELECT r.*,o.source,o.locator,o.excerpt,o.method,o.record_hash current_hash,s.path,s.sha,s.ext,s.size FROM reviews r JOIN observations o ON o.id=r.observation JOIN sources s ON s.id=o.source WHERE r.id IN (${ids.map(()=>'?').join(',')})`,ids);
   check(rows.length===new Set(ids).size&&new Set(rows.map(r=>r.sid)).size===1&&new Set(rows.map(r=>r.name)).size===1,'一份证明只能包含同一学生的已核实记录');
   for(const r of rows){const latest=await first(db,'SELECT id,decision FROM reviews WHERE observation=? ORDER BY id DESC LIMIT 1',[r.observation]);check(latest.id===r.id&&latest.decision==='已核实','记录已有新的核验结果，请刷新后重选');check(r.source_sha===r.sha&&r.record_hash===r.current_hash,'核验后原件或记录已变更，请重新核验');await verifiedObject(env,r)}
   const chosen=[...new Map(rows.map(r=>[JSON.stringify([r.award,r.year,r.level]),r])).values()];
   const number='JZ-'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,8).toUpperCase(),doc=await document(chosen,b,number);
   const isDoc=b.format==='docx',suffix=isDoc?'.docx':'.zip',mime=isDoc?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/zip';
   let data=doc,length=doc.length;
   if(!isDoc){
    const entries=[{name:'获奖证明草稿.docx',body:doc}],seen=new Set();let size=0;
    for(let i=0;i<chosen.length;i++){const r=chosen[i];entries.push({name:`佐证/${String(i+1).padStart(2,'0')}-定位摘录.txt`,body:`原件：${r.path}\n位置：${r.locator}\nSHA-256：${r.sha}\n\n${r.excerpt}\n\n此为定位摘录，原件以档案为准。`});if(b.include_originals&&!seen.has(r.sha)){size+=r.size;check(size<=200*1024*1024,'所选原件超过200MB，请分批导出或取消附带原件');seen.add(r.sha);entries.push({name:`原件/${String(i+1).padStart(2,'0')}-${basename(r.path)}`,size:r.size,body:async()=>{const object=await env.BUCKET.get('original/'+r.sha);check(object,'原件暂时不可用',409);return object.body}})}}
    entries.push({name:'材料目录.json',body:JSON.stringify(chosen.map(r=>Object.fromEntries(['name','sid','award','year','level','path','locator','sha','method','reviewer','created','note'].map(k=>[k,r[k]]))),null,2)});length=zipLength(entries);data=asStream(zip(entries));
   }
   if(isDoc)await env.BUCKET.put('exports/'+number+suffix,data,{httpMetadata:{contentType:mime}});
   else await consumeKnownLength(data,length,stream=>env.BUCKET.put('exports/'+number+suffix,stream,{httpMetadata:{contentType:mime}}));
   await run(db,'INSERT INTO issuances VALUES(?,?,?,?)',[number,chosen[0].sid,JSON.stringify({rows:chosen.map(r=>r.id),file:number+suffix,settings:b}),now()]);
   const object=await env.BUCKET.get('exports/'+number+suffix);return new Response(object.body,{headers:{...secureHeaders,'Content-Type':mime,'Content-Disposition':downloadName(number+suffix)}});
  }
  if(path==='/api/history')return json({items:await all(db,'SELECT * FROM issuances ORDER BY created DESC LIMIT 100')});
  const history=/^\/api\/history\/([A-Za-z0-9-]+)\/download$/.exec(path);
  if(history){const row=await first(db,'SELECT payload FROM issuances WHERE id=?',[history[1]]);check(row,'找不到出具记录',404);const file=JSON.parse(row.payload).file;check(/^JZ-[A-Za-z0-9-]+\.(?:zip|docx)$/.test(file),'无效出具记录');const object=await env.BUCKET.get('exports/'+file);check(object,'历史材料不存在',404);return new Response(object.body,{headers:{...secureHeaders,'Content-Disposition':downloadName(file),'Content-Type':file.endsWith('.zip')?'application/zip':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}})}
  throw new AppError(404,'找不到该页面');
 }catch(error){if(!(error instanceof AppError))console.error('Archive request failed:',error.message);return json({error:error instanceof AppError?error.message:'请求暂未完成，请稍后重试'},error.status||500)}
}
