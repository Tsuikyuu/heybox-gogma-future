# heybox-gogma-future

《怪物猎人：荒野》巨戟武器完全重抽（Reset）观星助手 MVP，使用 Vanilla TypeScript、Vite、Zod 和 Bun。

仅面向小黑盒移动端触屏使用（Android / iOS / 鸿蒙）。界面使用单列布局、底部导航、40px 常规按钮、36px 小按钮和 16px 输入字号；输入时收起底部导航，并支持系统减少动态效果设置。桌面浏览器只用于开发预览。

## 已实现

- 新玩家：建立档案、五槽连续样本录入与修改、范围搜索、额外样本验证、回档／继续采样位置确认。
- 已有状态玩家：GSF1／GSF2 解析预览、手输种子与位置、仅有种子时进入位置搜索。
- 本地分块搜索：进度、纯计算估时、暂停／取消、保存真实游标、重新打开后续搜；宽位置范围按 32 个 counter 分片。
- Reset 预测：每次最多 10,000 抽，五条选填加成需求，同类别向高级匹配，每条加成仅计数一次；多武器目标收藏、分页和同格冲突提示。
- 技能组合预测：预测页切换“技能组合”，导入 GSF2 或手动设置已知技能位置后，按武器、属性、系列技能和组合技能筛选最多 10,000 抽；每页 30 条，显示绝对技能位置、垫刀次数与含目标次数。两类技能名均以简体中文展示，按上游中文术语表转换，保留原有抽选顺序与索引。位置随备份、续接码与保存检查点保留；游戏操作后需手动同步技能位置。
- 技能计数器定位：在「观星 → 技能组合」中设置已知位置，或在已知共同种子后建立独立技能采样，录入至少两抽连续技能对，在显式范围内搜索第一抽的技能 counter（每次最多 10,000 个位置）。支持追加／删除末次样本后重搜、候选选择、额外一抽核对，以及同步到采样前或全部样本之后的位置。样本和搜索状态随档案持久化，不改写复原计数；定位后进入预测页筛选未来结果。
- 保存需求：每档案最多 20 条，每条对应一把武器，随 JSON 备份保留。计划页从当前位置向后搜索最多 10,000 次，通过位置与需求的二分图匹配求满足全部待获得需求的最少总强化次数，列出垫刀、武器与目标加成；可替换执行目标。确认采用后标记已获得，回档与误记修正同步恢复。
- 执行：垫刀计数、目标采用／拒绝／不一致、游戏保存检查点、回档同步、工具误记修正；复原操作不改变已知技能位置。
- 多档案本地保存、名称与计数修改、删除、完整 JSON 文本备份导入导出，以及当前工具状态／游戏保存点的续接码。采样武器仅作为采样元数据，预测目标独立选择。
- 单次垫刀计数与撤回、每页 10 条执行记录、独立关于页面，以及统一黑白风格的自定义选择面板。

业务范围为 Reset 与技能预测，通过连续样本及额外一抽核对预测。未知 counter 需要显式有界搜索，不保证任意未知存档都能快速识别。技能定位目前需要档案已取得共同种子及复原位置；技能执行计划、Keep 预测、材料最优规划及 OCR 尚未实现。技能算法已通过上游 40 抽公式向量，尚未独立实机验证。完整需求见 [设计稿](docs/gogma-stargazing/08-product-design.md)。

## 快速业务预览

```sh
bun run dev:web
```

打开 Vite 输出的地址。此模式显式使用浏览器 `localStorage`，界面标注“浏览器开发预览”；数据与小黑盒 Host 存储不互通。仅开发服务跳过 Runtime Gate，生产构建始终保留官方插件与 Runtime Gate，并调用 SDK `storage`。

正式宿主调试使用下文的 `bun run dev`。浏览器业务预览不代表小黑盒 Mock 或真机验收通过。

## 环境

- Node.js >=22.20.0（官方 CLI 运行要求；当前使用 22.22.0）
- Bun >=1.3.1（当前 MVP 使用 1.4.0 验证，依赖锁定在 `bun.lock`）
- TypeScript 正式版 `typescript@7.0.2`，使用 `tsc` 检查类型
- `@heybox/hb-sdk` 0.9.3；项目级 Skill 位于 `.agents/skills/hb-sdk`

## 安装与检查

```sh
bun install --frozen-lockfile
bun run doctor
bun run check
bun run build
```

`build` 先检查类型，再执行官方构建，输出到 `dist/`。构建无需登录或绑定远端小程序。Bun 管理依赖，SDK CLI 按其 Node.js 入口运行。

MVP 已通过 TS7 类型检查、生产构建与 28 项测试（含 126 组移植差分、最短路线与穷举对照，以及 40 抽技能公式向量、u32 边界、技能位置搜索／校准和双轨状态保存）。测试从 `tests/` 目录运行 `bun test`，不要从仓库根运行测试。浏览器已走通两类用户的核心闭环、需求保存与刷新恢复、路线应用与获得状态记录、存档管理和执行记录翻页，并检查窄屏三个主页面无横向溢出。技能预测另已检查 GSF2 导入、结果生成、翻页与技能对筛选；技能定位已走通四抽采样、搜索、额外核对及未回档同步。

此前 SDK 0.9.3 的 `doctor` 确认项目级 Skill 正常，但报告 Codex/Cursor 的 `SKILL_MISSING`；该历史诊断尚未解决。当前未登录 CLI、未绑定远端小程序，游戏 appid 查询被登录状态阻断；未猜填绑定 ID。真机性能、Host 存储配额／生命周期与发布平台适配仍待验收。详见 [MVP 验证记录](docs/gogma-stargazing/09-mvp-status.md)。

## 开发调试

先登录并创建或绑定自己的小程序：

```sh
bun run hb-sdk login
bun run hb-sdk remote create
# 已有远端小程序时，改用：
# bun run hb-sdk remote bind <mini-program-id>
bun run dev
```

CLI 登录需要本人完成。`dev` 启动前校验登录、绑定和远端配置，通过后自动打开浏览器调试台；使用 `bun run dev --no-open` 可禁止自动打开。真机调试需有效启动票和同一局域网。

## 目录

- `src/main.ts`：双入口、观星／预测／计划页面与交互
- `src/engine.ts`：Reset RNG、跳转、预测与约束搜索
- `src/model.ts`：档案校验、续接码、位置与执行状态转换
- `src/search.ts`：分块计算、暂停续搜与进度
- `src/planner.ts`：多需求最少强化次数路线
- `src/storage.ts`：SDK 持久化与显式浏览器开发适配
- `src/styles.css`：响应式样式与安全区
- `tests/mvp.test.mjs`：算法、恢复与执行状态测试
- `vite.config.ts`：官方 Manifest 插件和相对资源路径
- `tsconfig.json`：严格类型检查配置
- `assets/heybox-placeholder.png`：官方发布资料占位图

需要平台能力时，从 `@heybox/hb-sdk` 公开入口导入 SDK，并按官方文档声明实际所需权限。

## 发布前配置

已填写名称、实际功能简介、`tool` 类别和 `storage` 权限，平台声明仅保留 Android、iOS、鸿蒙。发布前替换占位图，登录后通过 `hb-sdk remote games search "Monster Hunter Wilds" --json` 核对关联游戏，并完成移动端真机验收。构建时的桌面平台建议可忽略，本项目仅面向触屏。

```sh
bun run deploy --release-note "更新说明"
```

该命令会上传并提交审核，仅在准备发布时执行。

文档：[安装](https://docs.xiaoheihe.cn/hb_sdk/guide/installation)、[CLI](https://docs.xiaoheihe.cn/hb_sdk/guide/cli)、[AI 文档索引](https://docs.xiaoheihe.cn/hb_sdk/llms.txt)。
