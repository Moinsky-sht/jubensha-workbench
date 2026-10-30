import { coverage,acts,ownership } from "../shared/story.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  doc,
  definitions,
  plain,
  moduleFor,
  newEntity,
  operationSchema,
  type Kind,
  type Operation,
  type Project,
} from "../shared/domain.js";
import { AppError } from "./projects.js";

export type ProductionMode = "outline" | "draft";
export type CreativeTool = {
  id: string;
  module: string;
  label: string;
  purpose: string;
  phase: number;
  dependsOn: string[];
  outputKinds: Kind[];
  handler: "brief" | "model" | "review" | "delivery";
  modes: ProductionMode[];
  instruction: string;
};
export type ToolWorkItem = {
  key: string;
  toolId: string;
  module: string;
  label: string;
  targetIds?: string[];
};

export const creativeTools: CreativeTool[] = [
  {
    id: "sources.intake",
    module: "sources",
    label: "整理创作简报",
    purpose: "保存用户原始意图与可追溯约束，不让后续模块依赖聊天记忆。",
    phase: 0,
    dependsOn: [],
    outputKinds: ["source"],
    handler: "brief",
    modes: ["outline", "draft"],
    instruction: "",
  },
  {
    id: "concept.position",
    module: "concept",
    label: "确定立意与体验",
    purpose: "把主题转成核心困境、玩家处境、情绪承诺与生产边界。",
    phase: 1,
    dependsOn: ["sources.intake"],
    outputKinds: ["concept"],
    handler: "model",
    modes: ["outline", "draft"],
    instruction:
      "创建一个创意方向。明确核心困境、玩家体验、题材、人数、时长、情绪基调与结局方向。信息不足时作保守且可修订的假设，不能只列候选。",
  },
  {
    id: "world.foundation",
    module: "world",
    label: "建立世界与事实",
    purpose: "固定规则、共同事件和创作约束，为人物与结构提供同一事实底座。",
    phase: 2,
    dependsOn: ["concept.position"],
    outputKinds: ["rule", "event", "constraint"],
    handler: "model",
    modes: ["outline", "draft"],
    instruction:
      "建立足以支撑故事的世界规则、关键历史事件和创作约束。规则必须写明触发、效果、代价与例外；事件区分真正行动者、客观事实和结果。不要把角色误认写成客观事实。",
  },
  {
    id: "characters.cast",
    module: "characters",
    label: "组建人物与关系",
    purpose: "按玩家人数建立角色实例、独立愿望、秘密、知情边界与关系证据。",
    phase: 2,
    dependsOn: ["concept.position"],
    outputKinds: ["character", "relationship"],
    handler: "model",
    modes: ["outline", "draft"],
    instruction:
      "按立意中的玩家人数创建完整玩家阵容，并只添加确有演绎作用的NPC。每人拥有非附属于恋爱的愿望、秘密、当前所知、实际参与和人物变化；关系用具体相处证据建立，引用真实人物ID。",
  },
  {
    id: "structure.storyboard",
    module: "structure",
    label: "编排幕与场景",
    purpose: "把事实与人物变化组织成可写、可演、可检验的顺序。",
    phase: 3,
    dependsOn: ["world.foundation", "characters.cast"],
    outputKinds: ["act", "scene"],
    handler: "model",
    modes: ["outline", "draft"],
    instruction:
      "根据时长建立完整分幕与关键场景。每幕写进入状态、目标、允许揭露、暂不揭露、结束状态和情绪强度；每场必须改变信息、关系或行动，并引用所属幕和参与人物。幕与场景使用稳定order。",
  },
  {
    id: "clues.flow",
    module: "clues",
    label: "配置线索流转",
    purpose: "安排线索、记忆、任务与羁绊物的获得、误认、揭露和回收。",
    phase: 4,
    dependsOn: ["structure.storyboard"],
    outputKinds: ["clue", "task", "memory", "object"],
    handler: "model",
    modes: ["outline", "draft"],
    instruction:
      "为关键转折建立最少但完整的信息与物件链。每项写获取条件、玩家表象、真实含义、可能误认、最早揭露位置和回收位置；任务必须有玩家可执行路径。引用对应场景、人物或事件。",
  },
  {
    id: "writing.role-draft",
    module: "writing",
    label: "并行撰写角色本",
    purpose: "以每个玩家角色为独立工作项生成覆盖全幕的第一版正文。",
    phase: 5,
    dependsOn: ["clues.flow"],
    outputKinds: ["document"],
    handler: "model",
    modes: ["draft"],
    instruction:
      "只为指定玩家角色和指定幕创建一份连续可读的正文，不创建其他幕。正文至少1200字，不是提纲，fields.minChars设为1200；用第二人称写行动、感受、关系证据与当时可知信息，保留合理误解，不泄露主持真相。引用该角色及实际使用的幕、场景、线索ID。",
  },
  {
    id: "performance.act-flow",
    module: "performance",
    label: "并行设计演绎",
    purpose: "以每幕为独立工作项补齐主持条件、NPC回应、资源与离场结果。",
    phase: 5,
    dependsOn: ["clues.flow"],
    outputKinds: ["performance"],
    handler: "model",
    modes: ["outline", "draft"],
    instruction:
      "只为指定幕创建必要的演绎场次。每场写开始时间、时长、NPC、场地、进场条件、目的、玩家配合/沉默/拒绝/意外提问时的回应、离场信息和道具音效，并引用对应幕与场景。",
  },
  {
    id: "review.continuity",
    module: "review",
    label: "检查因果与信息边界",
    purpose: "结合机械检查与语义审读，留下可定位、可修复的问题。",
    phase: 6,
    dependsOn: ["structure.storyboard", "clues.flow"],
    outputKinds: ["issue"],
    handler: "review",
    modes: ["outline", "draft"],
    instruction:
      "审读当前项目，只创建有证据的问题。检查事实冲突、角色无来源知情、提前剧透、因果断裂、边缘角色、无回收线索、无执行路径任务与演绎资源冲突。每项标明程度、依据、建议、未处理状态、稳定检查定位，并引用相关对象。不要直接改写正文。",
  },
  {
    id: "delivery.readiness",
    module: "delivery",
    label: "核对交付条件",
    purpose: "汇总草稿、待审问题与受众边界，明确下一次最短行动。",
    phase: 7,
    dependsOn: ["review.continuity"],
    outputKinds: [],
    handler: "delivery",
    modes: ["outline", "draft"],
    instruction: "",
  },
];

export function publicToolCatalog() {
  return creativeTools.map(
    ({ instruction, handler, outputKinds, modes, ...tool }) => ({
      ...tool,
      outputKinds,
      modes,
      automatic: true,
      parallelGroup: tool.phase,
    }),
  );
}

export function toolsForMode(mode: ProductionMode) {
  return creativeTools.filter((tool) => tool.modes.includes(mode));
}

export function planForMode(mode: ProductionMode) {
  return [...new Set(toolsForMode(mode).map((tool) => tool.phase))].map(
    (phase) => ({
      phase,
      parallel: toolsForMode(mode)
        .filter((tool) => tool.phase === phase)
        .map((tool) => tool.id),
    }),
  );
}

export function workItems(tool: CreativeTool, project: Project): ToolWorkItem[] {
  if (tool.id === "writing.role-draft") {
    const players = project.data.entities.filter(
      (e) => e.kind === "character" && e.fields.role !== "NPC",
    );
    return players.slice(0,12).flatMap(character=>acts(project).map(act=>({
      key: `${tool.id}:${character.id}:${act.id}`,
      toolId:tool.id,module:tool.module,label:`撰写 · ${character.title} · ${act.title}`,
      targetIds:[character.id,act.id],
    })));
  }

  if (tool.id === "performance.act-flow") {
    const acts = project.data.entities
      .filter((e) => e.kind === "act")
      .sort((a, b) => a.order - b.order);
    return acts.slice(0, 12).map((act) => ({
      key: `${tool.id}:${act.id}`,
      toolId: tool.id,
      module: tool.module,
      label: `演绎 · ${act.title}`,
      targetIds: [act.id],
    }));
  }
  return [
    {
      key: tool.id,
      toolId: tool.id,
      module: tool.module,
      label: tool.label,
    },
  ];
}

export function canReuseWorkItem(
  tool: CreativeTool,
  item: ToolWorkItem,
  project: Project,
) {
  const entities = project.data.entities;
  if (tool.id === "sources.intake")
    return entities.some(
      (entity) =>
        entity.kind === "source" && entity.fields.origin === "新建项目",
    );
  if (tool.id === "concept.position")
    return entities.some((entity) => entity.kind === "concept");
  if (tool.id === "world.foundation")
    return entities.some((entity) =>
      (["rule", "event", "constraint"] as Kind[]).includes(entity.kind),
    );
  if (tool.id === "characters.cast")
    return entities.some(
      (entity) => entity.kind === "character" && entity.fields.role !== "NPC",
    );
  if (tool.id === "structure.storyboard")
    return (
      entities.some((entity) => entity.kind === "act") &&
      entities.some((entity) => entity.kind === "scene")
    );
  if (tool.id === "clues.flow")
    return entities.some((entity) =>
      (["clue", "task", "memory", "object"] as Kind[]).includes(entity.kind),
    );
  if (tool.id === "writing.role-draft")
    return entities.some(e=>e.kind==="document" && item.targetIds?.every(id=>e.refs.includes(id)) && ownership(project,e).characters.length===1 && ownership(project,e).acts.length===1 && plain(e.body).trim().length>0);
  if (tool.id === "performance.act-flow")
    return entities.some(
      (entity) =>
        entity.kind === "performance" &&
        !!item.targetIds?.some((id) => entity.refs.includes(id)),
    );
  return false;
}

export function makeBriefSource(brief: string) {
  const source = newEntity("source", "项目创作简报");
  source.fields = { origin: "新建项目", purpose: "事实依据" };
  source.body = doc(brief.trim());
  source.audience = "author";
  source.locked = true;
  return source;
}

export function toolRequest(
  tool: CreativeTool,
  item: ToolWorkItem,
  project: Project,
  brief: string,
  context: string,
) {
  const targets = (item.targetIds || [])
    .map((id) => project.data.entities.find((e) => e.id === id))
    .filter(Boolean);
  return JSON.stringify({
    task: tool.instruction,
    brief,
    tool: { id: tool.id, module: tool.module, outputKinds: tool.outputKinds },
    target: targets,
    currentProject: context,
  });
}

export function toolSystem(tool: CreativeTool, guideline: string) {
  return `${guideline}\n\n你正在调用已注册的创作工具“${tool.label}”（${tool.id}）。${tool.purpose}\n本次只能创建或更新这些类型：${tool.outputKinds.join("、")}。actions、reads、guidelineDraft必须为空。${tool.outputKinds.length ? "必须在operations中返回至少一项本工具范围内的有效成果；信息不足时采用简报允许的最小可修订假设，不能返回空数组。" : ""}所有内容进入draft且不得锁定。body使用合法Tiptap结构：{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"正文\"}]}]}。返回前自行核对字段、引用ID、客观事实/角色认知/玩家可读三层边界。`;
}

export function validateToolOperations(
  tool: CreativeTool,
  item: ToolWorkItem,
  project: Project,
  input: unknown,
) {
  const cleanBody = (value: any): any => {
    if (!value || typeof value !== "object") return value;
    const node: any = { type: value.type };
    if (value.attrs && typeof value.attrs === "object") node.attrs = value.attrs;
    if (typeof value.text === "string") node.text = value.text;
    if (Array.isArray(value.marks)) node.marks = value.marks;
    if (Array.isArray(value.content))
      node.content = value.content.map(cleanBody);
    return node;
  };
  const normalized = Array.isArray(input)
    ? input.map((candidate: any) => {
        if (!candidate || typeof candidate !== "object") return candidate;
        if (candidate.type === "create_entity" && candidate.entity?.body)
          return {
            ...candidate,
            entity: {
              ...candidate.entity,
              body: cleanBody(candidate.entity.body),
            },
          };
        if (candidate.type === "update_entity" && candidate.changes?.body)
          return {
            ...candidate,
            changes: {
              ...candidate.changes,
              body: cleanBody(candidate.changes.body),
            },
          };
        return candidate;
      })
    : input;
  const parsed = z.array(operationSchema).max(120).safeParse(normalized);
  if (!parsed.success) {
    const issue = parsed.error.issues[0],
      place = issue.path.length ? `（${issue.path.join(".")}）` : "";
    throw new AppError(
      `“${tool.label}”返回格式不合格${place}：${issue.message}`,
    );
  }
  const operations = parsed.data;
  const allowed = new Set(tool.outputKinds);
  const accepted: Operation[] = [];
  for (const op of operations) {
    if (op.type === "delete_entity" || op.type === "set_lock")
      throw new AppError(`“${tool.label}”不能删除或解锁内容`);
    if (op.type === "create_entity") {
      if (!allowed.has(op.entity.kind))
        continue;
      if (op.entity.status !== "draft" || op.entity.locked || op.entity.fileId)
        throw new AppError("智能体生成内容只能进入未锁定草稿");
      const fieldKeys = new Set(
        definitions[op.entity.kind].fields.map((field) => field.key),
      );
      op.entity.fields = Object.fromEntries(
        Object.entries(op.entity.fields).filter(([key]) => fieldKeys.has(key)),
      );
      op.entity.body = doc(plain(op.entity.body));
      if (
        item.targetIds?.length &&
        !item.targetIds.some((id) => op.entity.refs.includes(id))
      )
        throw new AppError(`“${item.label}”没有关联目标对象`);
      accepted.push(op);
    } else if (op.type === "update_entity") {
      const target = project.data.entities.find((e) => e.id === op.entityId);
      if (!target || !allowed.has(target.kind))
        continue;
      if (op.changes.status === "ready")
        throw new AppError("智能体不能自行定稿");
      if (op.changes.fields) {
        const fieldKeys = new Set(
          definitions[target.kind].fields.map((field) => field.key),
        );
        op.changes.fields = Object.fromEntries(
          Object.entries(op.changes.fields).filter(([key]) =>
            fieldKeys.has(key),
          ),
        );
      }
      accepted.push(op);
    } else if (op.type === "replace_text") {
      if (!allowed.has("document"))
        continue;
      accepted.push(op);
    } else if (op.type === "reorder") {
      if (
        op.entityIds.some((id) => {
          const target = project.data.entities.find((e) => e.id === id);
          return !target || !allowed.has(target.kind);
        })
      )
        continue;
      accepted.push(op);
    }
  }
  if (tool.outputKinds.length && !accepted.length)
    throw new AppError(`“${tool.label}”没有返回工具范围内的可用内容`);
  if(tool.id==="review.continuity")for(const op of accepted){
    if(op.type==="create_entity" && op.entity.kind==="issue")op.entity.fields.severity="待审";
    if(op.type==="update_entity")op.changes.fields={...op.changes.fields,severity:"待审"};
  }
  if(tool.id==="writing.role-draft"){
    const knownPlayers=project.data.entities.filter(e=>e.kind==="character"&&e.fields.role!=="NPC").map(e=>e.id);
    const knownActs=acts(project).map(e=>e.id);
    for(const op of accepted){
      const target=op.type==="create_entity"?op.entity:op.type==="update_entity"?{...project.data.entities.find(e=>e.id===op.entityId)!,...op.changes}:undefined;
      if(!target || target.kind!=="document")throw new AppError("角色幕正文须返回完整目标正文");
      if(!item.targetIds?.every(id=>target.refs.includes(id)) || target.refs.filter(id=>knownPlayers.includes(id)).length!==1 || target.refs.filter(id=>knownActs.includes(id)).length!==1)throw new AppError("正文必须仅关联本角色与本幕");
      if(plain(target.body).replace(/\s/g,"").length<Math.max(1200,Number(target.fields.minChars)||1200))throw new AppError("正文篇幅不足，尚不能作为该角色本幕成果");
    }
  }
  return accepted;
}

export function sanitizeGeneratedRefs(
  project: Project,
  operations: Operation[],
) {
  const existingIds = new Set(project.data.entities.map((entity) => entity.id));
  const generatedIds = new Set<string>();
  const normalized = operations.map((operation) => {
    if (operation.type !== "create_entity") return operation;
    const suppliedId = operation.entity.id;
    const entityId =
      existingIds.has(suppliedId) || generatedIds.has(suppliedId)
        ? randomUUID()
        : suppliedId;
    generatedIds.add(entityId);
    return {
      ...operation,
      entity: { ...operation.entity, id: entityId },
    } as Operation;
  });
  const validIds = new Set([...existingIds, ...generatedIds]);
  return normalized.map((operation) => {
    if (operation.type === "create_entity")
      return {
        ...operation,
        entity: {
          ...operation.entity,
          refs: operation.entity.refs.filter((ref) => validIds.has(ref)),
        },
      } as Operation;
    if (operation.type === "update_entity" && operation.changes.refs)
      return {
        ...operation,
        changes: {
          ...operation.changes,
          refs: operation.changes.refs.filter((ref) => validIds.has(ref)),
        },
      } as Operation;
    return operation;
  });
}

export function moduleSummary(project: Project) {
  return Object.fromEntries(
    [
      "sources",
      "concept",
      "world",
      "characters",
      "structure",
      "clues",
      "writing",
      "performance",
      "review",
      "delivery",
    ].map((module) => [
      module,
      project.data.entities.filter((e) => moduleFor(e.kind) === module).length,
    ]),
  );
}
