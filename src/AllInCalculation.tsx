import { useEffect, useRef, useState } from 'react';
import { HANDS, normalizeHand } from './lib/poker';
import type { PreflopAction } from './lib/preflop';
import type { TreeGame } from './lib/tree-strategy';
import { startLocalEquityCalculation } from './lib/local-equity-client';
import { LOCAL_EQUITY_MODEL, type LocalEquityProgress, type LocalEquityRequest } from './lib/local-equity';
import {
  createAllInEquityRequest, evaluateAllInResponse, identifyAllInResponse,
  type AllInContext, type AllInOpponentAssumption, type AllInRake, type AllInResponse,
} from './lib/all-in-response';
import './all-in-calculation.css';

type Translate = (en: string, zh: string) => string;
interface Props { t: Translate; game: TreeGame; history: readonly PreflopAction[]; hand?: string }
interface CalculationSnapshot {
  game: TreeGame;
  history: PreflopAction[];
  opponent: AllInOpponentAssumption;
  rake: AllInRake;
  request: LocalEquityRequest;
}
interface CompletedCalculation { snapshot: CalculationSnapshot; equity: LocalEquityProgress; response: AllInResponse }
const SEED = 20261013;
const bb = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)} BB`;
const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;

/** A new history gets a new mounted panel, so an earlier worker cannot populate it. */
export default function AllInCalculation(props: Props) {
  const identified = identifyAllInResponse(props.game, props.history);
  if (!identified.available) return null;
  return <AllInPanel key={JSON.stringify([props.game, props.history])} {...props} context={identified.context} />;
}

function AllInPanel({ t, game, history, context, hand = 'AKs' }: Props & { context: AllInContext }) {
  const [opponentMode, setOpponentMode] = useState('10');
  const [customRange, setCustomRange] = useState('{"AA":1,"KK":1,"QQ":1,"AKs":1,"AKo":0.5}');
  const [rakeMode, setRakeMode] = useState('unknown');
  const [rakePercent, setRakePercent] = useState('5');
  const [rakeCap, setRakeCap] = useState('2.5');
  const [noFlopNoDrop, setNoFlopNoDrop] = useState(true);
  const [samples, setSamples] = useState(5000);
  const [selectedHand, setSelectedHand] = useState(hand);
  const [progress, setProgress] = useState<LocalEquityProgress | null>(null);
  const [completed, setCompleted] = useState<CompletedCalculation | null>(null);
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState('');
  const job = useRef<{ cancel(): void } | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const normalizedHand = normalizeHand(selectedHand);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; job.current?.cancel(); job.current = null; };
  }, []);
  // Selecting a hand inspects the current matrix; it does not change its opponent assumptions.
  useEffect(() => { setSelectedHand(hand); }, [hand]);

  function clearCalculation() {
    generation.current += 1;
    job.current?.cancel(); job.current = null;
    setProgress(null); setCompleted(null); setRunning(false); setStopped(false); setError('');
  }

  function assumption(): AllInOpponentAssumption {
    if (opponentMode === 'custom') {
      const weights: unknown = JSON.parse(customRange);
      if (!weights || typeof weights !== 'object' || Array.isArray(weights)) throw new Error(t('Range JSON must be an object keyed by hand class.', '范围 JSON 必须是以手牌类别为键的对象。'));
      return { label: 'User-assumed hand-class weights', model: { kind: 'range', weights: weights as Record<string, number> } };
    }
    if (opponentMode === 'random') return { label: 'Assumed uniformly random opponent cards', model: { kind: 'random' } };
    return { label: `Assumed heuristic top ${opponentMode}% range; not inferred from history`, model: { kind: 'heuristic', topPercent: Number(opponentMode) } };
  }

  function rakeAssumption(): AllInRake {
    if (rakeMode === 'unknown') return { status: 'unknown' };
    if (rakeMode === 'zero') return { status: 'known', percent: 0, capBb: 0, noFlopNoDrop: true };
    if (!rakePercent.trim() || !rakeCap.trim()) throw new Error(t('Enter both the rake percentage and cap.', '请填写抽水百分比和封顶金额。'));
    const percent = Number(rakePercent), capBb = Number(rakeCap);
    if (!Number.isFinite(percent) || percent < 0 || percent >= 100 || !Number.isFinite(capBb) || capBb < 0) {
      throw new Error(t('Rake must be 0–99.99%, with a nonnegative cap in BB.', '抽水必须为 0 至小于 100%，封顶金额须为非负 BB 数。'));
    }
    return { status: 'known', percent, capBb, noFlopNoDrop };
  }

  function run(all: boolean) {
    clearCalculation();
    const token = generation.current;
    const current = () => mounted.current && generation.current === token;
    try {
      const rake = rakeAssumption();
      if (rake.status === 'unknown') throw new Error(t('Choose an explicit rake rule before estimating EV.', '请先明确选择抽水规则，再估算 EV。'));
      if (!all && !normalizedHand) throw new Error(t('Enter a valid hand, such as AKs or QQ.', '请输入有效手牌，例如 AKs 或 QQ。'));
      const opponent = assumption();
      const request = createAllInEquityRequest(opponent, { hands: all ? HANDS : [normalizedHand!], samplesPerHand: samples, seed: SEED });
      // One immutable request envelope stays attached to all callbacks and the downloadable result.
      const snapshot: CalculationSnapshot = structuredClone({ game, history: [...history], opponent, rake, request });
      setRunning(true);
      setProgress({ model: LOCAL_EQUITY_MODEL, completedHands: 0, totalHands: request.hands!.length,
        currentHand: request.hands![0], currentHandSamples: 0, samplesPerHand: samples, results: [], done: false });
      const started = startLocalEquityCalculation(snapshot.request, {
        onProgress: value => { if (current()) setProgress(value); },
        onComplete: equity => {
          if (!current()) return;
          generation.current += 1;
          job.current = null; setRunning(false);
          try {
            const response = evaluateAllInResponse({ ...snapshot, equityRequest: snapshot.request, equity });
            if (!response.available) throw new Error(response.message);
            setProgress(equity); setCompleted({ snapshot, equity, response });
          } catch (problem) {
            setCompleted(null); setProgress(null);
            setError(problem instanceof Error ? problem.message : t('Calculation could not be verified.', '无法验证计算结果。'));
          }
        },
        onError: message => {
          if (!current()) return;
          generation.current += 1;
          job.current = null; setRunning(false); setProgress(null); setCompleted(null); setError(message);
        },
      });
      if (current()) job.current = started;
      else started.cancel();
    } catch (problem) {
      if (!current()) return;
      setRunning(false); setError(problem instanceof Error ? problem.message : t('Calculation failed.', '计算失败。'));
    }
  }

  function exportResult() {
    if (!completed) return;
    const { snapshot, equity, response } = completed;
    const payload = {
      schemaVersion: 1, kind: 'conditional-heads-up-all-in-ev', exportedAt: new Date().toISOString(),
      game: snapshot.game, history: snapshot.history, range: snapshot.opponent, rake: snapshot.rake,
      request: snapshot.request, equityResult: equity, result: response,
      limitations: [
        'Incremental Call EV relative to Fold under the stated opponent model; not GTO action frequencies.',
        'Opponent ranges are assumptions and are not inferred from prior actions or table size.',
        'Physical compatible hole cards and boards; heads-up ties split the pot equally.',
        'All betting ends after the call. No side pots or uncalled wager refunds are supported.',
        'Known percentage/cap rake applies to the called all-in pot, including with no-flop-no-drop.',
        '95% intervals cover per-hand sampling error only, not range/rake uncertainty or simultaneous 169-hand coverage.',
        'Conditioning on the unknown cards and ranges of folded players is ignored.',
      ],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `all-in-ev-${context.hero}-${context.villain}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const result = completed?.response.hands.find(row => row.hand === normalizedHand);
  const rows = new Map(completed?.response.hands.map(row => [row.hand, row]) ?? []);
  const signalLabel = (signal: 'call-favored' | 'fold-favored' | 'uncertain') => signal === 'call-favored'
    ? t('Call favored under assumptions', '假设下倾向跟注') : signal === 'fold-favored'
      ? t('Fold favored under assumptions', '假设下倾向弃牌') : t('Sampling interval crosses zero', '采样区间跨越零，暂不确定');

  return <details className="all-in-calculation">
    <summary>{t('All-in response · conditional EV', '全压应对 · 条件 EV 估算')} <span>{t('ASSUMPTIONS', '范围假设')}</span></summary>
    <div className="aic-body">
      <p>{t(`${context.hero} faces ${context.villain}'s all-in. Calling ends betting. This estimates Call EV versus folding under a stated opponent range, not GTO frequencies.`, `${context.hero} 面对 ${context.villain} 全压，跟注后下注结束。此处估算明确对手范围下跟注相对弃牌的 EV，不是 GTO 动作频率。`)}</p>
      <div className="aic-context"><span>{t('Pot before call', '跟注前底池')} <b>{context.potBeforeCallBb} BB</b></span><span>{t('Call cost', '还需跟注')} <b>{context.callBb} BB</b></span><span>{t('Pot after call', '跟注后底池')} <b>{context.potAfterCallBb} BB</b></span></div>
      <div className="aic-fields">
        <label>{t('Assumed opponent range', '假设对手范围')}<select value={opponentMode} onChange={event => { clearCalculation(); setOpponentMode(event.target.value); }}>
          <option value="random">{t('Uniformly random hands', '均匀随机手牌')}</option>
          {[10, 20, 40].map(value => <option key={value} value={value}>{t(`Heuristic top ${value}%`, `启发式前 ${value}%`)}</option>)}
          <option value="custom">{t('Custom hand-class weights', '自定义手牌权重')}</option>
        </select></label>
        <label>{t('Samples per hand', '每手样本数')}<select value={samples} onChange={event => { clearCalculation(); setSamples(Number(event.target.value)); }}>{[1000, 5000, 20000, 100000].map(value => <option key={value} value={value}>{value.toLocaleString()}</option>)}</select></label>
        <label>{t('Inspect hand', '查看手牌')}<input aria-label={t('All-in EV hand', '全压 EV 手牌')} value={selectedHand} maxLength={4} onChange={event => setSelectedHand(event.target.value)} placeholder="AKs" /></label>
      </div>
      {opponentMode === 'custom' && <label className="aic-custom">{t('JSON weights · omitted hands have zero weight', 'JSON 权重 · 未列出的手牌权重为零')}
        <textarea aria-label={t('Assumed range JSON', '假设范围 JSON')} value={customRange} spellCheck={false} onChange={event => { clearCalculation(); setCustomRange(event.target.value); }} />
        <small>{t('Use canonical labels (AA, AKs, AKo) and nonnegative numbers. These are relative per-combination weights, not action frequencies.', '使用 AA、AKs、AKo 等手牌标签和非负数。数值是每个具体组合的相对权重，不是动作频率。')}</small>
      </label>}
      <div className="aic-rake-fields">
        <label>{t('Explicit rake rule', '明确抽水规则')}<select value={rakeMode} onChange={event => { clearCalculation(); setRakeMode(event.target.value); }}>
          <option value="unknown">{t('Unknown · EV unavailable', '尚未确定 · 暂不计算 EV')}</option>
          <option value="zero">{t('No rake', '无抽水')}</option>
          <option value="percent">{t('Percentage with cap', '按比例抽水，有封顶')}</option>
        </select></label>
        {rakeMode === 'percent' && <>
          <label>{t('Rake %', '抽水 %')}<input aria-label={t('All-in rake percentage', '全压抽水百分比')} type="number" min="0" max="99.99" step="0.1" value={rakePercent} onChange={event => { clearCalculation(); setRakePercent(event.target.value); }} /></label>
          <label>{t('Cap (BB)', '封顶（BB）')}<input aria-label={t('All-in rake cap', '全压抽水封顶')} type="number" min="0" step="0.1" value={rakeCap} onChange={event => { clearCalculation(); setRakeCap(event.target.value); }} /></label>
        </>}
      </div>
      {rakeMode === 'percent' && <label className="aic-checkbox"><input type="checkbox" checked={noFlopNoDrop} onChange={event => { clearCalculation(); setNoFlopNoDrop(event.target.checked); }} />{t('No flop, no drop', '未见翻牌不抽水')}</label>}
      <p className="aic-note">{rakeMode === 'unknown' ? t('Choose the actual rake rule to enable EV. The table’s text label is never treated as a numeric contract.', '请明确抽水规则后再计算 EV；系统不会把牌桌文字说明自动解析为抽水参数。') : t('An all-in call runs out the board, so the stated rake still applies with no-flop-no-drop.', '跟注全压后会发出公共牌；即使规则为“未见翻牌不抽水”，该底池仍按所填规则抽水。')}</p>
      <div className="aic-buttons">
        <button type="button" disabled={running || rakeMode === 'unknown' || !normalizedHand} onClick={() => run(false)}>{t('Calculate this hand', '计算此手牌')}</button>
        <button type="button" disabled={running || rakeMode === 'unknown'} onClick={() => run(true)}>{t('Calculate all 169', '计算全部 169 类')}</button>
        {running && <button type="button" onClick={() => { clearCalculation(); setStopped(true); }}>{t('Stop calculation', '停止计算')}</button>}
        {completed && <button type="button" onClick={exportResult}>{t('Export this calculation', '导出本次计算')}</button>}
      </div>
      <p className="aic-status" role="status">{running
        ? `${t('Calculating in the background', '正在后台计算')} ${progress?.completedHands ?? 0}/${progress?.totalHands ?? '…'} · ${progress?.currentHand ?? ''}`
        : completed ? t(`${completed.response.hands.length} hands complete. Select a hand to inspect its EV.`, `已完成 ${completed.response.hands.length} 类手牌，可选择手牌查看 EV。`)
          : stopped ? t('Stopped. This run’s results were cleared.', '已停止，本次计算结果已清空。') : t('Changes to the history, range, samples or rake cancel the run and clear its results.', '历史、范围、样本数或抽水条件变化时，自动停止并清空旧结果。')}</p>
      {running && <progress aria-label={t('All-in calculation progress', '全压计算进度')} max={progress?.totalHands ?? (normalizedHand ? 1 : 169)} value={progress?.completedHands ?? 0} />}
      {result && completed && <section className={`aic-result aic-${result.signal}`} aria-label={t('Conditional all-in EV result', '条件全压 EV 结果')}>
        <div className="aic-result-heading"><strong>{result.hand}</strong><span>{signalLabel(result.signal)}</span></div>
        <div className="aic-result-values"><div><span>{t('Incremental Call EV', '跟注增量 EV')}</span><b>{bb(result.callEvBb)}</b></div><div><span>{t('Fold EV baseline', '弃牌 EV 基准')}</span><b>0.00 BB</b></div><div><span>{t('Showdown pot share', '摊牌底池份额')}</span><b>{percentage(result.equity)}</b></div></div>
        <p>{t('95% sampling interval', '95% 采样区间')} · EV {bb(result.callEvConfidence95Bb[0])} – {bb(result.callEvConfidence95Bb[1])} · {t('pot share', '底池份额')} {percentage(result.equityConfidence95[0])} – {percentage(result.equityConfidence95[1])}</p>
        <p>{t('Break-even share', '跟注盈亏平衡份额')} {percentage(completed.response.breakEvenEquity)} · {t('Rake', '抽水')} {completed.response.rake.amountBb.toFixed(2)} BB · n={result.samples.toLocaleString()}</p>
      </section>}
      {completed && !result && <p className="aic-note">{t('This run does not contain the selected hand. Select a calculated hand or start a new run.', '本次结果没有所选手牌。请选择已计算手牌，或发起新计算。')}</p>}
      {completed && completed.response.hands.length > 1 && <>
        <div className="aic-legend"><span className="aic-call-favored">{t('Call favored', '倾向跟注')}</span><span className="aic-fold-favored">{t('Fold favored', '倾向弃牌')}</span><span className="aic-uncertain">{t('Uncertain', '不确定')}</span><small>{t('Under the stated assumptions only', '仅针对所填假设')}</small></div>
        <div className="aic-matrix" aria-label={t('All-in conditional EV matrix', '全压条件 EV 矩阵')}>{HANDS.map(cell => {
          const row = rows.get(cell);
          return <button type="button" key={cell} className={`aic-cell ${row ? `aic-${row.signal}` : ''} ${normalizedHand === cell ? 'aic-selected' : ''}`} aria-pressed={normalizedHand === cell}
            aria-label={`${cell}: ${row ? `${bb(row.callEvBb)}; ${signalLabel(row.signal)}` : t('not calculated', '未计算')}`} title={row ? `${cell} · ${bb(row.callEvBb)}` : cell} onClick={() => setSelectedHand(cell)}>{cell}</button>;
        })}</div>
      </>}
      <p className="aic-note">{t('Ranges are assumptions, not inferred all-in ranges. Deals respect physical card conflicts; HU ties split the pot. Intervals cover sampling error per hand only and exclude range/rake uncertainty and unknown folded-card conditioning. More samples cannot correct a wrong range. Fixed seed: 20261013.', '对手范围是所填假设，不代表从全压动作推断出的真实范围。发牌排除实体牌冲突，单挑平局平分底池。区间仅覆盖每手采样误差，不含范围／抽水不确定性或未知弃牌分布的影响；增加样本无法修正错误范围。固定种子：20261013。')}</p>
      {error && <p className="aic-error" role="alert">{error}</p>}
    </div>
  </details>;
}
