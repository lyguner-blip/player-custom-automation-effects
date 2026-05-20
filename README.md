# 定制自动化效果

为 Foundry VTT 玩家角色提供可定制的规则自动化，并与“玩家定制特效库”联动。模块目标是把复杂角色能力拆成清晰、可控、可回退的自动化流程，同时让特效播放时机与规则结算保持一致。

当前版本：`0.2.6`

## 功能概览

- 接管指定角色能力的规则自动化，不影响其它普通物品和法术。
- 与 `player-custom-cinematic-effects` 联动，在自动化流程中调用对应电影特效。
- 支持通过特效库控制面板显示自动化状态和快捷按钮。
- 支持 GM Socket 回退，让非 GM 玩家触发的动作也能请求 GM 端执行移动或结算。
- 提供世界设置开关，可单独控制移动、动画、伤害结算、提示状态和武器衔接。

## 当前自动化能力

### 狂热冲锋

当前重点适配“狂热冲锋”：

- 使用能力后，根据目标与移动距离寻找可落点。
- 可自动移动 Token 到目标相邻格。
- 可调用特效库播放联动冲锋动画。
- 可创建“下一击”提示状态。
- 下一次攻击命中流程中，可自动结算 `2d6` 光耀伤害。
- 可在冲锋后弹出武器选择窗口，方便立即衔接巨剑、链枷、标枪等攻击。

### 武僧武功

第二个定制自动化适配“武僧武功”：

- 使用武僧武功或其子活动时，由本模块接管电影级特效触发。
- 保留特效库中的活动差分，支持疾风连击、疾步如风、闪转腾挪等不同表现。
- 可在特效库控制面板中查看状态并手动触发预览。

## 安装

在 Foundry VTT 的“安装模块”中使用 Manifest URL：

```text
https://github.com/lyguner-blip/player-custom-automation-effects/raw/main/module.json
```

也可以将仓库克隆到 Foundry 数据目录：

```bash
cd /path/to/FoundryVTT/Data/modules
git clone https://github.com/lyguner-blip/player-custom-automation-effects.git
```

## 依赖

必需：

- player-custom-cinematic-effects

推荐：

- Sequencer
- Midi-QOL

`Midi-QOL` 可用时，模块会尽量使用自动化伤害流程；不可用时会回退为提示性掷骰或通知。

## 使用方式

1. 先安装并启用 `player-custom-cinematic-effects`。
2. 启用本模块。
3. 打开“玩家定制特效库”控制面板。
4. 在角色条目中查看“定制自动化”区域。
5. 根据需要打开或关闭狂热冲锋的移动、动画、伤害和衔接攻击选项。

## 设置项

模块提供以下世界设置：

- 启用特效库绑定角色的狂热冲锋自动化
- 狂热冲锋移动 Token
- 狂热冲锋联动动画
- 狂热冲锋最大距离
- 创建下一击提示状态
- 自动结算狂热冲锋下一击伤害
- 狂热冲锋后弹出武器攻击选择
- 启用特效库绑定角色的武僧武功自动化

## 开发

脚本结构：

- `module.json`：Foundry 模块清单
- `scripts/main.mjs`：注册器与入口，只负责 Hook、Socket、面板拼装和自动化分发
- `scripts/constants.mjs`：模块 ID、依赖模块 ID、设置键名
- `scripts/automations/*.mjs`：单个自动化的完整实现，每个文件维护一个能力或一组高度相关的能力
- `scripts/shared/*.mjs`：跨自动化复用的上下文、权限、Token、移动和 Socket 工具
- `styles/module.css`：自动化面板样式
- `lang/zh-CN.json`：中文设置文案

新增自动化时，优先在 `scripts/automations/` 下新建独立文件，并导出统一对象：

```js
export const exampleAutomation = {
  id: "example",
  label: "示例自动化",
  registerSettings,
  isEnabled,
  isActivity,
  findItem,
  run,
  renderPanel,
  shouldOwnAnimation,
  handleAction
};
```

然后在 `scripts/main.mjs` 的 `automations` 数组中注册。除非要新增全局 Hook 或公共分发规则，否则不要把具体自动化逻辑写回 `main.mjs`。

提交前可以做基础语法检查：

```bash
node --check scripts/main.mjs
node --check scripts/automations/zealous-charge.mjs
node --check scripts/automations/monk-focus.mjs
node --check scripts/shared/context.mjs
node --check scripts/shared/tokens.mjs
```

## 隐私与发布

仓库中的 `manifest` 和 `download` 字段使用 GitHub 地址，不包含私人服务器 IP 或本地部署路径。

