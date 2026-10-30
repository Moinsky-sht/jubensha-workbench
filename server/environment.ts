import fs from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
// Tests use isolated fixtures; production loads only this app's private env.
if (!process.env.WORKBENCH_DATA || process.env.WORKBENCH_ENV_FILE) {
  const file = path.resolve(process.env.WORKBENCH_ENV_FILE || ".env");
  if (fs.existsSync(file)) loadEnvFile(file);
}
