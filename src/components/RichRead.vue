<script lang="ts">
import {defineComponent,h} from "vue";
export default defineComponent({props:{node:{type:Object,required:true}},setup(props){
  function render(n:any):any {
    if(n.type==="text") {let content:any=n.text||"";for(const mark of n.marks||[])if(["bold","italic"].includes(mark.type))content=h(mark.type==="bold"?"strong":"em",{},content);return content;}
    const tags:Record<string,string>={doc:"div",paragraph:"p",heading:"h3",bulletList:"ul",orderedList:"ol",listItem:"li",blockquote:"blockquote",hardBreak:"br",table:"table",tableRow:"tr",tableCell:"td",tableHeader:"th",horizontalRule:"hr"};
    return h(tags[n.type]||"div",{"data-block-id":n.attrs?.id,id:n.attrs?.id?"block-"+n.attrs.id:undefined},(n.content||[]).map(render));
  }
  return ()=>render(props.node);
}});
</script>
