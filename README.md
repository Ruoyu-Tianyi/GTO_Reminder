# 若瑜策略研究

**中文** · [English](README.en.md)

面向 **6–9 人、100 BB 现金桌**的翻前策略学习工作台。用范围矩阵、完整行动历史与条件计算研究每一手牌，并保留数据来源、模型限制和不确定性。

[在线使用](https://gto-reminder.vercel.app) · [GitHub](https://github.com/Ruoyu-Tianyi/GTO_Reminder) · [部署与域名](docs/DEPLOYMENT.md) · [验收范围](docs/ACCEPTANCE.md) · [数据来源](docs/DATA_SOURCES.md) · [路线图](docs/ROADMAP.md)

Vercel 生产站点已上线，GitHub `main` 自动部署已验证。正式域名 `https://gto.tianyizhou.cn` 已绑定项目，待阿里云 DNS 解析生效后启用；目前请使用上方“在线使用”入口。仓库名和程序包名继续保留 `GTO_Reminder` / `gto-reminder`。

## 可以做什么

- **参考范围图**：浏览出版图表的转录与座位投影，查看 13 × 13 起手牌矩阵、动作频率和原始来源。
- **完整行动历史**：按真实行动顺序构建查询，查看独立模型、下注尺寸、到达权重和计算质量。
- **快捷范围查询**：按人数、位置、后手、前序行动及尺寸精确匹配；支持导入自己的策略 JSON。
- **数据覆盖**：逐项检查标准场景、可用来源与未知手牌，直接打开相应决策，导出清单和缺口。
- **学习收藏**：保存查询、手牌、行动历史及来源身份，支持跨设备导入、导出和缺失来源提示。
- **本机分析**：运行单手或全部 169 类手牌的摊牌胜率模拟；在适用的单挑全压场景中计算条件跟注 EV。

界面支持中文 / English 切换、深色策略研究主题及手机布局。位置和动作使用常见扑克缩写。

## 数据范围与精度

静态策略库的发布范围如下，来源于 **2026-10-13 本机数据集**的验收记录。数据以压缩快照随网页发布，保留各来源的精度、模型条件与质量标识：

| 内容 | 数量与口径 |
| --- | --- |
| 标准场景分类 | **434 / 434**；6 / 7 / 8 / 9 人分别为 67 / 92 / 121 / 154 类 |
| 参考场景 | **325**：234 个出版图表转录、91 个 8→7 人座位投影 |
| 独立计算模型 | **11**；包含近似模型及保留未收敛标识的研究模型 |
| 完整历史决策 | **29,425** 个 v2 决策 |
| 快捷节点 | **312** 个 v1 节点，与行动树重叠，不能相加 |

标准分类包括 RFI、面对 Open / 3-Bet / 4-Bet / 5-Bet，以及两种盲位 Limp 场景。每类至少有一个来源无未知手牌行，但不同来源的尺寸、抽水、历史和模型不能混用。完整口径见[验收范围](docs/ACCEPTANCE.md)。

**这是策略研究工具，当前数据不等于完整、精确的 NLHE GTO。**

- 参考图保留原图精度与未知手牌；8 人图色条转录约有 ±2 个百分点的测量误差，7 人座位投影没有重新求解。
- 新增受限模型最多允许三名玩家主动入池、一次未加注 Limp，采用 2.5 / 10 / 30 / 100 BB 固定尺寸与近似后续价值。内部误差达标仅适用于该受限模型；较早的未收敛结果继续标记。
- 缺失、不可达与实际 Fold 是不同状态。查询不自动替换人数、后手、抽水或尺寸，也不插值生成未知策略。
- 胜率与条件 EV 依赖所选对手范围和抽水；采样区间只描述采样误差，不生成 GTO 动作混频。
- 任意后手、连续尺寸、完整多人行动树、翻后及 ICM 不属于当前完成范围。

## 本地运行

使用 Node.js 20.19+ 或 22.12+，依赖版本由 `package-lock.json` 锁定。

```bash
git clone https://github.com/Ruoyu-Tianyi/GTO_Reminder.git
cd GTO_Reminder
npm ci
npm run dev
```

打开终端显示的本地地址，默认是 `http://127.0.0.1:5173/`。开发服务器只监听本机。

Windows 也可以在仓库目录使用启动脚本；脚本会查找已安装的 Node.js：

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

可用 `-Port 5180` 指定其他端口。保持启动终端打开，按 `Ctrl+C` 停止。

```bash
npm test          # 数据校验与扑克逻辑测试
npm run build    # TypeScript 检查和生产构建
npm run preview  # 在本机预览 dist/
```

## 公开策略库与本地数据

网页采用**全静态部署**，无需登录、后端数据库或 Supabase。选定的业务数据导出至 `public/strategy-library/`，包括参考转录、计算模型与明确列入白名单的原 PDF。策略数据按压缩分片按需加载，gzip 策略数据约 **19.3 MiB**，3 份 PDF 约 **52.3 MiB**，整个发布包约 **71.6 MiB**。PDF 只在打开原图时载入，首屏不会下载整库。

`data/private/` 继续被 Git 忽略，发布流程只导出指定的业务文件；运行日志、求解 checkpoints、审计文件、迁移 ZIP 和其他工作文件不发布。公开快照包含上表的 434 类场景、325 个参考场景、11 个模型和 29,425 个历史决策。

- **线上使用**：浏览器从静态策略库加载内置范围，可在不同电脑或手机上直接查询，无需每台设备恢复本机数据。
- **本地开发**：优先使用本地数据 API；生产构建读取静态快照。更新本机源数据后，运行 `npm run export:library`，将生成的静态目录与代码一起提交、构建和发布，线上内容才会更新。
- 使用网页的数据管理入口下载模板、导入获授权的 JSON，再选择对应场景。v1 用于快捷节点，v2 用于完整历史；见[格式说明 v1](docs/DATA_FORMAT.md)和[格式说明 v2](docs/DATA_FORMAT_V2.md)。
- 手动导入的策略仅保存在当前页面内存，刷新后需重新导入；应用不会将这些范围上传到服务器。
- 语言偏好和查询收藏保存在当前浏览器。收藏不包含策略频率或 PDF，换电脑需单独导出、导入。
- 演示频率是界面样例。格式校验不证明来源身份、授权、求解收敛或策略质量。

## 多设备协作

**查阅内置策略只需打开同一个网站。** 收藏通过网页导入、导出；开发代码和公开数据快照通过 Git 同步。个人收藏与手动导入的策略不会自动云同步。

每次开始工作先更新代码和依赖：

```bash
git pull --ff-only
npm ci
```

如果另一台电脑还需要重新转录、求解或更新数据快照，可额外迁移完整本机工作数据。使用 Python 标准库工具，在计算与数据写入结束后打包，再将文件复制到另一台电脑：

```bash
python scripts/pack-local-data.py
python scripts/pack-local-data.py --verify "path/to/bundle.zip"
python scripts/pack-local-data.py --restore "path/to/bundle.zip" --dry-run
python scripts/pack-local-data.py --restore "path/to/bundle.zip"
```

工具核验清单、SHA-256 和大小；相同文件跳过，冲突拒绝覆盖，并保留恢复记录。源电脑执行打包，目标电脑执行校验与恢复。支持文件、回滚和中断恢复详见[数据迁移说明](docs/DATA_MIGRATION.md)。

需要重建源数据且没有迁移包时，可按[公开图表记录](docs/PUBLIC_CHARTS.md)恢复参考原稿，运行下列脚本重建参考转录；需要 Python、`pypdf`、`Pillow`、`numpy`。近似计算结果另按[本机求解说明](docs/LOCAL_SOLVER.md)生成。日常网页查询无需执行这些步骤。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/restore-reference-data.ps1
```

## 文档与技术栈

| 文档 | 内容 |
| --- | --- |
| [Vercel 部署与域名](docs/DEPLOYMENT.md) | 项目配置、阿里云解析、HTTPS 与自动发布验收 |
| [验收范围](docs/ACCEPTANCE.md) · [验证记录](docs/VERIFICATION.md) | 场景定义、完成边界与验证证据 |
| [收藏与全压分析](docs/STUDY_TOOLS.md) | 收藏恢复、范围假设及条件 EV |
| [本机求解](docs/LOCAL_SOLVER.md) · [数据迁移](docs/DATA_MIGRATION.md) | 计算复现、续算、迁移与回滚 |
| [格式 v1](docs/DATA_FORMAT.md) · [格式 v2](docs/DATA_FORMAT_V2.md) | 策略导入与模型约束 |
| [公开图表](docs/PUBLIC_CHARTS.md) · [8 人转录](docs/POKERCOACHING_TRANSCRIPTION.md) | 原稿、页码、转录精度与缺口 |
| [数据来源](docs/DATA_SOURCES.md) · [路线图](docs/ROADMAP.md) | 来源接入与后续研究 |

React 19 · TypeScript · Vite · Vitest · 原生 CSS。Vercel 托管网页与静态策略快照；查询和交互计算在浏览器运行，本机脚本负责源数据恢复、独立求解与快照导出。更新数据的发布步骤见[部署指南](docs/DEPLOYMENT.md#日常发布与数据更新)。
