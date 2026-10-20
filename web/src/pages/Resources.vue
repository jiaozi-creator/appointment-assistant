<script setup>
import { ref,onMounted,computed } from 'vue';
import {api,send} from '../api';
const props=defineProps({readonly:{type:Boolean,default:false}});
const resources=ref([]),blocks=ref([]),selectedDate=ref(new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}));
const calendar=ref({items:[],blocks:[]}),error=ref(''),message=ref(''),loading=ref(false);
const typeLabel={photographer:'摄影师',room:'场地',equipment:'设备'};
const item=ref({kind:'photographer',name:'',capacity:1});
const block=ref({resource_id:'',date:selectedDate.value,start_time:'09:00',end_time:'12:00',reason:''});
const edited=ref(null),weekly=ref(null);
const hourDays=['周日','周一','周二','周三','周四','周五','周六'];
const weeklyDays=ref([1,2,3,4,5,6,0]);const weeklyStart=ref('09:00'),weeklyEnd=ref('21:00');
const existingNames=computed(()=>Object.fromEntries(resources.value.map(r=>[r.id,r.name])));
function hh(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')}
async function load(){try{error.value='';const [a,b,c]=await Promise.all([api('/admin/resources'),api('/admin/resource-blocks?date='+selectedDate.value),api('/admin/resource-calendar?date='+selectedDate.value)]);resources.value=a.items;blocks.value=b.items;calendar.value=c;if(!block.value.resource_id)block.value.resource_id=resources.value[0]?.id||''}catch(e){error.value=e.message}}
async function saveResource(){loading.value=true;try{const data={...item.value,capacity:Number(item.value.capacity)};await send('/admin/resources',data);item.value={kind:'photographer',name:'',capacity:1};message.value='资源已创建';await load()}catch(e){error.value=e.message}finally{loading.value=false}}
async function saveEdit(){loading.value=true;try{await send('/admin/resources/'+edited.value.id,{name:edited.value.name,capacity:Number(edited.value.capacity),active:!!edited.value.active},'PATCH');edited.value=null;message.value='资源已更新';await load()}catch(e){error.value=e.message}finally{loading.value=false}}
async function addBlock(){loading.value=true;try{await send('/admin/resource-blocks',{...block.value,date:selectedDate.value,start_time:clock(block.value.start_time),end_time:clock(block.value.end_time)});message.value='不可用时段已保存';await load()}catch(e){error.value=e.message}finally{loading.value=false}}
async function deleteBlock(id){if(!window.confirm('确定解除该资源的封档？'))return;try{await api('/admin/resource-blocks/'+id,{method:'DELETE'});await load()}catch(e){error.value=e.message}}
async function openWeekly(r){try{weeklyDays.value=[1,2,3,4,5,6,0];weeklyStart.value='09:00';weeklyEnd.value='21:00';const d=await api(`/admin/resources/${r.id}/weekly-hours`);weekly.value={id:r.id,name:r.name,hours:d.items};if(d.items.length){weeklyDays.value=[...new Set(d.items.map(x=>x.weekday))];weeklyStart.value=hh(d.items[0].start_min);weeklyEnd.value=hh(d.items[0].end_min)}}catch(e){error.value=e.message}}
function clock(value){return String(value||'').slice(0,5)}
async function saveWeekly(){loading.value=true;try{const hours=weeklyDays.value.map(weekday=>({weekday:Number(weekday),start_time:clock(weeklyStart.value),end_time:clock(weeklyEnd.value)}));await send('/admin/resources/'+weekly.value.id+'/weekly-hours',{hours},'PUT');weekly.value=null;message.value='每周时段已更新';await load()}catch(e){error.value=e.message}finally{loading.value=false}}
onMounted(load);
</script>
<template>
<div class="panel resource-panel">
  <div class="panel-head"><div><h2>资源与档期</h2><p>同一套配置支持一名摄影师，也支持摄影师、场地和共享设备协同接单。</p></div></div>
  <p v-if="error" class="alert">{{error}}</p><p v-if="message" class="hint">✓ {{message}}</p>
  <div class="resource-grid">
    <article v-for="r in resources" :key="r.id" class="resource-tile">
      <span class="eyebrow dark">{{typeLabel[r.kind]}} · {{r.active?'启用':'停用'}}</span>
      <h3>{{r.name}}</h3><p>同时容量：{{r.capacity}}</p>
      <div class="resource-actions"><button class="outline-action" @click="openWeekly(r)">每周时段</button><button v-if="!readonly" class="outline-action" @click="edited={...r,active:!!r.active}">编辑资源</button></div>
    </article>
  </div>
  <form v-if="!readonly" class="settings-form section-gap" @submit.prevent="saveResource">
    <h3>新增资源</h3>
    <div class="form-grid"><label>类别<select v-model="item.kind" @change="item.capacity=1"><option value="photographer">摄影师</option><option value="room">场地</option><option value="equipment">设备</option></select></label><label>显示名称<input v-model.trim="item.name" maxlength="80" placeholder="如：摄影师小林 / 一号影棚" required/></label></div>
    <label>可同时分配数量<input v-model.number="item.capacity" type="number" min="1" :max="item.kind==='equipment'?50:1" required/><small class="hint">摄影师和场地固定为1；设备可按库存设置数量。</small></label>
    <button class="button primary" :disabled="loading">添加资源</button>
  </form>
  <div class="section-gap"><div class="panel-head"><div><h3>每日资源排期</h3><p>只有已确认的预约占用资源，待确认预约不锁定资源。</p></div></div>
    <label>查看日期 <input type="date" v-model="selectedDate" @change="block.date=selectedDate;load()"/></label>
    <div v-if="calendar.items.length" class="calendar-list"><div v-for="entry in calendar.items" :key="entry.booking_id+'-'+entry.resource_id" class="resource-calendar-row"><strong>{{entry.name}} ×{{entry.quantity}}</strong><span>{{entry.preferred_time}} · {{entry.duration_minutes}}分钟 · {{entry.code}}</span></div></div><p v-else class="muted">这一天还没有已确认的资源占用。</p>
  </div>
  <div class="section-gap"><h3>临时封档</h3><p class="muted">例如设备维修、摄影师请假或影棚临时关闭。存在已确认占用时不允许封档。</p>
    <div v-for="entry in blocks" :key="entry.id" class="resource-calendar-row"><span>{{existingNames[entry.resource_id]}}：{{hh(entry.start_min)}}–{{hh(entry.end_min)}} · {{entry.reason||'不可用'}}</span><button v-if="!readonly" class="text-button" @click="deleteBlock(entry.id)">解除</button></div>
    <form v-if="!readonly" class="settings-form" @submit.prevent="addBlock"><div class="form-grid"><label>资源<select v-model="block.resource_id" required><option v-for="r in resources" :key="r.id" :value="r.id">{{r.name}}</option></select></label><label>原因<input v-model="block.reason" maxlength="200" placeholder="例：设备维护"/></label><label>开始<input v-model="block.start_time" type="time" required/></label><label>结束<input v-model="block.end_time" type="time" required/></label></div><button class="button primary" :disabled="loading||!resources.length">保存封档</button></form>
  </div>
  <div v-if="edited" class="modal-overlay" @click.self="edited=null"><form class="edit-modal" @submit.prevent="saveEdit"><div class="modal-head"><h2>编辑资源</h2><button type="button" @click="edited=null">✕</button></div><label>资源名称<input v-model.trim="edited.name" maxlength="80" required/></label><label>容量<input v-model.number="edited.capacity" type="number" min="1" :max="edited.kind==='equipment'?50:1" required/></label><label class="consent"><input type="checkbox" v-model="edited.active"/> 启用该资源</label><button class="button primary" :disabled="loading">保存</button></form></div>
  <div v-if="weekly" class="modal-overlay" @click.self="weekly=null"><form class="edit-modal" @submit.prevent="saveWeekly"><div class="modal-head"><h2>{{weekly.name}} · 每周可用时段</h2><button type="button" @click="weekly=null">✕</button></div><p class="muted">下列每周规则只对该资源生效；不选任何日期即清除限制。已确认预约不会被新的限制覆盖。</p><div class="weekday-pills"><label v-for="(day,i) in hourDays" :key="i"><input type="checkbox" :value="i" v-model="weeklyDays" :disabled="readonly"/> {{day}}</label></div><div class="form-grid"><label>开始<input type="time" v-model="weeklyStart" :disabled="readonly" required/></label><label>结束<input type="time" v-model="weeklyEnd" :disabled="readonly" required/></label></div><p class="hint">{{readonly?'员工只能查看每周时段，修改需要所有者权限。':'此简化编辑器每周只设置一个时间段；API支持一天多段，例如09–12点和14–18点。'}}</p><button v-if="!readonly" class="button primary" :disabled="loading">保存工作时段</button></form></div>
</div>
</template>
