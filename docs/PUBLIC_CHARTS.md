# Cash 100 BB：公开资料接入记录

更新：2026-10-23；首次原图接入为 2026-09-27。当前目标为 6–9 人 Cash 100 BB。**尚未完成所有人数及行动树的精确频率覆盖。**

本地交互库现有 **143 张图级索引，包含部分转录**：

- 原有 64 张保持不变：6/9 人的 13 张 RFI、51 张 Facing Open，共 10,816 格完整简化频率，精度为 0/50/100%。
- 新增 51 张 Facing 3-Bet：6 人 15 张、9 人 36 张，2,606 格可读条件频率、6,013 格缺失，详见[转录说明](THREEBET_TRANSCRIPTION.md)。
- 新增 28 张 8 人 Facing 4-Bet：985 格图示动作、3,692 格未显示、55 格不明确，不生成逐手百分比，详见[转录说明](FOURBET_TRANSCRIPTION.md)。

143 不是完整 169 手策略数，也不是完整行动树覆盖数。后续响应图的 reach 全部未知，不计算节点整体动作比例；这些数据不进入精确条件策略库。Facing Open 不含冷跟、Squeeze 或先前 Limp；9 人 BB vs UTG+2 原稿缺动作图例，其 3-Bet 尺寸和印刷汇总保持为空，不从相邻图推断。

8 人原稿另核实 25 个 Facing 5-Bet All-in 图及 1 个 BB vs SB Limp 图，独立原图索引总计 231。第 24、26 页各有一张可见标题与文字层冲突，未建立错误 BB 映射；UTG vs UTG+1 Facing 5-Bet 缺失。BB vs SB Limp 原图把免费选项印为 Call，应用规则按 Check 处理，原稿保留不改。

最初三份专业 PDF 包含 205 个基本场景索引，加上后续扩充合计 231 个独立原图。它们可按人数、Hero、Villain 和行动跳转原图。上述 143 张交互图与这些原图索引重叠，不能相加计数；其余仍为原图参考。索引也不代表完整匹配用户自定义尺寸或抽水。

| 人数 | 公开资料 | 原图索引 | 实际边界 |
| --- | --- | ---: | --- |
| 6 | [RangeConverter 100z 官方 PDF](https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-100z-No-Limit-Texas-Holdem-Cash) | 35 | 5 Open、15 vs Open 完整转录；15 vs 3B 部分转录；没有已接入的 vs 4B 来源 |
| 7 | 未获取免账号、可核验的公开包 | 0 | 不用其他人数或不同 ante 配置替代 |
| 8 | [PokerCoaching Ultimate Cash Guide](https://poker-coaching.s3.amazonaws.com/tools/preflop-charts/The%20Ultimate%20Cash%20Game%20Preflop%20Guide.pdf) | 116 | 7 Open、28 vs Open、27 vs 3B、28 vs 4B、25 vs 5B All-in、1 BB vs SB Limp；仅 28 vs 4B 已转成图示动作，混色精度未声明 |
| 9 | [RangeConverter Live 官方 PDF](https://rangeconverter.com/downloads/9-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash) | 80 | 8 Open、36 vs Open 完整转录；36 vs 3B 部分转录；没有已接入的 vs 4B 来源 |

## 参数和原稿质量

- 6 人：100z，5% rake、2.5 BB cap；一般 Open 2.5 BB、SB 3 BB。图中 MP 对应本应用 HJ。Ante 未明确。
- 8 人：通常 Open 3 BB，SB 4 BB 并有 Limp；各位置后续尺寸不同，必须读原图。Rake、ante、solver 收敛指标没有披露。PDF 第 17 页一个 CO vs 3B 图的可见标题和文字层冲突，因此未猜测其为 CO vs BB；第 16 页另有明确 CO vs SB 图。
- 8 人 PDF 同时包含 200 BB，应用页码选择器排除第 6–7、28–47 页；第 1–3 页为导读，第 4–5、8–27 页属于 100 BB。第 23–27 页的 Facing 5-Bet 全下图可在原图资料库查阅，本轮未转录逐手数值。
- 9 人：Live cash，Open 3 BB，MP 对应应用 UTG+2；rake 和 ante 尚未明确。后续尺寸应按各图读取。
- 灰暗未显示手牌及历史 reach 条不能直接转换成 Fold 100% 或严格零 reach。后续响应的条件图格式保留手牌级缺失及独立 Raise / All-in；旧 schema v1 不能完整表达这些边界。

## 本地使用和可复现性

网页顶部 `Browse charts` 打开原图资料库。资料保存在被 Git 忽略的 `data/private/research/`，应用仅在本地开发服务中提供三份白名单 PDF。生产构建不复制这些 PDF；缺少本地副本时，界面提供官方原始下载链接。

新克隆的 Windows 工作区可运行：

```powershell
./scripts/fetch-reference-charts.ps1 -Proxy http://127.0.0.1:7890
```

不需要代理时省略 `-Proxy`。脚本核验 SHA-256；提供方若更新原稿，脚本停止并保留待核验文件，不继续套用旧页码。已核验的副本会跳过下载。仓库提交来源、文件指纹、页码索引及转换/校验程序，不提交原始 PDF 或衍生手牌数据。

## 未采用的公开数据

[AltruisticRaven 原作者公开分享](https://www.reddit.com/r/poker/comments/cg7o3j/quitting_poker_here_are_some_preflop_solutions/)提供的 61 个范围文本已保留本地研究。没有明确 100 BB 元数据，且部分同手牌行动权重相加超过 100%；不能把不同 solve 的文件强制合并或归一化成新策略。未导入频率数据库。

还核对了 [FreeBetRange 专业库目录](https://help.freebetrange.com/Library/)及 [PokerData API](https://pokerdata.io/api)。可确认的专业服务不等于可获取的公开完整数据：例如前者 Cash 库覆盖 HU/6/7/9，后者 NLHE Cash 目录主要是 6 人；没有据此声称获得 5–9 人完整解库。

截至本轮，[FreeBetRange 官方公告](https://blog.freebetrange.com/article/the-gto-library-is-live)仍将 7-max Cash 100 BB 库描述为注册后加入账号的服务，未取得匿名公开包。8 人 Facing 3-Bet 原图待转录，6/9 人 Facing 4-Bet 来源仍缺失。

后续精确频率接入仍需要可核实的原始 solver 导出、完整条件与 reach 语义。v2 已可表达多尺寸及有序历史，但当前出版图不能因此成为精确匹配策略。此轮没有购买订阅或创建账号。
