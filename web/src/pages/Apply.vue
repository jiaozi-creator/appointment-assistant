<script setup>
import {ref} from 'vue';
import {send} from '../api';
const fields=ref({business_name:'',desired_slug:'',contact_email:'',message:'',consent:false,website:''});
const done=ref(false),busy=ref(false),error=ref('');
async function submit(){busy.value=true;error.value='';try{await send('/public/merchant-applications',fields.value);done.value=true;}catch(e){error.value=e.message;}finally{busy.value=false;}}
</script>
<template>
  <div class="light-page"><header class="simple-header wrap"><router-link to="/login">← 返回登录</router-link><span class="brand">◈ 约客助手</span></header>
    <main class="narrow-page"><div class="eyebrow dark">JOIN THE PLATFORM</div><h1>工作室入驻申请<span class="dot">.</span></h1>
      <p class="muted">提交申请后由平台人工审核。审核通过后，平台管理员会提供一次性开通邀请。不会自动获得后台账号。</p>
      <div v-if="done" class="notice-success"><h2>申请已提交</h2><p>请妥善保留申请时使用的邮箱，等待平台人工审核联系。</p><router-link to="/login" class="button primary">返回登录</router-link></div>
      <form v-else class="stack-form" @submit.prevent="submit">
        <label>工作室名称<input v-model.trim="fields.business_name" maxlength="90" required placeholder="例如：海盐摄影"/></label>
        <label>专属访问标识<input v-model.trim="fields.desired_slug" required minlength="3" maxlength="60" pattern="[a-z0-9][a-z0-9-]{2,59}" placeholder="例如：sea-photo"/><small class="hint">未来的访问地址 /s/sea-photo，仅限小写字母、数字和连字符</small></label>
        <label>联系邮箱<input v-model.trim="fields.contact_email" type="email" required maxlength="180" placeholder="用于通知审核结果"/></label>
        <label>业务简介（选填）<textarea v-model.trim="fields.message" rows="4" maxlength="700" placeholder="请简单介绍摄影业务和预约管理需求"/></label>
        <label class="consent"><input type="checkbox" v-model="fields.consent" required/><span>我同意平台为入驻审核目的处理工作室名称、联系邮箱和提交的业务说明。请勿提交客户信息。</span></label>
        <input v-model="fields.website" tabindex="-1" aria-hidden="true" autocomplete="off" style="position:absolute;left:-99999px"/>
        <div v-if="error" class="alert" role="alert">{{error}}</div>
        <button type="submit" class="button primary big" :disabled="busy">{{busy?'提交中…':'提交审核申请'}} →</button>
      </form>
    </main>
  </div>
</template>
