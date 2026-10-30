<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api, useWorkspace } from "../store";
import Button from "./Button.vue";
const w = useWorkspace(),
  state = ref<any>({ models: [] }),
  query = ref(""),
  busy = ref(""),
  error = ref(""),
  retrieval = ref<any>();
const connections = computed(() =>
  w.connections.filter(
    (c) =>
      c.managed === "ark" &&
      [c.name, c.model]
        .join(" ")
        .toLowerCase()
        .includes(query.value.toLowerCase()),
  ),
);
const health = (id: string) =>
  state.value.models.find((m: any) => m.id === id)?.health;
async function load() {
  state.value = await api("/providers/ark");
  if (w.projectId)
    retrieval.value = await api("/projects/" + w.projectId + "/retrieval");
}
onMounted(() => load().catch(w.fail));
async function run(action: string, id?: string) {
  busy.value = id || action;
  error.value = "";
  try {
    if (action === "sync") {
      await api("/providers/ark/sync", {});
      await w.loadConnections();
    } else if (action === "switch")
      await api(
        "/providers/ark",
        { autoSwitch: state.value.autoSwitch },
        "PATCH",
      );
    else if (action === "probe")
      await api("/providers/ark/probe", { connectionId: id });
    else if (action === "index")
      await api("/projects/" + w.projectId + "/retrieval/index", {});
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = "";
  }
}
async function choose(id: string) {
  try {
    await api("/settings", { defaultModel: id }, "PATCH");
    await w.loadConnections();
  } catch (e) {
    w.fail(e);
  }
}
</script>
<template>
  <section class="provider-catalog">
    <div class="form-actions">
      <strong>火山方舟</strong><span class="grow" /><Button
        :busy="busy === 'sync'"
        @click="run('sync')"
        >同步目录</Button
      >
    </div>
    <p v-if="!state.configured" class="muted">服务端尚未预置连接。</p>
    <template v-else>
      <div class="form-actions">
        <label
          ><input
            v-model="state.autoSwitch"
            type="checkbox"
            @change="run('switch')"
          />
          故障时切换模型</label
        ><span class="grow" /><span class="muted"
          >{{ state.models.length }} 个文本模型</span
        >
      </div>
      <label class="search-input"
        ><input v-model="query" aria-label="筛选模型" placeholder="名称或标识"
      /></label>
      <div class="catalog-list">
        <div v-for="c in connections" :key="c.id" class="connection-row">
          <div>
            <strong>{{ c.name }}</strong
            ><small class="muted" :title="health(c.model)?.error">{{
              health(c.model)?.status === "healthy"
                ? "可用"
                : health(c.model)?.status === "unavailable"
                  ? "本次测试未通过"
                  : "尚未测试"
            }}</small>
          </div>
          <span class="grow" />
          <Button
            :busy="busy === c.id"
            variant="ghost"
            @click="run('probe', c.id)"
            >测试</Button
          ><Button
            :disabled="w.settings.defaultModel === c.id"
            @click="choose(c.id)"
            >{{
              w.settings.defaultModel === c.id ? "默认" : "设为默认"
            }}</Button
          >
        </div>
      </div>
    </template>
    <p v-if="error || state.error" class="error">{{ error || state.error }}</p>
    <details v-if="retrieval" class="retrieval-settings">
      <summary>项目检索</summary>
      <p>
        {{ retrieval.configured ? retrieval.model : "原文匹配" }} ·
        {{ retrieval.indexed || 0 }} 段已索引
      </p>
      <p v-if="retrieval.state?.error" class="error">
        {{ retrieval.state.error }}
      </p>
      <div class="form-actions">
        <span class="muted">{{
          (
            {
              ready: "已同步",
              pending: "等待更新",
              indexing: "正在索引",
            } as any
          )[retrieval.state?.status] || "等待首轮索引"
        }}</span
        ><span class="grow" /><Button
          :disabled="!retrieval.configured"
          :busy="busy === 'index'"
          @click="run('index')"
          >更新索引</Button
        >
      </div>
    </details>
  </section>
</template>
<style scoped>
.provider-catalog {
  margin-bottom: 24px;
}
.catalog-list {
  max-height: 360px;
  overflow: auto;
}
.connection-row small {
  display: block;
  margin-top: 4px;
}
.search-input {
  margin: 12px 0;
}
.retrieval-settings {
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
summary {
  cursor: pointer;
}
.catalog-list .connection-row {
  min-height: 64px;
}
</style>
