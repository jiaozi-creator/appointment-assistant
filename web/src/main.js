import { createApp } from 'vue';
import { createRouter,createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
const router=createRouter({history:createWebHistory(),routes:[
{path:'/',redirect:'/s/forest-photo'},
{path:'/s/:slug',component:()=>import('./pages/Shop.vue')},
{path:'/s/:slug/book/:serviceId',component:()=>import('./pages/Book.vue')},
{path:'/s/:slug/success',component:()=>import('./pages/Success.vue')},
{path:'/login',component:()=>import('./pages/Login.vue')},
{path:'/apply',component:()=>import('./pages/Apply.vue')},
{path:'/invite/:token',component:()=>import('./pages/Invite.vue')},
{path:'/platform',component:()=>import('./pages/Platform.vue')},
{path:'/admin',component:()=>import('./pages/Admin.vue')},
{path:'/:pathMatch(.*)*',redirect:'/'}
]});
createApp(App).use(router).mount('#app');
