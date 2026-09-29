# Cash 100 BB：公开资料接入记录

核查时间：2026-09-27。目标为 5–9 人 Cash 100 BB。**尚未完成所有人数及行动树的精确频率覆盖。**

**2026-09-29 更新：**当前建设目标调整为 6–9 人。6/9 人全部 13 个 RFI 原图已转录为本地可查询的 2,197 格简化范围，见 [REFERENCE_TRANSCRIPTION.md](REFERENCE_TRANSCRIPTION.md)。精度仍为 0/50/100%，不把未知条件填成 0，也不进入精确条件策略库。

8 人原稿另核实 25 个 Facing 5-Bet All-in 图及 1 个 BB vs SB Limp 图，独立原图索引总计 231。第 24、26 页各有一张可见标题与文字层冲突，未建立错误 BB 映射；UTG vs UTG+1 Facing 5-Bet 缺失。BB vs SB Limp 原图把免费选项印为 Call，应用规则按 Check 处理，原稿保留不改。

本次实际下载并接入本地网页的是三份专业原始 PDF，合计索引 205 个场景。它们可按人数、Hero、Villain 和行动跳转原图；不作为 JSON 频率计算器的数据，也不计入数值数据库覆盖率。索引不代表完整匹配用户自定义尺寸或抽水。

| 人数 | 公开资料 | 已索引场景 | 实际边界 |
| --- | --- | ---: | --- |
| 5 | 尚未找到可核实的完整公开包 | 0 | 不用 6 人范围替代 |
| 6 | [RangeConverter 100z 官方 PDF](https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash) | 35 | 5 Open、15 vs Open、15 vs 3B；没有 vs 4B；舍入到 0/50/100% |
| 7 | 尚未找到可核实的完整公开包 | 0 | 已发现的部分商业方案有 ante，不能混入无明确 ante 的其他资料 |
| 8 | [PokerCoaching Ultimate Cash Guide](https://poker-coaching.s3.amazonaws.com/tools/preflop-charts/The%20Ultimate%20Cash%20Game%20Preflop%20Guide.pdf) | 90 | 7 Open、28 vs Open、27 vs 3B、28 vs 4B；混合色条未说明舍入精度 |
| 9 | [RangeConverter Live 官方 PDF](https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash) | 80 | 8 Open、36 vs Open、36 vs 3B；没有 vs 4B；舍入到 0/50/100% |

## 参数和原稿质量

- 6 人：100z，5% rake、2.5 BB cap；一般 Open 2.5 BB、SB 3 BB。图中 MP 对应本应用 HJ。Ante 未明确。
- 8 人：通常 Open 3 BB，SB 4 BB 并有 Limp；各位置后续尺寸不同，必须读原图。Rake、ante、solver 收敛指标没有披露。PDF 第 17 页一个 CO vs 3B 图的可见标题和文字层冲突，因此未猜测其为 CO vs BB；第 16 页另有明确 CO vs SB 图。
- 8 人 PDF 同时包含 200 BB，应用页码选择器排除第 6–7、28–47 页；第 1–3 页为导读，第 4–5、8–27 页属于 100 BB。第 23–27 页是面对 5-Bet 全下的图，可手动查阅，尚无对应的工作台行动类型。
- 9 人：Live cash，Open 3 BB，MP 对应应用 UTG+2；rake 和 ante 尚未明确。后续尺寸应按各图读取。
- 灰暗不可达手牌及历史 reach 条不能直接转换成 Fold 100%。同节点可能有多个 Raise / All-in 尺寸，当前 schema v1 不能完整表达。

## 本地使用和可复现性

网页顶部 `Browse charts` 打开原图资料库。资料保存在被 Git 忽略的 `data/private/research/`，应用仅在本地开发服务中提供三份白名单 PDF。生产构建不复制这些 PDF；缺少本地副本时，界面提供官方原始下载链接。

新克隆的 Windows 工作区可运行：

```powershell
./scripts/fetch-reference-charts.ps1 -Proxy http://127.0.0.1:7890
```

不需要代理时省略 `-Proxy`。脚本核验 SHA-256；提供方若更新原稿，脚本停止并保留待核验文件，不继续套用旧页码。已核验的副本会跳过下载。仓库只提交来源、文件指纹和页码索引，不提交原稿。

## 未采用的公开数据

[AltruisticRaven 原作者公开分享](https://www.reddit.com/r/poker/comments/cg7o3j/quitting_poker_here_are_some_preflop_solutions/)提供的 61 个范围文本已保留本地研究。没有明确 100 BB 元数据，且部分同手牌行动权重相加超过 100%；不能把不同 solve 的文件强制合并或归一化成新策略。未导入频率数据库。

还核对了 [FreeBetRange 专业库目录](https://help.freebetrange.com/Library/)及 [PokerData API](https://pokerdata.io/api)。可确认的专业服务不等于可获取的公开完整数据：例如前者 Cash 库覆盖 HU/6/7/9，后者 NLHE Cash 目录主要是 6 人；没有据此声称获得 5–9 人完整解库。

后续精确频率接入仍需要可核实的原始 solver 导出、条件与 reach 语义，并扩展多尺寸及完整前序行动模型。此轮没有购买订阅或创建账号。
