import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { id, db, dataDir } from "./db.js";
import { newEntity, doc, type Entity } from "../shared/domain.js";
import { getProject, applyChange, AppError } from "./projects.js";
export async function importFile(
  projectId: string,
  file: { originalname: string; buffer: Buffer; mimetype: string },
) {
  const p = getProject(projectId);
  const name = Buffer.from(file.originalname, "latin1").toString("utf8");
  const displayName = name.includes("�") ? file.originalname : name;
  const ext = path.extname(displayName).toLowerCase();
  let text = "",
    purpose = "待整理";
  const media = /^(image|audio)\//.test(file.mimetype);
  if ([".md", ".txt"].includes(ext)) text = file.buffer.toString("utf8");
  else if (ext === ".docx")
    text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
  else if (ext === ".pdf") {
    const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
    if (text.replace(/\s/g, "").length < 30) {
      text = "";
      purpose = "需要识别";
    }
  } else if (!media)
    throw new AppError("支持 Markdown、TXT、DOCX、PDF、图片和音频");
  const fid = id(),
    dest = path.join(dataDir, "files", fid + ext);
  fs.writeFileSync(dest, file.buffer, { mode: 0o600 });
  db.prepare("INSERT INTO files VALUES(?,?,?,?,?,?)").run(
    fid,
    projectId,
    displayName,
    file.mimetype,
    dest,
    file.buffer.length,
  );
  const e = newEntity(media ? "asset" : "source", displayName);
  e.fileId = fid;
  e.fields = { purpose, ...(!media ? { origin: displayName } : {}) };
  e.body = doc(text);
  e.locked = !media;
  try {
    const result = applyChange({
      projectId,
      requestId: id(),
      baseRevision: p.revision,
      operations: [{ type: "create_entity", entity: e }],
      scope: { module: "sources" },
      source: "import",
      summary: "导入 " + displayName,
    });
    return { ...result, needsRecognition: purpose === "需要识别" };
  } catch (err) {
    db.prepare("DELETE FROM files WHERE id=?").run(fid);
    fs.unlinkSync(dest);
    throw err;
  }
}
export function extractionCandidates(pId: string, sourceId: string) {
  const p = getProject(pId),
    e = p.data.entities.find((e) => e.id === sourceId && e.kind === "source");
  if (!e) throw new AppError("素材不存在", 404);
  const text = (e.body.content || [])
    .map((n) => (n.content || []).map((x) => x.text || "").join(""))
    .join("\n");
  const candidates: Entity[] = [];
  for (const match of text.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    const title = match[1].trim();
    const kind = /第[一二三四五六七八九十\d]+幕/.test(title)
      ? "act"
      : /人物|角色/.test(title)
        ? "character"
        : null;
    if (kind) {
      const row = newEntity(kind, title);
      row.refs = [sourceId];
      row.status = "review";
      candidates.push(row);
    }
  }
  return candidates.slice(0, 80);
}
