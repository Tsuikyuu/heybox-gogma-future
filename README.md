# heybox-gogma-future

基于官方 `hb-sdk create` 模板的空白小黑盒工坊小程序，使用 Vanilla TypeScript、Vite 和 Bun。

## 环境

- Node.js >=22.20.0（官方 CLI 运行要求；当前使用 22.22.0）
- Bun 1.3.1（包管理及脚本执行，依赖锁定在 `bun.lock`）
- TypeScript 正式版 `typescript@7.0.2`，使用 `tsc` 检查类型
- `@heybox/hb-sdk` 0.9.3；项目级 Skill 位于 `.agents/skills/hb-sdk`

## 安装与检查

```sh
bun install --frozen-lockfile
bun run doctor
bun run typecheck
bun run build
```

`build` 先检查类型，再执行官方构建，输出到 `dist/`。构建无需登录或绑定远端小程序。Bun 管理依赖，SDK CLI 按其 Node.js 入口运行。

已验证依赖锁定安装、TS7 类型检查和生产构建通过。当前 SDK 0.9.3 的 `doctor` 确认项目级 Skill 正常，但在官方安装器成功安装后仍报告 Codex/Cursor 的 `SKILL_MISSING`，退出码为 1；该诊断尚未完全通过。空模板构建会提示尚未填写功能简介，待明确业务后补充。

## 开发调试

先登录并创建或绑定自己的小程序：

```sh
bun run hb-sdk login
bun run hb-sdk remote create
# 已有远端小程序时，改用：
# bun run hb-sdk remote bind <mini-program-id>
bun run dev
```

CLI 登录需要本人完成。`dev` 启动前校验登录、绑定和远端配置，通过后自动打开浏览器调试台；使用 `bun run dev --no-open` 可禁止自动打开。访问终端打印的调试台地址，空模板显示空白页面。真机调试需有效启动票和同一局域网。

## 目录

- `src/main.ts`：空白业务入口
- `src/styles.css`：基础样式与安全区
- `index.html`：空的 `#app` 容器
- `vite.config.ts`：官方 Manifest 插件和相对资源路径
- `tsconfig.json`：严格类型检查配置
- `assets/heybox-placeholder.png`：官方发布资料占位图

需要平台能力时，从 `@heybox/hb-sdk` 公开入口导入 SDK，并按官方文档声明实际所需权限。

## 发布前配置

在 `package.json#heybox` 填写真实名称、功能简介、类别并替换占位图，按实际适配与验收结果调整目标平台。空模板尚未确定用途，因此暂用官方 `other` 类别、空权限和未绑定状态，不预填功能简介或游戏关联。

```sh
bun run deploy --release-note "更新说明"
```

该命令会上传并提交审核，仅在准备发布时执行。

文档：[安装](https://docs.xiaoheihe.cn/hb_sdk/guide/installation)、[CLI](https://docs.xiaoheihe.cn/hb_sdk/guide/cli)、[AI 文档索引](https://docs.xiaoheihe.cn/hb_sdk/llms.txt)。
