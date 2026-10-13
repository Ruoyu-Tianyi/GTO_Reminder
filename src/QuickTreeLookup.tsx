import { useEffect, useState } from 'react';
import { Database, GitBranch, Layers3 } from 'lucide-react';
import { HANDS, normalizeHand, type Dataset, type Spot } from './lib/poker';
import { computedTreeId, resolveQuickTree, sourceSnapshotKey, spotToHistory } from './lib/spot-to-history';
import { treeRangeSummary, type StrategyChoice } from './lib/tree-strategy';
import { MISSING_HAND_BACKGROUND, strategyActionColor as color } from './lib/strategy-colors';

type Translate = (en: string, zh: string) => string;
const percent = (value: number) => `${(value * 100).toFixed(value > 0 && value < .01 ? 2 : 1)}%`;
const label = (action: Pick<StrategyChoice, 'type' | 'amountBb'>) => action.type === 'raise' ? `Raise ${action.amountBb} BB` : action.type[0].toUpperCase() + action.type.slice(1);
type Resolved = NonNullable<ReturnType<typeof resolveQuickTree>>;

/** A view of v2 data, not a conversion into v1 frequencies. */
export default function QuickTreeLookup({ dataset, spot, query, onQueryChange, enabled, t }: {
  dataset: Dataset; spot: Spot; query: string; onQueryChange: (value: string) => void; enabled: boolean; t: Translate;
}) {
  const [result, setResult] = useState<{ key: string; value: Resolved } | null>(null);
  const [request, setRequest] = useState<{ key: string; loading: boolean; error: string }>({ key: '', loading: false, error: '' });
  const treeId = computedTreeId(dataset);
  const requestKey = JSON.stringify([dataset.id, sourceSnapshotKey(dataset.source), spot]);
  let line: ReturnType<typeof spotToHistory> | undefined;
  let lineError = '';
  try { line = spotToHistory(spot); } catch (error) { lineError = error instanceof Error ? error.message : 'Invalid action history.'; }
  const found = result?.key === requestKey ? result.value : null;
  const node = found?.node;
  const raiseActions = node?.actions.filter(action => action.type === 'raise') ?? [];
  const summary = node ? treeRangeSummary(node) : null;
  const hand = normalizeHand(query);
  const row = hand ? node?.hands[hand] : undefined;
  const loading = request.key === requestKey && request.loading;
  const error = request.key === requestKey ? request.error : '';

  useEffect(() => {
    setResult(null);
    if (!enabled || !treeId || !line || !import.meta.env.DEV) return;
    const controller = new AbortController();
    setRequest({ key: requestKey, loading: true, error: '' });
    const timer = setTimeout(() => {
      fetch(`/api/local-datasets?treeId=${encodeURIComponent(treeId)}&history=${encodeURIComponent(JSON.stringify(line.history))}`, { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error('Could not load this computed action history.');
        const data = await response.json() as { treeDatasets: unknown[]; errors: string[] };
        if (controller.signal.aborted) return;
        const match = resolveQuickTree(data.treeDatasets, dataset, spot);
        if (match) setResult({ key: requestKey, value: match });
        setRequest({ key: requestKey, loading: false, error: data.errors.join(' ') });
      }).catch(error => {
        if (!controller.signal.aborted) setRequest({ key: requestKey, loading: false, error: error instanceof Error ? error.message : 'History lookup failed.' });
      });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [requestKey, enabled, treeId]);

  return <>
    <section className="range-panel panel tree-range" aria-label="Computed full-history range">
      <div className="panel-heading"><h2><span className="step-number">02</span>{t('Computed range · full history', '计算范围 · 完整历史')}</h2><GitBranch size={17}/></div>
      <div className="range-context"><div><h3>{spot.hero}{spot.villain ? ` vs ${spot.villain}` : ''}</h3><span>{spot.players}-max · {spot.stackBb} BB · Cash</span></div><span className={`status-pill ${node ? '' : 'unavailable'}`}>{node ? 'COMPUTED · APPROXIMATE' : loading ? 'LOADING' : 'NO DATA'}</span></div>
      <div className="matrix-wrapper"><div className="hand-matrix" aria-label="Computed historical reach matrix">{HANDS.map(cell => {
        const value = node?.hands[cell];
        let background = MISSING_HAND_BACKGROUND;
        if (value?.status === 'available') {
          let offset = 0;
          const stops = node!.actions.map(action => { const start = offset; offset += value.frequencies[action.id] * 100; return `${color(action, raiseActions.indexOf(action))} ${start}% ${offset}%`; });
          background = `linear-gradient(90deg, ${stops.join(',')})`;
        }
        return <button key={cell} style={{ background }} className={`hand-cell ${cell === hand ? 'selected-hand' : ''} ${value?.status === 'unreachable' ? 'unreachable-hand' : ''}`} aria-pressed={cell === hand} aria-label={`${cell}: ${value?.status ?? 'missing'}`} onClick={() => onQueryChange(cell)}>{cell}</button>;
      })}</div></div>
      <p className="tree-matrix-caption">{t('Hatched: missing data. Crossed out: zero historical reach. Grey: Fold. No missing hand is filled with Fold.', '斜纹表示缺数据；划线表示历史到达权重为零；灰色表示 Fold。缺失手牌不填成弃牌。')}</p>
      {node ? <div className="tree-node-summary"><div className="tree-action-legend">{node.actions.map(action => <span key={action.id}><i style={{ background: color(action, raiseActions.indexOf(action)) }}/>{label(action)} <b>{summary ? percent(summary[action.id]) : '—'}</b></span>)}</div><p>{summary ? t('Weighted by combinations × historical reach.', '按组合数 × 历史到达权重汇总。') : t('No summary while any hand is missing or all reach is zero.', '存在缺失手牌或全部不可达时不显示汇总。')}</p></div> : <div className="tree-empty"><Database size={26}/><h3>{loading ? t('Looking up this action history…', '正在查找完整行动历史…') : t('No matching decision in this model', '当前模型没有匹配的决策节点')}</h3><p>{lineError || (!treeId ? t('This file has no linked local action-history pack.', '该文件没有可关联的本地行动树资料包。') : t('The model may omit this branch or bet size. No frequency is inferred for an absent node.', '模型可能未包含该分支或加注尺寸；缺失节点不会推算成行动频率。'))}</p></div>}
      {error && <p className="tree-error" role="alert">{error === 'SNAPSHOT_CHANGED' ? t('The calculation changed on disk. Refresh this page to load matching Quick and history snapshots.', '本机计算已更新。请刷新页面，重新载入同一版本的快捷数据与行动树。') : error}</p>}
      <div className="data-credit"><Database size={13}/><span>{found?.dataset.name ?? dataset.name}</span></div>
    </section>
    <aside className="hand-panel panel" aria-label="Computed hand detail">
      <div className="panel-heading"><h2><span className="step-number">03</span>{t('Your hand', '查看手牌')}</h2><Layers3 size={17}/></div>
      <div className="tree-hand"><label>{t('Find a starting hand', '输入起手牌')}<input value={query} onChange={event => onQueryChange(event.target.value)} placeholder="AKs, QQ, As Kh" aria-label="Computed hand"/></label><strong className="tree-hand-title">{hand ?? '—'}</strong>{!hand && <p className="input-error">{t('Enter a valid starting hand.', '请输入有效起手牌。')}</p>}
        {row?.status === 'available' && node ? <><div className="tree-hand-frequencies">{node.actions.map(action => <div key={action.id}><span style={{ borderLeftColor: color(action, raiseActions.indexOf(action)) }}>{label(action)}</span><strong>{percent(row.frequencies[action.id])}</strong></div>)}</div><p className="tree-muted">Reach: {percent(row.reach)} · {t('conditional frequencies', '节点内条件频率')}</p></> : <p className="tree-muted">{row?.status === 'unreachable' ? t('This hand has zero reach under the current model strategy. No action frequency is assigned.', '该手牌在当前模型策略下的历史到达权重为零，不赋予行动频率。') : t('No frequencies for this hand and history.', '当前手牌与历史没有可用频率。')}</p>}
      </div>
      <div className="tree-history"><h3>{t('Matched action history', '查询行动历史')}</h3>{line && <ol>{line.history.length ? line.history.map((action, index) => <li key={index}><span>{index + 1}</span><strong>{action.actor}</strong><em>{label(action)}</em></li>) : <li>{t('Unopened pot', '无人入池')}</li>}</ol>}<p className="tree-muted">{t('Prior bets, seats, stacks, rake and ante must match. Future bet-size controls do not filter this view: every available action and its actual size comes from the model.', '严格匹配此前下注、位置、后手、抽水与前注。尚未发生的加注尺寸不筛选此视图；可选行动与实际尺寸以模型为准。')}</p></div>
      {found && <div className="tree-library"><p className="tree-muted">{found.dataset.source.precision}</p><a href={found.dataset.source.url} target="_blank" rel="noreferrer">{t('Calculation engine source', '计算引擎来源')}</a></div>}
    </aside>
  </>;
}
