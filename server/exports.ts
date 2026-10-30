import { readingEntries,players } from "../shared/story.js";
import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  PageBreak,
} from "docx";
import { chromium } from "playwright";
import { db, id, now, dataDir } from "./db.js";
import { getProject, AppError } from "./projects.js";
import {
  type Project,
  type Entity,
  type RichNode,
  plain,
  audiences,
} from "../shared/domain.js";
export type ExportOptions = {
  format: "md" | "docx" | "pdf" | "zip" | "json";
  audience: keyof typeof audiences;
  revision: number;
  template?: "role" | "host" | "cards";
  font?: "serif" | "sans";
  fontSize?: number;
  margin?: number;
  preview?: boolean;
  characterId?: string;
  throughAct?: number;
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function deliverableEntities(
  p: Project,
  audience: keyof typeof audiences,
  preview = false,
) {
  const accepted = p.data.entities
    .filter((e) => preview || e.status === "ready")
    .sort((a, b) => {
      const act = (e: Entity) =>
        p.data.entities.find((x) => x.kind === "act" && e.refs.includes(x.id))
          ?.order ?? e.order;
      return act(a) - act(b) || a.order - b.order;
    });
  return accepted.filter((e) =>
    audience === "author"
      ? true
      : e.audience === audience &&
        [
          "document",
          "performance",
          "clue",
          "object",
          "memory",
          "asset",
          "task",
          "playtest",
        ].includes(e.kind),
  );
}
export function safeEntity(e: Entity, audience: keyof typeof audiences) {
  if (audience === "author") return structuredClone(e);
  const allowed =
    e.kind === "document"
      ? ["pov"]
      : e.kind === "performance" && audience === "player"
        ? ["entry", "goal"]
        : e.kind === "performance"
          ? [
              "start",
              "duration",
              "performers",
              "place",
              "entry",
              "goal",
              "cooperate",
              "silent",
              "refuse",
              "unexpected",
              "exit",
              "props",
            ]
          : ["appearance", "acquire", "goal", "reward", "gesture"];
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    audience: e.audience,
    fields: Object.fromEntries(
      Object.entries(e.fields).filter(([k]) => allowed.includes(k)),
    ),
    body: e.body,
    refs: [],
  };
}
function nodesHTML(n: RichNode): string {
  if (n.type === "text") {
    let t = escape(n.text || "");
    for (const m of n.marks || []) {
      if (m.type === "bold") t = `<strong>${t}</strong>`;
      if (m.type === "italic") t = `<em>${t}</em>`;
    }
    return t;
  }
  const tags: Record<string, string> = {
    paragraph: "p",
    heading: "h2",
    bulletList: "ul",
    orderedList: "ol",
    listItem: "li",
    blockquote: "blockquote",
    table: "table",
    tableRow: "tr",
    tableCell: "td",
    tableHeader: "th",
  };
  if (n.type === "hardBreak") return "<br>";
  const s = (n.content || []).map(nodesHTML).join(""),
    tag = tags[n.type];
  return tag ? `<${tag}>${s || "&nbsp;"}</${tag}>` : s;
}
export function deliveryManifest(p:Project,options:ExportOptions){
 const entries=options.characterId?readingEntries(p,{...options,includeDraft:!!options.preview}):deliverableEntities(p,options.audience,!!options.preview);
 const kinds=options.template==="role"?["document"]:options.template==="host"?["performance","playtest","object","task"]:options.template==="cards"?["clue","memory","object","task"]:null;
 return kinds?entries.filter(e=>kinds.includes(e.kind)):entries;
}
export function previewHTML(p: Project, options: ExportOptions) {
  if(options.audience==="player" && players(p).length>1 && !options.characterId)throw new AppError("请选择玩家角色");
  const entries = deliveryManifest(p,options);
  const size = Math.min(24, Math.max(12, options.fontSize || 16)),
    margin = Math.min(40, Math.max(10, options.margin || 22));
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escape(p.title)}</title><style>@page{size:A4;margin:${margin}mm}body{font-family:${options.font === "sans" ? 'Arial, "PingFang SC", sans-serif' : '"Songti SC", "Noto Serif CJK SC", serif'};font-size:${size}px;line-height:1.9;color:#18202a;margin:0}h1{font-size:28px}h2{font-size:22px}h3{font-size:18px}p{white-space:pre-wrap}section{break-before:page}section:first-child{break-before:auto}.meta{font-family:sans-serif;font-size:11px;color:#687481}.fields{white-space:pre-wrap;font-size:13px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:8px}img{max-width:100%}${options.template === "cards" ? ".cards{display:grid;grid-template-columns:1fr 1fr;gap:12mm}.cards section{break-before:auto;break-inside:avoid;border:1px solid #aaa;padding:8mm}" : ""}</style><body><header><h1>${escape(p.title)}</h1><div class="meta">${audiences[options.audience]}用本 · 版本 ${p.revision}${options.preview ? " · 草稿预览" : ""}</div></header><main class="${options.template === "cards" ? "cards" : ""}">${entries
    .filter((e) => e.kind !== "asset")
    .map((e) => {
      const s = safeEntity(e, options.audience);
      return `<section><h2>${escape(e.title)}</h2>${nodesHTML(s.body)}${
        Object.keys(s.fields).length
          ? `<div class="fields">${Object.entries(s.fields)
              .map(
                ([k, v]) => `${escape(fieldLabel(e, k))}：${escape(String(v))}`,
              )
              .join("<br>")}</div>`
          : ""
      }</section>`;
    })
    .join("")}</main></body></html>`;
}
import { definitions } from "../shared/domain.js";
function fieldLabel(e: Entity, key: string) {
  return (
    definitions[e.kind].fields.find((f) => f.key === key)?.label || "补充信息"
  );
}
export async function exportProject(projectId: string, options: ExportOptions) {
  const p = getProject(projectId, options.revision);
  if(options.audience==="player" && players(p).length>1 && !options.characterId)throw new AppError("请选择要导出的玩家角色");
  const entries = deliveryManifest(p,{...options,preview:false});
  if (!entries.length)
    throw new AppError("这个版本没有该受众的定稿内容，请先定稿");
  if (entries.some((e) => e.stale))
    throw new AppError("交付内容的上游已变化，请完成审校后重新定稿");
  const blocking = p.data.entities.filter(
    (e) =>
      e.kind === "issue" &&
      e.fields.severity === "阻断" &&
      e.fields.resolution === "未处理",
  );
  if (blocking.some((i) => i.refs.some((r) => entries.some((e) => e.id === r))))
    throw new AppError("所选内容还有阻断问题");
  const filtered = { ...p, data: { entities: entries } };
  const rid = id(),
    folder = path.join(dataDir, "exports");
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const name = `${p.title.replace(/[^\p{L}\p{N}_-]/gu, "_")}-${audiences[options.audience]}-v${p.revision}.${options.format}`,
    dest = path.join(folder, rid + "." + options.format);
  const markdown = (es: Entity[]) =>
    `# ${p.title}\n\n${audiences[options.audience]}用本 · 版本 ${p.revision}\n\n` +
    es
      .filter((e) => e.kind !== "asset")
      .map((e) => {
        const s = safeEntity(e, options.audience);
        return (
          `## ${s.title}\n\n${plain(s.body)}\n\n` +
          Object.entries(s.fields)
            .map(([k, v]) => `- ${fieldLabel(e, k)}：${v}`)
            .join("\n")
        );
      })
      .join("\n\n");
  const json = JSON.stringify(
    {
      schemaVersion: 1,
      project: { id: p.id, title: p.title, revision: p.revision },
      audience: options.audience,
      entities: entries.map((e) => safeEntity(e, options.audience)),
    },
    null,
    2,
  );
  if (options.format === "md") fs.writeFileSync(dest, markdown(entries));
  if (options.format === "json") fs.writeFileSync(dest, json);
  if (options.format === "docx") {
    const paragraphs: Paragraph[] = [
      new Paragraph({ text: p.title, heading: HeadingLevel.TITLE }),
      new Paragraph(`${audiences[options.audience]}用本 · 版本 ${p.revision}`),
    ];
    for (const e of entries.filter((e) => e.kind !== "asset")) {
      const s = safeEntity(e, options.audience);
      paragraphs.push(
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ text: e.title, heading: HeadingLevel.HEADING_1 }),
      );
      for (const line of plain(s.body).split("\n"))
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: line,
                font: options.font === "sans" ? "Microsoft YaHei" : "SimSun",
                size: (options.fontSize || 16) * 1.5,
              }),
            ],
            spacing: { after: 150, line: 380 },
          }),
        );
      for (const [k, v] of Object.entries(s.fields))
        paragraphs.push(new Paragraph(`${fieldLabel(e, k)}：${v}`));
    }
    const mm = (options.margin || 22) * 56.7;
    const document = new Document({
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: mm, bottom: mm, left: mm, right: mm },
            },
          },
          children: paragraphs,
        },
      ],
    });
    fs.writeFileSync(dest, await Packer.toBuffer(document));
  }
  if (options.format === "pdf") {
    const browser = await chromium.launch({
      ...(process.platform === "darwin" ? { channel: "chrome" } : {}),
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.route("**/*", (r) => r.abort());
      await page.setContent(
        previewHTML(p, { ...options, preview: false }),
        { waitUntil: "load" },
      );
      await page.pdf({
        path: dest,
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
    } finally {
      await browser.close();
    }
  }
  if (options.format === "zip") {
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(dest);
      const archive = archiver("zip", { zlib: { level: 6 } });
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
      archive.pipe(output);
      archive.append(json, { name: "项目结构.json" });
      const groups = new Map<string, Entity[]>();
      for (const e of entries.filter((e) => e.kind !== "asset")) {
        const character = p.data.entities.find(
          (c) => c.kind === "character" && e.refs.includes(c.id),
        );
        const key = character?.title || "公共内容";
        groups.set(key, [...(groups.get(key) || []), e]);
      }
      let i = 0;
      for (const [name, es] of groups)
        archive.append(markdown(es), {
          name: `${++i}-${name.replace(/[\\/]/g, "_")}.md`,
        });
      for (const e of entries.filter((e) => e.fileId)) {
        const f = db
          .prepare("SELECT * FROM files WHERE id=? AND project_id=?")
          .get(e.fileId!, p.id) as any;
        if (f && fs.existsSync(f.path))
          archive.file(f.path, {
            name: `附件/${e.id}-${path.basename(f.name)}`,
          });
      }
      archive.append(
        "日期｜版本｜人数｜阅读耗时｜演绎耗时｜卡点｜误判｜参与情况｜NPC负荷｜改动\n",
        { name: "试跑记录表.txt" },
      );
      archive.finalize();
    });
  }
  db.prepare("INSERT INTO releases VALUES(?,?,?,?,?,?,?,?)").run(
    rid,
    p.id,
    p.revision,
    options.format,
    options.audience,
    name,
    dest,
    now(),
  );
  return {
    id: rid,
    fileName: name,
    url: "/api/releases/" + rid + "/download",
    revision: p.revision,
  };
}


export async function printPreview(p:Project, options:ExportOptions) {
  if(options.audience==="player"&&!options.characterId)throw new AppError("请选择玩家角色");
  const browser=await chromium.launch({...(process.platform==="darwin"?{channel:"chrome"}:{}),headless:true});
  try {
    const page=await browser.newPage();
    await page.route("**/*",r=>r.abort());
    await page.setContent(previewHTML(p,{...options,preview:true}),{waitUntil:"load"});
    return await page.pdf({format:"A4",printBackground:true,preferCSSPageSize:true});
  } finally {await browser.close();}
}
