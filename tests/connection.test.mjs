import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnection} from '../docs/static/connection.mjs';
const a='https://primary.test',b='https://backup.test';
const meta=()=>Response.json({students:64334,files:10183});
test('an unreachable primary does not block available backup and subsequent requests use it',async()=>{
 const calls=[];
 const c=createConnection([a,b],async(url)=>{calls.push(url);if(url.startsWith(a))throw TypeError('Failed to fetch');if(url.endsWith('meta.json'))return meta();return Response.json({ok:true})});
 const [one,two]=await Promise.all([c.fetch(a+'/archive/students.json.gz'),c.fetch(a+'/api/workflow/stats')]);
 assert.equal(one.status,200);assert.equal(two.status,200);assert.equal(c.url('/api/source/1/file'),b+'/api/source/1/file');
 assert.equal(calls.filter(x=>x===b+'/archive/meta.json').length,1);
});
test('an invalid HTTP 200 page is not mistaken for a working archive',async()=>{
 const c=createConnection([a,b],async url=>url.startsWith(a)?new Response('<html>error</html>'):meta());
 assert.equal(await c.connect(),b);
});
test('blocked endpoints time out and a later reconnection succeeds',async()=>{
 let online=false;
 const c=createConnection([a],async(url,opts)=>online?meta():new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('aborted')))),{probeTimeout:10});
 await assert.rejects(c.connect(),e=>e.code==='ARCHIVE_CONNECTION');online=true;assert.equal(await c.connect(),a);
});
test('failed writes are never replayed on a second endpoint',async()=>{
 let writes=0;
 const c=createConnection([a,b],async(url,opts)=>{if(url.endsWith('meta.json'))return meta();writes++;throw TypeError('Failed to fetch')});
 await assert.rejects(c.fetch(a+'/api/review',{method:'POST',body:'{}'}),e=>e.code==='ARCHIVE_CONNECTION'&&e.message.includes('结果尚未确认'));assert.equal(writes,1);
});
