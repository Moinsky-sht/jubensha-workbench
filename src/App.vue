<script setup lang="ts">
import {
  computed,
  ref,
  onMounted,
  watch,
  onBeforeUnmount,
  nextTick,
} from "vue";
import { useWorkspace, api } from "./store";
import {
  modules,
  definitions,
  newEntity,
  moduleFor,
  labelStatus,
  plain,
  type Entity,
  type Kind,
  type Change,
  type Operation,
} from "../shared/domain";
import Button from "./components/Button.vue";
import Icon from "./components/Icon.vue";
import Dialog from "./components/Dialog.vue";
import StorySurface from "./components/StorySurface.vue";
import StoryMap from "./components/StoryMap.vue";
import { coverage } from "../shared/story";
import ModuleSurface from "./components/ModuleSurface.vue";
import ChatPanel from "./components/ChatPanel.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import JobsPanel from "./components/JobsPanel.vue";
import DeliveryPanel from "./components/DeliveryPanel.vue";
const modulePanel = ref<InstanceType<typeof ModuleSurface>>();
const rawOperations = ref(""),
  reviewError = ref("");
const templates = ref<any[]>([]),
  templateId = ref("");
const w = useWorkspace(),
  auth = ref<{ configured: boolean; authenticated: boolean } | null>(null),
  username = ref("admin"),
  password = ref(""),
  passwordRepeat = ref(""),
  authError = ref(""),
  loading = ref(true),
  authBusy = ref(false),
  modal = ref(""),
  newTitle = ref(""),
  newBrief = ref(""),
  newGenre = ref("情感"),
  newPlayers = ref(6),
  newMinutes = ref(240),
  newProduction = ref<"draft" | "outline" | "manual">("draft"),
  newKind = ref<Kind>("concept"),
  creating = ref(false),
  library = ref(false),
  showArchived = ref(false),
  libraryQuery = ref(""),
  search = ref(""),
  searchResults = ref<any[]>([]),
  sidebar = ref(
    localStorage.getItem("sidebar")
      ? localStorage.getItem("sidebar") !== "closed"
      : window.innerWidth > 760,
  ),
  chatOpen = ref(localStorage.getItem("chat") !== "closed"),
  mobileTab = ref("content"),
  theme = ref(localStorage.getItem("theme") || "system"),
  sidebarWidth=ref(Number(localStorage.getItem("sidebar-width")||240)),
  chatWidth = ref(Number(localStorage.getItem("chatWidth") || 400)),
  selection = ref<{ blockId: string; text: string }>(),
  review = ref<Change>(),
  versions = ref<any[]>([]),
  snapshot = ref<any>(),
  rawVisible = ref(false),
  upload = ref<HTMLInputElement>(),
  uploadBusy = ref(false),
  candidates = ref<Entity[]>([]),
  pickedCandidates = ref<string[]>([]),
  entityToDelete = ref<Entity>();
watch(()=>w.pendingAnchor,anchor=>{if(anchor)mobileTab.value="content";});
const currentModule = computed(() => modules.find((m) => m.id === w.moduleId)!);
const mainSpaces=[{id:"overview",label:"总览",icon:"LayoutGrid"},{id:"story",label:"故事",icon:"BookOpen"},{id:"materials",label:"资料",icon:"Files"},{id:"rehearsal",label:"试跑",icon:"Theater"},{id:"delivery",label:"交付",icon:"PackageCheck"}];
const materialModules=computed(()=>modules.filter(m=>!["writing","structure","performance","delivery"].includes(m.id)));
function resizeSidebar(event:PointerEvent){const start=event.clientX,width=sidebarWidth.value;const move=(e:PointerEvent)=>sidebarWidth.value=Math.max(200,Math.min(340,width+e.clientX-start));const end=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",end);localStorage.setItem("sidebar-width",String(sidebarWidth.value));};window.addEventListener("pointermove",move);window.addEventListener("pointerup",end);}
function selectSpace(id:string) {
  library.value=false;
  if(id==="story")w.selectModule("writing");
  if(id==="rehearsal")w.selectModule("performance");
  if(id==="delivery")w.selectModule("delivery");
  if(id==="materials")w.selectModule("sources");
  w.selectEntity();w.surface=id;w.readMode="read";
}
function selectStoryView(id:"story"|"canvas") { library.value=false;w.selectModule("writing");w.selectEntity();w.surface=id;w.readMode="read"; }
const rows = computed(() =>
  w.entities.filter(e=>w.surface==="story"||w.surface==="canvas"?["character","act","document"].includes(e.kind):w.surface==="overview"?false:w.surface==="rehearsal"?["performance","playtest"].includes(e.kind)||(e.kind==="object"&&e.audience==="dm"):(currentModule.value.kinds as readonly string[]).includes(e.kind))
  .sort((a,b)=>a.order-b.order));
const filteredProjects = computed(() =>
  w.projects.filter(
    (p) =>
      p.archived === showArchived.value && p.title.includes(libraryQuery.value),
  ),
);
const pending = computed(() => w.changes.filter((c) => c.status === "pending"));
document.documentElement.style.setProperty(
  "--reading-size",
  (localStorage.getItem("readingSize") || 18) + "px",
);
document.documentElement.style.setProperty(
  "--reading-font",
  localStorage.getItem("readingFont") === "sans"
    ? "sans-serif"
    : "var(--font-body)",
);
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  document.documentElement.dataset.theme =
    theme.value === "system"
      ? systemTheme.matches
        ? "dark"
        : "light"
      : theme.value;
  localStorage.setItem("theme", theme.value);
}
watch(theme, applyTheme, { immediate: true });
systemTheme.addEventListener("change", applyTheme);
watch(sidebar, (v) => localStorage.setItem("sidebar", v ? "open" : "closed"));
watch(chatOpen, (v) => localStorage.setItem("chat", v ? "open" : "closed"));
onMounted(async () => {
  try {
    auth.value = await api("/auth/status");
    if (auth.value?.authenticated) {
      await w.refresh();
      library.value = !w.project;
      w.connectEvents();
    }
  } catch (e) {
    authError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
});
async function login() {
  authError.value = "";
  if (!auth.value?.configured && password.value !== passwordRepeat.value) {
    authError.value = "两次密码不一致";
    return;
  }
  authBusy.value = true;
  try {
    await api("/auth/" + (auth.value?.configured ? "login" : "setup"), {
      username: username.value,
      password: password.value,
    });
    password.value = "";
    passwordRepeat.value = "";
    auth.value = { configured: true, authenticated: true };
    await w.refresh();
    library.value = !w.project;
    w.connectEvents();
  } catch (e) {
    authError.value = e instanceof Error ? e.message : String(e);
  } finally {
    authBusy.value = false;
  }
}
const scrollPanel = ref<HTMLElement>();
let priorScope = "";
function rememberScroll() {
  if (priorScope && scrollPanel.value)
    localStorage.setItem(
      "scroll:" + priorScope,
      String(scrollPanel.value.scrollTop),
    );
}
watch(
  () => w.projectId+":"+w.surface+":"+w.moduleId+":"+(w.entity?.id||""),
  async (scope) => {
    rememberScroll();
    priorScope = scope;
    try {
      selection.value =
        JSON.parse(localStorage.getItem("selection:" + scope) || "null") ||
        undefined;
    } catch {
      selection.value = undefined;
    }
    await nextTick();
    if (scrollPanel.value)
      scrollPanel.value.scrollTop = Number(
        localStorage.getItem("scroll:" + scope) || 0,
      );
  },
  { immediate: true },
);
watch(
  selection,
  (v) =>
    localStorage.setItem("selection:" + priorScope, JSON.stringify(v || null)),
  { deep: true },
);
function switchModule(id: any) {
  w.selectModule(id);
  selection.value = undefined;
  mobileTab.value = "content";
  library.value = false;
  if (window.innerWidth <= 760) sidebar.value = false;
}
function chooseEntity(e: Entity) {
  const priorSurface=w.surface;
  w.selectModule(moduleFor(e.kind));
  w.selectEntity(e);
  if(priorSurface==="rehearsal")w.surface="rehearsal";
  w.readMode="read";
  selection.value = undefined;
  mobileTab.value = "content";
  library.value = false;
  if (window.innerWidth <= 760) sidebar.value = false;
}
function mentionEntity(e: Entity) {
  w.globalChat = true;
  w.mentionIntent=[e.id];

  chatOpen.value = true;
  mobileTab.value = "chat";
}
async function projectCreate(demo = false) {
  creating.value = true;
  try {
    if (!demo) {
      const brief = [
        `题材：${newGenre.value}`,
        `玩家：${newPlayers.value}人`,
        `预计时长：${newMinutes.value}分钟`,
        newBrief.value.trim(),
      ].join("\n");
      const title =
        newTitle.value.trim() ||
        newBrief.value.trim().replace(/[。！？\n].*$/s, "").slice(0, 24) ||
        "未命名剧本";
      const p = await api("/projects", {
        title,
        description: brief,
        templateId: templateId.value || undefined,
      });
      w.setProject(p);
      await w.openProject(p.id);
      w.selectModule("concept");
      w.surface="overview";
      if (newProduction.value !== "manual") {
        await api("/projects/"+p.id+"/turns",{message:brief,mode:"directions"});
        await Promise.all([w.refreshJobs(),w.refreshDetails()]);
      }
      modal.value="";
    } else {
      await w.create(newTitle.value || "未命名剧本", true);
      modal.value = "";
    }
    newTitle.value = "";
    newBrief.value = "";
    library.value = false;
  } catch (e) {
    w.fail(e);
  } finally {
    creating.value = false;
  }
}
watch(modal, async (v) => {
  if (v === "project") {
    templates.value = await api("/templates");
    templateId.value = "";
    newGenre.value = "情感";
    newPlayers.value = 6;
    newMinutes.value = 240;
    newProduction.value = "draft";
  }
});
function showCreate() {
  newKind.value = (currentModule.value.kinds[0] || "concept") as Kind;
  newTitle.value = "";
  modal.value = "create";
}
async function createEntity() {
  creating.value = true;
  try {
    const e = newEntity(
      newKind.value,
      newTitle.value.trim() || definitions[newKind.value].label,
    );
    await w.apply(
      [{ type: "create_entity", entity: e }],
      "新增" + definitions[newKind.value].label,
    );
    w.selectModule(moduleFor(e.kind));
    w.selectEntity(e);
    modal.value = "";
  } catch (e) {
    w.fail(e);
  } finally {
    creating.value = false;
  }
}
async function lock() {
  if (!w.entity) return;
  try {
    await w.apply(
      [{ type: "set_lock", entityId: w.entity.id, locked: !w.entity.locked }],
      w.entity.locked ? "解除锁定" : "锁定内容",
    );
  } catch (e) {
    w.fail(e);
  }
}
async function approve() {
  if (!w.entity) return;
  try {
    await modulePanel.value?.save();
    if (localStorage.getItem("draft:" + w.projectId + ":" + w.entity.id))
      throw new Error("请先处理当前草稿的保存问题");
    await w.apply(
      [
        {
          type: "update_entity",
          entityId: w.entity.id,
          changes: {
            status: w.entity.status === "ready" ? "draft" : "ready",
            stale: false,
          },
        },
      ],
      w.entity.status === "ready" ? "恢复草稿" : "标记定稿",
    );
  } catch (e) {
    w.fail(e);
  }
}
async function remove() {
  if (!entityToDelete.value) return;
  try {
    await w.apply(
      [{ type: "delete_entity", entityId: entityToDelete.value.id }],
      "移除 " + entityToDelete.value.title,
    );
    w.selectEntity();
    modal.value = "";
    entityToDelete.value = undefined;
  } catch (e) {
    w.fail(e);
  }
}
async function importFiles(files: FileList | null) {
  if (!files?.length) return;
  uploadBusy.value = true;
  try {
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      const result = await api("/projects/" + w.projectId + "/import", form);
      w.setProject(result.project);
      const e = result.project.data.entities.at(-1);
      w.selectModule("sources");
      w.selectEntity(e);
      if (e.kind === "source") {
        const suggestions = await api<Entity[]>(
          "/projects/" + w.projectId + "/sources/" + e.id + "/candidates",
        );
        if (suggestions.length) {
          candidates.value = suggestions;
          pickedCandidates.value = [];
          modal.value = "candidates";
        }
      }
      if (result.needsRecognition)
        w.error = "这份PDF没有可用文字，原文件已保存，需要先做文字识别。";
    }
    await w.refreshDetails();
  } catch (e) {
    w.fail(e);
  } finally {
    uploadBusy.value = false;
    if (upload.value) upload.value.value = "";
  }
}
async function adoptCandidates() {
  try {
    await w.apply(
      candidates.value
        .filter((e) => pickedCandidates.value.includes(e.id))
        .map((entity) => ({ type: "create_entity", entity })),
      "采用素材提炼",
    );
    modal.value = "";
  } catch (e) {
    w.fail(e);
  }
}
async function showHistory() {
  versions.value = await api("/projects/" + w.projectId + "/revisions");
  snapshot.value = undefined;
  modal.value = "history";
}
async function restore() {
  try {
    const r = await api("/projects/" + w.projectId + "/restore", {
      revision: snapshot.value.revision,
      baseRevision: w.project!.revision,
      entityId: w.entity?.id,
    });
    w.setProject(r.project);
    await w.refreshDetails();
    if (r.change.status === "pending") showReview(r.change);
    else modal.value = "";
  } catch (e) {
    w.fail(e);
  }
}
async function applyReviewed() {
  try {
    reviewError.value = "";
    const operations = JSON.parse(rawOperations.value);
    await w.resolve({ ...review.value!, operations }, "apply");
    modal.value = "";
  } catch (e) {
    reviewError.value = e instanceof Error ? e.message : String(e);
  }
}
function showReview(c: Change) {
  rawOperations.value = JSON.stringify(c.operations, null, 2);
  reviewError.value = "";
  review.value = c;
  rawVisible.value = false;
  modal.value = "review";
}
function opTargets(c: Change) {
  const ids = c.operations.flatMap((o) =>
    o.type === "create_entity"
      ? [o.entity.id]
      : o.type === "replace_text"
        ? [o.documentId]
        : o.type === "reorder"
          ? o.entityIds
          : [o.entityId],
  );
  return [...new Set(ids)];
}
function opAfter(c: Change, eid: string) {
  const direct = c.after?.data.entities.find((e) => e.id === eid);
  if (direct) return direct;
  const old = c.before?.data.entities.find((e) => e.id === eid);
  let e = old ? JSON.parse(JSON.stringify(old)) : undefined;
  for (const op of c.operations) {
    if (op.type === "create_entity" && op.entity.id === eid) e = op.entity;
    if (op.type === "update_entity" && op.entityId === eid)
      e = {
        ...e,
        ...op.changes,
        fields: { ...e?.fields, ...op.changes.fields },
      };
    if (op.type === "delete_entity" && op.entityId === eid) return undefined;
    if (op.type === "replace_text" && op.documentId === eid && e)
      e = {
        ...e,
        previewText: plain(e.body).replace(op.expectedText, op.replacement),
      };
  }
  return e;
}
function scopedDiff(c:Change,eid:string,after=false){
 const textOps=c.operations.filter((o:any)=>o.type==="replace_text" && o.documentId===eid) as any[];
 if(textOps.length && textOps.length===c.operations.filter((o:any)=>(o.documentId||o.entityId||o.entity?.id)===eid).length)
   return textOps.map(o=>after?o.replacement:o.expectedText).join("\n\n");
 return diffText(after?opAfter(c,eid):c.before?.data.entities.find(e=>e.id===eid));
}
function diffText(e: any) {
  if (!e) return "（无）";
  return [
    e.title,
    ...Object.entries(e.fields || {})
      .filter(([, v]) => v !== "" && v !== undefined)
      .map(
        ([k, v]) =>
          (definitions[e.kind as Kind]?.fields.find((f) => f.key === k)
            ?.label || k) +
          "：" +
          v,
      ),
    e.previewText ?? plain(e.body),
    e.refs?.length
      ? "关联：" +
        e.refs
          .map(
            (r: string) =>
              w.entities.find((e) => e.id === r)?.title || "已移除对象",
          )
          .join("、")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
const semanticResults = ref<any[]>([]),
  semanticBusy = ref(false),
  semanticWarning = ref("");
async function searchMeaning() {
  if (!w.projectId || !search.value.trim()) return;
  semanticBusy.value = true;
  const q = search.value;
  try {
    const r = await api("/projects/" + w.projectId + "/retrieval/search", {
      query: q,
    });
    if (q === search.value) {
      semanticResults.value = r.hits;
      semanticWarning.value = r.warning;
    }
  } catch (e) {
    w.fail(e);
  } finally {
    semanticBusy.value = false;
  }
}
function openHit(hit: any) {
  const e = w.entities.find((e) => e.id === hit.entityId);
  if (e) {
    w.selectModule(moduleFor(e.kind));
    w.selectEntity(e);
    library.value = false;
    modal.value = "";
  }
}
watch(search, async (q) => {
  semanticResults.value = [];
  semanticWarning.value = "";
  if (q.trim()) {
    try {
      const r = await api("/search?q=" + encodeURIComponent(q));
      if (q === search.value) searchResults.value = r;
    } catch (e) {
      w.fail(e);
    }
  } else searchResults.value = [];
});
function resize(e: PointerEvent) {
  const start = e.clientX,
    width = chatWidth.value;
  const move = (ev: PointerEvent) => {
    chatWidth.value = Math.max(300, Math.min(580, width + start - ev.clientX));
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    localStorage.setItem("chatWidth", String(chatWidth.value));
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}
function key(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    modal.value = "search";
  }
}
function fitWindow(){if(window.innerWidth<=760)sidebar.value=false;}
onMounted(() => {document.addEventListener("keydown", key);window.addEventListener("resize",fitWindow);fitWindow();});
onBeforeUnmount(() => {
  window.removeEventListener("resize",fitWindow);
  document.removeEventListener("keydown", key);
  systemTheme.removeEventListener("change", applyTheme);
});
</script>
<template>
  <div v-if="loading" class="loading-screen">
    <Icon name="Feather" :size="36" /><Icon name="LoaderCircle" class="spin" />
  </div>
  <div v-else-if="!auth?.authenticated" class="auth-page">
    <div class="auth-brand">
      <Icon name="Feather" :size="24" /><span>叙事间</span>
    </div>
    <form class="auth-card" @submit.prevent="login">
      <div class="auth-symbol"><Icon name="BookOpen" :size="36" /></div>
      <h1>{{ auth?.configured ? "继续你的故事" : "建立主创账号" }}</h1>
      <label class="field"
        ><span>账号</span
        ><input v-model="username" autocomplete="username" required
      /></label>
      <label class="field"
        ><span>密码</span
        ><input
          v-model="password"
          type="password"
          :autocomplete="auth?.configured ? 'current-password' : 'new-password'"
          :minlength="auth?.configured ? 1 : 10"
          required /></label
      ><label v-if="!auth?.configured" class="field"
        ><span>确认密码</span
        ><input
          v-model="passwordRepeat"
          type="password"
          autocomplete="new-password"
          minlength="10"
          required
      /></label>
      <p v-if="authError" class="error">{{ authError }}</p>
      <Button variant="primary" :busy="authBusy" type="submit"
        >{{ auth?.configured ? "进入工作台" : "开始创作"
        }}<Icon name="ArrowRight"
      /></Button>
    </form>
  </div>
  <div
    v-else
    class="app-shell"
    :class="{
      'sidebar-closed': !sidebar,
      'chat-closed': !chatOpen,
      'mobile-chat': mobileTab === 'chat',
      'show-library': library,
    }"
    :style="{ '--chat-width': chatWidth + 'px', '--sidebar-width':sidebarWidth+'px' }"
  >
    <header class="app-header">
      <div class="header-leading">
        <div class="brand">
          <Icon name="Feather" :size="23" /><span>叙事间</span>
        </div>
        <Button
          :icon="sidebar ? 'PanelLeftClose' : 'PanelLeft'"
          label="切换导航"
          variant="ghost"
          @click="sidebar = !sidebar"
        />
      </div>
      <button class="project-switch" @click="library = !library">
        {{ w.project?.title || "项目库"
        }}<Icon name="ChevronDown" :size="14" /></button
      ><span class="grow" /><Button
        icon="Search"
        label="搜索 · ⌘K"
        variant="ghost"
        @click="modal = 'search'"
      /><Button
        icon="LayoutGrid"
        label="任务"
        variant="ghost"
        class="task-trigger"
        @click="modal = 'jobs'"
        ><span class="desktop-label">任务</span
        ><span v-if="w.running.length" class="count-badge">{{
          w.running.length
        }}</span></Button
      ><Button icon="Eye" label="预览" variant="ghost" @click="modal='preview'" /><Button
        icon="Settings"
        label="设置"
        variant="ghost"
        @click="modal = 'settings'"
      /><select v-model="theme" class="theme-select" aria-label="主题">
        <option value="system">跟随系统</option>
        <option value="light">日间</option>
        <option value="eye">护眼</option>
        <option value="dark">夜间</option></select
      ><Button
        :icon="chatOpen ? 'PanelRight' : 'MessageSquare'"
        label="切换对话"
        variant="ghost"
        @click="chatOpen = !chatOpen"
      />
    </header>
    <aside class="app-sidebar"><div class="sidebar-resize" role="separator" tabindex="0" aria-label="调整目录宽度" aria-orientation="vertical" @pointerdown="resizeSidebar" @keydown.left.prevent="sidebarWidth=Math.max(200,sidebarWidth-20)" @keydown.right.prevent="sidebarWidth=Math.min(340,sidebarWidth+20)"/>
      <nav aria-label="项目导航">
        <button v-for="space in mainSpaces" :key="space.id" class="nav-item" :class="{active:(w.surface===space.id||(space.id==='story'&&w.surface==='canvas'))&&!library}" @click="selectSpace(space.id)"><Icon :name="space.icon"/><span>{{space.label}}</span></button>
      </nav>
      <div v-if="w.surface==='materials'" class="material-tabs"><button v-for="m in materialModules" :key="m.id" :class="{active:w.moduleId===m.id}" @click="switchModule(m.id)">{{m.label}}</button></div>
      <div v-if="w.surface!=='overview' && w.surface!=='delivery'" class="object-directory">
        <div class="directory-head">
          <span>目录</span
          ><Button
            v-if="w.project && w.moduleId !== 'delivery'"
            icon="Plus"
            label="新增对象"
            variant="ghost"
            @click="showCreate"
          />
        </div>
        <div v-if="w.surface==='story'||w.surface==='canvas'" class="directory-list story-tree">
          <button class="directory-all" :class="{active:w.surface==='story'}" @click="selectStoryView('story')">连续阅读</button>
          <button class="directory-all" :class="{active:w.surface==='canvas'}" @click="selectStoryView('canvas')">故事地图</button>
          <details v-for="c in w.entities.filter(e=>e.kind==='character'&&e.fields.role!=='NPC')" :key="c.id" open><summary>{{c.title}}</summary>
            <button v-for="d in w.entities.filter(e=>e.kind==='document'&&e.refs.includes(c.id)).sort((a,b)=>(w.entities.find(e=>e.kind==='act'&&a.refs.includes(e.id))?.order||0)-(w.entities.find(e=>e.kind==='act'&&b.refs.includes(e.id))?.order||0))" :key="d.id" @click="chooseEntity(d)">{{d.title}}</button>
          </details>
          <details><summary>场景编排</summary><button v-for="e in w.entities.filter(e=>e.kind==='act'||e.kind==='scene')" :key="e.id" @click="chooseEntity(e)">{{e.title}}</button></details>
        </div>
        <div v-else class="directory-list">
          <button
            class="directory-all"
            :class="{ active: !w.entity }"
            @click="w.selectEntity()"
          >
            <Icon name="LayoutGrid" :size="14" /><span>全部</span
            ><span class="directory-count">{{ rows.length }}</span></button
          ><div
            v-for="e in rows"
            :key="e.id"
            class="object-row"
            :class="{ active: e.id === w.entity?.id }"
          >
            <button class="object-open" @click="chooseEntity(e)">
              <Icon
                :name="
                  e.locked
                    ? 'Lock'
                    : e.kind === 'character'
                      ? 'Users'
                      : 'FileText'
                "
                :size="14"
              /><span>{{ e.title }}</span
              ><span v-if="e.stale" class="small-dot" />
            </button>
            <Button
              icon="AtSign"
              label="在对话中引用"
              variant="ghost"
              @click="mentionEntity(e)"
            />
          </div>
        </div>
      </div>
      <div class="sidebar-bottom">
        <button @click="library = true">
          <Icon name="BookOpen" :size="17" />项目库</button
        ><span class="local-state"><i />个人工作空间</span>
      </div>
    </aside>
    <main v-if="library || !w.project" class="project-library">
      <div class="library-heading">
        <div><h1>项目库</h1></div>
        <span class="grow" /><Button
          icon="BookOpen"
          :busy="creating"
          @click="projectCreate(true)"
          >新编体验本</Button
        ><Button
          icon="Plus"
          variant="primary"
          @click="
            modal = 'project';
            newTitle = '';
          "
          >新建剧本</Button
        >
      </div>
      <div class="library-tools">
        <label class="search-input"
          ><Icon name="Search" :size="17" /><input
            v-model="libraryQuery"
            aria-label="查找项目"
            placeholder="查找项目" /></label
        ><button
          :class="{ active: showArchived }"
          @click="showArchived = !showArchived"
        >
          {{ showArchived ? "返回进行中" : "已归档" }}
        </button>
      </div>
      <div v-if="filteredProjects.length" class="project-grid">
        <article v-for="p in filteredProjects" :key="p.id" class="project-card">
          <button
            class="project-main"
            @click="
              w
                .openProject(p.id)
                .then(() => (library = false))
                .catch(w.fail)
            "
          >
            <span class="project-monogram">{{ p.title.slice(0, 1) }}</span>
            <h2>{{ p.title }}</h2>
            <div class="project-progress">
              <i
                :style="{
                  width:
                    (p.data.entities.length
                      ? (p.data.entities.filter((e) => e.status === 'ready')
                          .length /
                          p.data.entities.length) *
                        100
                      : 0) + '%',
                }"
              />
            </div>
            <div class="project-meta">
              <span
                >{{
                  coverage(p).completed
                }}
                / {{ coverage(p).total }} 角色幕正文</span
              ><span
                >{{
                  p.data.entities.filter(
                    (e) =>
                      e.kind === "issue" && e.fields.resolution === "未处理",
                  ).length
                }}
                项待处理</span
              >
            </div>
          </button>
          <footer>
            <span>{{ new Date(p.updatedAt).toLocaleDateString("zh-CN") }}</span
            ><span class="grow" /><Button
              icon="Copy"
              label="复制项目"
              variant="ghost"
              @click="
                api('/projects/' + p.id + '/copy', {})
                  .then(w.refresh)
                  .catch(w.fail)
              "
            /><Button
              :icon="p.archived ? 'RefreshCw' : 'Archive'"
              :label="p.archived ? '恢复项目' : '归档项目'"
              variant="ghost"
              @click="
                api('/projects/' + p.id, { archived: !p.archived }, 'PATCH')
                  .then(w.refresh)
                  .catch(w.fail)
              "
            />
          </footer>
        </article>
      </div>
      <div v-else class="library-empty">
        <Icon name="Feather" :size="52" />
      </div>
    </main>
    <template v-else
      ><main class="workspace-main">
        <header class="workspace-header">
          <template v-if="w.entity && w.surface!=='overview'"
            ><Button
              icon="ChevronLeft"
              label="返回目录"
              variant="ghost"
              @click="w.selectEntity()"
            /><span v-if="w.entity.kind !== 'document'" class="object-name">{{
              w.entity.title
            }}</span
            ><span class="status-dot" :class="w.entity.status">{{
              labelStatus(w.entity.status)
            }}</span
            ><span v-if="w.entity.stale" class="warning">需复核</span
            ><Button
              icon="AtSign"
              label="在对话中引用"
              variant="ghost"
              @click="mentionEntity(w.entity)"
          /></template>
          <span v-else class="workspace-kicker">{{
            w.project.data.entities.filter((e) => e.kind === "concept")[0]
              ?.fields.genre || "创作空间"
          }}</span
          ><span class="grow" /><Button
            icon="History"
            variant="ghost"
            @click="showHistory"
            >版本 {{ w.project.revision }}</Button
          ><Button v-if="w.entity && w.readMode==='edit'" variant="ghost" @click="w.readMode='read'">阅读</Button><template v-if="w.entity && w.readMode==='edit'"
            ><Button
              :icon="w.entity.locked ? 'Lock' : 'Unlock'"
              :label="w.entity.locked ? '解除锁定' : '锁定内容'"
              variant="ghost"
              @click="lock" /><Button icon="Check" @click="approve">{{
              w.entity.status === "ready" ? "修订" : "定稿"
            }}</Button
            ><Button
              icon="Trash2"
              label="移除对象"
              variant="ghost"
              @click="
                entityToDelete = w.entity;
                modal = 'delete';
              "
          /></template>
        </header>
        <div v-if="pending.length" class="pending-banner">
          <Icon name="GitBranch" :size="16" /><span
            >{{ pending.length }} 项修改待审阅</span
          ><Button variant="ghost" @click="showReview(pending[0])">查看</Button>
        </div>
        <div
          ref="scrollPanel"
          class="workspace-scroll"
          @scroll.passive="rememberScroll"
          @dragover.prevent
          @drop.prevent="importFiles($event.dataTransfer?.files || null)"
        >
          <StoryMap v-if="w.surface==='canvas'" />
          <StorySurface v-else-if="w.surface==='overview' || (w.readMode==='read' && (w.surface==='story'||w.surface==='rehearsal'||w.entity))" @preview="modal='preview'" @selection="selection=$event;chatOpen=true" />
          <DeliveryPanel
            v-else-if="w.surface === 'delivery'"
            :key="w.projectId + ':' + w.moduleId"
          /><ModuleSurface
            ref="modulePanel"
            v-else
            @create="showCreate"
            @import="upload?.click()"
            @selection="
              selection = $event;
              chatOpen = true;
            "
          />
        </div>
      </main>
      <div
        class="resize-handle"
        role="separator"
        aria-label="调整对话宽度"
        aria-orientation="vertical"
        tabindex="0"
        @pointerdown="resize"
        @keydown.left.prevent="chatWidth = Math.min(580, chatWidth + 20)"
        @keydown.right.prevent="chatWidth = Math.max(300, chatWidth - 20)"
      />
      <ChatPanel
        :selection="selection"
        @clear-selection="selection = undefined"
        @review="showReview"
        @settings="modal = 'settings'"
      />
      <div class="mobile-tabs">
        <button
          :class="{ active: mobileTab === 'content' }"
          @click="mobileTab = 'content'"
        >
          <Icon name="FileText" />内容</button
        ><button
          :class="{ active: mobileTab === 'chat' }"
          @click="
            mobileTab = 'chat';
            chatOpen = true;
          "
        >
          <Icon name="MessageSquare" />对话
        </button>
      </div></template
    >
    <input
      ref="upload"
      class="hidden"
      type="file"
      multiple
      accept=".md,.txt,.docx,.pdf,image/*,audio/*"
      @change="importFiles(($event.target as HTMLInputElement).files)"
    />
    <div v-if="uploadBusy" class="upload-progress">
      <Icon name="LoaderCircle" class="spin" />正在读取素材
    </div>
    <div v-if="w.error" class="error-toast" role="alert">
      <Icon name="AlertCircle" /><span>{{ w.error }}</span
      ><Button
        icon="X"
        label="关闭提示"
        variant="ghost"
        @click="w.error = ''"
      />
    </div>
    <Dialog v-if="modal === 'project'" title="新建剧本" wide @close="modal = ''"
      ><form @submit.prevent="projectCreate()">
        <label class="field"
          ><span>名称</span
          ><input v-model="newTitle" autofocus placeholder="可以稍后修改" /></label
        ><label class="field"
          ><span>核心想法</span
          ><textarea
            v-model="newBrief"
            required
            rows="5"
            placeholder="一句故事、一个困境，或希望玩家离场时记住的感受"
        /></label>
        <div class="field-grid project-intake-grid">
          <label class="field"
            ><span>题材</span
            ><select v-model="newGenre">
              <option>情感</option>
              <option>推理</option>
              <option>机制</option>
              <option>综合</option>
            </select></label
          ><label class="field"
            ><span>玩家</span
            ><input v-model.number="newPlayers" type="number" min="1" max="12"
          /></label>
          <label class="field"
            ><span>时长（分钟）</span
            ><input v-model.number="newMinutes" type="number" min="60" max="720" step="30"
          /></label>
          <label class="field"
            ><span>创建后</span
            ><select v-model="newProduction">
              <option value="draft">生成整本初稿</option>
              <option value="outline">先完成故事框架</option>
              <option value="manual">进入空白项目</option>
            </select></label
          >
        </div>
        <label v-if="templates.length" class="field"
          ><span>创作模板</span
          ><select v-model="templateId">
            <option value="">空白项目</option>
            <option v-for="t in templates" :key="t.id" :value="t.id">
              {{ t.title }}
            </option>
          </select></label
        >
        <div class="form-actions">
          <Button variant="primary" type="submit" :busy="creating">创建</Button>
        </div>
      </form></Dialog
    >
    <Dialog v-if="modal === 'create'" title="新增内容" @close="modal = ''"
      ><form @submit.prevent="createEntity">
        <label class="field"
          ><span>类型</span
          ><select v-model="newKind">
            <option v-for="k in currentModule.kinds" :key="k" :value="k">
              {{ definitions[k as Kind].label }}
            </option>
          </select></label
        ><label class="field"
          ><span>名称</span><input v-model="newTitle" autofocus
        /></label>
        <div class="form-actions">
          <Button variant="primary" type="submit" :busy="creating">创建</Button>
        </div>
      </form></Dialog
    >
    <Dialog v-if="modal === 'settings'" title="设置" wide @close="modal = ''"
      ><SettingsPanel /></Dialog
    ><Dialog v-if="modal === 'jobs'" title="任务" wide @close="modal = ''"
      ><JobsPanel
    /></Dialog>
    <Dialog v-if="modal === 'delete'" title="移除内容" @close="modal = ''"
      ><p>{{ entityToDelete?.title }}</p>
      <template #footer
        ><Button variant="ghost" @click="modal = ''">取消</Button
        ><Button variant="danger" @click="remove">移除</Button></template
      ></Dialog
    >
    <Dialog v-if="modal === 'search'" title="搜索" wide @close="modal = ''"
      ><label class="search-input"
        ><Icon name="Search" /><input
          v-model="search"
          aria-label="搜索所有项目"
          autofocus
      /></label>
      <div v-if="w.projectId" class="form-actions">
        <span class="grow" /><Button
          :busy="semanticBusy"
          :disabled="!search.trim()"
          @click="searchMeaning"
          >在当前项目按含义查找</Button
        >
      </div>
      <p v-if="semanticWarning" class="muted">{{ semanticWarning }}</p>
      <div v-if="semanticResults.length" class="search-results">
        <div v-for="(hit, i) in semanticResults" :key="i">
          <button v-if="hit.source === 'entity'" @click="openHit(hit)">
            <strong>{{ hit.title }}</strong>
            <p>{{ hit.text }}</p>
          </button>
          <details v-else>
            <summary>{{ hit.title }}</summary>
            <p>{{ hit.text }}</p>
          </details>
        </div>
      </div>
      <div class="search-results">
        <button
          v-for="r in searchResults"
          :key="r.projectId + r.id"
          @click="
            w.openProject(r.projectId).then(() => {
              w.selectModule(moduleFor(r.kind));
              w.selectEntity(w.entities.find((e) => e.id === r.id));
              library = false;
              modal = '';
            })
          "
        >
          <div>
            <strong>{{ r.title }}</strong
            ><span
              >{{ r.projectTitle }} ·
              {{ definitions[r.kind as Kind]?.label }}</span
            >
          </div>
          <p>{{ r.excerpt }}</p>
        </button>
      </div></Dialog
    >
    <Dialog
      v-if="modal === 'review' && review"
      title="审阅修改"
      wide
      @close="modal = ''"
      ><p class="review-summary">{{ review.summary }}</p>
      <p v-if="reviewError" class="error">{{ reviewError }}</p>
      <ul class="review-reasons">
        <li v-for="r in review.reasons" :key="r">{{ r }}</li>
      </ul>
      <section v-for="eid in opTargets(review)" :key="eid" class="diff-section">
        <div
          v-if="review.status === 'pending' && review.baseRevision !== w.project?.revision"
          class="diff-current"
        >
          <span>当前稿</span>
          <pre>{{ diffText(w.entities.find((e) => e.id === eid)) }}</pre>
        </div>
        <div class="diff-before">
          <span>生成依据</span>
          <pre>{{
            scopedDiff(review, eid)
          }}</pre>
        </div>
        <div class="diff-after">
          <span>修改后</span>
          <pre>{{ scopedDiff(review, eid, true) }}</pre>
        </div>
      </section>
      <details v-if="review.status === 'pending'">
        <summary>结构化操作</summary>
        <textarea
          v-model="rawOperations"
          class="raw-json"
          aria-label="编辑结构化操作"
          rows="12"
        />
      </details>
      <template #footer
        ><Button v-if="review.status !== 'pending'" @click="modal = ''">关闭</Button><Button
          v-if="review.status === 'pending'" variant="ghost"
          @click="
            w
              .resolve(review!, 'reject')
              .then(() => (modal = ''))
              .catch(w.fail)
          "
          >放弃</Button
        ><Button v-if="review.status === 'pending'" variant="primary" @click="applyReviewed"
          >应用到当前版本</Button
        ></template
      ></Dialog
    >
    <Dialog v-if="modal === 'history'" title="版本记录" wide @close="modal = ''"
      ><div class="history-grid">
        <div class="revision-list">
          <button
            v-for="v in versions"
            :key="v.revision"
            :class="{ active: snapshot?.revision === v.revision }"
            @click="
              api('/projects/' + w.projectId + '/revisions/' + v.revision)
                .then((p) => (snapshot = p))
                .catch(w.fail)
            "
          >
            <strong>版本 {{ v.revision }}</strong
            ><span>{{ new Date(v.created_at).toLocaleString("zh-CN") }}</span>
          </button>
        </div>
        <div class="revision-detail">
          <template v-if="snapshot"
            ><div class="form-actions">
              <p>
                {{ snapshot.title }} ·
                {{ snapshot.data.entities.length }} 项内容
              </p>
              <span class="grow" /><Button
                :disabled="snapshot.revision === w.project?.revision"
                @click="restore"
                >{{ w.entity ? "恢复当前对象" : "恢复此版本" }}</Button
              >
            </div>
            <article
              v-for="e in snapshot.data.entities.filter(
                (e: Entity) => !w.entity || e.id === w.entity.id,
              )"
              :key="e.id"
            >
              <h3>{{ e.title }}</h3>
              <pre>{{ diffText(e) }}</pre>
            </article></template
          ><template v-else
            ><div v-for="c in w.changes" :key="c.id" class="history-change">
              <span>{{ c.summary }}</span
              ><span class="grow" /><Button
                v-if="c.status === 'pending'"
                @click="showReview(c)"
                >审阅</Button
              ><Button
                v-else-if="c.status === 'applied'"
                icon="Undo2"
                label="撤销"
                variant="ghost"
                @click="w.undo(c.id).catch(w.fail)"
              /></div
          ></template>
        </div></div
    ></Dialog>
    <Dialog v-if="modal==='preview'" title="打印预览" wide @close="modal=''"><DeliveryPanel :immediate-preview="true"/></Dialog>
    <Dialog
      v-if="modal === 'candidates'"
      title="整理导入内容"
      @close="modal = ''"
      ><p class="muted">以下条目由标题识别，选择后进入待审。</p>
      <label v-for="e in candidates" :key="e.id" class="candidate"
        ><input
          v-model="pickedCandidates"
          type="checkbox"
          :value="e.id"
        /><span>{{ e.title }}</span
        ><span class="muted">{{ definitions[e.kind].label }}</span></label
      ><template #footer
        ><Button variant="ghost" @click="modal = ''">稍后整理</Button
        ><Button
          variant="primary"
          :disabled="!pickedCandidates.length"
          @click="adoptCandidates"
          >采用所选</Button
        ></template
      ></Dialog
    >
  </div>
</template>
