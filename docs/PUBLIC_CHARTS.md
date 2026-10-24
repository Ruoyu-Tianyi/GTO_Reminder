# Cash 100 BB：公开资料与估算接入记录

更新：2026-10-03。当前目标为 6–9 人。引用范围现有 **325 个场景**，其中 **234 张独立出版原图转录 + 91 个 7 人位置映射估算**。它们提供有来源和精度说明的参考，不代表完整行动树的精确 GTO 解库。

独立本机数据当前总计 **27,630 个 v2 历史决策、168 个 v1 快捷节点、62 个文件**，其中两个新增四次加注包是未收敛的研究结果，不增加出版图表数量。

## 本轮实际接入

原有 6/9 人 13 张 RFI 和 51 张 Facing Open，共 64 张；本轮增加 6/9 人 Facing 3-bet 51 张、8 人转录 119 张和 7 人映射 91 个，新增合计 **261 个引用**，最终 325 个。

| 人数 | 来源 | 引用场景 | 具体范围与精度 |
| --- | --- | ---: | --- |
| 6 | [RangeConverter 100z 官方 PDF](https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash) | 35 | 5 RFI、15 Facing Open、15 Facing 3-bet；出版 0/50/100%，后续细条保留手牌级缺失 |
| 7 | 从下列 8 人图进行位置映射 | 91 | 6 RFI、各 21 个 Facing Open/3-bet/4-bet/5-bet、1 BB vs SB Limp；明确为估算，不是独立 7 人出版解 |
| 8 | [PokerCoaching Ultimate Cash Guide](https://poker-coaching.s3.amazonaws.com/tools/preflop-charts/The%20Ultimate%20Cash%20Game%20Preflop%20Guide.pdf) | 119 | 7 RFI、各 28 个 Facing Open/3-bet/4-bet、27 Facing 5-bet、1 BB vs SB Limp；图像色条测量约 ±2 个百分点 |
| 9 | [RangeConverter Live 官方 PDF](https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash) | 80 | 8 RFI、36 Facing Open、36 Facing 3-bet；出版 0/50/100%，后续细条保留手牌级缺失 |

7 人映射删除 8 人最早的 UTG，UTG+1 对应 7 人 UTG，其余座位顺序和原图尺寸保持。它假定被删除座位不会改变其余手牌分布和策略，未作弃牌带来的牌张分布修正、重新求解或 7 人均衡核验。该估算单独标记，不能进入精确条件 v1/v2 库。

8 人源图逐手共 8,998 个可读策略、11,113 个未表示状态，本轮没有读取失败。72 项独立印刷总量检查通过，最大差异 0.1909 个百分点；印刷汇总未用于反推或调整单手牌值。黑格是 `not-charted`，不能断言严格零 reach 或 Fold 100%。详见 [POKERCOACHING_TRANSCRIPTION.md](POKERCOACHING_TRANSCRIPTION.md)。

## 参数和原稿质量

- 6 人：100z，5% rake、2.5 BB cap；一般 Open 2.5 BB、SB 3 BB。源 MP 对应应用 HJ。Ante 未明确。各图的 3-bet/4-bet 尺寸逐图保留。
- 8 人：通常 Open 3 BB，SB 4 BB 并有 Limp；后续尺寸随位置变化。Rake、ante、原始舍入与 solver 收敛指标未披露。
- 对第 17、24、26 页单独放大标题重新核对后，CO vs BB Facing 3-bet、UTG+1 vs BB Facing 5-bet、CO vs BB Facing 5-bet 均与文字层一致。旧版本所谓冲突来自整页缩略图误读，已恢复这三项索引。独立原图索引由旧 231 修正为 **234**。
- 8 人仍未刊载 UTG vs UTG+1 Facing 5-bet，不填造。BB vs SB Limp 将原稿免费选项 Call 解释为 Check；SB RFI 的 Call 则是 Limp / Complete。
- 8 人 PDF 的第 6–7、28–47 页属于 200 BB 或相关后续内容，未混入本轮 100 BB 目录；第 1–3 页为导读，第 4–5、8–27 页为本轮使用范围。
- 9 人：Live cash，Open 3 BB，源 MP 对应应用 UTG+2；rake 和 ante 未明确。Facing 3-bet 的 **UTG vs SB 固定 4-bet 为 26 BB**，旧文档的 28 BB 已纠正；不可仅按对手位置猜尺寸。
- 9 人 BB vs UTG+2 Facing Open 缺动作图例，格内频率可读，但加注尺寸与印刷总量保持 `null`，不借用邻图 13 BB。
- 后续响应图里的历史 reach 条不转成精确 reach。`not-charted`、`unreadable` 继续保留，没有可信 reach 时不展示节点整体动作百分比。固定加注和 All-in 独立表示。详见 [RESPONSE_DATA_GAPS.md](RESPONSE_DATA_GAPS.md)。

## 与本机计算的区别

本机计算使用独立 `computed` 来源；它不是把原图缺格填满，也不把 7 人位置映射包装成独立求解。2026-10-03 已验证基线中，6/7/8/9 人共有 **27,270 个 v2 决策、126 个 v1 快捷节点**，分为 54 个树分片和 4 个快捷文件。覆盖报告单独统计 computed，不计为 imported；两类来源可以覆盖同一场景。

该计算限定为 Cash 100 BB、无 ante、5% rake / 2.5 BB cap / no flop no drop、2.5 BB Open / 10 BB 3-bet、最多两次加注、无 Limp。它使用近似后续价值模型，没有后续 4/5-bet 或翻后策略。6–9 人均达到模型内部目标；9 人最终为 54 轮，最终快照的模型最佳响应差之和为 0.017725984946639545 BB/hand，不代表真实游戏的同等精度。专业原图的尺寸与未知条件不能被本机模型参数覆盖；后续追加计算以完成审计的新快照为准。详见 [LOCAL_SOLVER.md](LOCAL_SOLVER.md)。

另有 6/7 人四次加注研究包：6 人允许 Limp，39 轮，导出 200 个历史决策；7 人不允许 Limp，40 轮，导出 160 个。两包共增加 42 个快捷节点和 4 个文件，采用 2.5 / 10 / 30 / 100 BB 加注线。它们只导出 `heads-up-lines` 标准历史，未覆盖完整多人树；均保留未收敛状态和 `modelGapBb: null`。研究包中的 Facing 4/5-bet 是本机计算，不是新找到的专业原图。

## 本地使用和复现

原图、频率转录和计算结果保存在被 Git 忽略的 `data/private/`。开发服务仅提供白名单 PDF 和已验证的数据；生产构建不复制私有文件。缺少原稿时提供官方链接。换电脑需要单独恢复私人数据，或按复现脚本重新生成。

在 Windows 项目目录下载已核验原稿：

```powershell
./scripts/fetch-reference-charts.ps1 -Proxy http://127.0.0.1:7890
```

不需要代理时省略 `-Proxy`。提供方如果更新原稿，SHA-256 不匹配会停止流程，不能继续套用旧坐标和索引。转录入口为 `scripts/transcribe-reference-rfi.py`、`scripts/transcribe-reference-responses.py`、`scripts/transcribe-reference-later.py` 和 `scripts/transcribe-pokercoaching.py`；本机计算入口为 `scripts/solve-local-preflop.py`。

大树通过摘要和精确历史按需加载，不要求浏览器下载所有分片；接口、同包匹配及缓存边界见 [DATA_FORMAT_V2.md](DATA_FORMAT_V2.md)。仓库提交来源、指纹、转换器和核验说明；免费公开下载不等于获得随 GitHub 仓库再分发的许可。

## 未采用的数据

[AltruisticRaven 原作者公开分享](https://www.reddit.com/r/poker/comments/cg7o3j/quitting_poker_here_are_some_preflop_solutions/)中的 61 个范围文本仅保留作本地研究。100 BB 元数据不明确，且部分同手牌权重相加超过 100%；未强行归一化或混合不同 solve。

[FreeBetRange 目录](https://help.freebetrange.com/Library/)列有 7 人和完整翻前树，但本轮没有取得可批量使用的策略包。[GTO Academy 图表](https://gto-academy.com/charts)有 7/8 人选项，其[条款](https://gto-academy.com/terms)限制复制和自动提取，未抓取解库。专业服务存在不等于本项目已经取得完整数据。本轮没有购买订阅或创建账号。
