import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Download } from 'lucide-react';
import { CHART_REFERENCES, referencePage } from './data/references';
import { auditCoverage } from './lib/coverage';
import type { Dataset, Spot } from './lib/poker';

type Translate = (english: string, chinese: string) => string;

export function CoveragePanel({ datasets, spot, t }: { datasets: Dataset[]; spot: Spot; t: Translate }) {
  let audit;
  try { audit = auditCoverage(datasets, spot, [6, 7, 8, 9]); } catch { /* An incomplete size ladder cannot be audited. */ }
  return <section className="coverage-panel">
    <h3>{t('Quick lookup · 6–9 player coverage', '快捷查询 · 6–9 人数据覆盖')}</h3>
    <p>{t('Structured ranges at your current stack, rake and bet sizes. Demo frequencies and PDF references do not count.', '按当前后手、抽水及加注尺寸统计可查询数据。演示频率及 PDF 参考图不计入。')}</p>
    {audit ? <><div className="coverage-grid">{audit.byPlayers.map(row => <div key={row.players}><strong>{row.players}-max</strong><span>{row.imported} / {row.expected}</span><small>{t('imported spots', '已导入场景')}</small></div>)}</div><p>{t('Counts cover Open and single-opponent responses through Facing 4-Bet. They exclude limps, squeezes and multiway histories. Imported data is not independently verified.', '统计 Open 及单一对手的 Facing Open／3-Bet／4-Bet，不包含 Limp、Squeeze 和多人行动树；导入数据尚未独立核验。')}</p><button className="text-button" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'gto-coverage-checklist.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}><Download size={14}/>{t('Download missing-spot checklist', '下载待补场景清单')}</button></> : <p>{t('Enter a valid sequence of Open, 3-Bet and 4-Bet sizes to check coverage.', '请填写有效的 Open、3-Bet 和 4-Bet 尺寸后查看覆盖情况。')}</p>}
  </section>;
}

export function ReferenceSummary({ onOpen, t }: { onOpen: () => void; t: Translate }) {
  return <section className="reference-summary">
    <div><BookOpen size={19}/><span><strong>{t('Cash · 100 BB reference library', 'Cash · 100 BB 专业参考图')}</strong><small>{t('Original charts; simplified strategies. Exact frequency data is still incomplete.', '原始专业图表，包含简化策略；精确频率数据库尚未补齐。')}</small></span></div>
    <div className="reference-badges">{[6,7,8,9].map(players => <span key={players} className={CHART_REFERENCES.some(ref => ref.players === players) ? 'has-reference' : ''}>{players}-max <small>{CHART_REFERENCES.some(ref => ref.players === players) ? t('Charts', '有图表') : t('Missing', '待补')}</small></span>)}</div>
    <button className="secondary-button" onClick={onOpen}>{t('Browse charts', '查阅图表')}<ArrowUpRight size={15}/></button>
  </section>;
}

export default function ReferenceLibrary({ spot, t, selection }: { spot: Spot; t: Translate; selection?: { id: string; page: number } | null }) {
  const initial = CHART_REFERENCES.find(ref => selection ? ref.id === selection.id : ref.players === spot.players) ?? CHART_REFERENCES[0];
  const [selectedId, setSelectedId] = useState(initial.id);
  const [page, setPage] = useState(selection?.page ?? referencePage(initial, spot) ?? initial.rfiPage);
  const [localIds, setLocalIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(import.meta.env.DEV);
  const reference = CHART_REFERENCES.find(ref => ref.id === selectedId) ?? initial;
  const matchedPage = selection ? null : referencePage(reference, spot);
  const local = localIds.includes(reference.id);
  const pdfUrl = `${local ? `/api/reference-charts/${reference.id}.pdf` : reference.url}#page=${page}`;
  const browsePages = reference.browsePages ?? Array.from({ length: reference.pages }, (_, i) => i + 1);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const controller = new AbortController();
    fetch('/api/reference-charts', { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Local chart library unavailable');
      return response.json() as Promise<Array<{ id: string; local: boolean }>>;
    }).then(items => setLocalIds(items.filter(item => item.local).map(item => item.id)))
      .catch(() => { /* The official source link remains usable without a local copy. */ })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  return <div className="dialog-body reference-library">
    <p className="dialog-intro">{t('Study the provider’s original charts. Reviewed Open and Facing Open transcriptions appear in Published ranges; other charts remain PDF references. Check the printed bet sizes and game assumptions.', '查阅提供方的原始图表。已核对的 Open 与 Facing Open 转录可在“出版范围图”查询，其余仍为 PDF 参考，请核对图中的下注尺寸与游戏条件。')}</p>
    <div className="reference-controls"><label>{t('Source pack', '资料包')}<select value={selectedId} onChange={event => {
      const next = CHART_REFERENCES.find(ref => ref.id === event.target.value)!;
      setSelectedId(next.id); setPage(referencePage(next, spot) ?? next.rfiPage);
    }}>{CHART_REFERENCES.map(ref => <option key={ref.id} value={ref.id}>{ref.provider} · {ref.title}</option>)}</select></label><label>{t('PDF page', 'PDF 页码')}<select value={page} onChange={event => setPage(Number(event.target.value))}>{browsePages.map(number => <option key={number} value={number}>{number}</option>)}</select></label></div>
    <div className="reference-facts"><strong>{reference.provider} · {reference.players}-max · 100 BB</strong><p>{reference.conditions}</p><p>{reference.precision === '50%' ? t('Frequencies rounded to 0 / 50 / 100%. No Facing 4-Bet charts. MP means HJ in 6-max, UTG+2 in 9-max.', '频率四舍五入到 0／50／100%。不含面对 4-Bet 的应对图。图中 MP 在 6 人局对应 HJ，在 9 人局对应 UTG+2。') : t('90 indexed spots, including Facing 4-Bet. Published mixed-frequency bars; rounding is unspecified. No exact per-hand numbers have been transcribed.', '已索引 90 个场景，包含 Facing 4-Bet。原出版图使用混合频率色条，舍入精度未说明；尚未转录逐手精确数值。')}</p></div>
    <div className="reference-links">{matchedPage ? <button className="text-button" onClick={() => setPage(matchedPage)}>{t(`Your position / action → page ${matchedPage}`, `当前人数、位置、行动 → 第 ${matchedPage} 页`)}</button> : <span>{selection ? t('Opened from your selected spot. Verify the printed assumptions.', '从所选场景打开，请核对原图条件。') : t('No indexed chart for your current spot. Browsing this pack only.', '当前场景没有已核实的对应图，仅浏览所选资料包。')}</span>}<a href={pdfUrl} target="_blank" rel="noreferrer">{t('Open PDF', '打开 PDF')}<ArrowUpRight size={14}/></a><a href={reference.url} target="_blank" rel="noreferrer">{t('Official source', '官方来源')}<ArrowUpRight size={14}/></a></div>
    {loading ? <div className="reference-placeholder">{t('Loading local charts…', '正在加载本地资料…')}</div> : local ? <iframe key={`${reference.id}-${page}`} className="reference-viewer" title={`${reference.title}, page ${page}`} src={pdfUrl}/> : <div className="reference-placeholder"><BookOpen size={28}/><strong>{t('Read this chart at the official source', '从官方来源阅读图表')}</strong><p>{t('A local PDF copy is not available in this installation. Use Open PDF above.', '本次安装未载入该 PDF 的本地副本，请点击上方“打开 PDF”。')}</p></div>}
    <p className="reference-caption">{t('Only the player count, stack, position and action are indexed. This is not an exact match for your custom rake or bet sizes. Zero reach is not Fold 100%.', '索引仅匹配人数、后手、位置与行动，不代表匹配你设置的抽水或尺寸。不能将不可达手牌解读为 Fold 100%。')}</p>
  </div>;
}
