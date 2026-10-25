# 种子恢复与未来预测

补充日期：2026-10-26。依据 S11：GogmaSeedFinder，固定提交 `65789e9aa17e434a7f5d74d18ab1f9e1365920eb`。本次阅读了 README、RNG_SPEC、SEED_SEARCH、WEB_POC、rng-core 源码、golden 测试及第三方声明；未运行上游测试或进行本仓库实机验证。

## 1. 结论修正

社区已有可检查的确定性 RNG 实现和观测反推方法，能够生成复原加成与技能的未来列表。“未找到种子算法”“只能记录已经试抽的位置”不再适合作为本项目的能力前提。

恢复的不是单独一个万能数字，而是**共同基准种子 + 对应抽取位置 + 武器参数 + 规则版本**。上游当前 README 表示可生成最多 10,000 次未来结果、比较最多 140 个武器 profile；这是工具展示范围，不是游戏序列长度。部分早期专题文档仍写 1,000 次或尚未部署，功能现状以该提交 README 为准。

## 2. 共同种子与独立位置

```text
baseSeed         存档共同基准种子
gogmaCounter     复原位置：Reset 与 Keep 共用
skillCounter     技能位置：与复原独立
```

一次操作推进相应 counter 一格，每格对应 RNG 的 10 次状态转移。换武器不重置 counter，而是改变 effective seed，所以同一行的不同武器可以得到不同结果。

相对位置 0 指采样前存档，不代表绝对 counter 为 0。必须保留恢复出的绝对位置；只保留 seed、把 counter 清零，会算出另一段结果。

上游续接码为工具状态编码，不是游戏中的单个种子字段：

```text
GSF1-<baseSeed>-<nextGogmaCounter>
GSF2-B<baseSeed>-G<nextGogmaCounter>-S<nextSkillCounter>
```

采用复原行后只更新 G，采用技能行后只更新 S。新的保存点可显示为相对 0，但另一轨道已知位置必须保留。

## 3. RNG 核心

所有运算采用无符号 32 位溢出语义：

```text
effectiveSeed = (baseSeed + weaponType * 1000 + attributeForce) XOR 0x00AC9365
初始 (x,y,z,w) = (0x159A55E5,0x1F123BB5,0x05491333,0x05491333)
按上游 initialize 规则混入 effectiveSeed，恰好 100 轮

t = x XOR (x << 15)
nextW = w XOR (w >> 21) XOR t XOR (t >> 4)
state = (y,z,w,nextW)
```

以上概述不能替代完整初始化实现。未来若移植到 TS，需显式处理无符号右移、32 位截断，并与上游 golden vectors 对照，不能直接按 JS 普通数值运算翻译。

`weaponType` 的 0～13 顺序是：大剑、片手、双剑、太刀、大锤、笛、长枪、铳枪、斩斧、盾斧、虫棍、弓、重弩、轻弩。

`attributeForce` 映射：无=0、火=1、水=2、雷=4、冰=3、龙=5、毒=6、麻=7、眠=8、爆破=9。尤其雷与冰不能直接套用选择器顺序。

### 技能

- `counterGate < 0x36` 时忽略技能 counter；否则从初始化状态跳过 `skillCounter × 10` 次转移。
- 再转移一次取 `w % 294`；系列索引为整除 14，组合索引为余数。
- 后续技能结果间隔 10 次转移；名称顺序及带空缺的内部技能 ID 必须保留上游表序，不能按翻译后的字母顺序重排。

### Reset Bonuses

- `counterGate < 0x23` 时忽略复原 counter；否则跳过 `gogmaCounter × 10` 次转移。
- 从当前游标的局部副本依次抽五槽，每槽推进一次后按权重抽取；下一行持久游标仍只推进 10 次。
- 近战候选 ID 顺序：`8,12,15,9,13,16,11,14,6,10`；弓去掉 `6,10`；弩去掉 `11,14`。移除发生在取模之前，不是抽完再转换。
- 每个 ID 初始权重 100；已出现一次后，EX ID `10,14,15,16` 每次减 80，其余每次减 50；非正权重候选移除。由此同类别同档位最多两条。
- 类别还有总上限：攻击 5、会心 5、斩味/装填合计 2；属性数据上限为 5，但只有两个档位候选且各最多两条，实际最多 4。

S11 修正了 GARP v0.9.3 未应用类别总上限的问题。因此后续移植不能只复制旧 GARP 公式而忽略这一实机修正。

### Keep Bonuses

使用同一个复原 counter，但每个槽位只在原类别中抽档位：攻击 `8,12,15`，会心 `9,13,16`，属性 `11,14`，斩味/装填 `6,10`。

输入为**从左到右的五槽类别布局**，旧 II/III/EX 档位不参与公式。各次抽取重新计算五槽内的重复权重。弓不接受斩味/装填布局，弩不接受属性布局。同种同属性但布局不同的武器，Keep 预测仍应分别生成。

## 4. 怎样恢复状态

### 复原观测搜索

输入武器种类、属性、连续五槽观测、种子范围、已知 counter 或有界 counter 范围，以及适用门控条件。上游示例种子搜索域为 `0..99,999,999`。

每个候选种子只初始化一次，跳至指定 counter，对照每槽输出，第一处不符即淘汰。有界 counter 搜索复用初始化和区间起点跳转，相邻 counter 仅需再推进十次。上游也把观测编译成取模区间加快筛选。

低于门控阈值时 counter 不影响输出，不能从这些输出推断其真实值。浏览器端可以手输观测完成搜索，无须直接读取游戏内存，但这不消除 counter 范围与门控条件的要求。

### 技能搜索

CLI 支持已知技能 counter 时反推种子；Web 支持先取得共同 seed，再用连续新技能对搜索技能 counter。已有武器上的旧技能不是当前位置的新抽取观测。

RNG 转移在 `GF(2)` 上为线性变换，上游用 128×128 二进制跳转矩阵定位 counter，避免对每个种子从头逐步重放全部历史。

候选数不保证由固定样本数决定：上游技能示例三抽剩 7 个候选、四抽剩 1 个；这不是所有存档“四抽必定唯一”的保证。多候选应增加连续观测，零候选应核对输入及搜索范围。

## 5. 已验证到什么程度

| 路径 | S11 的证据 |
| --- | --- |
| Reset | 斩斧、弓、重弩各六次连续实机向量；测试核对五槽 ID/名称、初始化和 counter 状态；轻弩沿用重弩池 |
| 未来与武器身份 | 上游报告斩斧未来复现；同种同属性不同实例一致，改变种类或属性可改变结果 |
| 技能 | GARP v0.9.3 四组共 40 抽向量及门控/溢出等测试；尚无独立实机序列验证 |
| Keep | 六抽 GARP 公式向量与候选池拒绝测试；尚无独立实机序列验证 |
| 双轨独立 | 已实测插入 Reset 不改变技能序列；反方向尚未独立实测 |

“上游测试覆盖”“上游实机验证”和“本仓库实测”是不同状态，不能合并宣称全武器全模式均已实测。

普通 R8 机械生产预测也已实现，但其 counter 按**武器种类和稀有度**独立，不属于上述两个巨戟全局位置。上游报告大剑、长枪、弓、重弩、轻弩共 28 把实测吻合，其余九种近战共享公式但未逐类实测，R6/R7 不支持。不要将该生产 counter 当作巨戟垫刀计数。

## 6. 对小程序的意义

- 主要能力可包含种子恢复、双位置校准、跨武器未来筛选、Reset→Keep 续接和多目标路径规划。
- 原有距离、同格冲突、材料预算仍成立；预测减少试抽负担，不会跳过正式兑现的前置操作。
- 上游采用 Rust/WASM + Web Worker 本地搜索；本项目可评估复用 WASM 或移植 TS，具体取舍需另行测量小程序容器支持和移动端性能。当前尚未实施。
- 搜索范围、候选数、算法版本和观测前缀核对结果应保存；预测记录和玩家实测分开。
- 截图/OCR 与极宽未知 counter 搜索尚未实现；上游桌面基准不能作为手机性能承诺。
- 自有代码为 MIT；GARP 及其他第三方内容按 `THIRD_PARTY_NOTICES.md` 保留出处与相应许可条件。

## 7. 固定版本阅读入口

- [README](https://github.com/apeshinzo78/GogmaSeedFinder/blob/65789e9aa17e434a7f5d74d18ab1f9e1365920eb/README.md)
- [RNG_SPEC](https://github.com/apeshinzo78/GogmaSeedFinder/blob/65789e9aa17e434a7f5d74d18ab1f9e1365920eb/docs/RNG_SPEC.md)
- [SEED_SEARCH](https://github.com/apeshinzo78/GogmaSeedFinder/blob/65789e9aa17e434a7f5d74d18ab1f9e1365920eb/docs/SEED_SEARCH.md)
- [rng-core 源码](https://github.com/apeshinzo78/GogmaSeedFinder/blob/65789e9aa17e434a7f5d74d18ab1f9e1365920eb/crates/rng-core/src/lib.rs)
- [golden 测试](https://github.com/apeshinzo78/GogmaSeedFinder/blob/65789e9aa17e434a7f5d74d18ab1f9e1365920eb/crates/rng-core/tests/gogma_golden.rs)
- [测试向量目录](https://github.com/apeshinzo78/GogmaSeedFinder/tree/65789e9aa17e434a7f5d74d18ab1f9e1365920eb/tests/fixtures)
- [第三方声明](https://github.com/apeshinzo78/GogmaSeedFinder/blob/65789e9aa17e434a7f5d74d18ab1f9e1365920eb/THIRD_PARTY_NOTICES.md)
