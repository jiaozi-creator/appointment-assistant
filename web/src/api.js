function cookie(name) {
  return document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1) || '';
}
export async function api(path,options={}) {
  const method=(options.method||'GET').toUpperCase();
  const headers={...(options.body?{'Content-Type':'application/json'}:{}),...options.headers};
  if (!['GET','HEAD'].includes(method) && cookie('aa_csrf')) headers['X-CSRF-Token']=cookie('aa_csrf');
  const response=await fetch('/api'+path,{...options,credentials:'same-origin',headers});
  let data;
  try { data=await response.json(); } catch {throw new Error('服务器返回了无效响应');}
  if (!response.ok) throw new Error(data.error||'请求失败');
  return data;
}
export const send=(path,payload,method='POST',headers={})=>api(path,{method,headers,body:JSON.stringify(payload)});
export const money=cents=>'¥'+(cents/100).toLocaleString('zh-CN',{maximumFractionDigits:2});
export const dateText=s=>s||'—';
