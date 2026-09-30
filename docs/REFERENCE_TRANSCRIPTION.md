# 公开参考图的 RFI 转录

另见 [Facing Open 转录](RESPONSE_TRANSCRIPTION.md)：2026-09-30 新增 51 张响应图，合计可查询 64 张、10,816 格。本文件继续记录原 13 张 RFI 的固定版本。

`scripts/transcribe-reference-rfi.py` 将已经人工核对的 RangeConverter Cash 100BB PDF 第 3 页转录为本地 `derived-chart-ranges.json`。它只重现出版者简化后的 **0 / 50 / 100%** 牌格，不恢复原始 solver 精度，也不生成缺失节点。

## 使用

依赖 Python 3、`pypdf` 和 `Pillow`：

```sh
python -m pip install pypdf Pillow
python scripts/transcribe-reference-rfi.py
```

默认从仓库的 `data/private/research/` 读取以下文件，并将结果写回该目录：

- `rangeconverter-6max-100bb.pdf`：[官方 6-max 100z PDF](https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash)
- `rangeconverter-9max-100bb.pdf`：[官方 9-max 100BB PDF](https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash)

也可指定已经存放这两份文件的目录：

```sh
python scripts/transcribe-reference-rfi.py --directory /path/to/local-reference-files
```

脚本在解析任何 PDF 前，先核验两份文件的 SHA-256；期望值与 `src/data/references.ts` 中的已审核版本一致。版本、图片尺寸、颜色或牌格不符合预期时会失败，不会将无法识别的牌补成 Fold，也不会覆盖现有输出。上游文件发生变化时，需要重新人工检查，不能只替换指纹。

## 输出及核验

结果共 **13 个 RFI 节点、2,197 个牌格**：6-max 的 UTG、HJ、CO、BTN、SB，以及 9-max 的 UTG、UTG+1、UTG+2、LJ、HJ、CO、BTN、SB。原图 MP 分别映射为 6-max HJ、9-max UTG+2。6-max SB 的 `call` 是补齐小盲的 Limp，由 `callMeaning` 标明。

每个牌格的左右半区都独立采样上下两个 3×3 像素区域；分类必须一致。频率采用 `0 / 0.5 / 1`，每手的 Raise、Call、Fold 之和必须为 1。输出使用固定 UTF-8、CRLF 和字段顺序，复现已审核文件的 SHA-256：

```text
9c99741a172bb8534de608385a2380d1da6e5ff267628595a17ed779005ba5f6
```

`derivedRangeSummary` 根据简化后的全部 169 格重算，按对子 6、同花 4、非同花 12 个组合加权，总计 1,326 个组合；`printedRaisePercent` 则保留 PDF 印刷汇总。逐手舍入会改变汇总，而原文没有充分说明印刷汇总的计算口径，因此不能声称两者必须相等，也不能反调牌格以迎合印刷百分比。

这是固定于 2026-09-29 的简化参考转录版本。`ante`、`rake` 保持 `null`，不把未完整确立的条件补成零；solver 版本、收敛精度和抽水规则等边界保留在 `unknownConditions`。来源目录后续增加的元数据不会静默改写这份已审核转录件。结果只用于独立的 Simplified chart 展示，不进入精确条件的 solver 查询；不涵盖 7/8-max 或 RFI 以外的行动。

原 PDF 和派生 JSON 存放在 Git 忽略的个人数据目录。公开仓库只提交转录脚本及说明；脚本不下载文件，也不宣称取得再分发数据的许可。
