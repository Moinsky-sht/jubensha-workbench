<script setup lang="ts">
import { ref, watch, computed, nextTick } from "vue";
import { useWorkspace, api } from "../store";
import {
  labelStatus,
  moduleFor,
  modules,
  type Change,
  type Entity,
} from "../../shared/domain";
import Button from "./Button.vue";
import Icon from "./Icon.vue";
import ChatContent from "./ChatContent.vue";
import ReferenceComposer from "./ReferenceComposer.vue";
const composer=ref<InstanceType<typeof ReferenceComposer>>();
const menu=ref(false);
const props = defineProps<{ selection?: { blockId: string; text: string } }>();
const emit = defineEmits(["review", "clearSelection", "settings"]);
const w = useWorkspace();
const text = ref(""),
  discuss = ref(false),
  model = ref(""),
  sending = ref(false),
  history = ref(false),
  mentionsOpen = ref(false),
  extra = ref<string[]>([]);
watch(
  () => w.scopeKey,
  (k) => {
    text.value = localStorage.getItem("chat-draft:" + k) || "";
    extra.value = JSON.parse(localStorage.getItem("chat-refs:"+k)||"[]");
  },
  { immediate: true },
);
watch(text, (t) => localStorage.setItem("chat-draft:" + w.scopeKey, t));
watch(extra,v=>localStorage.setItem("chat-refs:"+w.scopeKey,JSON.stringify(v)),{deep:true});
watch(()=>w.mentionIntent,ids=>{extra.value=[...new Set([...extra.value,...ids])];},{deep:true});
const messagePanel = ref<HTMLElement>();
let scrollKey = "";
function rememberScroll() {
  if (messagePanel.value && scrollKey)
    localStorage.setItem(
      "chat-scroll:" + scrollKey,
      String(messagePanel.value.scrollTop),
    );
}
watch(
  () => w.scopeKey + ":" + (w.currentConversation?.id || ""),
  async (key) => {
    rememberScroll();
    scrollKey = key;
    await nextTick();
    if (messagePanel.value)
      messagePanel.value.scrollTop = Number(
        localStorage.getItem("chat-scroll:" + key) ||
          messagePanel.value.scrollHeight,
      );
  },
  { immediate: true },
);
watch(
  () => w.currentConversation?.messages.length,
  async () => {
    const nearBottom = messagePanel.value
      ? messagePanel.value.scrollHeight -
          messagePanel.value.clientHeight -
          messagePanel.value.scrollTop <
        100
      : true;
    await nextTick();
    if (nearBottom && messagePanel.value)
      messagePanel.value.scrollTop = messagePanel.value.scrollHeight;
  },
);
const jobs = computed(() =>
  w.jobs.filter((j) => j.conversation_id === w.currentConversation?.id),
);
const busy = computed(() =>
  jobs.value.find((j) => ["queued", "running"].includes(j.status)),
);
const currentModel = computed(() =>
  w.connections.find(
    (c) =>
      c.id ===
      (model.value ||
        w.project?.data.moduleModels?.[w.globalChat ? "all" : w.moduleId] ||
        w.project?.data.defaultModel ||
        w.settings.defaultModel),
  ),
);
const mentionText = computed(() => {
  const at = text.value.lastIndexOf("@");
  if (at < 0 || /\s/.test(text.value.slice(at + 1))) return "";
  return text.value.slice(at + 1).toLowerCase();
});
const mentionRows = computed(() => {
  const q = mentionText.value;
  return w.entities
    .filter((e) => !q || e.title.toLowerCase().includes(q))
    .slice(0, 12);
});
const moduleLabel = (e: Entity) =>
  modules.find((m) => m.id === moduleFor(e.kind))?.label || "项目";
function insertMention(e: Entity) {
  composer.value?.insert(e.id);
  mentionsOpen.value = false;
}
function removeMention(id: string) {
  composer.value?.remove(id);
  extra.value=extra.value.filter(x=>x!==id);
}
const liveStream = computed(() => busy.value ? w.streams[busy.value.id] || "" : "");
const segments=(content:string)=>content.split(/(\[[^\]]+\]\(entity:[^)]+\))/g).map(t=>{
  const m=t.match(/^\[([^\]]+)\]\(entity:([^)]+)\)$/);
  return m?{text:m[1],id:m[2]}:{text:t,id:""};
});
function openRef(id:string) {
  const e=w.entities.find(e=>e.id===id);if(e){w.selectModule(moduleFor(e.kind));w.selectEntity(e);w.readMode="read";w.pendingAnchor="read-"+e.id;}
}

async function send() {
  if (!text.value.trim() || sending.value) return;
  if (!currentModel.value) {
    emit("settings");
    return;
  }
  sending.value = true;
  try {
    const invalid=extra.value.filter(id=>!w.entities.some(e=>e.id===id));
    if(invalid.some(id=>!modules.some(m=>'module:'+m.id===id)))throw new Error("引用已失效，请移除后重新选择");
    const typed:string[]=[];
    await w.send(text.value, {
      discussOnly: discuss.value,
      projectWide: false,
      modelId: model.value,
      entityIds: [...new Set([...extra.value, ...typed])],
      selection: props.selection,
    });
    text.value = "";
    extra.value=[];
    emit("clearSelection");
  } catch (e) {
    w.fail(e);
  } finally {
    sending.value = false;
  }
}
watch(
  () => w.composeIntent,
  (v) => {
    if (v) {
      text.value = v;
      w.composeIntent = "";
    }
  },
);

function provenance(id?: string) {
  return jobs.value.find((j) => j.id === id)?.result;
}
function change(id?: string) {
  return w.changes.find((c) => c.id === id);
}
</script>
<template>
  <aside class="chat-panel">
    <header class="chat-header">
      <span>主创对话</span>
      <div class="chat-scope-switch" aria-label="对话范围">
        <button :class="{ active: w.globalChat }" @click="w.globalChat = true">全局</button>
        <button :class="{ active: !w.globalChat }" @click="w.globalChat = false">当前</button>
      </div>
      <span class="grow" /><Button icon="MoreHorizontal" label="对话选项" variant="ghost" @click="menu=!menu"/><template v-if="menu"><Button
        icon="History"
        label="历史讨论"
        variant="ghost"
        @click="history = !history"
      /><Button
        icon="GitBranch"
        label="从这里分支"
        variant="ghost"
        @click="w.ensureConversation(undefined, true).catch(w.fail)"
      /><Button
        icon="Plus"
        label="新讨论"
        variant="ghost"
        @click="w.newChat().catch(w.fail)"
      />
    </template></header>
    <div v-if="history" class="chat-history">
      <button
        v-for="c in w.currentConversations"
        :key="c.id"
        :class="{ active: c.id === w.currentConversation?.id }"
        @click="
          w.chooseChat(c.id);
          history = false;
        "
      >
        {{ c.title }}<span>{{ c.messages.length }} 条</span>
      </button>
      <p v-if="!w.currentConversations.length" class="muted">还没有历史讨论</p>
    </div>
    <div
      ref="messagePanel"
      class="chat-messages"
      @scroll.passive="rememberScroll"
    >
      <div v-if="!w.currentConversation?.messages.length" class="chat-start">
        <div class="chat-mark"><Icon name="Feather" :size="27" /></div>
      </div>
      <article
        v-for="m in w.currentConversation?.messages || []"
        :key="m.id"
        class="message"
        :class="m.role"
      >
        <div v-if="m.role === 'assistant'" class="assistant-mark">
          <Icon name="Feather" :size="15" />
        </div>
        <ChatContent :text="m.content" @open="openRef"/>

        <div v-if="change(m.changeId)" class="change-receipt">
          <span
            ><Icon
              :name="
                change(m.changeId)!.status === 'applied'
                  ? 'Check'
                  : 'AlertCircle'
              "
              :size="14"
            />{{ labelStatus(change(m.changeId)!.status) }} ·
            {{ change(m.changeId)!.operations.length }} 处</span
          ><Button
            v-if="change(m.changeId)"
            variant="ghost"
            @click="emit('review', change(m.changeId))"
            >查看修改</Button
          ><Button v-if="change(m.changeId)!.status === 'applied'" variant="ghost" @click="w.locateChange(change(m.changeId)!)">定位正文</Button><Button
            v-if="change(m.changeId)!.status === 'applied'"
            icon="Undo2"
            label="撤销这次修改"
            variant="ghost"
            @click="w.undo(m.changeId!).catch(w.fail)"
          />
        </div>
        <details
          v-if="m.role === 'assistant' && provenance(m.jobId)"
          class="message-evidence"
        >
          <summary>生成依据</summary>
          <p>{{ provenance(m.jobId).model }}</p>
          <p
            v-if="provenance(m.jobId).routes?.some((r: any) => !r.ok)"
            class="muted"
          >
            本次调用发生过模型重试或切换。
          </p>
          <div v-for="(hit, i) in provenance(m.jobId).evidence?.hits" :key="i">
            <strong>{{ hit.title }}</strong>
            <p>{{ hit.text }}</p>
          </div>
        </details>
      </article>
      <div v-if="busy" class="job-inline stream-inline">
        <Icon name="LoaderCircle" :size="16" class="spin" />
        <div><strong>{{ w.steps[busy.id] || labelStatus(busy.status) }}</strong><ChatContent v-if="liveStream" :text="liveStream" @open="openRef"/></div>
        <span class="grow" /><Button
          icon="Square"
          label="停止"
          variant="ghost"
          @click="
            api('/jobs/' + busy.id + '/cancel', {})
              .then(w.refreshJobs)
              .catch(w.fail)
          "
        />
      </div>
      <div
        v-for="j in jobs
          .filter((j) => j.status === 'failed' || j.status === 'paused')
          .slice(0, 3)"
        :key="j.id"
        class="job-error"
      >
        <Icon name="AlertCircle" :size="16" /><span>{{
          j.error || labelStatus(j.status)
        }}</span><Button variant="ghost" @click="api('/jobs/'+j.id+'/retry',{}).then(w.refreshJobs).catch(w.fail)">重试</Button>
      </div>
    </div>
    <div class="chat-compose">
      <div v-if="selection" class="selection-chip">
        <span>已选 {{ selection.text.length }} 字</span
        ><Button
          icon="X"
          label="取消选区"
          variant="ghost"
          @click="emit('clearSelection')"
        />
      </div>
      <div v-if="extra.length" class="mention-chips">
        <button v-for="id in extra" :key="id" @click="removeMention(id)">
          @{{ w.entities.find((e) => e.id === id)?.title || modules.find(m=>"module:"+m.id===id)?.label || "引用已失效" }} <Icon name="X" :size="12" />
        </button>
      </div>
      <div v-if="mentionsOpen || mentionText" class="mention-picker">
        <button v-for="m in modules.filter(m=>!mentionText||m.label.includes(mentionText))" :key="m.id" @click="composer?.insert('module:'+m.id);mentionsOpen=false"><span>@{{m.label}}</span><small>创作环节</small></button>
        <button v-for="e in mentionRows" :key="e.id" @click="insertMention(e)">
          <span>@{{ e.title }}</span><small>{{ moduleLabel(e) }} · {{ e.refs.map(id=>w.entities.find(x=>x.id===id)).filter(x=>x?.kind==="act"||x?.kind==="character").map(x=>x?.title).join(" / ") }}</small>
        </button>
        <p v-if="!mentionRows.length">没有匹配内容</p>
      </div>
      <div class="compose-scope">
        <button
          :class="{ selected: discuss }"
          :aria-pressed="discuss"
          @click="discuss = !discuss"
        >
          只讨论</button
        ><button :class="{ selected: mentionsOpen }" @click="mentionsOpen = !mentionsOpen">
          <Icon name="AtSign" :size="13" />引用
        </button>
      </div>
      <div class="compose-box">
        <ReferenceComposer ref="composer" v-model="text" v-model:references="extra" :scope="w.scopeKey" @send="send"/>
        <div class="compose-bottom">
          <button
            v-if="!w.connections.length"
            class="model-trigger"
            @click="emit('settings')"
          >
            <Icon name="Plus" :size="14" />接入模型</button
          ><select v-else v-model="model" aria-label="本次模型">
            <option value="">{{ currentModel?.name || "项目默认" }}</option>
            <option v-for="c in w.connections" :key="c.id" :value="c.id">
              {{ c.name }}
            </option></select
          ><span class="grow" /><Button
            icon="ArrowUp"
            label="发送"
            variant="primary"
            :disabled="!text.trim() || !!busy"
            :busy="sending"
            @click="send"
          />
        </div>
      </div>
    </div>
  </aside>
</template>
