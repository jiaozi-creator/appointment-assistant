# 约客助手 V2 技术设计

## 技术选型与边界

单仓库、单前端 Vue3/Vite、一个 Node22 HTTP API 进程与 `node:sqlite` SQLite 数据库。部署需强制 HTTPS 反向代理、持久化卷、备份恢复与审计。**项目并未采用 PostgreSQL；迁移只是已实施的SQLite Schema版本迁移。** 后续从 SQLite 到Postgres需要重新实现数据访问适配及数据验证，不属于本次已完成工作。

## 数据模型

- `merchants`：工作室 `id/slug/active`。
- `merchant_applications`：入驻申请；`pending -> approved/rejected`，状态不可重复处理。
- `users`：独立账号；`merchant_id` 绑定唯一工作室，`owner` / `staff`，`platform` 无 `merchant_id`；停用会话即时无效。
- `invitations`：随机Token **仅哈希落库**，role、邮箱、过期、接受与撤销状态。审核通过自动生成owner邀请；owner可以邀请staff。
- `sessions`：随机令牌哈希，持久化过期与CSRF令牌哈希。
- `services`：工作室服务内容和当前服务时长。
- `bookings`：订单状态、服务时长快照、当地日期与时间、必要联系方式。
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

## 预约时间冲突处理

1. 公开请求必须符合未来180天、Asia/Shanghai本地日期、整点/半点、09:00至21:00内完成服务和工作室休息日规则。
2. 同时接受多个待确认咨询，以避免因为未回复而锁死销售机会；用户看到的可选档期基于已确认/已完成订单。
3. 商家确认时进入 `BEGIN IMMEDIATE` SQLite写事务，在同一商家同一天内查询已确认和已完成订单，以 `[start,end)` 区间重叠判断；被占用返回409，订单仍保持待确认。
4. `duration_minutes` 在预约产生时从服务复制存入订单，后来编辑服务时长不影响既有预约。
5. 关闭某日预约时，如该日存在已确认订单则拒绝修改，要求先处理订单。
6. 当前默认**一个工作室同时只允许一个占用资源**；多个摄影师、相机房间的资源日历尚未建模。商家可用性不是实际支付锁定承诺。

## 可验证的测试与剩余风险

- API测试（`npm test`）：入驻审核、邀请码单次使用、跨商户隔离、员工权限及即时撤销、CSRF、幂等、时段冲突、停用状态。
- 数据迁移测试（见 `tests/migrations.test.js`）：空库与旧数据库版本升级。
- GitHub Actions：Node后端测试 + 联网安装Vue依赖并 `vite build`；以CI运行状态为准。
- 真实上线待办：客服、安全审计、渗透测试、监控告警、自动化备份与恢复演练、个人信息删除政策和工具、电子邮件/短信通知、请求防滥用、集中审计保留、法律审查、分布式扩展方案。
