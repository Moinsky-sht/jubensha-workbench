import "./environment.js";
import * as sqliteVec from "sqlite-vec";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
export const dataDir = path.resolve(process.env.WORKBENCH_DATA || "data");
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(dataDir, "files"), { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(path.join(dataDir, "workbench.sqlite"), {
  allowExtension: true,
});
sqliteVec.load(db);
db.enableLoadExtension(false);
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);",
);
for (const file of fs
  .readdirSync(new URL("./migrations/", import.meta.url))
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort()) {
  const version = Number(file.split("_")[0]);
  if (db.prepare("SELECT version FROM migrations WHERE version=?").get(version))
    continue;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(
      fs.readFileSync(new URL("./migrations/" + file, import.meta.url), "utf8"),
    );
    db.prepare("INSERT INTO migrations VALUES(?,?)").run(
      version,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch(e) {db.exec("ROLLBACK");throw e;}
}
fs.chmodSync(path.join(dataDir, "workbench.sqlite"), 0o600);
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export function getSetting<T>(key: string, fallback: T): T {
  const r = db
    .prepare("SELECT value FROM settings WHERE key=?")
    .get(key) as any;
  return r ? JSON.parse(r.value) : fallback;
}
export function setSetting(key: string, value: any) {
  db.prepare(
    "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, JSON.stringify(value));
}
const keyPath = path.join(dataDir, "master.key");
if (!fs.existsSync(keyPath))
  fs.writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
const key = fs.readFileSync(keyPath);
if (key.length !== 32) throw new Error("密钥文件损坏");
export function encrypt(text: string) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([
    iv,
    c.update(text),
    c.final(),
    c.getAuthTag(),
  ]).toString("base64");
}
export function decrypt(text: string) {
  const b = Buffer.from(text, "base64"),
    c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  c.setAuthTag(b.subarray(-16));
  return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString();
}
let transactionDepth=0;
export function transaction<T>(fn: () => T): T {
  const nested=transactionDepth++>0;
  const savepoint="workbench_"+transactionDepth;
  db.exec(nested?"SAVEPOINT "+savepoint:"BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec(nested?"RELEASE "+savepoint:"COMMIT");
    return result;
  } catch (e) {
    db.exec(nested?"ROLLBACK TO "+savepoint:"ROLLBACK");
    if(nested)db.exec("RELEASE "+savepoint);
    throw e;
  } finally {transactionDepth--;}
}
