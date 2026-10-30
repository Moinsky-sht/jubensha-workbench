import type { Express } from "express";
import { z } from "zod";
import { db,id,now,getSetting,transaction } from "./db.js";
import { getProject,applyChange,AppError } from "./projects.js";
import { enqueue,newConversation,listJobs,addMessage } from "./jobs.js";
import { turnMode } from "./dialogue.js";
import { coverage,readingEntries,acts,players } from "../shared/story.js";
import { newEntity,modules,moduleFor } from "../shared/domain.js";
import { printPreview,safeEntity } from "./exports.js";
export function installStoryAPI(app:Express) {
  app.get("/api/activity",(req,res)=>{
    res.setHeader("Content-Type","text/event-stream");res.setHeader("Cache-Control","no-cache");res.setHeader("X-Accel-Buffering","no");
    res.flushHeaders();
    let cursor=Number(req.headers["last-event-id"]||req.query.after||0);
    if(!Number.isSafeInteger(cursor)||cursor<0)cursor=0;
    if(!cursor) {
      cursor=Number((db.prepare("SELECT MAX(seq) AS n FROM activity").get() as any)?.n||0);
      const active=db.prepare("SELECT id,project_id FROM jobs WHERE status='running'").all() as any[];
      const streams=active.map(j=>{const rows=db.prepare("SELECT type,payload FROM activity WHERE job_id=? AND type IN ('answer_start','answer_delta','step') ORDER BY seq").all(j.id) as any[];let text="",label="";for(const r of rows){const d=JSON.parse(r.payload);if(r.type==="answer_start")text="";if(r.type==="answer_delta")text+=d.delta;if(r.type==="step")label=d.label;}return {id:j.id,text,label};});
      res.write(`id: ${cursor}\ndata: ${JSON.stringify({type:"sync",seq:cursor,streams})}\n\n`);
    }
    const tick=()=>{
      const rows=db.prepare("SELECT * FROM activity WHERE seq>? ORDER BY seq LIMIT 200").all(cursor) as any[];
      for(const row of rows) {
        cursor=row.seq;
        res.write(`id: ${cursor}\ndata: ${JSON.stringify({...row,payload:JSON.parse(row.payload)})}\n\n`);
      }
    };
    const timer=setInterval(tick,100),heartbeat=setInterval(()=>res.write(": heartbeat\n\n"),15000);
    req.on("close",()=>{clearInterval(timer);clearInterval(heartbeat)});
  });
  app.post("/api/projects/:id/turns",(req,res)=>{
    if(getSetting("maintenance",false))throw new AppError("正在更新服务，请稍后发送",503);
    const b=z.object({
      requestId:z.string().max(100).optional(),
      message:z.string().trim().min(1).max(30000),conversationId:z.string().optional(),
      mode:z.enum(["auto","answer","modify","produce","directions"]).default("auto"),
      discussOnly:z.boolean().default(false),modelId:z.string().optional(),
      references:z.array(z.object({entityId:z.string(),blockId:z.string().optional()})).max(100).default([]),
      module:z.string().default("all"),expectedRevision:z.number().int().optional(),
      selection:z.object({blockId:z.string(),text:z.string()}).optional()
    }).parse(req.body);
    const p=getProject(String(req.params.id));
    const moduleIds=b.references.filter(r=>r.entityId.startsWith("module:")).map(r=>r.entityId.slice(7));
    if(moduleIds.some(id=>!modules.some(m=>m.id===id)))throw new AppError("模块引用已失效");
    const directRefs=b.references.filter(r=>!r.entityId.startsWith("module:"));
    if(directRefs.some(r=>!p.data.entities.some(e=>e.id===r.entityId)))throw new AppError("引用已失效，请重新选择");
    if(b.requestId){const prior=db.prepare("SELECT response FROM dialogue_requests WHERE project_id=? AND request_id=?").get(p.id,b.requestId) as any;if(prior)return res.json(JSON.parse(prior.response));}
    const mode=b.discussOnly?"answer":b.mode==="auto"?turnMode(b.message):b.mode;
    const cid=b.conversationId||newConversation(p.id,"all",undefined,b.message.slice(0,18)).id;
    const ordinal=b.message.match(/(?:采用|采纳)第?([一二三123])(?:个|种)?(?:方向|方案)?/);
    if(mode==="modify" && /^(?:请|帮我|就)?\s*(?:采用|采纳)/.test(b.message) && ordinal){
      const position="一二三".includes(ordinal[1])?"一二三".indexOf(ordinal[1]):Number(ordinal[1])-1;
      const latest=db.prepare("SELECT job_id FROM story_candidates WHERE project_id=? ORDER BY rowid DESC LIMIT 1").get(p.id) as any;
      const rows=latest?db.prepare("SELECT id FROM story_candidates WHERE project_id=? AND job_id=? ORDER BY rowid").all(p.id,latest.job_id) as any[]:[];
      if(rows[position]){const result=adoptCandidate(p.id,rows[position].id,cid);return res.json({turnId:result.job?.id,jobId:result.job?.id,conversationId:cid,mode:"produce"});}
    }
    if(/^(打开|查看|跳转到|定位到)/.test(b.message) && b.references.length){
      addMessage(cid,"user",b.message);addMessage(cid,"assistant","已定位到引用内容。");
      return res.json({conversationId:cid,mode:"navigate",moduleId:moduleIds[0],entityId:directRefs[0]?.entityId,blockId:b.references[0].blockId});
    }
    const response=transaction(()=>{const job=enqueue({
      projectId:p.id,conversationId:cid,kind:mode==="produce"?"orchestrate":"generate",
      prompt:b.message,turnMode:mode,productionMode:"draft",modelId:b.modelId,
      expectedRevision:mode==="answer"?undefined:b.expectedRevision,
      scope:{module:moduleIds.length===1&&!directRefs.length?moduleIds[0]:b.module,entityIds:moduleIds.length===1&&!directRefs.length?[]:[...new Set([...directRefs.map(r=>r.entityId),...p.data.entities.filter(e=>moduleIds.includes(moduleFor(e.kind))).map(e=>e.id)])],projectWide:!b.references.length,discussOnly:mode==="answer",selection:b.selection},
      ...(mode==="produce"?{limits:{calls:80}}:{})
    });
    const response={turnId:job.id,jobId:job.id,conversationId:cid,mode};if(b.requestId)db.prepare("INSERT INTO dialogue_requests VALUES(?,?,?)").run(p.id,b.requestId,JSON.stringify(response));return response;});
    res.json(response);
  });
  app.get("/api/jobs/:id",(req,res)=>{
    const r=db.prepare("SELECT * FROM jobs WHERE id=?").get(String(req.params.id)) as any;
    const j=r?{...r,spec:JSON.parse(r.spec),result:r.result?JSON.parse(r.result):null,depends_on:JSON.parse(r.depends_on)}:null;
    if(!j)throw new AppError("任务不存在",404);
    res.json(j);
  });
  app.get("/api/projects/:id/overview",(req,res)=>{
    const p=getProject(String(req.params.id));
    const concept=p.data.entities.find(e=>e.kind==="concept");
    for(const mode of ["author","player"]){const content=mode==="author"?[concept?.fields.conflict,concept?.fields.ending].filter(Boolean).join("\n"):p.description;db.prepare("INSERT OR IGNORE INTO story_summaries VALUES(?,?,?,?)").run(p.id,p.revision,mode,content||"");}
    res.json({revision:p.revision,coverage:coverage(p),players:players(p),acts:acts(p),
      candidates:db.prepare("SELECT * FROM story_candidates WHERE project_id=? ORDER BY rowid DESC LIMIT 3").all(p.id).map((r:any)=>({...r,data:JSON.parse(r.data)})),
      issues:p.data.entities.filter(e=>e.kind==="issue"&&e.fields.resolution==="未处理"),
      summaries:db.prepare("SELECT * FROM story_summaries WHERE project_id=? ORDER BY revision DESC LIMIT 2").all(p.id)
    });
  });
  app.get("/api/projects/:id/print-preview",async(req,res)=>{
    const o=z.object({revision:z.coerce.number().int(),audience:z.enum(["player","author","npc","dm"]),characterId:z.string().optional(),throughAct:z.coerce.number().int().positive().optional(),template:z.enum(["role","host","cards"]).optional(),font:z.enum(["serif","sans"]).optional(),fontSize:z.coerce.number().min(12).max(24).optional(),margin:z.coerce.number().min(10).max(40).optional()}).parse(req.query);
    const buffer=await printPreview(getProject(String(req.params.id),o.revision),{...o,format:"pdf"});
    res.setHeader("Content-Type","application/pdf");res.setHeader("Cache-Control","private, no-store");res.send(buffer);
  });
  app.get("/api/projects/:id/reading",(req,res)=>{
    const o=z.object({revision:z.coerce.number().int().optional(),characterId:z.string().optional(),actId:z.string().optional(),throughAct:z.coerce.number().int().positive().optional(),audience:z.enum(["player","author","npc","dm"]).default("author")}).parse(req.query);
    const p=getProject(String(req.params.id),o.revision);
    const entries=readingEntries(p,{...o,includeDraft:true});
    res.json({revision:p.revision,entries:entries.map(e=>o.audience==="author"?e:safeEntity(e,o.audience)),coverage:coverage(p)});
  });
  app.post("/api/projects/:id/candidates/:candidate/adopt",(req,res)=>{
    res.json(adoptCandidate(String(req.params.id),String(req.params.candidate)));
  });
}

function adoptCandidate(projectId:string,candidateId:string,conversationId?:string){return transaction(()=>{
    const p=getProject(projectId);
    const row=db.prepare("SELECT * FROM story_candidates WHERE id=? AND project_id=?").get(candidateId,p.id) as any;
    if(!row)throw new AppError("方向不存在",404);
    if(row.adopted)return {project:p,job:listJobs(p.id).find(j=>j.id===(db.prepare("SELECT job_id FROM candidate_adoptions WHERE candidate_id=?").get(row.id) as any)?.job_id)};
    const prior=db.prepare("SELECT id FROM changes WHERE request_id=? AND status='applied'").get("adopt:"+row.id);
    if(!prior) {
      if(p.revision!==row.revision)throw new AppError("项目已修改，请重新生成方向",409);
      const c=JSON.parse(row.data),e=newEntity("concept",c.title);
      e.fields={conflict:c.conflict,experience:c.experience,genre:c.genre||"情感",players:c.players||2,minutes:c.minutes||90};
      e.body={type:"doc",content:[{type:"paragraph",attrs:{id:id()},content:[{type:"text",text:c.ending}]}]};
      applyChange({projectId:p.id,requestId:"adopt:"+row.id,baseRevision:p.revision,operations:[{type:"create_entity",entity:e}],scope:{module:"all",projectWide:true},source:"manual",summary:"采纳方向："+c.title});
    }
    const current=getProject(p.id);
    const job=enqueue({projectId:p.id,kind:"orchestrate",conversationId,prompt:p.description+"\n采用方向："+row.data,productionMode:"draft",scope:{module:"all",projectWide:true},expectedRevision:current.revision,limits:{calls:80}});
    db.prepare("UPDATE story_candidates SET adopted=1 WHERE id=?").run(row.id);
    db.prepare("INSERT INTO candidate_adoptions VALUES(?,?)").run(row.id,job.id);
    return {project:current,job};
});}
