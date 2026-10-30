import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retrieval-test-"));
process.env.WORKBENCH_DATA = dir;
const { db, id } = await import("../server/db");
const { createProject, applyChange } = await import("../server/projects");
const { newEntity, doc } = await import("../shared/domain");
const { indexProject, retrieve, retrievalStatus } =
  await import("../server/retrieval");
const { textModels } = await import("../server/providers");
const mock = createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  const input = JSON.parse(body);
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify(
      req.url === "/embeddings"
        ? {
            data: input.input.map((text: string, index: number) => ({
              index,
              embedding: text.includes("古树") ? [1, 0, 0] : [0, 1, 0],
            })),
            usage: { total_tokens: 3 },
          }
        : {
            results: input.documents.map((_: string, index: number) => ({
              index,
              relevance_score: 1 - index / 10,
            })),
            usage: { total_tokens: 4 },
          },
    ),
  );
});
mock.listen(0, "127.0.0.1");
await once(mock, "listening");
const base = "http://127.0.0.1:" + (mock.address() as any).port;
Object.assign(process.env, {
  SILICON_EMBEDDING_API_KEY: "test",
  SILICON_EMBEDDING_BASE_URL: base,
  SILICON_EMBEDDING_DIMENSIONS: "3",
  SILICON_RERANK_API_KEY: "test",
  SILICON_RERANK_BASE_URL: base,
});
after(() => {
  mock.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("向量检索按项目过滤，返回稳定段落和出处；未更新向量不能引用旧稿", async () => {
  const a = newEntity("document", "古树之约");
  a.body = doc("古树下，她留下了最后一封信。");
  const b = newEntity("document", "另一个项目");
  b.body = doc("古树下，绝不能泄露这段秘密。");
  const p = createProject("甲", "", [a]),
    q = createProject("乙", "", [b]);
  await indexProject(p.id);
  await indexProject(q.id);
  assert.equal(retrievalStatus(p.id).state.status, "ready");
  const r = await retrieve(p.id, "古树");
  assert.equal(r.mode, "hybrid-rerank");
  assert.ok(r.hits.length);
  assert.ok(r.hits.every((h) => h.entityId === a.id));
  assert.ok(r.hits.some((h) => h.blockId));
  applyChange({
    projectId: p.id,
    requestId: id(),
    baseRevision: 0,
    scope: { module: "all", projectWide: true },
    source: "manual",
    operations: [
      {
        type: "update_entity",
        entityId: a.id,
        changes: { body: doc("她已经烧毁信件。") },
      },
    ],
  });
  const changed = await retrieve(p.id, "古树");
  assert.ok(changed.hits.every((h) => !h.text.includes("最后一封信")));
  await indexProject(p.id);
  const fresh = await retrieve(p.id, "烧毁");
  assert.ok(fresh.hits.some((h) => h.text.includes("烧毁")));
});
test("模型目录排除下线、向量和图像模型", () => {
  const rows: any = [
    { id: "a", domain: "LLM", task_type: ["TextGeneration"] },
    {
      id: "b",
      domain: "LLM",
      status: "Shutdown",
      task_type: ["TextGeneration"],
    },
    { id: "c", domain: "Embedding" },
    { id: "d", domain: "ImageGeneration" },
  ];
  assert.deepEqual(
    textModels(rows).map((m) => m.id),
    ["a"],
  );
});
