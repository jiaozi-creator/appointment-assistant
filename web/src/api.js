export async function api(path,options={}){const response=await fetch('/api'+path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});let data;try{data=await response.json()}catch{throw new Error('服务器返回了无效响应')}if(!response.ok)throw new Error(data.error||'请求失败');return data}
export const send=(path,payload,method='POST',headers={})=>api(path,{method,headers,body:JSON.stringify(payload)});
export const money=cents=>'¥'+(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:0,maximumFractionDigits:2});
export const dateText=s=>s||'—';
