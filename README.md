# 约客助手 · Appointment Assistant

[![tests-and-build](https://github.com/jiaozi-creator/appointment-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/jiaozi-creator/appointment-assistant/actions/workflows/ci.yml)

面向摄影工作室的预约申请与管理系统。**本分支为多商家 SaaS 受控试点基础版，不等于已完成商用上线审核。** 技术栈：Vue 3 + Vite，Node.js 22+ 原生 HTTP 服务，SQLite（版本化迁移、WAL、事务）。

## 已实现的业务流程

1. 摄影商家提交**入驻申请**（`/apply`），平台管理员登录 `/platform` 后审核。通过后生成仅展示一次的72小时**所有者激活邀请**，须由管理员自行核实申请人并安全传达（**不自动发邮件**）。
2. 商家所有者通过 `/invite/:token` 创建密码登录 `/login`，进入 `/admin` 管理服务项目、休息日、工作室资料和预约订单。
3. 老板可在“成员与权限”创建48小时**员工邀请**。员工只能查看和处理预约，不能修改服务、工作室资料及邀请成员。老板停用员工后其会话立即失效。
4. 客户进入 `/s/:slug` 浏览某个工作室的上架服务，选择日期与时段，接受告知，提交**待确认**预约申请。展示已确认预约的占用时段（不披露个人信息）。
5. 商家把待确认预约改为“已确认”时，后端开启 SQLite 写事务，检查服务时长与已确认/已完成订单的时间区间是否重叠；冲突则返回409，**不允许重复占用**。同一时段可以有多个待处理咨询，等待人工择一确认。
6. 平台管理员能暂停/恢复商家账户，仅能查看入驻申请和工作室基本资料，**不能默认查询商家私人预约列表**。
7. 管理页面包含工作台统计、订单筛选/分页、CSV导出当前页、服务管理、休息日、商家设置、团队成员。

### 角色权限

| 功能 | 匿名客户 | 商家老板 | 商家员工 | 平台管理员 |
|---|:---:|:---:|:---:|:---:|
| 浏览上架服务、申请预约 | ✓ | ✓ | ✓ | ✓ |
| 管理本工作室预约 | — | ✓ | ✓ | — |
| 编辑服务 / 休息日 / 工作室资料 | — | ✓ | — | — |
| 邀请 / 停用本工作室员工 | — | ✓ | — | — |
| 审核申请 / 停用商家 | — | — | — | ✓ |

商家身份由登录会话确定；所有业务查询按 `merchant_id` 过滤，不能通过URL切换其他商家的数据。账号当前最多属于一个工作室；扩展多工作室成员需要未来的成员关系表设计。

## 在本地启动

需要 **Node.js 22.13+**，建议 22.16 及更新的22.x版本。`node:sqlite` 在该版本仍会产生实验性警告。后端不需要 npm 第三方依赖。

**终端 A：**

```bash
# macOS / Linux
INIT_OWNER_EMAIL=owner@example.test \
INIT_OWNER_PASSWORD='strong-local-owner-password' \
INIT_PLATFORM_EMAIL=platform@example.test \
INIT_PLATFORM_PASSWORD='strong-platform-password-for-test' \
npm run dev
```

在 PowerShell 中可先 `$env:INIT_OWNER_EMAIL="owner@example.test"`，同理设置上述其余3项，再执行 `npm run dev`。不要在真实生产使用这些示例密码。

**终端 B：**

```bash
cd web
npm install
npm run dev
```

- 客户工作室： http://localhost:5173/s/forest-photo
- 商家登录： http://localhost:5173/login
- 商家入驻： http://localhost:5173/apply
- 平台管理（使用 `INIT_PLATFORM_*`）： http://localhost:5173/platform
- 演示工作室账户（使用 `INIT_OWNER_*`）： http://localhost:5173/admin

Vite 会代理 `/api` 请求至 `127.0.0.1:3001`。账号环境变量仅用于**首次初始化**；旧数据库账号不会因为修改环境变量自动重置。

## 测试与构建

```bash
npm test                     # Node 内置测试；不需要前端依赖
npm --prefix web install     # 联网安装前端依赖
npm --prefix web run build   # 真正的Vite前端构建
npm start                    # 构建后由Node同源托管Vue前端与API
```

服务在本地默认监听 `127.0.0.1:3001`。数据库文件默认 `data/appointment.sqlite`（已gitignore）。不要删除有真实数据的数据库以便重新初始化账号。测试套件使用完全独立的临时数据库。

### API 概览

| 访问类型 | 主要接口 |
|---|---|
| 公开 | `GET /api/public/shops/:slug`、`/services`、`/availability?date=YYYY-MM-DD` |
| 公开写入 | `POST /api/public/shops/:slug/bookings`、`POST /api/public/merchant-applications` |
| 身份 | `POST /api/auth/login`、`/logout`、`GET /api/auth/me` |
| 激活 | `GET /api/invitations/:token`、`POST /api/invitations/:token/accept` |
| 商家 | `/api/admin/dashboard`、`/bookings`、`/services`、`/days-off`、`/merchant`、`/team` |
| 平台 | `/api/platform/overview`、`/applications`、`/merchants/:id/active` |

所有使用身份Cookie的写操作都需要 `X-CSRF-Token`，Vue API 工具会自动从配套Cookie读取；独立HTTP客户端必须自行携带。完整业务安全契约见源码和测试。

## 架构、安全与生产部署

- SQL 迁移：`server/migrations/001_initial.sql` + `002_saas.sql`，每个版本事务提交，自动兼容旧版无版本表的数据库；升级前必须备份。**尚未迁移到PostgreSQL**。
- 多商家隔离：应用服务端强制 `merchant_id`、会话权限与停用状态；邀请 Token 只保存哈希；密码使用 scrypt；HttpOnly 会话Cookie、SameSite、CSRF令牌；POST具有简单限速及幂等键；订单修改写事件表。
- 档期限制：商家默认为**Asia/Shanghai时区、09:00–21:00、每次只能确认一笔重叠预约**；当前只支持整点和半点开始，不支持多摄影师独立资源/跨夜拍摄及支付。
- 数据隐私：真实姓名/电话属于个人信息；在正式运营前需确定个人信息处理角色、隐私告知、收集依据、保留期限、备份加密、删除与访问请求机制。Demo 用虚拟资料。
- HTTPS部署准备：`Dockerfile`、`deploy/docker-compose.yml`、`deploy/Caddyfile.example`。必须配置 `ALLOWED_ORIGIN` 和 `COOKIE_SECURE=1`，入口应为HTTPS反向代理。
- 一致性SQLite备份：`scripts/backup.js` 使用 `VACUUM INTO`，备份必须转存异地并演练恢复。

**详见：** [架构文档](docs/ARCHITECTURE.md) · [部署与生产门槛](docs/DEPLOYMENT.md)

## 有意保留的限制（真实上线前必须处理）

- **不是正式生产高可用系统**：使用单进程SQLite与进程内限速，不支持多个后端实例横向扩展；尚无PostgreSQL驱动/适配器。
- 仅支持**人工**转交邀请，不自动发邮件；审批不等于人工身份核验已经完成。
- 客户实名/联系电话输入、CSV导出等涉及个人信息，未完成实际商家合法业务场景下的隐私政策与安全审计；没有客服工单、删除导出流程和集中操作日志管理。
- 尚无微信小程序、支付、订阅账单、短信/邮件提醒、多名摄影师并发容量或跨时区商家支持。
- 测试包括后端API，但由于此前开发环境缺少npm网络，**前端生产构建与浏览器端到端联调需以GitHub Actions及实际机器结果为准**，不能仅凭代码提交声称验证成功。
