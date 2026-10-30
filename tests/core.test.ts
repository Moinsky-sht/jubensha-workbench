import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jubensha-test-"));
process.env.WORKBENCH_DATA = directory;
const { db, id, encrypt, decrypt } = await import("../server/db");
const {
  createProject,
  getProject,
  applyChange,
  resolveChange,
  undoChange,
  copyProject,
  demoProject,
} = await import("../server/projects");
const { newEntity, doc, plain } = await import("../shared/domain");
const { safeEntity, deliverableEntities, exportProject } =
  await import("../server/exports");
const {
  saveConnection,
  listConnections,
  getConnection,
  callModel,
  parseReply,
  buildContext,
} = await import("../server/models");
const { checkProject } = await import("../server/review");
const { creativeTools, workItems, canReuseWorkItem, validateToolOperations, sanitizeGeneratedRefs } =
  await import("../server/agent-tools");
const { shouldRetrySameProvider } = await import("../server/worker");
const { importFile } = await import("../server/imports");
const wide = { module: "all", projectWide: true };
function apply(
  projectId: string,
  operations: any[],
  baseRevision?: number,
  extra: any = {},
) {
  const p = getProject(projectId);
  return applyChange({
    projectId,
    requestId: id(),
    baseRevision: baseRevision ?? p.revision,
    operations,
    scope: wide,
    source: "manual",
    ...extra,
  });
}
after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
test("事务整体提交、幂等重放、无效操作不留半次写入", () => {
  const p = createProject("事务测试");
  const e = newEntity("character", "哥哥");
  const requestId = id();
  const first = apply(p.id, [{ type: "create_entity", entity: e }], 0, {
    requestId,
  });
  const replay = apply(p.id, [{ type: "create_entity", entity: e }], 0, {
    requestId,
  });
  assert.equal(replay.change.id, first.change.id);
  assert.equal(getProject(p.id).data.entities.length, 1);
  assert.throws(() =>
    apply(p.id, [
      { type: "update_entity", entityId: e.id, changes: { title: "改名" } },
      {
        type: "update_entity",
        entityId: "missing",
        changes: { title: "错误" },
      },
    ]),
  );
  assert.equal(getProject(p.id).data.entities[0].title, "哥哥");
  assert.equal(getProject(p.id).revision, 1);
});
test("局部范围、定稿与版本冲突进入审阅，显式采纳后才写入", () => {
  const e = newEntity("character", "哥哥");
  e.locked = true;
  const p = createProject("审阅测试", "", [e]);
  const r = apply(
    p.id,
    [
      {
        type: "update_entity",
        entityId: e.id,
        changes: { fields: { knowledge: "知情", involvement: "未参与" } },
      },
    ],
    0,
    { source: "ai", scope: { module: "writing" } },
  );
  assert.equal(r.change.status, "pending");
  assert.equal(getProject(p.id).data.entities[0].fields.knowledge, undefined);
  const accepted = resolveChange(r.change.id, "apply", 0, r.change.operations);
  assert.equal(accepted.project.data.entities[0].fields.knowledge, "知情");
  const stale = apply(
    p.id,
    [{ type: "update_entity", entityId: e.id, changes: { title: "新名" } }],
    0,
  );
  assert.equal(stale.change.status, "pending");
  assert.ok(stale.change.reasons.includes("生成期间项目版本已变化"));
  assert.throws(() =>
    resolveChange(stale.change.id, "apply", 99, stale.change.operations),
  );
});
test("稳定段落精确替换；误认和客观事实独立；撤销保护后续输入", () => {
  const e = newEntity("document", "正文");
  e.body = doc("她以为哥哥安排了献祭。\n他其实没有参与。");
  const c = newEntity("character", "哥哥");
  c.fields = { knowledge: "知道献祭", involvement: "未参与" };
  const p = createProject("选区测试", "", [e, c]);
  const r = apply(p.id, [
    {
      type: "replace_text",
      documentId: e.id,
      blockId: e.body.content![0].attrs!.id,
      expectedText: "哥哥安排了献祭",
      replacement: "哥哥亲手安排了献祭",
    },
  ]);
  assert.match(plain(getProject(p.id).data.entities[0].body), /亲手/);
  assert.equal(getProject(p.id).data.entities[1].fields.involvement, "未参与");
  apply(p.id, [
    { type: "update_entity", entityId: c.id, changes: { title: "兄长" } },
  ]);
  undoChange(r.change.id);
  assert.equal(plain(getProject(p.id).data.entities[0].body), plain(e.body));
  assert.equal(getProject(p.id).data.entities[1].title, "兄长");
  const next = apply(p.id, [
    {
      type: "replace_text",
      documentId: e.id,
      blockId: e.body.content![0].attrs!.id,
      expectedText: "哥哥",
      replacement: "兄长",
    },
  ]);
  apply(p.id, [
    {
      type: "update_entity",
      entityId: e.id,
      changes: { body: doc("手动新稿") },
    },
  ]);
  assert.throws(() => undoChange(next.change.id), /后续修改/);
});
test("关联传播、插幕不换ID、移除对象需修复引用", () => {
  const a = newEntity("act", "第一幕"),
    b = newEntity("act", "第二幕"),
    d = newEntity("document", "正文");
  d.refs = [a.id];
  const p = createProject("结构测试", "", [a, b, d]);
  apply(p.id, [
    {
      type: "update_entity",
      entityId: a.id,
      changes: { fields: { reveal: "推迟揭密" } },
    },
  ]);
  assert.equal(
    getProject(p.id).data.entities.find((e) => e.id === d.id)?.stale,
    true,
  );
  const insert = newEntity("act", "新的第二幕");
  apply(p.id, [
    { type: "create_entity", entity: insert },
    { type: "reorder", entityIds: [a.id, insert.id, b.id] },
  ]);
  assert.deepEqual(
    getProject(p.id)
      .data.entities.filter((e) => e.kind === "act")
      .sort((a, b) => a.order - b.order)
      .map((e) => e.id),
    [a.id, insert.id, b.id],
  );
  assert.throws(() => apply(p.id, [{ type: "delete_entity", entityId: a.id }]));
  assert.equal(getProject(p.id).data.entities.length, 4);
});
test("模型不能自我解锁、定稿或直接修改只读原件", async () => {
  const p = createProject("原稿");
  await importFile(p.id, {
    originalname: "source.md",
    mimetype: "text/markdown",
    buffer: Buffer.from("# 第一幕\n原始正文"),
  });
  const e = getProject(p.id).data.entities[0];
  assert.throws(() =>
    apply(
      p.id,
      [{ type: "set_lock", entityId: e.id, locked: false }],
      undefined,
      { source: "ai" },
    ),
  );
  assert.throws(() =>
    apply(p.id, [
      {
        type: "update_entity",
        entityId: e.id,
        changes: { body: doc("更改原件") },
      },
    ]),
  );
  const c = newEntity("character");
  c.status = "ready";
  assert.throws(() =>
    apply(p.id, [{ type: "create_entity", entity: c }], undefined, {
      source: "ai",
    }),
  );
});
test("角色包移除作者字段、仅交付定稿、Word和压缩包真实生成", async () => {
  const character = newEntity("character", "玩家甲"),
    d = newEntity("document", "第一幕");
  d.refs = [character.id];
  d.status = "ready";
  d.fields = { pov: "第二人称", authorNote: "隐藏答案：哥哥是真凶" };
  d.body = doc("你站在旧站台。");
  const secret = newEntity("document", "幕后答案");
  secret.audience = "author";
  secret.status = "ready";
  secret.body = doc("绝不可泄露的答案");
  const draft = newEntity("document", "未采用");
  const p = createProject("交付测试", "", [character, d, secret, draft]);
  const result = safeEntity(d, "player");
  assert.ok(!JSON.stringify(result).includes("隐藏答案"));
  assert.deepEqual(
    deliverableEntities(p, "player").map((e) => e.id),
    [d.id],
  );
  for (const format of ["md", "docx", "zip", "json"] as const) {
    const r = await exportProject(p.id, {
      format,
      audience: "player",
      revision: 0,
    });
    const file = db
      .prepare("SELECT path FROM releases WHERE id=?")
      .get(r.id) as any;
    assert.ok(fs.statSync(file.path).size > 50);
    if (format === "md" || format === "json") {
      const content = fs.readFileSync(file.path, "utf8");
      assert.ok(!content.includes("隐藏答案"));
      assert.ok(!content.includes("幕后答案"));
      assert.ok(!content.includes("未采用"));
    }
  }
});
test("批量复制不共享对象编号；附件复制后可独立引用", () => {
  const p = demoProject(),
    copy = copyProject(p.id);
  const ids = new Set(p.data.entities.map((e) => e.id));
  assert.ok(copy.data.entities.every((e) => !ids.has(e.id)));
  assert.ok(
    copy.data.entities.every((e) =>
      e.refs.every((r) => copy.data.entities.some((e) => e.id === r)),
    ),
  );
});
test("《西弦古树》梗概示例覆盖七幕正文、演绎与来源", () => {
  const p = demoProject();
  assert.equal(p.title, "西弦古树 · 流程梗概示例");
  assert.equal(p.data.entities.filter((e) => e.kind === "act").length, 7);
  assert.equal(p.data.entities.filter((e) => e.kind === "document").length, 7);
  assert.equal(p.data.entities.filter((e) => e.kind === "performance").length, 7);
  assert.ok(
    p.data.entities.some(
      (e) => e.kind === "source" && e.locked && e.fields.purpose === "历史讨论",
    ),
  );
  const modules = new Set(p.data.entities.map((e) => e.kind));
  for (const kind of [
    "concept", "rule", "event", "constraint", "character", "relationship",
    "scene", "clue", "task", "memory", "object", "playtest",
  ]) assert.ok(modules.has(kind as any), `缺少 ${kind}`);
});
test("机械审校有证据与定位，发现篇幅、禁词、流程资源冲突", () => {
  const d = newEntity("document", "短文");
  d.fields = { minChars: 300, startsWith: "至今" };
  d.body = doc("谢无恙");
  const rule = newEntity("constraint", "禁名");
  rule.fields = { forbidden: "谢无恙" };
  const a = newEntity("performance", "一"),
    b = newEntity("performance", "二");
  a.fields = { start: 0, duration: 10, performers: "同一NPC", place: "前厅" };
  b.fields = { start: 5, duration: 10, performers: "同一NPC", place: "后厅" };
  const p = createProject("审校测试", "", [d, rule, a, b]);
  const issues = checkProject(p);
  assert.ok(issues.some((i) => i.fields.checkKey === "short:" + d.id));
  assert.ok(
    issues.some((i) => String(i.fields.checkKey).startsWith("schedule:")),
  );
  assert.ok(issues.every((i) => i.refs.length && i.fields.evidence));
});
test("密钥加密与脱敏；四种模型协议返回都规范化；畸形JSON不执行", async () => {
  const secret = "test-only-credential";
  assert.equal(decrypt(encrypt(secret)), secret);
  assert.ok(!encrypt(secret).includes(secret));
  const requests: any[] = [];
  const text = JSON.stringify({
    message: "候选方案",
    operations: [],
    actions: [],
    reads: [],
    guidelineDraft: "",
  });
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const b of req) raw += b;
    requests.push({
      url: req.url,
      body: JSON.parse(raw),
      headers: req.headers,
    });
    res.setHeader("Content-Type", "application/json");
    if (req.url?.endsWith("/chat/completions"))
      res.end(
        JSON.stringify({
          choices: [{ message: { content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      );
    else if (req.url?.endsWith("/responses"))
      res.end(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text }] }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    else if (req.url?.endsWith("/messages"))
      res.end(
        JSON.stringify({
          content: [{ type: "text", text }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    else
      res.end(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        }),
      );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as any).port;
  try {
    for (const protocol of [
      "compatible",
      "openai",
      "anthropic",
      "gemini",
    ] as const) {
      const c = saveConnection({
        name: protocol,
        protocol,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: "test-model",
        apiKey: secret,
        timeout: 10,
        contextLimit: 32000,
        maxOutput: 500,
        concurrency: 2,
        structured: true,
        inputPrice: 1,
        outputPrice: 2,
      });
      assert.ok(!JSON.stringify(c).includes(secret));
      const output = await callModel(getConnection(c.id), {
        system: "test",
        messages: [{ role: "user", content: "hello" }],
      });
      assert.equal(parseReply(output).message, "候选方案");
    }
    assert.equal(requests.length, 4);
    assert.equal(requests[2].headers["x-api-key"], secret);
    assert.equal(requests[3].headers["x-goog-api-key"], secret);
    assert.ok(!JSON.stringify(listConnections()).includes(secret));
    assert.throws(() => parseReply('{"operations":'));
    assert.throws(() => parseReply('{"message":"x","shell":"rm"}'));
  } finally {
    server.close();
  }
});
test("模型响应按增量读取，完整结构仍在写入前校验", async () => {
  const expected = JSON.stringify({
    message: "流式完成",
    operations: [],
    actions: [],
    reads: [],
    guidelineDraft: "",
  });
  const mock = createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const part of [expected.slice(0, 24), expected.slice(24, 61), expected.slice(61)])
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  try {
    const connection = saveConnection({
      name: "stream-fixture",
      protocol: "compatible",
      baseUrl: `http://127.0.0.1:${(mock.address() as any).port}/v1`,
      model: "fixture",
      apiKey: "fixture-secret",
      timeout: 10,
      contextLimit: 32000,
      maxOutput: 500,
      concurrency: 1,
      structured: true,
    });
    const deltas: string[] = [];
    const output = await callModel(getConnection(connection.id), {
      system: "test",
      messages: [{ role: "user", content: "stream" }],
      onDelta: (delta) => deltas.push(delta),
    });
    assert.equal(deltas.length, 3);
    assert.equal(deltas.join(""), expected);
    assert.equal(parseReply(output).message, "流式完成");
  } finally {
    mock.closeAllConnections();
    mock.close();
  }
});
test("上下文容量不足明确报错，不静默漏掉锁定约束", () => {
  const e = newEntity("constraint", "长约束");
  e.locked = true;
  e.body = doc("约束".repeat(2000));
  const p = createProject("上下文测试", "", [e]);
  assert.throws(() => buildContext(p, { module: "concept" }, 1000), /容量/);
});

test("《西弦古树》纠错样本：同名实例、角色误认和冻结设定保持分离", () => {
  const past = newEntity("character", "谢晨微"),
    present = newEntity("character", "谢晨微"),
    event = newEntity("event", "献祭安排"),
    view = newEntity("document", "妹妹视角");
  past.fields = { era: "过去", knowledge: "尚不知情" };
  present.fields = { era: "现在", knowledge: "知情", involvement: "未参与" };
  event.fields = { actor: "执行者甲", truth: "哥哥没有参与执行" };
  view.fields = { authorNote: "妹妹此时仍有误会" };
  view.refs = [present.id, event.id];
  view.body = doc("你始终以为，是他安排了这一切。");
  const p = createProject("历史纠错回归", "测试样本，不作为模板", [
    past,
    present,
    event,
    view,
  ]);
  apply(
    p.id,
    [
      {
        type: "update_entity",
        entityId: present.id,
        changes: { knowledge: "ignored" },
      },
    ].map((o: any) => ({
      ...o,
      changes: {
        fields: { knowledge: "提前知道献祭安排", involvement: "未参与" },
      },
    })),
  );
  const current = getProject(p.id);
  assert.equal(
    current.data.entities.find((e) => e.id === past.id)!.fields.knowledge,
    "尚不知情",
  );
  assert.equal(
    current.data.entities.find((e) => e.id === event.id)!.fields.actor,
    "执行者甲",
  );
  assert.equal(
    plain(current.data.entities.find((e) => e.id === view.id)!.body),
    plain(view.body),
  );
  assert.equal(
    current.data.entities.find((e) => e.id === view.id)!.stale,
    true,
  );
});
test("精确选区不能被整篇更新绕过；正文结构和重复编号在事务中校验", () => {
  const e = newEntity("document", "第二幕");
  e.body = doc("保留的开头\n争执段落");
  const p = createProject("局部边界", "", [e]);
  const r = apply(
    p.id,
    [
      {
        type: "update_entity",
        entityId: e.id,
        changes: { body: doc("整篇替换") },
      },
    ],
    0,
    {
      source: "ai",
      scope: {
        module: "writing",
        entityIds: [e.id],
        selection: { blockId: e.body.content![1].attrs!.id, text: "争执段落" },
      },
    },
  );
  assert.equal(r.change.status, "pending");
  assert.throws(() =>
    apply(p.id, [
      {
        type: "update_entity",
        entityId: e.id,
        changes: { body: { type: "made_up", content: [] } },
      },
    ]),
  );
  assert.throws(() =>
    apply(p.id, [
      {
        type: "update_entity",
        entityId: e.id,
        changes: {
          body: {
            type: "doc",
            content: [e.body.content![0], e.body.content![0]],
          },
        },
      },
    ]),
  );
  assert.equal(getProject(p.id).revision, 0);
});
test("恢复对象版本只处理目标，模板新项目不共享人物编号或模型连接", async () => {
  const { restoreRevision } = await import("../server/projects");
  const { saveTemplate, fromTemplate } = await import("../server/templates");
  const a = newEntity("act", "原幕名"),
    c = newEntity("character", "独立人物");
  const p = createProject("版本恢复", "", [a, c]);
  apply(p.id, [
    { type: "update_entity", entityId: a.id, changes: { title: "修改后" } },
  ]);
  const t = saveTemplate(p.id, "只用幕结构", [a.id]);
  const fresh = fromTemplate(t.id, "另一作品", "保留这条创作简报");
  assert.equal(fresh.data.entities.length, 1);
  assert.equal(fresh.data.entities[0].kind, "act");
  assert.notEqual(fresh.data.entities[0].id, a.id);
  assert.equal(fresh.data.defaultModel, undefined);
  assert.equal(fresh.description, "保留这条创作简报");
  restoreRevision(p.id, 0, 1, a.id);
  assert.equal(
    getProject(p.id).data.entities.find((e) => e.id === a.id)!.title,
    "原幕名",
  );
  assert.equal(
    getProject(p.id).data.entities.find((e) => e.id === c.id)!.title,
    "独立人物",
  );
});
test("主创智能体复用已有上游成果，只补目标角色与分幕的缺项", () => {
  const concept = newEntity("concept", "已有立意"),
    character = newEntity("character", "玩家甲"),
    act = newEntity("act", "第一幕"),
    scene = newEntity("scene", "初见"),
    manuscript = newEntity("document", "玩家甲角色本");
  character.fields.role = "玩家";
  scene.refs = [act.id];
  manuscript.refs = [character.id];
  const project = createProject("续写生产", "", [
    concept,
    character,
    act,
    scene,
    manuscript,
  ]);
  const conceptTool = creativeTools.find(
      (tool: any) => tool.id === "concept.position",
    )!,
    writingTool = creativeTools.find(
      (tool: any) => tool.id === "writing.role-draft",
    )!,
    performanceTool = creativeTools.find(
      (tool: any) => tool.id === "performance.act-flow",
    )!;
  assert.equal(
    canReuseWorkItem(conceptTool, workItems(conceptTool, project)[0], project),
    true,
  );
  assert.equal(
    canReuseWorkItem(
      writingTool,
      workItems(writingTool, project)[0],
      project,
    ),
    false,
  );
  assert.equal(
    canReuseWorkItem(
      performanceTool,
      workItems(performanceTool, project)[0],
      project,
    ),
    false,
  );
});
test("模块工具把模型正文规范为稳定段落结构", () => {
  const project = createProject("结构规范化"),
    tool = creativeTools.find((row: any) => row.id === "concept.position")!,
    concept = newEntity("concept", "不规范正文");
  concept.fields = { genre: "情感", truth_source: "模型自造字段" };
  concept.body = {
    type: "doc",
    refs: ["模型误放的字段"],
    content: [{ type: "text", text: "仍应保留的内容" }],
  } as any;
  const operations = validateToolOperations(
    tool,
    workItems(tool, project)[0],
    project,
    [
      { type: "create_entity", entity: newEntity("rule", "越界附带内容") },
      { type: "create_entity", entity: concept },
    ],
  );
  assert.equal(operations.length, 1);
  assert.equal(operations[0].type, "create_entity");
  if (operations[0].type !== "create_entity") throw new Error("操作类型错误");
  assert.equal(operations[0].entity.body.content?.[0].type, "paragraph");
  assert.equal(plain(operations[0].entity.body), "仍应保留的内容");
  assert.deepEqual(operations[0].entity.fields, { genre: "情感" });
});

test("生产阶段保留有效关联并移除模型虚构的对象编号", () => {
  const project = createProject("关联修复"),
    first = newEntity("rule", "第一条规则"),
    second = newEntity("event", "共同事件");
  first.refs = [second.id, "missing-entity"];
  second.refs = ["missing-entity"];
  const operations = sanitizeGeneratedRefs(project, [
    { type: "create_entity", entity: first },
    { type: "create_entity", entity: second },
  ]);
  assert.deepEqual((operations[0] as any).entity.refs, [second.id]);
  assert.deepEqual((operations[1] as any).entity.refs, []);
});
test("模型超时立即切换供应商，短暂网络错误最多重试两次", () => {
  assert.equal(shouldRetrySameProvider({ name: "TimeoutError" }, 0), false);
  assert.equal(shouldRetrySameProvider({ name: "TypeError" }, 0), true);
  assert.equal(shouldRetrySameProvider({ retryable: true }, 0), true);
  assert.equal(shouldRetrySameProvider({ retryable: true }, 1), true);
  assert.equal(shouldRetrySameProvider({ retryable: true }, 2), false);
});
test('四类适配器自然语言流式增量一致，不强制修改JSON协议',async()=>{
 const bodies:any[]=[];
 const server=createServer(async(req,res)=>{let raw='';for await(const x of req)raw+=x;bodies.push(JSON.parse(raw));res.writeHead(200,{'Content-Type':'text/event-stream'});
 for(const delta of ['故事','正在继续。']){const event=req.url?.includes('/chat/completions')?{choices:[{delta:{content:delta}}]}:req.url?.includes('/responses')?{type:'response.output_text.delta',delta}:req.url?.includes('/messages')?{type:'content_block_delta',delta:{type:'text_delta',text:delta}}:{candidates:[{content:{parts:[{text:delta}]}}]};const payload='data: '+JSON.stringify(event)+'\n\n';res.write(payload.slice(0,11));res.write(payload.slice(11));}res.end("data: [DONE]\n\n");});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{for(const protocol of ['compatible','openai','anthropic','gemini'] as const){const c=saveConnection({name:'stream-'+protocol,protocol,baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,model:'test',apiKey:'test-secret',timeout:10,contextLimit:32000,maxOutput:500,concurrency:2,structured:true});const deltas:string[]=[];const text=await callModel(getConnection(c.id),{system:'回答',messages:[{role:'user',content:'讲了啥'}],output:'text',onDelta:s=>deltas.push(s)});assert.equal(text,'故事正在继续。');assert.deepEqual(deltas,['故事','正在继续。']);}
 for(const body of bodies){assert.equal(body.response_format,undefined);assert.equal(body.text?.format,undefined);assert.equal(body.generationConfig?.responseMimeType,undefined);}
 }finally{server.close();}
});
