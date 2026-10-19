<script setup>
import {ref,onMounted,computed} from 'vue';
import {api,send} from '../api';
const props=defineProps({booking:{type:Object,required:true}});
const emit=defineEmits(['close','confirmed']);
const info=ref(null),selected=ref({}),error=ref(''),submitting=ref(false);
const typeNames={photographer:'摄影师',room:'影棚 / 场地',equipment:'设备'};
const total=kind=>info.value?.resources.filter(r=>r.kind===kind).reduce((n,r)=>n+Number(selected.value[r.id]||0),0)||0;
const valid=computed(()=>info.value&&info.value.requirements.every(x=>total(x.kind)===x.quantity));
onMounted(async()=>{try{info.value=await api('/admin/bookings/'+props.booking.id+'/resource-needs');}catch(e){error.value=e.message}});
async function confirmAutomatic(){await submit(false)}
async function submit(manual=true){submitting.value=true;error.value='';try{
  const allocations=manual?Object.entries(selected.value).filter(([,quantity])=>Number(quantity)>0).map(([resource_id,quantity])=>({resource_id,quantity:Number(quantity)})):undefined;
  await send('/admin/bookings/'+props.booking.id+'/status',{status:'confirmed',...(manual?{allocations}:{})},'PATCH');emit('confirmed');
}catch(e){error.value=e.message}finally{submitting.value=false}}
</script>
<template><div class="modal-overlay" @click.self="emit('close')"><div class="edit-modal assignment-dialog"><div class="modal-head"><h2>为预约分配资源</h2><button @click="emit('close')">✕</button></div>
 <p class="muted">{{booking.code}} · {{booking.preferred_date}} {{booking.preferred_time}} · {{booking.duration_minutes}}分钟。多人工作室可手动指派具体摄影师、影棚与设备；也可让系统自动选择可用资源。</p>
 <p v-if="error" class="alert">{{error}}</p><div v-if="info">
 <div v-for="rule in info.requirements" :key="rule.kind" class="assign-group"><h3>{{typeNames[rule.kind]}} <small>需要 {{rule.quantity}} / 已选 {{total(rule.kind)}}</small></h3><div v-for="r in info.resources.filter(r=>r.kind===rule.kind)" :key="r.id" class="assign-item"><span>{{r.name}} <small>容量 {{r.capacity}}</small></span><label>数量<input v-model.number="selected[r.id]" type="number" min="0" :max="r.capacity"/></label></div><p v-if="!info.resources.some(r=>r.kind===rule.kind)" class="alert">尚未配置可用{{typeNames[rule.kind]}}，请在「资源与排期」先添加。</p></div>
 </div><p v-else class="muted">正在读取套餐所需资源…</p>
 <div class="resource-actions"><button class="button primary" :disabled="submitting||!valid" @click="submit(true)">按所选资源确认</button><button class="outline-action" :disabled="submitting||!info" @click="confirmAutomatic">由系统自动分配</button></div>
 </div></div></template>
