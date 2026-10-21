import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../gateway/public/_worker.js';
const origin='https://liuhaoyuray.github.io';
test('gateway forwards only to the fixed archive service and preserves ranges',async()=>{
 let forwarded;
 const r=await gateway.fetch(new Request('https://gateway.pages.dev/archive/a.bin?download=1',{headers:{Origin:origin,Range:'bytes=1-2'}}),{ARCHIVE:{fetch:async req=>{forwarded=req;return new Response('bc',{status:206,headers:{'Content-Range':'bytes 1-2/3'}})}}});
 assert.equal(forwarded.url,'https://scholarship-archive-data.liuhaoyuray.workers.dev/archive/a.bin?download=1');
 assert.equal(forwarded.headers.get('Range'),'bytes=1-2');assert.equal(r.status,206);assert.equal(await r.text(),'bc');assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
});
test('gateway preserves write body and origin for existing validation without replay',async()=>{
 let calls=0;
 const r=await gateway.fetch(new Request('https://gateway.pages.dev/api/review',{method:'POST',headers:{Origin:origin,'X-Archive-Token':'fictional'},body:'{"id":1}'}),{ARCHIVE:{fetch:async req=>{calls++;assert.equal(req.headers.get('Origin'),origin);assert.equal(req.headers.get('X-Archive-Token'),'fictional');assert.equal(await req.text(),'{"id":1}');return new Response('ok')}}});
 assert.equal(calls,1);assert.equal(r.status,200);
});
test('gateway rejects other origins and arbitrary upstream targets',async()=>{
 const env={ARCHIVE:{fetch:()=>{throw Error('must not forward')}}};
 assert.equal((await gateway.fetch(new Request('https://gateway.pages.dev/api/history',{headers:{Origin:'https://elsewhere.test'}}),env)).status,403);
 assert.equal((await gateway.fetch(new Request('https://gateway.pages.dev/https://elsewhere.test'),env)).status,404);
});
test('gateway provides CORS on connection failures and preflight',async()=>{
 const r=await gateway.fetch(new Request('https://gateway.pages.dev/api/history',{headers:{Origin:origin}}),{ARCHIVE:{fetch:()=>{throw Error('offline')}}});
 assert.equal(r.status,502);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
 const preflight=await gateway.fetch(new Request('https://gateway.pages.dev/api/review',{method:'OPTIONS',headers:{Origin:origin}}),{});
 assert.equal(preflight.status,204);assert.ok(preflight.headers.get('Access-Control-Allow-Headers').includes('X-Archive-Token'));
});
