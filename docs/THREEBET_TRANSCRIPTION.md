# Facing 3B 条件动作转录

`scripts/transcribe-reference-3bet.py` 从已审核的 RangeConverter Cash 100BB PDF 读取面对 3bet 的简化动作。原图横向分割表示当前动作，纵向彩条高度还包含此前到达范围；脚本只转录可以可靠辨认的横向动作，不把高度换算成 reach。

## 复现

依赖 Python 3、`pypdf` 和 `Pillow`：

```sh
python -m pip install pypdf Pillow
python scripts/transcribe-reference-3bet.py
python scripts/transcribe-reference-3bet.py --directory /path/to/local-reference-files
```

默认目录为 Git 忽略的 `data/private/research/`，需包含与之前 RFI / Facing Open 转录相同的两份原 PDF。脚本不下载或公开发布数据。

| 原稿 | 转录的 PDF 页码 | 节点 | 可读牌格 | 缺失牌格 |
| --- | --- | ---: | ---: | ---: |
| [6-max 100BB 100z](https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash)，本地 `rangeconverter-6max-100bb.pdf` | 9–13 | 15 | 920 | 1,615 |
| [9-max 100BB](https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash)，本地 `rangeconverter-9max-100bb.pdf` | 11–18 | 36 | 1,686 | 4,398 |
| 合计 | | 51 | 2,606 | 6,013 |

输出为 `derived-3bet-ranges.json`，并附不含逐手频率的 `threebet-chart-manifest.json`。每节点仍有 169 手牌记录，缺失有明确状态；这不代表拥有完整的 169 手策略。可读牌格中 606 格为两动作各 50%，40 格含非零 All-in。

审核快照日期为 2026-10-23，数据采用固定 UTF-8、CRLF、字段顺序，SHA-256：

```text
ab2e1658ecfeaa5903ff0608938592d9838e1365b252aa1ee6c16bf15aa9c443
```

## 读取和拒绝规则

解析任何 PDF 前，先严格核验两份源文件 SHA-256；直接读取 PDF 内嵌原图，不使用此前导出的、可能属于其他版本的 PNG。原图必须保持 2048×1313 像素。

在每个牌格的左右半区，分别取两个间隔开的横向 3 像素采样点，扫描牌格内的行。每个半区的全部采样像素必须识别为同一动作；至少三个连续行一致，且其他完整可读行不得出现冲突。灰色、深色、文字、格线及过细彩条不能自动成为动作。图例未声明的颜色会中止转录。

可读结果另用较宽区域的 HSV 色相分类复核全部 2,606 格，与转录频率的差异为零，最低半格色类一致率为 94.12%。这验证对出版图的读取一致性，不验证 solver 策略正确性。

脚本同时校验输出指纹。源文件、尺寸、可读结果或元数据发生变化时，需重新人工审核；不能只更新指纹来接受新版本。失败不会用推测频率覆盖现有文件。既有 RFI 和 Facing Open 的脚本、数据均未修改。

## 数据含义

顶层为 `schemaVersion:1`、`kind:"published-continuations"`。每节点 `kind:"vs-3bet"`，记录 Hero、3bettor、页码、来源、原始位置名与历史尺寸。

- `openSizeBb` 是 Hero 此前 Open 的总额；`threeBetSizeBb` 是对手此前 3B 的总额。它们来自同一 PDF 的 RFI、Facing Open 对应图，证据页码保存在 `verification` 中。
- `fourBetSizeBb:null` 表示历史尚未发生 4B；当前可选 4B 尺寸位于 `actions` 的 `amountBb` 中。固定尺寸 Raise 与 `allin` 是独立动作，不能合并。
- 6-max 图声明 Raise / Call / Fold；9-max 图还声明 All-in，即使印刷汇总是 0.0% 也保留该动作。
- 每手 `reach:null`。可读手牌为 `status:"available"`，其 `frequencies` 对每个声明动作提供 `0 / 0.5 / 1`，总和为 1；这些是出版者舍入后的**条件动作频率**。
- 缺失手牌为 `status:"missing"`，没有 `frequencies`。`reason:"not-shown"` 或 `"ambiguous"` 只描述图像可读性，均不表示严格零 reach、100% Fold 或不可到达。
- 每手保留原图 `cellBox`；可读手牌另有 `sampleRows`，支持回到原图检查。

例如 9-max SB vs BB 的 `AQo` 为 All-in 50% / Call 50%，不能转为 Raise 28BB 50% / Call 50%。6-max UTG vs HJ 的 `55` 彩条太细，保留为缺失；不会引用单独舍入的 RFI 表补成 Fold。

## 尺寸与统计边界

原图中的精确标签必须逐图保留：6-max UTG vs BTN 的 4B 是 23.8BB，UTG vs HJ/CO 为 23.62BB；9-max UTG vs SB 为 26BB，UTG vs BB 为 28BB。

9-max UTG+2 vs BB 的**此前 3B 尺寸未知**：第 10 页对应 BB vs MP 图缺整个图例，因此 `threeBetSizeBb:null`。当前 4B 图例明确给出的 28BB 仍可保留，不能反推此前尺寸。

`printedActionPercent` 原样保留原稿印刷汇总，独立于逐手转录。由于 reach 未知，脚本不提供组合加权节点汇总，也不按可读子集计算“整体策略百分比”。`ante`、`rake` 保持 `null`；完整抽水条件、ante 与 solver 精度仍不能由这些图确认。

这些节点只用于公开图表参考，不进入精确条件 solver 查询。它们没有补出 7/8-max、Squeeze、多人行动、所有 Facing 4B 或完整翻前行动树。
