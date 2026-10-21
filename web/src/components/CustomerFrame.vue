<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';

defineProps({
  tab: { type: String, required: true }
});

const route = useRoute();
const home = computed(() => `/s/${route.params.slug}`);
const progress = computed(() => ({
  path: `/s/${route.params.slug}/success`,
  query: route.query.code ? { code: route.query.code } : {}
}));
</script>

<template>
  <div class="customer">
    <header v-if="$slots.lead || $slots.end" class="c-bar">
      <div><slot name="lead" /></div>
      <div><slot name="end" /></div>
    </header>
    <div class="c-scroll">
      <div class="c-column">
        <slot />
      </div>
    </div>
    <div class="c-dock">
      <div v-if="$slots.action" class="c-action">
        <slot name="action" />
      </div>
      <nav class="c-tabs" aria-label="顾客">
        <router-link :to="home" :class="{ 'is-on': tab === 'book' }" :aria-current="tab === 'book' ? 'page' : undefined">预约</router-link>
        <router-link :to="progress" :class="{ 'is-on': tab === 'progress' }" :aria-current="tab === 'progress' ? 'page' : undefined">进度</router-link>
      </nav>
    </div>
  </div>
</template>
