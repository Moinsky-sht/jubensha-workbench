<script setup lang="ts">
import { computed, ref } from "vue";
import { useWorkspace, api } from "../store";
import {
  modules,
  definitions,
  plain,
  newEntity,
  moduleFor,
  labelStatus,
  type Entity,
  type Kind,
} from "../../shared/domain";
import Button from "./Button.vue";
import Icon from "./Icon.vue";
import EntityEditor from "./EntityEditor.vue";
const entityEditor = ref<InstanceType<typeof EntityEditor>>();
defineExpose({ save: () => entityEditor.value?.save() });
const w = useWorkspace();
const emit = defineEmits(["create", "import", "selection"]);
const view = ref("list");
const all = computed(() =>
  w.entities
    .filter((e) =>
      (
        (modules.find((m) => m.id === w.moduleId)
          ?.kinds as readonly string[]) || []
      ).includes(e.kind),
    )
    .sort((a, b) => a.order - b.order),
);
const characters = computed(() =>
  w.entities.filter((e) => e.kind === "character"),
);
const acts = computed(() =>
  w.entities.filter((e) => e.kind === "act").sort((a, b) => a.order - b.order),
);
const drag = ref("");
const positioned = computed(() =>
  characters.value.map((e, i) => ({
    e,
    x:
      390 +
      Math.cos(
        (i / Math.max(1, characters.value.length)) * Math.PI * 2 - Math.PI / 2,
      ) *
        230,
    y:
      260 +
      Math.sin(
        (i / Math.max(1, characters.value.length)) * Math.PI * 2 - Math.PI / 2,
      ) *
        180,
  })),
);
const relationships = computed(() =>
  w.entities
    .filter((e) => e.kind === "relationship")
    .map((e) => ({
      e,
      a: positioned.value.find((p) => p.e.id === e.refs[0]),
      b: positioned.value.find((p) => p.e.id === e.refs[1]),
    }))
    .filter((x) => x.a && x.b),
);
function open(e: Entity) {
  w.selectModule(moduleFor(e.kind));
  w.selectEntity(e);
}
async function drop(target: Entity) {
  const rows = all.value.filter((e) => e.kind === target.kind);
  const from = rows.findIndex((e) => e.id === drag.value),
    to = rows.findIndex((e) => e.id === target.id);
  if (from < 0 || to < 0 || from === to) return;
  const [e] = rows.splice(from, 1);
  rows.splice(to, 0, e);
  try {
    await w.apply(
      [{ type: "reorder", entityIds: rows.map((e) => e.id) }],
      "调整" + definitions[target.kind].label + "顺序",
    );
  } catch (e) {
    w.fail(e);
  }
}
async function cell(character: Entity, act: Entity) {
  const existing = w.entities.find(
    (e) =>
      e.kind === "document" &&
      e.refs.includes(character.id) &&
      e.refs.includes(act.id),
  );
  if (existing) {
    open(existing);
    return;
  }
  const d = newEntity("document", character.title + " · " + act.title);
  d.refs = [character.id, act.id];
  try {
    await w.apply([{ type: "create_entity", entity: d }], "建立角色正文");
    w.selectModule("writing");
    w.selectEntity(d);
  } catch (e) {
    w.fail(e);
  }
}
async function semanticReview() {
  try {
    await api("/jobs", {
      projectId: w.projectId,
      kind: "generate",
      scope: { module: "review" },
      prompt:
        "审读本项目中的设定冲突、提前剧透、因果断裂、情节增添、角色边缘化及人物认知混淆。只新增issue，不改正文。每个问题给出正文段落编号、原文证据、关联对象、具体修复建议；推断写入程度“待审”，不能伪称确定错误。不重复已修复或有意保留的问题。未取得的原文先使用reads读取。",
    });
    await w.refreshJobs();
  } catch (e) {
    w.fail(e);
  }
}
async function check() {
  try {
    await api("/jobs", {
      projectId: w.projectId,
      kind: "check",
      scope: { module: "review", projectWide: true },
    });
    await w.refreshJobs();
  } catch (e) {
    w.fail(e);
  }
}
</script>
<template>
  <EntityEditor
    ref="entityEditor"
    v-if="w.entity"
    :key="w.entity.id"
    :entity="w.entity"
    @selection="emit('selection', $event)"
  />
  <div v-else class="module-surface">
    <div v-if="all.length || w.moduleId === 'review'" class="surface-tools">
      <div class="segmented">
        <template v-if="w.moduleId === 'characters'"
          ><button :class="{ active: view !== 'graph' }" @click="view = 'list'">
            目录</button
          ><button
            :class="{ active: view === 'graph' }"
            @click="view = 'graph'"
          >
            关系
          </button></template
        ><template v-else-if="w.moduleId === 'structure'"
          ><button
            :class="{ active: view !== 'matrix' }"
            @click="view = 'list'"
          >
            场景</button
          ><button
            :class="{ active: view === 'matrix' }"
            @click="view = 'matrix'"
          >
            幕表
          </button></template
        ><span v-else class="muted">{{ all.length }} 项</span>
      </div>
      <span class="grow" /><Button
        v-if="w.moduleId === 'sources'"
        icon="Upload"
        @click="emit('import')"
        >导入</Button
      ><Button v-if="w.moduleId === 'review'" icon="ScanLine" @click="check"
        >规则检查</Button
      ><Button
        v-if="w.moduleId === 'review'"
        icon="Sparkles"
        @click="semanticReview"
        >语义审读</Button
      ><Button
        v-if="all.length"
        icon="Plus"
        variant="ghost"
        @click="emit('create')"
        >新增</Button
      >
    </div>
    <div v-if="!all.length" class="empty-state">
      <Icon
        :name="modules.find((m) => m.id === w.moduleId)?.icon || 'Feather'"
        :size="36"
      /><Button
        :icon="w.moduleId === 'sources' ? 'Upload' : 'Plus'"
        @click="emit(w.moduleId === 'sources' ? 'import' : 'create')"
        >{{
          w.moduleId === "sources"
            ? "导入第一份素材"
            : "添加" +
              definitions[
                (modules.find((m) => m.id === w.moduleId)?.kinds[0] ||
                  "concept") as Kind
              ].label
        }}</Button
      >
    </div>
    <svg
      v-else-if="w.moduleId === 'characters' && view === 'graph'"
      class="relation-graph"
      viewBox="0 0 780 520"
      role="img"
      aria-label="人物关系图"
    >
      <g
        v-for="r in relationships"
        :key="r.e.id"
        class="relation-edge"
        role="button"
        tabindex="0"
        :aria-label="r.e.title"
        @click="open(r.e)"
        @keydown.enter="open(r.e)"
      >
        <line :x1="r.a!.x" :y1="r.a!.y" :x2="r.b!.x" :y2="r.b!.y" />
        <text
          :x="(r.a!.x + r.b!.x) / 2"
          :y="(r.a!.y + r.b!.y) / 2 - 10"
          text-anchor="middle"
        >
          {{ r.e.title }}
        </text>
      </g>
      <g
        v-for="{ e, x, y } in positioned"
        :key="e.id"
        role="button"
        tabindex="0"
        :aria-label="e.title"
        @click="open(e)"
        @keydown.enter="open(e)"
      >
        <circle :cx="x" :cy="y" r="42" />
        <text :x="x" :y="y + 6" text-anchor="middle">{{ e.title }}</text>
      </g>
    </svg>
    <div
      v-else-if="w.moduleId === 'structure' && view === 'matrix'"
      class="matrix-wrap"
    >
      <table class="matrix">
        <thead>
          <tr>
            <th>人物</th>
            <th v-for="a in acts" :key="a.id">{{ a.title }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in characters" :key="c.id">
            <th>{{ c.title }}</th>
            <td v-for="a in acts" :key="a.id">
              <button @click="cell(c, a)">
                {{
                  w.entities.find(
                    (e) =>
                      e.kind === "document" &&
                      e.refs.includes(c.id) &&
                      e.refs.includes(a.id),
                  )
                    ? "打开正文"
                    : "开始写作"
                }}<Icon name="ArrowRight" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!characters.length || !acts.length" class="muted">
        添加人物与幕后，可在交叉位置建立正文。
      </p>
    </div>
    <div
      v-else
      :class="[
        'entity-collection',
        {
          'concept-grid': w.moduleId === 'concept',
          'timeline-list':
            w.moduleId === 'performance' || w.moduleId === 'structure',
        },
      ]"
    >
      <article
        v-for="(e, index) in all"
        :key="e.id"
        class="entity-card"
        :class="[e.kind, { stale: e.stale }]"
        :draggable="['act', 'scene', 'performance'].includes(e.kind)"
        @dragstart="drag = e.id"
        @dragover.prevent
        @drop.prevent="drop(e)"
      >
        <button class="card-main" @click="open(e)">
          <div class="card-eyebrow">
            <span>{{
              e.kind === "performance"
                ? `${e.fields.start || 0}′ — ${Number(e.fields.start || 0) + Number(e.fields.duration || 0)}′`
                : definitions[e.kind].label
            }}</span
            ><span v-if="e.stale" class="warning">需复核</span
            ><span v-else class="status-dot" :class="e.status">{{
              labelStatus(e.status)
            }}</span>
          </div>
          <h2>{{ e.title }}</h2>
          <p>
            {{
              e.fields.conflict ||
              e.fields.desire ||
              e.fields.goal ||
              e.fields.rule ||
              e.fields.truth ||
              e.fields.evidence ||
              e.fields.entry ||
              plain(e.body).slice(0, 130) ||
              "尚未填写"
            }}
          </p>
          <div v-if="e.kind === 'concept'" class="concept-bottom">
            <span>{{ e.fields.players || "—" }} 人</span
            ><span>{{ e.fields.minutes || "—" }} 分钟</span
            ><span>{{ e.fields.genre || "题材待定" }}</span>
          </div>
          <div v-else-if="e.refs.length" class="card-links">
            {{
              e.refs
                .map((r) => w.entities.find((x) => x.id === r)?.title)
                .filter(Boolean)
                .slice(0, 3)
                .join(" · ")
            }}
          </div></button
        ><Icon name="ArrowRight" class="card-arrow" :size="17" />
      </article>
    </div>
  </div>
</template>
