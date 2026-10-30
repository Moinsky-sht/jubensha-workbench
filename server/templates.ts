import { getSetting, setSetting, id } from "./db.js";
import { getProject, createProject, AppError } from "./projects.js";
import type { Entity } from "../shared/domain.js";
type Template = {
  id: string;
  title: string;
  sourceProject: string;
  sourceRevision: number;
  entities: Entity[];
};
export const templates = () => getSetting<Template[]>("templates", []);
export function saveTemplate(
  projectId: string,
  title: string,
  entityIds: string[],
) {
  const p = getProject(projectId);
  const chosen = p.data.entities.filter((e) => entityIds.includes(e.id));
  if (chosen.length !== new Set(entityIds).size || !chosen.length)
    throw new AppError("请选择有效对象");
  if (chosen.some((e) => e.fileId || e.kind === "source" || e.kind === "issue"))
    throw new AppError("原稿、附件和问题记录不能作为创作模板");
  const template: Template = {
    id: id(),
    title,
    sourceProject: p.title,
    sourceRevision: p.revision,
    entities: chosen,
  };
  setSetting("templates", [...templates(), template]);
  return template;
}
export function fromTemplate(
  templateId: string,
  title: string,
  description = "",
) {
  const t = templates().find((t) => t.id === templateId);
  if (!t) throw new AppError("模板不存在");
  const ids = new Map(t.entities.map((e) => [e.id, id()]));
  const entities = t.entities.map((e) => ({
    ...structuredClone(e),
    id: ids.get(e.id)!,
    refs: e.refs.filter((r) => ids.has(r)).map((r) => ids.get(r)!),
    status: "draft" as const,
    locked: false,
    stale: false,
  }));
  return createProject(title, description, entities);
}
