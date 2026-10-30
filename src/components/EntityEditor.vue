<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick, computed } from "vue";
import { useWorkspace } from "../store";
import {
  definitions,
  plain,
  newEntity,
  type Entity,
  type RichNode,
} from "../../shared/domain";
import DocumentEditor from "./DocumentEditor.vue";
import Button from "./Button.vue";
import Icon from "./Icon.vue";
const props = defineProps<{ entity: Entity }>();
const emit = defineEmits<{
  selection: [{ blockId: string; text: string } | undefined];
}>();
const w = useWorkspace();
const draft = ref<Entity>(JSON.parse(JSON.stringify(props.entity)));
const refQuery=ref(""), showRefs=ref(false);
const dirty = ref(false),
  saving = ref(false),
  error = ref(""),
  details = ref(false),
  baseRevision = ref(w.project!.revision),
  blocked = ref(false);
let loading = false,
  timer: ReturnType<typeof setTimeout> | undefined;
const noteSelection = ref<{ blockId: string; text: string }>(),
  note = ref("");
async function annotate() {
  if (!noteSelection.value || !note.value.trim()) return;
  try {
    const e = newEntity("annotation", props.entity.title + " · 批注");
    e.refs = [props.entity.id];
    e.fields = {
      blockId: noteSelection.value.blockId,
      quote: noteSelection.value.text,
      comment: note.value,
      resolution: "未处理",
    };
    await w.apply([{ type: "create_entity", entity: e }], "添加段落批注");
    note.value = "";
    noteSelection.value = undefined;
  } catch (e) {
    w.fail(e);
  }
}
function intent(text: string) {
  w.composeIntent = text;
}
const key = () => `draft:${w.projectId}:${props.entity.id}`;
const readonly = computed(
  () => props.entity.locked || props.entity.status === "ready",
);
async function load() {
  loading = true;
  error.value = "";
  blocked.value = false;
  const saved = localStorage.getItem(key());
  if (saved) {
    try {
      const d = JSON.parse(saved);
      draft.value = d.value;
      baseRevision.value = d.baseRevision;
      dirty.value = true;
    } catch {
      draft.value = JSON.parse(JSON.stringify(props.entity));
      dirty.value = false;
    }
  } else {
    draft.value = JSON.parse(JSON.stringify(props.entity));
    baseRevision.value = w.project!.revision;
    dirty.value = false;
  }
  await nextTick();
  loading = false;
}
watch(
  () => props.entity.id,
  () => {
    clearTimeout(timer);
    void load();
  },
  { immediate: true },
);
watch(
  () => props.entity,
  (e) => {
    if (!dirty.value && !saving.value) {
      loading = true;
      draft.value = JSON.parse(JSON.stringify(e));
      baseRevision.value = w.project!.revision;
      nextTick(() => (loading = false));
    }
  },
  { deep: true },
);
watch(
  draft,
  () => {
    if (loading) return;
    dirty.value = true;
    localStorage.setItem(
      key(),
      JSON.stringify({ value: draft.value, baseRevision: baseRevision.value }),
    );
    clearTimeout(timer);
    if (!readonly.value && !blocked.value)
      timer = setTimeout(() => void save(), 1200);
  },
  { deep: true },
);
async function save() {
  if (saving.value || !dirty.value) return;
  saving.value = true;
  error.value = "";
  const captured = JSON.parse(JSON.stringify(draft.value)),
    saveKey = key();
  try {
    const result = await w.apply(
      [
        {
          type: "update_entity",
          entityId: captured.id,
          changes: {
            title: captured.title,
            fields: captured.fields,
            refs: captured.refs,
            body:
              captured.kind === "source" && captured.fileId
                ? undefined
                : captured.body,
            audience: captured.audience,
            stale: false,
          },
        },
      ],
      "编辑 " + captured.title,
      baseRevision.value,
      { module: w.moduleId, entityIds: [captured.id] },
    );
    if (key() !== saveKey) return;
    if (result.change.status === "applied") {
      baseRevision.value = result.project.revision;
      if (JSON.stringify(draft.value) === JSON.stringify(captured)) {
        dirty.value = false;
        localStorage.removeItem(key());
      } else
        localStorage.setItem(
          key(),
          JSON.stringify({
            value: draft.value,
            baseRevision: baseRevision.value,
          }),
        );
    } else {
      blocked.value = true;
      error.value = "修改已保留，请在版本记录中审阅冲突。";
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
    if (
      dirty.value &&
      !blocked.value &&
      !error.value &&
      key() === saveKey &&
      !readonly.value
    ) {
      clearTimeout(timer);
      timer = setTimeout(() => void save(), 1200);
    }
  }
}
function toggleRef(eid: string) {
  if (readonly.value) return;
  draft.value.refs = draft.value.refs.includes(eid)
    ? draft.value.refs.filter((x) => x !== eid)
    : [...draft.value.refs, eid];
}
async function discard() {
  localStorage.removeItem(key());
  dirty.value = false;
  await load();
}
onBeforeUnmount(() => {
  clearTimeout(timer);
});
defineExpose({ save, dirty });
</script>
<template>
  <div class="entity-editor">
    <div v-if="dirty || error" class="draft-bar">
      <span :class="{ error: !!error }">{{
        error || (saving ? "正在保存" : "本地草稿已保留")
      }}</span
      ><span class="grow" /><Button v-if="!saving" icon="Save" @click="save">{{
        readonly ? "提交修订" : "保存"
      }}</Button
      ><Button v-if="blocked" variant="ghost" @click="discard"
        >采用当前版本</Button
      >
    </div>
    <template v-if="entity.kind === 'document'"
      ><div class="manuscript-meta">
        <span
          >{{ draft.fields.pov || "第二人称" }} ·
          {{ plain(draft.body).replace(/\s/g, "").length }} 字</span
        ><Button
          icon="SlidersHorizontal"
          variant="ghost"
          @click="details = !details"
          >写作约束</Button
        >
      </div>
      <div v-if="details" class="details-panel">
        <div class="field-grid">
          <label
            v-for="f in definitions[entity.kind].fields"
            :key="f.key"
            class="field"
            ><span>{{ f.label }}</span
            ><select
              v-if="f.type === 'select'"
              v-model="draft.fields[f.key]"
              :disabled="readonly"
            >
              <option value="">未指定</option>
              <option v-for="o in f.options" :key="o">{{ o }}</option></select
            ><textarea
              v-else-if="f.type === 'long'"
              v-model="draft.fields[f.key]"
              :disabled="readonly"
              rows="3" /><input
              v-else
              v-model="draft.fields[f.key]"
              :disabled="readonly"
              :type="f.type === 'number' ? 'number' : 'text'"
          /></label>
        </div>
      </div>
      <div class="manuscript">
        <input
          class="manuscript-title"
          v-model="draft.title"
          aria-label="正文标题"
          :disabled="readonly"
        /><DocumentEditor
          v-model="draft.body"
          :readonly="readonly"
          @selection="emit('selection', $event)"
          @intent="intent"
          @annotation="noteSelection = $event"
        />
        <div v-if="noteSelection" class="annotation-compose">
          <blockquote>{{ noteSelection.text }}</blockquote>
          <textarea v-model="note" aria-label="段落意见" rows="3" />
          <div class="form-actions">
            <Button @click="noteSelection = undefined">取消</Button
            ><Button
              variant="primary"
              :disabled="!note.trim()"
              @click="annotate"
              >保存批注</Button
            >
          </div>
        </div>
        <div
          v-for="a in w.entities.filter(
            (e) => e.kind === 'annotation' && e.refs.includes(entity.id),
          )"
          :key="a.id"
          class="paragraph-note"
        >
          <button @click="w.selectEntity(a)">{{ a.fields.comment }}</button
          ><span>{{ a.fields.resolution }}</span>
        </div>
      </div></template
    >
    <template v-else
      ><div class="entity-form">
        <label class="field title-field"
          ><span>名称</span><input v-model="draft.title" :disabled="readonly"
        /></label>
        <div class="field-grid">
          <label
            v-for="f in definitions[entity.kind].fields.filter(
              (f) => f.key !== 'checkKey',
            )"
            :key="f.key"
            class="field"
            :class="{ 'full-width': f.type === 'long' }"
            ><span>{{ f.label }}</span
            ><select
              v-if="f.type === 'select'"
              v-model="draft.fields[f.key]"
              :disabled="readonly"
            >
              <option value="">未指定</option>
              <option v-for="o in f.options" :key="o">{{ o }}</option></select
            ><textarea
              v-else-if="f.type === 'long'"
              v-model="draft.fields[f.key]"
              :disabled="readonly"
              rows="3" /><input
              v-else
              v-model="draft.fields[f.key]"
              :disabled="readonly"
              :type="f.type === 'number' ? 'number' : 'text'"
          /></label>
        </div>
        <div v-if="entity.fileId" class="source-origin">
          <Icon name="FileText" /><a :href="'/api/files/' + entity.fileId"
            >下载原文件</a
          >
        </div>
        <DocumentEditor
          v-model="draft.body"
          :readonly="readonly || !!(entity.kind === 'source' && entity.fileId)"
          compact
          @selection="emit('selection', $event)"
        /></div
    ></template>
    <div class="entity-links">
      <div class="inline-heading">
        <Icon name="Link" /><span>关联</span><span class="grow" /><label
          class="inline-field"
          ><span>受众</span
          ><select v-model="draft.audience" :disabled="readonly">
            <option value="player">玩家</option>
            <option value="npc">NPC</option>
            <option value="dm">主持</option>
            <option value="author">作者</option>
          </select></label
        >
      </div>
      <Button variant="ghost" @click="showRefs=!showRefs">管理关联</Button>
      <input v-if="showRefs" v-model="refQuery" placeholder="查找人物、幕或场景" aria-label="查找关联对象"/>
      <div class="linked-objects">
        <button
          v-for="other in w.entities.filter(
            (e) => e.id !== entity.id && e.kind !== 'issue' && (draft.refs.includes(e.id)||(showRefs && e.title.includes(refQuery))),
          )"
          :key="other.id"
          class="tag"
          :class="{ chosen: draft.refs.includes(other.id) }"
          :aria-pressed="draft.refs.includes(other.id)"
          :disabled="readonly"
          @click="toggleRef(other.id)"
        >
          {{ other.title
          }}<Icon
            v-if="draft.refs.includes(other.id)"
            name="Check"
            :size="13"
          /></button
        ><span v-if="w.entities.length < 2" class="muted">暂无其他对象</span>
      </div>
    </div>
  </div>
</template>
