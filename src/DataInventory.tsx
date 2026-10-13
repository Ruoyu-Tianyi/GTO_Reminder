import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, RefreshCw } from 'lucide-react';
import ComputationNotice from './ComputationNotice';
import { buildDataInventory, INVENTORY_REFERENCE_KINDS, type InventoryInput, type InventoryQuality, type InventoryTreeEntry } from './lib/data-inventory';
import { displayPublishedChart, REFERENCE_KIND_LABELS } from './lib/display-ranges';
import { getPositions, validateDataset } from './lib/poker';
import type { PublishedChartsResponse } from './lib/published-charts';
import type { ReferenceRange, ReferenceRangesResponse } from './lib/reference-ranges';
import type { ReferenceSelection } from './PublishedCharts';
import './inventory.css';

type Translate = (en: string, zh: string) => string;
const EMPTY_INPUT: InventoryInput = { publishedCharts: null, referenceRanges: null, datasets: null, treeLibrary: null };
const number = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString();

async function readJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url.split('?')[0]}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export default function DataInventory({ t, onReference, onTree }: {
  t: Translate; onReference: (selection: ReferenceSelection) => void; onTree: (id: string) => void;
}) {
  const [input, setInput] = useState<InventoryInput>(EMPTY_INPUT);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(import.meta.env.DEV);
  const [refresh, setRefresh] = useState(0);
  const [updatedAt, setUpdatedAt] = useState('');
  const [players, setPlayers] = useState(0);
  const inventory = useMemo(() => buildDataInventory(input), [input]);
  const referenceNodes = useMemo(() => [...(input.publishedCharts ?? []).map(displayPublishedChart), ...(input.referenceRanges ?? [])], [input]);
  const refs = inventory.totals.references;
  const local = inventory.totals.local;
  const packs = inventory.packs?.filter(pack => !players || pack.players === players);
  const qualityLabel = (quality: InventoryQuality) => ({
    approximate: t('MODEL APPROXIMATION', '模型近似解'), unconverged: t('NOT CONVERGED', '未确认收敛'),
    imported: t('IMPORTED', '外部导入'), demo: t('DEMO', '演示'), unknown: t('QUALITY UNKNOWN', '质量未知'),
  })[quality];

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const controller = new AbortController();
    setLoading(true); setInput(EMPTY_INPUT); setErrors([]);
    async function load() {
      const results = await Promise.allSettled([
        readJson<PublishedChartsResponse>('/api/published-charts', controller.signal),
        readJson<ReferenceRangesResponse>('/api/reference-ranges', controller.signal),
        readJson<{ datasets: unknown[]; treeLibrary: InventoryTreeEntry[]; errors: string[] }>('/api/local-datasets?summary=1', controller.signal)
          .then(result => ({ ...result, datasets: result.datasets.map(validateDataset) })),
      ]);
      if (controller.signal.aborted) return;
      const [published, extended, computed] = results;
      const problems = results.flatMap(result => result.status === 'rejected' ? [String(result.reason)] : []);
      // A failed source stays unknown, never a misleading zero in the coverage table.
      if (published.status === 'fulfilled' && published.value.error) problems.push(published.value.error);
      if (extended.status === 'fulfilled' && extended.value.error) problems.push(extended.value.error);
      if (computed.status === 'fulfilled') problems.push(...computed.value.errors);
      setInput({
        publishedCharts: published.status === 'fulfilled' && !published.value.error ? published.value.nodes : null,
        referenceRanges: extended.status === 'fulfilled' && !extended.value.error ? extended.value.nodes : null,
        datasets: computed.status === 'fulfilled' ? computed.value.datasets : null,
        treeLibrary: computed.status === 'fulfilled' ? computed.value.treeLibrary : null,
      });
      setErrors(problems); setUpdatedAt(new Date().toISOString()); setLoading(false);
    }
    void load(); return () => controller.abort();
  }, [refresh]);

  function exportInventory() {
    const report = { schemaVersion: 1, generatedAt: updatedAt, scope: 'Local reference charts and stored strategy metadata. Counts do not establish complete GTO coverage; Quick nodes overlap tree decisions.', errors, ...inventory };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `gto-data-inventory-${updatedAt.slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openReference(nodes: ReferenceRange[]) {
    // Prefer a chart with more readable rows as the entry point; all other seats remain selectable.
    const selected = [...nodes].sort((a, b) => Object.values(b.hands).filter(row => row.status === 'available').length - Object.values(a.hands).filter(row => row.status === 'available').length)[0];
    if (selected) onReference(selected);
  }

  return <section className="inventory" aria-label={t('Data coverage overview', '数据覆盖总览')}>
    <div className="inventory-header"><div><h2>{t('What can I study?', '目前有哪些数据可学？')}</h2><p>{t('See the references and calculations available on this computer, then open a range or model directly. Counts describe stored data, not complete GTO coverage.', '查看这台电脑已载入的参考图与计算结果，直接进入范围或模型。统计反映已有数据，不代表完整 GTO 覆盖率。')}</p></div><div className="inventory-tools">
      <button className="secondary-button" disabled={loading || !import.meta.env.DEV} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14}/>{t('Refresh inventory', '刷新清单')}</button>
      <button className="secondary-button" disabled={loading || !updatedAt} onClick={exportInventory}><ArrowDownToLine size={14}/>{t('Export inventory', '导出清单')}</button>
    </div></div>
    <p role="status" className="inventory-status">{loading ? t('Checking local references and model summaries…', '正在检查本地参考图与计算模型…') : !import.meta.env.DEV ? t('Local data is available when started with the local development server.', '请通过本地开发服务启动，以读取这台电脑的数据。') : `${t('Last checked', '检查时间')} · ${updatedAt ? new Date(updatedAt).toLocaleString() : '—'}`}</p>
    {(errors.length > 0 || inventory.warnings.length > 0) && <div className="tree-load-errors inventory-errors" role="alert"><strong>{t('Some data could not be counted. Totals may be incomplete.', '部分数据未能统计，以下总数可能不完整。')}</strong>{[...errors, ...inventory.warnings].map((error, index) => <p key={index}>{error}</p>)}</div>}
    <div className="inventory-metrics">
      <div className="inventory-metric"><span>{t('Source charts', '原图转录')}</span><strong>{number(refs?.original.charts)}</strong><p>{t('Simplified or image-measured frequencies', '出版简化频率或图片测量频率')}</p></div>
      <div className="inventory-metric"><span>{t('Seat projections', '座位投影估算')}</span><strong>{number(refs?.projected.charts)}</strong><p>{t('7-max estimates from 8-max charts', '从 8 人参考图推算的 7 人范围')}</p></div>
      <div className="inventory-metric"><span>{t('Computed model packs', '本机计算模型')}</span><strong>{number(local?.bySource.computed.modelPacks)}</strong><p>{local ? `${local.qualityCounts.unconverged} ${t('not confirmed converged', '个未确认收敛')}` : t('Waiting for local data', '等待本地数据')}</p></div>
      <div className="inventory-metric"><span>{t('Computed decisions', '本机计算决策')}</span><strong>{number(local?.bySource.computed.decisionNodes)}</strong><p>{t('Stored across models; may overlap', '按各模型累加，场景可能重叠')}</p></div>
    </div>
    <section className="panel inventory-section"><h3>{t('Reference scenarios · 100 BB', '参考场景 · 100 BB')}</h3><p className="inventory-note">{t('Click a count to open that scenario. Numbers count charts; a chart can still contain unknown hands. Estimates are counted separately from original sources.', '点击数量进入对应场景。这里统计图表张数，一张图内仍可能有未知手牌；投影估算与原始来源分别计数。')}</p>
      <div className="inventory-scroll"><table className="inventory-table"><thead><tr><th scope="col">{t('Scenario', '场景')}</th>{inventory.byPlayers.map(row => <th scope="col" key={row.players}>{row.players}-max</th>)}</tr></thead><tbody>
        {INVENTORY_REFERENCE_KINDS.map(kind => <tr key={kind}><th scope="row">{REFERENCE_KIND_LABELS[kind]}</th>{inventory.byPlayers.map(row => {
          const counts = row.references?.byKind[kind];
          const nodes = referenceNodes.filter(node => node.players === row.players && node.kind === kind);
          const charts = counts ? counts.original.charts + counts.projected.charts : undefined;
          const unknown = counts ? counts.original.unknownHands + counts.projected.unknownHands : 0;
          return <td key={row.players}>{charts ? <button className="inventory-chart-link" aria-label={`${row.players}-max ${REFERENCE_KIND_LABELS[kind]}: ${charts} ${t('charts', '张图')}`} onClick={() => openReference(nodes)}><strong>{counts!.original.charts > 0 && `${counts!.original.charts} ${t('charts', '张原图')}`}{counts!.original.charts > 0 && counts!.projected.charts > 0 && ' + '}{counts!.projected.charts > 0 && `${counts!.projected.charts} ${t('estimates', '张估算')}`}</strong><span>{unknown > 0 ? `${number(unknown)} ${t('unknown rows', '条手牌记录未知')}` : t('All chart rows readable', '图中手牌均可读')}</span></button> : <span className="inventory-empty">{charts === undefined ? '—' : t('No chart', '暂无图表')}</span>}</td>;
        })}</tr>)}
      </tbody></table></div><p className="inventory-note">{t('Single-opponent source lines only. Rake, sizes, and historical reach must be checked in the selected chart. Unknown does not mean Fold or zero reach.', '仅统计原图中的单一对手行动线，抽水、尺寸与历史到达率须在图中核对。未知不等于 Fold 或零到达率。')}</p>
    </section>
    <section className="panel inventory-section"><div className="inventory-library-heading"><div><h3>{t('Calculation & imported models', '计算与导入模型')}</h3><p className="inventory-note">{t('Each card is one source snapshot. File parts are grouped; Quick shortcuts are not counted again as additional decisions.', '每张卡片对应一个来源快照，分片已合并计数；快捷节点不重复计入决策数量。')}</p></div><label>{t('Table size', '桌上人数')}<select value={players} onChange={event => setPlayers(Number(event.target.value))}><option value={0}>{t('All tables', '全部人数')}</option>{inventory.byPlayers.map(row => <option value={row.players} key={row.players}>{row.players}-max</option>)}</select></label></div>
      <div className="inventory-packs">{packs?.map(pack => {
        const tree = pack.source.computation?.tree;
        const positions = getPositions(pack.players);
        const stacks = positions.map(position => pack.game.stacksBb?.[position] ?? pack.game.stackBb);
        const stackLabel = new Set(stacks).size === 1 ? `${stacks[0]} BB` : t('Mixed stacks', '不同后手');
        const raises = tree ? [tree.openSizeBb, ...(tree.maxRaises >= 2 ? [tree.threeBetSizeBb] : []), ...(tree.maxRaises >= 3 ? [tree.fourBetSizeBb] : [])].join(' / ') : null;
        return <article className="inventory-pack" key={pack.key}><div className="inventory-pack-top"><h4>{pack.players}-max · {stackLabel}</h4><span className={`status-pill ${pack.quality === 'unconverged' || pack.quality === 'unknown' ? 'estimate-badge' : ''}`}>{qualityLabel(pack.quality)}</span></div><p className="inventory-pack-name">{pack.name.replace(/ · part \d+\/\d+$/, '')}</p>
          {new Set(stacks).size > 1 && <p className="inventory-note">{positions.map((position, index) => `${position} ${stacks[index]} BB`).join(' · ')}</p>}
          <dl><div><dt>{t('Stored decisions', '已存决策')}</dt><dd>{number(pack.decisionNodes)}</dd></div><div><dt>{t('Conditions', '条件')}</dt><dd>{pack.game.format === 'cash' ? 'Cash' : 'MTT'} · Ante {pack.game.anteBb} BB · {pack.game.rake}</dd></div>{tree && <><div><dt>{t('Raise-to sizes', '加注至')}</dt><dd>{raises} BB{tree.maxRaises >= 4 ? t(' · deeper sizes in tree', ' · 更深尺寸见行动树') : ''}</dd></div><div><dt>{t('Allowed actions', '允许行动')}</dt><dd>{tree.limp ? 'Limp · ' : t('No Limp · ', '无 Limp · ')}{tree.maxRaises} {t('raises maximum', '次加注上限')}</dd></div></>}</dl>
          {tree && <p className="inventory-note">{t(`This tree stops raising after ${tree.maxRaises} raises. Missing bet sizes and later raises were excluded from the calculation.`, `本树最多加注 ${tree.maxRaises} 次，未列出的下注尺寸与后续再加注不在计算中。`)}</p>}
          <ComputationNotice source={pack.source} t={t}/><button className="primary-button" onClick={() => onTree(pack.id)}>{t('Open this model', '查看此模型')}<ArrowUpRight size={14}/></button>
        </article>;
      })}</div>{packs?.length === 0 && <p className="inventory-note">{t('No local tree models for this selection.', '所选人数暂无本地行动树模型。')}</p>}
      <p className="inventory-note">{t('Quick lookup nodes', '快捷查询节点')} · {t('Computed', '本机计算')} {number(local?.bySource.computed.quickNodes)} · {t('Imported', '外部导入')} {number(local?.bySource.imported.quickNodes)} · {t('Demo', '演示')} {number(local?.bySource.demo.quickNodes)}. {t('These can overlap the tree decisions above.', '这些节点可能与上面的行动树决策重叠。')}</p>
    </section>
    <p className="inventory-note">{t('This inventory reads local files. Temporary browser imports are listed inside their own workspace. To move between computers, sync the code and separately transfer your private data bundle; exporting this inventory does not include strategy frequencies.', '清单读取本地文件，浏览器临时导入的数据在各自模块中查看。换电脑时需同步代码并另行迁移私人数据包；导出本清单不包含策略频率。')}</p>
  </section>;
}
