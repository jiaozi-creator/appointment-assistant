<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api, send, money } from '../api';
const route = useRoute();
const names = { pending:'待商家确认', confirmed:'商家已确认', completed:'已完成', cancelled:'已取消', rejected:'未接受' };
const payNames = { unpaid:'待支付', paid:'已支付', refunded:'已退款' };
let cached = null;
try { cached = JSON.parse(sessionStorage.getItem('last-booking') || 'null'); } catch { /* ignore broken session cache */ }
const result = ref(cached && (!route.query.code || cached.code === route.query.code) ? cached : null);
const error = ref('');
const notice = ref('');
const loading = ref(false);
const acting = ref(false);
const phone = ref('');
function applyBooking(booking) {
  result.value = {
    code: booking.code,
    title: `${booking.service_title}${booking.package_title ? ' · ' + booking.package_title : ''}`,
    date: booking.preferred_date,
    time: booking.preferred_time,
    status: booking.status,
    payment_status: booking.payment_status || 'unpaid',
    price: booking.package_price_cents || 0,
    time_zone: booking.time_zone,
    time_zone_label: booking.time_zone_label || booking.time_zone
  };
}
async function refresh() {
  const code = String(route.query.code || result.value?.code || '').trim();
  if (!code) return;
  loading.value = true;
  error.value = '';
  try {
    const data = await api(`/public/shops/${route.params.slug}/bookings/${encodeURIComponent(code)}`);
    applyBooking(data.booking);
  } catch (e) {
    if (!result.value) error.value = e.message;
    else error.value = `暂时无法刷新进度：${e.message}`;
  } finally { loading.value = false; }
}
async function pay() {
  if (!result.value || acting.value) return;
  acting.value = true; error.value = ''; notice.value = '';
  try {
    const data = await send(`/public/shops/${route.params.slug}/bookings/${encodeURIComponent(result.value.code)}/pay`, { contact_phone: phone.value });
    if (data.code_url) notice.value = `请用微信扫码支付：${data.code_url}。支付后再次点击查询支付结果。`;
    else notice.value = data.payment_status === 'paid' ? '支付已完成。' : '支付尚未完成。';
    await refresh();
  } catch (e) { error.value = e.message; }
  finally { acting.value = false; }
}
async function cancelBooking() {
  if (!result.value || acting.value) return;
  if (!confirm('确定取消这笔预约吗？已确认的档期会释放；已支付的金额会退回。')) return;
  acting.value = true; error.value = ''; notice.value = '';
  try {
    const data = await send(`/public/shops/${route.params.slug}/bookings/${encodeURIComponent(result.value.code)}/cancel`, { contact_phone: phone.value });
    notice.value = data.payment_status === 'refunded' ? '预约已取消，款项已退回。' : '预约已取消。';
    await refresh();
  } catch (e) { error.value = e.message; }
  finally { acting.value = false; }
}
onMounted(refresh);
</script>
<template>
  <div class="success-page"><div class="success-card"><div class="success-mark">✓</div><div class="eyebrow dark">REQUEST RECEIVED</div><h1>预约进度</h1>
    <p v-if="result">请保存预约编号。刷新后仍可查询。查询不会显示电话、邮箱或姓名，支付和取消时需要重新填写预约时使用的电话。</p>
    <p v-else>输入过的预约编号可以在工作室主页再次查询。当前页面没有可展示的回执。</p>
    <div v-if="result" class="receipt">
      <div><span>预约编号</span><strong>{{result.code}}</strong></div>
      <div><span>拍摄服务</span><strong>{{result.title}}</strong></div>
      <div><span>意向时间</span><strong>{{result.date}} · {{result.time}}</strong></div>
      <div><span>时区</span><strong>{{result.time_zone_label||'工作室时区'}}（{{result.time_zone||'—'}}）</strong></div>
      <div><span>状态</span><strong>{{names[result.status]||result.status||'待商家确认'}}</strong></div>
      <div><span>支付</span><strong>{{payNames[result.payment_status]||result.payment_status||'待支付'}}<template v-if="result.price"> · {{money(result.price)}}</template></strong></div>
    </div>
    <div v-if="result && (result.status==='pending' || result.status==='confirmed')" class="form-section">
      <label>预约电话<input v-model.trim="phone" maxlength="25" inputmode="tel" autocomplete="tel" placeholder="与提交预约时相同"/></label>
      <div class="resource-actions">
        <button v-if="result.payment_status==='unpaid'" class="button primary" type="button" :disabled="acting" @click="pay">{{acting?'处理中…':'完成支付'}}</button>
        <button class="outline-action" type="button" :disabled="acting" @click="cancelBooking">取消预约</button>
      </div>
      <p class="tiny">取消规则：待确认或已确认可以取消。未支付直接取消；已支付会退款并记为已退款。已确认取消后释放摄影师、场地和设备。已完成、已拒绝、已取消不能再取消。取消后会发送邮件和短信。</p>
    </div>
    <p v-if="notice" class="hint">{{notice}}</p>
    <p v-if="error" class="alert">{{error}}</p>
    <div class="resource-actions" style="justify-content:center"><button v-if="result" class="outline-action" type="button" :disabled="loading" @click="refresh">{{loading?'正在刷新…':'刷新进度'}}</button><router-link class="button primary" :to="`/s/${route.params.slug}`">返回工作室主页 ↗</router-link></div>
    <p class="tiny">查询只返回预约状态、支付状态和时区，不显示联系电话和姓名。</p>
  </div></div>
</template>
