import {sliceResponse} from './range.mjs';
const decoder=new TextDecoder();
export function decodeIds(encoded){const bytes=Uint8Array.from(atob(encoded||''),c=>c.charCodeAt(0)),ids=[];let n=0,shift=0,last=0;for(const b of bytes){n|=(b&127)<<shift;if(b&128)shift+=7;else{last+=n;ids.push(last);n=0;shift=0}}return ids}
function intersect(a,b){let i=0,j=0,out=[];while(i<a.length&&j<b.length){if(a[i]===b[j]){out.push(a[i]);i++;j++}else if(a[i]<b[j])i++;else j++}return out}
async function pool(items,fn,limit=6){const out=Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i])}}));return out}
export function createArchiveClient(base,fetcher=fetch,assetBase=base){
 const cache=new Map(),sourceById=new Map();
 const url=p=>(p.startsWith('/archive/')?assetBase:base).replace(/\/$/,'')+p+(p.startsWith('/archive/')?'?v=review2':'');
 async function response(path,options){const r=await fetcher(url(path),path.startsWith('/api/')||path==='/archive/meta.json'?{...options,cache:'no-store'}:options);if(!r.ok){let message='档案暂时无法读取，请稍后再试';try{message=(await r.json()).error||message}catch{}throw Error(message)}const range=new Headers(options?.headers).get('Range'),m=/^bytes=(\d+)-(\d+)$/.exec(range||'');return m&&r.status===200?sliceResponse(r,Number(m[1]),Number(m[2])):r}
 function cached(key,load){if(!cache.has(key))cache.set(key,load().catch(e=>{cache.delete(key);throw e}));return cache.get(key)}
 async function json(path){return cached(path,async()=>{const r=await response(path),bytes=new Uint8Array(await r.arrayBuffer());let data=bytes;if(bytes[0]===31&&bytes[1]===139)data=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());return JSON.parse(decoder.decode(data))})}
 const meta=()=>json('/archive/meta.json');
 async function students(includeProcess=false){
  if(!includeProcess&&(await meta()).fast_archive_version===2){const d=await json('/archive/students-fast-v2.json.gz');return d.rows.map(([sid,name,college,strictCombos,conflict,aliases,colleges])=>({sid,name,college:d.colleges[college],strictCombos,conflict,aliases:[name,...aliases],colleges:[d.colleges[college],...colleges.map(i=>d.colleges[i])],combos:[]}))}
  return json('/archive/students.json.gz');
 }
 const policy=()=>json('/archive/award-policy-v1.json.gz');
 const awardPairs=()=>json('/archive/award-students-v1.json.gz');
 const awardCodes=()=>cached('award-codes',async()=>{const r=await response('/archive/award-status-v1.bin.gz');return new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())});
 async function mergedStudents(includeProcess=false){
  const fast=!includeProcess&&(await meta()).fast_archive_version===2;
  const [list,workflow,pairs]=await Promise.all([students(includeProcess),response('/api/workflow/students').then(r=>r.json()),fast?{}:awardPairs()]);
  const merged=new Map(list.map(s=>[s.sid,{...s,aliases:[...s.aliases],colleges:[...s.colleges],strictCombos:s.strictCombos||pairs[s.sid]||[],awards:0,extraPairs:[],verifiedPairs:[]}]));
  for(const row of workflow.items){let s=merged.get(row.sid);if(!s){s={sid:row.sid,name:row.name,college:row.college,aliases:[],colleges:[],combos:[],strictCombos:[],awards:0,extraPairs:[],verifiedPairs:[]};merged.set(s.sid,s)}
   if(row.name&&!s.aliases.includes(row.name))s.aliases.push(row.name);if(row.college&&!s.colleges.includes(row.college))s.colleges.push(row.college);
   if(!s.extraPairs.some(p=>p[0]===row.award&&p[1]===row.year))s.extraPairs.push([row.award,row.year]);
   if(row.decision==='已核实'&&!s.verifiedPairs.some(p=>p[0]===row.award&&p[1]===row.year))s.verifiedPairs.push([row.award,row.year]);
  }
  const m=await meta();return [...merged.values()].map(s=>({...s,awards:new Set([...s.strictCombos.map(code=>JSON.stringify([m.awards[code%m.awards.length],m.years[Math.floor(code/m.awards.length)]])),...s.verifiedPairs.map(p=>JSON.stringify(p))]).size}));
 }
 async function sources(){const list=await json('/archive/sources.json.gz');for(const s of list)sourceById.set(s.id,s);return list}
 async function source(id){id=Number(id);let s=sourceById.get(id);if(!s){s=await json('/archive/sources/'+id+'.json');sourceById.set(id,s)}return s}
 async function bucket(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)));return new Uint8Array(bytes)[0].toString(16).padStart(2,'0')}
 async function index(){return cached('text-index',async()=>{const r=await response('/archive/text-v2-index.bin.gz');const bytes=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();return new Uint32Array(bytes)})}
 async function rows(ids){
  if(!ids.length)return [];
  const idx=await index(),groups=[];
  for(const id of ids){const [block,start,length]=idx.subarray(id*3,id*3+3);if(!length)continue;let group=groups.at(-1);if(!group||group.block!==block||start<group.start||start>group.end+1024||start+length-group.start>256*1024){group={block,start,end:start+length,items:[]};groups.push(group)}else group.end=Math.max(group.end,start+length);group.items.push({id,start,length})}
  const result=await pool(groups,async g=>{const r=await response(`/api/range/text-v2/${String(g.block).padStart(4,'0')}.bin`,{headers:{Range:`bytes=${g.start}-${g.end-1}`}});if(r.status!==206)throw Error('原文读取服务尚未就绪');const data=new Uint8Array(await r.arrayBuffer());return g.items.map(x=>JSON.parse(decoder.decode(data.subarray(x.start-g.start,x.start-g.start+x.length))))});
  const found=new Map(result.flat().map(r=>[r.id,r]));return ids.map(id=>found.get(id)).filter(Boolean);
 }
 async function search(q,offset=0,limit=60){
  q=String(q||'').replace(/\s+/g,' ').trim().slice(0,120);if(!q)return [];
  const chars=Array.from(q.toLowerCase());if(chars.length<2)throw Error('请至少输入两个字，或完整学号，以便定位具体材料');
  const terms=chars.length===2?[chars.join('')]:[...new Set(chars.slice(0,-2).map((_,i)=>chars.slice(i,i+3).join('')))];
  const lists=await Promise.all(terms.map(async term=>{const data=await json('/archive/search/'+await bucket(Array.from(term).slice(0,2).join(''))+'.json.gz');if(chars.length===2)return [...new Set(Object.entries(data).filter(([key])=>key.startsWith(term)).flatMap(([,value])=>decodeIds(value)))].sort((a,b)=>a-b);return decodeIds(data[term])}));
  lists.sort((a,b)=>a.length-b.length);let ids=lists[0]||[];for(const list of lists.slice(1)){ids=intersect(ids,list);if(!ids.length)break}
  const found=[];let seen=0;await sources();
  for(let start=0;start<ids.length&&found.length<limit;start+=60){for(const row of await rows(ids.slice(start,start+60))){const at=row.text.toLowerCase().indexOf(q.toLowerCase());if(at<0)continue;if(seen++<offset)continue;const s=sourceById.get(row.source);found.push({source:row.source,locator:row.locator,excerpt:row.text.slice(Math.max(0,at-80),Math.max(0,at-80)+600),method:row.method,path:s?.path||'',ext:s?.ext||''});if(found.length===limit)break}}
  return found;
 }
 async function query(path){
  const u=new URL(path,'https://archive.invalid'),p=u.pathname,offset=Math.max(0,Number(u.searchParams.get('offset'))||0);
  if(p==='/api/stats'){const [m,r,rule]=await Promise.all([meta(),response('/api/workflow/stats').then(r=>r.json()),policy()]);return {...m,...r,archive_students:m.students,students:rule.award_students,evidence_records:rule.award_records,policy_counts:rule.counts}}
  if(p==='/api/students'){
   const includeProcess=u.searchParams.get('scope')==='all';
   const [list,m]=await Promise.all([mergedStudents(includeProcess),meta()]),q=(u.searchParams.get('q')||'').replace(/\s+/g,'').toLowerCase(),college=(u.searchParams.get('college')||'').trim().toLowerCase(),award=u.searchParams.get('award'),year=u.searchParams.get('year');
   const matches=list.filter(s=>{const combos=includeProcess?s.combos:s.strictCombos,pairs=includeProcess?s.extraPairs:s.verifiedPairs;return (includeProcess||combos.length||pairs.length)&&(!q||[s.sid,s.name,...s.aliases].some(x=>String(x).toLowerCase().includes(q)))&&(!college||[s.college,...s.colleges].some(x=>String(x).toLowerCase().includes(college)))&&(!award&&!year||combos.some(code=>(!award||m.awards[code%m.awards.length]===award)&&(!year||m.years[Math.floor(code/m.awards.length)]===year))||pairs.some(p=>(!award||p[0]===award)&&(!year||p[1]===year)))});
   return {total:matches.length,items:matches.slice(offset,offset+50),offset};
  }
  const student=/^\/api\/student\/([^/]+)$/.exec(p);
  if(student){
   const sid=decodeURIComponent(student[1]);let s=(await mergedStudents()).find(s=>s.sid===sid);if(!s)s=(await mergedStudents(true)).find(s=>s.sid===sid);if(!s)throw Error('找不到学生档案');
   if((await meta()).fast_archive_version===2){
    const [data,workflow]=await Promise.all([json('/archive/profiles-fast-v2/'+await bucket(sid)+'.json.gz'),response('/api/workflow/student/'+encodeURIComponent(sid)).then(r=>r.json())]);
    const item=data[sid]||{observations:[],evidence_count:0};
    const byId=new Map(item.observations.map(o=>[o.id,o]));for(const o of workflow.observations||[])byId.set(o.id,{...byId.get(o.id),...o});
    const reviews=workflow.reviews||[];for(const r of reviews){const o=byId.get(r.observation);if(r.decision==='已核实'&&(!o||r.record_hash!==o.record_hash||r.source_sha!==o.sha))r.decision='待核（原件或记录变更）'}
    return {student:s,observations:[...byId.values()],reviews,candidates:[],candidates_loaded:false,evidence:[],evidence_count:item.evidence_count};
   }
   const [data,candidate,evidence,workflow,codes,rule]=await Promise.all([json('/archive/profiles/'+await bucket(sid)+'.json.gz'),json('/archive/candidates/'+(parseInt(await bucket(s.name),16)%128).toString(16).padStart(2,'0')+'.json.gz'),json('/archive/evidence/'+await bucket(sid)+'.json.gz'),response('/api/workflow/student/'+encodeURIComponent(sid)).then(r=>r.json()),awardCodes(),policy()]);
   await sources();const enrich=o=>({...o,...Object.fromEntries(['path','sha','ext','state'].map(k=>[k,sourceById.get(o.source)?.[k]])),evidence_code:codes[o.id]||6,evidence_label:rule.labels[codes[o.id]||6]});
   const byId=new Map([...(data[sid]||[]).map(enrich),...(workflow.observations||[]).map(enrich)].map(o=>[o.id,o])),observations=[...byId.values()];
   const reviews=workflow.reviews||[];for(const r of reviews){const o=byId.get(r.observation);if(r.decision==='已核实'&&(!o||r.record_hash!==o.record_hash||r.source_sha!==o.sha))r.decision='待核（原件或记录变更）'}
   return {student:s,observations,reviews,candidates:(candidate[s.name]||[]).map(enrich),evidence:[],evidence_count:decodeIds(evidence[sid]).length};
  }
  const candidatesRequest=/^\/api\/candidates\/([^/]+)$/.exec(p);
  if(candidatesRequest){const sid=decodeURIComponent(candidatesRequest[1]);let s=(await mergedStudents()).find(s=>s.sid===sid);if(!s)s=(await mergedStudents(true)).find(s=>s.sid===sid);if(!s)throw Error('找不到学生档案');const [data,codes,rule]=await Promise.all([json('/archive/candidates/'+(parseInt(await bucket(s.name),16)%128).toString(16).padStart(2,'0')+'.json.gz'),awardCodes(),policy()]);await sources();return {items:(data[s.name]||[]).map(o=>({...o,...Object.fromEntries(['path','sha','ext','state'].map(k=>[k,sourceById.get(o.source)?.[k]])),evidence_code:codes[o.id]||6,evidence_label:rule.labels[codes[o.id]||6]}))}}
  const evidenceRequest=/^\/api\/evidence\/([^/]+)$/.exec(p);
  if(evidenceRequest){const sid=decodeURIComponent(evidenceRequest[1]),data=await json('/archive/evidence/'+await bucket(sid)+'.json.gz');await sources();return {items:(await rows(decodeIds(data[sid]).slice(0,150))).map(r=>({source:r.source,locator:r.locator,excerpt:r.text.slice(Math.max(0,r.text.indexOf(sid)-80),Math.max(0,r.text.indexOf(sid)-80)+550),method:r.method,path:sourceById.get(r.source)?.path||'',ext:sourceById.get(r.source)?.ext||''}))}}
  if(p==='/api/files'){const q=(u.searchParams.get('q')||'').toLowerCase(),state=u.searchParams.get('state');const matches=(await sources()).filter(s=>(!q||s.path.toLowerCase().includes(q))&&(!state||s.state===state)).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);return {total:matches.length,items:matches.slice(offset,offset+60),offset}}
  if(p==='/api/search')return {items:await search(u.searchParams.get('q'),offset),offset};
  const material=/^\/api\/source\/(\d+)$/.exec(p);
  if(material){const s=await source(material[1]),map=await json('/archive/source-chunks/'+(s.id%128).toString(16).padStart(2,'0')+'.json.gz'),locators=map[s.id]||[],locator=u.searchParams.get('locator'),target=locator?locators.find(x=>x[1]===locator):null,chosen=target?[target]:locators.slice(0,30);const chunks=await rows(chosen.map(x=>x[0]));return {source:{...s,message:[s.message,locators.length>chosen.length?'已展示选中位置或前30处原文；可检索其他位置或下载完整原件。':''].filter(Boolean).join('；')},chunks}}
  return null;
 }
 return {query,search,rows,meta};
}
