import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createArchiveClient} from '../docs/static/archive-client.mjs';
import {sliceResponse} from '../docs/static/range.mjs';
function client(){
 const students=[{sid:'23999901',name:'测试甲',college:'测试学院',aliases:[],colleges:[],awards:1,combos:[0]}];
 const manual={id:-1,source:1,sid:'23999902',name:'测试乙',college:'新学院',award:'人工补充奖',year:'2025年'};
 const fetcher=async url=>{const p=new URL(url).pathname;let data={};
  if(p==='/archive/students.json.gz')data=students;
  if(p==='/archive/sources.json.gz')data=[{id:1,path:'虚构名单.pdf',sha:'a'.repeat(64)}];
  if(p==='/archive/meta.json')data={awards:['国家奖学金'],years:['2024年']};
  if(p==='/api/workflow/students')data={items:[manual]};
  if(p.startsWith('/api/workflow/student/'))data={reviews:[],observations:[manual]};
  return new Response(p.endsWith('.gz')?gzipSync(JSON.stringify(data)):JSON.stringify(data));
 };
 return createArchiveClient('https://isolated.test',fetcher);
}
test('manual-only students appear in search and open without a static profile',async()=>{
 const c=client(),list=await c.query('/api/students?q=23999902');assert.equal(list.total,1);
 const detail=await c.query('/api/student/23999902');assert.equal(detail.student.name,'测试乙');assert.equal(detail.observations[0].id,-1);
});
test('manual award filters still respect identity and match year on the same award',async()=>{
 const c=client();assert.equal((await c.query('/api/students?q=不存在')).total,0);
 const query=award=>'/api/students?'+new URLSearchParams({award,year:'2025年'});
 assert.equal((await c.query(query('人工补充奖'))).total,1);assert.equal((await c.query(query('国家奖学金'))).total,0);
});
test('completed ranges do not wait for upstream stream cancellation',{timeout:2000},async()=>{
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array([0,1,2,3,4,5]))},cancel(){return new Promise(()=>{})}});
 const r=sliceResponse(new Response(stream),2,4);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),new Uint8Array([2,3,4]));
});
