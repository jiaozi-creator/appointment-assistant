<script setup>
import {ref,onMounted} from 'vue';
import {useRouter} from 'vue-router';
import {api,send} from '../api';
const router=useRouter(),user=ref(null),overview=ref({merchants:[],applications:[]}),applications=ref([]),error=ref(''),busy=ref(false),activation=ref(''),filter=ref('pending');
async function load(){try{overview.value=await api('/platform/overview');applications.value=(await api('/platform/applications?status='+filter.value)).items;}catch(e){error.value=e.message;}}
onMounted(async()=>{try{const me=await api('/auth/me');if(me.user.role!=='platform'){router.replace('/admin');return;}user.value=me.user;await load();}catch{router.replace('/login');}});
async function decision(app,choice){if(!confirm(choice==='approved'?`确定批准「${app.business_name}」？`: `确定拒绝「${app.business_name}」？`))return;busy.value=true;error.value='';try{const r=await send(`/platform/applications/${app.id}/decision`,{decision:choice});if(r.activation)activation.value=`${window.location.origin}/invite/${r.activation.token}`;await load();}catch(e){error.value=e.message;}finally{busy.value=false;}}
async function toggle(m){if(!confirm(`${m.active?'暂停':'启用'}工作室「${m.name}」？`))return;busy.value=true;try{await send(`/platform/merchants/${m.id}/active`,{active:!m.active},'PATCH');await load();}catch(e){error.value=e.message;}finally{busy.value=false;}}
async function resetActivation(m){if(!confirm(`重新为「${m.name}」生成开通邀请？旧邀请将失效。`))return;try{const r=await send(`/platform/merchants/${m.id}/activation`,{});activation.value=`${window.location.origin}/invite/${r.activation.token}`;}catch(e){error.value=e.message;}}
async function copyActivation(){try{await navigator.clipboard.writeText(activation.value);}catch{error.value='复制失败，请手动选择链接复制';}}
async function logout(){await send('/auth/logout',{});router.push('/login');}
</script>
<template>
  <div class="platform-page"><header class="platform-top"><strong>◈ 约客助手 · 平台运营</strong><div><span class="muted">{{user?.email}}</span> <button class="outline-action" @click="logout">退出</button></div></header>
    <main class="platform-content"><div class="admin-heading"><div><div class="eyebrow dark">PLATFORM OPERATIONS</div><h1>商家审核与治理<span class="dot">.</span></h1><p class="muted">仅限平台运营账号。平台账号默认不直接访问商家客户预约资料。</p></div></div>
    <div v-if="error" class="alert" role="alert">{{error}}</div>
    <section v-if="activation" class="activation-card"><h2>一次性开通邀请（仅显示本次）</h2><p>请通过可信的独立渠道核实申请人后私下发送链接；不要将链接发布在群聊或公开网页。</p><textarea readonly rows="2" :value="activation"/><button class="button dark" @click="copyActivation">复制邀请链接</button><button class="outline-action" @click="activation=''">我已妥善保存，关闭</button></section>
    <div class="stat-grid"><div class="stat-card"><span>工作室数量</span><strong>{{overview.merchants.length}}</strong></div><div class="stat-card"><span>待审核申请</span><strong>{{overview.applications.find(x=>x.status==='pending')?.count||0}}</strong></div></div>
    <section class="panel"><div class="panel-head"><div><h2>入驻审核</h2><p>审批之前请线下核实商家身份和联系方式。</p></div><select v-model="filter" @change="load"><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已拒绝</option><option value="all">全部</option></select></div>
      <div v-for="a in applications" :key="a.id" class="record-card"><div><strong>{{a.business_name}}</strong><small>标识：{{a.desired_slug}} · {{a.contact_email}} · {{a.created_at}}</small><p>{{a.message||'未填写业务简介'}}</p></div><div class="record-actions"><span class="status-pill" :class="a.status==='approved'?'confirmed':'pending'">{{a.status}}</span><button v-if="a.status==='pending'" :disabled="busy" class="button primary" @click="decision(a,'approved')">批准并生成邀请</button><button v-if="a.status==='pending'" :disabled="busy" class="outline-action" @click="decision(a,'rejected')">拒绝</button></div></div><div v-if="!applications.length" class="empty">暂无此状态的申请</div>
    </section>
    <section class="panel"><div class="panel-head"><h2>工作室列表</h2></div><div v-for="m in overview.merchants" :key="m.id" class="record-card"><div><strong>{{m.name}}</strong><small>/s/{{m.slug}} · {{m.active?'正在运营':'已停用'}}</small></div><div class="record-actions"><button class="outline-action" :disabled="busy" @click="toggle(m)">{{m.active?'暂停':'恢复'}}</button><button class="outline-action" @click="resetActivation(m)">重发未激活邀请</button></div></div></section>
    </main>
  </div>
</template>
