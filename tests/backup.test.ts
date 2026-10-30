import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-backup-"));
process.env.WORKBENCH_DATA = path.join(root, "original");
const { db, dataDir, encrypt } = await import("../server/db");
const { createProject } = await import("../server/projects");
const { importFile } = await import("../server/imports");
after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});
test("在线备份可以迁移恢复，附件路径重建且不覆盖既有目录", async () => {
  const p = createProject("备份样本");
  await importFile(p.id, {
    originalname: "original.txt",
    mimetype: "text/plain",
    buffer: Buffer.from("原始内容"),
  });
  db.prepare("INSERT INTO connections VALUES(?,?,?)").run(
    "x",
    "{}",
    encrypt("isolated-test-key"),
  );
  const backup = path.join(root, "snapshot"),
    restored = path.join(root, "restored");
  for (const args of [
    ["scripts/backup.ts", backup],
    ["scripts/restore.ts", backup, restored],
  ]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", ...args], {
      env: process.env,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const check = new DatabaseSync(path.join(restored, "workbench.sqlite"));
  assert.equal(
    (check.prepare("PRAGMA integrity_check").get() as any).integrity_check,
    "ok",
  );
  const f = check.prepare("SELECT path FROM files").get() as any;
  assert.ok(f.path.startsWith(restored));
  assert.equal(fs.readFileSync(f.path, "utf8"), "原始内容");
  assert.deepEqual(
    fs.readFileSync(path.join(dataDir, "master.key")),
    fs.readFileSync(path.join(restored, "master.key")),
  );
  check.close();
  const again = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/restore.ts", backup, restored],
    { encoding: "utf8" },
  );
  assert.notEqual(again.status, 0);
  assert.ok(fs.existsSync(f.path));
});
