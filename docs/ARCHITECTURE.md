# 技术与验收方案

## 架构

- `web/`: Vue 3 + Vite + Vue Router。公开移动端 / 商家后台响应式适配。
- `server/`: Node.js 内置 HTTP 服务 + `node:sqlite` 数据层。身份、业务、SQL 层全部运行在服务器上。
- SQLite 文件默认为 `data/appointment.sqlite`，环境变量 `DB_PATH` 可改变路径。
- 每次公开预约通过 POST `/api/public/shops/:slug/bookings`，服务器校验服务商户关系、未来日期和休息日，并在单个事务中写入订单/幂等记录。
- 管理请求从数据库会话取用户、从用户取 merchant_id；所有查询带 tenant 条件，状态更新附带当前状态的乐观检查。

## 状态机

- `pending` -> `confirmed` / `rejected` / `cancelled`
- `confirmed` -> `completed` / `cancelled`
- `completed`、`rejected`、`cancelled` 不允许自动重新流转。

## 测试

`npm test` 涵盖：服务读取、匿名访问隔离、登录、隐私确认、预约、幂等、状态流转、服务新增、休息日、注销会话。

## 下一阶段的真实商业化门槛

1. 引入 PostgreSQL 及 Schema migration 工具；建立可恢复的数据库备份、留存期与安全删除流程。
2. 完成自助/人工商家开户、员工邀请、最小权限管理与审计日志查询。
3. 预约时间采用工作室所在时区，支持营业时间、预约容量、冲突防护与取消截止时间。
4. 接入正式消息通知服务，确保重复通知可去重，记录发送结果。
5. 真正的隐私告知页面、客户数据删除/访问请求流程、上线安全检查、监控报警与灾备演练。
6. 根据实际商家确认是否需要微信小程序，不提前承担备案、认证、支付和运营成本。
