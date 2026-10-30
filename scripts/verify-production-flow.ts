import fs from 'node:fs';let cookie='';const base='http://127.0.0.1:4315/api';
async function api(path:string,body?:any){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;}
await api('/auth/login',{username:'admin',password:'admin'});const p=await api('/projects',{title:'V0.5 自动生产验收',description:'双人单幕现代情感练习本，30分钟；两个成年同事在旧书店最后一天交换借书卡，讨论未来职业。每角色正文至少1200字，不含犯罪和超自然，最多两角色一幕一场，主持兼一个NPC。'});
const connections=await api('/connections'),model=connections.find((c:any)=>c.model==='glm-5-3-flash-260828');
const turn=await api('/projects/'+p.id+'/turns',{message:'生成三个方向。'+p.description,mode:'directions',modelId:model.id});
async function wait(id:string){let j;for(let n=0;n<1800;n++){await new Promise(r=>setTimeout(r,1000));j=await api('/jobs/'+id);if(['completed','failed','paused'].includes(j.status))return j;}return j;}
const directions=await wait(turn.jobId);if(directions.status!=='completed')throw Error(directions.error);const overview=await api('/projects/'+p.id+'/overview');
const accepted=await api('/projects/'+p.id+'/candidates/'+overview.candidates[1].id+'/adopt',{});console.log('Production started',accepted.job.id);
const job=await wait(accepted.job.id),result=await api('/projects/'+p.id+'/overview');fs.writeFileSync('output/v05-production-verification.json',JSON.stringify({projectId:p.id,job,overview:result},null,2));console.log('Production finished',job.status,job.error,result.coverage);
