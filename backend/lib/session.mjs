const encoder=new TextEncoder();
async function sign(value,secret){
 if(!secret)throw new Error('缺少运行时配置 ARCHIVE_SESSION_KEY');
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function mintToken(secret,time=Date.now()){
 const value=Math.floor(time/1000+3600)+'.'+crypto.randomUUID();
 return value+'.'+await sign(value,secret);
}
export async function validToken(token,secret,time=Date.now()){
 if(!secret||typeof token!=='string')return false;
 const match=/^(\d{10})\.([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(token);
 const now=Math.floor(time/1000);
 if(!match||Number(match[1])<now||Number(match[1])>now+3600)return false;
 const expected=await sign(match[1]+'.'+match[2],secret);
 let difference=0;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^match[3].charCodeAt(i);
 return difference===0;
}
