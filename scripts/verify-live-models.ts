import fs from 'node:fs';
const base=process.env.TEST_BASE||'http://127.0.0.1:4315';let cookie='';
async function api(path:string,body?:any){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;}
await api('/auth/login',{username:'admin',password:'admin'});
const p=await api('/projects/demo',{});fs.writeFileSync('output/v05-demo-id.txt',p.id);
const models=(await api('/connections')).filter((c:any)=>['doubao-seed-2-1-turbo-260628','glm-5-3-flash-260828','deepseek-v4-flash-ga-260731'].includes(c.model));
const reports=[];
for(const model of models){
 let cid:string|undefined;
 for(const message of ['这个剧本讲了啥？','他为什么没有离开？','结局如何？']){
  const started=Date.now(),turn=await api('/projects/'+p.id+'/turns',{message,conversationId:cid,modelId:model.id});cid=turn.conversationId;
  let j;for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,500));j=await api('/jobs/'+turn.jobId);if(['completed','failed','paused'].includes(j.status))break;}
  reports.push({model:model.model,message,status:j.status,error:j.error,answer:j.result?.message,firstTokenMs:j.result?.firstTokenMs,totalMs:Date.now()-started,revision:(await api('/projects/'+p.id)).revision});
  console.log(model.model,message,j.status,Date.now()-started);
  fs.writeFileSync('output/v05-model-verification.json',JSON.stringify(reports,null,2));
 }
}
