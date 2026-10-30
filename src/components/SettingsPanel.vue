<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { api, useWorkspace } from "../store";
import { modules, type ModelConnection } from "../../shared/domain";
import Button from "./Button.vue";
import Icon from "./Icon.vue";
import ProviderCatalog from "./ProviderCatalog.vue";
const w = useWorkspace(),
  tab = ref("models"),
  editing = ref(false),
  advanced = ref(false),
  busy = ref(false),
  feedback = ref(""),
  modelList = ref<string[]>([]),
  usage = ref<any[]>([]),
  retrievalUsage = ref<any[]>([]),
  guidelineTitle = ref(""),
  guidelineText = ref(""),
  guidelinePrompt = ref("");
const templateTitle = ref(""),
  templateObjects = ref<string[]>([]);
async function templateSave() {
  try {
    await api("/templates", {
      projectId: w.projectId,
      title: templateTitle.value,
      entityIds: templateObjects.value,
    });
    templateTitle.value = "";
    templateObjects.value = [];
    feedback.value = "模板已保存";
  } catch (e) {
    w.fail(e);
  }
}
const readingFont = ref(localStorage.getItem("readingFont") || "serif"),
  readingSize = ref(Number(localStorage.getItem("readingSize") || 18));
function reading() {
  localStorage.setItem("readingFont", readingFont.value);
  localStorage.setItem("readingSize", String(readingSize.value));
  document.documentElement.style.setProperty(
    "--reading-size",
    readingSize.value + "px",
  );
  document.documentElement.style.setProperty(
    "--reading-font",
    readingFont.value === "sans" ? "sans-serif" : "var(--font-body)",
  );
}
const empty = () => ({
  name: "",
  protocol: "compatible" as ModelConnection["protocol"],
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
  timeout: 180,
  contextLimit: 128000,
  maxOutput: 8000,
  concurrency: 2,
  structured: true,
});
const form = ref<any>(empty());
const activeGuideline = computed(() =>
  w.guidelines.find((g) => g.status === "active"),
);
onMounted(async () => {
  await w.loadConnections();
  guidelineText.value = activeGuideline.value?.content || "";
  guidelineTitle.value = activeGuideline.value?.title || "新的规范";
  usage.value = await api("/usage");
  retrievalUsage.value = await api("/retrieval/usage");
});
async function logout() {
  await api("/auth/logout", {});
  window.location.reload();
}
function edit(c?: ModelConnection) {
  feedback.value = "";
  modelList.value = [];
  form.value = c ? { ...c, apiKey: "" } : empty();
  editing.value = true;
}
async function save() {
  busy.value = true;
  feedback.value = "";
  try {
    const { hasKey, ...value } = form.value;
    if (value.id && !value.apiKey) delete value.apiKey;
    const c = await api("/connections", value);
    if (!w.settings.defaultModel) {
      await api("/settings", { defaultModel: c.id }, "PATCH");
    }
    await w.loadConnections();
    editing.value = false;
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
async function test(c: ModelConnection) {
  busy.value = true;
  feedback.value = "";
  try {
    const r = await api("/connections/" + c.id + "/test", {});
    feedback.value = r.message;
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
async function defaults() {
  try {
    await api("/settings", w.settings, "PATCH");
  } catch (e) {
    w.fail(e);
  }
}
async function mapping(module: string, value: string) {
  await w.updateMeta({
    moduleModels: { ...w.project?.data.moduleModels, [module]: value },
  });
}
async function saveGuideline() {
  try {
    await api("/guidelines", {
      title: guidelineTitle.value,
      content: guidelineText.value,
    });
    await w.loadConnections();
    feedback.value = "已保存为新草稿";
  } catch (e) {
    w.fail(e);
  }
}
async function reviseGuideline() {
  try {
    await api("/jobs", {
      projectId: w.projectId,
      kind: "guideline",
      scope: { module: "guideline", projectWide: true },
      prompt: guidelinePrompt.value,
    });
    guidelinePrompt.value = "";
    feedback.value = "规范修订已加入任务";
    await w.refreshJobs();
  } catch (e) {
    w.fail(e);
  }
}
async function getModels() {
  try {
    modelList.value = await api("/connections/" + form.value.id + "/models");
  } catch (e) {
    feedback.value = e instanceof Error ? e.message : String(e);
  }
}
</script>
<template>
  <div class="settings-panel">
    <nav class="section-tabs">
      <button
        v-for="[key, label] in [
          ['models', '模型连接'],
          ['routing', '分配'],
          ['guidelines', '创作规范'],
          ['usage', '用量'],
          ['workspace', '工作空间'],
        ]"
        :key="key"
        :class="{ active: tab === key }"
        @click="
          tab = key;
          feedback = '';
        "
      >
        {{ label }}
      </button>
    </nav>
    <p v-if="feedback" class="inline-feedback">{{ feedback }}</p>
    <template v-if="tab === 'models'"
      ><form v-if="editing" class="connection-form" @submit.prevent="save">
        <div class="field-grid">
          <label class="field"
            ><span>名称</span><input v-model="form.name" required /></label
          ><label class="field"
            ><span>协议</span
            ><select v-model="form.protocol">
              <option value="compatible">OpenAI 兼容</option>
              <option value="openai">OpenAI 原生</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
            </select></label
          ><label class="field full-width"
            ><span>接口地址</span
            ><input v-model="form.baseUrl" type="url" required /></label
          ><label class="field"
            ><span>模型标识</span
            ><input v-model="form.model" list="models" required /><datalist
              id="models"
            >
              <option
                v-for="m in modelList"
                :key="m"
                :value="m"
              /></datalist></label
          ><label class="field"
            ><span>{{ form.id ? "更换密钥（留空保留）" : "API 密钥" }}</span
            ><input
              v-model="form.apiKey"
              type="password"
              autocomplete="new-password"
              :required="!form.id"
          /></label>
        </div>
        <div class="form-actions">
          <Button
            type="button"
            icon="SlidersHorizontal"
            variant="ghost"
            @click="advanced = !advanced"
            >高级参数</Button
          ><Button
            v-if="form.id"
            type="button"
            variant="ghost"
            @click="getModels"
            >获取模型列表</Button
          >
        </div>
        <div v-if="advanced" class="field-grid">
          <label
            v-for="[key, label] in [
              ['timeout', '超时（秒）'],
              ['contextLimit', '上下文容量'],
              ['maxOutput', '输出上限'],
              ['concurrency', '并发'],
              ['inputPrice', '输入价格 / 百万 Token'],
              ['outputPrice', '输出价格 / 百万 Token'],
            ]"
            :key="key"
            class="field"
            ><span>{{ label }}</span
            ><input
              v-model.number="form[key]"
              type="number"
              min="0"
              step="any" /></label
          ><label class="check-field"
            ><input v-model="form.structured" type="checkbox" />使用 JSON
            模式</label
          ><label class="field"
            ><span>备用连接</span
            ><select v-model="form.fallbackId">
              <option :value="undefined">不切换</option>
              <option
                v-for="c in w.connections.filter((c) => c.id !== form.id)"
                :key="c.id"
                :value="c.id"
              >
                {{ c.name }}
              </option>
            </select></label
          >
        </div>
        <div class="form-actions">
          <span class="grow" /><Button
            type="button"
            variant="ghost"
            @click="editing = false"
            >取消</Button
          ><Button type="submit" variant="primary" :busy="busy"
            >保存连接</Button
          >
        </div>
      </form>
      <template v-else
        ><ProviderCatalog />
        <div
          v-for="c in w.connections.filter((c) => !c.managed)"
          :key="c.id"
          class="connection-row"
        >
          <div class="connection-icon"><Icon name="Orbit" /></div>
          <div>
            <strong>{{ c.name }}</strong>
            <p>{{ c.model }}</p>
          </div>
          <span class="grow" /><span class="muted">{{
            c.hasKey ? "已配置" : "缺少密钥"
          }}</span
          ><Button :busy="busy" variant="ghost" @click="test(c)">测试</Button
          ><Button variant="ghost" @click="edit(c)">编辑</Button
          ><Button
            icon="Trash2"
            label="移除连接"
            variant="ghost"
            @click="
              api('/connections/' + c.id, undefined, 'DELETE')
                .then(w.loadConnections)
                .catch(w.fail)
            "
          />
        </div>
        <Button icon="Plus" @click="edit()">添加连接</Button></template
      ></template
    >
    <template v-if="tab === 'routing'"
      ><div class="field-grid">
        <label class="field"
          ><span>全局默认</span
          ><select v-model="w.settings.defaultModel" @change="defaults">
            <option value="">未指定</option>
            <option v-for="c in w.connections" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select></label
        ><label class="field"
          ><span>同时执行任务数</span
          ><input
            v-model.number="w.settings.concurrency"
            type="number"
            min="1"
            max="8"
            @change="defaults" /></label
        ><label v-if="w.project" class="field"
          ><span>当前项目</span
          ><select
            :value="w.project.data.defaultModel || ''"
            @change="
              w
                .updateMeta({
                  defaultModel: ($event.target as HTMLSelectElement).value,
                })
                .catch(w.fail)
            "
          >
            <option value="">沿用全局</option>
            <option v-for="c in w.connections" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select></label
        >
      </div>
      <div v-if="w.project" class="routing-table">
        <label v-for="m in modules" :key="m.id"
          ><span>{{ m.label }}</span
          ><select
            :value="w.project.data.moduleModels?.[m.id] || ''"
            @change="
              mapping(m.id, ($event.target as HTMLSelectElement).value).catch(
                w.fail,
              )
            "
          >
            <option value="">沿用项目</option>
            <option v-for="c in w.connections" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select></label
        >
      </div></template
    >
    <template v-if="tab === 'guidelines'"
      ><div class="guideline-toolbar">
        <select
          aria-label="规范版本"
          @change="
            guidelineText =
              w.guidelines.find(
                (g) => g.id === ($event.target as HTMLSelectElement).value,
              )?.content || '';
            guidelineTitle =
              w.guidelines.find(
                (g) => g.id === ($event.target as HTMLSelectElement).value,
              )?.title || '';
          "
        >
          <option
            v-for="g in w.guidelines"
            :key="g.id"
            :value="g.id"
            :selected="g.status === 'active'"
          >
            {{ g.title }} ·
            {{
              g.status === "active"
                ? "使用中"
                : g.status === "draft"
                  ? "草稿"
                  : "历史"
            }}
          </option></select
        ><Button
          icon="RefreshCw"
          label="刷新规范"
          variant="ghost"
          @click="w.loadConnections()"
        />
      </div>
      <label class="field"
        ><span>版本名称</span><input v-model="guidelineTitle" /></label
      ><textarea
        v-model="guidelineText"
        class="guideline-editor"
        aria-label="规范内容"
        rows="15"
      />
      <div class="form-actions">
        <Button variant="primary" @click="saveGuideline">另存草稿</Button>
      </div>
      <div class="guideline-revisions">
        <div
          v-for="g in w.guidelines
            .filter((g) => g.status !== 'active')
            .slice(0, 5)"
          :key="g.id"
        >
          <span>{{ g.title }}</span
          ><span class="muted">{{
            new Date(g.created_at).toLocaleString("zh-CN")
          }}</span
          ><Button
            variant="ghost"
            @click="
              api('/guidelines/' + g.id + '/activate', {})
                .then(w.loadConnections)
                .catch(w.fail)
            "
            >启用</Button
          >
        </div>
      </div>
      <div v-if="w.project" class="guideline-chat">
        <label class="field"
          ><span>对话修订</span
          ><textarea v-model="guidelinePrompt" rows="2" /></label
        ><Button :disabled="!guidelinePrompt.trim()" @click="reviseGuideline"
          >生成新草稿</Button
        >
      </div></template
    >
    <template v-if="tab === 'workspace'"
      ><label v-if="w.project" class="field"
        ><span>项目名称</span
        ><input
          :value="w.project.title"
          @change="
            w
              .updateMeta({ title: ($event.target as HTMLInputElement).value })
              .catch(w.fail)
          "
      /></label>
      <div class="field-grid">
        <label class="field"
          ><span>正文字体</span
          ><select v-model="readingFont" @change="reading">
            <option value="serif">宋体</option>
            <option value="sans">黑体</option>
          </select></label
        ><label class="field"
          ><span>字号</span
          ><input
            v-model.number="readingSize"
            type="number"
            min="14"
            max="26"
            @change="reading"
        /></label>
      </div>
      <details v-if="w.project">
        <summary>保存创作模板</summary>
        <label class="field"
          ><span>模板名称</span><input v-model="templateTitle"
        /></label>
        <div class="project-checklist">
          <label
            v-for="e in w.entities.filter(
              (e) => !e.fileId && !['source', 'issue'].includes(e.kind),
            )"
            :key="e.id"
            ><input v-model="templateObjects" type="checkbox" :value="e.id" />{{
              e.title
            }}</label
          >
        </div>
        <Button
          :disabled="!templateTitle.trim() || !templateObjects.length"
          @click="templateSave"
          >保存所选</Button
        >
      </details>
      <div class="form-actions">
        <Button variant="ghost" @click="logout">退出登录</Button>
      </div></template
    ><template v-if="tab === 'usage'"
      ><div class="usage-summary">
        <strong>{{ usage.length }}</strong
        ><span>次调用</span><span class="grow" /><span
          >{{
            usage
              .reduce(
                (n, u) => n + (u.input_tokens || 0) + (u.output_tokens || 0),
                0,
              )
              .toLocaleString()
          }}
          Token</span
        >
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>模型</th>
              <th>输入 / 输出</th>
              <th>耗时</th>
              <th>费用</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in usage" :key="u.id">
              <td>{{ u.model }}</td>
              <td>
                {{ u.input_tokens ?? "—" }} / {{ u.output_tokens ?? "—" }}
              </td>
              <td>{{ (u.duration / 1000).toFixed(1) }}s</td>
              <td>{{ u.cost === null ? "费用未配置" : u.cost.toFixed(4) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <details v-if="retrievalUsage.length">
        <summary>检索调用 · {{ retrievalUsage.length }} 次</summary>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>用途</th>
                <th>模型</th>
                <th>Token</th>
                <th>耗时</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in retrievalUsage" :key="u.id">
                <td>{{ u.operation === "embedding" ? "向量" : "重排" }}</td>
                <td>{{ u.model }}</td>
                <td>{{ u.input_tokens ?? "—" }}</td>
                <td>{{ (u.duration / 1000).toFixed(1) }}s</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted">费用未配置</p>
      </details></template
    >
  </div>
</template>
