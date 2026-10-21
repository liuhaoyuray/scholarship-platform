// Some asset bindings return a complete 200 response for a byte-range request.
// Slice the stream without buffering a complete original or text block.
export function sliceResponse(response,start,end){
 if(response.status===206)return response;
 if(response.status!==200)throw Error('档案片段暂时无法读取');
 const reader=response.body.getReader();let offset=0,finished=false;
 const body=new ReadableStream({async pull(controller){try{while(!finished){const {done,value}=await reader.read();if(done){finished=true;if(offset<=end)controller.error(Error('档案片段长度不足'));else controller.close();return}const a=Math.max(0,start-offset),b=Math.min(value.length,end+1-offset);offset+=value.length;if(b>a)controller.enqueue(value.slice(a,b));if(offset>end){finished=true;controller.close();reader.cancel().catch(()=>{});return}if(b>a)return}}catch(e){controller.error(e)}},async cancel(reason){finished=true;await reader.cancel(reason)}});
 const headers=new Headers(response.headers),total=headers.get('Content-Length');headers.delete('Content-Encoding');headers.set('Content-Length',String(end-start+1));headers.set('Content-Range',`bytes ${start}-${end}/${total||'*'}`);headers.set('Accept-Ranges','bytes');
 return new Response(body,{status:206,headers});
}
