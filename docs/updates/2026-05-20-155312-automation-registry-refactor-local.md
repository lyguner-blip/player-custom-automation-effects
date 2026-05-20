# 2026-05-20 15:53 本地小更改：自动化注册器重构

## 背景

- 原本 `scripts/main.mjs` 同时承载设置注册、Hook、Socket、面板、Token 移动、狂热冲锋和武僧武功逻辑。
- 后续如果扩展到几十个或上百个自动化，单文件会变得难以分工、难以排查，也容易在维护某个角色能力时影响其它能力。

## 变更

- 将 `scripts/main.mjs` 收束为入口注册器，只负责全局 Hook、Socket、面板拼装和自动化分发。
- 新增 `scripts/constants.mjs`，集中管理模块 ID、依赖模块 ID 和设置键名。
- 新增 `scripts/shared/context.mjs`，沉淀设置读取、通知、权限、重复事件拦截、特效库查询和面板刷新等公共能力。
- 新增 `scripts/shared/tokens.mjs`，沉淀 Token 查找、冲锋落点、移动回退和 GM Socket 代移等公共能力。
- 将“狂热冲锋”拆入 `scripts/automations/zealous-charge.mjs`。
- 将“武僧武功”拆入 `scripts/automations/monk-focus.mjs`。

## 后续开发约定

- 新增定制自动化时，优先在 `scripts/automations/` 下创建独立文件。
- 每个自动化导出统一接口对象：`id`、`label`、`registerSettings`、`isEnabled`、`isActivity`、`findItem`、`run`、`renderPanel`、`shouldOwnAnimation`、`handleAction`。
- 在 `scripts/main.mjs` 的 `automations` 数组中挂载新自动化。
- 除非新增全局 Hook 或公共分发规则，不要把角色能力细节写入 `scripts/main.mjs`。

## 范围

- 本次仅做本地结构优化，未推送服务器或 GitHub。
- 模块版本维持 `0.2.5`。
