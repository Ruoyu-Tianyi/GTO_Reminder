# Facing Open 公开图转录

`scripts/transcribe-reference-responses.py` 将已审核的 RangeConverter Cash 100BB 图表转为本地 `derived-response-ranges.json`。结果是出版者 **0 / 50 / 100%** 精度的简化参考，不是原始 solver 频率。既有 RFI 脚本和 `derived-chart-ranges.json` 保持不变。

## 使用

依赖 Python 3、`pypdf`、`Pillow`，与 [RFI 转录](REFERENCE_TRANSCRIPTION.md) 共用同两份原 PDF：

```sh
python -m pip install pypdf Pillow
python scripts/transcribe-reference-responses.py
python scripts/transcribe-reference-responses.py --directory /path/to/local-reference-files
```

默认输入、输出目录均为 `data/private/research/`，目录受 Git 忽略。脚本不下载或公开发布 PDF、频率数据。

| 文件 | 官方来源 | 转录页码 | 节点 |
| --- | --- | --- | ---: |
| `rangeconverter-6max-100bb.pdf` | [6-max 100BB 100z](https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash) | 4–8 | 15 |
| `rangeconverter-9max-100bb.pdf` | [9-max 100BB live cash](https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash) | 4–10 | 36 |

共 **51 个节点、8,619 个牌格**，其中 867 格为两动作各 50%，7,752 格为单动作 100%。仅涵盖前面玩家弃牌、面对一次 Open、没有中间 Call 或 Raise 的情形；不含 Squeeze、面对 3B/4B 或完整行动树，也不补出 7/8-max。

## 校验和数据约定

解析前严格核验两份 PDF 的 SHA-256，再从 PDF 直接提取内嵌原图。预存 PNG 不作为输入，以免混入其他版本的图。每格左右半区分别检查上、下两个 3×3 像素区，每个区域的全部像素必须识别为相同动作，上下结果也必须一致。灰色、未知色、缺格或冲突会中止；不会补成 Fold。每手 Raise、Call、Fold 之和为 1。

元数据保留对手位置、Open 尺寸、3B 尺寸、页码、原始位置名和图上汇总。6-max 原图 MP 对应 HJ；9-max MP 对应 UTG+2，UTG1 对应 UTG+1。`facingRaiseToBb`、`raiseToBb` 均为该玩家加注后的总额，单位 BB。所有 `callMeaning` 为 `Call Open`。

- 6-max 除 SB Open 为 3BB 外，其余 Open 均为 2.5BB；3B 尺寸按原图保留 8.48、10.9、11.03、10.02BB，没有四舍五入为近似尺寸。
- 9-max Open 为 3BB，图上 3B 通常为位置对应的 10、12、13BB。**第 10 页 BB vs MP（UTG+2）缺少整个动作说明区**：169 格清楚，但 `raiseToBb`、`printedRaisePercent`、`printedCallPercent` 必须为 `null`，不能从相邻图推断。
- 6-max 的 HJ/CO/SB 共 7 个节点只印有 Raise/Fold 说明，牌格也没有 Call。其 `printedCallPercent:null` 表示没有印刷汇总，逐手 `call` 则全部为 0。
- 6-max 第 8 页另有 BB vs SB Limp。由于它的绿色动作在语义上是 Check，本轮没有把它混入 Call Open。

`printedRaisePercent` 和 `printedCallPercent` 保留源图印刷值；`derivedRangeSummary` 按 169 格舍入后的频率，以对子 6、同花 4、非同花 12 个组合加权重算。逐手舍入会改变总数，不能调整牌格去迎合印刷汇总；某图印刷的 Call 总量甚至可能非零，而逐手 Call 全部舍入为 0。

`ante`、`rake` 保留 `null`，其他未完整确立的求解条件列在 `unknownConditions`。来源目录后续增加的元数据不会静默改写这份 2026-09-30 审核快照。结果只用于独立的 Simplified chart 参考显示，不进入精确条件的 solver 查询。

输出采用固定 UTF-8、CRLF、字段顺序，当前审核指纹：

```text
a87eedd66e38864152f6c969e7cc3f7c58f3481bfdd2388c452b445f1f144d25
```

同时生成 `response-chart-manifest.json`，只包含节点元数据，供人工对照。重复生成应得到相同数据字节；源图变化需重新审核，不能只替换脚本中的指纹。
