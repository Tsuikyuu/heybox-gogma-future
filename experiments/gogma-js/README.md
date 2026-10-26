# 纯 JS 搜索评估原型

这是独立性能实验，不接入小程序业务入口。实现 Reset 观测编译、32 位初始化、GF(2) 跳转、种子/位置搜索和 Reset 预测；仅评估 counterGate 已启用的情况。没有完整产品输入校验、技能/Keep 搜索、存档持久化或后台恢复。

## 复现

准备 [GogmaSeedFinder](https://github.com/apeshinzo78/GogmaSeedFinder) 提交 `65789e9aa17e434a7f5d74d18ab1f9e1365920eb`，保留其 `web/pkg` 与 `tests/fixtures`。在本目录运行：

```sh
bun benchmark.mjs /absolute/path/to/GogmaSeedFinder
```

此命令先进行 129 组 fixture/差分验证，再各执行三次 JS/WASM 单线程计时。窄范围使用 100 万种子，1001/2001 位置使用 10 万种子；搜索区间起点为 86,300,000，包含目标种子 86,315,169。输出的 `results.jsonl` 为本次最终结果。

浏览器基准无需上游目录或 WASM。在本目录运行：

```sh
python3 -m http.server 4186 --bind 127.0.0.1
```

访问 `http://127.0.0.1:4186/browser.html` 并点击运行。完整一亿种子、单位置测试地址：

```text
http://127.0.0.1:4186/browser.html?seeds=100000000&widths=1&first=0
```

页面明确禁止 Worker、connect 与 WASM 编译，仅使用外部静态 JS、TypedArray 和定时器分块。默认目标块耗时 8ms，批量上限 50,000；参数仅供开发人员测量。窄范围和宽范围种子样本数不同，必须按输出的 `seeds` 解释结果。

`results.jsonl` 来自 Bun/JSC；浏览器结果与环境见 [评估报告](../../docs/gogma-stargazing/07-js-feasibility.md)。这两者均不是小黑盒手机真机结果。

## 来源与授权

原型参考/移植 apeshinzo78 的 GogmaSeedFinder 固定提交，保留其 [MIT License](LICENSE)。跳转应用改为 64 KiB 字节查表；搜索热点使用标量状态，避免逐步写入 TypedArray。

算法研究的原始参考为 WiseHorror 的 [Gogma Artian Roll Planner 0.9.3](https://www.nexusmods.com/monsterhunterwilds/mods/4705)。上游的 [THIRD_PARTY_NOTICES.md](https://github.com/apeshinzo78/GogmaSeedFinder/blob/65789e9aa17e434a7f5d74d18ab1f9e1365920eb/THIRD_PARTY_NOTICES.md) 记录了来源、允许修改/再分发时的署名条件及 Nexus Donation Points 限制；MIT 不覆盖第三方材料的其他权利。本目录不包含游戏图片、名称表或 GARP 源文件。
