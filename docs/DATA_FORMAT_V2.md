# 完整行动历史：数据格式 v2

v2 支持 6–9 人 NLHE Cash，SB 0.5 BB / BB 1 BB、每人相同 ante、各位置不同初始筹码。起始筹码包含 ante。Straddle、BB ante、ICM 和翻后尚未建模。v1 文件继续通过 Quick lookup 使用。

在 Action history 中构建一个尚未结束的场景，点击 **Empty template for this decision** 下载完整 JSON。模板的 169 类手牌全部标为 `missing`，不包含策略建议。

## 顶层字段

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | `2` |
| `id`, `name` | 数据集标识和显示名称 |
| `source` | `name`、HTTP(S) `url`、`license`、ISO `retrievedAt`、`kind`（`demo` / `imported`）、`precision` |
| `game.players` | 整数 6–9 |
| `game.stackBb` | 默认起始筹码 |
| `game.stacksBb` | 可选位置覆盖，例如 `{ "SB": 40, "BB": 100 }` |
| `game.format` | `cash` |
| `game.anteBb` | 每人 ante，0 必须表示确认无 ante |
| `game.rake` | 完整抽水配置的精确标识，不模糊匹配 |
| `nodes` | 1–10,000 个非终局决策节点 |

来源条件未知时不能猜值。已出版简化图使用独立格式保留未知条件，不进入精确查询。

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

上传支持最大 20 MB，当前会话保存。放入 `data/private/` 顶层的文件会在刷新后由开发服务再次载入。v1/v2 分别处理，坏文件单独报错。私有文件不进入 Git 或生产构建。

合法性校验不证明求解器收敛、来源身份或 GTO 正确性。匹配不到节点就不显示频率；原图链接仅按人数、位置、行动线匹配，仍须核对来源尺寸和条件。
