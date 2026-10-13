import type { ReferenceRange } from './reference-ranges';
import { studyQueryKey, studySourceKey, type StudyDatasetBinding, type StudyReferenceBinding } from './study-session';

export function bindStudyDataset(dataset: {id: string; name: string; source: StudyDatasetBinding['source']}): StudyDatasetBinding {
  return { datasetId: dataset.id, datasetName: dataset.name, source: structuredClone(dataset.source) };
}
export function matchesStudyDataset(binding: StudyDatasetBinding, dataset: {id: string; source: StudyDatasetBinding['source']}): boolean {
  try { return binding.datasetId === dataset.id && studySourceKey(binding.source) === studySourceKey(dataset.source); }
  catch { return false; }
}
export function bindStudyReference(node: ReferenceRange): StudyReferenceBinding {
  return { chartId: node.id, refId: node.refId, source: structuredClone(node.source), provenance: node.provenance,
    sourcePlayers: node.sourcePlayers, page: node.page, precision: node.precision, actions: structuredClone(node.actions) };
}
export function matchesStudyReference(binding: StudyReferenceBinding, node: ReferenceRange): boolean {
  try {
    const query = { view: 'reference' as const, selection: { players: node.players, kind: node.kind, hero: node.hero, villain: node.villain }, hand: 'AA' };
    return studyQueryKey({ ...query, binding }) === studyQueryKey({ ...query, binding: bindStudyReference(node) });
  } catch { return false; }
}
