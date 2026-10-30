import { z } from "zod";
export const modules = [
  { id: "sources", label: "素材", icon: "Files", kinds: ["source", "asset"] },
  { id: "concept", label: "立意", icon: "Lightbulb", kinds: ["concept"] },
  {
    id: "world",
    label: "设定",
    icon: "Orbit",
    kinds: ["rule", "event", "constraint"],
  },
  {
    id: "characters",
    label: "人物",
    icon: "Users",
    kinds: ["character", "relationship"],
  },
  {
    id: "structure",
    label: "结构",
    icon: "LayoutGrid",
    kinds: ["act", "scene"],
  },
  {
    id: "clues",
    label: "线索",
    icon: "KeyRound",
    kinds: ["clue", "task", "memory", "object"],
  },
  {
    id: "writing",
    label: "正文",
    icon: "Feather",
    kinds: ["document", "annotation"],
  },
  { id: "performance", label: "演绎", icon: "Theater", kinds: ["performance"] },
  {
    id: "review",
    label: "审校",
    icon: "ScanLine",
    kinds: ["issue", "playtest"],
  },
  { id: "delivery", label: "交付", icon: "PackageCheck", kinds: [] },
] as const;
export type ModuleId = (typeof modules)[number]["id"];
export const kinds = [
  "source",
  "asset",
  "concept",
  "rule",
  "event",
  "constraint",
  "character",
  "relationship",
  "act",
  "scene",
  "clue",
  "task",
  "memory",
  "object",
  "document",
  "performance",
  "issue",
  "playtest",
  "annotation",
] as const;
export type Kind = (typeof kinds)[number];
export type RichNode = {
  type: string;
  attrs?: Record<string, any>;
  text?: string;
  marks?: any[];
  content?: RichNode[];
};
export type Field = {
  key: string;
  label: string;
  type?: "number" | "select" | "long";
  options?: string[];
};
export const definitions: Record<Kind, { label: string; fields: Field[] }> = {
  annotation: {
    label: "段落批注",
    fields: [
      { key: "blockId", label: "段落位置" },
      { key: "quote", label: "引用原文", type: "long" },
      { key: "comment", label: "修改意见", type: "long" },
      {
        key: "resolution",
        label: "处理",
        type: "select",
        options: ["未处理", "已处理"],
      },
    ],
  },
  source: {
    label: "原始素材",
    fields: [
      { key: "origin", label: "出处" },
      {
        key: "purpose",
        label: "用途",
        type: "select",
        options: ["待整理", "事实依据", "文风参考", "历史讨论"],
      },
    ],
  },
  asset: {
    label: "附件",
    fields: [
      { key: "purpose", label: "使用场景" },
      { key: "owner", label: "保管人" },
    ],
  },
  concept: {
    label: "创意方向",
    fields: [
      { key: "conflict", label: "核心困境", type: "long" },
      { key: "experience", label: "玩家体验", type: "long" },
      { key: "genre", label: "题材" },
      { key: "players", label: "玩家人数", type: "number" },
      { key: "minutes", label: "预计时长（分钟）", type: "number" },
      { key: "tone", label: "情绪基调" },
      { key: "ending", label: "结局方向", type: "long" },
    ],
  },
  rule: {
    label: "世界规则",
    fields: [
      { key: "trigger", label: "触发条件" },
      { key: "effect", label: "作用", type: "long" },
      { key: "cost", label: "代价" },
      { key: "direction", label: "作用方向" },
      { key: "exception", label: "失效与例外" },
    ],
  },
  event: {
    label: "共同事件",
    fields: [
      { key: "time", label: "发生时间" },
      { key: "place", label: "地点" },
      { key: "actor", label: "真正行动者" },
      { key: "truth", label: "客观事实", type: "long" },
      { key: "result", label: "结果", type: "long" },
    ],
  },
  constraint: {
    label: "创作约束",
    fields: [
      { key: "rule", label: "要求", type: "long" },
      { key: "scope", label: "适用范围" },
      { key: "forbidden", label: "禁用词（以顿号分隔）" },
      { key: "origin", label: "确认依据" },
    ],
  },
  character: {
    label: "人物",
    fields: [
      { key: "role", label: "席位", type: "select", options: ["玩家", "NPC"] },
      { key: "desire", label: "独立愿望", type: "long" },
      { key: "identity", label: "表面身份" },
      { key: "era", label: "时间实例" },
      { key: "memory", label: "记忆来源" },
      { key: "secret", label: "隐藏事实", type: "long" },
      { key: "knowledge", label: "目前所知", type: "long" },
      { key: "involvement", label: "实际参与", type: "long" },
      { key: "arc", label: "人物变化", type: "long" },
    ],
  },
  relationship: {
    label: "人物关系",
    fields: [
      { key: "attraction", label: "最初吸引" },
      { key: "evidence", label: "相处证据", type: "long" },
      { key: "conflict", label: "分歧" },
      { key: "repair", label: "修复与选择", type: "long" },
    ],
  },
  act: {
    label: "幕",
    fields: [
      { key: "entry", label: "进入状态", type: "long" },
      { key: "goal", label: "本幕目标" },
      { key: "reveal", label: "允许揭露", type: "long" },
      { key: "hidden", label: "暂不揭露", type: "long" },
      { key: "exit", label: "结束状态", type: "long" },
      { key: "emotion", label: "情绪强度", type: "number" },
    ],
  },
  scene: {
    label: "场景",
    fields: [
      { key: "place", label: "地点" },
      { key: "time", label: "时间" },
      { key: "desire", label: "当下目标" },
      { key: "obstacle", label: "阻力" },
      { key: "turn", label: "转折", type: "long" },
      { key: "exit", label: "离开状态" },
      { key: "revealAt", label: "最早揭露幕序", type: "number" },
    ],
  },
  clue: {
    label: "线索",
    fields: [
      { key: "appearance", label: "玩家见到的内容", type: "long" },
      { key: "truth", label: "真实含义", type: "long" },
      { key: "belief", label: "可能误认", type: "long" },
      { key: "revealAt", label: "最早揭露幕序", type: "number" },
      { key: "acquire", label: "获取条件" },
      { key: "payoff", label: "回收位置" },
    ],
  },
  task: {
    label: "任务",
    fields: [
      { key: "goal", label: "表面目标" },
      { key: "truth", label: "真实作用", type: "long" },
      { key: "condition", label: "前提" },
      { key: "reward", label: "完成后获得" },
    ],
  },
  memory: {
    label: "记忆",
    fields: [
      { key: "trigger", label: "唤醒条件" },
      { key: "appearance", label: "回忆内容", type: "long" },
      { key: "truth", label: "对应事实", type: "long" },
      { key: "revealAt", label: "最早揭露幕序", type: "number" },
    ],
  },
  object: {
    label: "羁绊物",
    fields: [
      { key: "appearance", label: "识别细节" },
      { key: "origin", label: "赠送缘由" },
      { key: "owner", label: "当前持有人" },
      { key: "gesture", label: "共同动作" },
      { key: "payoff", label: "回收与意义变化", type: "long" },
    ],
  },
  document: {
    label: "角色正文",
    fields: [
      {
        key: "pov",
        label: "叙述人称",
        type: "select",
        options: ["第二人称", "第一人称", "第三人称"],
      },
      { key: "minChars", label: "最少字数", type: "number" },
      { key: "maxChars", label: "最多字数", type: "number" },
      { key: "startsWith", label: "固定开头" },
      { key: "authorNote", label: "作者备注", type: "long" },
    ],
  },
  performance: {
    label: "演绎场次",
    fields: [
      { key: "start", label: "开始分钟", type: "number" },
      { key: "duration", label: "时长（分钟）", type: "number" },
      { key: "performers", label: "NPC（以顿号分隔）" },
      { key: "place", label: "场地" },
      { key: "entry", label: "进场条件" },
      { key: "goal", label: "演绎目的" },
      { key: "cooperate", label: "配合时", type: "long" },
      { key: "silent", label: "沉默时", type: "long" },
      { key: "refuse", label: "拒绝时", type: "long" },
      { key: "unexpected", label: "意外提问", type: "long" },
      { key: "exit", label: "离场与信息交接" },
      { key: "props", label: "道具音效" },
    ],
  },
  issue: {
    label: "检查问题",
    fields: [
      {
        key: "severity",
        label: "程度",
        type: "select",
        options: ["阻断", "待审", "提示"],
      },
      { key: "evidence", label: "依据", type: "long" },
      { key: "suggestion", label: "处理建议", type: "long" },
      {
        key: "resolution",
        label: "处理",
        type: "select",
        options: ["未处理", "已修复", "有意保留"],
      },
      { key: "checkKey", label: "检查定位" },
    ],
  },
  playtest: {
    label: "试跑记录",
    fields: [
      { key: "version", label: "试跑版本" },
      { key: "date", label: "日期" },
      { key: "minutes", label: "实际时长", type: "number" },
      { key: "participants", label: "参与人数", type: "number" },
      { key: "friction", label: "卡点与误判", type: "long" },
      { key: "participation", label: "玩家参与", type: "long" },
      { key: "load", label: "NPC负荷", type: "long" },
    ],
  },
};
export const audiences = {
  player: "玩家",
  npc: "NPC",
  dm: "主持",
  author: "作者",
};
export type Entity = {
  id: string;
  kind: Kind;
  title: string;
  fields: Record<string, string | number>;
  body: RichNode;
  refs: string[];
  audience: keyof typeof audiences;
  status: "draft" | "review" | "ready";
  locked: boolean;
  order: number;
  stale?: boolean;
  fileId?: string;
};
export type Project = {
  id: string;
  title: string;
  description: string;
  revision: number;
  archived: boolean;
  updatedAt: string;
  data: {
    entities: Entity[];
    defaultModel?: string;
    moduleModels?: Record<string, string>;
  };
};
export const richSchema: z.ZodType<RichNode> = z.lazy(() =>
  z
    .object({
      type: z.string().max(60),
      attrs: z.record(z.string(), z.any()).optional(),
      text: z.string().optional(),
      marks: z.array(z.any()).optional(),
      content: z.array(richSchema).optional(),
    })
    .strict(),
);
const fieldsSchema = z.record(
  z.string().max(80),
  z.union([z.string().max(200000), z.number().finite()]),
);
export const entitySchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(kinds),
    title: z.string().min(1).max(300),
    fields: fieldsSchema,
    body: richSchema,
    refs: z.array(z.string()).max(300),
    audience: z.enum(["player", "npc", "dm", "author"]),
    status: z.enum(["draft", "review", "ready"]),
    locked: z.boolean(),
    order: z.number().finite(),
    stale: z.boolean().optional(),
    fileId: z.string().optional(),
  })
  .strict();
export const patchSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    fields: fieldsSchema.optional(),
    body: richSchema.optional(),
    refs: z.array(z.string()).optional(),
    audience: z.enum(["player", "npc", "dm", "author"]).optional(),
    status: z.enum(["draft", "review", "ready"]).optional(),
    order: z.number().finite().optional(),
    stale: z.boolean().optional(),
  })
  .strict();
export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_entity"), entity: entitySchema }).strict(),
  z
    .object({
      type: z.literal("update_entity"),
      entityId: z.string(),
      changes: patchSchema,
    })
    .strict(),
  z.object({ type: z.literal("delete_entity"), entityId: z.string() }).strict(),
  z
    .object({
      type: z.literal("replace_text"),
      documentId: z.string(),
      blockId: z.string(),
      expectedText: z.string().min(1),
      replacement: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("reorder"),
      entityIds: z.array(z.string()).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_lock"),
      entityId: z.string(),
      locked: z.boolean(),
    })
    .strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export type Scope = {
  module: string;
  entityIds?: string[];
  projectWide?: boolean;
  discussOnly?: boolean;
  selection?: { blockId: string; text: string };
};
export type Change = {
  id: string;
  projectId: string;
  baseRevision: number;
  operations: Operation[];
  status: "applied" | "pending" | "rejected" | "reverted";
  summary: string;
  reasons: string[];
  createdAt: string;
  source: string;
  conversationId?: string;
  before?: Project;
  after?: Project;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  changeId?: string;
  jobId?: string;
  createdAt: string;
};
export type Conversation = {
  id: string;
  projectId: string;
  module: string;
  entityId: string | null;
  title: string;
  messages: Message[];
};
export type ModelConnection = {
  id: string;
  name: string;
  protocol: "openai" | "compatible" | "anthropic" | "gemini";
  baseUrl: string;
  model: string;
  hasKey?: boolean;
  apiKey?: string;
  timeout: number;
  contextLimit: number;
  maxOutput: number;
  concurrency: number;
  inputPrice?: number;
  outputPrice?: number;
  structured: boolean;
  fallbackId?: string;
  managed?: "ark";
};
export const connectionSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    protocol: z.enum(["openai", "compatible", "anthropic", "gemini"]),
    baseUrl: z.url(),
    model: z.string().min(1),
    apiKey: z.string().optional(),
    timeout: z.number().min(5).max(600),
    contextLimit: z.number().min(1000),
    maxOutput: z.number().min(100).max(128000),
    concurrency: z.number().int().min(1).max(10),
    inputPrice: z.number().min(0).optional(),
    outputPrice: z.number().min(0).optional(),
    structured: z.boolean(),
    fallbackId: z.string().optional(),
    managed: z.literal("ark").optional(),
  })
  .strict();
export function moduleFor(kind: Kind) {
  return (
    modules.find((m) => (m.kinds as readonly string[]).includes(kind))?.id ||
    "world"
  );
}
export function plain(node: RichNode): string {
  if (node.text !== undefined) return node.text;
  return (node.content || [])
    .map(plain)
    .join(
      [
        "doc",
        "bulletList",
        "orderedList",
        "table",
        "tableRow",
        "blockquote",
      ].includes(node.type)
        ? "\n"
        : "",
    );
}
export function doc(text = ""): RichNode {
  return {
    type: "doc",
    content: text.split("\n").map((t) => ({
      type: "paragraph",
      attrs: { id: crypto.randomUUID() },
      content: t ? [{ type: "text", text: t }] : [],
    })),
  };
}
export function newEntity(kind: Kind, title = definitions[kind].label): Entity {
  return {
    id: crypto.randomUUID(),
    kind,
    title,
    fields: {},
    body: doc(),
    refs: [],
    audience: kind === "document" ? "player" : "author",
    status: "draft",
    locked: false,
    order: Date.now(),
  };
}
export function charCount(body: RichNode) {
  return plain(body).replace(/\s/g, "").length;
}
export function labelStatus(s: string) {
  return (
    (
      {
        draft: "草稿",
        review: "待审",
        ready: "定稿",
        queued: "排队中",
        running: "进行中",
        paused: "已暂停",
        completed: "已完成",
        failed: "失败",
        cancelled: "已停止",
        pending: "待处理",
        applied: "已应用",
        reverted: "已撤销",
        rejected: "已放弃",
      } as Record<string, string>
    )[s] || "待处理"
  );
}
