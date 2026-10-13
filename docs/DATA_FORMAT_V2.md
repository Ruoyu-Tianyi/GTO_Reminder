# 完整行动历史：数据格式 v2

v2 支持 6–9 人 NLHE Cash，SB 0.5 BB / BB 1 BB、每人相同 ante、各位置不同初始筹码。起始筹码包含 ante。Straddle、BB ante、ICM 和翻后尚未建模。Quick lookup 优先查询 v1；选中的本机计算包没有 v1 节点时，可按完整历史查询其同源 v2 数据。

在 Action history 中构建一个尚未结束的场景，点击 **Empty template for this decision** 下载完整 JSON。模板的 169 类手牌全部标为 `missing`，不包含策略建议。

2026-10-13 当前数据总计 **27,914 个 v2 历史决策、212 个 v1 快捷节点、64 个文件**，包括基础计算包、两个四次加注研究包和一个 9 人三次加注研究包。结构验证与达到求解质量目标分别记录，研究包仍未收敛。

## 顶层字段

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | `2` |
| `id`, `name` | 数据集标识和显示名称 |
| `source` | `name`、HTTP(S) `url`、`license`、ISO `retrievedAt`、`kind`（`demo` / `imported` / `computed`）、`precision` |
| `source.computation` | `computed` 必填：非空 `engine`、`model`、`scope`，非负整数 `iterations`，`status` 为 `approximate` 或 `unconverged` |
| `source.computation.tree` | 可选固定模型尺寸：`openSizeBb`、`threeBetSizeBb`、`fourBetSizeBb`（累计 Raise-to、不含 ante、有限且至少 2、非递减），`maxRaises` 整数 1–5，`limp` 布尔值；可选 `limpRaiseBb` 明确无人加注但有人 Limp 后的首次 Raise-to。相同后续尺寸可作为终止全下的未使用占位，实际示例仍须通过合法行动回放 |
| `source.computation.modelGapBb` | 可选最终快照的模型最佳响应差：有限非负数或未测量时的 `null`，不代表真实游戏 exploitability |
| `game.players` | 整数 6–9 |
| `game.stackBb` | 默认起始筹码 |
| `game.stacksBb` | 可选位置覆盖，例如 `{ "SB": 40, "BB": 100 }` |
| `game.format` | `cash` |
| `game.anteBb` | 每人 ante，0 必须表示确认无 ante |
| `game.rake` | 完整抽水配置的精确标识，不模糊匹配 |
| `nodes` | 1–10,000 个非终局决策节点 |

来源条件未知时不能猜值。已出版简化图使用独立格式保留未知条件，不进入精确查询。

`computed` 表示本地计算结果，不能据此称为完整 GTO。2026-10-03 已验证基线中，6/7/8/9 人分别导出 607/1,938/6,057/18,668 个决策，共 **27,270** 个。全部属于 Cash 100 BB、无 ante、5% rake / 2.5 BB cap / no flop no drop、Open 2.5 BB / 3-bet 10 BB、最多两次加注、无 Limp 的限定树。可表达树内 Cold Call 和 Squeeze，但没有后续 4-bet、5-bet 或翻后策略。四种人数均达到所设模型目标；9 人最终为 54 轮，最终快照测得模型最佳响应差之和为 0.017725984946639545 BB/hand。这是限定模型内部指标，不是真实游戏 exploitability 保证。详见 [本机求解记录](LOCAL_SOLVER.md)。

新增研究包使用同样的筹码、ante 和 rake，固定加注线为 2.5 / 10 / 30 / 100 BB，最多四次加注。6 人包允许 Limp，39 轮后导出 200 个 v2 历史决策；7 人包不允许 Limp，40 轮后导出 160 个。两包均为 `unconverged`，最终 `modelGapBb` 未测量并保留 `null`。`heads-up-lines` 只导出历史中最多两名主动投入筹码的玩家、最多一次未加注 Limp 的标准线；求解使用完整建模树，但其他分支未导出，不能称为完整大树覆盖。

## 历史与合法动作

每个节点含 `id`、`history`、`actions`、`hands`。历史在 ante 和盲注投入后开始，按实际顺序记录全部行动，包括 Fold。不会自动补弃牌。

```json
[
  { "actor": "UTG", "type": "raise", "amountBb": 2.5 },
  { "actor": "HJ", "type": "call" },
  { "actor": "CO", "type": "fold" }
]
```

6 人局此时轮到 BTN，表达 Open + Call 后的 Squeeze 场景，不会匹配成单独面对 UTG Open。

- `fold`：弃牌；`check`：没有需跟金额时过牌。
- `call`：自动支付欠注，短码时自动用完后手。无人加注时是 Limp；SB 补盲是 Complete。
- `raise.amountBb`：累计 live 投入目标，含已付盲注、不含 ante；不是本次额外支付额或倍数。
- 加注全下为 `raise` 至 committed + remaining；面对更大下注的全下跟注仍是 `call`。
- 金额最多 9 位小数，更高精度导入会拒绝，避免等价行动有不同查询键。
- 行动顺序、最小加注、短 All-in 累计重新开放以及终局都会校验。終局不可再添加翻前决策。

完整历史和每个座位实际初始筹码都是查询键。冷跟者后来 Fold 也不能删除其此前 Call；不同人数、尺寸、后手、rake、ante 或完整行动线不互相替代。

## 动作列表与手牌

`actions` 每项含唯一安全 `id`、`type`，仅 Raise 带 `amountBb`。可以同时有不同 Raise 尺寸和独立 All-in。所有动作都须在该节点合法。列表不是完整游戏树覆盖证明。

`hands` 必须显式列出 169 个 canonical hand class，每手只能属于以下一类：

```json
{ "status": "available", "reach": 0.4, "frequencies": { "fold": 0.5, "call": 0.5 } }
```

`available` 要求 `0 < reach <= 1`。频率键严格对应该节点所有动作 ID，值在 0–1，合计为 1（容差 0.000001）。示例假设节点仅有 fold/call。`reach` 是该手牌到达节点的历史权重，不是节点内的动作概率。

```json
{ "status": "unreachable", "reach": 0 }
```

`unreachable` 不带频率，也不等于 Fold 100%。

```json
{ "status": "missing" }
```

`missing` 不带 reach 或频率，不自动补 Fold。存在任意 missing 时不展示全范围汇总；完整数据按 `comboCount × reach` 加权；全部 reach 为 0 时汇总也为空。

## 本地使用

上传支持最大 20 MB，当前会话保存。开发服务仅枚举 `data/private/` 顶层的普通 JSON 文件，每文件上限 20 MB，分别通过 v1/v2 验证；坏文件单独报错。嵌套目录和外来路径不被当作数据源。重复数据集 ID 的所有副本均拒绝，并报告重复，避免按需选择时取到不确定的一份。私有文件不进入 Git 或生产构建。

基础计算结果分为 **54 个 v2 树分片和 4 个 v1 快捷文件，共 58 个文件**。6/7/8/9 人分别使用 2/4/12/36 个树分片；每片小于 8 MB，保留完整合法历史。三个研究包各有 1 个树文件和 1 个快捷文件，当前合计 **57 个树文件、7 个快捷文件，共 64 个文件**。分片用于传输和缓存，不改变策略的语义。

界面的数据选择器按同一个计算包合并为一个选项，不把分片展示成重复的数据集选项。选定包后，应用按完整历史请求对应节点；行动跨片时仍保持当前选择。

Quick lookup 的 v2 查询严格匹配已发生的行动、位置、筹码、ante 与 rake；尚未发生的尺寸控件不筛选模型实际提供的后续动作。界面保留 v2 的多尺寸动作、reach、`missing` 和 `unreachable`，按组合数乘 reach 汇总，不转换成 v1 的三项频率。展示前还校验所选快捷包与返回树的共同来源字段，包括引擎、模型、迭代次数、质量状态、范围和快照日期；本机文件更新导致版本不一致时提示刷新，不显示另一快照的策略。

覆盖报告将本机 `computed` 与用户 `imported` 分开统计，两类来源可覆盖同一场景；v2 完整历史决策单独计数。通过 Quick 查看 v2 不会把这些节点计入 v1 导入覆盖率。

### 按需开发接口

`/api/local-datasets` 仅接受 GET，返回 JSON 并设置 `Cache-Control: no-store`：

| 请求 | 响应 |
| --- | --- |
| 不带参数 | 兼容旧调用，返回 `{ datasets, treeDatasets, errors }`，包含全部有效 v1/v2 数据 |
| `?summary=1` | 返回 v1 `datasets`、空 `treeDatasets`、`errors` 和 `treeLibrary`；每项摘要仅有 `id/name/game/source/nodeCount` |
| `?treeId=<id>` | 返回空 `datasets`、指定完整分片的 `treeDatasets` 和 `errors` |
| `?treeId=<id>&history=<JSON>` | 按完整有序历史精确查询，仅返回一个匹配节点；无该历史时返回空树，不补造频率 |

参数使用 URL 编码，例如 `new URLSearchParams({ treeId, history: JSON.stringify(history) })`。`treeId` 只匹配已验证库内 ID，不能指定文件名或任意路径。`history` 必须是合法结构的动作数组，最多 200 项、解码后 UTF-8 最大 32 KB；非法参数返回 400 和 `errors`。

对 `computed` 且 ID 以 `-part-数字` 结尾的数据，历史查询可查同一计算包的其他片：去掉片号后的 ID、游戏条件、完整 `source`（含模型、迭代及快照日期）必须一致。非 computed 或非分片数据只查当前文件。一个包中同一历史出现在多片时拒绝歧义匹配；不跨模型或快照借用节点。返回的数据集 `id/name` 保留当前选择，`matchedPartId` 标明实际命中的片。

服务端首次扫描验证后缓存摘要及历史到节点的索引，文件时间戳、大小或文件身份变化会使缓存失效。元数据最多缓存 512 个文件，完整数据 LRU 最多 4 个文件、按原文件字节计最多 40 MB；并发扫描串行执行。历史查询只读取命中片，浏览器不需要下载整套计算树。这里的缓存是进程内缓存，不改变 HTTP 的禁止缓存标记。

合法性校验不证明求解器收敛、来源身份或 GTO 正确性。匹配不到节点就不显示频率；原图链接仅按人数、位置、行动线匹配，仍须核对来源尺寸和条件。
