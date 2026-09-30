# Facing Open / Facing 3bet：转录边界与后续缺口

复核日期：2026-09-30。这里只记录公开 PDF 能支持的结论，不将图表转录称为原始 solver 输出。

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

## Facing 3bet 为什么不能直接套用现有三动作范围表

原图同时展示两种信息：横向色块区分当前动作，纵向彩条高度则反映此前到达范围。后者没有足够精度用于还原数值 reach。

- 深色或灰色部分不是 Fold。只有明确的蓝色动作条才表示 Fold；没有可辨认动作条的手牌应留为未表示或无法辨认。
- 部分彩条只剩一两行像素。抗锯齿、文字、格线都可能改变采样结果，不能将颜色识别失败补成 Fold，也不能把“不可见”断言成严格的零 reach。
- 不能从已简化 RFI 表重建 reach。例如同一份 6-max 100z 原稿中，UTG RFI 的 `55` 已简化为 Fold，但 UTG 面对 3bet 的图中仍有极细的绿色动作条。`66` 的彩条高度也不等于其 RFI 表中离散的 50% 权重。
- 9-max 图有独立红色 **All-in**，不能并入橙色固定尺寸 4bet。例如第 18 页 `SB vs BB 3bet` 的 `AQo` 显示红绿混合，图例同时列出 `28 BB` 和 `All-in`。
- 不能按全部 1326 个组合均匀加权，声称得到了该节点整体动作频率。正确的节点汇总需要每手牌或每组合的 reach；目前原稿不能可靠提供精确数值。

因此，本批仅保留 Facing 3bet 原图与页码参考，不从这些图生成完整数值策略节点。

## 尺寸与文件版本不能混用

6-max 100z 的 4bet 图例包含 23.62、23.8、25.04、25.01、27.06 BB，需逐图记录。9-max 大部分固定尺寸为 26 或 28 BB，但 `UTG vs SB` 是 28 BB，而后续位置面对 SB 的图常为 26 BB，不能只根据对手位置推断。

复核发现，旧的 `rangeconverter-page9.png` 与上述 100z 原稿第 9 页不是同一内容。该无版本文件名不能作为 100z 转录源；必须从已核实 SHA-256 的 PDF 提取原生图片，并保留页码、图内位置及坐标。不能因文件名相似而混入另一 rake 版本。

## 后续数值格式所需能力

如果后续转录 Facing 3bet，应先设计能表达这些边界的格式：

1. 每手牌的条件动作频率与历史 reach 分开；reach 不明保持 `null`，不可从像素高度制造精确小数。
2. 允许手牌级缺失，并区分可读、未表示、无法辨认；只有源数据明确说明时才能标记严格零 reach。
3. 一个节点可有多个 Raise 选项，分别保留固定尺寸与 All-in；同时保留 Check 和 Call 的语义区别。
4. 对每个已转录手牌保存原图定位及校验结果；细条不足以独立复核时只显示原图，不输出猜测频率。
5. 保留原图汇总与转录汇总的不同含义。没有可信 reach 就不展示节点整体百分比。
6. 精确匹配仍需要完整行动历史、各席筹码、尺寸、ante、rake 与求解条件。人数和位置吻合只能支持参考关联，不能证明精确策略匹配。

当前公开图表仍不覆盖完整行动树，包括全部 cold-call、squeeze、多人入池、4bet/5bet 回应及所有 7/8-max 数值策略。后续应继续取得专业来源数据，或导入用户有权使用且参数明确的求解器导出。公开可下载也不等于已取得随 GitHub 仓库再分发的许可；原稿与转录文件继续保留在被忽略的本地目录。
