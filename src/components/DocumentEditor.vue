<script setup lang="ts">
import { watch, ref, onBeforeUnmount } from "vue";
import { useEditor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import Button from "./Button.vue";
import type { RichNode } from "../../shared/domain";
const props = defineProps<{
  modelValue: RichNode;
  readonly?: boolean;
  compact?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [RichNode];
  selection: [{ blockId: string; text: string } | undefined];
  intent: [string];
  annotation: [{ blockId: string; text: string }];
}>();
const selection = ref<{ blockId: string; text: string }>();
const editor = useEditor({
  extensions: [
    StarterKit,
    UniqueID.configure({ types: ["paragraph", "heading"] }),
    Placeholder.configure({ placeholder: "" }),
    TableKit.configure({ table: { resizable: true } }),
  ],
  content: props.modelValue,
  editable: !props.readonly,
  onUpdate: ({ editor }) =>
    emit("update:modelValue", editor.getJSON() as RichNode),
  onSelectionUpdate: ({ editor }) => {
    const { from, to, $from, $to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");
    const blockId = $from.parent.attrs.id;
    selection.value =
      text && blockId && $from.sameParent($to) ? { blockId, text } : undefined;
    emit("selection", selection.value);
  },
});
watch(
  () => props.modelValue,
  (v) => {
    if (
      editor.value &&
      JSON.stringify(editor.value.getJSON()) !== JSON.stringify(v)
    ) {
      const previous = new Map<string, string>();
      editor.value.state.doc.descendants((n) => {
        if (n.attrs.id) previous.set(n.attrs.id, n.textContent);
      });
      editor.value.commands.setContent(v, { emitUpdate: false });
      queueMicrotask(() => {
        editor.value?.view.dom.querySelectorAll("[data-id]").forEach((el) => {
          if (previous.get(el.getAttribute("data-id")!) !== el.textContent) {
            el.classList.add("recent-revision");
            setTimeout(() => el.classList.remove("recent-revision"), 2200);
          }
        });
      });
    }
  },
);
watch(
  () => props.readonly,
  (v) => editor.value?.setEditable(!v),
);
onBeforeUnmount(() => editor.value?.destroy());
</script>
<template>
  <div class="document-editor" :class="{ compact }">
    <div v-if="!readonly && editor" class="editor-toolbar">
      <Button
        icon="Bold"
        label="加粗"
        variant="ghost"
        :class="{ active: editor.isActive('bold') }"
        @click="editor.chain().focus().toggleBold().run()"
      /><Button
        icon="Italic"
        label="斜体"
        variant="ghost"
        @click="editor.chain().focus().toggleItalic().run()"
      /><Button
        icon="Heading2"
        label="小标题"
        variant="ghost"
        @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
      /><span class="separator" /><Button
        icon="List"
        label="列表"
        variant="ghost"
        @click="editor.chain().focus().toggleBulletList().run()"
      /><Button
        icon="Quote"
        label="引用"
        variant="ghost"
        @click="editor.chain().focus().toggleBlockquote().run()"
      /><Button
        icon="Table"
        label="插入表格"
        variant="ghost"
        @click="
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        "
      /><template v-if="editor.isActive('table')"
        ><Button
          variant="ghost"
          @click="editor.chain().focus().addRowAfter().run()"
          >增行</Button
        ><Button
          variant="ghost"
          @click="editor.chain().focus().addColumnAfter().run()"
          >增列</Button
        ><Button
          variant="ghost"
          @click="editor.chain().focus().deleteTable().run()"
          >移除表格</Button
        ></template
      ><span class="grow" /><Button
        icon="Undo2"
        label="撤销输入"
        variant="ghost"
        @click="editor.chain().focus().undo().run()"
      />
    </div>
    <EditorContent :editor="editor" />
    <div v-if="selection && !readonly" class="selection-tools">
      <Button
        v-for="action in ['润色', '扩写', '替换']"
        :key="action"
        variant="ghost"
        @click="
          emit('selection', selection);
          emit('intent', action + '选中文本：');
        "
        >{{ action }}</Button
      ><Button icon="MessageSquare" @click="emit('annotation', selection)"
        >批注</Button
      >
    </div>
  </div>
</template>
