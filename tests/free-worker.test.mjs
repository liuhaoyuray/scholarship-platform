import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../free/worker.mjs';
import {mintToken} from '../backend/lib/session.mjs';
import {proofBytes} from '../docs/static/proof-export.mjs';
const origin='https://liuhaoyuray.github.io',secret='isolated-test-secret';
const token=await mintToken(secret),enc=new TextEncoder();
async function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../backend/migrations/0001_archive.sql',import.meta.url),'utf8'));
 const statement=(sql,args=[])=>({bind(...values){return statement(sql,values)},async all(){return {results:sqlite.prepare(sql).all(...args)}},async first(){return sqlite.prepare(sql).get(...args)||null},async run(){return sqlite.prepare(sql).run(...args)}});
 const DB={prepare:statement,async batch(items){return Promise.all(items.map(x=>x.run()))}};
 const bytes=enc.encode('isolated original bytes'),sha=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const observation={id:1,source:1,locator:'第1页',sid:'23999901',name:'测试甲',college:'测试学院',award:'国家奖学金',year:'2024年',stage:'待核材料',excerpt:'虚构测试摘录',method:'OCR文字',record_hash:'b'.repeat(64)};
 const source={id:1,path:'虚构原件.pdf',sha,size:bytes.length,ext:'.pdf',pages:2,parts:[{path:'/original/one',offset:0,length:8},{path:'/original/two',offset:8,length:bytes.length-8}]};
 const files=new Map([['/archive/sources/1.json',enc.encode(JSON.stringify(source))],['/original/one',bytes.slice(0,8)],['/original/two',bytes.slice(8)]]);
 function addRecord(kind,row){const data=enc.encode(JSON.stringify(row)),index=new Uint8Array(24);const view=new DataView(index.buffer);view.setUint32(12,0,true);view.setUint32(16,0,true);view.setUint32(20,data.length,true);files.set(`/archive/${kind}/index-0000.bin`,index);files.set(`/archive/${kind}/0000.bin`,data)}
 addRecord('observations-v2',observation);addRecord('text-v2',{id:1,source:1,locator:'第1页',text:'测试甲 23999901 虚构测试摘录',method:'OCR文字'});
 const hashes=new Uint8Array(128);hashes.set(Buffer.from(observation.record_hash+sha,'hex'),64);files.set('/archive/hashes/0000.bin',hashes);
 const ASSETS={async fetch(req){const data=files.get(new URL(req.url).pathname);if(!data)return new Response('',{status:404});const m=/^bytes=(\d+)-(\d+)$/.exec(req.headers.get('Range')||'');return new Response(m?data.slice(+m[1],+m[2]+1):data,{status:m?206:200})}};
 return {env:{DB,ASSETS,ARCHIVE_WEB_ORIGIN:origin,ARCHIVE_SESSION_KEY:secret},sqlite,files,source,bytes,hashes};
}
const req=(path,body,headers={})=>new Request('https://isolated.test'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json','X-Archive-Token':token}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
const approve=env=>worker.fetch(req('/api/review',{id:1,decision:'已核实',note:'虚构测试核对原件',reviewer:'测试经办人'}),env);
test('free archive reads ranges across original parts without changing bytes',async()=>{
 const {env,bytes}=await fixture();
 const full=await worker.fetch(req('/api/source/1/file'),env);assert.equal(full.status,200);assert.deepEqual(new Uint8Array(await full.arrayBuffer()),bytes);
 const part=await worker.fetch(req('/api/source/1/file',undefined,{Range:'bytes=5-12'}),env);assert.equal(part.status,206);assert.equal(part.headers.get('Content-Range'),`bytes 5-12/${bytes.length}`);assert.deepEqual(new Uint8Array(await part.arrayBuffer()),bytes.slice(5,13));
 assert.equal((await worker.fetch(req('/api/source/1/file',undefined,{Range:'bytes=999-1000'}),env)).status,416);
});
test('asset bindings that ignore Range still yield exact source and record bytes',async()=>{
 const {env,files,bytes}=await fixture();env.ASSETS.fetch=async r=>new Response(files.get(new URL(r.url).pathname));
 const original=await worker.fetch(req('/api/source/1/file'),env);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),bytes);
 const range=await worker.fetch(req('/api/source/1/file',undefined,{Range:'bytes=5-12'}),env);assert.deepEqual(new Uint8Array(await range.arrayBuffer()),bytes.slice(5,13));
 assert.equal((await approve(env)).status,200);assert.equal((await worker.fetch(req('/api/export',{reviews:[1]}),env)).status,200);
 const textRange=await worker.fetch(req('/api/range/text-v2/0000.bin',undefined,{Range:'bytes=0-9'}),env);assert.equal(textRange.status,206);assert.equal((await textRange.arrayBuffer()).byteLength,10);
});
test('free workflow preloads trusted records, exports proof, and retains history',async()=>{
 const {env,bytes}=await fixture();assert.equal((await approve(env)).status,200);
 const result=await worker.fetch(req('/api/export',{reviews:[1],format:'zip',include_originals:true}),env);assert.equal(result.status,200);const payload=await result.json();
 const zip=await proofBytes(payload,path=>'https://isolated.test'+path,url=>worker.fetch(req(new URL(url).pathname),env));assert.equal(new DataView(zip.bytes.buffer,zip.bytes.byteOffset).getUint32(0,true),0x04034b50);
 assert.ok(zip.bytes.length>bytes.length);
 const history=await(await worker.fetch(req('/api/history'),env)).json();assert.equal(history.items.length,1);
 const saved=await(await worker.fetch(req('/api/history/'+payload.id+'/payload'),env)).json();assert.deepEqual(saved,payload);
});
test('immutable hash changes and later exclusions invalidate proof export',async()=>{
 const {env,hashes}=await fixture();await approve(env);hashes[64]^=1;
 assert.equal((await worker.fetch(req('/api/export',{reviews:[1]}),env)).status,400);hashes[64]^=1;
 await worker.fetch(req('/api/review',{id:1,decision:'排除',note:'虚构测试更正',reviewer:'测试经办人'}),env);
 assert.equal((await worker.fetch(req('/api/export',{reviews:[1]}),env)).status,400);
});
test('manual registrations require a trusted chunk and remain reviewable',async()=>{
 const {env}=await fixture(),body={source:1,chunk_id:1,locator:'第1页',sid:'23999902',name:'测试乙',college:'测试学院',award:'国家奖学金',year:'2024年'};
 assert.equal((await worker.fetch(req('/api/manual',{...body,locator:'第99页'}),env)).status,400);
 const result=await worker.fetch(req('/api/manual',body),env);assert.equal(result.status,200);const {id}=await result.json();assert.ok(id<0);
 assert.equal((await worker.fetch(req('/api/review',{id,decision:'已核实',note:'虚构测试人工核对',reviewer:'测试经办人'}),env)).status,200);
 assert.equal((await worker.fetch(req('/api/export',{reviews:[1],format:'docx'}),env)).status,200);
 const list=await(await worker.fetch(req('/api/workflow/students'),env)).json();assert.ok(list.items.some(s=>s.sid===body.sid));
 const student=await(await worker.fetch(req('/api/workflow/student/'+body.sid),env)).json();assert.equal(student.observations[0].id,id);
});
