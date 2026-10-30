import { createHash } from "node:crypto";
import { db, id, now, transaction } from "./db.js";
import { getProject, AppError } from "./projects.js";
import { plain, type Project, type RichNode } from "../shared/domain.js";
type Chunk = {
  id: string;
  project_id: string;
  entity_id: string;
  kind: string;
  block_id: string | null;
  title: string;
  content: string;
  content_hash: string;
};
export type RetrievalHit = {
  entityId: string;
  blockId: string | null;
  title: string;
  text: string;
  source: "entity" | "conversation";
  score: number;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const config = () => ({
  base:
    process.env.SILICON_EMBEDDING_BASE_URL || "https://api.siliconflow.cn/v1",
  key: process.env.SILICON_EMBEDDING_API_KEY,
  model: process.env.SILICON_EMBEDDING_MODEL || "Qwen/Qwen3-Embedding-8B",
  dimensions: Number(process.env.SILICON_EMBEDDING_DIMENSIONS || 1024),
  rerankBase:
    process.env.SILICON_RERANK_BASE_URL || "https://api.siliconflow.cn/v1",
  rerankKey: process.env.SILICON_RERANK_API_KEY,
  rerankModel: process.env.SILICON_RERANK_MODEL || "Qwen/Qwen3-Reranker-8B",
});
export function retrievalStatus(pid: string) {
  const state = db
    .prepare("SELECT * FROM retrieval_state WHERE project_id=?")
    .get(pid) as any;
  const count = db
    .prepare(
      'SELECT COUNT(*) total,SUM(embedding IS NOT NULL) "indexed" FROM retrieval_chunks WHERE project_id=?',
    )
    .get(pid) as any;
  return {
    configured: !!config().key,
    model: config().model,
    dimensions: config().dimensions,
    ...count,
    state: state || null,
  };
}
export function chunksFor(p: Project): Chunk[] {
  const rows: Chunk[] = [];
  const add = (
    eid: string,
    kind: string,
    title: string,
    text: string,
    anchor: string | null,
    section: string,
  ) => {
    for (let at = 0; at < text.length; at += 1400) {
      const content = text.slice(at, at + 1600).trim();
      if (!content) continue;
      rows.push({
        id: hash(p.id + ":" + eid + ":" + section + ":" + at),
        project_id: p.id,
        entity_id: eid,
        kind,
        block_id: anchor,
        title,
        content,
        content_hash: hash(title + "\n" + content),
      });
    }
  };
  for (const e of p.data.entities.filter(
    (e) => !["asset", "issue"].includes(e.kind),
  )) {
    add(
      e.id,
      e.kind,
      e.title,
      Object.entries(e.fields)
        .map(([k, v]) => k + "：" + v)
        .join("\n"),
      null,
      "fields",
    );
    let ordinal = 0;
    const walk = (n: RichNode) => {
      if (n.type === "paragraph" || n.type === "heading") {
        add(
          e.id,
          e.kind,
          e.title,
          plain(n),
          n.attrs?.id || null,
          "block:" + (n.attrs?.id || ordinal++),
        );
        return;
      }
      for (const child of n.content || []) walk(child);
    };
    walk(e.body);
  }
  const messages = db
    .prepare(
      "SELECT m.id,m.content,m.role,c.title FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.project_id=? ORDER BY m.created_at DESC LIMIT 200",
    )
    .all(p.id) as any[];
  for (const m of messages)
    add(
      m.id,
      "conversation",
      "历史讨论 · " + m.title,
      "未确认为设定的讨论：" + m.content,
      null,
      "message",
    );
  return rows;
}
function fingerprint(p: Project) {
  const m = db
    .prepare(
      "SELECT COUNT(*) n,MAX(m.rowid) last FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.project_id=?",
    )
    .get(p.id) as any;
  return `${p.revision}:${m.n}:${m.last || 0}:${config().model}:${config().dimensions}`;
}
async function request(
  kind: "embedding" | "rerank",
  pid: string,
  payload: any,
  signal?: AbortSignal,
) {
  const c = config(),
    base = kind === "embedding" ? c.base : c.rerankBase,
    key = kind === "embedding" ? c.key : c.rerankKey;
  if (!key) throw new AppError("检索接口尚未配置");
  const u = new URL(base);
  if (
    u.protocol !== "https:" &&
    !["127.0.0.1", "localhost"].includes(u.hostname)
  )
    throw new AppError("检索服务地址需要 HTTPS");
  const start = Date.now();
  const r = await fetch(
    base.replace(/\/$/, "") +
      (kind === "embedding" ? "/embeddings" : "/rerank"),
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([
        AbortSignal.timeout(60000),
        ...(signal ? [signal] : []),
      ]),
      redirect: "error",
    },
  );
  if (!r.ok) {
    await r.text();
    throw new AppError("语义检索服务暂不可用（" + r.status + "）");
  }
  const data = (await r.json()) as any;
  db.prepare("INSERT INTO retrieval_usage VALUES(?,?,?,?,?,?,?)").run(
    id(),
    pid,
    kind,
    payload.model,
    data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? null,
    Date.now() - start,
    now(),
  );
  return data;
}
async function embeddings(pid: string, texts: string[], signal?: AbortSignal) {
  const c = config(),
    r = await request(
      "embedding",
      pid,
      {
        model: c.model,
        input: texts,
        encoding_format: "float",
        dimensions: c.dimensions,
      },
      signal,
    );
  if (!Array.isArray(r.data) || r.data.length !== texts.length)
    throw new AppError("向量返回数量不匹配");
  return r.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((d: any) => {
      if (
        !Array.isArray(d.embedding) ||
        d.embedding.length !== c.dimensions ||
        !d.embedding.every(Number.isFinite)
      )
        throw new AppError("向量维度不匹配");
      return new Uint8Array(new Float32Array(d.embedding).buffer);
    }) as Uint8Array[];
}
export async function indexProject(pid: string, signal?: AbortSignal) {
  const p = getProject(pid),
    c = config();
  if (!c.key) return retrievalStatus(pid);
  const mark = fingerprint(p);
  const chunks = chunksFor(p);

  db.prepare(
    "INSERT INTO retrieval_state(project_id,revision,status,error,updated_at,fingerprint) VALUES(?,?,'indexing','',?,?) ON CONFLICT(project_id) DO UPDATE SET status='indexing',error='',updated_at=excluded.updated_at",
  ).run(pid, p.revision, now(), mark);
  try {
    if (chunks.length > 20000)
      throw new AppError("项目超过当前索引容量，请拆分素材");
    const existing = new Map(
      (
        db
          .prepare(
            "SELECT id,content_hash,model,dimensions,embedding IS NOT NULL ready FROM retrieval_chunks WHERE project_id=?",
          )
          .all(pid) as any[]
      ).map((r) => [r.id, r]),
    );
    const changed = chunks.filter((r) => {
      const old = existing.get(r.id);
      return (
        !old ||
        !old.ready ||
        old.content_hash !== r.content_hash ||
        old.model !== c.model ||
        old.dimensions !== c.dimensions
      );
    });
    const selected = changed.slice(0, 128);
    for (let at = 0; at < selected.length; at += 16) {
      const batch = selected.slice(at, at + 16);
      const vectors = await embeddings(
        pid,
        batch.map((x) => x.title + "\n" + x.content),
        signal,
      );
      if (fingerprint(getProject(pid)) !== mark)
        throw new AppError("内容已更新，将按新版本继续索引");
      transaction(() => {
        batch.forEach((r, i) =>
          db
            .prepare(
              "INSERT INTO retrieval_chunks VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,content_hash=excluded.content_hash,model=excluded.model,dimensions=excluded.dimensions,embedding=excluded.embedding,updated_at=excluded.updated_at",
            )
            .run(
              r.id,
              pid,
              r.entity_id,
              r.kind,
              r.block_id,
              r.title,
              r.content,
              r.content_hash,
              c.model,
              c.dimensions,
              vectors[i],
              now(),
            ),
        );
      });
    }
    if (fingerprint(getProject(pid)) !== mark)
      throw new AppError("内容已更新，将按新版本继续索引");
    transaction(() => {
      const live = new Set(chunks.map((c) => c.id));
      for (const eid of existing.keys())
        if (!live.has(eid))
          db.prepare(
            "DELETE FROM retrieval_chunks WHERE project_id=? AND id=?",
          ).run(pid, eid);
      db.prepare(
        "UPDATE retrieval_state SET revision=?,status=?,error=?,updated_at=?,fingerprint=? WHERE project_id=?",
      ).run(
        p.revision,
        changed.length > 128 ? "pending" : "ready",
        "",
        now(),
        mark,
        pid,
      );
    });
    return retrievalStatus(pid);
  } catch (e) {
    db.prepare(
      "UPDATE retrieval_state SET status='pending',error=?,updated_at=? WHERE project_id=?",
    ).run(e instanceof Error ? e.message : "索引未完成", now(), pid);
    throw e;
  }
}
function terms(s: string) {
  const clean = s.toLowerCase().replace(/\s/g, "");
  return new Set(
    [...clean.matchAll(/[a-z0-9_]+/g)]
      .map((x) => x[0])
      .concat(
        Array.from({ length: Math.max(0, clean.length - 1) }, (_, i) =>
          clean.slice(i, i + 2),
        ),
      ),
  );
}
export async function retrieve(
  pid: string,
  query: string,
  options: { signal?: AbortSignal; limit?: number; semantic?: boolean } = {},
) {
  const p = getProject(pid),
    c = config(),
    chunks = chunksFor(p),
    keys = terms(query),
    lexical = chunks
      .map((row) => ({
        row,
        score: [...keys].reduce(
          (s, k) =>
            s +
            (row.title.toLowerCase().includes(k) ? 4 : 0) +
            (row.content.toLowerCase().includes(k) ? 1 : 0),
          0,
        ),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  let ranked = lexical,
    mode = "keyword",
    warning = "";
  if (c.key && options.semantic !== false) {
    try {
      const [q] = await embeddings(pid, [query.slice(0, 6000)], options.signal);
      const indexed = db
        .prepare(
          "SELECT *,vec_distance_cosine(embedding,?) distance FROM retrieval_chunks WHERE project_id=? AND model=? AND dimensions=? AND embedding IS NOT NULL ORDER BY distance LIMIT 30",
        )
        .all(q, pid, c.model, c.dimensions) as any[];
      const current = new Map(chunks.map((r) => [r.id, r]));
      const scores = new Map<string, { row: Chunk; score: number }>();
      lexical.forEach((r, i) =>
        scores.set(r.row.id, { row: r.row, score: 1 / (30 + i) }),
      );
      indexed.forEach((r, i) => {
        const latest = current.get(r.id);
        if (!latest || latest.content_hash !== r.content_hash) return;
        const prev = scores.get(r.id);
        scores.set(r.id, {
          row: latest,
          score: (prev?.score || 0) + 1 / (30 + i),
        });
      });
      ranked = [...scores.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, 24);
      mode = indexed.length ? "hybrid" : "keyword";
      if (c.rerankKey && ranked.length) {
        try {
          const r = await request(
            "rerank",
            pid,
            {
              model: c.rerankModel,
              query: query.slice(0, 6000),
              documents: ranked.map((x) => x.row.title + "\n" + x.row.content),
              top_n: Math.min(options.limit || 6, ranked.length),
              return_documents: false,
            },
            options.signal,
          );
          if (!Array.isArray(r.results)) throw new Error("重排结果不完整");
          const reordered = r.results
            .filter(
              (x: any) =>
                Number.isInteger(x.index) &&
                ranked[x.index] &&
                Number.isFinite(x.relevance_score),
            )
            .map((x: any) => ({
              row: ranked[x.index].row,
              score: x.relevance_score,
            }));
          if (!reordered.length) throw new Error("重排结果为空");
          ranked = reordered;
          mode += "-rerank";
        } catch {
          warning = "重排暂不可用，已保留检索顺序";
        }
      }
    } catch (e) {
      warning = "语义检索暂不可用，使用原文匹配";
      if (options.signal?.aborted) throw e;
    }
  }
  return {
    revision: p.revision,
    mode,
    warning,
    hits: ranked
      .slice(0, options.limit || 6)
      .map(({ row, score }): RetrievalHit => ({
        entityId: row.entity_id,
        blockId: row.block_id,
        title: row.title,
        text: row.content,
        source: row.kind === "conversation" ? "conversation" : "entity",
        score,
      })),
  };
}
export function nextIndexProject() {
  if (!config().key) return null;
  const ps = db
    .prepare(
      "SELECT id FROM projects WHERE archived=0 ORDER BY updated_at DESC",
    )
    .all() as any[];
  for (const row of ps) {
    const p = getProject(row.id),
      s = db
        .prepare("SELECT * FROM retrieval_state WHERE project_id=?")
        .get(p.id) as any;
    if (
      !s ||
      ((s.status !== "ready" || s.fingerprint !== fingerprint(p)) &&
        (!s.error || Date.now() - Date.parse(s.updated_at) > 60000))
    )
      return p.id;
  }
  return null;
}
