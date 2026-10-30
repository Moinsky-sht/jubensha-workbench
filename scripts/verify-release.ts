import fs from 'node:fs';
const base=process.env.TEST_BASE||'http://127.0.0.1:4310/api';let cookie='';
async function api(path:string,body?:any){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;}
await api('/auth/login',{username:'admin',password:'admin'});
const projects=await api('/projects'),p=projects.find((p:any)=>p.title==='末班信箱 · 新编体验本');if(!p)throw Error('缺少体验本');
const overview=await api('/projects/'+p.id+'/overview');if(overview.coverage.completed!==6)throw Error('体验本覆盖不全');
if(!projects.some((p:any)=>p.title.includes('历史创作档案')))throw Error('缺少历史档案');
const connections=await api('/connections'),report:any={projectId:p.id,revision:p.revision,coverage:overview.coverage,models:[]};
for(const model of ['doubao-seed-2-1-turbo-260628','glm-5-3-flash-260828','deepseek-v4-flash-ga-260731']){
 const c=connections.find((c:any)=>c.model===model);if(!c)throw Error('缺少预置模型 '+model);
 const turn=await api('/projects/'+p.id+'/turns',{message:'陈屿为什么没有离开？只解释客观原因与他隐瞒的动机，并引用依据。',modelId:c.id});
 let j;for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,1000));j=await api('/jobs/'+turn.jobId);if(['completed','failed','paused'].includes(j.status))break;}
 if(j.status!=='completed'||/修复JSON|JSON结构|格式修复/.test(j.result?.message||''))throw Error(model+': '+(j.error||'回答未完成'));
 report.models.push({model,status:j.status,firstTokenMs:j.result?.firstTokenMs,answer:j.result.message});console.log('PASS',model,j.result?.firstTokenMs);
}
if((await api('/projects/'+p.id)).revision!==p.revision)throw Error('问答错误地改变版本');
fs.writeFileSync(process.env.REPORT_FILE||'/tmp/v05-release-verification.json',JSON.stringify(report,null,2));console.log('RELEASE_VERIFIED');
