<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue";
import { api, useWorkspace } from "../store";
import { modules, labelStatus, moduleFor } from "../../shared/domain";
import Button from "./Button.vue";
import Icon from "./Icon.vue";
const templateId = ref(""),
  templates = ref<any[]>([]),
  themes = ref("");
async function createThemes() {
  try {
    const titles = themes.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (titles.length > 30) throw new Error("每次最多建立30个项目");
    const added = [];
    for (const title of titles) {
      const p = await api("/projects", {
        title,
        templateId: templateId.value || undefined,
      });
      w.setProject(p);
      added.push(p.id);
    }
    projects.value = added;
    themes.value = "";
  } catch (e) {
    w.fail(e);
  }
}
const w = useWorkspace(),
  creating = ref(false),
  projects = ref<string[]>(w.projectId ? [w.projectId] : []),
  kind = ref("generate"),
  module = ref("writing"),
  prompt = ref(""),
  perObject = ref(false),
  calls = ref<number>(),
  tokens = ref<number>(),
  cost = ref<number>(),
  batches = ref<any[]>([]),
  busy = ref(false),
  expanded = ref("");
const agentBrief = ref(w.project?.description || ""),
  agentMode = ref<"outline" | "draft">("draft"),
  agentBusy = ref(false),
  toolCatalog = ref<any[]>([]);
const toolPhases = computed(() => {
  const rows = toolCatalog.value.filter((tool) =>
    tool.modes.includes(agentMode.value),
  );
  return [...new Set(rows.map((tool) => tool.phase))].map((phase) => ({
    phase,
    tools: rows.filter((tool) => tool.phase === phase),
  }));
});
const agentRuns = computed(() =>
  w.jobs.filter(
    (job) => job.kind === "orchestrate" && job.project_id === w.projectId,
  ),
);
watch(
  () => w.projectId,
  () => (agentBrief.value = w.project?.description || ""),
);
const items = computed(() =>
  projects.value.flatMap((pid) => {
    const p = w.projects.find((p) => p.id === pid)!;
    const objects = perObject.value
      ? p.data.entities.filter((e) => moduleFor(e.kind) === module.value)
      : [];
    return (perObject.value ? objects : [null]).map((e) => ({
      projectId: pid,
      kind: kind.value,
      prompt: prompt.value,
      scope: {
        module: module.value,
        entityIds: e ? [e.id] : undefined,
        projectWide: !e,
      },
      exportOptions:
        kind.value === "export"
          ? { format: "zip", audience: "player", revision: p.revision }
          : undefined,
      label: p.title + (e ? " / " + e.title : ""),
      modelLabel:
        w.connections.find(
          (c) =>
            c.id ===
            (p.data.moduleModels?.[module.value] ||
              p.data.defaultModel ||
              w.settings.defaultModel),
        )?.name || "未配置模型",
    }));
  }),
);
onMounted(async () => {
  [templates.value, toolCatalog.value] = await Promise.all([
    api("/templates"),
    api("/agent-tools"),
  ]);
  await w.refreshJobs();
  batches.value = await api("/batches");
});
async function launchAgent() {
  if (!w.projectId || !agentBrief.value.trim()) return;
  agentBusy.value = true;
  try {
    await api("/projects/" + w.projectId + "/agent-runs", {
      brief: agentBrief.value.trim(),
      mode: agentMode.value,
    });
    await w.refreshJobs();
  } catch (e) {
    w.fail(e);
  } finally {
    agentBusy.value = false;
  }
}
async function create() {
  busy.value = true;
  try {
    await api("/batches", {
      title:
        prompt.value.slice(0, 40) ||
        ({ check: "批量审校", export: "批量交付" } as any)[kind.value] ||
        "批量写作",
      items: items.value.map(({ label, modelLabel, ...item }) => item),
      limits: {
        calls: calls.value || undefined,
        tokens: tokens.value || undefined,
        cost: cost.value || undefined,
      },
    });
    await w.refreshJobs();
    batches.value = await api("/batches");
    creating.value = false;
  } catch (e) {
    w.fail(e);
  } finally {
    busy.value = false;
  }
}
async function control(j: any, action: string) {
  try {
    await api("/jobs/" + j.id + "/" + action, {});
    await w.refreshJobs();
  } catch (e) {
    w.fail(e);
  }
}
async function budgetSave(b: any) {
  try {
    await api(
      "/batches/" + b.id,
      {
        limits: {
          calls: b.limits.calls || undefined,
          tokens: b.limits.tokens || undefined,
          cost: b.limits.cost || undefined,
        },
      },
      "PATCH",
    );
    batches.value = await api("/batches");
  } catch (e) {
    w.fail(e);
  }
}
async function batchState(b: any) {
  await api(
    "/batches/" + b.id,
    { status: b.status === "running" ? "paused" : "running" },
    "PATCH",
  );
  batches.value = await api("/batches");
}
</script>
<template>
  <div class="jobs-panel">
    <section
      v-for="run in agentRuns.slice(0, 1)"
      :key="run.id"
      v-show="!creating"
      class="agent-run"
    >
      <header>
        <div>
          <strong>{{ run.spec.productionMode === "draft" ? "整本初稿" : "故事框架" }}</strong>
          <p>{{ labelStatus(run.status) }}</p>
        </div>
        <span class="grow" />
        <Button
          v-if="['queued', 'running'].includes(run.status)"
          icon="Pause"
          label="暂停"
          variant="ghost"
          @click="control(run, 'pause')"
        />
        <Button
          v-if="run.status === 'paused'"
          icon="Play"
          label="继续"
          variant="ghost"
          @click="control(run, 'resume')"
        />
        <Button
          v-if="run.status === 'failed'"
          icon="RefreshCw"
          label="重试"
          variant="ghost"
          @click="control(run, 'retry')"
        />
        <Button
          v-if="['queued', 'running', 'paused'].includes(run.status)"
          icon="Square"
          label="停止"
          variant="ghost"
          @click="control(run, 'cancel')"
        />
      </header>
      <p class="agent-run-message">
        {{ run.error || run.result?.message || "等待开始" }}
      </p>
      <div class="agent-step-grid">
        <div
          v-for="step in run.result?.orchestration?.steps || []"
          :key="step.key"
          class="agent-step"
          :class="step.status"
        >
          <Icon
            :name="
              step.status === 'completed'
                ? 'CheckCircle2'
                : step.status === 'running'
                  ? 'LoaderCircle'
                  : step.status === 'failed'
                    ? 'AlertCircle'
                    : 'FileText'
            "
            :class="{ spin: step.status === 'running' }"
          />
          <div>
            <strong>{{ step.label }}</strong>
            <p>{{ step.error || step.message || "等待上游结果" }}</p>
          </div>
        </div>
      </div>
    </section>
    <details v-if="agentRuns.length > 1 && !creating" class="agent-history">
      <summary>历史运行 · {{ agentRuns.length - 1 }}</summary>
      <div
        v-for="run in agentRuns.slice(1)"
        :key="run.id"
        class="agent-history-row"
      >
        <span>{{ run.spec.productionMode === "draft" ? "整本初稿" : "故事框架" }}</span>
        <span>{{ labelStatus(run.status) }}</span>
        <time>{{ new Date(run.updated_at).toLocaleString("zh-CN") }}</time>
      </div>
    </details>
    <template v-if="creating"
      ><div class="field-grid">
        <label class="field"
          ><span>操作</span
          ><select v-model="kind">
            <option value="generate">生成或修订</option>
            <option value="check">审校</option>
            <option value="export">导出玩家包</option>
          </select></label
        ><label class="field"
          ><span>范围</span
          ><select v-model="module">
            <option v-for="m in modules" :key="m.id" :value="m.id">
              {{ m.label }}
            </option>
          </select></label
        >
      </div>
      <details>
        <summary>按主题建立项目</summary>
        <label class="field"
          ><span>每行一个主题</span
          ><textarea v-model="themes" rows="3" /></label
        ><label class="field"
          ><span>创作模板</span
          ><select v-model="templateId">
            <option value="">空白项目</option>
            <option v-for="t in templates" :key="t.id" :value="t.id">
              {{ t.title }}
            </option>
          </select></label
        ><Button :disabled="!themes.trim()" @click="createThemes"
          >建立项目</Button
        >
      </details>
      <div class="project-checklist">
        <label v-for="p in w.projects.filter((p) => !p.archived)" :key="p.id"
          ><input v-model="projects" type="checkbox" :value="p.id" />{{
            p.title
          }}</label
        >
      </div>
      <label class="check-field"
        ><input v-model="perObject" type="checkbox" />按对象分别执行</label
      ><label v-if="kind === 'generate'" class="field"
        ><span>要求</span><textarea v-model="prompt" rows="3" />
      </label>
      <div class="field-grid budget-fields">
        <label class="field"
          ><span>调用上限</span
          ><input v-model.number="calls" type="number" min="1" /></label
        ><label class="field"
          ><span>Token上限</span
          ><input v-model.number="tokens" type="number" min="1" /></label
        ><label class="field"
          ><span>金额上限</span
          ><input v-model.number="cost" type="number" min="0" step="any"
        /></label>
      </div>
      <p class="muted">
        {{ !calls && !tokens && !cost ? "未设预算上限 · " : ""
        }}{{ items.length }} 项任务
      </p>
      <ol class="batch-preview">
        <li v-for="(item, i) in items" :key="i">
          {{ item.label
          }}<span v-if="kind === 'generate'" class="muted">
            · {{ item.modelLabel }}</span
          >
        </li>
      </ol>
      <div class="form-actions">
        <Button variant="ghost" @click="creating = false">取消</Button
        ><Button
          variant="primary"
          :busy="busy"
          :disabled="!items.length || (kind === 'generate' && !prompt.trim())"
          @click="create"
          >开始执行</Button
        >
      </div></template
    ><template v-else
      ><div class="surface-tools">
        <span v-if="w.running.length" class="muted"
          >{{ w.running.length }} 项待完成</span
        ><span class="grow" /><Button icon="Plus" @click="creating = true"
          >批量任务</Button
        >
      </div>
      <div v-for="b in batches" :key="b.id" class="batch-row">
        <Icon name="LayoutGrid" /><span>{{ b.title }}</span>
        <details class="batch-budget">
          <summary>预算</summary>
          <div class="budget-fields field-grid">
            <label
              v-for="[k, label] in [
                ['calls', '调用'],
                ['tokens', 'Token'],
                ['cost', '金额'],
              ]"
              :key="k"
              class="field"
              ><span>{{ label }}</span
              ><input v-model.number="b.limits[k]" type="number" min="1"
            /></label>
          </div>
          <Button @click="budgetSave(b)">更新</Button>
        </details>
        <span class="grow" /><Button
          :icon="b.status === 'running' ? 'Pause' : 'Play'"
          :label="b.status === 'running' ? '暂停后续步骤' : '恢复后续步骤'"
          variant="ghost"
          @click="batchState(b).catch(w.fail)"
        />
      </div>
      <div
        v-for="j in w.jobs.filter((job) => job.kind !== 'orchestrate')"
        :key="j.id"
        class="job-row"
      >
        <div class="job-leading">
          <Icon
            :name="
              j.status === 'running'
                ? 'LoaderCircle'
                : j.status === 'completed'
                  ? 'CheckCircle2'
                  : j.status === 'failed'
                    ? 'AlertCircle'
                    : 'FileText'
            "
            :class="{ spin: j.status === 'running' }"
          />
        </div>
        <div class="job-main">
          <button @click="expanded = expanded === j.id ? '' : j.id">
            {{
              j.spec.prompt ||
              ({ check: "检查全本", export: "生成交付文件" } as any)[j.kind] ||
              "生产任务"
            }}
          </button>
          <p>
            {{ w.projects.find((p) => p.id === j.project_id)?.title }} ·
            {{ labelStatus(j.status) }}
          </p>
          <p v-if="j.error" class="error">{{ j.error }}</p>
          <div v-if="expanded === j.id" class="job-details">
            <p v-if="j.result?.model">{{ j.result.model }}</p>
            <p v-if="j.result?.message">{{ j.result.message }}</p>
            <a v-if="j.result?.url" :href="j.result.url">{{
              j.result.fileName
            }}</a>
            <details v-if="j.result?.candidate">
              <summary>未应用的候选内容</summary>
              <pre>{{ j.result.candidate }}</pre>
            </details>
          </div>
        </div>
        <div class="job-actions">
          <Button
            v-if="['queued', 'running'].includes(j.status)"
            icon="Pause"
            label="暂停"
            variant="ghost"
            @click="control(j, 'pause')"
          /><Button
            v-if="['queued', 'running', 'paused'].includes(j.status)"
            icon="Square"
            label="停止"
            variant="ghost"
            @click="control(j, 'cancel')"
          /><Button
            v-if="j.status === 'paused' && !j.error?.includes('依据')"
            icon="Play"
            label="继续"
            variant="ghost"
            @click="control(j, 'resume')"
          /><Button
            v-if="['failed', 'cancelled', 'paused'].includes(j.status)"
            icon="RefreshCw"
            label="按最新版本重试"
            variant="ghost"
            @click="control(j, 'retry')"
          />
        </div>
      </div>
      <p v-if="!w.jobs.length" class="empty-note">暂无任务</p></template
    >
  </div>
</template>
