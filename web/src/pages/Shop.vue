<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api, money } from '../api';
import CustomerFrame from '../components/CustomerFrame.vue';

const route = useRoute();
const shop = ref(null);
const services = ref([]);
const error = ref('');
const loading = ref(true);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const slug = route.params.slug;
    const [studio, catalog] = await Promise.all([
      api('/public/shops/' + slug),
      api('/public/shops/' + slug + '/services')
    ]);
    shop.value = studio.merchant;
    services.value = catalog.items;
  } catch (e) {
    shop.value = null;
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <CustomerFrame tab="book">
    <template #end>
      <router-link to="/login" class="c-quiet">商家入口</router-link>
    </template>
    <template v-if="shop">
      <h1 class="c-display">{{ shop.name }}</h1>
      <p v-if="shop.intro" class="c-lead">{{ shop.intro }}</p>
      <p v-if="shop.address" class="c-note">{{ shop.address }}</p>
      <p v-if="shop.time_zone" class="c-note">档期按 {{ shop.time_zone_label || shop.time_zone }}（{{ shop.time_zone }}）展示</p>
      <div v-if="services.length" class="c-list">
        <router-link v-for="s in services" :key="s.id" class="c-row" :to="`/s/${route.params.slug}/book/${s.id}`">
          <span>
            <strong>{{ s.title }}</strong>
            <small v-if="s.description">{{ s.description }}</small>
            <small>约 {{ s.duration_minutes }} 分钟</small>
          </span>
          <span class="c-price">{{ money(s.price_cents) }} 起</span>
        </router-link>
      </div>
      <div v-else class="c-empty is-section">
        <p>这家工作室暂时没有可预约的项目。</p>
        <router-link class="c-btn" :to="`/s/${route.params.slug}/success`">查看进度</router-link>
      </div>
    </template>
    <div v-else class="c-empty">
      <p>{{ loading ? '正在打开工作室。' : error }}</p>
      <button v-if="!loading && error" class="c-btn" type="button" @click="load">重试</button>
    </div>
  </CustomerFrame>
</template>
