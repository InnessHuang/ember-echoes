# Ember Echoes（余烬回响）

A playable game design and numerical balancing project.

面向中国大陆 2027 届校招的数值策划作品集项目。计划以浏览器可玩的原创回合制战斗 Demo，展示机制拆解、规则设计、集中参数配置、数值模拟、策略比较、敏感性分析，以及依据测试证据进行平衡迭代的能力。

负责人主导游戏设计、数值策划、测试方案和分析，Codex 辅助开发。角色、技能、敌人、数值与关卡原创，局部机制参考成熟回合制 RPG 与 Roguelike。项目保持小型、清晰、可维护，不追求复杂技术架构。

## 当前状态

- 已完成（Task 01）：设计规范、基础工程、占位首页。
- Task 02：集中配置、纯 TypeScript 战斗引擎和 Vitest 规则测试已实现，28 项测试、lint 和类型检查通过；生产构建暂时明确使用 Webpack，普通 `npm run build` 已通过，Task 02 验收完成。详见测试计划。
- Task 03：单场战斗页面已接入现有引擎，包含意图、四种行动、结算日志、胜负与重开；已完成 Chromium 桌面与手机尺寸交互验收，设计者认可当前视觉方向。
- 计划中（Task 04 起）：三战流程与升级选择、Python 模拟、数值迭代和部署。

**首页现为单场战斗 Demo。** 固定对战轻型敌人“失落的战士”，不包含完整三战流程、战后升级选择、存档或 Python 模拟器。

## 技术栈与运行

Next.js（App Router）、TypeScript 严格模式、Tailwind CSS、Vitest、ESLint。Node.js 使用 24 LTS（`.nvmrc` 固定为 24.19.0），npm 11；依赖使用精确版本与 `package-lock.json`。不需要数据库、账号、API 或密钥。

```sh
# 在仓库根目录；如使用 nvm，先执行 nvm use
npm ci
npm run dev
```

本地浏览器访问 http://localhost:3000。生产模式：

```sh
npm run build
npm run start
```

由于当前 Codex 云环境中 Turbopack 的 PostCSS 子进程 socket 绑定出现权限错误，`build` 脚本暂时明确使用 `next build --webpack`。这不代表 Turbopack 构建已通过；开发脚本、Next.js 与 PostCSS 配置及依赖版本保持不变。

检查：

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` 运行 `tests/game-engine.test.ts` 的真实规则测试；`typecheck` 先生成 Next 路由类型，支持干净安装后执行。

## 目录与规则 API

- `data/game-config.ts`：冻结的基础参数。
- `lib/game/types.ts`：进度、战斗、意图及行动结果类型。
- `lib/game/engine.ts`：独立纯函数，无 React、Next.js、DOM、网络或随机依赖。
- `tests/game-engine.test.ts`：确定性规则与不可变性测试。
- `components/battle/`：交互入口、状态/行动/日志/结果面板、原创 SVG 战场和日志适配器。
- `tests/battle-ui.test.ts`：Node 环境下的渲染、按钮回调和引擎状态流测试。
- `app/`：单场战斗页面与响应式样式；`docs/`：设计、数值、测试和路线。

公开 API：`createInitialProgress()` 初始化或重开；`applyUpgrade(progress, id)` 累计升级；`startBattle(enemyId, progress)` 保留生命和升级、重置能量为 2；`getEnemyIntent(state)` 预告下一次攻击（终局为 null）；`performAction(state, actionId)` 校验和结算单次行动；`getPlayerProgress(state)` 提取生命与升级供下一场使用。拒绝行动返回原状态和原因，不推进回合。行动 ID 为 attack（普攻）、heavy（重击）、defend（防御）、charge（蓄能）。

## 后续路线

1. 设计规范与工程基础（Task 01 已完成）。
2. 纯 TypeScript 战斗规则引擎。
3. 浏览器可玩战斗界面。
4. 三场战斗与成长流程。
5. Python 批量模拟与数据分析。
6. 数值迭代与结果验证。
7. 部署和作品集整理。

详细验收见 [路线](docs/ROADMAP.md)，规则见 [游戏设计](docs/GAME_DESIGN.md) 与 [数值规范](docs/NUMERICAL_SPEC.md)，测试见 [测试计划](docs/TEST_PLAN.md)。跨战斗能量已确认每场重置为 2，生命与升级保留。本次不自动进入下一阶段。

## 工具兼容性说明

当前 Next.js lint 插件的 peer 范围尚不支持 ESLint 10，因此固定 ESLint 9.39.5。该版本已被 npm 标记为上游停止支持；待插件兼容更新后再升级，不以强制忽略 peer 依赖解决。规则测试已在 Task 02 补齐。

## 单场体验与验证边界

运行 `npm ci`、`npm run dev` 后在浏览器打开 http://localhost:3000。观察下一次敌方意图，点击普通攻击、重击、防御或蓄能；能量不足的重击可点击查看原因，不推进战斗。胜负后行动禁用，点击“重新开始”恢复完整初始状态。规则入口支持原生 details 展开，按钮支持 Tab/Enter，系统设置减少动态效果时停用动画。

也可运行 `npm run build` 后用 `npm start` 体验生产版本。build 继续使用 Webpack。Task 03 验收与人工检查清单见 [测试计划](docs/TEST_PLAN.md)。未增加浏览器测试依赖；另使用环境预装的 Chromium/Playwright 验证了真实浏览器交互。Safari、Firefox 和真实手机设备仍未验证。
