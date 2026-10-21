import {mintToken} from '../backend/lib/session.mjs';
const browserToken=await mintToken('test-browser-secret');
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {handle} from '../backend/lib/api.mjs';
import {document} from '../backend/lib/document.mjs';

function database(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../backend/migrations/0001_archive.sql',import.meta.url),'utf8'));
 const adapt=(sql,args=[])=>({bind(...values){return adapt(sql,values)},async all(){return {results:db.prepare(sql).all(...args)}},async first(){return db.prepare(sql).get(...args)||null},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}}});
 return {db,prepare:adapt,async batch(statements){db.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
}
function bucket(){const map=new Map();return {map,async put(key,data,options={}){const value=new Uint8Array(await new Response(data).arrayBuffer());map.set(key,{value,size:value.length,customMetadata:options.customMetadata||{}})},async head(key){const x=map.get(key);return x?{size:x.size,customMetadata:x.customMetadata}:null},async get(key){const x=map.get(key);return x?{...x,body:new Blob([x.value]).stream()}:null}}}
async function fixture(){
 const DB=database(),BUCKET=bucket(),sha='a'.repeat(64);await BUCKET.put('original/'+sha,'fake',{customMetadata:{sha256:sha}});
 DB.db.prepare('INSERT INTO sources(id,path,sha,size,ext,state,pages) VALUES(?,?,?,?,?,?,?)').run(1,'虚构获奖名单.pdf',sha,4,'.pdf','已OCR（需核原件）',2);
 for(const id of ['23999901','23999902'])DB.db.prepare('INSERT INTO students VALUES(?,?,?,?,0)').run(id,'测试甲','测试学院','["测试甲"]');
 DB.db.prepare("INSERT INTO observations(id,source,locator,sid,name,college,award,year,year_basis,level,amount,stage,excerpt,method,record_hash) VALUES(1,1,'第1页','23999901','测试甲','测试学院','国家奖学金','2023-2024学年','材料标题','一等奖','','申请/推荐','虚构摘录','原文定位','hash1')").run();
 DB.db.prepare("INSERT INTO chunks VALUES(1,1,'第1页','测试甲 23999901 国家奖学金','OCR文字（需核原件）')").run();
 return {DB,BUCKET,ARCHIVE_SYNC_KEY:'test-service-secret',ARCHIVE_SESSION_KEY:'test-browser-secret',ARCHIVE_WEB_ORIGIN:'https://test.site'};
}
function request(path,body,options={}){const headers={'oai-authenticated-user-id':'fake-owner','Cookie':'archive_csrf=abcdefghijklmnop123456789','X-Archive-Token':browserToken,Origin:'https://test.site',...options.headers};if(options.anonymous)delete headers['oai-authenticated-user-id'];if(body!==undefined)headers['Content-Type']='application/json';return new Request('https://test.site'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)})}
async function approve(env){return handle(request('/api/review',{id:1,decision:'已核实',note:'虚构测试：核对最终名单',reviewer:'测试经办人'}),env)}

test('visitors can query archives without a separate account',async()=>{const r=await handle(request('/api/students?q=测试甲',undefined,{anonymous:true}),await fixture());assert.equal(r.status,200);assert.equal((await r.json()).total,2)});
test('account-free visits still require same-origin write protection',async()=>{const env=await fixture();assert.equal((await handle(request('/api/review',{id:1},{anonymous:true,headers:{Origin:'https://elsewhere.test'}}),env)).status,403);assert.equal((await handle(request('/api/review',{id:1,decision:'待核',note:'虚构测试：待补最终名单',reviewer:'测试经办人'},{anonymous:true}),env)).status,200)});
test('cross-origin writes and invalid CSRF are rejected',async()=>{const env=await fixture();for(const headers of [{Origin:'https://elsewhere.test'},{'X-Archive-Token':'wrong'}])assert.equal((await handle(request('/api/review',{id:1},{headers}),env)).status,403)});
test('synchronization requires its own secret, even for a signed-in visitor',async()=>{const env=await fixture();assert.equal((await handle(request('/api/import/status'),env)).status,403);const r=await handle(new Request('https://test.site/api/import/status',{headers:{'X-Archive-Sync':'test-service-secret'}}),env);assert.equal(r.status,200);assert.equal((await r.json()).sources,1)});
test('same-name students remain distinct',async()=>{const r=await handle(request('/api/students?q=测试甲'),await fixture());assert.equal((await r.json()).total,2)});
test('award and year filters apply to the same observation',async()=>{const env=await fixture();env.DB.db.exec("INSERT INTO observations(id,source,locator,sid,name,award,year,stage) VALUES(2,1,'第2页','23999901','测试甲','学习优秀奖学金','2025年','待核材料')");assert.equal((await(await handle(request('/api/students?year=2025年&award=国家奖学金'),env)).json()).total,0)});
test('full-text search finds the original page and updates after an edit',async()=>{const env=await fixture();assert.equal((await(await handle(request('/api/search?q=23999901'),env)).json()).items[0].locator,'第1页');env.DB.db.exec("UPDATE chunks SET text='已更正内容' WHERE id=1");assert.equal((await(await handle(request('/api/search?q=23999901'),env)).json()).items.length,0)});
test('proof export requires a review and an available original',async()=>{const env=await fixture();assert.equal((await handle(request('/api/export',{reviews:[1]}),env)).status,400);env.BUCKET.map.clear();assert.equal((await approve(env)).status,409)});
test('review requires human basis and a valid award year',async()=>{const env=await fixture();assert.equal((await handle(request('/api/review',{id:1,decision:'已核实'}),env)).status,400);assert.equal((await handle(request('/api/review',{id:1,decision:'已核实',note:'已核原件',reviewer:'测试人',year:'2024-13-99'}),env)).status,400)});
test('changed record invalidates an earlier approval',async()=>{const env=await fixture();assert.equal((await approve(env)).status,200);env.DB.db.exec("UPDATE observations SET record_hash='changed' WHERE id=1");assert.equal((await handle(request('/api/export',{reviews:[1]}),env)).status,400)});
test('later exclusion invalidates an earlier approval',async()=>{const env=await fixture();await approve(env);await handle(request('/api/review',{id:1,decision:'排除',note:'虚构测试：身份不符',reviewer:'测试经办人'}),env);assert.equal((await handle(request('/api/export',{reviews:[1]}),env)).status,400)});
test('manual registration rejects impossible page locators',async()=>{const env=await fixture();const r=await handle(request('/api/manual',{source:1,locator:'第99页',sid:'23999902',name:'测试甲',college:'测试学院',award:'国家奖学金',year:'2024年'}),env);assert.equal(r.status,400)});
test('reviewed proof exports and can be downloaded from history',async()=>{const env=await fixture();await approve(env);const r=await handle(request('/api/export',{reviews:[1],format:'docx'}),env);assert.equal(r.status,200);const data=new Uint8Array(await r.arrayBuffer());assert.equal(new DataView(data.buffer).getUint32(0,true),0x04034b50);const history=await(await handle(request('/api/history'),env)).json();assert.equal(history.items.length,1);assert.equal((await handle(request('/api/history/'+history.items[0].id+'/download'),env)).status,200);mkdirSync(new URL('../work/',import.meta.url),{recursive:true});writeFileSync(new URL('../work/qa-online.docx',import.meta.url),data)});
test('evidence ZIP contains original and manifest',async()=>{const env=await fixture();await approve(env);const r=await handle(request('/api/export',{reviews:[1],format:'zip',include_originals:true}),env);assert.equal(r.status,200);writeFileSync(new URL('../work/qa-online.zip',import.meta.url),new Uint8Array(await r.arrayBuffer()))});
