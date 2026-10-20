# SQLite 迁移 003 · 资源与套餐

文件：`server/migrations/003_resources_packages.sql`。

## 升级动作

1. 自动新建 `resources`、`resource_blocks`、`resource_weekly_hours`、`service_packages`、`package_requirements`、`booking_requirements`、`booking_allocations`。
2. 向旧 `bookings` 增加 `package_id`、`buffer_before`、`buffer_after`、`package_title_snapshot`、`package_price_cents`。
3. 每个已有工作室自动获得一条“默认摄影师”资源。
4. 每个已有服务自动获得“标准套餐”，价格/时长继承旧服务，并生成摄影师×1需求。
5. 所有历史预约回填对应的套餐快照；历史已确认或已完成预约关联其所属工作室的默认摄影师。
6. `schema_migrations` 记录版本 `003_resources_packages.sql`；迁移只执行一次且使用 SQLite 写事务。

## 执行前

- 先**停止写入**（维护窗口），对SQLite数据库做带完整性检查的一致性备份；**外部备份也要验证可恢复**。
- 先在备份副本上运行 `npm test` 和服务端迁移，核实 `PRAGMA foreign_key_check` 返回0行、旧预约数量一致。
- 启动新版本服务端（`server/db.js` 自动运行迁移），迁移后检查 `schema_migrations` 和新增资源及套餐数量。
- 必须将旧版服务端和数据库一起备份；SQLite DDL的版本回退不是无条件可逆的。出问题时通过停止服务、恢复备份和部署旧版本处理，切勿直接删除新表。

## 迁移与升级后验证建议

```sql
PRAGMA foreign_key_check;
SELECT version, applied_at FROM schema_migrations ORDER BY version;
SELECT COUNT(*) FROM bookings;
SELECT COUNT(*) FROM resources;
SELECT COUNT(*) FROM service_packages;
SELECT COUNT(*) FROM booking_requirements;
SELECT COUNT(*) FROM booking_allocations;
```

测试包含旧无版本SQLite数据库升级及保留历史记录。生产迁移还需要按真实数据库容量、停机时间和备份机制单独验收。

## 与 PostgreSQL 的关系

本次是**SQLite内的版本化迁移**，不是完成PostgreSQL迁移。若未来需要横向扩容，建议把业务持久化层模块化，再新建Postgres schema；关键资源分配需要数据库级事务锁或exclusion约束，以及独立的跨服务并发测试。
