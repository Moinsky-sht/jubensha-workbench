import { createHash } from "node:crypto";
import { db, now, getSetting, setSetting } from "./db.js";
import {
  saveConnection,
  listConnections,
  getConnection,
  callModel,
  parseReply,
  systemPrompt,
} from "./models.js";
import { AppError } from "./projects.js";
import type { ModelConnection } from "../shared/domain.js";
export type CatalogModel = {
  id: string;
  name: string;
  domain: string;
  status?: string;
  task_type?: string[];
  modalities?: { output_modalities?: string[] };
  token_limits?: { context_window?: number; max_output_token_length?: number };
  features?: {
    structured_outputs?: { json_object?: boolean; json_schema?: boolean };
  };
};
export const priorities = [
  "doubao-seed-2-1-turbo-260628",
  "glm-5-3-flash-260828",
  "deepseek-v4-flash-ga-260731",
];
export const arkId = (model: string) =>
  "ark-" + createHash("sha256").update(model).digest("hex").slice(0, 20);
export function textModels(rows: CatalogModel[]) {
  return rows
    .filter(
      (m) =>
        m.status !== "Shutdown" &&
        (m.task_type?.includes("TextGeneration") ||
          (["LLM", "VLM"].includes(m.domain) &&
            m.modalities?.output_modalities?.includes("text"))),
    )
    .sort((a, b) => {
      const rank = (m: CatalogModel) =>
        priorities.includes(m.id)
          ? priorities.indexOf(m.id)
          : m.status === "Retiring"
            ? 100
            : 10;
      return rank(a) - rank(b) || a.id.localeCompare(b.id);
    });
}
export function providerStatus() {
  return {
    configured: !!process.env.ARK_API_KEY,
    lastSync: getSetting("arkLastSync", null),
    error: getSetting("arkSyncError", ""),
    autoSwitch: getSetting("arkAutoSwitch", true),
    models: getSetting<any[]>("arkCatalog", []).map((m) => ({
      ...m,
      health: db
        .prepare(
          "SELECT status,checked_at,error,duration FROM model_health WHERE connection_id=?",
        )
        .get(arkId(m.id)) || { status: "untested" },
    })),
  };
}
export async function syncArk() {
  if (!process.env.ARK_API_KEY) throw new AppError("服务端尚未预置火山密钥");
  const base = (
    process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3"
  )
    .replace(/\/chat\/completions\/?$/, "")
    .replace(/\/$/, "");
  const res = await fetch(base + "/models", {
    headers: { Authorization: "Bearer " + process.env.ARK_API_KEY },
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!res.ok) throw new AppError("火山模型目录暂不可用（" + res.status + "）");
  const raw = (await res.json()) as any;
  const catalog = textModels(raw.data || []);
  if (!catalog.length) throw new AppError("目录没有返回文本模型");
  for (const m of catalog) {
    const existing = listConnections().find((c) => c.id === arkId(m.id));
    saveConnection({
      id: arkId(m.id),
      name: displayModel(m.id),
      protocol: "compatible",
      baseUrl: base,
      model: m.id,
      apiKey: process.env.ARK_API_KEY,
      timeout: existing?.timeout || 180,
      contextLimit: m.token_limits?.context_window || 131072,
      maxOutput: Math.min(
        16000,
        m.token_limits?.max_output_token_length || 8000,
      ),
      concurrency: 2,
      structured: m.features?.structured_outputs?.json_object === true,
      managed: "ark",
      ...(existing?.inputPrice !== undefined
        ? { inputPrice: existing.inputPrice, outputPrice: existing.outputPrice }
        : {}),
    });
  }
  setSetting("arkCatalog", catalog);
  setSetting("arkLastSync", now());
  setSetting("arkSyncError", "");
  if (!getSetting("defaultModel", ""))
    setSetting(
      "defaultModel",
      arkId(
        catalog.find((m) => m.id === process.env.ARK_DEFAULT_MODEL)?.id ||
          catalog[0].id,
      ),
    );
  return providerStatus();
}
export function displayModel(id: string) {
  return id
    .replace("doubao-seed-", "Seed ")
    .replace("deepseek-", "DeepSeek ")
    .replace("glm-", "GLM ")
    .replace(/-ga-\d+$/, "")
    .replace(/-\d{6}$/, "")
    .replace(/(\d)-(\d)/g, "$1.$2")
    .replace(/-/g, " ")
    .replace(/\bflash\b/g, "Flash")
    .replace(/\bturbo\b/g, "Turbo")
    .replace(/\bpro\b/g, "Pro");
}
export function recordModelHealth(
  cid: string,
  success: boolean,
  error = "",
  duration = 0,
) {
  db.prepare(
    "INSERT INTO model_health VALUES(?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,error=excluded.error,duration=excluded.duration",
  ).run(
    cid,
    success ? "healthy" : "unavailable",
    now(),
    error.slice(0, 200),
    duration,
  );
}
export async function probeModel(cid: string) {
  const c = getConnection(cid),
    start = Date.now();
  try {
    const input = {
      system: systemPrompt(""),
      messages: [
        {
          role: "user" as const,
          content:
            '这是连通性验证。请直接回复以下JSON，不要增加字段或调用任何工具：{"message":"连接成功","operations":[],"actions":[],"reads":[],"guidelineDraft":""}',
        },
      ],
    };
    let raw = await callModel({ ...c, maxOutput: 2048, timeout: 90 }, input);
    try {
      parseReply(raw);
    } catch {
      raw = await callModel(
        { ...c, maxOutput: 2048, timeout: 90 },
        {
          ...input,
          messages: [
            ...input.messages,
            { role: "assistant", content: raw },
            {
              role: "user",
              content:
                "请修复返回格式。仅允许message、operations、actions、reads、guidelineDraft五个字段。",
            },
          ],
        },
      );
      parseReply(raw);
    }
    recordModelHealth(cid, true, "", Date.now() - start);
    return { id: cid, ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "连接失败";
    recordModelHealth(cid, false, error, Date.now() - start);
    return { id: cid, ok: false, error };
  }
}
export function modelFallbacks(c: ModelConnection): ModelConnection[] {
  if (c.managed !== "ark" || !getSetting("arkAutoSwitch", true))
    return c.fallbackId ? [getConnection(c.fallbackId)] : [];
  const catalog = getSetting<CatalogModel[]>("arkCatalog", []);
  return catalog
    .filter((m) => m.status !== "Retiring")
    .map((m) => listConnections().find((x) => x.id === arkId(m.id)))
    .filter((m): m is ModelConnection => !!m && m.id !== c.id)
    .filter((m) => {
      const h = db
        .prepare(
          "SELECT status,checked_at FROM model_health WHERE connection_id=?",
        )
        .get(m.id) as any;
      return (
        !h ||
        h.status === "healthy" ||
        Date.now() - Date.parse(h.checked_at) > 3600000
      );
    })
    .sort((a, b) => {
      const score = (m: ModelConnection) =>
        priorities.includes(m.model) ? priorities.indexOf(m.model) : 20;
      return score(a) - score(b);
    });
}
export async function initializeProviders() {
  if (!process.env.ARK_API_KEY) return;
  try {
    await syncArk();
  } catch (e) {
    setSetting("arkSyncError", e instanceof Error ? e.message : "目录同步失败");
  }
}
