import { strategyFetch } from './lib/strategy-data-client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Info } from 'lucide-react';
import { HANDS, comboCount, getPositions, normalizeHand, type Position } from './lib/poker';
import type { PublishedChartsResponse } from './lib/published-charts';
import { referenceVillains, type ReferenceKind, type ReferenceRange, type ReferenceRangesResponse } from './lib/reference-ranges';
import { displayPublishedChart, REFERENCE_KIND_LABELS } from './lib/display-ranges';
import LocalCalculation from './LocalCalculation';
import type { StudyQuery } from './lib/study-session';
import { bindStudyReference, matchesStudyReference } from './lib/study-bindings';
import { MISSING_HAND_BACKGROUND, strategyActionColor } from './lib/strategy-colors';

type Translate = (en: string, zh: string) => string;

export type ReferenceSelection = Pick<ReferenceRange, 'players' | 'kind' | 'hero' | 'villain'>;

export default function PublishedCharts({ t, onReference, initialSelection, initialStudy, onSave }: { t: Translate; onReference: (id: string, page: number) => void; initialSelection?: ReferenceSelection; initialStudy?: Extract<StudyQuery, {view: 'reference'}>; onSave: (query: StudyQuery, label: string) => void }) {
  const [nodes, setNodes] = useState<ReferenceRange[]>([]);
  const [players, setPlayers] = useState(initialSelection?.players ?? 8);
  const [kind, setKind] = useState<ReferenceKind>(initialSelection?.kind ?? 'rfi');
  const [selectedHero, setHero] = useState<Position>(initialSelection?.hero ?? 'BTN');
  const [selectedVillain, setVillain] = useState<Position>(initialSelection?.villain ?? 'UTG');
  const [query, setQuery] = useState(initialStudy?.hand ?? 'AKs');
  const [expectedSource, setExpectedSource] = useState(initialStudy ? initialStudy.binding : undefined);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const heroes = getPositions(players).filter(position => kind === 'rfi' ? position !== 'BB' : referenceVillains(players, position, kind).length > 0);
  const hero = heroes.includes(selectedHero) ? selectedHero : heroes[0];
  const villains = referenceVillains(players, hero, kind);
  const villain = kind === 'rfi' ? null : villains.includes(selectedVillain) ? selectedVillain : villains[0];
  const candidate = nodes.find(item => item.players === players && item.kind === kind && item.hero === hero && item.villain === villain);
  const sourceMismatch = expectedSource !== undefined && (!expectedSource || !candidate || !matchesStudyReference(expectedSource, candidate));
  const node = sourceMismatch ? undefined : candidate;
  const hand = normalizeHand(query);
  const row = hand ? node?.hands[hand] : undefined;
  const actions = node?.actions ?? [];
  const referenceActionColor = (action: (typeof actions)[number], index: number) => strategyActionColor(action, actions.slice(0, index).filter(choice => choice.type === 'raise').length);
  const measured = node?.provenance === 'image-transcription';
  const estimated = node?.provenance === 'seat-projection';
  const available = node ? Object.values(node.hands).filter(row => row.status === 'available').length : 0;
  const title = `${hero}${villain ? ` vs ${villain}` : ''} · ${REFERENCE_KIND_LABELS[kind]}`;
  const sourceLabel = estimated ? 'ESTIMATED · 8 → 7' : measured ? 'IMAGE MEASURED' : node ? 'PUBLISHED · 50% STEPS' : 'NO DATA';
  const summary = node && available === 169 && (kind === 'rfi' || kind === 'vs-open' || kind === 'vs-limp')
    ? Object.fromEntries(actions.map(action => [action.id, HANDS.reduce((sum, hand) => {
      const item = node.hands[hand]; return sum + (item.status === 'available' ? item.frequencies[action.id] * comboCount(hand) / 1326 : 0);
    }, 0)])) : null;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const results = await Promise.allSettled([
        strategyFetch('/api/published-charts', { signal: controller.signal }).then(async response => {
          if (!response.ok) throw new Error('Published chart library could not be loaded.');
          const result = await response.json() as PublishedChartsResponse;
          return { nodes: result.nodes.map(displayPublishedChart), error: result.error };
        }),
        strategyFetch('/api/reference-ranges', { signal: controller.signal }).then(async response => {
          if (!response.ok) throw new Error('Extended reference library could not be loaded.');
          return await response.json() as ReferenceRangesResponse;
        }),
      ]);
      if (controller.signal.aborted) return;
      setNodes(results.flatMap(result => result.status === 'fulfilled' ? result.value.nodes : []));
      setErrors(results.flatMap(result => result.status === 'fulfilled' ? result.value.error ? [result.value.error] : [] : [String(result.reason)]));
      setLoading(false);
    }
    void load(); return () => controller.abort();
  }, []);

  return <div className="published-workspace">
    {sourceMismatch && !loading && <div className="study-toolbar"><p role="status">{t('Saved query restored. Its source is missing or has changed; no replacement frequencies are shown.', '已恢复收藏条件，原来源未载入或已更新，当前不展示替代频率。')}{candidate && <button className="text-button" onClick={() => setExpectedSource(undefined)}>{t('Use the current source', '改用当前来源')}</button>}</p></div>}
    <div className={`tree-intro published-intro ${players === 7 ? 'estimate-intro' : ''}`}><BookOpen size={21}/><div>
      <strong>{t('Reference ranges · Cash 100 BB', '翻前参考范围 · Cash 100 BB')}</strong>
      <p>{t('6/9-max · published charts. 8-max · image measured. 7-max · seat projection.', '6／9 人出版参考 · 8 人原图测量 · 7 人座位投影估算')}</p>
    </div><button className="secondary-button" disabled={!hand || loading} onClick={() => hand && onSave({ view: 'reference', selection: {players, kind, hero, villain}, hand, binding: node ? bindStudyReference(node) : expectedSource ?? null }, `${players}-max · ${title} · ${hand}`)}>{t('Save this spot', '收藏当前场景')}</button></div>
    <div className="tree-layout published-layout">
      <section className="panel">
        <div className="panel-heading"><h2>{t('Choose a reference', '选择参考范围')}</h2><BookOpen size={17}/></div>
        <div className="tree-setup">
          <div className="two-fields">
            <label>{t('Players', '人数')}<select aria-label="Published chart players" value={players} onChange={event => { setExpectedSource(undefined); setPlayers(Number(event.target.value)); }}>{[6,7,8,9].map(count => <option value={count} key={count}>{count}-max</option>)}</select></label>
            <label>{t('Situation', '场景')}<select aria-label="Published chart situation" value={kind} onChange={event => { setExpectedSource(undefined); setKind(event.target.value as ReferenceKind); }}>{Object.entries(REFERENCE_KIND_LABELS).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          </div>
          <div className="two-fields published-positions">
            <label>{t('Your position', '你的位置')}<select aria-label="Published chart position" value={hero} onChange={event => { setExpectedSource(undefined); setHero(event.target.value as Position); }}>{heroes.map(position => <option key={position}>{position}</option>)}</select></label>
            {kind !== 'rfi' && <label>{t('Opponent', '对手位置')}<select aria-label="Published chart opener" value={villain ?? ''} onChange={event => { setExpectedSource(undefined); setVillain(event.target.value as Position); }}>{villains.map(position => <option key={position}>{position}</option>)}</select></label>}
          </div>
          <div className="published-conditions" aria-live="polite"><span>Cash · 100 BB · {REFERENCE_KIND_LABELS[kind]}</span>
            <strong>{sourceLabel}</strong>
            {estimated && <p>{t('Seat projection, not a solved 7-max strategy. Removes 8-max UTG and maps UTG+1 to UTG; ignores the removed seat’s card information and strategic effect.', '座位投影估算，未重新求解 7 人策略：移除 8 人 UTG，UTG+1 改为 UTG；忽略移除座位的牌张信息和策略影响。')}</p>}
          </div>
        </div>
        <details className="published-source-details"><summary>{t('Source, precision & coverage', '来源、精度与覆盖')}</summary><div className="published-source-body">
          <p className="tree-muted">{t('6/9-max: published 50% steps. 8-max: measured chart bars. 7-max: explicitly estimated from 8-max seat order. Source precision and missing hands stay visible.', '6／9 人保留出版的 50% 粒度；8 人从原图色条测量；7 人由 8 人座位顺序投影估算。逐图标明精度与缺失手牌。')}</p>
          <p className="tree-muted">{t('Single-opponent lines only. No cold callers or squeeze. Match source bet sizes before using a reference.', '仅对应单一对手行动线，不含冷跟或 Squeeze；须核对原图下注尺寸。')}</p>
          <div className="published-availability" aria-label="Published numerical chart counts">{[6,7,8,9].map(count => <span key={count}><b>{count}-max</b><em>{nodes.filter(item => item.players === count && item.kind === kind).length} {count === 7 ? t('estimates', '张估算') : t('charts', '张图')}</em></span>)}</div>
          <p className="tree-muted">{t('Counts are charts, not fully solved nodes. Hatched hands remain unknown, even inside a loaded chart.', '数量是图表数，不是完整求解节点数；即使图表已载入，斜纹手牌仍表示未知。')}</p>
        <div className="tree-library"><h3>{t('Source & method', '来源与方法')}</h3>{node && <>
          <p className="tree-muted">{node.source.title} · {node.sourcePlayers}-max · PDF {node.page}</p>
          <button className="text-button" onClick={() => onReference(node.refId, node.page)}>{t('Compare original PDF', '对照原始 PDF')}<ArrowUpRight size={14}/></button>
          <a href={`${node.source.url}#page=${node.page}`} target="_blank" rel="noreferrer">{t('Official source', '官方来源')}<ArrowUpRight size={14}/></a>
          <p className="tree-muted">{node.precision}</p>
          <details className="tree-assumptions"><summary>{t('Chart notes', '图表说明')}</summary>{node.notes.map((note,index) => <p key={index}>{note}</p>)}</details>
        </>}<p className="tree-muted">{t('These references do not populate exact-history solver datasets. Rake, ante and historical reach may be unknown.', '参考图不写入完整历史的精确策略库；抽水、前注与历史到达权重可能未知。')}</p></div>
        </div></details>
      </section>
      <section className="panel tree-range">
        <div className="panel-heading"><h2>{title}</h2><span className={`status-pill ${estimated ? 'estimate-badge' : ''}`}>{sourceLabel}</span></div>
        <div className="published-matrix-legend">{actions.map((action,index) => <span key={action.id}><i style={{ background: referenceActionColor(action,index) }}/>{action.label}</span>)}</div>
        <div className="matrix-wrapper"><div className="hand-matrix" aria-label={`Published simplified range: ${title}`}>{HANDS.map(cell => {
          const item = node?.hands[cell]; let background = MISSING_HAND_BACKGROUND;
          if (item?.status === 'available') { let offset = 0; background = `linear-gradient(90deg,${actions.map((action,index) => { const start = offset; offset += item.frequencies[action.id] * 100; return `${referenceActionColor(action,index)} ${start}% ${offset}%`; }).join(',')})`; }
          return <button key={cell} className={`hand-cell ${hand === cell ? 'selected-hand' : ''}`} style={{ background }} onClick={() => setQuery(cell)} aria-pressed={hand === cell} aria-label={`${cell}: ${item?.status === 'available' ? actions.map(action => `${action.label} ${(item.frequencies[action.id] * 100).toFixed(1)}%`).join(', ') : item?.status ?? 'missing'}`}>{cell}</button>;
        })}</div></div>
        {!node && <div className="tree-empty"><Info size={24}/><h3>{loading ? t('Loading references…', '正在加载参考图…') : t('No numerical reference for this spot', '该场景暂无数值参考')}</h3><p>{t('A PDF or local simulation may still be available. Missing strategy is not a Fold recommendation.', '可继续查阅 PDF 或使用本地模拟；没有策略数据不等于建议 Fold。')}</p></div>}
        <div className="tree-node-summary"><p>{available}/169 {t('readable hands', '类手牌可读')} · {t('Hatched: not charted or unreadable; no zero-reach claim.', '斜纹：原图未显示或不可读，不断言严格零到达率。')}</p>
          {summary ? <><div className="tree-action-legend">{actions.map((action,index) => <span key={action.id}><i style={{ background: referenceActionColor(action,index) }}/>{action.label}<b>{(summary[action.id] * 100).toFixed(1)}%</b></span>)}</div><p>{t('Weighted over all 1,326 starting combinations, not the range reaching this node.', '按全部 1,326 个起手牌组合汇总，不是到达当前节点范围的行动比例。')}</p></> : <p>{t('No aggregate frequencies: historical reach or readable hands are incomplete.', '历史到达权重或可读手牌不完整，不展示整体行动比例。')}</p>}
        </div>
      </section>
      <aside className="panel"><div className="panel-heading"><h2>{t('Hand frequencies', '手牌频率')}</h2></div><div className="tree-hand">
        <label>{t('Your hand', '你的手牌')}<input aria-label="Published chart hand" value={query} onChange={event => setQuery(event.target.value)} placeholder="AKs, AKo, QQ"/></label>
        <strong className="tree-hand-title">{hand ?? '—'}</strong>
        {!hand && <p className="input-error">{t('Specify suited or offsuit, or enter two different cards.', '请注明同花／非同花，或输入两张不重复的牌。')}</p>}
        <div className="tree-hand-frequencies">{actions.map((action,index) => <div key={action.id}><span style={{ borderLeftColor: referenceActionColor(action,index) }}>{action.label}</span><strong>{row?.status === 'available' ? `${(row.frequencies[action.id] * 100).toFixed(measured || estimated ? 0 : 1)}%` : '—'}</strong><i className="tree-hand-track" aria-hidden="true"><b style={{ width: row?.status === 'available' ? String(row.frequencies[action.id] * 100) + '%' : '0%', background: referenceActionColor(action,index) }}/></i></div>)}</div>
        <p className="tree-muted">{estimated ? t('Approximation from a different table size; not a 7-max solve.', '从其他人数投影的近似值，并非 7 人求解结果。') : measured ? t('Measured from source image bars; image resolution limits precision.', '由原图色条宽度测量，精度受图片分辨率限制。') : t('Publisher-simplified frequencies.', '出版者简化后的频率。')}</p>
      </div></aside>
    </div>
    <details className="local-calculation"><summary>{t('Coverage of standard reference scenarios', '标准参考场景覆盖情况')}</summary><div className="local-calculation-body coverage-scroll"><p>{t('Counts below cover only 100 BB, single-opponent lines with the printed source sizes. They do not represent all game trees or all hand frequencies.', '以下只统计 100 BB、原图下注尺寸、单一对手行动线，不代表全部行动树或全部手牌频率。7 人列为投影估算。')}</p><table className="reference-coverage"><thead><tr><th>{t('Scenario', '场景')}</th>{[6,7,8,9].map(n => <th key={n}>{n}-max{n === 7 ? ' *' : ''}</th>)}</tr></thead><tbody>{Object.entries(REFERENCE_KIND_LABELS).map(([scenario,label]) => <tr key={scenario}><th>{label}</th>{[6,7,8,9].map(n => <td key={n}>{nodes.filter(node => node.players === n && node.kind === scenario).length} / {scenario === 'rfi' ? n-1 : scenario === 'vs-limp' ? 1 : n*(n-1)/2}</td>)}</tr>)}</tbody></table></div></details>
    <LocalCalculation key={`${players}:${kind}:${hero}:${villain}`} t={t} context={JSON.stringify({ players, kind, hero, villain, stackBb: 100 })} opponents={kind === 'rfi' ? getPositions(players).length - getPositions(players).indexOf(hero) - 1 : 1} hand={query}/>
    {errors.map((error,index) => <p key={index} className="tree-error" role="alert">{error}</p>)}
  </div>;
}
