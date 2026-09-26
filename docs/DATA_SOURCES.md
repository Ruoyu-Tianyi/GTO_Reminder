# GTO_Reminder：翻前数据来源与接入说明

调研日期：2026-09-26。本文只记录实际核查的公开资料，不代表已取得任何商业数据授权。

## 结论

成熟的翻前 GTO 数据确实存在，但“免费查看”“可以下载”“代码采用 MIT”并不自动代表范围数据库可随本项目再分发。本次没有找到同时满足 **专业成熟、完整混合频率、参数明确、明确允许再分发** 的免费 NLHE 多人翻前数据包。因此本仓库不打包来源不明的 solver 数据，也不把人工示例或启发式算法产生的比例标成 GTO。

推荐采用两条接入路径：

1. 个人使用：用户导入自己有权使用的 solver 导出文件，在本地浏览器展示，不自动上传到 GitHub。
2. 产品使用：与数据供应商确认第三方应用展示、缓存、商业使用、再分发权限，取得授权后接入正式数据包或服务端 API。

在正式数据到位前，可以完成牌桌选择、169 格范围矩阵、动作频率展示、导入校验等交互；示例必须明确标注为演示，不能称为已验证 GTO。未覆盖的条件应显示 `No matching data`，不能用邻近后手或别的人数的范围冒充。

## 已核查的专业来源

| 来源 | 公开可核查内容 | 适用判断 |
| --- | --- | --- |
| [GTO Wizard](https://gtowizard.com/) | 商业 solver 与现成解库；官方说明支持范围文本互通 | 成熟候选。适合用户在许可范围内导入或洽谈正式授权；不是开放数据源 |
| [RangeConverter：6-max 100bb PDF](https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash) | 100bb、6-max、500z 标签；RFI、Facing RFI、Facing 3bet | 免费学习图表，频率已简化，不能冒充完整精确频率；再分发许可未核实 |
| [PokerCoaching 免费翻前图表](https://pokercoaching.com/preflop-charts/) | 专业教学图表；下列官方 PDF 明确记载后手与尺寸 | 适合学习参考和交叉检查。特定 PDF 是简化策略，不是完整 mixed strategy 导出 |
| [PokerData Ranges API](https://pokerdata.io/api) | 有文档的 JSON 查询接口，支持按节点与手牌获取动作频率 | 接入形式最接近需求；需要账户/API key，并继续核实求解质量和第三方展示许可 |
| [Simple GTO](https://simplegto.com/) | 在线范围浏览器与独立出售的 Simple Preflop 范围包 | 可作为购买范围包候选；下载和拥有文件不等于可以将其公开打包 |

### GTO Wizard：范围文本与完整节点不是一回事

[官方 Range Editor 文档](https://help.gtowizard.com/how-to-build-custom-solutions/) 说明可导出标准 UPI 范围文本。然而[官方 FAQ](https://help.gtowizard.com/troubleshooting/) 同时说明不提供按 stack、position 等导出动作频率表的功能。不能因此假定存在可批量获取所有节点的公开 API。

[官方条款](https://gtowizard.com/terms/) 第 7.5 条限制将其 ranges、trees、charts 商业化或通过第三方应用商业使用；第 7.7 条限制自动请求和脚本。不能依靠爬取其网站完成本项目的数据初始化。其 Benchmark API 是另一项服务，不能当作策略数据库导出入口。

具体授权范围以与供应商约定为准。本次没有登录、抓取解库或复制第三方截图还原的数据库。

### RangeConverter：有 mixed colors，但精度已经改变

[100bb 6-max 官方 PDF](https://rangeconverter.com/downloads/6-max-100bb-Poker-Charts-No-Limit-Texas-Holdem-Cash) 明确说每手牌动作频率四舍五入到最接近的 50%。因此双色格代表简化的 50/50，不代表原始 solver 恰好给出 50/50。PDF 包含开池、面对开池、开池后面对 3B 的图表，但没有在可提取说明中完整披露 rake 数值、全部下注树和求解误差。

此类 PDF 若后续取得使用许可，可以以 `Simplified chart` 标签导入；应保留原始文件、页码及人工核对记录。不要通过颜色识别制造小数点级精度。

### PokerCoaching：尺寸假设明确的简化参考

[官方 Online 6-max PDF](https://poker-coaching.s3.amazonaws.com/tools/preflop-charts/online-6max-gto-charts.pdf) 将其图表称为易执行版本：将部分混合策略化为纯动作。其假设包括 100bb；一般位置开池至 2.5bb、SB 至 3bb；IP 3B 为 3.5 倍、OOP 3B 为 4 倍；IP 4B 为 2.3 倍、OOP 4B 为 2.5 倍。它适合解释为何下注尺寸不能从查询条件中省略，不能用来宣称原始每手牌 GTO 频率。

## PokerData 的技术可行性与未决事项

官方 [API 文档](https://pokerdata.io/api) 提供 `discovery`、`spots`、`node`、`range`。NLHE cash 使用 169 类手牌、0–1 权重及完整动作路径；文档列出 20 / 30 / 40 / 50 / 70 / 100 / 150 / 200bb。[商品目录](https://pokerdata.io/app) 将这批 6-max cash 数据标注为 5% rake、0.5bb cap。

实测公开 [discovery endpoint](https://pokerdata.io/api/v1/ranges/nl/v2) 返回这些后手与 `BB, BTN, CO, HJ, SB, UTG` 位置。实际访问文档中的无 key 节点示例返回 **401 Unauthorized**，与页面所称部分示例可以免 key 运行不一致。因此只能确认目录可读取，不能声称已获取可用策略数据。

正式接入前需要确认：

- 求解软件、版本、完整下注树、ante、rake 收取条件、收敛标准与误差。
- 返回的各动作 `range` 是到达该节点后的条件动作频率，还是包含历史 reach 的组合权重。
- API 订阅允许的最终用户数量、第三方界面展示、缓存时间、离线存储与是否可公开再分发。
- 需要哪些合法 API credentials；密钥只能保存在服务端，不能写入前端代码或 Git 仓库。

API 方案可保留为候选，不应仅因为它采用 JSON 就给其数据加上“已验证”标记。

## 开源检索结果与排除理由

| 项目 | 实际发现 | 决策 |
| --- | --- | --- |
| [bmorrow10/preflopR](https://github.com/bmorrow10/preflopR) | MIT；作者明确说明范围不是 solver 生成，仅开池指导；部分人数复用临近人数 | 可研究图表代码，不能作为成熟 GTO 数据 |
| [amaster97/poker_solver charts](https://github.com/amaster97/poker_solver/tree/main/poker_solver/charts) | MIT 项目；其 charts README 明确内置 presets 是启发式，不是权威 GTO 输出 | 实验候选；不能将预设范围直接贴上专业 solver 标签 |
| [mpcaren/preflop-range-trainer](https://github.com/mpcaren/preflop-range-trainer) | README 说明部分数据从 GTO Wizard 截图通过像素分析提取 | 原始数据权利与精度未解决；不纳入仓库 |
| [zwarag/gto-open](https://github.com/zwarag/gto-open) | 公开文档描述建立开放策略数据库的规划 | 是后续观察对象，未据此确认已有成熟可用数据包 |

GitHub 仓库根目录的许可证不能替代上游数据来源证明；项目自称 GTO 也不能替代求解参数与质量证据。

## 本项目的数据约定建议

这些是实现约定，不是第三方供应商已保证的能力。

- **查询键完整**：game format、人数、各玩家起始后手或受支持的等深假设、Hero 位置、前序动作和尺寸、ante、rake、树版本。面对 open 或 3B 时必须识别攻击者位置与具体动作历史。
- **频率含义明确**：每个可到达节点内，一手牌各合法动作的条件概率之和应为 1。历史 reach weight 独立储存。`AA:0.5` 可能是范围权重，不能无条件解释为“Raise 50%”。
- **缺失不能当 Fold**：缺失手牌、无数据节点、零 reach 的手牌分别标识。只有源数据格式明确约定“省略即零”时才可补零。
- **组合加权正确**：169 格包含 13 对子、78 suited、78 offsuit；全范围比例按对子 6、suited 4、offsuit 12 个组合加权，总计 1326。不能直接对 169 格求平均。
- **来源随数据同行**：记录 supplier、source URL、accessedAt、version、license/permission、solver、solve settings、精度、手工处理方式和 checksum。来源未知时显示 `Imported · unverified`。
- **不默默插值**：80bb 与 100bb、6-max 与 9-max、cash 与 tournament 不互相替代。近似结果若未来支持，需独立标记并让用户显式选择。
- **可审计分层**：可再分发的数据包才随代码提交；个人导入保留在浏览器或被忽略的本地目录。演示数据独立，并始终显示 `Demo · not solver output`。

## 建议的交付顺序

1. 先验证 6-max NLHE cash、100bb、一个明确 rake 与尺寸树，覆盖 RFI / facing open / facing 3B / facing 4B 的完整节点。
2. 做好标准 JSON 导入与校验，并能从授权格式转换；用来源标签区分真实数据、简化图表和演示。
3. 与供应商落实许可或自行求解并验证后，发布第一个正式数据包。
4. 再逐步扩展后手、人数与 MTT；ICM 需要额外输入筹码分布与奖金结构，不能与 chip EV 混用。
5. 翻后另建 board、pot、reach range 与 action tree 模型，沿用来源和版本机制。

本次仅建立来源记录；没有购买订阅、创建外部账户、下载受限数据或将任何第三方策略表再分发。
