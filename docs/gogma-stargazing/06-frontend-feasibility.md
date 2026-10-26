# 纯前端种子发现可行性评估

评估日期：2026-10-26。上游固定提交：`65789e9aa17e434a7f5d74d18ab1f9e1365920eb`。项目依赖锁定且本次安装的 SDK 为 `@heybox/hb-sdk@0.9.3`。

## 结论

后续已完成纯 JS 原型与浏览器一亿种子、单位置完整搜索，详见 [纯 JS 计算评估](07-js-feasibility.md)。本页保留 WASM 路径的原评估。

- **算法层可纯前端运行**：上游已经使用 Rust/WASM + 独立 Web Workers 完成本地搜索，无需计算服务器、游戏进程或存档文件。
- **当前项目配置不能直接复用上游运行方案**：实际生产构建的 CSP 禁止 Worker、fetch 资源加载，且未允许 WASM 编译。
- **窄位置范围有计算可行性，完全未知位置不能承诺快速搜索**。种子恢复后，未来预测的开销明显更小。
- 建议先确认平台允许的本地 WASM/Worker 运行方式，再决定首版是否内置完整种子搜索；纯前端不等于必须纯 JavaScript。

## 搜索原理及规模

输入为武器类型、属性、连续五槽完整观测、有界种子区间、有界复原 counter 区间及适用 counterGate。代码位于 `crates/seed-search-cli/src/lib.rs`：

1. 枚举 baseSeed，组合有效种子，执行 100 轮 RNG 初始化。
2. 用预计算 GF(2) 跳转矩阵到达 counter 区间起点，避免重放全部历史。
3. 枚举区间内 counter，相邻位置推进 10 次 RNG。
4. 观测预编译为取模区间，首个不匹配槽位立即淘汰。
5. 保留与全部观测一致的 seed/counter 对。

粗略工作量为 `种子数 ×（初始化与跳转成本 + 位置数 × 单位置校验成本）`。增加样本有助于排除假候选，但大部分错误候选已经在早期槽位被淘汰，不能指望增加样本消除遍历宽位置范围的成本。

上游常用种子范围 `0..99,999,999` 是一亿候选，不应表述为穷尽全部 u32。默认位置 `475..485` 只适用于样本，不是任意玩家通用范围。counterGate 低于复原阈值 `0x23` 时输出忽略 counter，此时无法用这些观测识别真实位置。

## 上游前端架构

- `web/app.js` 创建 module Worker 并分割种子区间。
- `web/search-worker.js` 每次调用 `search_next(50_000)`，块间让出事件循环、发送进度并处理取消。
- `crates/wasm-search/src/lib.rs` 的 `GogmaCounterSearchSession` 为单线程会话；多个 Worker 各自持有独立实例。
- 不依赖 WASM threads、共享线性内存或 SharedArrayBuffer，因此不需要为了该并行结构引入跨源隔离。
- WASM glue 默认用 `fetch` 加载相对路径 `.wasm`，然后实例化；也接受调用方传入字节，但传字节不能解决 WASM 编译本身被 CSP 限制的问题。
- 固定 50,000 种子块在宽位置范围下会变慢，移动端应按实测耗时调整块大小及 Worker 数，不能直接照搬上游最多 16 个 Worker 的建议值。

## 本次计算验证

直接加载上游仓库自带 WASM，使用重弩六抽实机 fixture。运行环境：Apple M4、Bun 1.4.0，单线程，**不是浏览器或小黑盒真机测试**。

所有搜索使用种子区间 `86,000,000..86,999,999`（100 万），均只找到 `(86315169, 480)`。1/11/101 个位置分别围绕 480；1001/2001 个位置为 `0..1000`、`0..2000`。

| 位置候选数 | 本次 100 万种子实测 | 线性外推一亿种子，单线程 |
| --- | --- | --- |
| 1 | 0.245 秒 | 约 24.5 秒 |
| 11 | 0.362 秒 | 约 36.2 秒 |
| 101 | 1.921 秒 | 约 192 秒 |
| 1001 | 14.300 秒 | 约 23.8 分钟 |
| 2001 | 27.434 秒 | 约 45.7 分钟 |

外推仅用于说明规模，未实际执行一亿种子搜索，不代表手机耗时，也不能简单除以核心数作为多线程承诺。

补充观测：

- WASM 文件为 52,165 字节；本次实例线性内存从约 1.06 MiB 增至 1.125 MiB。这不包含 JS 引擎、编译代码及 Worker 的全部开销。
- 2001 个位置时，50,000 种子单块最长约 1.436 秒，说明固定块大小会影响取消响应。
- 已知状态生成 10,000 条复原结果约 2.51 毫秒，输出 50,000 字节；前六行与 fixture 一致。未计入 UI 渲染成本。
- 上游 `WEB_POC.md` 另有桌面 Chromium 记录：一亿种子 × 11 个位置、8 Workers，12.1 秒。属于上游报告，不能作为本项目手机承诺。

## 小黑盒生产环境阻碍

本次执行 `bun install --frozen-lockfile`、`bun run build` 成功，检查当前空模板 `dist/index.html`，默认注入：

```text
default-src 'none';
connect-src 'none';
script-src 'self' 'unsafe-inline' ...平台域名;
child-src 'none';
worker-src 'none';
```

按标准浏览器 CSP 语义：

| 上游依赖 | 当前产物的限制 |
| --- | --- |
| `new Worker(...)` | `worker-src 'none'` 明确禁止 |
| 默认 `fetch(...wasm)` | `connect-src 'none'` 明确禁止 |
| `WebAssembly.compile/instantiate` | script-src 没有 `wasm-unsafe-eval` 或 `unsafe-eval`，不允许编译 |

`unsafe-inline` 不代表允许 WASM 编译。将 WASM 内联、换成 Blob Worker 或只在主线程运行 WASM，都不能整体消除这些限制。

官方 CLI 文档说明：生产构建默认注入 CSP；部署时只有有效 `network` 权限（声明与远端批准取交集）启用，才跳过该平台 CSP。**这是一条可以向平台确认的公开路径，但不是 WASM/Worker 在所有 Host 上受支持的保证**，也不应仅凭本地调试临时权限通过就认定线上可运行。本次没有申请权限、绑定项目、提交审核或修改 CSP。

已查阅官方索引、安装、CLI、FAQ、兼容性表及更新日志，未找到 WebAssembly/module Worker 的明确跨端支持合同。当前项目未绑定，未完成小黑盒客户端测试。

## 方案判断

| 方案 | 评估 |
| --- | --- |
| Rust/WASM + Worker，全部在用户端计算 | 首选；需平台确认运行支持并解决 CSP 门槛，再实测 Android/iOS/OHOS |
| 移植纯 JS + 主线程小块调度 | 技术上可行的评估方向；需要移植跳转和编译约束算法、对照 golden vectors、测量性能，不承诺可接受的全量搜索等待时间 |
| 已知种子/位置导入 + 本地预测 | 计算规模很小，可独立作为功能；默认环境仍需用可运行的 JS 实现或先解决 WASM 支持 |
| 极宽未知 counter 全量搜索 | 当前不适合作为手机默认体验；优先获得范围估计、分段搜索并保存已完成区间 |

建议运行验证按以下顺序开展：

1. 获得平台对本地 Worker/WASM 及资源加载方式的确认。
2. 在真实客户端与生产等价策略下测试 module Worker、WASM 编译、消息回传和退出清理。
3. 对六抽 fixture 测试 1/11/101/1001 个位置，先测小种子区间，再选择可接受的完整范围。
4. 记录机型、系统、客户端版本、吞吐、取消延迟、UI 响应、前后台切换行为；设定实测后可兑现的搜索预算。

## 待确认能力反馈草稿（未提交）

目标：小黑盒小程序工坊私有反馈，目标 App/API 环境待确认。

> SDK 0.9.3，拟开发《怪物猎人：荒野》本地种子搜索工具。算法是纯计算，拟将约 52 KB WASM 与 Worker 脚本随小程序打包，不需要外部计算服务。当前默认生产构建包含 worker-src 'none'、connect-src 'none'，script-src 未允许 WASM 编译。请确认 Android/iOS/OHOS/Windows/macOS 是否有公开支持的本地 WebAssembly + Dedicated Worker 使用方式、最低客户端版本及资源加载要求。若需申请 network 才能使用，请确认该纯本地计算用途是否适用；若尚不支持，建议提供不开放外网的本地计算能力或独立权限。当前只有构建产物证据，没有客户端运行日志或截图，项目尚未绑定，具体机型、系统和客户端版本未知。

提交前需用户同意，并按官方反馈要求补足真实环境与附件；本次不发送工单。

## 来源

- [上游固定提交](https://github.com/apeshinzo78/GogmaSeedFinder/tree/65789e9aa17e434a7f5d74d18ab1f9e1365920eb)
- [搜索算法与基准](https://github.com/apeshinzo78/GogmaSeedFinder/blob/65789e9aa17e434a7f5d74d18ab1f9e1365920eb/docs/SEED_SEARCH.md)
- [浏览器架构与上游基准](https://github.com/apeshinzo78/GogmaSeedFinder/blob/65789e9aa17e434a7f5d74d18ab1f9e1365920eb/docs/WEB_POC.md)
- [官方文档索引](https://docs.xiaoheihe.cn/hb_sdk/llms.txt)
- [CLI 与 CSP 构建规则](https://docs.xiaoheihe.cn/hb_sdk/llms/guide/cli.md)
- [SDK API 兼容性](https://docs.xiaoheihe.cn/hb_sdk/llms/reference/compatibility.md)
- 本项目 SDK 0.9.3 默认生产构建 `dist/index.html`，生成物未加入 Git。
