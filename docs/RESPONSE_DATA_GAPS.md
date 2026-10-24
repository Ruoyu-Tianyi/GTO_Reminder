# 后续响应图：已转录范围与仍然缺失的数据

复核日期：2026-10-03。本轮已接入 6/9 人的全部 51 张 Facing 3-bet 图和 8 人的 119 张图；“全部图已接入”不表示所有手牌都能从原稿读取。这里只记录公开 PDF 能支持的结论，不将图表转录称为原始 solver 输出。

独立本机库在 2026-10-13 合计 **27,914 个 v2 历史决策、212 个 v1 快捷节点、64 个文件**。6/7 人四次加注和新增 9 人三次加注研究结果仍未收敛，不能用它们消除出版原稿的缺失记录；9 人模型面对 4-Bet 仅有 Fold/Call，不包含 5-Bet。

## 核对的原稿

| 来源 | 本地原稿 | SHA-256 | Facing Open | Facing 3bet |
| --- | --- | --- | --- | --- |
| [RangeConverter 6-max 100bb 100z](https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash) | `data/private/research/rangeconverter-6max-100bb.pdf` | `60da589b490f5c90cf106b18870956d09f0ac257fec4dce516a86f724280a967` | PDF 4–8 页，15 个面对开池场景 | PDF 9–13 页，15 个场景 |
| [RangeConverter 9-max 100bb](https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash) | `data/private/research/rangeconverter-9max-100bb.pdf` | `0feb70db01ab74db6d6a8cb6e9761358f6eb04879468452f8429e027c6770b27` | PDF 4–10 页，36 个面对开池场景 | PDF 11–18 页，36 个场景 |

这些页码是 PDF 的一基页码。6-max 的 `MP` 对应应用中的 `HJ`；9-max 的 `UTG1` / `UTG+1` 对应 `UTG+1`，`MP` 对应 `UTG+2`。不能把同名位置跨人数复用。

两份 PDF 第 2 页说明，每手牌动作频率已简化到最接近的 50%。横向双色格可以转录为出版图表的 50/50，但不是原始求解器恰好给出的 50/50。图例中的小数汇总仍需原样保留，不能用来反推、调整或补齐单手牌频率。

## Facing Open 可以直接转录什么

这 51 个面对开池场景展示完整的 169 格动作颜色，能够按各图实际图例转录 `Raise`、`Call`、`Fold`。独立校验确认，本地 12 张 `*-response-page*.png` 与对应原稿内嵌图片的 RGB 像素完全一致。

必须逐图保留尺寸和动作集合。例如 6-max `HJ vs UTG` 的图例是 `Raise 8.48 BB / Fold`，没有 Call；`BB vs SB RFI` 的 Raise 为 10.02 BB，不能套用该页其他 BB 图表的 11.03 BB。图表有 Call 图例但简化后的所有格都没有 Call，也是允许的；不能为了凑图例汇总而制造手牌频率。

9-max 第 10 页 `BB vs MP`（应用中的 `BB vs UTG+2`）确实没有下注尺寸和汇总图例，且网格高度与同页其他图不同。该图完整的 169 格可以转录，但 `raiseToBb` 和印刷汇总必须保持 `null`，不能借用相邻图的 13 BB。

本批独立复核读取原 PDF 内嵌图片，以不同于转录脚本的宽带 HSV 色相分类检查全部 8,619 手牌，与 `derived-response-ranges.json` 的动作频率差异为零；同时核对位置标题、打印 Raise/Call 汇总和具体下注尺寸。这验证的是对出版图表的转录一致性，不是原始 solver 精度或求解正确性。

6-max 第 8 页另外有 `BB vs SB Limp`，不属于上述 15 个 Facing Open 场景。它的绿色图例虽写 `Call`，但在 SB 仅补足至 1 BB 后，BB 的被动动作实际是 **Check**。未来接入时应单独识别该行动线，不能将其误标为 Call 或面对 Raise。

## Facing 3bet 使用独立引用格式

原图同时展示两种信息：横向色块区分当前动作，纵向彩条高度则反映此前到达范围。后者没有足够精度用于还原数值 reach。

- 深色或灰色部分不是 Fold。只有明确的蓝色动作条才表示 Fold；没有可辨认动作条的手牌应留为未表示或无法辨认。
- 部分彩条只剩一两行像素。抗锯齿、文字、格线都可能改变采样结果，不能将颜色识别失败补成 Fold，也不能把“不可见”断言成严格的零 reach。
- 不能从已简化 RFI 表重建 reach。例如同一份 6-max 100z 原稿中，UTG RFI 的 `55` 已简化为 Fold，但 UTG 面对 3bet 的图中仍有极细的绿色动作条。`66` 的彩条高度也不等于其 RFI 表中离散的 50% 权重。
- 9-max 图有独立红色 **All-in**，不能并入橙色固定尺寸 4bet。例如第 18 页 `SB vs BB 3bet` 的 `AQo` 显示红绿混合，图例同时列出 `28 BB` 和 `All-in`。
- 不能按全部 1326 个组合均匀加权，声称得到了该节点整体动作频率。正确的节点汇总需要每手牌或每组合的 reach；目前原稿不能可靠提供精确数值。

本轮通过 `scripts/transcribe-reference-later.py` 转录这 51 张图的**可独立核验手牌**，输出独立 `reference-ranges` 格式，不进入精确条件 v1/v2 库。每个可读手牌须同时通过两个不重叠的三行扫描带、半格色块以及独立 RGB 距离 / HSV 分类检查。仍看不清的细条保留 `unreadable`，暗灰未表示区域保留 `not-charted`；二者均无频率，也不声称严格零 reach。

原始每手动作精度仍为 0/50/100%。9 人固定 4-bet 和 All-in 分成不同动作；不把它们合为一个 Raise。纵向条高不转成历史 reach，因此不计算该节点的整体动作百分比。这一处理补充了原图能证实的数据，也保留了原稿不能证实的缺失。

## 尺寸与文件版本不能混用

6-max 100z 的 4bet 图例包含 23.62、23.8、25.04、25.01、27.06 BB，需逐图记录。9-max 大部分固定尺寸为 26 或 28 BB；放大原生图例确认 **`UTG vs SB` 为 26 BB**，不是旧文档写的 28 BB。`UTG vs BB` 为 28 BB。尺寸已经逐图记录，不能仅按对手位置或相邻图推断。

复核发现，旧的 `rangeconverter-page9.png` 与上述 100z 原稿第 9 页不是同一内容。该无版本文件名不能作为 100z 转录源；必须从已核实 SHA-256 的 PDF 提取原生图片，并保留页码、图内位置及坐标。不能因文件名相似而混入另一 rake 版本。

## 独立引用格式的数据边界

当前引用格式与展示层采用以下边界：

1. 可读手牌仅保存当前条件动作频率，格式不宣称已有历史 reach。审计中的未知 reach 保持 `null`，不可从像素高度制造精确小数。
2. 允许手牌级缺失，并区分可读、未表示、无法辨认；只有源数据明确说明时才能标记严格零 reach。
3. 一个节点可有多个 Raise 选项，分别保留固定尺寸与 All-in；同时保留 Check 和 Call 的语义区别。
4. 对每个已转录手牌保存原图定位及校验结果；细条不足以独立复核时只显示原图，不输出猜测频率。
5. 保留原图汇总与转录汇总的不同含义。没有可信 reach 就不展示节点整体百分比。
6. 精确匹配仍需要完整行动历史、各席筹码、尺寸、ante、rake 与求解条件。人数和位置吻合只能支持参考关联，不能证明精确策略匹配。

## 8 人、7 人及本机计算

8 人 PokerCoaching 的 119 张图包括 7 RFI、28 Facing Open、28 Facing 3-bet、28 Facing 4-bet、27 Facing 5-bet 和 1 BB vs SB Limp。颜色条宽度测量按整百分点表示，约 ±2 个百分点；不称为原始细粒度频率。黑格仍为未表示。72 项印刷总量交叉核验最大偏差 0.1909 个百分点，未用汇总反推或修补单手牌。源图缺失的 UTG vs UTG+1 Facing 5-bet 继续保持缺失。

重新放大标题后，第 17 页 CO vs BB Facing 3-bet、第 24 页 UTG+1 vs BB Facing 5-bet、第 26 页 CO vs BB Facing 5-bet 均确认与文字层一致。此前的冲突报告来自缩略图误读，已修正索引。具体审计见 [POKERCOACHING_TRANSCRIPTION.md](POKERCOACHING_TRANSCRIPTION.md)。

7 人另有 **91 个位置映射估算**：删除 8 人最早 UTG，把 UTG+1 映射为 7 人 UTG，保留其余顺序与原图尺寸。它忽略被删除座位对手牌分布与策略的影响，没有重新求解，不是独立的 7 人精确策略。结合旧 64 张、6/9 人新增 51 张及 8 人 119 张，引用总量为 **325**；其中独立出版原图 234 张，映射估算 91 个。

本机 `computed` 策略是另一条数据来源。2026-10-03 已验证基线中，6/7/8/9 人共 27,270 个 v2 决策和 126 个 v1 快捷节点，限于 100 BB、无 ante、5% rake / 2.5 BB cap / no flop no drop、2.5 BB Open / 10 BB 3-bet、最多两次加注、无 Limp。它有树内 Cold Call / Squeeze，但**没有后续 4/5-bet**。近似后续模型不能称为完整 GTO；6–9 人均达到模型内部目标，9 人最终 54 轮的快照测得模型最佳响应差之和为 0.017725984946639545 BB/hand。计算策略不用于替换纸面缺失或“修正”出版频率，也不计为 imported 覆盖。Quick 在 v1 缺失时可查询同源 v2 精确历史，保留 reach 和手牌状态，不增加原稿覆盖。追加试算只有核验后才成为新的正式快照，详见 [LOCAL_SOLVER.md](LOCAL_SOLVER.md)。

9 人官方 PDF 共 18 页，已复核至最后一页 SB RFI vs 3-bet，未发现遗漏的 Facing 4/5-bet 响应图。[对应官方文章](https://rangeconverter.com/articles/poker-charts-9-max-100bb-no-limit-texas-holdem)也只列 RFI、Facing Raise、Facing 3-bet；[完整翻前范围文件](https://rangeconverter.com/gto-preflop-ranges-for-piosolver-and-monkersolver)属于另行购买的产品。面对 3-bet 图中的 4-bet 或 All-in 动作，不能当作下一轮的响应数据。

另增两个最多四次加注的研究包，固定尺寸为 2.5 / 10 / 30 / 100 BB：6 人有 Limp，39 轮，导出 200 个历史决策；7 人无 Limp，40 轮，导出 160 个。合计另有 42 个快捷节点和 4 个文件。这些结果支持导出范围内的后续 4/5-bet 标准线，但最终快照均未收敛、`modelGapBb: null`。求解使用完整建模树，导出只保留最多两名主动投入者和最多一次未加注 Limp 的 `heads-up-lines`；其余多人分支未导出。它们不替代 9 人的缺失数据，也不把研究结果标成出版参考。

公开图表仍不覆盖全部尺寸、深度、cold-call、squeeze、多人入池及完整多轮加注树；6/9 人缺少的 Facing 4/5-bet 原图也不能从其他人数推导。后续应取得专业来源数据，或导入有权使用且参数明确的求解器导出。公开可下载不等于已经取得随 GitHub 仓库再分发的许可；原稿和转录继续保留在被忽略的本地目录。
