<script setup lang="ts">
import {computed,ref,watch,nextTick} from "vue";
import {useWorkspace,api} from "../store";
import {plain,moduleFor,definitions,type Entity} from "../../shared/domain";
import {players,acts,coverage,ownership,readingEntries} from "../../shared/story";
import RichRead from "./RichRead.vue";
import Button from "./Button.vue";
const w=useWorkspace();
const emit=defineEmits(["preview","selection"]);
const character=ref(""),audience=ref<"author"|"player">("author"),through=ref(99),query=ref(""),overview=ref<any>({}),fontSize=ref(Number(localStorage.getItem("reader-size")||18)),bookmark=ref(""),spoilers=ref(true),activeAct=ref("");
const cast=computed(()=>w.project?players(w.project):[]);
const chapters=computed(()=>w.project?acts(w.project):[]);
const progress=computed(()=>w.project?coverage(w.project):{completed:0,total:0,cells:[]});
const concept=computed(()=>w.entities.find(e=>e.kind==="concept"));
const issues=computed(()=>w.entities.filter(e=>e.kind==="issue"&&e.fields.resolution==="未处理"));
const entries=computed(()=>{
 if(!w.project)return [];
 try{return readingEntries(w.project,w.surface==="rehearsal"?{audience:"author",actId:activeAct.value||undefined,includeDraft:true}:{characterId:character.value||undefined,audience:audience.value,throughAct:through.value,actId:activeAct.value||undefined,includeDraft:true}).filter(e=>(w.surface==="rehearsal"?e.kind==="performance":e.kind==="document")&&(!query.value||plain(e.body).includes(query.value)||e.title.includes(query.value)))}catch{return []}
});
const selectedInfo=computed(()=>w.entity&&w.entity.kind!=="document"?w.entity:undefined);
watch(()=>[w.projectId,w.activityVersion],async()=>{if(w.project)overview.value=await api("/projects/"+w.projectId+"/overview")},{immediate:true});
watch(()=>w.projectId,()=>{character.value=localStorage.getItem("reader-character:"+w.projectId)||"";bookmark.value=localStorage.getItem("bookmark:"+w.projectId)||"";activeAct.value="";through.value=Number(localStorage.getItem("reader-through:"+w.projectId)||99);},{immediate:true});
watch(through,v=>localStorage.setItem("reader-through:"+w.projectId,String(v)));
watch(character,v=>localStorage.setItem("reader-character:"+w.projectId,v));
watch(fontSize,v=>localStorage.setItem("reader-size",String(v)));
watch(()=>w.entity?.id,async()=>{if(w.entity?.kind==="document"){character.value=ownership(w.project!,w.entity).characters[0]?.id||"";await nextTick();document.getElementById("read-"+w.entity.id)?.scrollIntoView({block:"start"});}});
watch(()=>w.pendingAnchor,async anchor=>{if(!anchor)return;await nextTick();document.getElementById(anchor)?.scrollIntoView({block:"center",behavior:"smooth"});w.pendingAnchor="";});
function open(e:Entity){w.selectModule(moduleFor(e.kind));w.selectEntity(e);w.readMode="read";}
function edit(e:Entity){const surface=w.surface;w.selectModule(moduleFor(e.kind));w.selectEntity(e);if(surface==="rehearsal")w.surface=surface;w.readMode="edit";}
function mention(e:Entity){w.mentionIntent=[e.id];}
async function adopt(c:any){try{await api("/projects/"+w.projectId+"/candidates/"+c.id+"/adopt",{});await w.refresh()}catch(e){w.fail(e)}}
async function resumeProduction(){try{await w.send("继续生产，补齐全本已有方向下缺失的角色正文和演绎",{discussOnly:false,projectWide:true});}catch(e){w.fail(e)}}
function saveBookmark(e:Entity){bookmark.value=e.id;localStorage.setItem("bookmark:"+w.projectId,e.id)}
function jumpBookmark(){document.getElementById("read-"+bookmark.value)?.scrollIntoView({behavior:"smooth"})}
async function selectText(e:Entity,event:MouseEvent){
 const s=window.getSelection();if(!s||!s.toString().trim())return;
 const node=s.anchorNode?.parentElement?.closest("[data-block-id]");
 const end=s.focusNode?.parentElement?.closest("[data-block-id]");
 if(!node||node!==end)return;
 const selection={blockId:node.getAttribute("data-block-id"),text:s.toString()};
 w.selectModule("writing");w.selectEntity(e);w.mentionIntent=[e.id];
 await nextTick();emit("selection",selection);
}
</script>
<template>
 <div class="story-surface">
  <template v-if="w.surface==='overview'">
   <div class="story-heading"><div><h1>{{w.project?.title}}</h1></div></div>
   <section class="story-intro">
    <div class="surface-tools"><h2>故事</h2><button @click="spoilers=!spoilers">{{spoilers?'作者全貌':'无剧透'}}</button></div>
    <p>{{(spoilers ? concept?.fields.conflict : w.project?.description) || '从一个想写的故事开始。'}}</p>
    <p v-if="spoilers && concept && (concept.fields.ending || plain(concept.body))">{{concept.fields.ending || plain(concept.body)}}</p>
    <small v-if="!progress.completed">尚未形成符合要求的角色幕正文</small>
   </section>
   <div v-if="overview.candidates?.some((c:any)=>!c.adopted)" class="direction-grid">
    <article v-for="c in overview.candidates" :key="c.id"><h3>{{c.data.title}}</h3><p>{{c.data.conflict}}</p><p>{{c.data.experience}}</p><small>{{c.data.ending}}</small><Button :disabled="!!c.adopted" @click="adopt(c)">采用这个方向</Button></article>
   </div>
   <section class="story-progress"><div><strong>{{progress.completed}} / {{progress.total}}</strong><span>角色幕正文</span></div><div><strong>{{issues.length}}</strong><span>待处理问题</span></div><Button v-if="progress.total && progress.completed<progress.total" @click="resumeProduction">继续创作</Button><Button v-else-if="progress.completed" @click="w.surface='story'">开始阅读</Button></section>
   <section><h2>人物</h2><div class="cast-grid"><button v-for="c in cast" :key="c.id" @click="character=c.id;w.surface='story';w.selectEntity()"><strong>{{c.title}}</strong><span>{{c.fields.desire || c.fields.role}}</span></button></div></section>
   <section><h2>故事推进</h2><article v-for="(a,index) in chapters" :key="a.id" class="act-outline"><span class="act-number">{{String(index+1).padStart(2,'0')}}</span><div><h3>{{a.title}}</h3><p>{{a.fields.goal}}</p><p v-if="spoilers">{{a.fields.exit}}</p></div><Button @click="activeAct=a.id;w.surface='story';w.selectEntity()">阅读</Button><Button variant="ghost" @click="activeAct=a.id;w.surface='rehearsal';w.selectEntity()">演绎</Button></article></section>
   <section v-if="issues.length"><h2>需要处理</h2><button v-for="e in issues" :key="e.id" class="issue-link" @click="open(e)">{{e.title}}</button></section>
  </template>
  <template v-else-if="selectedInfo && w.surface!=='overview'">
   <div class="story-heading"><div><small>{{definitions[selectedInfo.kind].label}}</small><h1>{{selectedInfo.title}}</h1></div><Button @click="edit(selectedInfo)">编辑资料</Button></div>
   <dl class="story-facts"><template v-for="f in definitions[selectedInfo.kind].fields" :key="f.key"><template v-if="selectedInfo.fields[f.key]"><dt>{{f.label}}</dt><dd>{{selectedInfo.fields[f.key]}}</dd></template></template></dl>
   <RichRead :node="selectedInfo.body" class="reader-prose"/>
   <div class="related-links"><button v-for="e in w.entities.filter(e=>selectedInfo!.refs.includes(e.id))" :key="e.id" @click="open(e)">{{e.title}}</button></div><Button variant="ghost" @click="mention(selectedInfo)">加入对话</Button>
  </template>
  <template v-else>
   <div class="reader-controls"><select v-if="w.surface!=='rehearsal'" v-model="character" aria-label="阅读角色"><option value="">全部角色</option><option v-for="c in cast" :value="c.id">{{c.title}}</option></select><select v-model="activeAct" aria-label="阅读幕"><option value="">全部幕</option><option v-for="a in chapters" :value="a.id">{{a.title}}</option></select><select v-if="w.surface!=='rehearsal'" v-model="audience" aria-label="阅读视角"><option value="author">作者视角</option><option value="player">玩家视角</option></select><select v-if="w.surface!=='rehearsal' && audience==='player'" v-model="through" aria-label="已揭露至"><option :value="99">全部已揭露</option><option v-for="(a,i) in chapters" :value="i+1">截至{{a.title}}</option></select><input v-model="query" placeholder="查找正文" aria-label="查找正文"/><Button v-if="bookmark" variant="ghost" @click="jumpBookmark">书签</Button><input v-if="w.surface!=='rehearsal'" type="range" v-model="fontSize" min="16" max="26" aria-label="阅读字号"/></div>
   <p v-if="!entries.length" class="reader-empty">{{audience==='player'&&!character?'先选择一位玩家角色。':'此范围尚无可阅读内容。'}}<Button v-if="audience==='author'" @click="resumeProduction">继续创作</Button></p>
   <article v-for="e in entries" :key="e.id" :id="'read-'+e.id" class="reader-chapter" :class="{changed:w.changedIds.includes(e.id)}">
    <header><small>{{e.status==='ready'?'已定稿':'草稿'}} · {{plain(e.body).replace(/\s/g,'').length}} 字</small><div><Button variant="ghost" @click="saveBookmark(e)">书签</Button><Button variant="ghost" @click="mention(e)">加入对话</Button><Button @click="edit(e)">编辑</Button></div></header><h1>{{e.title}}</h1>
    <RichRead v-if="e.kind==='document'" :node="e.body" class="reader-prose" :style="{fontSize:fontSize+'px'}" @pointerup="selectText(e,$event)"/>
    <dl v-else class="story-facts"><template v-for="f in definitions[e.kind].fields" :key="f.key"><template v-if="e.fields[f.key]"><dt>{{f.label}}</dt><dd>{{e.fields[f.key]}}</dd></template></template></dl>
   </article>
  </template>
 </div>
</template>
