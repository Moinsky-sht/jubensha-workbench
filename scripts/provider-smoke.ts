import fs from "node:fs";
import {
  initializeProviders,
  providerStatus,
  probeModel,
  arkId,
} from "../server/providers.js";
await initializeProviders();
const models = providerStatus().models;
if (!models.length) throw new Error("未取得火山目录");
const results: any[] = [];
let cursor = 0;
async function work() {
  while (cursor < models.length) {
    const m = models[cursor++];
    const r = await probeModel(arkId(m.id));
    results.push({ model: m.id, ...r });
    console.log(m.id, r.ok ? "通过" : "未通过");
    fs.mkdirSync("output", { recursive: true });
    fs.writeFileSync(
      "output/provider-smoke.json",
      JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
      { mode: 0o600 },
    );
  }
}
await Promise.all([work(), work()]);
console.log(
  JSON.stringify({
    total: results.length,
    passed: results.filter((r) => r.ok).length,
  }),
);
