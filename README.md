# GTO Reminder

**6–9 人、100 BB 现金桌翻前学习工作台。** 434 类标准场景均有参考或独立模型记录，每类至少一个来源没有未知手牌行；补齐版本包含明确限制的近似计算，并不代表完整、精确的 NLHE GTO。325 个出版／投影参考场景继续保留原始精度和未知手牌。详细验收口径见 [ACCEPTANCE.md](docs/ACCEPTANCE.md)。

2026-10-13 本机全库验收：11 个计算模型、29,425 个完整历史决策、312 个快捷节点，74 个数据文件。快捷节点与行动树重叠，不相加。新增四个受限模型均达到各自内部误差目标；3 个较早的深树研究模型继续保留未收敛标识。

**Data coverage / 数据覆盖**：按 6／7／8／9 人分别核对 67／92／121／154 类标准位置对局，覆盖 RFI、面对 Open／3／4／5-Bet 和两种盲位 Limp 场景。可逐项查看来源、尺寸、抽水、未知／不可达手牌，直接打开该决策，并导出清单及缺口。各来源的条件和质量分别保留，数量不能相加成精确 GTO 覆盖率。

新增 `restricted-entry-k3-limp1-v1`：最多三名玩家主动入池、一次未加注 Limp，固定 2.5／10／30／100 BB，补齐此前 7／8／9 人的标准场景缺口。限制参与求解，会改变原牌局；各包保留真实迭代与最终测量值，未达模型目标的结果明确标识。原基础树及研究包继续独立使用。复现和重启后续算见[本机求解说明](docs/LOCAL_SOLVER.md)。

新增 **我的收藏**：三个工作台的条件、手牌、完整历史和来源可保存、导入与导出；来源缺失或改变时保留查询，不自动换用其他频率。**全压应对**可在明确对手范围及抽水后计算跟注 EV、采样区间和 169 类手牌矩阵，仍不属于 GTO 频率。使用方式见[收藏与全压分析](docs/STUDY_TOOLS.md)。

## v0.2 三种工作方式

- **Reference ranges**：保留 6／9 人的 64 张简化 Open／Facing Open 图；新增 8 人 119 张图，覆盖 Open、面对 Open／3／4／5-Bet、BB 对 SB Limp。8 人色条按图片测量，约 ±2 个百分点；未显示的手牌保留未知。7 人 91 张为从 8 人移除最早座位的投影估算，明确标记 `ESTIMATED`，没有重新求解。6／9 人 Facing 3-Bet 的保守转录只显示可核验手牌。见[8 人转录](docs/POKERCOACHING_TRANSCRIPTION.md)。
- **Action history**：支持完整行动记录和 v2 导入。基础树、深树研究与新增三人入池上限模型各自独立；后者覆盖 6–9 人的标准单一对手 RFI、面对 Open／3／4／5-Bet 及两种盲位 Limp。示例使用所选模型的实际下注尺寸，查询按需跨分片加载。所有模型均使用近似后续价值，限制和收敛状态在页面可见。见[本机求解说明](docs/LOCAL_SOLVER.md)及[v2 格式](docs/DATA_FORMAT_V2.md)。
- **Quick lookup**：保留演示与 v1 导入，可选择本机计算的 RFI／Facing Open 数据包；缺少 v1 场景时，可查询同一计算快照的 v2 完整历史，保留到达权重、不可达和缺失状态。计算覆盖单独计数，不计入正式导入来源。
- **本机胜率模拟**：三个模块均可展开，给定对手模型计算单手或全部 169 类的摊牌胜率，显示样本数、采样区间、进度并支持停止、导出。这不是行动混频或 GTO 求解，不会覆盖来源频率。

完整行动规则支持不等于全部节点已有解；任意后手、尺寸、Limp、多路及深层加注的完整策略仍未补齐。界面提供标准参考场景覆盖表，不将推算数量当成真实 GTO 覆盖率。

本轮新增数据的复现方式见 [Facing Open 转录](docs/RESPONSE_TRANSCRIPTION.md)，后续 3-Bet 图的手牌缺失与到达率边界见[数据缺口](docs/RESPONSE_DATA_GAPS.md)。

GTO Reminder 希望把成熟的德州扑克策略数据整理成易用的网页工具：选择人数、位置、后手和前序行动，查看范围矩阵，并按手牌查询 Open、Call Open、3-Bet、Call 3-Bet、4-Bet 等动作频率。先把翻前查询做可靠，再逐步扩展至翻后。

[GitHub repository](https://github.com/Ruoyu-Tianyi/GTO_Reminder) · [数据格式](docs/DATA_FORMAT.md) · [来源调研](docs/DATA_SOURCES.md) · [后续路线](docs/ROADMAP.md)

**2026-09-27 数据补充：**已接入 6、8、9 人 Cash 100 BB 的专业原始 PDF 查阅，合计 205 个场景页码索引，包括 8 人局的 Facing 4-Bet。网页顶部点击 `Browse charts`。5、7 人完整公开资料与逐手精确数值频率仍缺失；原图不会冒充精确策略填进频率计算器。来源、原稿缺陷、页码及本地下载方式见[公开图表记录](docs/PUBLIC_CHARTS.md)。

## 当前功能

- 默认英文界面，可切换中文；SB、BB、HJ、BTN 等位置缩写，以及 Raise、Call、Fold 等动作保留英文。
- 2–9 人二维牌桌，点击座位选择 Hero；按翻前行动顺序选择合法对手位置。单挑时 SB 同时为 BTN / dealer。
- 查询条件包含游戏类型、人数、位置、有效后手、前序行动、Open / 3-Bet / 4-Bet 尺寸、Ante 和 Rake。
- 13 × 13 范围矩阵展示 169 类起手牌及动作混频；支持按动作筛选和点击手牌查看频率。
- 输入 `AKs`、`kAo`、`As Ks`、`K♥A♠` 等手牌并归一化；拒绝 `AK` 这种未说明同花性的输入，以及 `AsAs` 这种重复牌。
- 范围汇总按对子 6、suited 4、offsuit 12 个组合加权，总计 1,326 个组合。
- 导入本地 JSON，校验场景、位置顺序、下注尺寸、169 类完整覆盖、频率范围与合计，并显示文件声明的来源信息。
- 查询只返回完全匹配的节点。缺少节点时显示 `NO DATA`，不会替换后手、人数、抽水或尺寸，也不会插值补出策略。

## 本地运行

Windows 当前工作区可以直接在 PowerShell 中运行：

```powershell
# 在克隆后的仓库根目录执行，无需固定盘符或目录名
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

脚本会查找系统 Node.js，也支持当前用户的 Codex 本地运行时，无需先把 Node 加入系统 PATH。启动后打开终端显示的 `Local` 地址，保持终端打开；按 Ctrl+C 停止。默认端口为 5173，可用 `-Port 5180` 指定其他端口。7890 是网络代理端口，不是网页地址。

建议使用 Node.js 20.19+ 或 22.12+，并使用 npm 安装。仓库使用 `package-lock.json` 锁定依赖版本。

```bash
npm ci
npm run dev
```

打开终端显示的本地网址。开发服务器默认只监听 `127.0.0.1`。

```bash
npm test
npm run build
npm run preview
```

`test` 运行数据校验与扑克基础逻辑测试；`build` 执行 TypeScript 检查并生成 `dist/`；`preview` 预览生产构建。

## 演示场景

内置的 4 个节点均为 **6-max、100bb、Cash、无 Ante**。演示树使用 Open 2.5bb、3-Bet 10bb、4-Bet 22bb，以及 `5% · 3 BB cap` 这一 Rake 标签。这些条件和手工编写的频率只是界面样例，不是一次真实求解的产物。

| 场景 | Hero | Villain | 展示的动作 |
| --- | --- | --- | --- |
| Open | BTN | — | Open / Fold |
| Facing Open | BB | BTN | 3-Bet / Call / Fold |
| Facing 3-Bet | BTN | BB | 4-Bet / Call / Fold |
| Facing 4-Bet | BB | BTN | 5-Bet / Call / Fold |

可从数据面板的 `Covered spots` 直接切换已覆盖场景。页面支持选择其他人数和后手，不代表内置数据已经覆盖它们。

## 导入自己的范围

### 换电脑恢复本地数据

Git 同步代码、来源索引和生成脚本，`data/private/` 中的 PDF、转录频率与本机计算结果不会上传。

```powershell
# Python 需有 pypdf、Pillow、numpy；也可用 -Python 指定现有解释器
powershell -ExecutionPolicy Bypass -File scripts/restore-reference-data.ps1
```

此命令核验原 PDF 指纹并重建参考图。7 人投影由应用根据 8 人转录生成。近似求解数据按[本机求解说明](docs/LOCAL_SOLVER.md)另外计算。进入项目先 `git pull --ff-only`、`npm ci`，结束工作再提交和推送代码。

已有完整本地数据时，可使用只依赖 Python 标准库的迁移工具：

```powershell
# 在源电脑等待计算和数据导出结束后执行
python scripts/pack-local-data.py
# 输出 data/private/exports/日期时间-bundle.zip 的实际路径
# 将下列路径替换为生成的包；复制至目标电脑后再次校验
python scripts/pack-local-data.py --verify "D:/transfer/实际文件名-bundle.zip"
# 在目标项目先预览，再恢复；已有相同文件跳过，任何内容冲突均拒绝
python scripts/pack-local-data.py --restore "D:/transfer/实际文件名-bundle.zip" --dry-run
python scripts/pack-local-data.py --restore "D:/transfer/实际文件名-bundle.zip"
```

包仅包含当前 `computed-*.tree.json` / `*.quick.json`、五份参考转录 JSON、三份已知原 PDF 及 `solver-audits/` 顶层 JSON。清单记录每项相对路径、SHA-256 和字节数，保存在包内 `data/private/exports/bundle-manifest.json`。工具核对所有条目与清单、必需参考文件、哈希和大小，并在打包期间拒绝变化的源文件；`--verify` 只读取，不自动解压或覆盖。它不收集 `.runtime/`、引擎依赖、完整求解存档、日志或其他私人文件，也不上传数据。

数据包用于本人设备间复制。恢复工具预先校验全部条目，保留固定备份与操作日志，仅新增文件；失败时只撤回本次创建且未被修改的文件。恢复期间数据接口暂停读取，完成后刷新页面。发生冲突或中断时见[数据迁移与回滚](docs/DATA_MIGRATION.md)，不要直接覆盖目录或手动删锁。源码继续通过 Git 同步，数据包与恢复的数据继续被 Git 忽略。包校验确认传输完整性，不替代策略质量核验。

### 手动导入

1. 打开数据面板，使用 `Download template` 获取完整格式示例。
2. 按[数据格式说明](docs/DATA_FORMAT.md)填入获授权的数据、完整场景条件和来源信息。下载模板仍是演示数据，不能只修改名称就当作 solver 输出。
3. 点击 `Import JSON` 导入，再从 `Covered spots` 选择场景。

导入的策略文件只在当前页面的内存中处理，**刷新页面后清空**；应用不会上传范围到服务器或 GitHub。语言偏好与查询收藏保存在浏览器本地；收藏不包含策略频率。

本地开发模式也会读取 `data/private/` 顶层的标准 JSON 文件（单文件上限 20 MB），经过相同校验后加入列表，刷新页面会再次载入。该目录已被 Git 忽略，不进入生产构建。无效文件在数据面板中提示，并不影响其他有效文件。数据面板提供 5–9 人场景覆盖统计和缺失清单；计数不含演示或 PDF，也不等于整个翻前行动树。

来源网址、许可文字和准确性均由文件提供者声明。当前校验器检查结构与部分行动规则，不验证供应商身份、使用权限、求解收敛或频率质量。具体接入建议见[数据来源调研](docs/DATA_SOURCES.md)。

## v0.1 的边界（仅旧格式）

应用使用 React + TypeScript + Vite，在浏览器查询预先提供的数据；独立翻前求解由本机脚本与引擎运行。以下限制仅适用于旧的 schema v1 快捷格式；完整历史、Limp、冷跟及多轮加注应使用 v2。

- 不覆盖 Limp、冷跟者、Squeeze、多路行动历史、同节点多个加注尺寸、非对称后手、Straddle、Big Blind Ante、ICM 或 bounty。
- SB 的完整首次行动可能包含 Limp；本版不表达该动作，也没有内置 SB RFI 场景，不能据此呈现完整 SB 策略。
- Facing 4-Bet 的 Raise 仅为汇总 5-Bet 频率，没有 5-Bet 尺寸或 Shove 区分。
- 169 类数据不区分具体花色，也不包含到达节点的 reach 权重。范围汇总是对全部起手牌组合的加权展示，不是后续节点中实际到达范围的整体动作比例。
- `MTT · Chip EV` 是可匹配的数据标签，不表示已提供比赛数据，也不能代表 ICM 策略。
- 翻后尚未实现；更完整的收益模型、专业数据和行动树研究见[路线图](docs/ROADMAP.md)。

## 项目结构

```text
src/
  App.tsx              页面、牌桌、范围矩阵与导入交互
  data/demo.ts         明确标记的合成演示数据
  lib/poker.ts         手牌、位置、组合数、匹配与校验
  lib/poker.test.ts    核心逻辑测试
docs/
  DATA_FORMAT.md       JSON 格式与当前模型边界
  DATA_SOURCES.md      专业来源、获取方式与接入建议
  ROADMAP.md           从翻前基础版本到全局策略研究
```
