<script setup lang="ts">
import Icon from "./Icon.vue";
defineProps<{
  icon?: string;
  label?: string;
  variant?: "primary" | "ghost" | "danger";
  busy?: boolean;
}>();
</script>
<template>
  <button
    class="button"
    :class="[variant || 'normal', { 'icon-only': !$slots.default, busy }]"
    :aria-label="label"
    :title="!$slots.default ? label : undefined"
    :disabled="busy"
  >
    <Icon
      v-if="busy || icon"
      :name="busy ? 'LoaderCircle' : icon!"
      :class="{ spin: busy }"
    /><slot />
  </button>
</template>
