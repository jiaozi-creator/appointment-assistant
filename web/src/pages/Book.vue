<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, send, money } from '../api';
import CustomerFrame from '../components/CustomerFrame.vue';

const route = useRoute();
const router = useRouter();
const shop = ref(null);
const service = ref(null);
const daysOff = ref([]);
const packages = ref([]);
const selectedPackage = ref('');
const error = ref('');
const busy = ref(false);
const zoneName = ref('Asia/Shanghai');
const zoneLabelText = ref('中国标准时间');
const shopDay = (offset = 0) => new Intl.DateTimeFormat('sv-SE', { timeZone: zoneName.value, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86400000));
const initial = shopDay(1);
const form = ref({ preferred_date: initial, preferred_time: '10:00', contact_name: '', contact_phone: '', contact_email: '', note: '', consent: false, website: '' });
const times = Array.from({ length: 24 }, (_, i) => String(9 + Math.floor(i / 2)).padStart(2, '0') + ':' + (i % 2 ? '30' : '00'));
const maxDate = computed(() => shopDay(180));
const unavailable = computed(() => daysOff.value.includes(form.value.preferred_date));
const chosen = computed(() => packages.value.find(p => p.id === selectedPackage.value));
const slots = ref([]);
const slotLoading = ref(false);
const offeredTimes = computed(() => times.filter(t => slots.value.includes(t)));
const step = ref(0);
const stepTitle = ['选择套餐', '选择日期', '选择时段', '留下联系方式', '确认预约'];
let availabilityVersion = 0;

async function loadAvailability() {
  if (!form.value.preferred_date || !service.value || !selectedPackage.value) return;
  const requestVersion = ++availabilityVersion;
  slotLoading.value = true;
  error.value = '';
  try {
    const r = await api(`/public/shops/${route.params.slug}/availability?` + new URLSearchParams({ date: form.value.preferred_date, service_id: service.value.id, package_id: selectedPackage.value }));
    if (requestVersion !== availabilityVersion) return;
    slots.value = r.available_slots || [];
    if (!offeredTimes.value.includes(form.value.preferred_time)) form.value.preferred_time = offeredTimes.value[0] || '';
  } catch (e) {
    if (requestVersion === availabilityVersion) error.value = e.message;
  } finally {
    if (requestVersion === availabilityVersion) slotLoading.value = false;
  }
}

watch(() => [form.value.preferred_date, selectedPackage.value], loadAvailability);

onMounted(async () => {
  try {
    const slug = route.params.slug;
    const [m, s, d] = await Promise.all([
      api('/public/shops/' + slug),
      api('/public/shops/' + slug + '/services'),
      api('/public/shops/' + slug + '/days-off')
    ]);
    shop.value = m.merchant;
    zoneName.value = m.merchant.time_zone || 'Asia/Shanghai';
    zoneLabelText.value = m.merchant.time_zone_label || zoneName.value;
    const tomorrow = shopDay(1);
    if (form.value.preferred_date < tomorrow) form.value.preferred_date = tomorrow;
    service.value = s.items.find(x => x.id === route.params.serviceId);
    daysOff.value = d.dates;
    if (!service.value) throw Error('服务不存在或已下架');
    packages.value = (await api('/public/shops/' + slug + '/packages?service_id=' + service.value.id)).items;
    selectedPackage.value = packages.value[0]?.id || '';
    if (!selectedPackage.value) throw Error('该服务暂无可预约套餐');
    await loadAvailability();
  } catch (e) {
    error.value = e.message;
  }
});

const stepBlocked = computed(() => {
  if (step.value === 1) return unavailable.value || !form.value.preferred_date;
  if (step.value === 2) return slotLoading.value || !offeredTimes.value.length || !form.value.preferred_time;
  return false;
});

function back() {
  error.value = '';
  if (step.value === 0) router.push(`/s/${route.params.slug}`);
  else step.value -= 1;
}

function nextStep() {
  error.value = '';
  if (step.value === 0 && !selectedPackage.value) {
    error.value = '请选择套餐';
    return;
  }
  if (step.value === 1 && (unavailable.value || !form.value.preferred_date)) {
    error.value = unavailable.value ? '该日期工作室暂停接单，请更换日期' : '请选择日期';
    return;
  }
  if (step.value === 2 && (unavailable.value || !form.value.preferred_time || !offeredTimes.value.includes(form.value.preferred_time))) {
    error.value = '请选择一个尚未被确认占用的时段';
    return;
  }
  if (step.value === 3 && (!form.value.contact_name || !form.value.contact_phone || !form.value.contact_email || !form.value.consent)) {
    error.value = '请填写联系方式并同意告知';
    return;
  }
  step.value += 1;
}

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (unavailable.value || !form.value.preferred_time || !offeredTimes.value.includes(form.value.preferred_time)) throw Error('请选择一个尚未被确认占用的时段');
    const key = crypto.randomUUID().replaceAll('-', '');
    const payload = { ...form.value, service_id: service.value.id, package_id: selectedPackage.value };
    const result = await send(`/public/shops/${route.params.slug}/bookings`, payload, 'POST', { 'Idempotency-Key': key });
    sessionStorage.setItem('last-booking', JSON.stringify({ code: result.code, title: service.value.title + ' · ' + chosen.value.title, date: form.value.preferred_date, time: form.value.preferred_time, status: 'pending' }));
    router.replace({ path: `/s/${route.params.slug}/success`, query: { code: result.code } });
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <CustomerFrame tab="book">
    <template #lead>
      <button class="c-text" type="button" @click="back">返回</button>
    </template>
    <template v-if="shop && service">
      <p class="c-note">{{ service.title }}</p>
      <p class="c-step">{{ step + 1 }} / 5</p>
      <h1 class="c-title">{{ stepTitle[step] }}</h1>

      <div v-if="step === 0">
        <div class="c-choices">
          <button v-for="p in packages" :key="p.id" type="button" class="c-choice" :class="{ 'is-on': selectedPackage === p.id }" :aria-pressed="selectedPackage === p.id" @click="selectedPackage = p.id">
            <span>
              <strong>{{ p.title }}</strong>
              <small>{{ p.duration_minutes }} 分钟 · {{ money(p.price_cents) }}</small>
            </span>
            <span v-if="selectedPackage === p.id" class="c-mark" aria-hidden="true"></span>
          </button>
        </div>
        <p v-if="chosen" class="c-note">{{ chosen.description }} · 准备{{ chosen.buffer_before }}分钟 / 收尾{{ chosen.buffer_after }}分钟</p>
      </div>

      <div v-else-if="step === 1">
        <label class="c-field">日期
          <input v-model="form.preferred_date" type="date" :min="initial" :max="maxDate" required />
        </label>
        <p v-if="unavailable" class="c-alert">该日期工作室暂停接单，请更换日期</p>
        <p class="c-note">时间按工作室时区 {{ zoneLabelText }}（{{ zoneName }}）计算，与页面上的日期时段一致。</p>
      </div>

      <div v-else-if="step === 2">
        <p class="c-note">时间按工作室时区 {{ zoneLabelText }}（{{ zoneName }}）计算。已确认预约的时段会自动隐藏。</p>
        <p v-if="slotLoading" class="c-note">正在检查档期。</p>
        <div v-else-if="!offeredTimes.length" class="c-empty is-section">
          <p>当天暂无可选时段，请更换日期。</p>
          <button class="c-btn" type="button" @click="step = 1">更换日期</button>
        </div>
        <template v-else>
          <p class="c-note">提交仍是意向申请，需商家确认。</p>
          <div class="c-choices">
            <button v-for="t in offeredTimes" :key="t" type="button" class="c-choice" :class="{ 'is-on': form.preferred_time === t }" :aria-pressed="form.preferred_time === t" @click="form.preferred_time = t">
              <strong>{{ t }}</strong>
              <span v-if="form.preferred_time === t" class="c-mark" aria-hidden="true"></span>
            </button>
          </div>
        </template>
      </div>

      <form v-else-if="step === 3" id="contact-form" @submit.prevent="nextStep">
        <p class="c-note">填写拍摄意向，工作室核对档期后将与你联系。</p>
        <label class="c-field">怎么称呼你
          <input v-model.trim="form.contact_name" maxlength="40" autocomplete="name" placeholder="例如：陈女士" required />
        </label>
        <label class="c-field">联系电话
          <input v-model.trim="form.contact_phone" maxlength="25" inputmode="tel" autocomplete="tel" placeholder="商家确认预约时联系" required />
        </label>
        <label class="c-field">联系邮箱
          <input v-model.trim="form.contact_email" type="email" maxlength="180" autocomplete="email" placeholder="接收预约、确认和取消通知" required />
        </label>
        <label class="c-field">其他拍摄想法（选填）
          <textarea v-model="form.note" maxlength="500" rows="4" placeholder="如拍摄人数、风格偏好或其他需求"></textarea>
        </label>
        <input v-model="form.website" class="c-trap" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <label class="c-consent">
          <input v-model="form.consent" type="checkbox" required />
          <span>我同意提供以上信息给该工作室用于联系和处理本次预约。数据仅用于预约服务，请勿填写身份证号或其他敏感资料。</span>
        </label>
      </form>

      <div v-else>
        <dl class="c-spec">
          <div><dt>项目</dt><dd>{{ service.title }}</dd></div>
          <div><dt>套餐</dt><dd>{{ chosen?.title }}</dd></div>
          <div><dt>参考价格</dt><dd>{{ money(chosen?.price_cents ?? service.price_cents) }}</dd></div>
          <div><dt>预计时长</dt><dd>{{ chosen?.duration_minutes ?? service.duration_minutes }} 分钟</dd></div>
          <div><dt>意向时间</dt><dd>{{ form.preferred_date }} · {{ form.preferred_time }}</dd></div>
          <div><dt>时区</dt><dd>{{ zoneLabelText }}（{{ zoneName }}）</dd></div>
          <div><dt>联系人</dt><dd>{{ form.contact_name }}</dd></div>
          <div><dt>电话</dt><dd>{{ form.contact_phone }}</dd></div>
          <div><dt>邮箱</dt><dd>{{ form.contact_email }}</dd></div>
        </dl>
        <p class="c-note">预约申请免费提交，具体价格与服务以商家确认为准。</p>
      </div>
      <p v-if="error" class="c-alert" role="alert">{{ error }}</p>
    </template>
    <div v-else class="c-empty">
      <p>{{ error || '正在打开预约。' }}</p>
      <router-link v-if="error" class="c-btn" :to="`/s/${route.params.slug}`">返回预约</router-link>
    </div>
    <template v-if="shop && service && !(step === 2 && !slotLoading && !offeredTimes.length)" #action>
      <button v-if="step === 3" class="c-btn" type="submit" form="contact-form">下一步</button>
      <button v-else-if="step < 4" class="c-btn" type="button" :disabled="stepBlocked" @click="nextStep">下一步</button>
      <button v-else class="c-btn" type="button" :disabled="busy || unavailable || slotLoading || !offeredTimes.length" @click="submit">{{ busy ? '正在提交…' : '提交预约申请' }}</button>
    </template>
  </CustomerFrame>
</template>
