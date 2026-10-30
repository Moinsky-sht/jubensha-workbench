import { modelFallbacks } from "./providers.js";
import { db, id, now, getSetting } from "./db.js";
import { getProject, applyChange, AppError } from "./projects.js";
import {
  selectModel,
  listConnections,
  getConnection,
  type ChatInput,
} from "./models.js";
import { type Scope, type ModelConnection } from "../shared/domain.js";
export function currentGuideline() {
  return db
    .prepare(
      "SELECT * FROM guidelines WHERE status='active' ORDER BY created_at DESC LIMIT 1",
    )
    .get() as any;
}
export function listJobs(projectId?: string) {
  const rows = (
    projectId
      ? db
          .prepare(
            "SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 100",
          )
          .all(projectId)
      : db
          .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200")
          .all()
  ) as any[];
  return rows.map((r) => ({
    ...r,
    spec: JSON.parse(r.spec),
    result: r.result ? JSON.parse(r.result) : null,
    depends_on: JSON.parse(r.depends_on),
  }));
}
export function listJobSummaries(projectId?: string) {
  const where = projectId ? "WHERE project_id=?" : "";
  const limit = projectId ? 100 : 200;
  // Completed orchestrations can contain every generated document. Their full
  // result remains available from /api/jobs/:id, while list views only need
  // live step state and compact results from ordinary jobs.
  const compactResult =
    "status IN ('queued','running','paused') OR length(result)<1000000";
  const rows = db
    .prepare(
      `SELECT id,project_id,batch_id,conversation_id,kind,status,error,created_at,updated_at,depends_on,
       CASE WHEN length(spec)<1000000 THEN substr(json_extract(spec,'$.prompt'),1,1000) END prompt,
       CASE WHEN length(spec)<1000000 THEN json_extract(spec,'$.productionMode') END production_mode,
       CASE WHEN ${compactResult} THEN json_extract(result,'$.message') END result_message,
       CASE WHEN ${compactResult} THEN json_extract(result,'$.model') END result_model,
       CASE WHEN ${compactResult} THEN json_extract(result,'$.url') END result_url,
       CASE WHEN ${compactResult} THEN json_extract(result,'$.fileName') END result_file_name,
       CASE WHEN ${compactResult} THEN json_extract(result,'$.changeId') END result_change_id,
       CASE WHEN ${compactResult} THEN json_extract(result,'$.changeStatus') END result_change_status,
       CASE WHEN ${compactResult} THEN substr(json_extract(result,'$.candidate'),1,8000) END result_candidate,
       CASE WHEN ${compactResult} THEN json_extract(result,'$.evidence') END result_evidence,
       CASE WHEN ${compactResult} THEN json_extract(result,'$.routes') END result_routes,
       CASE WHEN ${compactResult} THEN json_extract(result,'$.orchestration') END result_orchestration
       FROM jobs ${where} ORDER BY created_at DESC LIMIT ${limit}`,
    )
    .all(...(projectId ? [projectId] : [])) as any[];
  const parsed = (value: unknown) => {
    if (typeof value !== "string") return value ?? undefined;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  return rows.map((row) => ({
    id: row.id,
    project_id: row.project_id,
    batch_id: row.batch_id,
    conversation_id: row.conversation_id,
    kind: row.kind,
    status: row.status,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    depends_on: parsed(row.depends_on) || [],
    spec: {
      prompt: row.prompt,
      productionMode: row.production_mode,
    },
    result:
      row.result_message ||
      row.result_model ||
      row.result_url ||
      row.result_change_status ||
      row.result_candidate ||
      row.result_orchestration
        ? {
            message: row.result_message,
            model: row.result_model,
            url: row.result_url,
            fileName: row.result_file_name,
            changeId: row.result_change_id,
            changeStatus: row.result_change_status,
            candidate: parsed(row.result_candidate),
            evidence: parsed(row.result_evidence),
            routes: parsed(row.result_routes),
            orchestration: parsed(row.result_orchestration),
          }
        : null,
  }));
}
export function addMessage(
  conversationId: string,
  role: string,
  content: string,
  changeId?: string,
  jobId?: string,
) {
  db.prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?)").run(
    id(),
    conversationId,
    role,
    content,
    changeId || null,
    jobId || null,
    now(),
  );
}
export function conversation(cid: string) {
  const r = db
    .prepare("SELECT * FROM conversations WHERE id=?")
    .get(cid) as any;
  if (!r) throw new AppError("对话不存在", 404);
  return {
    id: r.id,
    projectId: r.project_id,
    module: r.module,
    entityId: r.entity_id,
    title: r.title,
    messages: (
      db
        .prepare(
          "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at,rowid",
        )
        .all(cid) as any[]
    ).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      changeId: m.change_id,
      jobId: m.job_id,
      createdAt: m.created_at,
    })),
  };
}
export function newConversation(
  projectId: string,
  module: string,
  entityId?: string,
  title = "新的讨论",
  copyFrom?: string,
) {
  const p = getProject(projectId);
  if (entityId && !p.data.entities.some((e) => e.id === entityId))
    throw new AppError("对话对象不属于当前项目");
  const original = copyFrom ? conversation(copyFrom) : undefined;
  if (
    original &&
    (original.projectId !== projectId ||
      original.module !== module ||
      original.entityId !== (entityId || null))
  )
    throw new AppError("只能从当前范围的讨论分支");
  const cid = id();
  db.prepare("INSERT INTO conversations VALUES(?,?,?,?,?,?)").run(
    cid,
    projectId,
    module,
    entityId || null,
    title,
    now(),
  );
  if (copyFrom) {
    const original = conversation(copyFrom);
    if (
      original.projectId !== projectId ||
      original.module !== module ||
      original.entityId !== (entityId || null)
    )
      throw new AppError("只能从当前范围的讨论分支");
    for (const m of original.messages) addMessage(cid, m.role, m.content);
  }
  return conversation(cid);
}
export type JobInput = {
  projectId: string;
  kind?: "generate" | "check" | "export" | "guideline" | "orchestrate";
  conversationId?: string;
  prompt?: string;
  scope: Scope;
  modelId?: string;
  dependsOn?: string[];
  batchId?: string;
  exportOptions?: any;
  depth?: number;
  expectedRevision?: number;
  limits?: { tokens?: number; calls?: number; cost?: number };
  productionMode?: "outline" | "draft";
  turnMode?: "answer" | "modify" | "produce" | "directions";
};
export function enqueue(input: JobInput) {
  if(getSetting("maintenance",false))throw new AppError("正在更新服务，请稍后发送",503);
  const p = getProject(input.projectId),
    kind = input.kind || "generate";
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== p.revision
  )
    throw new AppError("内容已更新，请重新发起任务", 409);
  if (
    input.scope.entityIds?.some((i) => !p.data.entities.some((e) => e.id === i))
  )
    throw new AppError("任务对象不存在");
  if (input.conversationId) {
    const c = conversation(input.conversationId);
    if (c.projectId !== p.id) throw new AppError("对话不属于当前项目");
  }
  const c =
    kind === "generate" || kind === "guideline" || kind === "orchestrate"
      ? selectModel(p, input.scope.module, input.modelId)
      : null;
  const config = c ? (({ apiKey, ...rest }) => rest)(c) : null;
  const guideline = currentGuideline();
  const history = input.conversationId
    ? conversation(input.conversationId)
        .messages.slice(-16)
        .map((m) => ({ role: m.role, content: m.content }))
    : [];
  const jobId = id();
  const spec = {
    ...input,
    connection: config,
    fallbacks: c
      ? modelFallbacks(c)
          .slice(0, 6)
          .map(({ apiKey, ...rest }) => rest)
      : [],
    fallback: config?.fallbackId
      ? (({ apiKey, ...rest }) => rest)(getConnection(config.fallbackId))
      : null,
    guideline: guideline
      ? { id: guideline.id, content: guideline.content }
      : null,
    history,
  };
  db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    jobId,
    p.id,
    input.conversationId || null,
    kind,
    "queued",
    JSON.stringify(spec),
    p.revision,
    null,
    null,
    0,
    input.batchId || null,
    JSON.stringify(input.dependsOn || []),
    now(),
    now(),
  );
  if (input.conversationId && input.prompt)
    addMessage(input.conversationId, "user", input.prompt, undefined, jobId);
  return listJobs(p.id).find((j) => j.id === jobId);
}
export function controlJob(jobId: string, action: string) {
  const row = db.prepare("SELECT * FROM jobs WHERE id=?").get(jobId) as any;
  if (!row) throw new AppError("任务不存在", 404);
  if (action === "pause" && ["queued", "running"].includes(row.status))
    db.prepare("UPDATE jobs SET status='paused',updated_at=? WHERE id=?").run(
      now(),
      jobId,
    );
  else if (
    action === "cancel" &&
    ["queued", "running", "paused"].includes(row.status)
  )
    db.prepare(
      "UPDATE jobs SET status='cancelled',updated_at=? WHERE id=?",
    ).run(now(), jobId);
  else if (action === "resume" && row.status === "paused") {
    db.prepare(
      "UPDATE jobs SET status='queued',error=NULL,updated_at=? WHERE id=?",
    ).run(now(), jobId);
  } else if (
    action === "retry" &&
    ["failed", "cancelled", "paused"].includes(row.status)
  ) {
    const spec = JSON.parse(row.spec);
    const replacement = enqueue({
      ...spec,
      dependsOn: [],
      expectedRevision: getProject(row.project_id).revision,
      conversationId: row.conversation_id || undefined,
    });
    const frozen = {
      ...replacement.spec,
      guideline: spec.guideline,
      connection: spec.connection,
      fallback: spec.fallback,
      fallbacks: spec.fallbacks,
    };
    db.prepare("UPDATE jobs SET spec=? WHERE id=?").run(
      JSON.stringify(frozen),
      replacement.id,
    );
    for (const next of db
      .prepare(
        "SELECT id,depends_on FROM jobs WHERE status IN ('queued','paused')",
      )
      .all() as any[]) {
      const deps = JSON.parse(next.depends_on);
      if (deps.includes(jobId))
        db.prepare("UPDATE jobs SET depends_on=? WHERE id=?").run(
          JSON.stringify(
            deps.map((d: string) => (d === jobId ? replacement.id : d)),
          ),
          next.id,
        );
    }
    return { ...replacement, spec: frozen };
  }
  return listJobs().find((j) => j.id === jobId);
}
