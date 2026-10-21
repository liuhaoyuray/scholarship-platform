import {validToken} from './session.mjs';
export const secureHeaders={
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; font-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'"
};
export class AppError extends Error{constructor(status,message){super(message);this.status=status}}
export function check(condition,message,status=400){if(!condition)throw new AppError(status,message)}
export const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
export const norm=v=>clean(v).replace(/\s+/g,'');
export const sid=v=>/^(?:\d{8}|[A-Z]{1,3}\d{6,10})$/.test(norm(v).toUpperCase())?norm(v).toUpperCase():'';
export const name=v=>/^[\u3400-\u9fff·•.]{2,24}$/.test(norm(v))&&!/姓名|学院|学生|合计|填表|张三|李四|示例|奖学金|序号|负责人|联系人|说明/.test(norm(v))?norm(v):'';
export const year=v=>/^20\d{2}(?:-20\d{2}学年|年)$/.test(v);
export const like=v=>'%'+String(v).replace(/[\\%_]/g,'\\$&')+'%';
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
export function csrfCookie(request){return /(?:^|;\s*)archive_csrf=([A-Za-z0-9_-]{16,100})(?:;|$)/.exec(request.headers.get('cookie')||'')?.[1]||''}
export async function authorize(request,env){
 const url=new URL(request.url),identity=null;
 const service=!!env.ARCHIVE_SYNC_KEY&&equal(request.headers.get('X-Archive-Sync')||'',env.ARCHIVE_SYNC_KEY);
 if(url.pathname.startsWith('/api/import/')){check(service,'仅允许已授权的档案同步任务',403);check(!request.headers.has('Origin'),'同步请求来源无效',403);return {service:true,identity:null}}
 if(!['GET','HEAD'].includes(request.method)&&!service){
  check(request.headers.get('Origin')===(env.ARCHIVE_WEB_ORIGIN||url.origin),'请求来源无效',403);
  check(await validToken(request.headers.get('X-Archive-Token'),env.ARCHIVE_SESSION_KEY),'会话已更新，请刷新页面后再试',403);
 }
 return {service,identity};
}
export function json(value,status=200,extra={}){return new Response(JSON.stringify(value),{status,headers:{...secureHeaders,'Content-Type':'application/json; charset=utf-8',...extra}})}
export const now=()=>new Date().toISOString();
export const basename=path=>String(path).split(/[\\/!]/).at(-1).trim().replace(/[\r\n\u0000-\u001f]/g,'');
export const downloadName=name=>`attachment; filename="${/^[A-Za-z0-9_.-]+$/.test(name)?name:'archive-download'+(/\.[A-Za-z0-9]+$/.exec(name)?.[0]||'')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
