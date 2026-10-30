import { db,now } from "./db.js";
export function emitActivity(projectId:string,jobId:string,type:string,payload:unknown) {
  db.prepare("INSERT INTO activity(project_id,job_id,type,payload,created_at) VALUES(?,?,?,?,?)").run(projectId,jobId,type,JSON.stringify(payload),now());
}
