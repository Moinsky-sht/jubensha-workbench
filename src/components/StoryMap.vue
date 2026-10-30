<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import {VueFlow, useVueFlow, MarkerType, type Edge, type Node} from "@vue-flow/core";
import {Background} from "@vue-flow/background";
import {Controls} from "@vue-flow/controls";
import {MiniMap} from "@vue-flow/minimap";
import {definitions, moduleFor, plain, type Entity, type Kind} from "../../shared/domain";
import {acts, players} from "../../shared/story";
import {useWorkspace} from "../store";
import Button from "./Button.vue";

const w=useWorkspace();
const {fitView}=useVueFlow();
const selectedGroups=ref(new Set(["people","story","information","output"]));
const groups=[
  {id:"people",label:"人物",kinds:["character","relationship"]},
  {id:"story",label:"事件与场景",kinds:["act","scene","event","rule"]},
  {id:"information",label:"线索与记忆",kinds:["clue","memory","task","object"]},
  {id:"output",label:"正文与演绎",kinds:["document","performance","issue"]},
];
const visibleKinds=computed(()=>new Set(groups.filter(g=>selectedGroups.value.has(g.id)).flatMap(g=>g.kinds)));
const entityMap=computed(()=>new Map(w.entities.map(e=>[e.id,e])));
const chapterList=computed(()=>w.project?acts(w.project):[]);
const cast=computed(()=>w.project?players(w.project):[]);
const kindTone=(kind:Kind)=>kind==="character"?"person":kind==="act"?"act":["event","scene","rule"].includes(kind)?"story":["clue","memory","task","object"].includes(kind)?"information":kind==="issue"?"issue":"output";
const short=(e:Entity)=>String(e.fields.time||e.fields.goal||e.fields.truth||e.fields.appearance||e.fields.desire||plain(e.body)||definitions[e.kind].label).replace(/\s+/g," ").slice(0,72);

const graph=computed(()=>{
  const nodes:Node[]=[];
  const edges:Edge[]=[];
  const included=new Set<string>();
  const add=(e:Entity,x:number,y:number,role="story")=>{
    if(!visibleKinds.value.has(e.kind))return;
    included.add(e.id);
    nodes.push({id:e.id,type:"story",position:{x,y},data:{entity:e,label:e.title,meta:definitions[e.kind].label,summary:short(e),tone:kindTone(e.kind),role},draggable:false});
  };
  cast.value.forEach((e,i)=>add(e,-350,130+i*132,"lane"));
  chapterList.value.forEach((e,i)=>add(e,i*390,0,"chapter"));
  const unplaced:Entity[]=[];
  const lane=(e:Entity)=>["event","scene","rule"].includes(e.kind)?0:["clue","memory","task","object"].includes(e.kind)?1:["document","performance"].includes(e.kind)?2:3;
  chapterList.value.forEach((act,actIndex)=>{
    const related=w.entities.filter(e=>e.id!==act.id&&e.refs.includes(act.id)&&e.kind!=="character"&&e.kind!=="relationship");
    const counts=[0,0,0,0];
    related.forEach(e=>{
      const row=lane(e),n=counts[row]++;
      add(e,actIndex*390+(n%2)*172,150+row*240+Math.floor(n/2)*112);
    });
  });
  for(const e of w.entities){
    if(included.has(e.id)||e.kind==="relationship"||e.kind==="constraint"||e.kind==="source"||e.kind==="asset"||e.kind==="annotation"||e.kind==="playtest")continue;
    if(!e.refs.some(id=>chapterList.value.some(a=>a.id===id)))unplaced.push(e);
  }
  unplaced.forEach((e,i)=>add(e,chapterList.value.length*390+80+(i%2)*172,150+Math.floor(i/2)*112));
  for(const e of w.entities){
    if(e.kind==="relationship"&&visibleKinds.value.has("relationship")){
      const endpoints=e.refs.filter(id=>included.has(id)).slice(0,2);
      if(endpoints.length===2)edges.push({id:"relationship:"+e.id,source:endpoints[0],target:endpoints[1],label:e.title,type:"smoothstep",animated:false,style:{stroke:"var(--accent)",strokeWidth:2}});
    }
    if(!included.has(e.id))continue;
    for(const refId of e.refs){
      if(!included.has(refId)||refId===e.id)continue;
      const ref=entityMap.value.get(refId);
      const isStructural=ref?.kind==="act"||ref?.kind==="character";
      if(!isStructural)continue;
      edges.push({id:`${refId}:${e.id}`,source:refId,target:e.id,type:"smoothstep",markerEnd:MarkerType.ArrowClosed,style:{stroke:"var(--line-strong)",strokeWidth:1.2}});
    }
  }
  return {nodes,edges};
});
const nodes=ref<Node[]>([]),edges=ref<Edge[]>([]);
watch(graph,async value=>{nodes.value=value.nodes;edges.value=value.edges;await nextTick();if(nodes.value.length)fitView({padding:.18,duration:250});},{immediate:true});
function toggle(id:string){const next=new Set(selectedGroups.value);next.has(id)?next.delete(id):next.add(id);selectedGroups.value=next;}
function open(e:Entity){w.selectModule(moduleFor(e.kind));w.selectEntity(e);w.readMode="read";w.pendingAnchor=e.kind==="document"?"read-"+e.id:"";}
function mention(e:Entity){w.mentionIntent=[e.id];}
</script>

<template>
  <div class="story-map-shell">
    <header class="story-map-toolbar">
      <div><h1>故事地图</h1><p>沿时间查看人物、事件与信息释放。</p></div>
      <div class="story-map-filters" aria-label="地图内容">
        <button v-for="group in groups" :key="group.id" :class="{active:selectedGroups.has(group.id)}" @click="toggle(group.id)">{{group.label}}</button>
        <Button variant="ghost" label="适合画面" @click="fitView({padding:.18,duration:250})" />
      </div>
    </header>
    <div v-if="nodes.length" class="story-map" aria-label="故事节点画布">
      <VueFlow v-model:nodes="nodes" v-model:edges="edges" :nodes-draggable="false" :connect-on-click="false" :zoom-on-double-click="false" :min-zoom=".12" :max-zoom="1.8" fit-view-on-init @node-click="({node}:any)=>open(node.data.entity)">
        <Background :gap="24" :size="1" pattern-color="var(--line)" />
        <MiniMap pannable zoomable :node-color="(node:any)=>node.data.tone==='person'?'#8a6f63':node.data.tone==='act'?'#b6463e':node.data.tone==='information'?'#a68238':node.data.tone==='issue'?'#c04444':'#60758d'" />
        <Controls :show-interactive="false" />
        <template #node-story="{data}">
          <article class="story-map-node" :class="['tone-'+data.tone,'role-'+data.role]">
            <div><span>{{data.meta}}</span><button title="加入对话" @click.stop="mention(data.entity)">@</button></div>
            <strong>{{data.label}}</strong><p>{{data.summary}}</p>
          </article>
        </template>
      </VueFlow>
    </div>
    <div v-else class="reader-empty">当前筛选范围还没有可显示的故事节点。</div>
  </div>
</template>
