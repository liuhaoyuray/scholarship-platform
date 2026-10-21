import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../free/worker.mjs';
import {mintToken,validToken} from '../backend/lib/session.mjs';
import {authorize} from '../backend/lib/security.mjs';

test('GitHub Pages contains the app with relative assets and no redirects',()=>{
 const html=readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../docs/static/app.js',import.meta.url),'utf8');
 assert.ok(html.includes('学生获奖查询'));
 assert.ok(html.includes('src="./config.js"'));
 assert.ok(!/http-equiv=["']refresh|chatgpt\.site|auth\.openai/.test(html+js));
 assert.ok(!/(?:href|src)="\/(?:api|static)\//.test(html+js));
 assert.ok(js.includes("import(assetUrl('static/pdfjs/pdf.min.mjs'))"));
});
test('GitHub origin can preflight writes without cross-site cookies',async()=>{
 const r=await worker.fetch(new Request('https://api.example.workers.dev/api/review',{method:'OPTIONS',headers:{Origin:'https://liuhaoyuray.github.io','Access-Control-Request-Method':'POST'}}),{ARCHIVE_WEB_ORIGIN:'https://liuhaoyuray.github.io'});
 assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://liuhaoyuray.github.io');
 assert.ok(r.headers.get('Access-Control-Allow-Headers').includes('X-Archive-Token'));
 assert.equal(r.headers.get('Access-Control-Allow-Credentials'),null);
});
test('unexpected browser origins are rejected',async()=>{
 const r=await worker.fetch(new Request('https://api.example.workers.dev/api/stats',{headers:{Origin:'https://elsewhere.test'}}),{ARCHIVE_WEB_ORIGIN:'https://liuhaoyuray.github.io'});
 assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
});
test('write token works across domains without a cookie',async()=>{
 const secret='isolated-browser-secret',token=await mintToken(secret);
 const r=new Request('https://api.example.workers.dev/api/review',{method:'POST',headers:{Origin:'https://liuhaoyuray.github.io','X-Archive-Token':token}});
 const allowed=await authorize(r,{ARCHIVE_WEB_ORIGIN:'https://liuhaoyuray.github.io',ARCHIVE_SESSION_KEY:secret});
 assert.equal(allowed.service,false);
});
test('forged and expired tokens cannot write records',async()=>{
 const secret='isolated-browser-secret',expired=await mintToken(secret,Date.now()-3700000),fresh=await mintToken(secret);
 assert.equal(await validToken(expired,secret),false);
 assert.equal(await validToken(fresh,'different-secret'),false);
 assert.equal(await validToken(fresh.slice(0,-1)+(fresh.endsWith('a')?'b':'a'),secret),false);
});
