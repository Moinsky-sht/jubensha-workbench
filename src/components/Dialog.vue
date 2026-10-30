<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from "vue";
import Button from "./Button.vue";
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits(["close"]);
const panel = ref<HTMLElement>();
let prior: Element | null = null;
let background: HTMLElement | null = null;
function key(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation();
    emit("close");
  }
  if (e.key === "Tab") {
    const nodes = panel.value?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input,select,textarea,a[href],[tabindex="0"]',
    );
    if (!nodes?.length) return;
    const first = nodes[0],
      last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
onMounted(async () => {
  prior = document.activeElement;
  background = document.getElementById("app");
  if (background) background.inert = true;
  document.addEventListener("keydown", key);
  await nextTick();
  panel.value?.querySelector<HTMLElement>("input,textarea,button")?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", key);
  if (background) background.inert = false;
  if (prior instanceof HTMLElement) prior.focus();
});
</script>
<template>
  <Teleport to="body"
    ><div class="dialog-backdrop" @mousedown.self="emit('close')">
      <section
        ref="panel"
        class="dialog"
        :class="{ wide }"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header>
          <h2>{{ title }}</h2>
          <Button
            icon="X"
            label="关闭"
            variant="ghost"
            @click="emit('close')"
          />
        </header>
        <div class="dialog-body"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </section></div
  ></Teleport>
</template>
