<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, send, money } from '../api';
import CustomerFrame from '../components/CustomerFrame.vue';

const route = useRoute();
const router = useRouter();
const names = { pending: '待商家确认', confirmed: '商家已确认', completed: '已完成', cancelled: '已取消', rejected: '未接受' };
const payNames = { unpaid: '待支付', paid: '已支付', refunded: '已退款' };
let cached = null;
try { cached = JSON.parse(sessionStorage.getItem('last-booking') || 'null'); } catch { /* ignore broken session cache */ }
const result = ref(cached && (!route.query.code || cached.code === route.query.code) ? cached : null);
const error = ref('');
const notice = ref('');
const loading = ref(false);
const acting = ref(false);
const phone = ref('');
const lookupCode = ref(String(route.query.code || ''));
const lookupOpen = ref(false);
const showReceipt = computed(() => result.value && !lookupOpen.value);

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
    lookupOpen.value = false;
  } catch (e) {
    if (!result.value) error.value = e.message;
    else error.value = `暂时无法刷新进度：${e.message}`;
  } finally { loading.value = false; }
}

async function lookup() {
  error.value = '';
  const code = lookupCode.value.trim().toUpperCase();
  if (!/^YK[A-Z0-9]{10,32}$/.test(code)) {
    error.value = '请输入完整预约编号，例如 YK 开头的一串编号';
    return;
  }
  lookupCode.value = code;
  if (String(route.query.code || '') === code) {
    lookupOpen.value = false;
    await refresh();
    return;
  }
  await router.push({ path: `/s/${route.params.slug}/success`, query: { code } });
}

async function pay() {
  if (!result.value || acting.value) return;
  acting.value = true;
  error.value = '';
  notice.value = '';
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
  acting.value = true;
  error.value = '';
  notice.value = '';
  try {
    const data = await send(`/public/shops/${route.params.slug}/bookings/${encodeURIComponent(result.value.code)}/cancel`, { contact_phone: phone.value });
    notice.value = data.payment_status === 'refunded' ? '预约已取消，款项已退回。' : '预约已取消。';
    await refresh();
  } catch (e) { error.value = e.message; }
  finally { acting.value = false; }
}

onMounted(refresh);
watch(() => route.query.code, code => {
  if (!code) return;
  lookupCode.value = String(code);
  refresh();
});
</script>

<template>
  <CustomerFrame tab="progress">
    <template v-if="showReceipt">
      <h1 class="c-display">预约进度</h1>
      <p class="c-lead">请保存预约编号。刷新后仍可查询。查询不会显示电话、邮箱或姓名，支付和取消时需要重新填写预约时使用的电话。</p>
      <dl class="c-spec">
        <div><dt>预约编号</dt><dd>{{ result.code }}</dd></div>
        <div><dt>拍摄服务</dt><dd>{{ result.title }}</dd></div>
        <div><dt>意向时间</dt><dd>{{ result.date }} · {{ result.time }}</dd></div>
        <div><dt>时区</dt><dd>{{ result.time_zone_label || '工作室时区' }}（{{ result.time_zone || '—' }}）</dd></div>
        <div><dt>状态</dt><dd>{{ names[result.status] || result.status || '待商家确认' }}</dd></div>
        <div><dt>支付</dt><dd>{{ payNames[result.payment_status] || result.payment_status || '待支付' }}<template v-if="result.price"> · {{ money(result.price) }}</template></dd></div>
      </dl>
      <div v-if="result.status === 'pending' || result.status === 'confirmed'" class="c-stack">
        <label class="c-field">预约电话
          <input v-model.trim="phone" maxlength="25" inputmode="tel" autocomplete="tel" placeholder="与提交预约时相同" />
        </label>
        <button v-if="result.payment_status === 'unpaid'" class="c-btn" type="button" :disabled="acting" @click="pay">{{ acting ? '处理中…' : '完成支付' }}</button>
        <button class="c-btn alt" type="button" :disabled="acting" @click="cancelBooking">取消预约</button>
        <p class="c-note">取消规则：待确认或已确认可以取消。未支付直接取消；已支付会退款并记为已退款。已确认取消后释放摄影师、场地和设备。已完成、已拒绝、已取消不能再取消。取消后会发送邮件和短信。</p>
      </div>
      <p v-if="notice" class="c-note">{{ notice }}</p>
      <p v-if="error" class="c-alert" role="alert">{{ error }}</p>
      <div class="c-stack">
        <button class="c-btn alt" type="button" :disabled="loading" @click="refresh">{{ loading ? '正在刷新…' : '刷新进度' }}</button>
        <button class="c-text" type="button" @click="lookupOpen = true; lookupCode = ''">查询其他编号</button>
      </div>
      <p class="c-note">查询只返回预约状态、支付状态和时区，不显示联系电话和姓名。</p>
    </template>
    <div v-else-if="loading && route.query.code" class="c-empty">
      <p>正在查询预约。</p>
    </div>
    <div v-else class="c-empty">
      <p>输入预约编号查看进度，这里不显示电话和姓名。</p>
      <form class="c-stack" @submit.prevent="lookup">
        <label class="c-field">预约编号
          <input v-model.trim="lookupCode" maxlength="40" autocomplete="off" placeholder="YK 开头的编号" required />
        </label>
        <p v-if="error" class="c-alert" role="alert">{{ error }}</p>
        <button class="c-btn" type="submit">查询</button>
      </form>
    </div>
  </CustomerFrame>
</template>
