import {document as createDocument} from './proof/document.mjs';
import {zip,collect} from './proof/zip.mjs';
const basename=s=>String(s).split(/[\\/!]/).at(-1).trim();
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function proofBytes(payload,apiUrl,fetcher=fetch){
 const {rows,settings,id}=payload,doc=await createDocument(rows,settings,id);
 if(settings.format==='docx')return {bytes:doc,name:id+'.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
 const entries=[{name:'获奖证明草稿.docx',body:doc}],seen=new Set();let total=0;
 for(let i=0;i<rows.length;i++){const r=rows[i];entries.push({name:`佐证/${String(i+1).padStart(2,'0')}-定位摘录.txt`,body:`原件：${r.path}\n位置：${r.locator}\nSHA-256：${r.sha}\n\n${r.excerpt}\n\n此为定位摘录，原件以档案为准。`});if(settings.include_originals&&!seen.has(r.sha)){total+=r.size;if(total>200*1024*1024)throw Error('所选原件超过200MB，请分批导出');seen.add(r.sha);entries.push({name:`原件/${String(i+1).padStart(2,'0')}-${basename(r.path)}`,body:async()=>{const response=await fetcher(apiUrl('/api/source/'+r.source+'/file'));if(!response.ok)throw Error('佐证原件暂时无法下载');const bytes=await response.arrayBuffer();if(bytes.byteLength!==r.size||await digest(bytes)!==r.sha)throw Error('原件与核验时的内容不一致，请重新核验');return new Uint8Array(bytes)}})}}
 entries.push({name:'材料目录.json',body:JSON.stringify(rows.map(r=>Object.fromEntries(['name','sid','award','year','level','path','locator','sha','method','reviewer','created','note'].map(k=>[k,r[k]]))),null,2)});
 return {bytes:await collect(zip(entries)),name:id+'.zip',mime:'application/zip'};
}
export async function downloadProof(payload,apiUrl){const result=await proofBytes(payload,apiUrl),url=URL.createObjectURL(new Blob([result.bytes],{type:result.mime})),link=document.createElement('a');link.href=url;link.download=result.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
