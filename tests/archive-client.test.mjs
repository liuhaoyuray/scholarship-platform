import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createArchiveClient} from '../docs/static/archive-client.mjs';
import {sliceResponse} from '../docs/static/range.mjs';
function client(){
 const students=[{sid:'23999901',name:'测试甲',college:'测试学院',aliases:[],colleges:[],awards:1,combos:[0]},{sid:'23999903',name:'测试丙',college:'测试学院',aliases:[],colleges:[],awards:1,combos:[0]}];
 const manual={id:-1,source:1,sid:'23999902',name:'测试乙',college:'新学院',award:'人工补充奖',year:'2025年'};
 const fetcher=async url=>{const p=new URL(url).pathname;let data={};
  if(p==='/archive/students.json.gz')data=students;
  if(p==='/archive/sources.json.gz')data=[{id:1,path:'虚构名单.pdf',sha:'a'.repeat(64)}];
  if(p==='/archive/meta.json')data={awards:['国家奖学金'],years:['2024年']};
  if(p==='/archive/award-students-v1.json.gz')data={'23999901':[0]};
  if(p==='/archive/award-policy-v1.json.gz')data={labels:{1:'获奖/发放依据',6:'未找到明确获奖依据'},award_students:1,award_records:1,counts:{1:1}};
  if(p==='/archive/award-status-v1.bin.gz')return new Response(gzipSync(new Uint8Array([0,1])));
  if(p==='/api/workflow/students')data={items:[manual]};
  if(p.startsWith('/api/workflow/student/'))data={reviews:[],observations:[manual]};
  return new Response(p.endsWith('.gz')?gzipSync(JSON.stringify(data)):JSON.stringify(data));
 };
 return createArchiveClient('https://isolated.test',fetcher);
}
test('manual-only students appear in search and open without a static profile',async()=>{
 const c=client(),list=await c.query('/api/students?q=23999902&scope=all');assert.equal(list.total,1);
 const detail=await c.query('/api/student/23999902');assert.equal(detail.student.name,'测试乙');assert.equal(detail.observations[0].id,-1);
});
test('manual award filters still respect identity and match year on the same award',async()=>{
 const c=client();assert.equal((await c.query('/api/students?q=不存在')).total,0);
 const query=award=>'/api/students?'+new URLSearchParams({award,year:'2025年',scope:'all'});
 assert.equal((await c.query(query('人工补充奖'))).total,1);assert.equal((await c.query(query('国家奖学金'))).total,0);
});
test('process lists and unreviewed manual entries do not count as awards',async()=>{
 const c=client();assert.equal((await c.query('/api/students')).total,1);
 assert.equal((await c.query('/api/students?q=23999903')).total,0);
 assert.equal((await c.query('/api/students?q=23999902')).total,0);
 assert.equal((await c.query('/api/students?scope=all')).total,3);
});
test('completed ranges do not wait for upstream stream cancellation',{timeout:2000},async()=>{
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array([0,1,2,3,4,5]))},cancel(){return new Promise(()=>{})}});
 const r=sliceResponse(new Response(stream),2,4);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),new Uint8Array([2,3,4]));
});

test('fast queries retain review checks without downloading the full catalog or process supplements',async()=>{
 const calls=[];const o={id:1,source:1,sid:'23999901',name:'测试甲',award:'国家奖学金',year:'2024年',record_hash:'original',sha:'a'.repeat(64),path:'虚构获奖名单.pdf',evidence_code:1};
 const fetcher=async url=>{const p=new URL(url).pathname;calls.push(p);let data;
  if(p==='/archive/meta.json')data={fast_archive_version:2,awards:['国家奖学金'],years:['2024年']};
  else if(p==='/archive/students-fast-v2.json.gz')data={colleges:['测试学院'],rows:[['23999901','测试甲',0,[0],0,[],[]]]};
  else if(p==='/api/workflow/students')data={items:[]};
  else if(p.startsWith('/archive/profiles-fast-v2/'))data={'23999901':{observations:[o],evidence_count:8}};
  else if(p.startsWith('/api/workflow/student/'))data={observations:[{...o,record_hash:'changed'}],reviews:[{observation:1,decision:'已核实',record_hash:'original',source_sha:o.sha}]};
  else throw Error('Unneeded download '+p);
  return new Response(p.endsWith('.gz')?gzipSync(JSON.stringify(data)):JSON.stringify(data));
 };
 const c=createArchiveClient('https://isolated.test',fetcher),list=await c.query('/api/students');assert.equal(list.total,1);
 const detail=await c.query('/api/student/23999901');assert.equal(detail.evidence_count,8);assert.equal(detail.candidates_loaded,false);assert.equal(detail.observations[0].evidence_code,1);assert.equal(detail.reviews[0].decision,'待核（原件或记录变更）');
 assert.ok(!calls.some(p=>/sources|candidates|\/evidence\//.test(p)));
});
