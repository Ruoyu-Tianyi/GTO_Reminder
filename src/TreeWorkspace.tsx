import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Database, GitBranch, RotateCcw, Undo2, Upload } from 'lucide-react';
import { HANDS, getPositions, normalizeHand } from './lib/poker';
import { replayPreflop, type PreflopAction, type PreflopState } from './lib/preflop';
import { LINE_PRESETS, buildPreset, type LinePreset } from './lib/preflop-presets';
import { createTreeTemplate, findTreeNode, treeRangeSummary, validateTreeDataset, type StrategyChoice, type TreeDataset, type TreeGame } from './lib/tree-strategy';
import './tree.css';
import { findHistoryReferences } from './lib/tree-references';

type Translate = (en: string, zh: string) => string;
const INITIAL_GAME: TreeGame = { players: 6, stackBb: 100, anteBb: 0, format: 'cash', rake: '5% · 3 BB cap' };
const PALETTE = ['#a8d896', '#69b799', '#edc481', '#bcafd7', '#9bb1e9'];
const choiceLabel = (action: Pick<PreflopAction, 'type' | 'amountBb'>) => action.type === 'raise' ? `Raise ${action.amountBb} BB` : action.type[0].toUpperCase() + action.type.slice(1);
const frequency = (value: number) => `${(value * 100).toFixed(1)}%`;
const actionColor = (action: StrategyChoice, index: number) => action.type === 'fold' ? '#e5e9df' : action.type === 'call' || action.type === 'check' ? '#94c5e7' : PALETTE[index % PALETTE.length];

function saveJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TreeWorkspace({ t, onReference }: { t: Translate; onReference: (id: string, page: number) => void }) {
  const [game, setGame] = useState<TreeGame>(INITIAL_GAME);
  const [history, setHistory] = useState<PreflopAction[]>(() => buildPreset(INITIAL_GAME, 'unopened'));
  const [raiseTo, setRaiseTo] = useState('2.5');
  const [query, setQuery] = useState('AKs');
  const [datasets, setDatasets] = useState<TreeDataset[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [unequal, setUnequal] = useState(false);
  const [preset, setPreset] = useState<LinePreset>('unopened');
  const fileInput = useRef<HTMLInputElement>(null);
  let state: PreflopState | undefined;
  let stateError = '';
  try { state = replayPreflop(game, history); } catch (error) { stateError = error instanceof Error ? error.message : 'Invalid action history'; }
  const dataset = datasets.find(item => item.id === selectedId);
  const node = dataset && state ? findTreeNode(dataset, game, history) : undefined;
  const summary = node ? treeRangeSummary(node) : null;
  const references = state ? findHistoryReferences(game, history) : [];
  const hand = normalizeHand(query);
  const handData = hand ? node?.hands[hand] : undefined;
  const positions = getPositions(game.players);
  const nextSeat = state?.seats.find(seat => seat.position === state.nextActor);
  const actualStacks = positions.map(position => game.stacksBb?.[position] ?? game.stackBb);
  const stackLabel = new Set(actualStacks).size === 1 ? actualStacks[0] + ' BB' : t('Mixed stacks', '不同后手');
  const knownHands = node ? Object.values(node.hands).filter(row => row.status === 'available').length : 0;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const controller = new AbortController();
    fetch('/api/local-datasets', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Local data could not be loaded.');
      const result = await response.json() as { treeDatasets?: unknown[]; errors?: string[] };
      const files = (result.treeDatasets ?? []).map(validateTreeDataset);
      setDatasets(current => [...current, ...files.filter(file => !current.some(existing => existing.id === file.id))]);
      setLoadErrors(result.errors ?? []);
    }).catch(error => { if (!controller.signal.aborted) setLoadErrors([error instanceof Error ? error.message : 'Local data unavailable']); });
    return () => controller.abort();
  }, []);

  function changeGame(patch: Partial<TreeGame>) {
    setGame(current => ({ ...current, ...patch })); setHistory([]); setError(''); setMessage('');
  }
  function append(type: PreflopAction['type'], amountBb?: number) {
    if (!state?.nextActor) return;
    try {
      const action: PreflopAction = { actor: state.nextActor, type, ...(amountBb === undefined ? {} : { amountBb }) };
      replayPreflop(game, [...history, action]); setHistory([...history, action]); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid action'); }
  }
  function usePreset(id: LinePreset) {
    setPreset(id);
    try { setHistory(buildPreset(game, id)); setError(''); } catch (error) { setError(error instanceof Error ? error.message : 'This line is unavailable with these stacks.'); }
  }
  function selectDataset(id: string) {
    const incoming = datasets.find(item => item.id === id); setSelectedId(id);
    if (incoming) { setGame(incoming.game); setHistory(incoming.nodes[0].history); setUnequal(Boolean(incoming.game.stacksBb)); setError(''); }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Use a file smaller than 20 MB.');
      const incoming = validateTreeDataset(JSON.parse(await file.text()));
      setDatasets(current => [...current.filter(item => item.id !== incoming.id), incoming]);
      setSelectedId(incoming.id); setGame(incoming.game); setHistory(incoming.nodes[0].history); setUnequal(Boolean(incoming.game.stacksBb));
      setMessage(t(`Loaded ${incoming.nodes.length} decisions. This upload lasts until refresh.`, `已载入 ${incoming.nodes.length} 个决策节点。本次上传在刷新后清空。`)); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid strategy file'); }
    if (fileInput.current) fileInput.current.value = '';
  }

  return <div className="tree-workspace">
    <div className="tree-intro"><GitBranch size={21}/><div><strong>{t('Build the full preflop action history', '构建完整翻前行动历史')}</strong><p>{t('6–9 players · Cash · 100 BB first. Record real actions; strategy requires matching source data.', '6–9 人 · Cash · 优先 100 BB。记录实际行动，策略必须来自匹配条件的数据。')}</p></div><span>{t('RULES ≠ STRATEGY', '规则支持 ≠ 策略覆盖')}</span></div>
    <div className="tree-layout">
      <section className="panel tree-builder">
        <div className="panel-heading"><h2>{t('Table & action history', '牌桌与行动历史')}</h2><button className="icon-button" aria-label="Reset action history" onClick={() => { setHistory([]); setError(''); }}><RotateCcw size={16}/></button></div>
        <div className="tree-setup">
          <div className="two-fields"><label>{t('Players', '人数')}<select value={game.players} onChange={event => changeGame({ players: Number(event.target.value), stacksBb: undefined })}>{[6,7,8,9].map(count => <option key={count} value={count}>{count}-max</option>)}</select></label><label>{t('Starting stack (BB)', '起始后手（BB）')}<input type="number" min="1" step="1" value={game.stackBb} onChange={event => changeGame({ stackBb: Number(event.target.value), stacksBb: undefined })}/></label></div>
          <details className="tree-assumptions"><summary>{t('Rake, ante & individual stacks', '抽水、前注与各座位后手')}</summary><label>Rake profile<input value={game.rake} onChange={event => changeGame({ rake: event.target.value })}/></label><label>Ante (BB / player)<input type="number" min="0" step="0.1" value={game.anteBb} onChange={event => changeGame({ anteBb: Number(event.target.value) })}/></label><label className="tree-checkbox"><input type="checkbox" checked={unequal} onChange={event => { setUnequal(event.target.checked); changeGame({ stacksBb: undefined }); }}/>{t('Individual starting stacks', '分别设置起始后手')}</label>{unequal && <div className="tree-seat-inputs">{positions.map(position => <label key={position}>{position}<input aria-label={`${position} starting stack`} type="number" min="1" value={game.stacksBb?.[position] ?? game.stackBb} onChange={event => changeGame({ stacksBb: { ...game.stacksBb, [position]: Number(event.target.value) } })}/></label>)}</div>}<p>{t('Changing table conditions starts a new history. Standard 0.5 / 1 BB blinds; no straddle or BB ante.', '修改牌局条件会重置行动历史。使用 0.5／1 BB 盲注，暂不支持 Straddle 或 BB Ante。')}</p></details>
          <div className="tree-seats">{positions.map(position => {
            const seat = state?.seats.find(seat => seat.position === position);
            return <div key={position} className={`${state?.nextActor === position ? 'acting' : ''} ${seat?.folded ? 'folded' : ''}`}><strong>{position}</strong><span>{seat?.folded ? 'Fold' : seat?.allIn ? 'All-in' : `${seat?.remainingBb ?? game.stackBb} BB`}</span></div>;
          })}</div>
          <label>{t('Example action lines', '示例行动线')}<select value={preset} onChange={event => usePreset(event.target.value as LinePreset)}>{LINE_PRESETS.map(item => <option key={item.id} value={item.id}>{t(item.en, item.zh)}</option>)}</select></label><p className="tree-muted">{t('Examples contain actions only, not recommended play.', '示例仅用于构建场景，不代表推荐打法。')}</p>
        </div>
        <div className="tree-history"><div><h3>{t('Actions in order', '按顺序记录行动')}</h3><button className="text-button" disabled={!history.length} onClick={() => { setHistory(history.slice(0, -1)); setError(''); }}><Undo2 size={13}/>{t('Undo', '撤销')}</button></div>{history.length ? <ol>{history.map((item, index) => <li key={index}><span>{index + 1}</span><strong>{item.actor}</strong><em>{choiceLabel(item)}</em></li>)}</ol> : <p className="tree-muted">{t('Blinds posted. The first player acts next.', '盲注已投入，由第一个位置开始行动。')}</p>}</div>
        <div className="tree-actions" aria-live="polite"><h3>{state?.nextActor ? `${state.nextActor} ${t('to act', '行动')}` : state ? t('Preflop complete', '翻前结束') : t('Check table settings', '请检查牌局设置')}</h3><div className="tree-pot"><span>{t('Pot', '底池')} <b>{state?.potBb ?? '—'} BB</b></span><span>{t('To call', '需跟注')} <b>{state?.legal.callAmountBb ?? '—'} BB</b></span></div>{state?.nextActor && <><div className="tree-action-buttons"><button disabled={!state.legal.fold} onClick={() => append('fold')}>Fold</button><button disabled={!state.legal.check} onClick={() => append('check')}>Check</button><button disabled={!state.legal.call} onClick={() => append('call')}>{state.legal.call && state.legal.callAmountBb === nextSeat?.remainingBb ? 'Call All-in' : 'Call'}</button></div><div className="tree-raise"><label>{t('Raise to (total BB)', 'Raise 至（累计 BB）')}<input aria-label="Raise to total BB" type="number" min={state.legal.minRaiseToBb} max={state.legal.maxRaiseToBb} step="0.1" value={raiseTo} onChange={event => setRaiseTo(event.target.value)}/></label><button className="primary-button" disabled={!state.legal.raise} onClick={() => append('raise', Number(raiseTo))}>Raise</button></div><div className="tree-sizing-buttons"><button disabled={!state.legal.raise} onClick={() => setRaiseTo(String(state!.legal.minRaiseToBb))}>{t('Minimum', '最小加注')} {state.legal.minRaiseToBb}</button><button disabled={!state.legal.raise} onClick={() => append('raise', state!.legal.maxRaiseToBb)}>All-in {state.legal.maxRaiseToBb} BB</button></div>{!state.legal.raise && <p className="tree-muted">{t('No legal Raise: check the remaining stacks and whether betting reopened.', '当前不能 Raise：需满足剩余后手及重新开放加注的规则。')}</p>}</>}{state?.terminal && <p className="tree-muted">{state.terminal === 'uncontested' ? t('Only one player remains. The unmatched bet is returned.', '只剩一位玩家，未被跟注的筹码退回。') : state.terminal === 'all-in' ? t('All-in action is settled. No further preflop decision.', '全下行动已完成，没有更多翻前决策。') : t('The betting round is complete. Continue on the flop.', '本轮下注结束，进入翻牌。')}</p>}</div>
      </section>

      <section className="panel tree-range"><div className="panel-heading"><h2>{t('Strategy for this exact history', '完整历史对应的策略')}</h2><span className="matrix-count">169</span></div><div className="range-context"><div><h3>{state?.nextActor ?? (state ? t('Preflop complete', '翻前结束') : t('Check table settings', '请检查牌局设置'))}</h3><span>{game.players}-max · Cash · {stackLabel}</span></div><span className={`status-pill ${node ? '' : 'unavailable'}`}>{node ? dataset?.source.kind === 'demo' ? 'DEMO' : 'IMPORTED' : 'NO DATA'}</span></div>
        <div className="matrix-wrapper"><div className="hand-matrix" aria-label="Full history strategy matrix">{HANDS.map(cell => {
          const row = node?.hands[cell]; let background = 'repeating-linear-gradient(135deg,#f6f7f4 0px,#f6f7f4 5px,#e2e7dc 5px,#e2e7dc 6px)';
          if (row?.status === 'available') { let offset = 0; const stops = node!.actions.map((action, index) => { const start = offset; offset += row.frequencies[action.id] * 100; return `${actionColor(action, index)} ${start}% ${offset}%`; }); background = `linear-gradient(90deg, ${stops.join(',')})`; }
          return <button key={cell} style={{ background }} onClick={() => setQuery(cell)} className={`hand-cell ${hand === cell ? 'selected-hand' : ''} ${row?.status === 'unreachable' ? 'unreachable-hand' : ''}`} aria-label={`${cell}: ${row?.status ?? 'missing'}`} aria-pressed={hand === cell}>{cell}</button>;
        })}</div></div><p className="tree-matrix-caption">{t('Hatched: missing data. Crossed out: zero reach. Solid grey: Fold.', '斜纹表示缺少数据；划线表示不可达；纯灰色表示 Fold。')}</p>
        {node ? <div className="tree-node-summary"><p>{knownHands}/169 {t('hands have frequencies', '类手牌有频率')} · {dataset?.source.name}</p><div className="tree-action-legend">{node.actions.map((action, index) => <span key={action.id}><i style={{ background: actionColor(action, index) }}/>{choiceLabel(action)} <b>{summary ? frequency(summary[action.id]) : '—'}</b></span>)}</div><p>{summary ? t('Weighted by combination count × historical reach.', '按组合数 × 历史到达权重汇总。') : t('No range-wide summary when any hand is missing or all reach is zero.', '存在缺失手牌或全部不可达时，不展示全范围汇总。')}</p></div> : <div className="tree-empty"><Database size={27}/><h3>{state?.terminal ? t('No further preflop action', '没有后续翻前行动') : t('No matching strategy dataset', '没有匹配的策略数据')}</h3><p>{t('Legal actions are available on the left. Frequencies require the same seats, stacks, rake, ante and complete action sequence in a source dataset.', '左侧可以记录合法行动。频率需要数据同时匹配人数、各座位后手、抽水、前注及完整行动序列。')}</p></div>}
        {references.length > 0 && <div className="tree-related"><h3>{t('Related published charts', '对应行动线的出版图表')}</h3>{references.map(item => <div key={`${item.reference.id}-${item.page}`}><button className="text-button" onClick={() => onReference(item.reference.id, item.page)}>{item.reference.provider} · {item.reference.players}-max · {t('page', '第')} {item.page}<ArrowUpRight size={14}/></button><p>{item.note}</p></div>)}<p>{t('Position and action-line references only. Check the source bet sizes, rake and ante; these are not exact strategy matches.', '仅匹配位置与行动线。须核对原图下注尺寸、抽水和前注，不等于精确策略匹配。')}</p></div>}
        <div className="tree-scope"><strong>{t('Decision support in this version', '本版决策流程支持')}</strong><p>Open · Limp · Complete · Check · Cold Call · Squeeze · 3/4/5-Bet · All-in</p><small>{t('Rules and data format supported. This list is not a claim that solved ranges exist for every branch.', '已支持这些规则和数据表达，不代表每个分支已有求解范围。')}</small></div>
      </section>

      <aside className="panel tree-data"><div className="panel-heading"><h2>{t('Hand & data', '手牌与数据')}</h2><Database size={17}/></div><div className="tree-hand"><label>{t('Your hand', '你的手牌')}<input aria-label="Action builder hand" value={query} onChange={event => setQuery(event.target.value)} placeholder="AKs, QQ, As Kh"/></label><strong className="tree-hand-title">{hand ?? '—'}</strong>{!hand && <p className="input-error">{t('Enter AKs, AKo, QQ, or two different cards.', '请输入 AKs、AKo、QQ，或两张不重复的牌。')}</p>}{handData?.status === 'available' && node ? <><div className="tree-hand-frequencies">{node.actions.map((action, index) => <div key={action.id}><span style={{ borderLeftColor: actionColor(action, index) }}>{choiceLabel(action)}</span><strong>{frequency(handData.frequencies[action.id])}</strong></div>)}</div><p className="tree-muted">Reach: {frequency(handData.reach)} · {t('conditional frequencies', '节点内条件频率')}</p></> : <p className="tree-muted">{handData?.status === 'unreachable' ? t('This hand cannot reach the selected node under the imported strategy.', '按导入策略，该手牌无法到达当前节点。') : t('No sourced frequencies for this hand and history.', '当前手牌及行动历史没有可用的来源频率。')}</p>}</div>
        <div className="tree-library"><h3>{t('Action-history datasets', '完整历史数据集')}</h3><label>{t('Active dataset', '当前数据集')}<select value={selectedId} onChange={event => selectDataset(event.target.value)}><option value="">{t('Select a source dataset', '选择来源数据集')}</option>{datasets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{dataset && <><label>{t('Available decision nodes', '已有决策节点')}<select value={node?.id ?? ''} onChange={event => { const chosen = dataset.nodes.find(node => node.id === event.target.value); if (chosen) { setGame(dataset.game); setHistory(chosen.history); setUnequal(Boolean(dataset.game.stacksBb)); setError(''); } }}><option value="">{t('Choose a decision', '选择决策节点')}</option>{dataset.nodes.map(node => <option key={node.id} value={node.id}>{node.id} · {node.history.length} actions</option>)}</select></label><p className="tree-muted">{dataset.source.precision}</p><p className="tree-muted">{dataset.source.license}</p><a href={dataset.source.url} target="_blank" rel="noreferrer">{t('Original source', '原始来源')}<ArrowUpRight size={13}/></a><p className="tree-muted">{t('Imported metadata is not independent verification.', '导入声明不等于独立验证。')}</p></>}
          <button className="primary-button" onClick={() => fileInput.current?.click()}><Upload size={15}/>{t('Import tree JSON', '导入行动树 JSON')}</button><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => void importFile(event.target.files?.[0])}/><button className="text-button" disabled={!state?.nextActor} onClick={() => { try { saveJson(createTreeTemplate(game, history), 'gto-action-tree-template.json'); } catch (error) { setError(error instanceof Error ? error.message : 'Cannot export this decision'); } }}><ArrowDownToLine size={14}/>{t('Empty template for this decision', '下载当前节点的空白模板')}</button><p className="tree-muted">{t('No synthetic frequencies included. For reuse after refresh, save validated tree JSON in data/private.', '模板不附带虚构频率。如需刷新后复用，将行动树 JSON 放入 data/private。')}</p><p className="tree-muted">{t('Legacy range files remain available under Quick lookup.', '旧版范围文件继续在 Quick lookup 中使用。')}</p>
        </div>
      </aside>
    </div>
    {(stateError || error) && <p className="tree-error" role="alert">{stateError || error}</p>}
    {message && <p className="tree-message" role="status">{message}</p>}
    {loadErrors.length > 0 && <details className="tree-load-errors"><summary>{t('Local data loading issues', '本地数据载入问题')}</summary>{loadErrors.map((error, index) => <p key={index}>{error}</p>)}</details>}
  </div>;
}
