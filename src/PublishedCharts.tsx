import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Info } from 'lucide-react';
import { HANDS, getPositions, getVillains, normalizeHand, type Position, type SpotKind } from './lib/poker';
import type { PublishedChartsResponse } from './lib/published-charts';
import type { PublishedContinuationsResponse } from './lib/published-continuations';
import { isContinuation, publishedActions, publishedHand, handBackground, handDescription, type PublishedNode } from './lib/published-view';

type Translate = (en: string, zh: string) => string;
type ChartKind = SpotKind;
const KINDS: { value: ChartKind; label: string }[] = [
  { value: 'rfi', label: 'Open / RFI' },
  { value: 'vs-open', label: 'Facing Open' },
  { value: 'vs-3bet', label: 'Facing 3-Bet' },
  { value: 'vs-4bet', label: 'Facing 4-Bet' },
];

export default function PublishedCharts({ t, onReference }: {
  t: Translate;
  onReference: (id: string, page: number) => void;
}) {
  const [nodes, setNodes] = useState<PublishedNode[]>([]);
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
  const row = publishedHand(node, hand);
  const actions = publishedActions(node, kind);
  const continuation = node && isContinuation(node) ? node : undefined;
  const graphical = continuation?.precision.kind === 'graphical-actions';
  const kindLabel = KINDS.find(item => item.value === kind)!.label;
  const title = `${hero}${villain ? ` vs ${villain}` : ''} · ${kind === 'rfi' ? 'Open' : kindLabel}`;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const controller = new AbortController();
    const load = async (url: string) => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('The published chart library could not be loaded.');
      return response.json() as Promise<PublishedChartsResponse | PublishedContinuationsResponse>;
    };
    Promise.allSettled([load('/api/published-charts'), load('/api/published-continuations')]).then(results => {
      if (controller.signal.aborted) return;
      const loaded: PublishedNode[] = [], errors: string[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          loaded.push(...result.value.nodes);
          errors.push(...('errors' in result.value ? result.value.errors : result.value.error ? [result.value.error] : []));
        } else errors.push(result.reason instanceof Error ? result.reason.message : 'Chart loading failed');
      }
      setNodes(loaded); setError(errors.join(' ')); setLoading(false);
    });
    return () => controller.abort();
  }, []);

  return <div className="published-workspace">
    <div className="tree-intro"><BookOpen size={21}/><div>
      <strong>{t('Published preflop ranges · Cash 100 BB', '已出版的翻前范围 · Cash 100 BB')}</strong>
      <p>{t('Explore source-backed Open, 3-Bet and 4-Bet decisions. Chart precision and missing hands stay visible; these are published references, not original solver exports.', '查询有来源的 Open、3-Bet、4-Bet 决策。每张图保留原稿精度与手牌缺口，属于出版参考，不是原始求解器导出。')}</p>
    </div><span>PUBLISHED REFERENCE</span></div>
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
            {kind !== 'rfi' && <label>{kind === 'vs-3bet' ? t('3-Bettor', '3-Bet 位置') : kind === 'vs-4bet' ? t('4-Bettor', '4-Bet 位置') : t('Opener', 'Open 位置')}<select aria-label="Published chart opener" value={villain ?? ''} onChange={event => setVillain(event.target.value as Position)}>{villains.map(position => <option key={position}>{position}</option>)}</select></label>}
          </div>
          <div className="published-conditions" aria-live="polite">
            <span>Cash · 100 BB · {kindLabel}</span>
            {node?.kind === 'vs-open' && <p className="published-open-size">{villain} Open to {node.facingRaiseToBb} BB</p>}
            {node && !isContinuation(node) ? <strong>{node.raiseToBb !== null ? `${kind === 'rfi' ? 'Raise' : '3-Bet'} to ${node.raiseToBb} BB` : t('3-Bet · size not shown', '3-Bet · 原图未标尺寸')}</strong> : continuation ? <>
              <p className="published-open-size">{kind === 'vs-3bet' ? `${hero} Open → ${villain} 3-Bet` : `${villain} Open → ${hero} 3-Bet → ${villain} 4-Bet`}</p>
              <div className="published-sizes">{[
                ['Open', continuation.openSizeBb], ['3-Bet', continuation.threeBetSizeBb],
                ...(kind === 'vs-4bet' ? [['4-Bet', continuation.fourBetSizeBb]] : []),
              ].map(([label, value]) => <span key={label}>{label}<b>{value === null ? t('not specified', '未明确') : `${value} BB`}</b></span>)}</div>
            </> : <strong>—</strong>}
            <p>{kind === 'vs-3bet' || kind === 'vs-4bet' ? t('Single-opponent line; all other players Fold. No cold calls, squeeze or prior Limp.', '单一对手行动线，其余玩家均 Fold；不含冷跟、Squeeze 或先前 Limp。') : kind === 'rfi'
              ? t('All preceding seats Fold. The opening size comes from the source chart.', '前面所有位置均 Fold，Open 尺寸来自原始图表。')
              : t('One Open, everyone else before you Folds. No callers, squeeze or prior Limp.', '一人 Open，其余在你之前行动的位置均 Fold，不含冷跟、Squeeze 或此前 Limp。')}</p>
            {node && !isContinuation(node) && node.raiseToBb === null && <p>{t('This chart omits its action legend. Hand frequencies are transcribed, but no raise size is inferred.', '该图缺少动作图例。保留手牌频率，不从相邻图推断加注尺寸。')}</p>}
          </div>
          <div className="published-availability" aria-label="Published numerical chart counts">
            {[6,7,8,9].map(count => <span key={count}><b>{count}-max</b><em>{nodes.filter(item => item.players === count && item.kind === kind).length} {t('charts', '张图')}</em></span>)}
          </div>
          <p className="tree-muted">{t('Counts refer to charts for this situation, including partial transcriptions. A chart is not complete hand coverage. Missing table sizes stay empty.', '数量为当前场景的图表数，包含部分转录，并不表示所有手牌均有频率；缺失人数不会用其他人数代替。')}</p>
        </div>
        <div className="tree-library">
          <h3>{t('Source conditions', '来源条件')}</h3>
          {node && <>
            <p className="tree-muted">{node.source.title} · PDF {node.page}</p>
            <button className="text-button" onClick={() => onReference(node.refId, node.page)}>{t('Compare original PDF', '对照原始 PDF')}<ArrowUpRight size={14}/></button>
            <a href={`${node.source.url}#page=${node.page}`} target="_blank" rel="noreferrer">{t('Official source', '官方来源')}<ArrowUpRight size={14}/></a>
          </>}
          <p className="tree-muted">{t('Rake and ante are not fully established in this transcription. Do not treat it as an exact match for a custom game.', '本转录尚未完整核实抽水与前注，不能据此认定与你自定义的牌局条件完全匹配。')}</p>
          <p className="tree-muted">{t('This library is kept locally, separate from exact-history strategy datasets. Use the original PDF to inspect omitted or unclear hand cells.', '本图表库保存在本地，与完整历史的精确条件策略库分开。未表示或有歧义的手牌可对照原始 PDF。')}</p>
        </div>
      </section>
      <section className="panel tree-range">
        <div className="panel-heading"><h2>{title}</h2><span className="status-pill">{node ? graphical ? 'ACTIONS ONLY · % UNKNOWN' : continuation ? 'CONDITIONAL · 50% STEPS' : 'PUBLISHED · 50% STEPS' : 'NO DATA'}</span></div>
        <div className="published-matrix-legend">{actions.map(action => <span key={action.id}><i style={{ background: action.color }}/>{action.label}</span>)}{continuation && <span><i className="missing-swatch"/>{t('No readable data', '无可读数据')}</span>}</div>
        <div className="matrix-wrapper"><div className="hand-matrix" aria-label={`Published simplified range: ${title}`}>{HANDS.map(cell => {
          const cellRow = publishedHand(node, cell);
          return <button key={cell} className={`hand-cell ${hand === cell ? 'selected-hand' : ''} ${cellRow?.status === 'actions-only' ? 'qualitative-hand' : ''}`} style={{ background: handBackground(cellRow, actions) }} onClick={() => setQuery(cell)} aria-pressed={hand === cell} aria-label={handDescription(cell, cellRow, actions)}>{cell}{cellRow?.status === 'actions-only' && <span className="hand-action-dots" aria-hidden="true">{cellRow.actions.map(id => <i key={id} style={{ background: actions.find(action => action.id === id)?.color }}/>)}</span>}</button>;
        })}</div></div>
        {!node && <div className="tree-empty"><Info size={24}/><h3>{loading ? t('Loading published charts…', '正在加载出版图表…') : t('No reviewed chart for this spot', '该场景暂无已核验图表')}</h3><p>{t('Only reviewed local transcriptions are shown here. The PDF reference library remains available.', '这里只展示已经核对的本地转录数据，也可继续查阅 PDF 参考库。')}</p></div>}
        <div className="tree-node-summary">
          {continuation ? <>
            <strong className="published-readability">{Object.values(continuation.hands).filter(item => item.status !== 'missing').length} / 169 {graphical ? t('hands with visible actions', '手有明确动作') : t('hands with readable frequencies', '手有可读频率')}</strong>
            <p>{graphical ? t('Dots identify actions visible in the original chart. Their size and spacing do not represent frequency; mixed percentages are not provided.', '色点仅表示原图可见的动作，大小与间距不代表频率；原稿未提供混合动作的数值比例。') : t('Frequencies apply only after this hand reaches the selected node. Thin or unclear source bars remain missing.', '频率仅表示该手牌已到达当前节点后的决策。原图色条过细或不清楚时保留为缺失。')}</p>
            <p>{t('Historical reach is unknown, so no overall action percentage is calculated. Hatched cells do not mean Fold or proven zero reach.', '历史到达权重未知，因此不计算节点整体动作比例。斜纹格不代表 Fold，也不证明到达率严格为零。')}</p>
          </> : kind === 'vs-3bet' || kind === 'vs-4bet' ? <p>{t('No reviewed continuation data for this matchup. Other table sizes or action lines are not substituted.', '该对局暂无已核验的后续加注数据，不使用其他人数或行动线代替。')}</p> : <>
            <p>{t('Recomputed from the simplified cells, weighted by 1,326 combinations.', '依据简化后的格子，按 1,326 种组合重新计算。')}</p>
            <div className="tree-action-legend">{actions.map(action => <span key={action.id}><i style={{ background: action.color }}/>{action.label}<b>{node && !isContinuation(node) ? `${(node.derivedRangeSummary[action.id as 'raise' | 'call' | 'fold'] * 100).toFixed(1)}%` : '—'}</b></span>)}</div>
            <p>{t('The printed PDF aggregate can differ from these rounded-cell totals.', '原 PDF 印刷的总体比例可能与简化格子的汇总不同。')}</p>
          </>}
        </div>
      </section>
      <aside className="panel">
        <div className="panel-heading"><h2>{graphical ? t('Published actions', '原图动作') : t('Hand frequencies', '手牌频率')}</h2><span className="matrix-count">{node ? graphical ? '% UNKNOWN' : '0 / 50 / 100' : '—'}</span></div>
        <div className="tree-hand">
          <label>{t('Your hand', '你的手牌')}<input aria-label="Published chart hand" value={query} onChange={event => setQuery(event.target.value)} placeholder="AKs, AKo, QQ"/></label>
          <strong className="tree-hand-title">{hand ?? '—'}</strong>
          {!hand && <p className="input-error">{t('Specify suited or offsuit, or enter two cards.', '请注明同花／非同花，或输入两张具体牌。')}</p>}
          <div className="tree-hand-frequencies">{actions.map(action => <div key={action.id}><span style={{ borderLeftColor: action.color }}>{action.label}</span><strong>{row?.status === 'available' ? `${row.frequencies[action.id] * 100}%` : row?.status === 'actions-only' && row.actions.includes(action.id) ? t('Shown', '原图可见') : '—'}</strong></div>)}</div>
          {row?.status === 'missing' && <p className="published-hand-note" role="status">{row.reason === 'not-shown' ? t('This hand is not represented clearly in the source. No Fold or zero-reach assumption is made.', '原图未清楚表示这手牌，不能据此建议 Fold 或判定到达率为零。') : t('The source bar is too thin or ambiguous to transcribe reliably.', '原图色条过细或有歧义，无法可靠转录。')}</p>}
          {row?.status === 'actions-only' && <p className="published-hand-note" role="status">{row.actions.length > 1 ? t('Mixed actions are visible; their percentages are not published numerically.', '原图显示混合动作，但未提供逐手数字比例。') : t('The chart shows one action. This is graphical evidence, not a claim of an exact 100% solver frequency.', '原图显示单一动作；这不等于断言原始求解频率恰好为 100%。')}</p>}
          {!graphical && <p className="tree-muted">{t('Published, simplified frequencies. No interpolation or invented decimals.', '出版图表中的简化频率，不插值、不补造小数精度。')}</p>}
          {node && !isContinuation(node) && node.callMeaning === 'SB completion / limp' && <p className="tree-muted">{t('Limp means SB completes from 0.5 to 1 BB; it is not Call Open.', 'Limp 指 SB 从 0.5 BB 补到 1 BB，不是 Call Open。')}</p>}
        </div>
      </aside>
    </div>
    {error && <p className="tree-error" role="alert">{error}</p>}
  </div>;
}
