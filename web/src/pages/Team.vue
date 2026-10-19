<script setup>
import {ref,onMounted} from 'vue';
import {api,send} from '../api';
const members=ref([]),invites=ref([]),email=ref(''),newUrl=ref(''),error=ref(''),notice=ref(''),busy=ref(false);
async function load(){try{const r=await api('/admin/team');members.value=r.members;invites.value=r.invitations;}catch(e){error.value=e.message;}}
onMounted(load);
async function make(){busy.value=true;error.value='';try{const r=await send('/admin/team/invitations',{email:email.value});newUrl.value=`${window.location.origin}/invite/${r.token}`;notice.value='一次性邀请已创建，请私下转发给该员工';email.value='';await load();}catch(e){error.value=e.message;}finally{busy.value=false;}}
async function revoke(i){if(!confirm(`撤销发送给 ${i.email} 的邀请？`))return;try{await send(`/admin/team/invitations/${i.id}/revoke`,{});await load();}catch(e){error.value=e.message;}}
async function active(m){if(!confirm(`${m.active?'停用':'重新启用'}员工 ${m.email}？`))return;try{await send(`/admin/team/members/${m.id}/active`,{active:!m.active},'PATCH');await load();}catch(e){error.value=e.message;}}
</script>
<template>
  <div class="panel"><div class="panel-head"><div><h2>团队与访问权限</h2><p>老板可以编辑服务、调整规则；员工仅能查看与处理预约。停用成员会立即注销其会话。</p></div></div>
    <form class="filter-row" @submit.prevent="make"><input v-model.trim="email" type="email" required maxlength="180" placeholder="员工邮箱，例如 name@example.com"/><button class="button primary" :disabled="busy">＋ 生成员工邀请</button></form>
    <div v-if="error" class="alert">{{error}}</div><div v-if="notice" class="notice-success">{{notice}}</div>
    <div v-if="newUrl" class="activation-card"><strong>邀请链接（仅本次可查看）</strong><p class="muted">请通过可信渠道私下分享链接，避免公开传播。48小时失效。</p><textarea :value="newUrl" readonly rows="2"/><button @click="newUrl=''" class="outline-action">关闭（已保存链接）</button></div>
    <h3>当前成员</h3><div v-for="m in members" :key="m.id" class="record-card"><div><strong>{{m.email}}</strong><small>{{m.role==='owner'?'所有者':'员工'}} · {{m.active?'启用':'已停用'}}</small></div><button v-if="m.role==='staff'" class="outline-action" @click="active(m)">{{m.active?'停用员工':'恢复员工'}}</button></div>
    <h3>历史邀请</h3><div v-for="i in invites" :key="i.id" class="record-card"><div><strong>{{i.email}}</strong><small>{{i.accepted_at?'已接受':i.revoked_at?'已撤销':i.expires_at<Date.now()?'已过期':'等待接受'}} · {{new Date(i.expires_at).toLocaleString('zh-CN')}}</small></div><button v-if="!i.accepted_at&&!i.revoked_at&&i.expires_at>Date.now()" class="outline-action" @click="revoke(i)">撤销</button></div>
  </div>
</template>
