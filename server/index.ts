import { installStoryAPI } from "./story-api.js";
import {
  initializeProviders,
  providerStatus,
  syncArk,
  probeModel,
} from "./providers.js";
import { retrievalStatus, retrieve } from "./retrieval.js";
import { templates, saveTemplate, fromTemplate } from "./templates.js";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { z, ZodError } from "zod";
import {
  db,
  id,
  now,
  getSetting,
  setSetting,
  dataDir,
  transaction,
} from "./db.js";
import {
  getProject,
  listProjects,
  createProject,
  copyProject,
  updateProjectMeta,
  demoProject,
  applyChange,
  listChanges,
  getChange,
  resolveChange,
  undoChange,
  restoreRevision,
  AppError,
} from "./projects.js";
import {
  listConnections,
  saveConnection,
  getConnection,
  callModel,
  parseReply,
} from "./models.js";
import {
  listJobs,
  listJobSummaries,
  enqueue,
  controlJob,
  newConversation,
  conversation,
  currentGuideline,
} from "./jobs.js";
import { importFile, extractionCandidates } from "./imports.js";
import { experienceProject,archiveProject } from "./experience.js";
import { previewHTML } from "./exports.js";
import {
  planForMode,
  publicToolCatalog,
  type ProductionMode,
} from "./agent-tools.js";
import { modules, plain } from "../shared/domain.js";
const app = express(),
  port = Number(process.env.PORT || 4310);
const production = process.env.NODE_ENV === "production";
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(express.json({ limit: "12mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  if (
    req.path.startsWith("/api") &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    new URL(req.headers.origin).host !== req.headers.host
  )
    return res.status(403).json({ error: "请求来源不匹配" });
  next();
});
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function authenticated(req: express.Request) {
  const token = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("workbench_session="))
    ?.split("=")[1];
  if (!token) return false;
  return !!db
    .prepare("SELECT id FROM sessions WHERE id=? AND expires_at>?")
    .get(hash(token), Date.now());
}
function session(req: express.Request, res: express.Response) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?)").run(
    hash(token),
    Date.now() + 30 * 86400e3,
  );
  res.cookie("workbench_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.secure,
    maxAge: 30 * 86400e3,
    path: "/",
  });
  return res.json({ authenticated: true });
}
app.get("/api/auth/status", (req, res) =>
  res.json({
    configured: !!getSetting("passwordHash", ""),
    authenticated: authenticated(req),
  }),
);
const attempts = new Map<string, { count: number; until: number }>();
app.post("/api/auth/:action", async (req, res) => {
  const action = String(req.params.action);
  if (action === "logout") {
    const token = req.headers.cookie?.match(/workbench_session=([^;]+)/)?.[1];
    if (token) db.prepare("DELETE FROM sessions WHERE id=?").run(hash(token));
    res.clearCookie("workbench_session");
    return res.json({ ok: true });
  }
  if (!["setup", "login"].includes(action))
    throw new AppError("操作不存在", 404);
  const ip = req.ip || "local",
    a = attempts.get(ip);
  if (a && a.until > Date.now() && a.count >= 12)
    throw new AppError("尝试次数较多，请十分钟后再试", 429);
  attempts.set(ip, {
    count: a && a.until > Date.now() ? a.count + 1 : 1,
    until: Date.now() + 600e3,
  });
  const username = z
    .string()
    .trim()
    .min(1, "请输入账号")
    .max(100)
    .parse(req.body.username);
  const password = z
    .string()
    .min(
      action === "setup" ? 10 : 1,
      action === "setup" ? "密码至少10个字符" : "请输入密码",
    )
    .max(200)
    .parse(req.body.password);
  const saved = getSetting("passwordHash", "");
  if (action === "setup") {
    if (saved) throw new AppError("账号已经建立，请登录");
    const digest = await bcrypt.hash(password, 12);
    transaction(() => {
      if (getSetting("passwordHash", "")) throw new AppError("账号已建立");
      setSetting("username", username);
      setSetting("passwordHash", digest);
    });
  } else {
    const passwordMatches = saved
      ? await bcrypt.compare(password, saved)
      : false;
    if (username !== getSetting("username", "admin") || !passwordMatches)
      throw new AppError("账号或密码不正确", 401);
  }
  attempts.delete(ip);
  return session(req, res);
});
app.use("/api", (req, res, next) =>
  authenticated(req) ? next() : res.status(401).json({ error: "请先登录" }),
);
installStoryAPI(app);
app.get("/api/projects", (_, res) => res.json(listProjects()));
app.get("/api/templates", (_, res) => res.json(templates()));
app.post("/api/templates", (req, res) => {
  const b = z
    .object({
      projectId: z.string(),
      title: z.string().min(1).max(100),
      entityIds: z.array(z.string()).min(1).max(200),
    })
    .strict()
    .parse(req.body);
  res.json(saveTemplate(b.projectId, b.title, b.entityIds));
});
app.post("/api/projects", (req, res) => {
  const title = z.string().min(1).max(100).parse(req.body.title);
  res.json(
    req.body.templateId
      ? fromTemplate(
          String(req.body.templateId),
          title,
          String(req.body.description || ""),
        )
      : createProject(title, String(req.body.description || "")),
  );
});
app.post("/api/projects/archive", (_,res)=>res.json(archiveProject()));
app.post("/api/projects/synopsis", (_,res)=>res.json(demoProject()));
app.post("/api/projects/demo", (_, res) => res.json(experienceProject()));
app.get("/api/agent-tools", (_, res) => res.json(publicToolCatalog()));
app.post("/api/projects/:id/agent-runs", (req, res) => {
  const body = z
    .object({
      brief: z.string().trim().min(10).max(30000),
      mode: z.enum(["outline", "draft"]).default("draft"),
      modelId: z.string().optional(),
    })
    .strict()
    .parse(req.body);
  const project = getProject(String(req.params.id));
  const active = listJobs(project.id).find(
    (job) =>
      job.kind === "orchestrate" &&
      ["queued", "running", "paused"].includes(job.status),
  );
  if (active) throw new AppError("这个项目已有主创任务，请先处理当前进度");
  const mode = body.mode as ProductionMode;
  res.json(
    enqueue({
      projectId: project.id,
      kind: "orchestrate",
      prompt: body.brief,
      scope: { module: "all", projectWide: true },
      modelId: body.modelId,
      productionMode: mode,
      expectedRevision: project.revision,
      limits: { calls: mode === "draft" ? 40 : 24 },
      dependsOn: [],
      exportOptions: undefined,
      depth: 0,
      plan: planForMode(mode),
    } as any),
  );
});
app.get("/api/projects/:id", (req, res) =>
  res.json(getProject(String(req.params.id))),
);
app.patch("/api/projects/:id", (req, res) =>
  res.json(
    updateProjectMeta(
      String(req.params.id),
      z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          archived: z.boolean().optional(),
          defaultModel: z.string().optional(),
          moduleModels: z.record(z.string(), z.string()).optional(),
        })
        .strict()
        .parse(req.body),
    ),
  ),
);
app.post("/api/projects/:id/copy", (req, res) =>
  res.json(copyProject(String(req.params.id))),
);
app.post("/api/projects/:id/restore", (req, res) => {
  const b = z
    .object({
      revision: z.number().int(),
      baseRevision: z.number().int(),
      entityId: z.string().optional(),
    })
    .strict()
    .parse(req.body);
  res.json(
    restoreRevision(
      String(req.params.id),
      b.revision,
      b.baseRevision,
      b.entityId,
    ),
  );
});
app.get("/api/projects/:id/revisions", (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT revision,created_at FROM revisions WHERE project_id=? ORDER BY revision DESC LIMIT 200",
      )
      .all(String(req.params.id)),
  ),
);
app.get("/api/projects/:id/revisions/:revision", (req, res) =>
  res.json(getProject(String(req.params.id), Number(req.params.revision))),
);
app.post("/api/projects/:id/changes", (req, res) => {
  const b = z
    .object({
      requestId: z.string(),
      baseRevision: z.number().int(),
      operations: z.array(z.unknown()),
      scope: z
        .object({
          module: z.string(),
          entityIds: z.array(z.string()).optional(),
          projectWide: z.boolean().optional(),
          selection: z
            .object({ blockId: z.string(), text: z.string() })
            .optional(),
        })
        .strict(),
      summary: z.string().optional(),
    })
    .strict()
    .parse(req.body);
  res.json(
    applyChange({ ...b, projectId: String(req.params.id), source: "manual" }),
  );
});
app.get("/api/projects/:id/changes", (req, res) =>
  res.json(listChanges(String(req.params.id))),
);
app.get("/api/changes/:id", (req, res) =>
  res.json(getChange(String(req.params.id))),
);
app.post("/api/changes/:id/resolve", (req, res) => {
  const b = z
    .object({
      action: z.enum(["apply", "reject"]),
      baseRevision: z.number().int(),
      operations: z.array(z.unknown()).optional(),
    })
    .parse(req.body);
  res.json(
    resolveChange(
      String(req.params.id),
      b.action,
      b.baseRevision,
      b.operations,
    ),
  );
});
app.post("/api/changes/:id/undo", (req, res) =>
  res.json(undoChange(String(req.params.id))),
);
app.get("/api/projects/:id/conversations", (req, res) => {
  const rows = db
    .prepare(
      "SELECT id FROM conversations WHERE project_id=? ORDER BY created_at DESC",
    )
    .all(String(req.params.id)) as any[];
  res.json(rows.map((r) => conversation(r.id)));
});
app.post("/api/projects/:id/conversations", (req, res) => {
  const b = z
    .object({
      module: z.string(),
      entityId: z.string().optional(),
      title: z.string().max(100).optional(),
      copyFrom: z.string().optional(),
    })
    .parse(req.body);
  res.json(
    newConversation(
      String(req.params.id),
      b.module,
      b.entityId,
      b.title,
      b.copyFrom,
    ),
  );
});
app.get("/api/jobs", (req, res) =>
  res.json(
    listJobSummaries(req.query.projectId ? String(req.query.projectId) : undefined),
  ),
);
const exportOptionsSchema = z
  .object({
    characterId:z.string().optional(),throughAct:z.number().int().positive().optional(),
    format: z.enum(["md", "docx", "pdf", "zip", "json"]),
    audience: z.enum(["player", "npc", "dm", "author"]),
    revision: z.number().int(),
    template: z.enum(["role", "host", "cards"]).optional(),
    font: z.enum(["serif", "sans"]).optional(),
    fontSize: z.number().min(12).max(24).optional(),
    margin: z.number().min(10).max(40).optional(),
  })
  .optional();
const scopeSchema = z
  .object({
    module: z.string(),
    entityIds: z.array(z.string()).optional(),
    projectWide: z.boolean().optional(),
    discussOnly: z.boolean().optional(),
    selection: z.object({ blockId: z.string(), text: z.string() }).optional(),
  })
  .strict();
app.post("/api/jobs", (req, res) => {
  const b = z
    .object({
      projectId: z.string(),
      kind: z.enum(["generate", "check", "export", "guideline"]).optional(),
      conversationId: z.string().optional(),
      prompt: z.string().max(30000).optional(),
      scope: scopeSchema,
      modelId: z.string().optional(),
      expectedRevision: z.number().int().optional(),
      exportOptions: exportOptionsSchema,
    })
    .strict()
    .parse(req.body);
  if (
    (!b.kind || b.kind === "generate" || b.kind === "guideline") &&
    !b.prompt?.trim()
  )
    throw new AppError("请输入要求");
  if (
    b.prompt &&
    !/(修改|改成|改为|采用|生成|写|增加|删除|调整|执行|导出|检查|整理|提炼|创建|补充|替换|润色|扩展)/.test(
      b.prompt,
    ) &&
    /(有没有|哪些|怎么看|讨论|为什么|如何|怎么样|什么|吗|？|\?)/.test(b.prompt)
  )
    b.scope.discussOnly = true;
  res.json(enqueue(b));
});
app.post("/api/jobs/:id/:action", (req, res) =>
  res.json(
    controlJob(
      String(req.params.id),
      z.enum(["pause", "cancel", "resume", "retry"]).parse(req.params.action),
    ),
  ),
);
app.get("/api/batches", (_, res) =>
  res.json(
    (
      db
        .prepare("SELECT * FROM batches ORDER BY created_at DESC")
        .all() as any[]
    ).map((b) => ({ ...b, limits: JSON.parse(b.limits_json) })),
  ),
);
app.post("/api/batches", (req, res) => {
  const b = z
    .object({
      title: z.string().min(1),
      items: z
        .array(
          z.object({
            projectId: z.string(),
            kind: z.enum(["generate", "check", "export"]),
            prompt: z.string().optional(),
            scope: scopeSchema,
            modelId: z.string().optional(),
            exportOptions: exportOptionsSchema,
          }),
        )
        .min(1)
        .max(50),
      limits: z
        .object({
          calls: z.number().int().positive().optional(),
          tokens: z.number().positive().optional(),
          cost: z.number().positive().optional(),
        })
        .default({}),
    })
    .strict()
    .parse(req.body);
  const batch = id();
  transaction(() => {
    db.prepare("INSERT INTO batches VALUES(?,?,?,?,?)").run(
      batch,
      b.title,
      JSON.stringify(b.limits),
      "running",
      now(),
    );
    const previous: Record<string, string> = {};
    for (const item of b.items) {
      const job = enqueue({
        ...item,
        batchId: batch,
        dependsOn: previous[item.projectId] ? [previous[item.projectId]] : [],
      });
      previous[item.projectId] = job.id;
    }
  });
  res.json({ id: batch });
});
app.patch("/api/batches/:id", (req, res) => {
  const b = z
    .object({
      status: z.enum(["running", "paused"]).optional(),
      limits: z
        .object({
          calls: z.number().positive().optional(),
          tokens: z.number().positive().optional(),
          cost: z.number().positive().optional(),
        })
        .optional(),
    })
    .strict()
    .parse(req.body);
  const batch = db
    .prepare("SELECT * FROM batches WHERE id=?")
    .get(String(req.params.id)) as any;
  if (!batch) throw new AppError("批次不存在", 404);
  db.prepare("UPDATE batches SET status=?,limits_json=? WHERE id=?").run(
    b.status || batch.status,
    b.limits ? JSON.stringify(b.limits) : batch.limits_json,
    batch.id,
  );
  res.json({ ok: true });
});
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  let last = "";
  const send = () => {
    const payload = JSON.stringify({
      jobs: db
        .prepare(
          "SELECT id,status,updated_at FROM jobs ORDER BY updated_at DESC LIMIT 100",
        )
        .all(),
      projects: db.prepare("SELECT id,revision FROM projects").all(),
    });
    if (payload !== last) {
      res.write(`data: ${payload}\n\n`);
      last = payload;
    } else res.write(": heartbeat\n\n");
  };
  send();
  const t = setInterval(send, 350);
  req.on("close", () => clearInterval(t));
});
app.get("/api/providers/ark", (_, res) => res.json(providerStatus()));
app.post("/api/providers/ark/sync", async (_, res) =>
  res.json(await syncArk()),
);
app.patch("/api/providers/ark", (req, res) => {
  const b = z.object({ autoSwitch: z.boolean() }).strict().parse(req.body);
  setSetting("arkAutoSwitch", b.autoSwitch);
  res.json(providerStatus());
});
app.post("/api/providers/ark/probe", async (req, res) => {
  const b = z.object({ connectionId: z.string() }).parse(req.body);
  res.json(await probeModel(b.connectionId));
});
app.get("/api/projects/:id/retrieval", (req, res) =>
  res.json(retrievalStatus(String(req.params.id))),
);
app.post("/api/projects/:id/retrieval/search", async (req, res) => {
  const b = z
    .object({ query: z.string().min(1).max(6000) })
    .strict()
    .parse(req.body);
  res.json(await retrieve(String(req.params.id), b.query));
});
app.post("/api/projects/:id/retrieval/index", (req, res) => {
  const p = getProject(String(req.params.id));
  db.prepare(
    "UPDATE retrieval_state SET status='pending',error='' WHERE project_id=?",
  ).run(p.id);
  res.json({ queued: true });
});
app.get("/api/connections", (_, res) => res.json(listConnections()));
app.post("/api/connections", (req, res) => res.json(saveConnection(req.body)));
app.delete("/api/connections/:id", (req, res) => {
  const cid = String(req.params.id);
  if (
    (
      db
        .prepare(
          "SELECT spec FROM jobs WHERE status IN ('queued','running','paused')",
        )
        .all() as any[]
    ).some((j) => JSON.parse(j.spec).connection?.id === cid)
  )
    throw new AppError("该连接仍被任务使用");
  db.prepare("DELETE FROM connections WHERE id=?").run(cid);
  res.json({ ok: true });
});
app.post("/api/connections/:id/test", async (req, res) => {
  const c = getConnection(String(req.params.id));
  const raw = await callModel(
    { ...c, maxOutput: 300 },
    {
      system:
        'Return a JSON object with message:"连接成功", operations:[], actions:[], reads:[], guidelineDraft:"".',
      messages: [{ role: "user", content: "测试连接" }],
    },
  );
  parseReply(raw);
  res.json({ ok: true, message: "连接成功，结构化结果已通过验证" });
});
app.get("/api/connections/:id/models", async (req, res) => {
  const c = getConnection(String(req.params.id)),
    headers: Record<string, string> = {};
  if (c.protocol === "anthropic") {
    headers["x-api-key"] = c.apiKey!;
    headers["anthropic-version"] = "2023-06-01";
  } else if (c.protocol === "gemini") headers["x-goog-api-key"] = c.apiKey!;
  else headers.Authorization = "Bearer " + c.apiKey;
  const response = await fetch(c.baseUrl.replace(/\/$/, "") + "/models", {
    headers,
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok) throw new AppError("未能获取列表，可直接填写模型标识");
  const result: any = await response.json();
  res.json(
    (result.data || result.models || []).map(
      (m: any) => m.id || m.name?.replace(/^models\//, ""),
    ),
  );
});
app.get("/api/settings", (_, res) =>
  res.json({
    defaultModel: getSetting("defaultModel", ""),
    concurrency: getSetting("concurrency", 2),
  }),
);
app.patch("/api/settings", (req, res) => {
  const b = z
    .object({
      defaultModel: z.string().optional(),
      concurrency: z.number().int().min(1).max(8).optional(),
    })
    .strict()
    .parse(req.body);
  for (const [k, v] of Object.entries(b)) setSetting(k, v);
  res.json({ ok: true });
});
app.get("/api/usage", (_, res) =>
  res.json(
    db.prepare("SELECT * FROM usage ORDER BY created_at DESC LIMIT 300").all(),
  ),
);
app.get("/api/retrieval/usage", (_, res) =>
  res.json(
    db
      .prepare(
        "SELECT * FROM retrieval_usage ORDER BY created_at DESC LIMIT 300",
      )
      .all(),
  ),
);
app.get("/api/guidelines", (_, res) =>
  res.json(
    db.prepare("SELECT * FROM guidelines ORDER BY created_at DESC").all(),
  ),
);
app.post("/api/guidelines", (req, res) => {
  const b = z
    .object({
      title: z.string().min(1),
      content: z.string().min(1).max(100000),
    })
    .parse(req.body);
  const gid = id();
  db.prepare("INSERT INTO guidelines VALUES(?,?,?,?,?)").run(
    gid,
    b.title,
    b.content,
    "draft",
    now(),
  );
  res.json({ id: gid });
});
app.post("/api/guidelines/:id/activate", (req, res) => {
  transaction(() => {
    if (
      !db
        .prepare("SELECT id FROM guidelines WHERE id=?")
        .get(String(req.params.id))
    )
      throw new AppError("规范版本不存在", 404);
    db.prepare(
      "UPDATE guidelines SET status='archived' WHERE status='active'",
    ).run();
    db.prepare("UPDATE guidelines SET status='active' WHERE id=?").run(
      String(req.params.id),
    );
  });
  res.json({ ok: true });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 1 },
});
app.post(
  "/api/projects/:id/import",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) throw new AppError("请选择文件");
    res.json(await importFile(String(req.params.id), req.file));
  },
);
app.get("/api/projects/:id/sources/:source/candidates", (req, res) =>
  res.json(
    extractionCandidates(String(req.params.id), String(req.params.source)),
  ),
);
app.get("/api/files/:id", (req, res) => {
  const f = db
    .prepare("SELECT * FROM files WHERE id=?")
    .get(String(req.params.id)) as any;
  if (!f) throw new AppError("附件不存在", 404);
  res.download(f.path, f.name);
});
app.get("/api/projects/:id/preview", (req, res) => {
  const opts = z
    .object({
      audience: z.enum(["player", "npc", "dm", "author"]),
      revision: z.coerce.number().int(),
      characterId: z.string().optional(),
      throughAct: z.coerce.number().int().positive().optional(),
      template: z.enum(["role", "host", "cards"]).optional(),
      font: z.enum(["serif", "sans"]).optional(),
      fontSize: z.coerce.number().min(12).max(24).optional(),
      margin: z.coerce.number().min(10).max(40).optional(),
    })
    .parse(req.query);
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'",
  );
  res.type("html").send(
    previewHTML(getProject(String(req.params.id), opts.revision), {
      ...opts,
      format: "pdf",
      preview: true,
    }),
  );
});
app.get("/api/projects/:id/releases", (req, res) =>
  res.json(
    (
      db
        .prepare(
          "SELECT id,revision,format,audience,file_name,created_at FROM releases WHERE project_id=? ORDER BY created_at DESC",
        )
        .all(String(req.params.id)) as any[]
    ).map((r) => ({ ...r, url: "/api/releases/" + r.id + "/download" })),
  ),
);
app.get("/api/releases/:id/download", (req, res) => {
  const r = db
    .prepare("SELECT * FROM releases WHERE id=?")
    .get(String(req.params.id)) as any;
  if (!r) throw new AppError("文件不存在", 404);
  res.download(r.path, r.file_name);
});
app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  res.json(
    listProjects()
      .flatMap((p) =>
        p.data.entities
          .filter(
            (e) =>
              e.title.includes(q) ||
              plain(e.body).includes(q) ||
              JSON.stringify(e.fields).includes(q),
          )
          .map((e) => ({
            projectId: p.id,
            projectTitle: p.title,
            id: e.id,
            kind: e.kind,
            title: e.title,
            excerpt: plain(e.body).slice(0, 100),
          })),
      )
      .slice(0, 100),
  );
});
app.use("/api", (_, res) => res.status(404).json({ error: "入口不存在" }));
if (!currentGuideline()) {
  const content = fs.readFileSync(
    fileURLToPath(new URL("./default-guidelines.md", import.meta.url)),
    "utf8",
  );
  db.prepare("INSERT INTO guidelines VALUES(?,?,?,?,?)").run(
    id(),
    "剧本杀写作 · 初始规范",
    content,
    "active",
    now(),
  );
}
if (production) {
  app.use(express.static(path.resolve("dist")));
  app.get("/{*splat}", (_, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message =
      err instanceof ZodError
        ? "输入格式不符合要求：" +
          err.issues
            .slice(0, 3)
            .map((x) => x.message)
            .join("；")
        : err.code === "LIMIT_FILE_SIZE"
          ? "单个文件不能超过40MB"
          : err.message || "操作未完成";
    res.status(err.status || 400).json({ error: message });
  },
);
void initializeProviders().catch(e=>console.error("模型目录同步暂未完成：",e.message));
const providerTimer = setInterval(
  () => void initializeProviders(),
  6 * 60 * 60 * 1000,
);
providerTimer.unref();
const server = app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(`工作台：http://${process.env.HOST || "127.0.0.1"}:${port}`),
);
const worker =
  process.env.NO_WORKER === "1"
    ? null
    : spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(new URL("./worker.ts", import.meta.url)),
        ],
        {
          env: { ...process.env, WORKBENCH_WORKER: "1" },
          stdio: ["ignore", "inherit", "inherit"],
        },
      );
const close = () => {
  worker?.kill("SIGTERM");
  server.close(() => process.exit());
  setTimeout(() => process.exit(), 1000);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
