import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jubensha-live-rag-"));
process.env.WORKBENCH_DATA = dir;
process.env.WORKBENCH_ENV_FILE = path.resolve(".env");
const { db } = await import("../server/db.js");
const { createProject } = await import("../server/projects.js");
const { newEntity, doc } = await import("../shared/domain.js");
const { indexProject, retrieve } = await import("../server/retrieval.js");
try {
  const e = newEntity("document", "烟雨邮局");
  e.body = doc(
    "林舟把最后一封信藏在邮局蓝色铁盒里。\n苏宁以为信已经在大火中被烧毁。",
  );
  const p = createProject("检索接口验收", "", [e]);
  const status = await indexProject(p.id);
  const result = await retrieve(p.id, "最后的信放在哪里");
  if (
    !result.hits.some((h) => h.text.includes("蓝色铁盒")) ||
    result.mode !== "hybrid-rerank"
  )
    throw Error("语义召回或重排验证未通过");
  const summary = {
    at: new Date().toISOString(),
    model: status.model,
    indexed: status.indexed,
    mode: result.mode,
    citations: result.hits.length,
    passed: true,
  };
  fs.writeFileSync(
    "output/retrieval-smoke.json",
    JSON.stringify(summary, null, 2),
  );
  console.log(summary);
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
