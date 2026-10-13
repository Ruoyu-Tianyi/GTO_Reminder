# GTO Reminder

**正在建设 6–9 人翻前工作台，尚未完成全部精确 GTO 数据覆盖。** 2026-10-13 已接入 325 个参考场景、27,914 个本机计算决策和 212 个快捷节点。出版图、位置映射、计算模型、未收敛研究结果和演示分别标识。

新增 **Data coverage / 数据覆盖**：按人数查看参考场景、未知手牌和计算模型，可直接进入参考范围或完整历史，刷新并导出不含策略频率的清单。新补 9 人最多三次加注研究包，含 284 个决策、全部 36 组面对 4-Bet 的位置组合，仍未确认收敛；它排除了 5-Bet，面对 4-Bet 只有 Fold/Call。求解工具现支持重启后核验存档并追加计算，见[存档恢复说明](docs/LOCAL_SOLVER.md)。

## v0.2 三种工作方式

- **Reference ranges**：保留 6／9 人的 64 张简化 Open／Facing Open 图；新增 8 人 119 张图，覆盖 Open、面对 Open／3／4／5-Bet、BB 对 SB Limp。8 人色条按图片测量，约 ±2 个百分点；未显示的手牌保留未知。7 人 91 张为从 8 人移除最早座位的投影估算，明确标记 `ESTIMATED`，没有重新求解。6／9 人 Facing 3-Bet 的保守转录只显示可核验手牌。见[8 人转录](docs/POKERCOACHING_TRANSCRIPTION.md)。
- **Action history**：支持完整行动记录和 v2 导入。6–9 人 100 BB 基础计算树无 Limp，最多到 3-Bet；另有 6 人含 Limp、7 人无 Limp 的四次加注研究包，覆盖标准单一对手的面对 4/5-Bet 场景，但尚未收敛，名称及面板均明确标记。示例使用所选模型的实际下注尺寸，查询按需跨分片加载。所有模型均使用近似后续价值。见[本机求解说明](docs/LOCAL_SOLVER.md)及[v2 格式](docs/DATA_FORMAT_V2.md)。
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
```

包仅包含当前 `computed-*.tree.json` / `*.quick.json`、五份参考转录 JSON、三份已知原 PDF 及 `solver-audits/` 顶层 JSON。清单记录每项相对路径、SHA-256 和字节数，保存在包内 `data/private/exports/bundle-manifest.json`。工具核对所有条目与清单、必需参考文件、哈希和大小，并在打包期间拒绝变化的源文件；`--verify` 只读取，不自动解压或覆盖。它不收集 `.runtime/`、引擎依赖、完整求解存档、日志或其他私人文件，也不上传数据。

数据包仅用于本人设备间复制，不上传或公开。在目标电脑克隆或更新源码、校验数据包后，建议将 ZIP **手动解压到没有同名数据的新 clone 项目根目录**，使其中的 `data/private/...` 落入项目的 `data/private/`。如果目标已有数据，先备份原 `data/private/`，再手动核对和合并需要的版本。源码继续通过 Git 同步，数据包与恢复的数据继续被 Git 忽略。重新启动本地服务或刷新页面后加载数据。包校验确认传输完整性，不替代来源许可或策略质量核验。

### 手动导入

1. 打开数据面板，使用 `Download template` 获取完整格式示例。
2. 按[数据格式说明](docs/DATA_FORMAT.md)填入获授权的数据、完整场景条件和来源信息。下载模板仍是演示数据，不能只修改名称就当作 solver 输出。
3. 点击 `Import JSON` 导入，再从 `Covered spots` 选择场景。

导入文件只在当前页面的内存中处理，**刷新页面后清空**；应用不会上传范围到服务器或 GitHub。语言偏好单独保存在浏览器本地。

本地开发模式也会读取 `data/private/` 顶层的标准 JSON 文件（单文件上限 20 MB），经过相同校验后加入列表，刷新页面会再次载入。该目录已被 Git 忽略，不进入生产构建。无效文件在数据面板中提示，并不影响其他有效文件。数据面板提供 5–9 人场景覆盖统计和缺失清单；计数不含演示或 PDF，也不等于整个翻前行动树。

来源网址、许可文字和准确性均由文件提供者声明。当前校验器检查结构与部分行动规则，不验证供应商身份、使用权限、求解收敛或频率质量。具体接入建议见[数据来源调研](docs/DATA_SOURCES.md)。

## v0.1 的边界

当前是 React + TypeScript + Vite 本地网页应用，查询预先提供的数据，不运行 solver。schema v1 仅表达无人入池与其他玩家均已弃牌的单一加注行动线。

- 不覆盖 Limp、冷跟者、Squeeze、多路行动历史、同节点多个加注尺寸、非对称后手、Straddle、Big Blind Ante、ICM 或 bounty。
- SB 的完整首次行动可能包含 Limp；本版不表达该动作，也没有内置 SB RFI 场景，不能据此呈现完整 SB 策略。
- Facing 4-Bet 的 Raise 仅为汇总 5-Bet 频率，没有 5-Bet 尺寸或 Shove 区分。
- 169 类数据不区分具体花色，也不包含到达节点的 reach 权重。范围汇总是对全部起手牌组合的加权展示，不是后续节点中实际到达范围的整体动作比例。
- `MTT · Chip EV` 是可匹配的数据标签，不表示已提供比赛数据，也不能代表 ICM 策略。
- 翻后尚未实现；专业数据接入、持久保存和更完整的行动树列入[路线图](docs/ROADMAP.md)。

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
