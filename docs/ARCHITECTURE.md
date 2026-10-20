# 约客助手 V2 技术设计

## 技术选型与边界

单仓库、单前端 Vue3/Vite、Node 22 HTTP API，可多进程连接同一个 PostgreSQL 16 数据库。部署需强制 HTTPS 反向代理、数据库备份与审计。旧 SQLite 迁移文件不再执行。

## 数据模型

- `merchants`：工作室 `id/slug/active`。
- `merchant_applications`：入驻申请；`pending -> approved/rejected`，状态不可重复处理。
- `users`：独立账号；`merchant_id` 绑定唯一工作室，`owner` / `staff`，`platform` 无 `merchant_id`；停用会话即时无效。
- `invitations`：随机Token **仅哈希落库**，role、邮箱、过期、接受与撤销状态。审核通过自动生成owner邀请；owner可以邀请staff。
- `sessions`：随机令牌哈希，持久化过期与CSRF令牌哈希。
- `services`：工作室服务内容和当前服务时长。
- `bookings`：订单状态、套餐ID及名称/价格/时长/缓冲快照、当地日期与时间、必要联系方式。
- `resources` / `resource_blocks` / `resource_weekly_hours`：摄影师、场地、设备及各自的档期。
- `service_packages` / `package_requirements`：拍摄套餐及所需资源类型/数量；同一拍摄服务可有多个套餐。
- `booking_requirements` / `booking_allocations`：历史预约资源需求快照以及确认后实际分配资源。
- `days_off`：工作室停接日期。
- `events`：预约状态变更轨迹；`platform_events`：平台审计。
- `schema_migrations`：数据库版本。

## 权限与信任边界

- 公开页面只能获取商家公开信息、上架服务、已确认占用时段；不含姓名/电话。
- 登录通过数据库中的会话验证；管理员Cookie HttpOnly且SameSite=Lax，配套可读CSRF Cookie + 写请求 `X-CSRF-Token` 与服务端令牌哈希匹配。
- 平台管理员只能使用 `/api/platform/*`，商家员工和老板只能使用 `/api/admin/*`；老板独享服务设置、邀请及员工停用功能。
- 管理请求从服务端会话派生 `merchant_id`，客户无权指定自己的订单 `merchant_id/status/duration_minutes`。
- 平台审核时创建新商家和owner邀请使用一个SQLite原子事务；不自动发邮件。
- 鉴于前端组件可被绕过，所有权限规则均由API执行；未实施数据库行级安全政策。准备迁往Postgres后可作为第二层隔离。

## 预约时间冲突处理（V2.1）

1. 公开预约请求必须符合未来180天、Asia/Shanghai本地日期、半小时时段、09:00至21:00（包含准备与收尾缓冲）的约束。
2. 一名个人摄影师和多名摄影师工作室共享同一模型：默认资源为摄影师×1，多人工作室添加摄影师/影棚/设备。各套餐定义必需资源与数量。
3. 允许同一时间多笔 `pending` 申请，不锁定库存。`pending -> confirmed` 在 PostgreSQL 事务中取得 `merchant+date` 咨询锁，按该时段剩余容量、当天负荷和冲突分配或校验手工指定资源，再更新预约状态和分配记录。
4. 摄影师/场地容量恒为1；设备容量可以大于1；被占用的 `[start,end)` 区间按峰值占用校验，考虑准备和收尾缓冲，以及单个资源的临时封档、每周工作规则和全店休息日。
5. 创建申请时复制套餐名称、价格、时长、缓冲与资源需求到预约快照；后来编辑套餐不会改写历史预约。
6. 取消已确认预约释放资源容量；历史分配与状态变更仍保留审计追踪。已确认未来预约禁止被新增封档、缩容或每周营业时间修改破坏。
7. 多个 API 进程共享同一 PostgreSQL。确认同一天档期时用事务级咨询锁串行化容量判断，避免两个进程同时写坏占用。

具体数据表、业务时段公式、API和上线边界：[资源排期ADR](RESOURCE_SCHEDULING.md)、[迁移003](DB_MIGRATION_003.md)。

## 可验证的测试与剩余风险

- API测试（`npm test`）：入驻审核、邀请码单次使用、跨商户隔离、员工权限及即时撤销、CSRF、幂等、时段冲突、停用状态、预约编号进度查询（不返回联系方式）、确认前资源余量。
- 数据迁移测试（见 `tests/migrations.test.js`）：空库与旧数据库版本升级。
- GitHub Actions：Node后端测试 + 联网安装Vue依赖并 `vite build`；以CI运行状态为准。
- 真实上线待办：客服、安全审计、渗透测试、监控告警、自动化备份与恢复演练、个人信息删除政策和工具、电子邮件/短信通知、请求防滥用、集中审计保留、法律审查、分布式扩展方案。
