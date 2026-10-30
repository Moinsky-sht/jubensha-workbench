<script setup lang="ts">
import {ref,watch,onBeforeUnmount,nextTick} from 'vue';
import {getDocument,GlobalWorkerOptions,type PDFDocumentProxy, type RenderTask} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Button from './Button.vue';
GlobalWorkerOptions.workerSrc=workerUrl;
const props=defineProps<{url:string}>(),page=ref(1),pages=ref(0),zoom=ref(85),busy=ref(false),error=ref(''),canvas=ref<HTMLCanvasElement>();
let pdf:PDFDocumentProxy|undefined,task:RenderTask|undefined,abort:AbortController|undefined,generation=0;
async function render(){if(!pdf||!canvas.value)return;task?.cancel();await nextTick();try{const p=await pdf.getPage(Math.max(1,Math.min(pages.value,Number(page.value)||1)));const viewport=p.getViewport({scale:zoom.value/100*1.2});canvas.value.width=viewport.width;canvas.value.height=viewport.height;task=p.render({canvas:canvas.value,canvasContext:canvas.value.getContext('2d')!,viewport});await task.promise;}catch(e:any){if(e.name!=='RenderingCancelledException')error.value=e.message;}}
watch(()=>props.url,async url=>{const mine=++generation;abort?.abort();abort=new AbortController();task?.cancel();busy.value=true;error.value='';try{const r=await fetch(url,{signal:abort.signal});if(!r.ok){const data=await r.json();throw Error(data.error||'无法生成预览')}const data=await r.arrayBuffer();if(mine!==generation)return;await pdf?.loadingTask.destroy();const nextPdf=await getDocument({data}).promise;if(mine!==generation){await nextPdf.loadingTask.destroy();return;}pdf=nextPdf;pages.value=pdf.numPages;page.value=1;await nextTick();await render();}catch(e:any){if(e.name!=='AbortError')error.value=e.message;}finally{if(mine===generation)busy.value=false;}},{immediate:true});
watch([page,zoom,canvas],render);onBeforeUnmount(()=>{generation++;abort?.abort();task?.cancel();void pdf?.loadingTask.destroy();});
</script>
<template><section class="pdf-preview"><div class="pdf-controls"><Button :disabled="page<=1" @click="page--">上一页</Button><input aria-label="预览页码" type="number" v-model.number="page" min="1" :max="pages"/><span>/ {{pages}}</span><Button :disabled="page>=pages" @click="page++">下一页</Button><select v-model.number="zoom" aria-label="预览缩放"><option v-for="n in [50,70,85,100,125,150]" :value="n">{{n}}%</option></select><span v-if="busy">正在分页</span></div><p v-if="error" role="alert">{{error}}</p><div class="pdf-page"><canvas ref="canvas" aria-label="实际打印页面"/></div></section></template>
