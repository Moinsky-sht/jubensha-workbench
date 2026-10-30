import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const source = process.argv[2] && path.resolve(process.argv[2]),
  target = process.argv[3] && path.resolve(process.argv[3]);
if (!source || !target)
  throw new Error("用法：npm run restore -- 备份目录 新的数据目录");
if (fs.existsSync(target))
  throw new Error("目标目录已经存在，请指定一个新目录");
for (const name of ["workbench.sqlite", "master.key"])
  if (!fs.existsSync(path.join(source, name)))
    throw new Error("备份缺少 " + name);
if (fs.readFileSync(path.join(source, "master.key")).length !== 32)
  throw new Error("备份的密钥文件不正确");
const original = new DatabaseSync(path.join(source, "workbench.sqlite"), {
  readOnly: true,
});
if (
  (original.prepare("PRAGMA integrity_check").get() as any).integrity_check !==
  "ok"
)
  throw new Error("备份数据库损坏");
original.close();
fs.mkdirSync(target, { recursive: true, mode: 0o700 });
for (const name of ["workbench.sqlite", "master.key", "files", "exports"])
  if (fs.existsSync(path.join(source, name)))
    fs.cpSync(path.join(source, name), path.join(target, name), {
      recursive: true,
    });
const restored = new DatabaseSync(path.join(target, "workbench.sqlite"));
restored.exec("BEGIN");
try {
  for (const [table, folder] of [
    ["files", "files"],
    ["releases", "exports"],
  ]) {
    const rows = restored
      .prepare(`SELECT id,path FROM ${table}`)
      .all() as any[];
    for (const row of rows) {
      const dest = path.join(target, folder, path.basename(row.path));
      if (!fs.existsSync(dest))
        throw new Error("备份缺少附件：" + path.basename(row.path));
      restored
        .prepare(`UPDATE ${table} SET path=? WHERE id=?`)
        .run(dest, row.id);
    }
  }
  restored.exec(
    "DELETE FROM sessions; UPDATE jobs SET status='paused',error='已从备份恢复，请核对后继续' WHERE status IN ('queued','running'); COMMIT;",
  );
} catch (e) {
  restored.exec("ROLLBACK");
  throw e;
} finally {
  restored.close();
}
for (const name of ["workbench.sqlite", "master.key"])
  fs.chmodSync(path.join(target, name), 0o600);
console.log(
  "已恢复到独立目录：" + target + "。使用 WORKBENCH_DATA 指向该目录启动。",
);
