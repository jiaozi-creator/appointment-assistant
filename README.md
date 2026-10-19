# 约客助手 · Appointment Assistant

> 摄影工作室预约 SaaS 第一版。Vue 3 + Vite 前端、Node.js 原生 HTTP API 和 SQLite 持久化数据库。不是仅靠 `localStorage` 的演示。

## 功能

- 公开的摄影工作室主页、摄影服务、价格/时长展示、移动端预约申请；支持具体日期、时段、客户联系信息、隐私告知确认、商家休息日；提交后获得不可预测的预约编号。
- 管理员登录、HttpOnly会话、服务上架/修改/下架、预约搜索/筛选/翻页、订单状态审批、审计事件、仪表盘、工作室设置、休息日、当前页 CSV 导出。
- 每条商家记录绑定 merchant_id；服务器按已登录用户所属商家查询，**不采信前端传入的 merchant_id**。
- Node.js内置SQLite本地持久化，WAL、外键、必要的索引；密码使用 scrypt+salt；登录与公开预约接口简单限流；提交可使用幂等键。
- 没有强制注册客户账号；客户预约由商家人工确认，不自动锁档、不自动收费。

## 本地启动

**需要 Node.js >=22.13**（当前 Node 22 的 `node:sqlite` 仍带实验性警告）。

```bash
# 终端 A：初始化并运行 API
INIT_OWNER_EMAIL=owner@example.com INIT_OWNER_PASSWORD='choose-a-very-strong-password' npm run dev

# 终端 B：安装前端依赖并运行
cd web
npm install
npm run dev
```

打开 http://localhost:5173/s/forest-photo 查看商家预约页；打开 http://localhost:5173/login 用首次初始化邮箱、密码进入后台。此时 Vite 将 `/api` 代理至 `http://localhost:3001`。Windows PowerShell 请用：

```powershell
$env:INIT_OWNER_EMAIL="owner@example.com"
$env:INIT_OWNER_PASSWORD="choose-a-very-strong-password"
npm run dev
```

注意：如果你已经启动过服务器并创建数据库，修改初始化环境变量**不会**修改现有账号密码；不要随意删除真实数据库。首次初始化商家 slug 固定为 `forest-photo`，后续多商家开户管理需要平台管理员工具（见下方限制）。

### 构建与本地同源运行

```bash
cd web && npm run build && cd ..
INIT_OWNER_EMAIL=owner@example.com INIT_OWNER_PASSWORD='choose-a-very-strong-password' npm start
```

访问 http://localhost:3001/ ，后端会同时提供打包后的前端和 API。开发测试可执行：

```bash
npm test
```

## 当前边界 / 不应误认为已经具备

这是**可运行的单实例预约管理基础版本**，不是已通过真实商用上线审查的生产级 SaaS。当前未实现：商家自助注册/平台多商家开户控制台、员工创建邀请、短信通知、客户验证预约状态、自动档期库存锁定、支付、订阅计费、对象存储上传、生产数据库备份编排、CSRF token、多地域高可用和生产级风控。

管理权限中的 `staff` 与 `platform` 预留了角色，但没有开放在 UI 中创建账号，避免形成虚假的完整权限管理声明。产品仍需为真实隐私政策、合规部署、数据保留/删除请求、客服和业务连续性制定流程。

### 安全重点

- 必须通过 TLS HTTPS 部署，设置 `COOKIE_SECURE=1`、反向代理、可信源、严格跨域配置。不要把 Node 服务直接暴露给互联网。
- 本地 SQLite 为单实例架构，迁移 PostgreSQL 之前不要用多个 Node 实例同时修改同一个 DB 文件；部署时务必持久化数据卷，并进行外部备份与恢复演练。
- Cookie SameSite 和 Origin 校验只能作为部分 CSRF 缓解手段，生产版应进一步实现 CSRF token、严格 Host 代理信任、防暴力破解与持久化限流。
- 客户姓名与电话是个人信息，必须在取得充分告知和有效同意、落实保护措施并完成合规审核后才可以收集真实客户信息。调试时只用虚拟数据。
- 导出功能只导出**当前页**，且可能含客户电话，必须由授权员工在安全设备使用。平台管理员不自动越权查询商家私人信息。
- 工作室 `slug` 在数据库中支持多租户，但当前账号仅通过初始化脚本创建一个示例商家，平台级入驻工作流尚未实现。

更多架构与验收信息见 `docs/ARCHITECTURE.md`。
