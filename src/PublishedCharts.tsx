import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Info } from 'lucide-react';
import { HANDS, getPositions, getVillains, normalizeHand, type ActionKey, type Position } from './lib/poker';
import type { PublishedChartNode, PublishedChartsResponse } from './lib/published-charts';

type Translate = (en: string, zh: string) => string;
type ChartKind = 'rfi' | 'vs-open';
const COLORS = { raise: '#a8d896', call: '#94c5e7', fold: '#e5e9df' };
const KINDS: { value: ChartKind; label: string }[] = [
  { value: 'rfi', label: 'Open / RFI' },
  { value: 'vs-open', label: 'Facing Open' },
];

export default function PublishedCharts({ t, onReference }: {
  t: Translate;
  onReference: (id: string, page: number) => void;
}) {
  const [nodes, setNodes] = useState<PublishedChartNode[]>([]);
  const [players, setPlayers] = useState(6);
  const [kind, setKind] = useState<ChartKind>('rfi');
  const [selectedHero, setHero] = useState<Position>('BTN');
  const [selectedVillain, setVillain] = useState<Position>('UTG');
  const [query, setQuery] = useState('AKs');
  const [loading, setLoading] = useState(import.meta.env.DEV);
  const [error, setError] = useState('');
  // Resolve seats together so changes never select an impossible action order.
  const heroes = getPositions(players).filter(position => kind === 'rfi'
    ? position !== 'BB' : getVillains(players, position, kind).length > 0);
  const hero = heroes.includes(selectedHero) ? selectedHero : 'BTN';
  const villains = getVillains(players, hero, kind);
  const villain = kind === 'rfi' ? null : villains.includes(selectedVillain) ? selectedVillain : villains[0];
  const node = nodes.find(item => item.players === players && item.kind === kind &&
    item.hero === hero && (item.villain ?? null) === villain);
  const hand = normalizeHand(query);
  const frequencies = hand ? node?.frequencies[hand] : undefined;
  const actions: ActionKey[] = kind === 'vs-open' || node?.callMeaning === 'SB completion / limp'
    ? ['raise', 'call', 'fold'] : ['raise', 'fold'];
  const labels = { raise: kind === 'vs-open' ? '3-Bet' : 'Raise', call: kind === 'vs-open' ? 'Call' : 'Limp', fold: 'Fold' };
  const title = `${hero}${villain ? ` vs ${villain}` : ''} · ${kind === 'rfi' ? 'Open' : 'Facing Open'}`;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const controller = new AbortController();
    fetch('/api/published-charts', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('The published chart library could not be loaded.');
      const result = await response.json() as PublishedChartsResponse;
      if (!controller.signal.aborted) { setNodes(result.nodes); setError(result.error ?? ''); }
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Chart loading failed'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  return <div className="published-workspace">
    <div className="tree-intro"><BookOpen size={21}/><div>
      <strong>{t('Published preflop ranges · Cash 100 BB', '已出版的翻前范围 · Cash 100 BB')}</strong>
      <p>{t('Open and Facing Open charts, rounded by the publisher to 0 / 50 / 100%. These are simplified references, not original solver frequencies.', 'Open 与 Facing Open 图表保留出版者的 0／50／100% 舍入精度，属于简化参考，不是原始求解频率。')}</p>
    </div><span>SIMPLIFIED CHART</span></div>
    <div className="tree-layout published-layout">
      <section className="panel">
        <div className="panel-heading"><h2>{t('Choose a published chart', '选择出版图表')}</h2><BookOpen size={17}/></div>
        <div className="tree-setup">
          <div className="two-fields">
            <label>{t('Players', '人数')}<select aria-label="Published chart players" value={players} onChange={event => setPlayers(Number(event.target.value))}>{[6,7,8,9].map(count => <option value={count} key={count}>{count}-max</option>)}</select></label>
            <label>{t('Situation', '场景')}<select aria-label="Published chart situation" value={kind} onChange={event => setKind(event.target.value as ChartKind)}>{KINDS.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
          </div>
          <div className="two-fields published-positions">
            <label>{t('Your position', '你的位置')}<select aria-label="Published chart position" value={hero} onChange={event => setHero(event.target.value as Position)}>{heroes.map(position => <option key={position}>{position}</option>)}</select></label>
            {kind === 'vs-open' && <label>{t('Opener', 'Open 位置')}<select aria-label="Published chart opener" value={villain ?? ''} onChange={event => setVillain(event.target.value as Position)}>{villains.map(position => <option key={position}>{position}</option>)}</select></label>}
          </div>
          <div className="published-conditions" aria-live="polite">
            <span>Cash · 100 BB · {kind === 'rfi' ? 'Open / RFI' : 'Facing Open'}</span>
            {node?.kind === 'vs-open' && <p className="published-open-size">{villain} Open to {node.facingRaiseToBb} BB</p>}
            <strong>{node ? node.raiseToBb !== null ? `${labels.raise} to ${node.raiseToBb} BB` : t('3-Bet · size not shown', '3-Bet · 原图未标尺寸') : '—'}</strong>
            <p>{kind === 'rfi'
              ? t('All preceding seats Fold. The opening size comes from the source chart.', '前面所有位置均 Fold，Open 尺寸来自原始图表。')
              : t('One Open, everyone else before you Folds. No callers, squeeze or prior Limp.', '一人 Open，其余在你之前行动的位置均 Fold，不含冷跟、Squeeze 或此前 Limp。')}</p>
            {node?.raiseToBb === null && <p>{t('This chart omits its action legend. Hand frequencies are transcribed, but no raise size is inferred.', '该图缺少动作图例。保留手牌频率，不从相邻图推断加注尺寸。')}</p>}
          </div>
          <div className="published-availability" aria-label="Published numerical chart counts">
            {[6,7,8,9].map(count => <span key={count}><b>{count}-max</b><em>{nodes.filter(item => item.players === count && item.kind === kind).length} {t('charts', '张图')}</em></span>)}
          </div>
          <p className="tree-muted">{t('Counts refer to the selected situation. 7/8-max numerical charts are still missing; their ranges are not copied from another table size.', '数量对应当前场景。7／8 人局数值图仍缺失，不会复用其他人数的范围。')}</p>
        </div>
        <div className="tree-library">
          <h3>{t('Source conditions', '来源条件')}</h3>
          {node && <>
            <p className="tree-muted">{node.source.title} · PDF {node.page}</p>
            <button className="text-button" onClick={() => onReference(node.refId, node.page)}>{t('Compare original PDF', '对照原始 PDF')}<ArrowUpRight size={14}/></button>
            <a href={`${node.source.url}#page=${node.page}`} target="_blank" rel="noreferrer">{t('Official source', '官方来源')}<ArrowUpRight size={14}/></a>
          </>}
          <p className="tree-muted">{t('Rake and ante are not fully established in this transcription. Do not treat it as an exact match for a custom game.', '本转录尚未完整核实抽水与前注，不能据此认定与你自定义的牌局条件完全匹配。')}</p>
          <p className="tree-muted">{t('This library is kept locally, separate from exact-history strategy datasets. Facing 3-Bet / 4-Bet remain available as PDF references where indexed.', '本图表库保存在本地，与完整历史的精确条件策略库分开。Facing 3-Bet／4-Bet 可查阅已有索引的 PDF 原图。')}</p>
        </div>
      </section>
      <section className="panel tree-range">
        <div className="panel-heading"><h2>{title}</h2><span className="status-pill">{node ? 'PUBLISHED · 50% STEPS' : 'NO DATA'}</span></div>
        <div className="published-matrix-legend">{actions.map(action => <span key={action}><i style={{ background: COLORS[action] }}/>{labels[action]}</span>)}</div>
        <div className="matrix-wrapper"><div className="hand-matrix" aria-label={`Published simplified range: ${title}`}>{HANDS.map(cell => {
          const row = node?.frequencies[cell];
          const background = row ? `linear-gradient(90deg,${COLORS.raise} ${row.raise * 100}%,${COLORS.call} ${row.raise * 100}%,${COLORS.call} ${(row.raise + row.call) * 100}%,${COLORS.fold} ${(row.raise + row.call) * 100}%)` : 'repeating-linear-gradient(135deg,#f6f7f4 0px,#f6f7f4 5px,#e2e7dc 5px,#e2e7dc 6px)';
          return <button key={cell} className={`hand-cell ${hand === cell ? 'selected-hand' : ''}`} style={{ background }} onClick={() => setQuery(cell)} aria-pressed={hand === cell} aria-label={`${cell}${row ? `: ${actions.map(action => `${labels[action]} ${row[action] * 100}%`).join(', ')}` : ': missing'}`}>{cell}</button>;
        })}</div></div>
        {!node && <div className="tree-empty"><Info size={24}/><h3>{loading ? t('Loading published charts…', '正在加载出版图表…') : t('No numerical chart for this spot', '该场景暂无数值图表')}</h3><p>{t('Only reviewed local transcriptions are shown here. The PDF reference library remains available.', '这里只展示已经核对的本地转录数据，也可继续查阅 PDF 参考库。')}</p></div>}
        <div className="tree-node-summary">
          <p>{t('Recomputed from the simplified cells, weighted by 1,326 combinations.', '依据简化后的格子，按 1,326 种组合重新计算。')}</p>
          <div className="tree-action-legend">{actions.map(action => <span key={action}><i style={{ background: COLORS[action] }}/>{labels[action]}<b>{node ? `${(node.derivedRangeSummary[action] * 100).toFixed(1)}%` : '—'}</b></span>)}</div>
          <p>{t('The printed PDF aggregate can differ from these rounded-cell totals.', '原 PDF 印刷的总体比例可能与简化格子的汇总不同。')}</p>
        </div>
      </section>
      <aside className="panel">
        <div className="panel-heading"><h2>{t('Hand frequencies', '手牌频率')}</h2><span className="matrix-count">0 / 50 / 100</span></div>
        <div className="tree-hand">
          <label>{t('Your hand', '你的手牌')}<input aria-label="Published chart hand" value={query} onChange={event => setQuery(event.target.value)} placeholder="AKs, AKo, QQ"/></label>
          <strong className="tree-hand-title">{hand ?? '—'}</strong>
          {!hand && <p className="input-error">{t('Specify suited or offsuit, or enter two cards.', '请注明同花／非同花，或输入两张具体牌。')}</p>}
          <div className="tree-hand-frequencies">{actions.map(action => <div key={action}><span style={{ borderLeftColor: COLORS[action] }}>{labels[action]}</span><strong>{frequencies ? `${frequencies[action] * 100}%` : '—'}</strong></div>)}</div>
          <p className="tree-muted">{t('Published, simplified frequencies. No interpolation or invented decimals.', '出版图表中的简化频率，不插值、不补造小数精度。')}</p>
          {node?.callMeaning === 'SB completion / limp' && <p className="tree-muted">{t('Limp means SB completes from 0.5 to 1 BB; it is not Call Open.', 'Limp 指 SB 从 0.5 BB 补到 1 BB，不是 Call Open。')}</p>}
        </div>
      </aside>
    </div>
    {error && <p className="tree-error" role="alert">{error}</p>}
  </div>;
}
