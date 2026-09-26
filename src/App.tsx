import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronRight, CircleHelp, Database, Grid2X2, Info, Layers3, Plus, RotateCcw, Settings2, Spade, Upload, X } from 'lucide-react';
import { DEMO_DATASET } from './data/demo';
import { HANDS, comboCount, findNode, getPositions, getVillains, normalizeHand, rangeSummary, validateDataset, type Dataset, type Position, type Spot, type SpotKind } from './lib/poker';

const INITIAL_SPOT: Spot = { players: 6, hero: 'BTN', villain: null, stackBb: 100, kind: 'rfi', openSizeBb: 2.5, threeBetSizeBb: 10, fourBetSizeBb: 22, format: 'cash', anteBb: 0, rake: '5% · 3 BB cap' };
const COLORS = { raise: '#a8d896', call: '#94c5e7', fold: '#edf0eb' };
const SPOT_LABELS: Record<SpotKind, string> = { rfi: 'Open', 'vs-open': 'Facing Open', 'vs-3bet': 'Facing 3-Bet', 'vs-4bet': 'Facing 4-Bet' };
const percent = (n: number) => `${(n * 100).toFixed(n > 0 && n < .01 ? 2 : 1)}%`;
const spotTitle = (spot: Spot) => `${spot.hero}${spot.villain ? ` vs ${spot.villain}` : ''} · ${SPOT_LABELS[spot.kind]}`;

function download(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function normalizeSpot(spot: Spot): Spot {
  const positions = getPositions(spot.players);
  const hero = positions.includes(spot.hero) ? spot.hero : positions[0];
  const villains = getVillains(spot.players, hero, spot.kind);
  return { ...spot, hero, villain: spot.kind === 'rfi' ? null : villains.includes(spot.villain as Position) ? spot.villain : villains[0] ?? null };
}

export default function App() {
  const [spot, setSpot] = useState<Spot>(INITIAL_SPOT);
  const [hand, setHand] = useState('AKs');
  const [query, setQuery] = useState('AKs');
  const [language, setLanguage] = useState<'en' | 'zh'>(() => { try { return localStorage.getItem('gto-language') === 'zh' ? 'zh' : 'en'; } catch { return 'en'; } });
  const [datasets, setDatasets] = useState<Dataset[]>([DEMO_DATASET]);
  const [datasetId, setDatasetId] = useState(DEMO_DATASET.id);
  const [modal, setModal] = useState<'data' | 'guide' | null>(null);
  const [importError, setImportError] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [filter, setFilter] = useState<'all' | 'raise' | 'call' | 'fold'>('all');
  const fileInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const libraryButton = useRef<HTMLButtonElement>(null);
  const dataset = datasets.find(d => d.id === datasetId) ?? DEMO_DATASET;
  const node = findNode(dataset, spot);
  const frequencies = normalizeHand(query) ? node?.frequencies[hand] : undefined;
  const summary = node ? rangeSummary(node) : null;
  const isDemo = dataset.source.kind === 'demo';
  const positions = getPositions(spot.players);
  const villains = getVillains(spot.players, spot.hero, spot.kind);
  const t = (en: string, zh: string) => language === 'en' ? en : zh;
  const changeSpot = (patch: Partial<Spot>) => { setSpot(s => normalizeSpot({ ...s, ...patch })); setFilter('all'); };
  const selectHand = (value: string) => { setHand(value); setQuery(value); };
  const raiseLabel = spot.kind === 'rfi' ? 'Raise' : spot.kind === 'vs-open' ? '3-Bet' : spot.kind === 'vs-3bet' ? '4-Bet' : '5-Bet';
  const callLabel = 'Call';
  const visibleActions: ('raise' | 'call' | 'fold')[] = spot.kind === 'rfi' ? ['raise', 'fold'] : ['raise', 'call', 'fold'];

  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; try { localStorage.setItem('gto-language', language); } catch { /* preferences are optional */ } }, [language]);
  useEffect(() => { if (modal && !dialogRef.current?.open) dialogRef.current?.showModal(); if (!modal && dialogRef.current?.open) dialogRef.current.close(); }, [modal]);

  async function importDataset(file: File | undefined) {
    if (!file) return;
    setImportError(''); setImportMessage('');
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error(t('Please use a JSON file smaller than 10 MB.', '请使用小于 10 MB 的 JSON 文件。'));
      const incoming = validateDataset(JSON.parse(await file.text()));
      if (incoming.id === DEMO_DATASET.id) throw new Error(t('The built-in demo is already available. Give your own dataset a unique ID.', '内置演示已存在，请为导入数据使用独立 ID。'));
      setDatasets(current => [...current.filter(d => d.id !== incoming.id), incoming]);
      setDatasetId(incoming.id); setSpot(incoming.nodes[0].spot); setFilter('all');
      setImportMessage(t(`Loaded ${incoming.nodes.length} spots. This file stays in this browser session.`, `已载入 ${incoming.nodes.length} 个场景，文件仅保留在当前浏览器会话中。`));
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Invalid dataset'); }
    if (fileInput.current) fileInput.current.value = '';
  }

  function switchDataset(id: string) {
    const selected = datasets.find(d => d.id === id);
    if (!selected) return;
    setDatasetId(id); setSpot(selected.nodes[0].spot); setFilter('all');
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" onClick={e => e.preventDefault()} aria-label="GTO Reminder home"><span className="brand-symbol"><Spade size={22} fill="currentColor" /></span><span>GTO<span className="brand-light">_Reminder</span></span><span className="alpha">ALPHA</span></a>
      <nav className="top-nav" aria-label="Main navigation"><span className="nav-active"><Grid2X2 size={16} />Preflop</span><button ref={libraryButton} onClick={() => setModal('data')}><Database size={16} />{t('Data library', '数据来源')}</button></nav>
      <div className="top-actions"><button className="language" onClick={() => setLanguage(l => l === 'en' ? 'zh' : 'en')} aria-label="Switch language">{language === 'en' ? 'EN / 中文' : '中文 / EN'}</button><span className="top-divider" /><button className="icon-button help" onClick={() => setModal('guide')} aria-label="Open guide"><CircleHelp size={19} /></button><span className="avatar">GR</span></div>
    </header>

    <main>
      <div className="page-heading"><div><div className="eyebrow">THE STUDY ROOM <span>/</span> PREFLOP</div><h1>{t('Preflop workspace', '翻前策略工作台')}<span className="version">v0.1</span></h1><p>{t('Set the spot. Explore the range. Understand the frequency.', '选择场景，查看范围，理解每一手牌的行动频率。')}</p></div><button className="secondary-button source-button" onClick={() => setModal('data')}><Database size={16} />{t('Manage data', '管理数据')}<ArrowUpRight size={15} /></button></div>
      <div className={`data-notice ${isDemo ? 'demo-notice' : 'import-notice'}`}><Info size={17} /><span><strong>{isDemo ? t('Interactive demo', '交互演示') : t('Imported dataset', '已导入数据')}</strong><span className="notice-divider">·</span>{isDemo ? t('Synthetic frequencies for exploring the interface. Not a solved GTO strategy.', '当前频率仅用于界面演示，并非求解器计算的 GTO 策略。') : t('Source and accuracy are declared by the file owner, not independently verified.', '来源与准确性由文件提供者声明，尚未经独立验证。')}</span><button onClick={() => setModal('data')}>{t('View source', '查看来源')}<ChevronRight size={14} /></button></div>

      <div className="workspace">
        <section className="setup-panel panel" aria-labelledby="setup-title">
          <div className="panel-heading"><h2 id="setup-title"><span className="step-number">01</span>{t('Set your spot', '设置场景')}</h2><button className="icon-button" aria-label="Reset spot" onClick={() => { setSpot(INITIAL_SPOT); setDatasetId(DEMO_DATASET.id); setFilter('all'); }}><RotateCcw size={15} /></button></div>
          <div className="setup-fields">
            <div className="two-fields"><label>{t('Game type', '游戏类型')}<select value={spot.format} onChange={e => changeSpot({ format: e.target.value as Spot['format'] })}><option value="cash">Cash game</option><option value="mtt">MTT · Chip EV</option></select></label><label>{t('Players', '人数')}<select value={spot.players} onChange={e => changeSpot({ players: Number(e.target.value) })}>{[2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>{n === 2 ? 'Heads-up' : `${n}-max`}</option>)}</select></label></div>
            <label className="stack-label">{t('Effective stack', '有效后手')}<div className="number-unit"><input type="number" min="1" max="1000" step="1" value={spot.stackBb} onChange={e => changeSpot({ stackBb: Number(e.target.value) })} aria-label="Effective stack"/><span>BB</span></div></label>
            <div className="stack-presets">{[20,40,60,100,200].map(n => <button className={spot.stackBb === n ? 'selected' : ''} onClick={() => changeSpot({ stackBb: n })} key={n}>{n}</button>)}</div>
          </div>
          <div className="table-section"><div className="field-heading"><span>{t('Your position', '你的位置')}</span><span className="small-badge">{spot.hero}</span></div><div className="poker-table" aria-label="Choose your position">
            <div className="table-felt"><div className="felt-line"/><Spade size={25} fill="currentColor"/><span>{spot.players}-MAX</span><small>NO LIMIT HOLD’EM</small></div>
            {positions.map((position, index) => {
              const angle = (index / positions.length) * Math.PI * 2 - Math.PI / 2;
              const style = { left: `${50 + 41 * Math.cos(angle)}%`, top: `${50 + 39 * Math.sin(angle)}%` };
              return <button key={position} style={style} className={`seat ${spot.hero === position ? 'hero-seat' : ''} ${spot.villain === position ? 'villain-seat' : ''}`} aria-label={`Select position ${position}`} aria-pressed={spot.hero === position} onClick={() => changeSpot({ hero: position })}><span>{position}</span><small>{spot.hero === position ? 'HERO' : spot.villain === position ? 'VILLAIN' : `${spot.stackBb} BB`}</small>{(position === 'BTN' || (positions.length === 2 && position === 'SB')) && <i className="dealer">D</i>}</button>;
            })}
          </div><div className="table-caption"><span className="hero-dot"/>{t('Click a seat to choose your position', '点击座位选择你的位置')}</div></div>
          <div className="action-section"><label>{t('Action before you', '当前行动场景')}<select aria-label="Action before you" value={spot.kind} onChange={e => changeSpot({ kind: e.target.value as SpotKind })}>{Object.entries(SPOT_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {spot.kind !== 'rfi' && <label>{t('Opponent position', '对手位置')}<select aria-label="Opponent position" value={spot.villain ?? ''} onChange={e => changeSpot({ villain: e.target.value as Position })}>{!villains.length && <option value="">No valid opponent</option>}{villains.map(p => <option key={p}>{p}</option>)}</select></label>}
            <button className="advanced-toggle" onClick={() => setAdvanced(a => !a)} aria-expanded={advanced}><Settings2 size={14}/>{t('Bet sizes & game assumptions', '加注尺寸与游戏条件')}<Plus size={14} className={advanced ? 'rotated' : ''}/></button>
            {advanced && <div className="advanced-fields"><label>Open (BB)<input type="number" min="2" step="0.5" value={spot.openSizeBb} onChange={e => changeSpot({openSizeBb:Number(e.target.value)})}/></label><label>3-Bet (BB)<input type="number" min="3" step="0.5" value={spot.threeBetSizeBb} onChange={e => changeSpot({threeBetSizeBb:Number(e.target.value)})}/></label><label>4-Bet (BB)<input type="number" min="4" step="0.5" value={spot.fourBetSizeBb} onChange={e => changeSpot({fourBetSizeBb:Number(e.target.value)})}/></label><label>Ante (BB/player)<input type="number" min="0" step="0.1" value={spot.anteBb} onChange={e => changeSpot({anteBb:Number(e.target.value)})}/></label><label className="full-width">Rake profile<input value={spot.rake} onChange={e => changeSpot({rake:e.target.value})}/></label><p>{t('Exact matches only. No interpolation between stacks or bet sizes.', '仅匹配完整条件，不对不同后手或加注尺寸进行插值。')}</p></div>}
          </div>
        </section>

        <section className="range-panel panel" aria-labelledby="range-title">
          <div className="panel-heading"><h2 id="range-title"><span className="step-number">02</span>{t('Range explorer', '范围矩阵')}</h2><span className="matrix-count">13 × 13</span></div>
          <div className="range-context"><div><h3>{spotTitle(spot)}</h3><span>{spot.players}-max <b>·</b> {spot.stackBb} BB <b>·</b> {spot.format === 'cash' ? 'Cash' : 'MTT'} <b>·</b> {t('Preflop', '翻前')}</span></div><span className={`status-pill ${node ? '' : 'unavailable'}`}><span/>{node ? (isDemo ? 'DEMO' : 'IMPORTED') : 'NO DATA'}</span></div>
          <div className="range-legend" aria-label="Filter actions">{(['all', ...visibleActions] as const).map(key => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)} aria-pressed={filter === key}>{key !== 'all' && <span style={{background:COLORS[key]}}/>}{key === 'all' ? t('All actions', '全部行动') : key === 'raise' ? raiseLabel : key === 'call' ? callLabel : 'Fold'}</button>)}</div>
          <div className="matrix-wrapper"><div className="hand-matrix" role="group" aria-label="Starting hand range matrix">{HANDS.map(cell => {
            const f = node?.frequencies[cell];
            const background = !f ? '#f0f2ef' : filter !== 'all' ? `linear-gradient(90deg, ${COLORS[filter]} ${f[filter]*100}%, #f8faf6 ${f[filter]*100}%)` : `linear-gradient(90deg, ${COLORS.raise} ${f.raise*100}%, ${COLORS.call} ${f.raise*100}%, ${COLORS.call} ${(f.raise+f.call)*100}%, ${COLORS.fold} ${(f.raise+f.call)*100}%)`;
            return <button key={cell} className={`hand-cell ${hand === cell ? 'selected-hand' : ''} ${cell.length === 2 ? 'pair' : ''} ${!f ? 'no-frequency' : ''}`} style={{background} as CSSProperties} onClick={() => selectHand(cell)} aria-label={`${cell}${f ? `: ${raiseLabel} ${percent(f.raise)}, ${callLabel} ${percent(f.call)}, Fold ${percent(f.fold)}` : ': no data'}`} aria-pressed={hand === cell}>{cell}</button>;
          })}</div>{!node && <div className="empty-overlay"><Database size={28}/><strong>{t('No data for this spot', '该场景暂无数据')}</strong><p>{t('Choose a covered spot or import a matching strategy.', '请选择已覆盖场景，或导入匹配条件的策略。')}</p><button className="primary-button" onClick={() => setModal('data')}>{t('Explore available data', '查看可用数据')}<ArrowUpRight size={15}/></button></div>}</div>
          <div className="matrix-footnote"><span>{t('Suited above the diagonal · Offsuit below', '对角线上方为同花 · 下方为非同花')}</span><span>169 {t('hands', '种手牌')}</span></div>
          <div className="range-summary"><div className="summary-title">{t('Range breakdown', '范围占比')}<span>{t('All starting-hand combinations', '按全部起手牌组合加权')}</span></div><div className="summary-bar">{(['raise','call','fold'] as const).map(a => <span key={a} style={{background:COLORS[a],width:`${(summary?.[a] ?? (a === 'fold' ? 1 : 0))*100}%`}}/>)}</div><div className="summary-values">{visibleActions.map(a => <div key={a}><span className="legend-dot" style={{background:COLORS[a]}}/><span>{a === 'raise' ? raiseLabel : a === 'call' ? callLabel : 'Fold'}</span><strong>{summary ? percent(summary[a]) : '—'}</strong></div>)}</div></div>
          <div className="data-credit"><Database size={13}/><span>{dataset.name}</span><button onClick={() => setModal('data')} aria-label="View dataset details"><ArrowUpRight size={14}/></button></div>
        </section>

        <aside className="hand-panel panel" aria-labelledby="hand-title"><div className="panel-heading"><h2 id="hand-title"><span className="step-number">03</span>{t('Your hand', '查看手牌')}</h2><Layers3 size={17}/></div>
          <div className="hand-search"><label htmlFor="hand-input">{t('Find a starting hand', '输入起手牌')}</label><div className="search-input"><input id="hand-input" value={query} placeholder="e.g. AKs, QQ, As Kh" spellCheck={false} onChange={e => { setQuery(e.target.value); const normalized = normalizeHand(e.target.value); if (normalized) setHand(normalized); }}/><span>↵</span></div>{query && !normalizeHand(query) && <p className="input-error">{t('Use AKs, AKo, QQ, or two cards like As Kh.', '格式：AKs、AKo、QQ，或 As Kh 等两张具体牌。')}</p>}</div>
          <div className="selected-hand-display"><div className="playing-cards"><div className="playing-card"><span>{hand[0]}</span><i>♠</i><b>♠</b></div><div className={`playing-card second ${hand[2] === 's' ? '' : 'red-suit'}`}><span>{hand[1]}</span><i>{hand[2] === 's' ? '♠' : '♥'}</i><b>{hand[2] === 's' ? '♠' : '♥'}</b></div></div><h3>{hand}<span>{hand.length === 2 ? t('Pocket pair', '口袋对子') : hand[2] === 's' ? t('Suited', '同花') : t('Offsuit', '非同花')}</span></h3><p>{comboCount(hand)} {t('combinations', '种组合')}<span>·</span>{spot.hero}</p></div>
          <div className="frequency-section"><div className="frequency-title">{t('Action frequencies', '行动频率')}<span>{isDemo ? 'DEMO' : 'IMPORTED'}</span></div>{visibleActions.map(action => <div key={action} className={`frequency-row ${action}`}><div><span className="action-marker" style={{background:COLORS[action]}}/><span>{action === 'raise' ? raiseLabel : action === 'call' ? callLabel : 'Fold'}</span><strong>{frequencies ? percent(frequencies[action]) : '—'}</strong></div><div className="frequency-track"><span style={{width:`${(frequencies?.[action] ?? 0)*100}%`,background: action === 'fold' ? '#b5bfb0' : COLORS[action]}}/></div></div>)}<p className="frequency-note">{node ? t('Frequencies apply only to the exact spot selected.', '频率仅适用于当前完整场景。') : t('No recommendation without matching data.', '没有匹配数据时，不给出行动建议。')}</p></div>
          <div className="spot-recap"><h4>{t('At a glance', '当前场景')}</h4><dl><div><dt>{t('Position', '位置')}</dt><dd>{spot.hero}{spot.villain ? ` vs ${spot.villain}` : ''}</dd></div><div><dt>{t('Stack', '后手')}</dt><dd>{spot.stackBb} BB</dd></div><div><dt>Open size</dt><dd>{spot.openSizeBb} BB</dd></div><div><dt>Rake</dt><dd>{spot.rake || '—'}</dd></div></dl></div>
          <button className="learn-link" onClick={() => setModal('guide')}><BookOpen size={15}/>{t('How to read the range', '如何阅读范围矩阵')}<ArrowUpRight size={14}/></button>
        </aside>
      </div>
      <footer><span><Spade size={13} fill="currentColor"/>GTO_Reminder <span className="footer-slash">/</span> {t('Built for deliberate study.', '专注每一次策略学习。')}</span><span>Preflop first.<span className="footer-slash">/</span>Full-game study, next.</span></footer>
    </main>

    <dialog ref={dialogRef} onCancel={() => setModal(null)} onClose={() => setModal(null)} onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
      <div className="dialog-heading"><span className="dialog-icon">{modal === 'data' ? <Database size={22}/> : <BookOpen size={22}/>}</span><div><div className="eyebrow">GTO_REMINDER</div><h2>{modal === 'data' ? t('Your strategy library', '策略数据库') : t('A guide to the workspace', '工作台使用说明')}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setModal(null)}><X size={21}/></button></div>
      {modal === 'data' ? <div className="dialog-body">
        <p className="dialog-intro">{t('Every frequency needs a source. Inspect a dataset, choose a covered spot, or bring your own licensed ranges.', '每一个频率都应有据可查。检查数据来源、选择已覆盖的场景，或导入你有权使用的范围。')}</p>
        <label>{t('Active dataset', '当前数据集')}<select value={datasetId} onChange={e => switchDataset(e.target.value)}>{datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <div className="source-details"><div><span>{t('Provider', '提供者')}</span><strong>{dataset.source.name}</strong></div><div><span>{t('Data status', '数据状态')}</span><strong>{isDemo ? t('Synthetic demo · not GTO', '合成演示 · 非 GTO') : t('User import · unverified', '用户导入 · 未独立验证')}</strong></div><div><span>{t('License / usage', '许可 / 用途')}</span><strong>{dataset.source.license}</strong></div><div><span>{t('Retrieved', '获取日期')}</span><strong>{dataset.source.retrievedAt}</strong></div>{/^https?:\/\//.test(dataset.source.url) && <a href={dataset.source.url} target="_blank" rel="noreferrer">{t('Original source', '原始来源')}<ArrowUpRight size={14}/></a>}</div>
        <label>{t('Covered spots', '已覆盖场景')}<select aria-label="Covered spots" value={node?.id ?? ''} onChange={e => { const next = dataset.nodes.find(n => n.id === e.target.value); if (next) {setSpot(next.spot); setFilter('all');} }}>{!node && <option value="">{t('Choose a covered spot', '选择已覆盖的场景')}</option>}{dataset.nodes.map(n => <option key={n.id} value={n.id}>{spotTitle(n.spot)} / {n.spot.players}-max / {n.spot.stackBb} BB / {n.spot.openSizeBb}-{n.spot.threeBetSizeBb}-{n.spot.fourBetSizeBb} BB / {n.spot.format} / ante {n.spot.anteBb} / {n.spot.rake}</option>)}</select></label>
        <div className="import-area"><Upload size={24}/><h3>{t('Bring your own ranges', '导入你的范围数据')}</h3><p>{t('Import the GTO_Reminder JSON format. Files stay on your device and are cleared when you refresh.', '导入 GTO_Reminder 格式的 JSON。文件仅在本机读取，刷新后清空。')}</p><div><button className="primary-button" onClick={() => fileInput.current?.click()}><Plus size={15}/>{t('Import JSON', '导入 JSON')}</button><button className="text-button" onClick={() => download({...DEMO_DATASET,id:'my-strategy-template'},'gto-reminder-demo-template.json')}><ArrowDownToLine size={15}/>{t('Download template', '下载模板')}</button></div><input type="file" accept=".json,application/json" ref={fileInput} onChange={e => void importDataset(e.target.files?.[0])} hidden />{importError && <p className="import-error" role="alert">{importError}</p>}{importMessage && <p className="import-success" role="status"><Check size={15}/>{importMessage}</p>}</div>
        <div className="professional-sources"><h3>{t('Professional reference sources', '专业数据参考来源')}</h3><p>{t('Research links only. Their strategies are not bundled in this app.', '以下仅为研究来源链接，本应用未附带其策略数据。')}</p><a href="https://gtowizard.com/" target="_blank" rel="noreferrer"><span><strong>GTO Wizard</strong><small>{t('Solver library · licensing required for reuse', '求解器范围库 · 再使用需核实授权')}</small></span><ArrowUpRight size={17}/></a><a href="https://www.rangeconverter.com/" target="_blank" rel="noreferrer"><span><strong>RangeConverter</strong><small>{t('Preflop solutions · confirm export and usage rights', '翻前解决方案 · 核实导出及使用许可')}</small></span><ArrowUpRight size={17}/></a></div>
      </div> : <div className="dialog-body guide-body"><section><span>01</span><div><h3>{t('Match the full situation', '匹配完整的牌局条件')}</h3><p>{t('Choose players, position, effective stack and previous action. Rake, antes and bet sizes also change a strategy. The app only returns exact matches.', '选择人数、位置、有效后手与前序行动。抽水、前注和加注尺寸也会改变策略；本应用只返回完全匹配的数据。')}</p></div></section><section><span>02</span><div><h3>{t('Read the matrix', '阅读 169 种手牌矩阵')}</h3><p>{t('Pairs sit on the diagonal. Suited hands are above it, offsuit hands below. Green is Raise, blue is Call, grey is Fold. A split cell shows a mixed strategy.', '对子位于对角线，同花牌在上方，非同花牌在下方。绿色代表 Raise，蓝色代表 Call，灰色代表 Fold；格子内的分色比例代表混合频率。')}</p></div></section><section><span>03</span><div><h3>{t('Follow the action sequence', '理解前序行动')}</h3><p>Open → {t('unopened pot', '前面无人入池')}<br/>Facing Open → Call / 3-Bet / Fold<br/>Facing 3-Bet → Call / 4-Bet / Fold<br/>Facing 4-Bet → Call / 5-Bet / Fold</p><p>{t('Heads-up: SB is also the dealer and acts first preflop. Limped pots, cold calls, squeezes, unequal stacks and ICM are not represented in v0.1.', '单挑时 SB 同时为庄位，翻前先行动。v0.1 暂不覆盖跛入底池、冷跟、挤压加注、非对称后手与 ICM。')}</p></div></section><section><span>04</span><div><h3>{t('Know what your data means', '明确数据性质')}</h3><p>{t('The built-in dataset is synthetic and demonstrates the interface only. Import authorized solver output for study. Imported metadata is not an independent certification. No data means no recommendation.', '内置数据为合成演示，仅展示交互功能。研究策略时请导入获授权的求解器数据，导入文件声明不等于独立认证。没有数据就不提供建议。')}</p></div></section></div>}
      <div className="dialog-footer"><button className="secondary-button" onClick={() => setModal(null)}><ArrowLeft size={15}/>{t('Back to workspace', '返回工作台')}</button><span>{t('Local-first · No account needed', '本地优先 · 无需账号')}</span></div>
    </dialog>
  </div>;
}
