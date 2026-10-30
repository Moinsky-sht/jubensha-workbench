import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import { TableKit } from "@tiptap/extension-table";
import { db, id, now, transaction } from "./db.js";
import { z } from "zod";
import {
  operationSchema,
  entitySchema,
  definitions,
  moduleFor,
  plain,
  doc,
  newEntity,
  type Project,
  type Entity,
  type Operation,
  type Scope,
  type Change,
  type RichNode,
} from "../shared/domain.js";
const documentSchema = getSchema([
  StarterKit,
  UniqueID.configure({ types: ["paragraph", "heading"] }),
  TableKit,
]);
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function getProject(projectId: string, revision?: number): Project {
  if (revision !== undefined) {
    const r = db
      .prepare(
        "SELECT snapshot FROM revisions WHERE project_id=? AND revision=?",
      )
      .get(projectId, revision) as any;
    if (!r) throw new AppError("版本不存在", 404);
    return JSON.parse(r.snapshot);
  }
  const r = db
    .prepare("SELECT * FROM projects WHERE id=?")
    .get(projectId) as any;
  if (!r) throw new AppError("项目不存在", 404);
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    revision: r.revision,
    archived: !!r.archived,
    updatedAt: r.updated_at,
    data: JSON.parse(r.data),
  };
}
export function listProjects() {
  return (
    db
      .prepare("SELECT id FROM projects ORDER BY updated_at DESC")
      .all() as any[]
  ).map((r) => getProject(r.id));
}
export function createProject(
  title: string,
  description = "",
  entities: Entity[] = [],
) {
  if (!title.trim()) throw new AppError("请填写项目名称");
  const p: Project = {
    id: id(),
    title: title.trim().slice(0, 100),
    description,
    revision: 0,
    archived: false,
    updatedAt: now(),
    data: { entities },
  };
  transaction(() => {
    db.prepare("INSERT INTO projects VALUES(?,?,?,?,?,?,?,?)").run(
      p.id,
      p.title,
      p.description,
      0,
      0,
      JSON.stringify(p.data),
      p.updatedAt,
      p.updatedAt,
    );
    db.prepare("INSERT INTO revisions VALUES(?,?,?,?)").run(
      p.id,
      0,
      JSON.stringify(p),
      p.updatedAt,
    );
  });
  return p;
}
export function copyProject(projectId: string) {
  const p = getProject(projectId),
    map = new Map(p.data.entities.map((e) => [e.id, id()]));
  const entities = p.data.entities.map((e) => ({
    ...structuredClone(e),
    id: map.get(e.id)!,
    refs: e.refs.map((r) => map.get(r) || r),
    fileId: undefined,
  }));
  const copy = createProject(p.title + " · 副本", p.description, entities);
  for (const e of p.data.entities.filter((e) => e.fileId)) {
    const f = db
      .prepare("SELECT * FROM files WHERE id=? AND project_id=?")
      .get(e.fileId!, p.id) as any;
    if (f) {
      const fid = id();
      db.prepare("INSERT INTO files VALUES(?,?,?,?,?,?)").run(
        fid,
        copy.id,
        f.name,
        f.mime,
        f.path,
        f.size,
      );
      copy.data.entities.find((x) => x.id === map.get(e.id))!.fileId = fid;
    }
  }
  db.prepare("UPDATE projects SET data=? WHERE id=?").run(
    JSON.stringify(copy.data),
    copy.id,
  );
  db.prepare(
    "UPDATE revisions SET snapshot=? WHERE project_id=? AND revision=0",
  ).run(JSON.stringify(copy), copy.id);
  return copy;
}
export function updateProjectMeta(projectId: string, changes: any) {
  const p = getProject(projectId);
  if (typeof changes.title === "string")
    p.title = changes.title.trim().slice(0, 100) || p.title;
  if (typeof changes.description === "string")
    p.description = changes.description;
  if (typeof changes.archived === "boolean") p.archived = changes.archived;
  if (changes.defaultModel !== undefined)
    p.data.defaultModel = String(changes.defaultModel);
  if (changes.moduleModels) p.data.moduleModels = changes.moduleModels;
  return transaction(() => commit(p));
}
function commit(p: Project) {
  p.revision++;
  p.updatedAt = now();
  db.prepare(
    "UPDATE projects SET title=?,description=?,revision=?,archived=?,data=?,updated_at=? WHERE id=?",
  ).run(
    p.title,
    p.description,
    p.revision,
    p.archived ? 1 : 0,
    JSON.stringify(p.data),
    p.updatedAt,
    p.id,
  );
  db.prepare("INSERT INTO revisions VALUES(?,?,?,?)").run(
    p.id,
    p.revision,
    JSON.stringify(p),
    p.updatedAt,
  );
  return p;
}
function normalizeBody(node: RichNode) {
  if (node.type === "paragraph" || node.type === "heading")
    node.attrs = { ...node.attrs, id: node.attrs?.id || id() };
  for (const child of node.content || []) normalizeBody(child);
}
function replaceText(
  e: Entity,
  blockId: string,
  expected: string,
  replacement: string,
) {
  let block: RichNode | undefined;
  function visit(n: RichNode) {
    if (n.attrs?.id === blockId) block = n;
    else for (const c of n.content || []) visit(c);
  }
  visit(e.body);
  if (!block) throw new AppError("原段落已不存在，请重新选择");
  const text = plain(block),
    start = text.indexOf(expected);
  if (start < 0 || text.indexOf(expected, start + 1) >= 0)
    throw new AppError("选中文本已变化或无法唯一定位");
  let cursor = 0,
    inserted = false;
  function edit(n: RichNode) {
    if (n.type === "text") {
      const original = n.text || "",
        a = cursor,
        b = cursor + original.length;
      cursor = b;
      if (b <= start || a >= start + expected.length) return;
      const prefix = original.slice(0, Math.max(0, start - a)),
        suffix = original.slice(Math.max(0, start + expected.length - a));
      n.text = prefix + (!inserted ? replacement : "") + suffix;
      inserted = true;
    } else for (const c of n.content || []) edit(c);
  }
  edit(block);
  function clean(n: RichNode) {
    n.content = n.content?.filter((c) => c.type !== "text" || !!c.text);
    n.content?.forEach(clean);
  }
  clean(e.body);
}
function targets(op: Operation) {
  return op.type === "create_entity"
    ? [op.entity.id]
    : op.type === "replace_text"
      ? [op.documentId]
      : op.type === "reorder"
        ? op.entityIds
        : [op.entityId];
}
function validateFields(e: Entity) {
  const keys = new Set(definitions[e.kind].fields.map((f) => f.key));
  for (const key of Object.keys(e.fields))
    if (!keys.has(key))
      throw new AppError(`“${e.title}”包含不支持的字段：${key}`);
}
export function previewOperations(
  p: Project,
  operations: Operation[],
  scope: Scope,
  source: string,
  reviewed = false,
) {
  const next = structuredClone(p);
  const reasons: string[] = [];
  const touched = new Set<string>();
  for (const op of operations) {
    if (scope.selection && !scope.projectWide && op.type !== "replace_text")
      reasons.push("修改超出选中文本");
    for (const tid of targets(op)) {
      const target = next.data.entities.find((e) => e.id === tid);
      const kind = op.type === "create_entity" ? op.entity.kind : target?.kind;
      if (!kind) throw new AppError("修改对象不存在");
      const inScope =
        scope.projectWide ||
        (scope.entityIds?.length
          ? scope.entityIds.includes(tid)
          : moduleFor(kind) === scope.module);
      if (!inScope) reasons.push("修改超出本轮范围");
      if (target?.locked && op.type !== "set_lock")
        reasons.push(`“${target.title}”已锁定`);
      if (
        target?.status === "ready" &&
        op.type !== "set_lock" &&
        !(
          op.type === "update_entity" &&
          op.changes.status === "draft" &&
          Object.keys(op.changes).every((k) => ["status", "stale"].includes(k))
        )
      )
        reasons.push(`“${target.title}”已经定稿`);
      touched.add(tid);
    }
    if (op.type === "create_entity") {
      if (next.data.entities.some((e) => e.id === op.entity.id))
        throw new AppError("对象编号重复");
      if (
        source === "ai" &&
        (op.entity.locked || op.entity.status === "ready" || op.entity.fileId)
      )
        throw new AppError("生成内容只能进入草稿");
      next.data.entities.push(structuredClone(op.entity));
    } else if (op.type === "reorder") {
      if (new Set(op.entityIds).size !== op.entityIds.length)
        throw new AppError("排序对象重复");
      const rows = op.entityIds.map((i) =>
        next.data.entities.find((e) => e.id === i)!,
      );
      if (new Set(rows.map((e) => e.kind)).size !== 1)
        throw new AppError("请在同类对象中调整顺序");
      rows.forEach((e, i) => (e.order = i));
    } else {
      const tid = op.type === "replace_text" ? op.documentId : op.entityId;
      const target = next.data.entities.find((e) => e.id === tid)!;
      if (op.type === "delete_entity") {
        if (
          next.data.entities.some(
            (e) =>
              e.refs.includes(tid) &&
              !operations.some(
                (o) => o.type === "delete_entity" && o.entityId === e.id,
              ),
          )
        )
          reasons.push(`“${target.title}”仍有引用，需同时解除关联`);
        next.data.entities = next.data.entities.filter((e) => e.id !== tid);
      }
      if (op.type === "set_lock") {
        if (source === "ai") throw new AppError("模型不能更改锁定状态");
        target.locked = op.locked;
      }
      if (op.type === "update_entity") {
        if (target.fileId && target.kind === "source" && op.changes.body)
          throw new AppError("原始素材只读，请创建提炼条目");
        if (source === "ai" && op.changes.status === "ready")
          throw new AppError("模型不能自行定稿");
        Object.assign(target, {
          ...op.changes,
          fields: op.changes.fields
            ? { ...target.fields, ...op.changes.fields }
            : target.fields,
        });
        target.stale = false;
      }
      if (op.type === "replace_text") {
        if (target.kind !== "document")
          throw new AppError("文本替换只适用于正文");
        if (
          scope.selection &&
          !scope.projectWide &&
          (scope.selection.blockId !== op.blockId ||
            scope.selection.text !== op.expectedText)
        )
          reasons.push("替换超出选区");
        replaceText(target, op.blockId, op.expectedText, op.replacement);
        target.stale = false;
      }
    }
  }
  const ids = new Set(next.data.entities.map((e) => e.id));
  for (const e of next.data.entities) {
    validateFields(e);
    entitySchema.parse(e);
    normalizeBody(e.body);
    try {
      documentSchema.nodeFromJSON(e.body).check();
    } catch {
      throw new AppError(`“${e.title}”的正文结构不完整，请重新生成`);
    }
    const blockIds = new Set<string>();
    function checkIds(n: RichNode) {
      if (n.attrs?.id) {
        if (blockIds.has(n.attrs.id))
          throw new AppError("段落编号重复，请重新生成");
        blockIds.add(n.attrs.id);
      }
      n.content?.forEach(checkIds);
    }
    checkIds(e.body);
    if (e.refs.some((ref) => !ids.has(ref)))
      throw new AppError(`“${e.title}”存在失效关联，请一并修复`);
  }
  const changedFacts = [...touched].filter((i) => {
    const a = p.data.entities.find((e) => e.id === i),
      b = next.data.entities.find((e) => e.id === i);
    return (
      !a ||
      !b ||
      JSON.stringify({ ...a, locked: false, status: "draft" }) !==
        JSON.stringify({ ...b, locked: false, status: "draft" })
    );
  });
  const impacted = new Set(changedFacts);
  let dirty = true;
  while (dirty) {
    dirty = false;
    for (const e of next.data.entities)
      if (!impacted.has(e.id) && e.refs.some((r) => impacted.has(r))) {
        impacted.add(e.id);
        dirty = true;
      }
  }
  for (const e of next.data.entities)
    if (impacted.has(e.id) && !touched.has(e.id)) e.stale = true;
  for (const c of next.data.entities.filter(
    (e) => e.kind === "constraint" && e.locked,
  )) {
    const words = String(c.fields.forbidden || "")
      .split(/[、,，\n]/)
      .filter(Boolean);
    for (const e of next.data.entities.filter(
      (e) =>
        touched.has(e.id) &&
        e.kind === "document" &&
        (!c.refs.length ||
          c.refs.includes(e.id) ||
          e.refs.some((r) => c.refs.includes(r))),
    ))
      if (words.some((w) => plain(e.body).includes(w)))
        reasons.push(`“${e.title}”命中锁定禁用词`);
  }
  return {
    next,
    reasons: [...new Set(reasons)],
    impacted: [...impacted].filter((x) => !touched.has(x)),
  };
}
function readChange(r: any): Change {
  return {
    id: r.id,
    projectId: r.project_id,
    baseRevision: r.base_revision,
    operations: JSON.parse(r.operations),
    status: r.status,
    summary: r.summary,
    reasons: JSON.parse(r.reasons),
    createdAt: r.created_at,
    source: r.source,
    conversationId: r.conversation_id,
    before: r.before_snapshot ? JSON.parse(r.before_snapshot) : undefined,
    after: r.after_snapshot ? JSON.parse(r.after_snapshot) : undefined,
  };
}
export function getChange(cid: string) {
  const r = db.prepare("SELECT * FROM changes WHERE id=?").get(cid) as any;
  if (!r) throw new AppError("修改记录不存在", 404);
  return readChange(r);
}
export function listChanges(pid: string) {
  return (
    db
      .prepare(
        "SELECT * FROM changes WHERE project_id=? ORDER BY created_at DESC LIMIT 100",
      )
      .all(pid) as any[]
  ).map(readChange);
}
export function applyChange(input: {
  projectId: string;
  requestId: string;
  baseRevision: number;
  operations: unknown;
  scope: Scope;
  source: string;
  summary?: string;
  conversationId?: string;
}) {
  const ops = z.array(operationSchema).min(1).max(200).parse(input.operations);
  if (input.scope.discussOnly) throw new AppError("当前对话只讨论，不写入");
  return transaction(() => {
    const prior = db
      .prepare("SELECT * FROM changes WHERE request_id=?")
      .get(input.requestId) as any;
    if (prior) {
      if (prior.project_id !== input.projectId)
        throw new AppError("请求标识已使用");
      return {
        change: readChange(prior),
        project: getProject(input.projectId),
      };
    }
    const p = getProject(input.projectId);
    const base =
      p.revision === input.baseRevision
        ? p
        : getProject(p.id, input.baseRevision);
    const before = structuredClone(base);
    const { next, reasons } = previewOperations(
      base,
      ops,
      input.scope,
      input.source,
    );
    if (p.revision !== input.baseRevision)
      reasons.push("生成期间项目版本已变化");
    const status = reasons.length ? "pending" : "applied";
    const cid = id();
    if (status === "applied") commit(next);
    db.prepare("INSERT INTO changes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      cid,
      p.id,
      input.requestId,
      input.baseRevision,
      JSON.stringify(ops),
      status,
      (input.summary || `修改 ${ops.length} 处`).slice(0, 500),
      JSON.stringify(reasons),
      input.source,
      input.conversationId || null,
      JSON.stringify(input.scope),
      JSON.stringify(before),
      status === "applied" ? JSON.stringify(next) : null,
      now(),
    );
    return { change: getChange(cid), project: status === "applied" ? next : p };
  });
}
export function resolveChange(
  cid: string,
  action: string,
  baseRevision: number,
  operations?: unknown,
) {
  return transaction(() => {
    const c = getChange(cid);
    if (c.status !== "pending") throw new AppError("这条修改已处理");
    if (action === "reject") {
      db.prepare("UPDATE changes SET status='rejected' WHERE id=?").run(cid);
      return { change: getChange(cid), project: getProject(c.projectId) };
    }
    const p = getProject(c.projectId);
    if (p.revision !== baseRevision)
      throw new AppError("版本又有变化，请重新查看差异", 409);
    if (c.reasons.includes("生成期间项目版本已变化") && !operations)
      throw new AppError("请编辑并重新确认冲突后的修改内容");
    const ops = operations
      ? z.array(operationSchema).min(1).max(200).parse(operations)
      : c.operations;
    const before = structuredClone(p);
    const { next } = previewOperations(
      p,
      ops,
      { module: "all", projectWide: true },
      c.source,
      true,
    );
    commit(next);
    db.prepare(
      "UPDATE changes SET status='applied',before_snapshot=?,after_snapshot=?,operations=?,base_revision=? WHERE id=?",
    ).run(
      JSON.stringify(before),
      JSON.stringify(next),
      JSON.stringify(ops),
      p.revision,
      cid,
    );
    return { change: getChange(cid), project: next };
  });
}
export function undoChange(cid: string) {
  return transaction(() => {
    const c = getChange(cid);
    if (c.status !== "applied" || !c.before || !c.after)
      throw new AppError("此修改无法撤销");
    const p = getProject(c.projectId),
      before = structuredClone(p),
      old = c.before.data.entities,
      after = c.after.data.entities;
    const ids = new Set([...old, ...after].map((e) => e.id));
    for (const i of ids) {
      const a = old.find((e) => e.id === i),
        b = after.find((e) => e.id === i);
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const current = p.data.entities.find((e) => e.id === i);
      if (JSON.stringify(current) !== JSON.stringify(b))
        throw new AppError("相关内容已有后续修改，请从版本记录对照恢复", 409);
      const position = p.data.entities.findIndex((e) => e.id === i);
      if (a) {
        if (position >= 0)
          p.data.entities.splice(position, 1, structuredClone(a));
        else
          p.data.entities.splice(
            Math.min(
              old.findIndex((e) => e.id === i),
              p.data.entities.length,
            ),
            0,
            structuredClone(a),
          );
      } else p.data.entities = p.data.entities.filter((e) => e.id !== i);
    }
    commit(p);
    const uid = id();
    db.prepare("INSERT INTO changes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      uid,
      p.id,
      uid,
      before.revision,
      "[]",
      "applied",
      "撤销：" + c.summary,
      "[]",
      "undo",
      null,
      "{}",
      JSON.stringify(before),
      JSON.stringify(p),
      now(),
    );
    db.prepare("UPDATE changes SET status='reverted' WHERE id=?").run(cid);
    return p;
  });
}
export function demoProject() {
  const entities: Entity[] = [];
  const add = (
    kind: Entity["kind"],
    title: string,
    fields: Entity["fields"] = {},
    refs: string[] = [],
    body = "",
    audience: Entity["audience"] = kind === "document" ? "player" : "author",
  ) => {
    const entity = newEntity(kind, title);
    entity.fields = fields;
    entity.refs = refs;
    entity.order = entities.filter((row) => row.kind === kind).length;
    entity.audience = audience;
    if (body) entity.body = doc(body);
    entities.push(entity);
    return entity;
  };

  const source = add(
    "source",
    "《西弦古树》历史对话归档",
    { origin: "剧本杀.md、剧本杀2.md", purpose: "历史讨论" },
    [],
    "本示范依据此前对话中《江家长子》《圣子》及《西弦古树》的连续创作记录整理。原始要求包含七幕结构、五项任务、念源穿越、西弦古树、国师、江楚恒、谢清鸾、李慕白与魁等设定。历史回复仅作为来源，项目中的结构化对象才是当前采用版本。",
  );
  source.locked = true;
  source.status = "ready";
  const concept = add("concept", "跨越两世仍要把选择还给你", {
    genre: "古风 · 情感 · 轮回",
    players: 1,
    minutes: 210,
    conflict:
      "江楚恒与谢清鸾必须杀死国师才能回到前世；回去却意味着其中一人注定献祭。两人都在隐瞒自己愿意代对方赴死的真相。",
    experience: "前半程以师徒任务建立亲密，后半程逐层翻转牺牲对象，最终让玩家亲自选择共同面对哪一种人生。",
    tone: "轻喜、错认、宿命、释然",
    boundary: "不以失忆抹除选择，不让牺牲只承担催泪功能。",
    ending: "二人主动进入时间洪流，承认相爱无法消除代价，但可以共同承担。",
  }, [source.id]);
  const reincarnation = add("rule", "念源只能寄宿未来血脉", {
    trigger: "古树濒死时回应共同誓言",
    effect: "将两人的念源送往未来，从孩童时期重新成长",
    cost: "记忆被拆成碎片，只能随任务逐步恢复",
    direction: "过去到未来",
    exception: "死亡或强行回溯会加速噬魂",
  }, [source.id]);
  const corruption = add("rule", "古树会积蓄失控念源", {
    trigger: "人间执念长期汇入树根",
    effect: "形成噬魂并侵蚀守护者",
    cost: "需要巫女或江家继承人承担封印",
    direction: "古树向守护者",
    exception: "只有重建灵根才能终止轮换献祭",
  }, [source.id]);
  const tasksRule = add("rule", "五项任务唤醒对应记忆", {
    trigger: "江楚恒完成谢清鸾布置的任务",
    effect: "恢复一段前世共同经历",
    cost: "国师也会感知念源位置",
    direction: "现在映照前世",
    exception: "任务可以换方法，不能跳过应有的情感选择",
  }, [source.id]);
  const pastEvent = add("event", "前世古树被国师斩断", {
    time: "前世大雍末年",
    place: "西弦古树祭台",
    actor: "国师",
    truth: "国师斩断灵根并吸收失控念源，江楚恒与谢清鸾联手仍然落败。",
    result: "古树将二人念源送往未来，等待改写结局。",
  }, [reincarnation.id, corruption.id]);
  const sacrificeEvent = add("event", "献祭传说掩盖了替换规则", {
    time: "两世之间",
    place: "古树封印",
    actor: "守护两族",
    truth: "若国师不死，江家继承人必须封印古树；若回到过去，巫女仍会走向献祭。",
    result: "江楚恒与谢清鸾分别只知道对方会死的一半真相。",
  }, [corruption.id]);
  add("constraint", "示范项目的信息边界", {
    rule: "客观事实、角色所知和玩家可读内容分开；魁的身份在第五幕前只给证据，不直接命名。",
    scope: "全项目",
    forbidden: "命中注定所以无需选择、为了你好所以不解释",
    origin: "历史对话中多轮纠错意见",
  }, [source.id]);

  const jiang = add("character", "江楚恒", {
    role: "玩家",
    identity: "江家不受重视的长子",
    era: "今世",
    memory: "由五项任务逐段恢复",
    desire: "摆脱家族评价，保护妹妹，也保住与谢清鸾共同生活的可能",
    secret: "恢复前世记忆后决定阻止谢清鸾杀死国师",
    knowledge: "前期只知道自己被视作废柴；第五幕后知道巫女献祭的结局",
    involvement: "前世与谢清鸾对抗国师，今世执行五项任务",
    arc: "从用玩笑逃避责任，到把真实选择交给爱人",
  }, [concept.id]);
  const qingluan = add("character", "谢清鸾", {
    role: "NPC",
    identity: "谢氏巫女继承人、江楚恒的师父",
    era: "今世",
    memory: "比江楚恒更早恢复，但故意隐瞒代价",
    desire: "让江楚恒活下来，同时争取不再由任何人献祭",
    secret: "杀死国师是为了避免江楚恒代替她封印古树",
    knowledge: "知道任务、轮回与江家献祭规则",
    involvement: "设计五项任务并引导玩家恢复记忆",
    arc: "从独自安排一切，到允许江楚恒共同决定",
  }, [concept.id]);
  const master = add("character", "江问山", {
    role: "NPC",
    identity: "江楚恒的老师父",
    era: "今世",
    desire: "让儿子远离江家献祭使命",
    secret: "他就是江楚恒生父，亲手封印了儿子的天赋",
    knowledge: "知道江家继承人的最终代价",
    involvement: "以贬低和劝退掩护封印",
    arc: "承认保护造成的伤害，并把决定权还给儿子",
  }, [sacrificeEvent.id]);
  const guoshi = add("character", "国师", {
    role: "NPC",
    identity: "掌管时隙节的当朝国师",
    era: "跨越两世",
    desire: "以古树念源维持自身不朽",
    secret: "前世斩断古树灵根的人",
    knowledge: "知道念源寄宿者已经出现",
    involvement: "追踪任务引发的记忆波动",
    arc: "从不可战胜的命运象征，变成必须被共同面对的具体责任",
  }, [pastEvent.id]);
  const limubai = add("character", "李慕白", {
    role: "NPC",
    identity: "傅粉唱戏的纨绔李二郎",
    era: "今世",
    desire: "摆脱家族安排，认真爱一次",
    secret: "与黑衣守护者魁共享同一份受损念源",
    knowledge: "对暗处发生的救援一头雾水",
    involvement: "在明处替魁承接江楚楚的误认",
    arc: "从玩笑式承诺到愿意承担看得见的行动",
  }, [reincarnation.id]);
  const kui = add("character", "魁", {
    role: "NPC",
    identity: "被噬魂侵蚀的黑衣守护者",
    era: "轮回夹层",
    desire: "在彻底消散前把众人送出时间洪流",
    secret: "他是李慕白念源中保留前世记忆的部分",
    knowledge: "知道七十九次失败的轮回",
    involvement: "暗中化解危险并制作不归笔",
    arc: "从无名守护到允许自己的付出被看见",
  }, [corruption.id, limubai.id]);
  const rel = add("relationship", "师徒之名与爱人之实", {
    attraction: "她在古树下许愿不做巫女，他第一次看见完美继承人也想逃跑",
    evidence: "她管住他的酒，他替她把每项荒唐任务做到底",
    conflict: "两人都以保护为名隐瞒对方会承担的代价",
    repair: "在最终选择前交换全部真相，不再替对方决定",
  }, [jiang.id, qingluan.id]);
  add("relationship", "父亲以否定伪装保护", {
    attraction: "江问山始终比任何人更清楚江楚恒真正的天赋",
    evidence: "他劝江楚恒改做厨子，也暗中替他挡下家族试炼",
    conflict: "长期打压让江楚恒把自己当成废物",
    repair: "江问山解除封印并承认父子关系",
  }, [jiang.id, master.id]);
  add("relationship", "明处爱人与暗处守护", {
    attraction: "李慕白以顽劣热烈回应爱，魁以沉默行动承担危险",
    evidence: "每次危机后，李慕白茫然邀功，魁留下发黑血迹",
    conflict: "被误认的善意让真实付出长期无人知晓",
    repair: "不归笔公开两份念源的来处与选择",
  }, [limubai.id, kui.id]);

  const actData = [
    ["第一幕 · 古树下的逃客", "被全族认作废柴，逃课到古树下", "接受谢清鸾的师徒赌约", "谢清鸾也想逃离巫女身份；第一项任务是扇国师一巴掌", "二人的前世关系", "带着任务锦囊离场", 2],
    ["第二幕 · 梦渡千年", "完成前两项荒唐任务后连续做梦", "确认梦境是不是自己的过去", "二人前世身份、国师斩树与念源穿越", "回到过去的献祭代价", "决定继续完成剩余任务", 4],
    ["第三幕 · 医心相照", "李慕白承诺洗心革面，魁仍在暗处", "经历三次被救后的错认", "危险总被提前化解；不归笔与发黑血迹出现", "魁与李慕白的真实关系", "带着不归笔前往时隙节", 5],
    ["第四幕 · 时隙节", "各方在古树通道开启前汇聚", "取得天道残页并辨认敌我", "国师能感知任务；李慕白是时间局的钥匙", "两种献祭规则只揭露其一", "江楚恒看见巫女献祭的历史", 7],
    ["第五幕 · 献祭之名", "江楚恒认定回到过去会害死谢清鸾", "阻止最后一项刺杀任务", "谢清鸾前世曾封印古树；老师父封住了江楚恒天赋", "今世真正要献祭的是江楚恒", "玩家公开拒绝配合谢清鸾", 8],
    ["第六幕 · 各自赴死", "师徒决裂，国师逼近祭台", "拼合双方隐瞒的半份真相", "不杀国师则江楚恒献祭；回到过去则谢清鸾献祭", "古树可以被重建而非继续换人", "二人交换全部记忆与决定权", 9],
    ["第七幕 · 再入洪流", "国师、噬魂与崩塌时隙同时到来", "共同选择并执行结局", "魁留下的残页能打开第三条路", "未来仍不保证圆满", "二人携手进入时间洪流，约定再次相认", 10],
  ] as const;
  const acts = actData.map((row, index) =>
    add("act", row[0], {
      entry: row[1],
      goal: row[2],
      reveal: row[3],
      hidden: row[4],
      exit: row[5],
      emotion: row[6],
    }, [concept.id]),
  );
  const sceneData = [
    ["逃课与许愿", "西弦古树", "看见谢清鸾许愿不做巫女", "被她发现偷听", "她提出五项任务的赌约"],
    ["第一项任务", "国师府外", "设法接近国师", "身份与武力悬殊", "玩家必须亲自决定如何完成一巴掌"],
    ["梦中断树", "前世祭台", "辨认梦中敌人", "记忆碎片互相冲突", "古树说他们会在未来赢"],
    ["第三项锦囊", "江家厨房", "验证任务与记忆关系", "老师父极力阻止", "封印在掌心短暂松动"],
    ["三次错认", "书院、药谷、断崖", "弄清是谁暗中相救", "李慕白每次都茫然邀功", "泥土出现魁的黑血"],
    ["不归笔", "花海", "读取笔中残存记忆", "使用会伤及魁的念源", "笔尖写出时隙节日期"],
    ["群像入场", "时隙节长街", "在众人监视下交换线索", "国师封锁古树通道", "李慕白引开追兵"],
    ["天道残页", "时隙祭台", "从真假残页中作出选择", "两份残页各缺一半", "玩家看到巫女献祭壁画"],
    ["阻止刺杀", "国师内殿", "拖住谢清鸾", "她拒绝说明真正原因", "师徒第一次公开决裂"],
    ["父亲解印", "江家祠堂", "追问自己为何一直是废柴", "江问山仍试图代他决定", "江楚恒恢复天赋也得知献祭资格"],
    ["两份遗书", "古树根部", "交换彼此预留的告别", "两人都写着让对方活下去", "隐瞒的两半规则拼合"],
    ["第三条路", "时隙夹层", "找到重建灵根的方法", "需要放弃确定可控的结局", "魁交出最后一段念源"],
    ["共同迎战", "崩塌祭台", "让玩家的关系选择转化为行动", "国师利用二人的恐惧分化", "不归笔将残页写回树根"],
    ["洪流相认", "时间洪流", "完成最后告别", "无人能保证下一世仍记得", "两人约定用独特动作再次相认"],
  ] as const;
  const scenes = sceneData.map((row, index) =>
    add("scene", `${String(index + 1).padStart(2, "0")} · ${row[0]}`, {
      place: row[1],
      time: `第${Math.floor(index / 2) + 1}幕`,
      desire: row[2],
      obstacle: row[3],
      turn: row[4],
      exit: index % 2 ? actData[Math.floor(index / 2)][5] : "进入本幕下一场",
      revealAt: Math.floor(index / 2) + 1,
    }, [acts[Math.floor(index / 2)].id, jiang.id, qingluan.id]),
  );

  const slap = add("task", "任务一 · 扇国师一巴掌", {
    goal: "在不暴露谢清鸾的前提下接近国师并完成一巴掌",
    truth: "确认今世国师与前世敌人拥有同一念源",
    condition: "玩家自己选择潜入、挑衅或借演绎接近",
    reward: "恢复前世祭台第一段记忆",
  }, [tasksRule.id, scenes[1].id]);
  add("task", "任务二 · 给李二郎画花脸", {
    goal: "在李慕白熟睡时留下只有前世同伴懂的记号",
    truth: "判断李慕白是否也是穿越者",
    condition: "不能伤害或强迫李慕白",
    reward: "确认第三名念源寄宿者",
  }, [tasksRule.id, limubai.id]);
  add("task", "任务三 · 取回太古神木枝", {
    goal: "从国师密室取回灵根残枝",
    truth: "为重建古树保存材料",
    condition: "不得把残枝当作攻击道具消耗",
    reward: "解除江楚恒一层天赋封印",
  }, [tasksRule.id, scenes[3].id]);
  add("task", "任务四 · 带不归笔进入时隙", {
    goal: "让残笔接触天道残页",
    truth: "恢复魁保管的失败轮回记录",
    condition: "玩家需要决定是否相信未署名的守护者",
    reward: "看见献祭壁画",
  }, [tasksRule.id, scenes[5].id, kui.id]);
  add("task", "任务五 · 在祭台作出共同选择", {
    goal: "杀死国师并决定是否回到过去",
    truth: "真正任务是停止替对方决定，找到重建灵根的第三条路",
    condition: "双方交换完整真相后才能执行",
    reward: "进入开放式结局",
  }, [tasksRule.id, scenes[12].id]);
  add("clue", "掌心发黑的开脉石", {
    appearance: "测不出常规灵力，接触古树时却发热",
    truth: "江楚恒念源不属于今世",
    belief: "全族以为他天赋低劣",
    revealAt: 2,
    acquire: "完成任务一后复测",
    payoff: "第五幕由江问山解除封印",
  }, [jiang.id, slap.id]);
  add("clue", "两半天道残页", {
    appearance: "两张文字方向相反的古树皮",
    truth: "分别记录巫女与江家继承人的献祭条件",
    belief: "任一半都像唯一规则",
    revealAt: 4,
    acquire: "时隙节真假残页选择",
    payoff: "第六幕拼合后出现重建灵根的留白",
  }, [scenes[7].id, sacrificeEvent.id]);
  add("memory", "断树之夜", {
    trigger: "国师被掌掴后露出前世相同的念源纹",
    appearance: "玩家看见自己与谢清鸾并肩倒在祭台",
    truth: "二人不是梦见传说，而是亲历前世",
    revealAt: 2,
  }, [pastEvent.id, slap.id]);
  add("memory", "七十九次未完成的相认", {
    trigger: "不归笔蘸到魁的黑血",
    appearance: "许多次轮回中，总有一人先忘记另一人",
    truth: "魁保留了李慕白被剥离的清醒念源",
    revealAt: 6,
  }, [kui.id, limubai.id]);
  const gourd = add("object", "江楚恒的酒葫芦", {
    appearance: "葫芦口系着谢清鸾重新打过的结",
    origin: "她第一次没收他的酒后又还回来",
    owner: "江楚恒",
    gesture: "谢清鸾敲两下葫芦提醒他收起玩笑",
    payoff: "终幕在时间洪流中用同样的两下确认身份",
  }, [jiang.id, qingluan.id]);
  add("object", "不归笔", {
    appearance: "古树残根为杆，笔尖带洗不掉的暗红",
    origin: "魁以受损念源反复炼成",
    owner: "魁转交江楚恒",
    gesture: "写字前先在腕骨轻点一下",
    payoff: "终幕把第三条路写回古树灵根",
  }, [kui.id, scenes[5].id]);

  const chapters = [
    "你从来没有认真做过江家长子。别人练剑时你在灶房偷酒，别人背族规时你躺在西弦古树最粗的枝桠上。那天你逃课，却听见谢清鸾在树下许愿：她不想成为巫女。这个愿望让高高在上的继承人第一次像一个真实的人。她发现了你，没去告状，只让你拜她为师。五个任务换一个成为强者的机会。第一个锦囊展开，你看见六个字：扇国师一巴掌。",
    "巴掌落下以后，你开始梦见另一个自己。梦里你执剑站在谢清鸾身边，西弦古树在火光中断裂，国师从翻涌的噬魂里走来。你们输了。古树最后的声音却说，你们会在未来赢。第二个梦里，两道念源穿过岁月，落进今世江谢两家的孩子身体。你终于明白，那些荒唐任务不是玩笑，而是谢清鸾替你铺好的记忆归路。",
    "今世的李慕白仍然爱得热烈。他说要重新读书，每做对一道题便向人讨一个亲吻。可真正危险来临时，总有一道黑影先一步替众人挡下刀锋。你们在书院、药谷与断崖三次脱险，李慕白每次都比你们更茫然。花海泥土里躺着一支断笔，旁边是一滩发黑的血。笔杆只有两个字：不归。",
    "时隙节开幕，所有人都来到古树祭台。国师封锁长街，李慕白故意把追兵引向画舫，魁则从暗处把半张天道残页塞入不归笔。另一半残页藏在祭台壁画之后。壁画里的巫女以身体镇住树根，名字正是前世的谢清鸾。你忽然知道回到过去意味着什么，也终于理解她为什么从不谈任务完成后的生活。",
    "最后一个刺杀锦囊被你投入火中。谢清鸾第一次真的对你动怒。你宁愿留在今世，也不肯把她送回注定献祭的过去。争执把你们推回江家祠堂，老师父江问山终于解除压在你经脉上的封印。他承认自己是你的父亲，也承认所谓废柴只是他阻止你继承献祭资格的笨拙办法。你的力量回来了，新的死局也随之出现。",
    "你和谢清鸾各自留下的遗书在古树根部被同时找到。她要杀国师，是因为若国师不死，今世需要献祭的人是你；你要阻止她，是因为回到前世，献祭的人会变成她。你们用漫长的隐瞒走到了同一个答案：让对方活。可爱不是替人签下生死状。你们第一次交换全部记忆，把最后的决定放在两个人之间。",
    "国师踏上崩塌的祭台时，魁把最后一缕念源交给不归笔。两半残页之间出现从未被写下的空白：灵根可以重建，代价是放弃能够回到某个确定过去的机会。你握住谢清鸾的手，在不归笔落下前用酒葫芦轻敲两次。下一次轮回，也许你们仍会忘记姓名，却会记得这个回答。字迹没入树根，洪流张开。你们并肩走了进去。",
  ];
  const documents = chapters.map((body, index) =>
    add("document", `江楚恒 · 第${index + 1}幕`, {
      pov: "第二人称",
      minChars: 120,
      maxChars: 1200,
      authorNote: "依据历史讨论整理的流程梗概，非完整角色正文，未验证最终采用版本。",
    }, [jiang.id, acts[index].id, scenes[index * 2].id, scenes[index * 2 + 1].id], body),
  );
  const performanceData = [
    ["师徒赌约", 18, 10, "谢清鸾", "古树", "玩家读完许愿段落", "由玩家亲口接受或拒绝第一项任务", "递出锦囊并追问完成方式", "静置锦囊，改用敲酒葫芦两下", "允许玩家提出替代方案", "只回答谢清鸾当时知道的内容", "玩家带锦囊离场", "酒葫芦、任务锦囊"],
    ["掌掴后的梦", 43, 8, "国师、谢清鸾", "国师府", "任务一完成", "让梦境与当下国师形成视觉对应", "国师露出念源纹，谢清鸾制止追问", "以音效播放古树神谕", "国师提前离场但保留纹样线索", "不解释献祭规则", "切入第二幕记忆", "掌印妆、金色纹样、低频树鸣"],
    ["谁救了你", 72, 12, "李慕白、魁", "药谷", "第三次危机解除", "让玩家发现明暗两位守护者的错位", "李慕白茫然接住感谢，魁只留下断笔", "魁不现身，仅留下咳嗽声", "李慕白承认自己并不知道", "魁只说与不归笔相关的一句", "获得不归笔", "断笔、黑血布景"],
    ["时隙真假页", 105, 15, "国师、李慕白、魁", "祭台", "玩家带不归笔入场", "通过行动选择获得两半残页", "按玩家路线移动追兵和残页", "NPC以环境变化继续推进", "错误选择不封死剧情，增加代价", "只给可见证据", "壁画亮起", "残页两张、壁画投影"],
    ["父亲解印", 137, 12, "江问山、谢清鸾", "江家祠堂", "玩家烧毁刺杀锦囊", "公开废柴身份的成因与父子冲突", "江问山承认并解除封印", "父亲先念出未寄出的家书", "允许玩家拒绝解除，但仍说明真相", "谢清鸾不替父亲辩解", "玩家取得完整力量", "族谱、封印绳"],
    ["两份遗书", 166, 14, "谢清鸾", "古树根部", "两份遗书被找到", "让双方完整说出各自隐瞒", "交换遗书后逐条确认规则", "主持人代读另一封", "拒读时由玩家选择是否烧毁", "只澄清已由证据支持的事实", "开放最终选择", "遗书两封、半页残卷"],
    ["洪流相认", 196, 14, "谢清鸾、国师、魁", "时间洪流", "第三条路被写入灵根", "回收酒葫芦、不归笔与共同动作", "谢清鸾回应两次敲击并携手入洪流", "用动作代替台词", "保留现世结局分支", "不承诺无代价圆满", "灯灭后只留两声轻响", "酒葫芦、不归笔、风声"],
  ] as const;
  performanceData.forEach((row, index) =>
    add("performance", row[0], {
      start: row[1], duration: row[2], performers: row[3], place: row[4],
      entry: row[5], goal: row[6], cooperate: row[7], silent: row[8],
      refuse: row[9], unexpected: row[10], exit: row[11], props: row[12],
    }, [acts[index].id, documents[index].id, scenes[index * 2 + 1].id], "", "dm"),
  );
  add("playtest", "示范项目试跑观察表", {
    version: "历史对话整理版",
    date: "待试跑",
    minutes: 210,
    participants: 1,
    friction: "重点观察第五幕烧毁锦囊是否有足够动机铺垫",
    participation: "记录玩家是否主动追问魁、父亲与两份残页",
    load: "一名演员兼演国师与江问山时需错开换装",
  }, [concept.id, rel.id], "", "author");
  void gourd;
  return createProject(
    "西弦古树 · 流程梗概示例",
    "从此前聊天记录整理的七幕情感本，用于直观看到素材、立意、设定、人物、结构、线索、正文、演绎与试跑如何关联。",
    entities,
  );
}

export function restoreRevision(
  projectId: string,
  revision: number,
  baseRevision: number,
  entityId?: string,
) {
  const old = getProject(projectId, revision),
    current = getProject(projectId);
  const wanted = old.data.entities.filter(
    (e) => !entityId || e.id === entityId,
  );
  if (entityId && !wanted.length) throw new AppError("这个版本没有该对象");
  const ops: Operation[] = [];
  for (const e of wanted) {
    const present = current.data.entities.find((x) => x.id === e.id);
    if (!present)
      ops.push({ type: "create_entity", entity: { ...e, status: "draft" } });
    else {
      const fields = {
        ...Object.fromEntries(Object.keys(present.fields).map((k) => [k, ""])),
        ...e.fields,
      };
      ops.push({
        type: "update_entity",
        entityId: e.id,
        changes: {
          title: e.title,
          fields,
          body: e.kind === "source" && e.fileId ? undefined : e.body,
          refs: e.refs,
          audience: e.audience,
          order: e.order,
          status: "draft",
          stale: false,
        },
      });
    }
  }
  if (!entityId)
    for (const e of current.data.entities)
      if (!wanted.some((x) => x.id === e.id))
        ops.push({ type: "delete_entity", entityId: e.id });
  if (!ops.length) throw new AppError("没有可恢复的内容");
  return applyChange({
    projectId,
    requestId: id(),
    baseRevision,
    operations: ops,
    scope: { module: "all", projectWide: true },
    source: "restore",
    summary:
      "从版本 " + revision + " 恢复" + (entityId ? "当前对象" : "项目内容"),
  });
}
