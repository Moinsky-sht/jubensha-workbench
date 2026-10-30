import fs from "node:fs";
import { z } from "zod";
import os from "node:os";
import path from "node:path";
process.env.WORKBENCH_DATA = fs.mkdtempSync(
  path.join(os.tmpdir(), "jubensha-creative-"),
);
process.env.WORKBENCH_ENV_FILE = path.resolve(".env");
const { db, id } = await import("../server/db.js");
const { createProject, applyChange, getProject } =
  await import("../server/projects.js");
const { newEntity, operationSchema } = await import("../shared/domain.js");
const { saveConnection, callModel, parseReply, systemPrompt, buildContext } =
  await import("../server/models.js");
const { priorities } = await import("../server/providers.js");
const results: any[] = [];
try {
  for (const model of priorities) {
    const e = newEntity("concept", "雨夜邮局");
    const p = createProject("创作链路验证", "", [e]);
    const c = saveConnection({
      name: model,
      model,
      protocol: "compatible",
      baseUrl: process.env.ARK_BASE_URL!,
      apiKey: process.env.ARK_API_KEY!,
      managed: "ark",
      structured: !model.startsWith("deepseek"),
      contextLimit: 131072,
      maxOutput: 3000,
      timeout: 120,
      concurrency: 2,
    });
    const scope = { module: "concept", entityIds: [e.id] };
    const messages: any[] = [
      {
        role: "user",
        content: JSON.stringify({
          request: `修改当前创意方向 ${e.id}，将核心困境写成一段30至60字的情感冲突：两个邮递员只能保留一人的记忆。只更新fields.conflict，不新增对象。`,
          context: buildContext(p, scope, c.contextLimit).text,
        }),
      },
    ];
    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await callModel(
        { ...c, apiKey: process.env.ARK_API_KEY! },
        { system: systemPrompt(""), messages },
      );
      try {
        result = parseReply(raw);
        z.array(operationSchema).parse(result.operations);
        break;
      } catch (e) {
        result = undefined;
        messages.push(
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "仅修复JSON字段与操作格式，不改变任务范围。错误：" + String(e),
          },
        );
      }
    }
    if (!result?.operations.length) throw Error(model + " 没有形成修改");
    const changed = applyChange({
      projectId: p.id,
      baseRevision: 0,
      requestId: id(),
      scope,
      source: "ai",
      operations: result.operations,
    });
    if (
      changed.change.status !== "applied" ||
      !getProject(p.id).data.entities[0].fields.conflict
    )
      throw Error(model + " 修改未落库");
    results.push({ model, applied: true, revision: changed.project.revision });
    console.log(model, "创意修改已落库");
  }
  fs.writeFileSync(
    "output/creative-smoke.json",
    JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
  );
} finally {
  db.close();
  fs.rmSync(process.env.WORKBENCH_DATA!, { recursive: true, force: true });
}
