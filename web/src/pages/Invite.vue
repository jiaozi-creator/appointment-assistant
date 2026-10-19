<script setup>
import {ref,onMounted} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {api,send} from '../api';
const route=useRoute(),router=useRouter();
const info=ref(null),error=ref(''),password=ref(''),busy=ref(false),done=ref(false);
onMounted(async()=>{try{info.value=await api(`/invitations/${route.params.token}`)}catch(e){error.value=e.message;}});
async function accept(){busy.value=true;error.value='';try{await send(`/invitations/${route.params.token}/accept`,{password:password.value});done.value=true;}catch(e){error.value=e.message;}finally{busy.value=false;}}
</script>
<template>
  <div class="light-page"><header class="simple-header wrap"><router-link to="/login">← 返回登录</router-link><span class="brand">◈ 约客助手</span></header>
    <main class="narrow-page"><div class="eyebrow dark">ONE-TIME INVITATION</div><h1>开通工作室账号<span class="dot">.</span></h1>
      <div v-if="done" class="notice-success"><h2>账号已经开通</h2><p>现在可以使用邀请的邮箱和刚设置的密码登录。</p><button class="button primary" @click="router.push('/login')">前往登录 →</button></div>
      <form v-else-if="info" @submit.prevent="accept" class="stack-form"><p class="muted">{{info.merchant_name}} 邀请你作为{{info.role==='owner'?'工作室所有者':'工作室员工'}}加入。</p>
        <label>登录邮箱<input :value="info.email" readonly/></label>
        <label>设置密码（至少12位）<input type="password" v-model="password" minlength="12" maxlength="200" autocomplete="new-password" required/></label>
        <p class="hint">邀请只能使用一次，并会在设定时间后自动失效。请使用独立高强度密码。</p>
        <div v-if="error" class="alert" role="alert">{{error}}</div><button class="button primary big" :disabled="busy">{{busy?'开通中…':'确认开通账号'}}</button>
      </form><div v-else class="alert">{{error||'正在核实邀请…'}}</div>
    </main>
  </div>
</template>
