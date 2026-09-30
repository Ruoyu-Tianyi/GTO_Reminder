# GTO Reminder 路线图

更新：2026-09-30。目标为 **6–9 人完整翻前决策**，首批仍采用 Cash 100 BB。规则支持、原图参考和数值策略是不同进度。

## v0.2 已实现

- 64 个专业出版图转为可交互矩阵：13 张 Open、51 张 Facing Open，共 10,816 格，仅保留 0/50/100% 出版精度；6 人 SB Limp 独立显示。Facing Open 按 Hero / Opener 查询 3-Bet、Call、Fold，保留每张图的原始尺寸与缺失标记。
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
| 6/8/9 人精确频率 | 已有 6/9 人简化 Open、Facing Open；Facing 3/4/5-Bet 和 8 人数值仍缺失，需取得带完整条件和 reach 语义的原始导出 |
| Limp / Squeeze / 多人底池 | 规则已表达，数值策略未齐；不能借用单挑或 RFI 范围 |
| 全部尺寸与深度 | 少数离散节点不能覆盖连续空间；先约定实际求解树和节点清单 |
| 特殊规则 | Straddle、BB ante、ICM、非标准盲注等尚未建模，需新增规则及匹配数据 |

当前规则引擎不运行 GTO 求解，不计算胜负或分配 side pot；只确定合法行动、筹码投入、未跟注退款和翻前结束状态。

## 后续顺序

1. 落实一个 rake / ante / 下注树明确的完整配置，优先填 7 人缺口、8 人数值以及 Facing 3/4/5-Bet 的真实数值。后续响应图的灰色手牌、历史 reach 与独立 All-in 需要单独处理。
2. 为选定来源增加转换器，保留指纹、完整路径、原始精度和核验记录，区分 conditional frequency 与 reach。
3. 依据真实求解树生成节点清单与缺失报告；v1 有限场景数不能代表完整翻前覆盖率。
4. 数据质量确认后再增加收藏、范围对比及依据频率/EV 的练习反馈。
5. 从经过验证的翻前到达范围拓展至 Flop、Turn、River，并加入具体公共牌和花色组合。

文档：[v2 格式](DATA_FORMAT_V2.md)、[RFI 转录](REFERENCE_TRANSCRIPTION.md)、[Facing Open 转录](RESPONSE_TRANSCRIPTION.md)、[后续响应图的数据边界](RESPONSE_DATA_GAPS.md)、[来源记录](PUBLIC_CHARTS.md)。
