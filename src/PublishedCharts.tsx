import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Info } from 'lucide-react';
import { HANDS, getPositions, normalizeHand, type Position } from './lib/poker';
import type { PublishedChartNode } from './lib/published-charts';

type Translate = (en: string, zh: string) => string;
const COLORS = { raise: '#a8d896', call: '#94c5e7', fold: '#e5e9df' };

export default function PublishedCharts({ t }: { t: Translate }) {
  const [nodes, setNodes] = useState<PublishedChartNode[]>([]);
  const [players, setPlayers] = useState(6);
  const [hero, setHero] = useState<Position>('BTN');
  const [query, setQuery] = useState('AKs');
  const [loading, setLoading] = useState(import.meta.env.DEV);
  const [error, setError] = useState('');
  const node = nodes.find(item => item.players === players && item.hero === hero);
  const hand = normalizeHand(query);
  const frequencies = hand ? node?.frequencies[hand] : undefined;
  const actions = node?.callMeaning === 'SB completion / limp' ? ['raise', 'call', 'fold'] as const : ['raise', 'fold'] as const;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const controller = new AbortController();
    fetch('/api/published-charts', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('The published chart library could not be loaded.');
      const result = await response.json() as { nodes: PublishedChartNode[]; error: string | null };
      if (!controller.signal.aborted) { setNodes(result.nodes); setError(result.error ?? ''); }
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Chart loading failed'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  return <div className="published-workspace">
    <div className="tree-intro"><BookOpen size={21}/><div><strong>{t('Published opening ranges · Cash 100 BB', '已出版的 Open 范围 · Cash 100 BB')}</strong><p>{t('Interactive transcription of official charts, rounded by the publisher to 0 / 50 / 100%. These are not original solver frequencies.', '将官方图表转为可交互矩阵，保留出版者的 0／50／100% 舍入精度，不是原始精确求解频率。')}</p></div><span>SIMPLIFIED CHART</span></div>
    <div className="tree-layout published-layout">
      <section className="panel"><div className="panel-heading"><h2>{t('Choose a published chart', '选择出版图表')}</h2><BookOpen size={17}/></div><div className="tree-setup"><div className="two-fields"><label>{t('Players', '人数')}<select value={players} onChange={event => { const next = Number(event.target.value); setPlayers(next); if (!getPositions(next).includes(hero)) setHero('BTN'); }}>{[6,7,8,9].map(count => <option value={count} key={count}>{count}-max</option>)}</select></label><label>{t('Position', '位置')}<select value={hero} onChange={event => setHero(event.target.value as Position)}>{getPositions(players).filter(position => position !== 'BB').map(position => <option key={position}>{position}</option>)}</select></label></div><div className="published-conditions"><span>Cash · 100 BB · Open / RFI</span><strong>{node ? `Raise to ${node.raiseToBb} BB` : '—'}</strong><p>{t('All preceding seats Fold. The opening size comes from the source chart.', '前面所有位置均 Fold。Open 尺寸来自原始图表。')}</p></div><div className="published-availability">{[6,7,8,9].map(count => <span key={count}><b>{count}-max</b><em>{nodes.filter(item => item.players === count).length} {t('charts', '张图')}</em></span>)}</div><p className="tree-muted">{t('7/8-max have no numerical opening chart in this library. Their missing ranges are not copied from another table size.', '本库暂无 7／8 人局的数值 Open 图，不会复用其他人数的范围。')}</p></div><div className="tree-library"><h3>{t('Source conditions', '来源条件')}</h3>{node && <><p className="tree-muted">{node.source.title} · PDF {node.page}</p><a href={`${node.source.url}#page=${node.page}`} target="_blank" rel="noreferrer">{t('Original published chart', '原始出版图表')}<ArrowUpRight size={14}/></a></>}<p className="tree-muted">{t('Rake and ante are not fully established in this transcription. Do not treat it as an exact match for a custom game.', '本转录尚未完整核实抽水与前注，不能据此认定与你自定义的牌局条件完全匹配。')}</p><p className="tree-muted">{t('This library is kept locally and separate from exact-history strategy datasets.', '本图表库保存在本地，与完整历史的精确条件策略库分开。')}</p></div></section>
      <section className="panel tree-range"><div className="panel-heading"><h2>{hero} · {t('Opening range', 'Open 范围')}</h2><span className="status-pill">{node ? 'PUBLISHED · 50% STEPS' : 'NO DATA'}</span></div><div className="published-matrix-legend">{actions.map(action => <span key={action}><i style={{ background: COLORS[action] }}/>{action === 'raise' ? 'Raise' : action === 'call' ? 'Limp' : 'Fold'}</span>)}</div><div className="matrix-wrapper"><div className="hand-matrix" aria-label="Published simplified opening range">{HANDS.map(cell => {
        const row = node?.frequencies[cell];
        const background = row ? `linear-gradient(90deg,${COLORS.raise} ${row.raise * 100}%,${COLORS.call} ${row.raise * 100}%,${COLORS.call} ${(row.raise + row.call) * 100}%,${COLORS.fold} ${(row.raise + row.call) * 100}%)` : 'repeating-linear-gradient(135deg,#f6f7f4 0px,#f6f7f4 5px,#e2e7dc 5px,#e2e7dc 6px)';
        return <button key={cell} className={`hand-cell ${hand === cell ? 'selected-hand' : ''}`} style={{ background }} onClick={() => setQuery(cell)} aria-pressed={hand === cell} aria-label={`${cell}${row ? `: Raise ${row.raise * 100}%, Limp ${row.call * 100}%, Fold ${row.fold * 100}%` : ': missing'}`}>{cell}</button>;
      })}</div></div>{!node && <div className="tree-empty"><Info size={24}/><h3>{loading ? t('Loading published charts…', '正在加载出版图表…') : t('No numerical chart for this spot', '该场景暂无数值图表')}</h3><p>{t('Only reviewed local transcriptions are shown here. The PDF reference library remains available.', '这里只展示已经核对的本地转录数据，也可继续查阅 PDF 参考库。')}</p></div>}<div className="tree-node-summary"><p>{t('Recomputed from the simplified cells, weighted by 1,326 combinations.', '依据简化后的格子，按 1,326 种组合重新计算。')}</p><div className="tree-action-legend">{actions.map(action => <span key={action}><i style={{ background: COLORS[action] }}/>{action === 'call' ? 'Limp' : action === 'raise' ? 'Raise' : 'Fold'}<b>{node ? `${(node.derivedRangeSummary[action] * 100).toFixed(1)}%` : '—'}</b></span>)}</div><p>{t('The printed PDF aggregate may reflect the unrounded solve and can differ from these totals.', '原 PDF 印刷的总体比例可能基于舍入前的结果，因此可与这里的汇总不同。')}</p></div></section>
      <aside className="panel"><div className="panel-heading"><h2>{t('Hand frequencies', '手牌频率')}</h2><span className="matrix-count">0 / 50 / 100</span></div><div className="tree-hand"><label>{t('Your hand', '你的手牌')}<input aria-label="Published chart hand" value={query} onChange={event => setQuery(event.target.value)} placeholder="AKs, AKo, QQ"/></label><strong className="tree-hand-title">{hand ?? '—'}</strong>{!hand && <p className="input-error">{t('Specify suited or offsuit, or enter two cards.', '请注明同花／非同花，或输入两张具体牌。')}</p>}<div className="tree-hand-frequencies">{actions.map(action => <div key={action}><span style={{ borderLeftColor: COLORS[action] }}>{action === 'raise' ? 'Raise' : action === 'call' ? 'Limp' : 'Fold'}</span><strong>{frequencies ? `${frequencies[action] * 100}%` : '—'}</strong></div>)}</div><p className="tree-muted">{t('Published, simplified frequencies. No interpolation or invented decimals.', '出版图表中的简化频率，不插值、不补造小数精度。')}</p>{node?.callMeaning === 'SB completion / limp' && <p className="tree-muted">{t('Limp means SB completes from 0.5 to 1 BB; it is not Call Open.', 'Limp 指 SB 从 0.5 BB 补到 1 BB，不是 Call Open。')}</p>}</div></aside>
    </div>{error && <p className="tree-error" role="alert">{error}</p>}
  </div>;
}
