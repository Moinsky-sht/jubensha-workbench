<script setup lang="ts">
import { ref, onMounted, computed, watch, defineAsyncComponent } from "vue";
import { api, useWorkspace } from "../store";
import { players, ownership, acts, readingEntries } from "../../shared/story";
import { audiences, labelStatus } from "../../shared/domain";
import Button from "./Button.vue";
const PdfPreview=defineAsyncComponent(()=>import("./PdfPreview.vue"));
import Icon from "./Icon.vue";
const props=defineProps<{immediatePreview?:boolean}>();
const w = useWorkspace(),
  revision = ref(w.project!.revision),
  versions = ref<any[]>([]),
  audience = ref("player"),
  format = ref("zip"),
  template = ref("role"),
  font = ref("serif"),
  fontSize = ref(16),
  margin = ref(22),
  preview = ref(!!props.immediatePreview),
  characterId=ref(localStorage.getItem("reader-character:"+w.projectId)||(w.entity?ownership(w.project!,w.entity).characters[0]?.id:undefined)||players(w.project!)[0]?.id||"") ,
  throughAct=ref(Math.min(Number(localStorage.getItem("reader-through:"+w.projectId)||99),acts(w.project!).length||1)),
  snapshot=ref(w.project!),
  busy = ref(false);
onMounted(
  async () =>
    (versions.value = await api("/projects/" + w.projectId + "/revisions")),
);
watch(revision,async v=>{snapshot.value=await api("/projects/"+w.projectId+"/revisions/"+v);if(!players(snapshot.value).some(c=>c.id===characterId.value))characterId.value=players(snapshot.value)[0]?.id||"";});
const options = computed(() => ({
  revision: revision.value,
  ...(audience.value==="player"?{characterId:characterId.value,throughAct:throughAct.value}:{}),
  audience: audience.value,
  format: format.value,
  template: template.value,
  font: font.value,
  fontSize: fontSize.value,
  margin: margin.value,
}));
const manifest=computed(()=>{try{const rows=audience.value==='player'?readingEntries(snapshot.value,{characterId:characterId.value,audience:'player',throughAct:throughAct.value,includeDraft:true}):snapshot.value.data.entities.filter(e=>audience.value==='author'||e.audience===audience.value);const kinds=template.value==='role'?['document']:template.value==='host'?['performance','playtest','object','task']:['clue','memory','object','task'];return rows.filter(e=>kinds.includes(e.kind));}catch{return []}});
async function accept(){try{if(revision.value!==w.project!.revision)throw Error('请切换到当前版本后定稿');const drafts=manifest.value.filter(e=>e.status!=='ready');if(drafts.some(e=>e.stale))throw Error('请先处理待检查内容');await w.apply(drafts.map(e=>({type:'update_entity' as const,entityId:e.id,changes:{status:'ready' as const}})),'定稿当前交付清单',undefined,{module:'all',entityIds:drafts.map(e=>e.id)});revision.value=w.project!.revision;snapshot.value=w.project!;}catch(e){w.fail(e)}}
const url = computed(
  () =>
    "/api/projects/" +
    w.projectId +
    "/print-preview?" +
    new URLSearchParams(
      Object.entries(options.value)
        .filter(([k]) => k !== "format")
        .map(([k, v]) => [k, String(v)]),
    ),
);
async function generate() {
  busy.value = true;
  try {
    await api("/jobs", {
      projectId: w.projectId,
      kind: "export",
      scope: { module: "delivery", projectWide: true },
      exportOptions: options.value,
    });
    await w.refreshJobs();
  } catch (e) {
    w.fail(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="delivery-panel">
    <div class="delivery-options">
      <label v-if="audience==='player'" class="field"><span>角色</span><select v-model="characterId"><option value="">请选择</option><option v-for="c in players(snapshot)" :value="c.id">{{c.title}}</option></select></label>
      <label v-if="audience==='player'" class="field"><span>已揭露至第几幕</span><input type="number" min="1" v-model="throughAct"/></label>
      <label class="field"
        ><span>版本</span
        ><select v-model="revision">
          <option v-for="v in versions" :key="v.revision" :value="v.revision">
            版本 {{ v.revision }}
          </option>
        </select></label
      ><label class="field"
        ><span>受众</span
        ><select v-model="audience">
          <option v-for="(label, key) in audiences" :key="key" :value="key">
            {{ label }}
          </option>
        </select></label
      ><label class="field"
        ><span>格式</span
        ><select v-model="format">
          <option value="zip">完整压缩包</option>
          <option value="docx">Word</option>
          <option value="pdf">PDF</option>
          <option value="md">Markdown</option>
          <option value="json">项目结构</option>
        </select></label
      ><label class="field"
        ><span>版式</span
        ><select v-model="template">
          <option value="role">A4角色本</option>
          <option value="host">A4主持手册</option>
          <option value="cards">A4线索卡</option>
        </select></label
      ><label class="field"
        ><span>字体</span
        ><select v-model="font">
          <option value="serif">宋体</option>
          <option value="sans">黑体</option>
        </select></label
      ><label class="field"
        ><span>字号</span
        ><input
          v-model.number="fontSize"
          type="number"
          min="12"
          max="24" /></label
      ><label class="field"
        ><span>边距（毫米）</span
        ><input v-model.number="margin" type="number" min="10" max="40"
      /></label>
    </div>
    <div class="form-actions">
      <span class="muted"
        >{{
          manifest.filter((e) => e.status === "ready").length
        }}
        / {{manifest.length}} 项已定稿</span
      ><span class="grow" /><Button icon="Eye" @click="preview = !preview">{{
        preview ? "收起预览" : "预览"
      }}</Button
      ><Button v-if="manifest.some(e=>e.status!=='ready')" @click="accept">定稿当前清单</Button><Button
        icon="PackageCheck"
        variant="primary"
        :busy="busy"
        @click="generate"
        >生成文件</Button
      >
    </div>
    <PdfPreview v-if="preview && (audience!=='player' || characterId)" :url="url"/>
    <div class="release-list">
      <a v-for="r in w.releases" :key="r.id" :href="r.url"
        ><Icon name="FileText" />
        <div>
          <strong>{{ r.file_name }}</strong>
          <p>{{ new Date(r.created_at).toLocaleString("zh-CN") }}</p>
        </div>
        <span class="grow" /><Icon name="Download"
      /></a>
      <p v-if="!w.releases.length" class="empty-note">
        生成的文件会保存在这里。
      </p>
    </div>
  </div>
</template>
