import type { Dataset } from './lib/poker';
export default function ComputationNotice({ source, t }: { source: Dataset['source']; t: (en: string, zh: string) => string }) {
  if (source.kind !== 'computed' || !source.computation) return null;
  const computation = source.computation;
  return <div className="computation-notice" role="note"><strong>{t('COMPUTED · approximate model', '本机计算 · 近似模型')} · {computation.status === 'unconverged' ? t('NOT CONVERGED', '未确认收敛') : t('APPROXIMATE', '近似解')}</strong><p>{computation.iterations} {t('iterations. Frequencies apply to this restricted model, not a verified full-game GTO strategy.', '轮迭代。频率适用于当前受限模型，不代表已验证的完整牌局 GTO 策略。')}</p><details><summary>{t('Model assumptions & calculation details', '模型假设与计算详情')}</summary><p>{computation.engine}</p><p>{computation.model}</p><p>{computation.scope}</p>{computation.modelGapBb !== undefined && <p>{t('Model best-response gap', '模型内部最佳响应差')}: {computation.modelGapBb === null ? t('not measured for this snapshot', '当前快照未测量') : `${computation.modelGapBb.toFixed(6)} BB/hand`}</p>}</details></div>;
}
