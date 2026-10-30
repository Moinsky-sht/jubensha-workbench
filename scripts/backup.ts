import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { dataDir, db } from "../server/db.js";
const target = path.resolve(
  process.argv[2] ||
    "backups/" + new Date().toISOString().replace(/[:.]/g, "-"),
);
if (fs.existsSync(target)) throw new Error("备份目录已存在，请指定新目录");
fs.mkdirSync(target, { recursive: true, mode: 0o700 });
await backup(db, path.join(target, "workbench.sqlite"));
for (const folder of ["files", "exports"])
  if (fs.existsSync(path.join(dataDir, folder)))
    fs.cpSync(path.join(dataDir, folder), path.join(target, folder), {
      recursive: true,
    });
fs.copyFileSync(
  path.join(dataDir, "master.key"),
  path.join(target, "master.key"),
);
fs.chmodSync(path.join(target, "master.key"), 0o600);
fs.chmodSync(path.join(target, "workbench.sqlite"), 0o600);
fs.writeFileSync(
  path.join(target, "manifest.json"),
  JSON.stringify({ version: 1, createdAt: new Date().toISOString() }, null, 2),
  { mode: 0o600 },
);
const check = new DatabaseSync(path.join(target, "workbench.sqlite"));
const result = check.prepare("PRAGMA integrity_check").get() as any;
if (result.integrity_check !== "ok") throw new Error("备份校验失败");
check.close();
console.log("备份与数据库完整性校验完成：" + target);

db.close();
