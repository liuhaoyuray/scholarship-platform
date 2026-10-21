const encoder=new TextEncoder();
export const bytes=v=>typeof v==='string'?encoder.encode(v):v;
const table=new Uint32Array(256).map((_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function header(size,values){const a=new Uint8Array(size),v=new DataView(a.buffer);for(const [offset,value,width] of values)v[width===2?'setUint16':'setUint32'](offset,value,true);return a}
export async function* zip(entries){
 let offset=0;const directory=[];
 for(const entry of entries){
  const name=bytes(entry.name),start=offset;let crc=0xffffffff,size=0;
  const local=header(30,[[0,0x04034b50,4],[4,20,2],[6,0x808,2],[26,name.length,2]]);
  yield local;yield name;offset+=local.length+name.length;
  const input=typeof entry.body==='function'?await entry.body():entry.body;
  async function* chunks(){if(input instanceof ReadableStream){const reader=input.getReader();try{while(true){const r=await reader.read();if(r.done)break;yield r.value}}finally{reader.releaseLock()}}else yield bytes(input)}
  for await(const part of chunks()){for(let i=0;i<part.length;i++)crc=table[(crc^part[i])&255]^(crc>>>8);size+=part.length;offset+=part.length;yield part}
  crc=(crc^0xffffffff)>>>0;
  const descriptor=header(16,[[0,0x08074b50,4],[4,crc,4],[8,size,4],[12,size,4]]);yield descriptor;offset+=16;
  directory.push({name,start,size,crc});
 }
 const start=offset;
 for(const e of directory){const central=header(46,[[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x808,2],[16,e.crc,4],[20,e.size,4],[24,e.size,4],[28,e.name.length,2],[42,e.start,4]]);yield central;yield e.name;offset+=central.length+e.name.length}
 yield header(22,[[0,0x06054b50,4],[8,directory.length,2],[10,directory.length,2],[12,offset-start,4],[16,start,4]]);
}
export function asStream(iterator){return new ReadableStream({async pull(controller){try{const r=await iterator.next();if(r.done)controller.close();else controller.enqueue(r.value)}catch(e){controller.error(e)}},async cancel(){await iterator.return?.()}})}
export function zipLength(entries){return 22+entries.reduce((n,e)=>n+92+2*bytes(e.name).length+(e.size??bytes(e.body).length),0)}
export async function consumeKnownLength(stream,length,consume){
 if(typeof FixedLengthStream==='undefined')return consume(stream);
 const fixed=new FixedLengthStream(length),piping=stream.pipeTo(fixed.writable);
 try{const result=await consume(fixed.readable);await piping;return result}catch(error){await piping.catch(()=>{});throw error}
}
export async function collect(iterator){const parts=[];let size=0;for await(const p of iterator){parts.push(p);size+=p.length}const result=new Uint8Array(size);let offset=0;for(const p of parts){result.set(p,offset);offset+=p.length}return result}
