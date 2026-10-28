# Ember Echoes（余烬回响）

A playable game design and numerical balancing project.

面向中国大陆 2027 届校招的数值策划作品集项目。计划以浏览器可玩的原创回合制战斗 Demo，展示机制拆解、规则设计、集中参数配置、数值模拟、策略比较、敏感性分析，以及依据测试证据进行平衡迭代的能力。

负责人主导游戏设计、数值策划、测试方案和分析，Codex 辅助开发。角色、技能、敌人、数值与关卡原创，局部机制参考成熟回合制 RPG 与 Roguelike。项目保持小型、清晰、可维护，不追求复杂技术架构。

## 当前状态

- 已完成（Task 01 交付内容）：设计与数值规范、后续测试计划、开发路线、基础工程、占位首页。
- 进行中：阶段 1 交付审查，等待负责人确认。
- 计划中：规则引擎、可玩界面、三战成长、Python 模拟、数值迭代和部署。

**战斗 Demo 尚未实现。** 当前没有战斗逻辑、状态机、运行时游戏参数配置、自动化规则测试或 Python 模拟器。

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

检查：

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

当前 `npm test` 因无测试文件而非零退出，这是“尚无实际测试”，不是规则测试通过。后续测试放入 `tests/**/*.test.ts`。`typecheck` 先生成 Next 路由类型，支持干净安装后独立执行。

## 目录与边界

```text
app/                    路由、布局、全局样式和静态占位首页
data/README.md          后续集中配置的约定（尚无运行时配置）
docs/GAME_DESIGN.md      玩法定位与设计边界
docs/NUMERICAL_SPEC.md   精确参数、结算、边界与待确认项
docs/TEST_PLAN.md        后续规则与一致性测试计划
docs/ROADMAP.md          分阶段交付与验收
```

后续按需要增加 `components/`（复用界面）、`lib/`（独立规则）、`tests/`（自动化测试）和 `scripts/`（模拟与分析入口），不预建空目录。基础参数将集中在 data/ 的 JSON 或 TypeScript 配置，规则加成与状态由独立引擎管理，组件不得复制战斗计算。

## 后续路线

1. 设计规范与工程基础（本次，待审查）。
2. 纯 TypeScript 战斗规则引擎。
3. 浏览器可玩战斗界面。
4. 三场战斗与成长流程。
5. Python 批量模拟与数据分析。
6. 数值迭代与结果验证。
7. 部署和作品集整理。

详细验收见 [路线](docs/ROADMAP.md)，规则见 [游戏设计](docs/GAME_DESIGN.md) 与 [数值规范](docs/NUMERICAL_SPEC.md)，测试见 [测试计划](docs/TEST_PLAN.md)。跨战斗能量继承或重置尚未指定，须在相关实现前确认。本次不自动进入下一阶段。

## 工具兼容性说明

当前 Next.js lint 插件的 peer 范围尚不支持 ESLint 10，因此固定 ESLint 9.39.5。该版本已被 npm 标记为上游停止支持；待插件兼容更新后再升级，不以强制忽略 peer 依赖解决。当前无实际规则测试，后续阶段需补齐。
