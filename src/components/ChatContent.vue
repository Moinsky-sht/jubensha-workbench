<script setup lang="ts">
import {computed} from 'vue';import {useWorkspace} from '../store';
const props=defineProps<{text:string}>(),emit=defineEmits(['open']);const w=useWorkspace();
const lines=computed(()=>props.text.split('\n').filter(l=>l.trim()).map(line=>({heading:/^#{1,4}\s/.test(line),text:line.replace(/^#{1,4}\s/,''),list:/^[-*]\s/.test(line)})));
function parts(text:string){return text.split(/(\[[^\]]+\]\(entity:[^)]+\)|\*\*[^*]+\*\*)/g).map(s=>{const m=s.match(/^\[([^\]]+)\]\(entity:([^)]+)\)$/);return m?{text:w.entities.find(e=>e.id===m[2])?.title||m[1].replace(/^(character|document|act|playtest):/,''),id:m[2],strong:false}:{text:s.replace(/^\*\*|\*\*$/g,''),id:'',strong:s.startsWith('**')};});}
</script>
<template><div class="chat-answer"><p v-for="(line,i) in lines" :key="i" :class="{'answer-heading':line.heading,'answer-item':line.list}"><template v-for="(p,j) in parts(line.text)" :key="j"><button v-if="p.id" class="inline-reference" @click="emit('open',p.id)">{{p.text}}</button><strong v-else-if="p.strong">{{p.text}}</strong><template v-else>{{p.text}}</template></template></p></div></template>
