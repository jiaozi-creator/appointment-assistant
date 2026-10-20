<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
const route = useRoute();
const names = { pending:'待商家确认', confirmed:'商家已确认', completed:'已完成', cancelled:'已取消', rejected:'未接受' };
let cached = null;
try { cached = JSON.parse(sessionStorage.getItem('last-booking') || 'null'); } catch { /* ignore broken session cache */ }
const result = ref(cached && (!route.query.code || cached.code === route.query.code) ? cached : null);
const error = ref('');
const loading = ref(false);
async function refresh() {
  const code = String(route.query.code || result.value?.code || '').trim();
  if (!code) return;
  loading.value = true;
  error.value = '';
  try {
    const data = await api(`/public/shops/${route.params.slug}/bookings/${encodeURIComponent(code)}`);
    const booking = data.booking;
    result.value = {
      code: booking.code,
      title: `${booking.service_title}${booking.package_title ? ' · ' + booking.package_title : ''}`,
      date: booking.preferred_date,
      time: booking.preferred_time,
      status: booking.status
    };
  } catch (e) {
    if (!result.value) error.value = e.message;
    else error.value = `暂时无法刷新进度：${e.message}`;
  } finally { loading.value = false; }
}
onMounted(refresh);
</script>
<template>
  <div class="success-page"><div class="success-card"><div class="success-mark">✓</div><div class="eyebrow dark">REQUEST RECEIVED</div><h1>预约进度</h1>
    <p v-if="result">你的拍摄申请已记录。工作室确认档期后会根据预留方式与你联系。请保存本页或预约编号，刷新后仍可查询。</p>
    <p v-else>输入过的预约编号可以在工作室主页再次查询。当前页面没有可展示的回执。</p>
    <div v-if="result" class="receipt"><div><span>预约编号</span><strong>{{result.code}}</strong></div><div><span>拍摄服务</span><strong>{{result.title}}</strong></div><div><span>意向日期</span><strong>{{result.date}} · {{result.time}}</strong></div><div><span>状态</span><strong>{{names[result.status]||result.status||'待商家确认'}}</strong></div></div>
    <p v-if="error" class="alert">{{error}}</p>
    <div class="resource-actions" style="justify-content:center"><button v-if="result" class="outline-action" type="button" :disabled="loading" @click="refresh">{{loading?'正在刷新…':'刷新进度'}}</button><router-link class="button primary" :to="`/s/${route.params.slug}`">返回工作室主页 ↗</router-link></div>
    <p class="tiny">查询只返回预约状态，不显示联系电话和姓名。</p>
  </div></div>
</template>
