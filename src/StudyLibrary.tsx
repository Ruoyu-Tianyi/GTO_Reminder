import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Bookmark, RotateCcw, Trash2, Upload } from 'lucide-react';
import { getPositions } from './lib/poker';
import { replayPreflop } from './lib/preflop';
import { REFERENCE_KIND_LABELS } from './lib/display-ranges';
import {
  MAX_STUDY_JSON_BYTES, mergeStudyCollections, parseStudyCollection, serializeStudyCollection, studyQueryKey,
  type StudyBookmark, type StudyCollection, type StudyQuery,
} from './lib/study-session';
import './study.css';

type Translate = (en: string, zh: string) => string;
export interface StudyLibraryProps {
  t: Translate;
  collection: StudyCollection;
  onChange: (next: StudyCollection) => void;
  onOpen: (query: StudyQuery) => void;
  storageError?: string;
}

function QueryDetails({ query, t }: { query: StudyQuery; t: Translate }) {
  if (query.view === 'reference') return <>
    <p className="study-conditions">{query.selection.players}-max · 100 BB · {query.selection.hero}{query.selection.villain ? ` vs ${query.selection.villain}` : ''} · {REFERENCE_KIND_LABELS[query.selection.kind]}</p>
    {query.binding && <p className="study-source">{query.binding.source.title} · PDF {query.binding.page}{query.binding.provenance === 'seat-projection' ? t(' · 8 → 7 seat projection; not an independent solve', ' · 8 → 7 座位投影，并非独立求解') : ''}</p>}
  </>;
  if (query.view === 'quick') return <p className="study-conditions">{query.spot.players}-max · {query.spot.stackBb} BB · {query.spot.format === 'cash' ? 'Cash' : 'MTT'} · {query.spot.hero}{query.spot.villain ? ` vs ${query.spot.villain}` : ''} · {REFERENCE_KIND_LABELS[query.spot.kind]}<br/>Ante {query.spot.anteBb} BB · {query.spot.rake}<br/>{t('Size controls', '尺寸设置')} {query.spot.openSizeBb} / {query.spot.threeBetSizeBb} / {query.spot.fourBetSizeBb} BB</p>;
  const state = replayPreflop(query.game, query.history);
  const stacks = getPositions(query.game.players).map(position => [position, query.game.stacksBb?.[position] ?? query.game.stackBb] as const);
  const uniform = new Set(stacks.map(([, stack]) => stack)).size === 1;
  return <>
    <p className="study-conditions">{query.game.players}-max · {uniform ? `${stacks[0][1]} BB` : t('Mixed stacks', '不同后手')} · Cash · Ante {query.game.anteBb} BB · {query.game.rake}</p>
    {!uniform && <p className="study-conditions">{stacks.map(([position, stack]) => `${position} ${stack} BB`).join(' · ')}</p>}
    <details className="study-history"><summary>{query.history.length} {t('recorded actions', '个已记录行动')} · {state.nextActor ? `${state.nextActor} ${t('to act', '行动')}` : t('Preflop complete', '翻前结束')}</summary>
      {query.history.length ? <ol>{query.history.map((action, index) => <li key={index}>{action.actor} · {action.type === 'raise' ? `Raise ${action.amountBb} BB` : action.type === 'fold' ? 'Fold' : action.type === 'call' ? 'Call' : 'Check'}</li>)}</ol> : <p>{t('Blinds posted. No voluntary action yet.', '盲注已投入，尚无主动行动。')}</p>}
    </details>
  </>;
}

export default function StudyLibrary({ t, collection, onChange, onOpen, storageError }: StudyLibraryProps) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [deleted, setDeleted] = useState<StudyBookmark | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentCollection = useRef(collection);
  const operation = useRef(0);
  const mounted = useRef(true);
  currentCollection.current = collection;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current++; }; }, []);

  async function importBookmarks(file: File | undefined) {
    if (!file) return;
    const request = ++operation.current;
    setImporting(true); setError(''); setMessage('');
    try {
      if (file.size > MAX_STUDY_JSON_BYTES) throw new Error(t('Use a bookmark file no larger than 2 MB.', '请使用不超过 2 MB 的收藏文件。'));
      const json = await file.text();
      if (!mounted.current || request !== operation.current) return;
      const merged = mergeStudyCollections(currentCollection.current, parseStudyCollection(json));
      onChange(merged.collection);
      setMessage(t(`Added ${merged.added}; skipped ${merged.duplicates} exact duplicates. Your existing bookmarks were kept.`, `新增 ${merged.added} 条，跳过 ${merged.duplicates} 条完全相同的收藏，原有收藏已保留。`));
    } catch (error) {
      if (mounted.current && request === operation.current) setError(error instanceof Error ? error.message : t('Bookmark import failed.', '收藏导入失败。'));
    } finally {
      if (mounted.current && request === operation.current) { setImporting(false); if (fileInput.current) fileInput.current.value = ''; }
    }
  }
  function exportBookmarks() {
    try {
      const json = serializeStudyCollection(currentCollection.current);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `gto-study-bookmarks-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError(''); setMessage(t('Exported query conditions and source metadata. Strategy frequencies are not included.', '已导出查询条件与来源信息，文件不包含策略频率。'));
    } catch (error) { setError(error instanceof Error ? error.message : t('Bookmark export failed.', '收藏导出失败。')); }
  }
  function removeBookmark(entry: StudyBookmark) {
    const key = studyQueryKey(entry.query);
    onChange({ ...currentCollection.current, bookmarks: currentCollection.current.bookmarks.filter(item => studyQueryKey(item.query) !== key) });
    setDeleted(entry); setError(''); setMessage(t('Bookmark removed. You can undo this deletion below.', '已删除收藏，可在下方撤销。'));
  }
  function undoDelete() {
    if (!deleted) return;
    try {
      const merged = mergeStudyCollections(currentCollection.current, { schemaVersion: 1, kind: 'gto-study-bookmarks', bookmarks: [deleted] });
      onChange(merged.collection); setDeleted(null); setError(''); setMessage(t('Bookmark restored.', '收藏已恢复。'));
    } catch (error) { setError(error instanceof Error ? error.message : t('Could not restore bookmark.', '无法恢复收藏。')); }
  }

  return <section className="study-library" aria-label={t('Study bookmarks', '学习收藏')}>
    <div className="study-header"><div><h2><Bookmark size={21}/>{t('Keep a study spot', '收藏值得复习的场景')}</h2><p>{t('Save a query from any workspace, then return to the same seats, actions, hand, and source. Export this list to carry your study spots between computers.', '在各模块收藏查询，即可回到相同的位置、行动、手牌与来源。导出收藏清单，把学习场景带到另一台电脑。')}</p></div>
      <div className="study-tools"><button className="secondary-button" disabled={importing} onClick={() => fileInput.current?.click()}><Upload size={14}/>{importing ? t('Importing…', '正在导入…') : t('Import bookmarks', '导入收藏')}</button><button className="secondary-button" disabled={!collection.bookmarks.length} onClick={exportBookmarks}><ArrowDownToLine size={14}/>{t('Export bookmarks', '导出收藏')}</button><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => void importBookmarks(event.target.files?.[0])}/></div>
    </div>
    <p className="study-note">{t('This file stores conditions and source identities. It does not copy strategy frequencies. Matching private data must also be present on the other computer; a missing or changed source never switches to a different model automatically.', '收藏文件保存条件与来源身份，不复制策略频率。另一台电脑仍需放入相应私人数据；来源缺失或改变时，不会自动改用其他模型。')}</p>
    {storageError && <div role="alert" className="study-error"><strong>{t('Browser storage is unavailable; keep an exported copy.', '浏览器未能保存，请导出一份备份。')}</strong><p>{storageError}</p></div>}
    {error && <p className="study-error" role="alert">{error}</p>}
    {message && <p className="study-message" role="status">{message}</p>}
    {deleted && <button className="text-button study-undo" onClick={undoDelete}><RotateCcw size={13}/>{t('Undo last deletion', '撤销上次删除')} · {deleted.label}</button>}
    <p className="study-count">{collection.bookmarks.length} / 200 {t('bookmarks', '条收藏')}</p>
    {collection.bookmarks.length === 0 ? <div className="panel study-empty"><Bookmark size={28}/><h3>{t('Your next review starts here', '把下次要复习的场景留在这里')}</h3><p>{t('Open a reference, an action history, or a Quick lookup, then choose “Save this spot”.', '打开参考范围、完整行动历史或快捷查询，然后点击“收藏当前场景”。')}</p></div> : <div className="study-grid">{collection.bookmarks.map(entry => {
      const query = entry.query;
      const label = query.view === 'reference' ? t('REFERENCE', '参考范围') : query.view === 'tree' ? t('ACTION HISTORY', '完整历史') : t('QUICK LOOKUP', '快捷查询');
      return <article className="panel study-card" key={studyQueryKey(query)}><div className="study-card-top"><span className="study-view">{label}</span><strong className="study-hand">{query.hand}</strong></div><h3>{entry.label}</h3>
        <QueryDetails query={query} t={t}/>
        {query.view !== 'reference' && query.binding && <p className="study-source">{query.binding.datasetName} · {query.binding.source.kind === 'computed' ? query.binding.source.computation?.status === 'unconverged' ? t('Unconverged model', '未确认收敛模型') : t('Model approximation', '模型近似解') : query.binding.source.kind === 'demo' ? t('Demo only', '仅作演示') : t('Imported source', '外部导入')}<br/>{t('Source snapshot', '来源快照')} · {query.binding.source.retrievedAt}</p>}
        {!query.binding && <p className="study-source">{t('No source bound. Opens the saved query without selecting a model.', '未绑定来源，只恢复查询条件，不选择计算模型。')}</p>}
        <div className="study-card-actions"><button className="primary-button" onClick={() => onOpen(query)}>{t('Open query', '打开查询')}<ArrowUpRight size={14}/></button><button className="text-button" aria-label={t(`Delete bookmark ${entry.label}`, `删除收藏 ${entry.label}`)} onClick={() => removeBookmark(entry)}><Trash2 size={13}/>{t('Delete', '删除')}</button></div>
      </article>;
    })}</div>}
  </section>;
}
