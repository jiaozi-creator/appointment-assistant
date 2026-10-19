<script setup>
import {ref,onMounted,computed} from 'vue';
import {api,send,money} from '../api';
const props=defineProps({readonly:{type:Boolean,default:false}});
const services=ref([]),packages=ref([]),form=ref(null),error=ref(''),notice=ref(''),saving=ref(false);
const names={photographer:'摄影师人数',room:'场地数量',equipment:'设备份数'};
const byService=computed(()=>Object.fromEntries(services.value.map(s=>[s.id,s.title])));
const rules=p=>Object.fromEntries(p.requirements.map(x=>[x.kind,x.quantity]));
function edit(p=null){const counts=p?rules(p):{photographer:1};form.value=p?{...p,counts:{...counts}}:{service_id:services.value[0]?.id||'',title:'',description:'',price_cents:39900,duration_minutes:90,buffer_before:15,buffer_after:15,active:true,counts};}
async function load(){try{error.value='';const [a,b]=await Promise.all([api('/admin/services'),api('/admin/packages')]);services.value=a.items;packages.value=b.items}catch(e){error.value=e.message}}
async function save(){saving.value=true;try{const p=form.value;const requirements=Object.entries(p.counts).filter(([,value])=>Number(value)>0).map(([kind,quantity])=>({kind,quantity:Number(quantity)}));await send('/admin/packages'+(p.id?'/'+p.id:''),{service_id:p.service_id,title:p.title,description:p.description,price_cents:Number(p.price_cents),duration_minutes:Number(p.duration_minutes),buffer_before:Number(p.buffer_before),buffer_after:Number(p.buffer_after),active:p.active,requirements},p.id?'PATCH':'POST');notice.value='套餐已保存，旧预约保留创建时的配置快照';form.value=null;await load()}catch(e){error.value=e.message}finally{saving.value=false}}
async function disable(p){if(!confirm('确定下架这个套餐？旧预约不受影响。'))return;try{await api('/admin/packages/'+p.id,{method:'DELETE'});notice.value='已下架';await load()}catch(e){error.value=e.message}}
onMounted(load);
</script>
<template><div class="panel"><div class="panel-head"><div><h2>摄影套餐与资源需求</h2><p>一个服务可以提供多个套餐；配置拍摄时长、前后准备时间及必需资源。</p></div><button v-if="!readonly&&services.length" class="button primary" @click="edit()">＋ 新建套餐</button></div>
  <p v-if="error" class="alert">{{error}}</p><p v-if="notice" class="hint">✓ {{notice}}</p>
  <div v-if="!packages.length" class="empty">还没有套餐，请先在「拍摄服务」创建服务。</div>
  <div class="package-list"><article v-for="p in packages" :key="p.id" class="package-tile"><div><div class="eyebrow dark">{{byService[p.service_id]}} · {{p.is_default?'默认套餐':'定制套餐'}} · {{p.active?'上架':'下架'}}</div><h3>{{p.title}} <span class="muted">{{money(p.price_cents)}}</span></h3><p class="muted">{{p.duration_minutes}}分钟拍摄 · 前置{{p.buffer_before}}分钟 · 后置{{p.buffer_after}}分钟</p><p class="muted">{{p.requirements.map(r=>names[r.kind]+' '+r.quantity).join(' / ')}}</p></div><div v-if="!readonly" class="resource-actions"><button class="outline-action" @click="edit(p)">配置套餐</button><button v-if="!p.is_default&&p.active" class="text-button" @click="disable(p)">下架</button></div></article></div>
  <div v-if="form" class="modal-overlay" @click.self="form=null"><form class="edit-modal" @submit.prevent="save"><div class="modal-head"><h2>{{form.id?'编辑套餐':'新建套餐'}}</h2><button type="button" @click="form=null">✕</button></div>
    <label>所属服务<select v-model="form.service_id" :disabled="!!form.id" required><option v-for="s in services" :key="s.id" :value="s.id">{{s.title}}</option></select></label><label>套餐名称<input v-model.trim="form.title" maxlength="80" required/></label><label>套餐说明<textarea v-model="form.description" rows="2" maxlength="1000"></textarea></label>
    <div class="form-grid"><label>价格（分）<input type="number" v-model.number="form.price_cents" min="0" required/></label><label>拍摄分钟<input type="number" v-model.number="form.duration_minutes" min="15" max="720" required/></label><label>前置准备分钟<input type="number" v-model.number="form.buffer_before" min="0" max="180" required/></label><label>后置收尾分钟<input type="number" v-model.number="form.buffer_after" min="0" max="180" required/></label></div>
    <h3>资源规则</h3><div class="form-grid"><label>摄影师数量<input type="number" v-model.number="form.counts.photographer" min="1" max="50" required/></label><label>场地数量<input type="number" v-model.number="form.counts.room" min="0" max="50" placeholder="0 表示不需要"/></label><label>设备份数<input type="number" v-model.number="form.counts.equipment" min="0" max="50" placeholder="0 表示不需要"/></label></div>
    <label class="consent"><input type="checkbox" v-model="form.active"/> 上架此套餐</label><p class="hint">套餐规则会在客户提交预约时生成快照；改价或改规则不会改写历史订单。</p>
    <button class="button primary" :disabled="saving">{{saving?'保存中…':'保存套餐'}}</button></form></div>
</div></template>
