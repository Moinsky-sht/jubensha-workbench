<script setup lang="ts">
import {watch,onBeforeUnmount} from 'vue';
import {useEditor,EditorContent} from '@tiptap/vue-3';
import {Node,mergeAttributes} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {useWorkspace} from '../store';
import {definitions,modules} from '../../shared/domain';
const props=defineProps<{modelValue:string;references:string[];scope:string}>();
const emit=defineEmits(['update:modelValue','update:references','send']);
const w=useWorkspace();let updating=false;
const Mention=Node.create({name:'storyReference',group:'inline',inline:true,atom:true,selectable:true,
 addAttributes(){return{entityId:{default:''},label:{default:''}}},
 parseHTML(){return[{tag:'span[data-story-reference]'}]},
 renderHTML({node,HTMLAttributes}){const e=w.entities.find(e=>e.id===node.attrs.entityId);return ['span',mergeAttributes(HTMLAttributes,{'data-story-reference':node.attrs.entityId,class:'reference-node'+(!e&&!modules.some(m=>'module:'+m.id===node.attrs.entityId)?' invalid':'')}),e?'@'+e.title+' · '+definitions[e.kind].label:node.attrs.entityId.startsWith('module:')?'@'+(modules.find(m=>'module:'+m.id===node.attrs.entityId)?.label||'失效模块'):'引用已失效']},
 renderText({node}){return '@'+(w.entities.find(e=>e.id===node.attrs.entityId)?.title||modules.find(m=>'module:'+m.id===node.attrs.entityId)?.label||node.attrs.label||'引用已失效')}
});
function publish(){if(!editor.value)return;updating=true;const ids:string[]=[];editor.value.state.doc.descendants(n=>{if(n.type.name==='storyReference')ids.push(n.attrs.entityId)});emit('update:references',[...new Set(ids)]);emit('update:modelValue',editor.value.getText());localStorage.setItem('chat-nodes:'+props.scope,JSON.stringify(editor.value.getJSON()));updating=false;}
const editor=useEditor({extensions:[StarterKit.configure({heading:false,codeBlock:false,blockquote:false}),Mention],content:'',editorProps:{attributes:{role:'textbox','aria-label':'对话要求','aria-multiline':'true'},handleKeyDown:(_,e)=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){emit('send');return true;}return false;}},onUpdate:publish});
function restore(){if(!editor.value)return;try{const saved=localStorage.getItem('chat-nodes:'+props.scope);editor.value.commands.setContent(saved?JSON.parse(saved):{type:'doc',content:[{type:'paragraph',content:props.modelValue?[{type:'text',text:props.modelValue}]:[]}]},{emitUpdate:false})}catch{editor.value.commands.clearContent(false)}}
watch([()=>props.scope,editor],restore,{immediate:true});
watch(()=>props.modelValue,v=>{if(updating||!editor.value||v===editor.value.getText())return;editor.value.commands.setContent({type:'doc',content:[{type:'paragraph',content:v?[{type:'text',text:v}]:[]}]},{emitUpdate:false});for(const id of props.references)insert(id);if(!v)localStorage.removeItem('chat-nodes:'+props.scope);});
function insert(id:string){if(!editor.value)return;let present=false;editor.value.state.doc.descendants(n=>{if(n.type.name==='storyReference'&&n.attrs.entityId===id)present=true;});if(present)return;const e=w.entities.find(e=>e.id===id);let range:{from:number,to:number}|undefined;
editor.value.state.doc.descendants((n,pos)=>{if(n.isText){const m=(n.text||'').match(/@[^@\s]*$/);if(m)range={from:pos+m.index!,to:pos+(n.text||'').length};}});
if(range)editor.value.chain().setTextSelection(range.from).deleteRange(range).run();
editor.value.chain().focus().insertContent([{type:'storyReference',attrs:{entityId:id,label:e?.title}},{type:'text',text:' '}]).run();}
function remove(id:string){if(!editor.value)return;const ranges:{from:number,to:number}[]=[];editor.value.state.doc.descendants((n,pos)=>{if(n.type.name==='storyReference'&&n.attrs.entityId===id)ranges.push({from:pos,to:pos+n.nodeSize})});for(const range of ranges.reverse())editor.value.commands.deleteRange(range)}
watch(()=>props.references,ids=>{if(updating)return;for(const id of ids)insert(id)},{deep:true});
onBeforeUnmount(()=>editor.value?.destroy());defineExpose({insert,remove});
</script>
<template><EditorContent :editor="editor" class="reference-composer"/></template>
