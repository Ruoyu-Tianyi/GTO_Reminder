# GTO Reminder 路线图

更新：2026-10-23。目标为 **6–9 人完整翻前决策**，首批仍采用 Cash 100 BB。规则支持、原图参考和数值策略是不同进度；当前 143 张交互图级索引包含部分转录，不代表完整覆盖。

## v0.2 已实现

- 64 个专业出版图转为可交互矩阵：13 张 Open、51 张 Facing Open，共 10,816 格，仅保留 0/50/100% 出版精度；6 人 SB Limp 独立显示。Facing Open 按 Hero / Opener 查询 3-Bet、Call、Fold，保留每张图的原始尺寸与缺失标记。
- 新增 51 张 Facing 3-Bet 条件图（6 人 15 张、9 人 36 张）：2,606 格可读、6,013 格缺失。仅转录出版者舍入后的条件频率；固定尺寸 Raise 与 All-in 分开，reach 保持未知。
- 新增 28 张 8 人 Facing 4-Bet 图示动作：985 格可见动作、3,692 格未显示、55 格不明确，不把色条宽度估成百分比。
- 完整有序行动回放：Limp、Complete、Check、Cold Call、Squeeze、多轮 Raise、All-in、短 All-in 重新开放、不同初始筹码与 per-player ante。
- v2 策略导入：有序历史、多尺寸动作、available / missing / unreachable、历史 reach 加权汇总与精确条件查询。
- 本地 v1/v2 自动载入；原有快捷查询及演示保留。
- 原来的 205 个基本原图场景，新增 25 个 Facing 5-Bet All-in 和 1 个 BB vs SB Limp 独立图。SB 首次行动是已有原图，不重复计数。
- 历史参考匹配器拒绝把 Squeeze、冷跟或第三人入池套用成单一对手范围。
- Windows 启动脚本自动查找已有 Node.js，支持普通 PowerShell 未设置 Node PATH 的情况。

## 核心缺口

| 部分 | 缺口及完成条件 |
| --- | --- |
| 7 人 Cash 100 BB | 尚无可核实、无需账号的完整公开包；需获得条件明确、可使用的原始数据并验证 |
| 6/9 人 Facing 3-Bet | 已转录部分可读条件频率；缺失手牌、数值 reach、完整求解条件和原始精度仍未补齐 |
| 8 人 Facing 3-Bet | 27 个无歧义原图场景仍待转录；原稿另有标题冲突，不能猜测补齐 |
| Facing 4-Bet / 5-Bet | 8 人 Facing 4-Bet 仅有图示动作；6/9 人 Facing 4-Bet 尚无已接入来源，更多响应的精确数值仍缺失 |
| 精确 solver 数据 | 当前出版转录均不是原始 solver 导出；需要完整条件、精度与 reach 语义，不能用未知 reach 汇总节点比例 |
| Limp / Squeeze / 多人底池 | 规则已表达，数值策略未齐；不能借用单挑或 RFI 范围 |
| 全部尺寸与深度 | 少数离散节点不能覆盖连续空间；先约定实际求解树和节点清单 |
| 特殊规则 | Straddle、BB ante、ICM、非标准盲注等尚未建模，需新增规则及匹配数据 |

当前规则引擎不运行 GTO 求解，不计算胜负或分配 side pot；只确定合法行动、筹码投入、未跟注退款和翻前结束状态。

## 后续顺序

1. 落实一个 rake / ante / 下注树明确的完整配置，优先填 7 人公开来源、8 人 Facing 3-Bet、6/9 人 Facing 4-Bet 缺口，并取得真实数值 reach。
2. 继续核验和扩充转换器，保留指纹、完整路径、原始精度和记录；维持条件频率、图示动作与 reach 的区别，不把缺失或细条补成 Fold。
3. 依据真实求解树生成节点清单与缺失报告；v1 有限场景数不能代表完整翻前覆盖率。
4. 数据质量确认后再增加收藏、范围对比及依据频率/EV 的练习反馈。
5. 从经过验证的翻前到达范围拓展至 Flop、Turn、River，并加入具体公共牌和花色组合。

原始 PDF 与衍生手牌数据仅保存在本地，不随仓库发布。

文档：[v2 格式](DATA_FORMAT_V2.md)、[RFI 转录](REFERENCE_TRANSCRIPTION.md)、[Facing Open 转录](RESPONSE_TRANSCRIPTION.md)、[Facing 3-Bet 转录](THREEBET_TRANSCRIPTION.md)、[Facing 4-Bet 转录](FOURBET_TRANSCRIPTION.md)、[数据边界](RESPONSE_DATA_GAPS.md)、[来源记录](PUBLIC_CHARTS.md)。
