import { useEffect, useRef, useState } from 'react';
import { HANDS, normalizeHand } from './lib/poker';
import { startLocalEquityCalculation } from './lib/local-equity-client';
import type { LocalEquityProgress, LocalEquityRequest } from './lib/local-equity';

type Translate = (en: string, zh: string) => string;
export default function LocalCalculation({ t, context, opponents, hand = 'AKs' }: {
  t: Translate; context: string; opponents: number; hand?: string;
}) {
  const [model, setModel] = useState('random');
  const [samples, setSamples] = useState(5000);
  const [progress, setProgress] = useState<LocalEquityProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [selectedHand, setSelectedHand] = useState(hand);
  const job = useRef<{ cancel(): void } | null>(null);
  const savedRequest = useRef<LocalEquityRequest | null>(null);
  const key = JSON.stringify([context, opponents, model, samples]);
  useEffect(() => {
    job.current?.cancel(); job.current = null;
    setProgress(null); setRunning(false); setError(''); savedRequest.current = null;
    return () => { job.current?.cancel(); job.current = null; };
  }, [key]);
  useEffect(() => { setSelectedHand(hand); }, [hand]);
  const normalized = normalizeHand(selectedHand);
  const result = progress?.results.find(result => result.hand === normalized);
  function run(all: boolean) {
    job.current?.cancel(); setError(''); setProgress(null);
    const request: LocalEquityRequest = {
      opponents: Array.from({ length: opponents }, () => model === 'random' ? { kind: 'random' as const } : { kind: 'heuristic' as const, topPercent: Number(model) }),
      hands: all ? HANDS : normalized ? [normalized] : [], samplesPerHand: samples, seed: 20261002,
    };
    savedRequest.current = request;
    try {
      setRunning(true);
      job.current = startLocalEquityCalculation(request, {
        onProgress: setProgress,
        onComplete: value => { setProgress(value); setRunning(false); job.current = null; },
        onError: message => { setError(message); setRunning(false); job.current = null; },
      });
    } catch (error) { setError(error instanceof Error ? error.message : 'Calculation failed.'); setRunning(false); }
  }
  function exportResult() {
    if (!progress) return;
    const blob = new Blob([JSON.stringify({ kind: 'showdown-equity-estimate', context, request: savedRequest.current, ...progress,
      limitations: ['Not GTO or action frequencies.', 'All modeled opponents reach showdown without folding or future betting.', 'No history inference, folded-card bunching, rake, side-pot EV or realization model.', 'Per-hand sampling interval excludes model error.'],
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'local-showdown-equity.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <details className="local-calculation"><summary>{t('Calculate locally · showdown equity', '本机计算 · 摊牌胜率')} <span>ESTIMATE</span></summary>
    <div className="local-calculation-body">
      <p>{t(`Model ${opponents} live opponent(s), all going to showdown. This computes pot share, not Raise/Call/Fold frequencies. Opponent ranges are assumptions, not inferred from prior actions.`, `模型包含 ${opponents} 位未弃牌对手，并假设所有人一直到摊牌。计算的是底池份额，不是 Raise／Call／Fold 频率；对手范围是显式假设，不从先前行动自动推断。`)}</p>
      <div className="calculation-fields">
        <label>{t('Opponent model (all seats)', '对手模型（所有对手）')}<select value={model} onChange={event => setModel(event.target.value)}><option value="random">{t('Uniform random hands', '均匀随机手牌')}</option>{[10,20,40].map(percent => <option key={percent} value={percent}>{t(`Heuristic top ${percent}%`, `启发式前 ${percent}% 范围`)}</option>)}</select></label>
        <label>{t('Samples per hand', '每手样本数')}<select value={samples} onChange={event => setSamples(Number(event.target.value))}>{[1000,5000,20000,100000].map(count => <option key={count} value={count}>{count.toLocaleString()}</option>)}</select></label>
        <label>{t('Inspect hand', '查看手牌')}<input aria-label="Local calculation hand" value={selectedHand} onChange={event => setSelectedHand(event.target.value)}/></label>
      </div>
      <div className="calculation-buttons"><button className="secondary-button" disabled={running || !normalized || opponents < 1 || opponents > 8} onClick={() => run(false)}>{t('Calculate this hand', '计算此手牌')}</button><button className="secondary-button" disabled={running || opponents < 1 || opponents > 8} onClick={() => run(true)}>{t('Calculate all 169', '计算全部 169 类')}</button>{running && <button className="text-button" onClick={() => { job.current?.cancel(); job.current = null; setRunning(false); }}>{t('Stop', '停止')}</button>}{progress && <button className="text-button" onClick={exportResult}>{t('Export results', '导出结果')}</button>}</div>
      <p role="status">{running ? `${t('Computing', '计算中')} ${progress?.completedHands ?? 0}/${progress?.totalHands ?? '…'} · ${progress?.currentHand ?? ''}` : progress ? `${progress.completedHands}/${progress.totalHands} ${progress.done ? t('complete', '已完成') : t('partial results', '部分结果')}` : t('Runs in a background worker. Changes to the scenario clear previous results.', '后台计算，不阻塞页面；场景变化时清空旧结果。')}</p>
      {result && <div className="calculation-result"><strong>{result.hand} · {(result.equity * 100).toFixed(1)}%</strong><span>{t('95% sampling interval', '95% 采样区间')}: {(result.confidence95[0] * 100).toFixed(1)}–{(result.confidence95[1] * 100).toFixed(1)}% · n={result.samples.toLocaleString()}</span></div>}
      {progress && progress.totalHands > 1 && <div className="hand-matrix equity-matrix" aria-label="Local equity matrix">{HANDS.map(cell => {
        const row = progress.results.find(item => item.hand === cell);
        return <button key={cell} className={`hand-cell ${normalized === cell ? 'selected-hand' : ''}`} style={{ background: row ? `hsl(100 32% ${96-row.equity*48}%)` : '#f0f2ed' }} onClick={() => setSelectedHand(cell)} aria-label={`${cell}: ${row ? `${(row.equity*100).toFixed(1)}% equity` : 'pending'}`}>{cell}</button>;
      })}</div>}
      <p className="tree-muted">{t('No future betting, folds, rake, equity realization, side-pot EV, or information from folded players. More samples reduce sampling error, not model error. Fixed seed: 20261002.', '未建模未来下注、弃牌、抽水、胜率兑现、边池 EV 或已弃牌玩家的信息。增加样本只降低采样误差，不能降低模型误差。固定种子：20261002。')}</p>
      {error && <p className="input-error" role="alert">{error}</p>}
    </div>
  </details>;
}
