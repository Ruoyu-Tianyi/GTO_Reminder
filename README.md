# GTO_Reminder

**v0.1 是翻前范围查询的交互基础版本，尚不能作为 GTO 决策建议。** 当前内置的是 4 个合成演示场景，用于检查界面与数据流程；项目没有捆绑专业 solver 策略。只有导入适用、获授权并经过独立核验的数据后，才具备相应场景的研究价值；导入成功本身不证明 GTO 准确性。

GTO_Reminder 希望把成熟的德州扑克策略数据整理成易用的网页工具：选择人数、位置、后手和前序行动，查看范围矩阵，并按手牌查询 Open、Call Open、3-Bet、Call 3-Bet、4-Bet 等动作频率。先把翻前查询做可靠，再逐步扩展至翻后。

[GitHub repository](https://github.com/Ruoyu-Tianyi/GTO_Reminder) · [数据格式](docs/DATA_FORMAT.md) · [来源调研](docs/DATA_SOURCES.md) · [后续路线](docs/ROADMAP.md)

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

建议使用 Node.js 20.19+ 或 22.12+，并使用 npm 安装。仓库使用 `package-lock.json` 锁定依赖版本。

```bash
npm install
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

1. 打开数据面板，使用 `Download template` 获取完整格式示例。
2. 按[数据格式说明](docs/DATA_FORMAT.md)填入获授权的数据、完整场景条件和来源信息。下载模板仍是演示数据，不能只修改名称就当作 solver 输出。
3. 点击 `Import JSON` 导入，再从 `Covered spots` 选择场景。

导入文件只在当前页面的内存中处理，**刷新页面后清空**；应用不会上传范围到服务器或 GitHub。语言偏好单独保存在浏览器本地。

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
