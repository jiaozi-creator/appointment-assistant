# 约客助手 · Appointment Assistant

[![tests-and-build](https://github.com/jiaozi-creator/appointment-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/jiaozi-creator/appointment-assistant/actions/workflows/ci.yml)

面向摄影工作室的预约申请与管理系统。**本分支为多商家 SaaS 受控试点基础版，不等于已完成商用上线审核。** 技术栈：Vue 3 + Vite，Node.js 22+ 原生 HTTP 服务，PostgreSQL（多进程共享同一数据库）。**同一套资源模型支持单人摄影师及多人/多影棚工作室。**

## 已实现的业务流程

1. 摄影商家提交**入驻申请**（`/apply`），平台管理员登录 `/platform` 后审核。通过后生成仅展示一次的72小时**所有者激活邀请**，须由管理员自行核实申请人并安全传达（**不自动发邮件**）。
2. 商家所有者通过 `/invite/:token` 创建密码登录 `/login`，进入 `/admin` 管理服务项目、休息日、工作室资料和预约订单。
3. 老板可在“成员与权限”创建48小时**员工邀请**。员工只能查看和处理预约，不能修改服务、工作室资料及邀请成员。老板停用员工后其会话立即失效。
4. 客户进入 `/s/:slug` 浏览某个工作室的上架服务，选择日期与时段，接受告知，提交**待确认**预约申请。展示已确认预约的占用时段（不披露个人信息）。提交后可用预约编号在工作室主页查询进度；查询结果不含姓名和电话，刷新页面后仍然有效。
5. 商家把待确认预约改为“已确认”时，后端在 PostgreSQL 事务里用咨询锁保护该工作室当天档期，按剩余容量、当天已确认负荷和冲突检查分配资源；冲突则返回409，**不允许重复占用**。同一时段允许多个待处理申请。自动分配不再按资源名称排序。客户可凭预约编号和电话自行支付或取消。时间按工作室时区展示，开始时间以 UTC 毫秒存储。
6. 平台管理员能暂停/恢复商家账户，仅能查看入驻申请和工作室基本资料，**不能默认查询商家私人预约列表**。
7. 管理页面包含工作台统计、订单筛选/分页、CSV导出当前页、服务管理、休息日、商家设置、团队成员。
8. 老板可维护**摄影师、场地、设备**资源、容量、每周可用时段及临时封档；为服务创建不同套餐并设置摄影师/场地/设备需求，客户选套餐预约，订单确认时可自动分配或由商家手动指定具体资源。

### 角色权限

| 功能 | 匿名客户 | 商家老板 | 商家员工 | 平台管理员 |
|---|:---:|:---:|:---:|:---:|
| 浏览上架服务、申请预约 | ✓ | ✓ | ✓ | ✓ |
| 管理本工作室预约 | — | ✓ | ✓ | — |
| 编辑服务 / 套餐 / 资源 / 封档 / 休息日 / 工作室资料 | — | ✓ | — | — |
| 邀请 / 停用本工作室员工 | — | ✓ | — | — |
| 审核申请 / 停用商家 | — | — | — | ✓ |

商家身份由登录会话确定；所有业务查询按 `merchant_id` 过滤，不能通过URL切换其他商家的数据。账号当前最多属于一个工作室；扩展多工作室成员需要未来的成员关系表设计。

## 在本地启动

需要 **Node.js 22.13+** 和本机 PostgreSQL 16。复制 `.env.example` 为环境变量，至少设置 `DATABASE_URL`。后端依赖 `pg`。未配置 SMTP、阿里云短信或微信支付时，通知和支付走可断言的测试通道。

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

服务在本地默认监听 `127.0.0.1:3001`。默认数据库是 `postgres://appointment:appointment@127.0.0.1:5432/appointment`。不要清空有真实数据的库来重新初始化账号。测试套件会创建并删除独立的 `aa_*` 数据库。

### API 概览

| 访问类型 | 主要接口 |
|---|---|
| 公开 | `GET /api/public/shops/:slug`、`/services`、`/availability?date=YYYY-MM-DD` |
| 公开写入 | `POST /api/public/shops/:slug/bookings`、`POST /api/public/merchant-applications` |
| 公开查询 | `GET /api/public/shops/:slug/bookings/:code`（状态、支付、时区、服务和时间；不含姓名、电话、邮箱、备注） |
| 客户支付 / 取消 | `POST /api/public/shops/:slug/bookings/:code/pay`、`/cancel`，请求体需带预约电话 |
| 商家通知 | `GET /api/admin/notifications` |
| 身份 | `POST /api/auth/login`、`/logout`、`GET /api/auth/me` |
| 激活 | `GET /api/invitations/:token`、`POST /api/invitations/:token/accept` |
| 商家 | `/api/admin/dashboard`、`/bookings`、`/services`、`/packages`、`/resources`、`/resource-blocks`、`/resource-calendar`、`/days-off`、`/merchant`、`/team` |
| 平台 | `/api/platform/overview`、`/applications`、`/merchants/:id/active` |

所有使用身份Cookie的写操作都需要 `X-CSRF-Token`，Vue API 工具会自动从配套Cookie读取；独立HTTP客户端必须自行携带。完整业务安全契约见源码和测试。

## 架构、安全与生产部署

- SQL 迁移：`server/migrations-pg/001_postgres.sql`。旧的 SQLite 迁移文件保留作历史，不会对 PostgreSQL 执行，也不会自动导入旧的 sqlite 文件。升级前用 `pg_dump` 备份。
- 多商家隔离：应用服务端强制 `merchant_id`、会话权限与停用状态；邀请 Token 只保存哈希；密码使用 scrypt；HttpOnly 会话Cookie、SameSite、CSRF令牌；POST具有简单限速及幂等键；订单修改写事件表。
- 档期限制：商家默认为 **Asia/Shanghai时区、09:00–21:00**，资源分配使用半开区间、拍摄准备/收尾缓冲、摄影师/影棚独占和设备共享容量；允许多名摄影师并行工作，但不支持跨夜拍摄、跨时区或支付。
- 数据隐私：真实姓名/电话属于个人信息；在正式运营前需确定个人信息处理角色、隐私告知、收集依据、保留期限、备份加密、删除与访问请求机制。Demo 用虚拟资料。
- HTTPS部署准备：`Dockerfile`、`deploy/docker-compose.yml`、`deploy/Caddyfile.example`。必须配置 `ALLOWED_ORIGIN` 和 `COOKIE_SECURE=1`，入口应为HTTPS反向代理。
- 一致性SQLite备份：`scripts/backup.js` 使用 `VACUUM INTO`，备份必须转存异地并演练恢复。

**详见：** [架构文档](docs/ARCHITECTURE.md) · [资源排期ADR](docs/RESOURCE_SCHEDULING.md) · [003迁移操作](docs/DB_MIGRATION_003.md) · [部署与生产门槛](docs/DEPLOYMENT.md)

## 有意保留的限制（真实上线前必须处理）

- **不是正式生产高可用系统**：使用单进程SQLite与进程内限速，不支持多个后端实例横向扩展；尚无PostgreSQL驱动/适配器。
- 仅支持**人工**转交邀请，不自动发邮件；审批不等于人工身份核验已经完成。
- 客户实名/联系电话输入、CSV导出等涉及个人信息，未完成实际商家合法业务场景下的隐私政策与安全审计；没有客服工单、删除导出流程和集中操作日志管理。
- 尚无微信小程序、支付、订阅账单、短信/邮件提醒、跨时区商家支持。多人资源/共享设备已支持，但自动指派仍是简单的确定性首选策略。
- 测试包括后端API，但由于此前开发环境缺少npm网络，**前端生产构建与浏览器端到端联调需以GitHub Actions及实际机器结果为准**，不能仅凭代码提交声称验证成功。
