import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

export const PRIVATE_DATA_LOCK_MESSAGE = 'Private data restore is in progress. Refresh after it finishes. 私人数据正在恢复，请完成后刷新。';
export interface PrivateDataReadVersion { generation: string | null }

/** null is an absent marker, not an empty or unreadable generation file. */
async function generation(root: string): Promise<PrivateDataReadVersion | null> {
  const filename = path.join(root, 'data/private/exports/.restore-generation');
  try {
    let info;
    try { info = await lstat(filename); }
    catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { generation: null } : null;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > 128) return null;
    const bytes = await readFile(filename);
    const value = bytes.toString('utf8');
    if (bytes.length === 0 || bytes.length > 128 || !value.trim() || !Buffer.from(value, 'utf8').equals(bytes)) return null;
    return { generation: value };
  } catch { return null; }
}

/** Any lock entry or inability to inspect it closes reads; its contents are not trusted. */
export async function privateDataLocked(root: string): Promise<boolean> {
  try { await lstat(path.join(root, 'data/private/exports/.restore-lock')); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ENOENT'; }
}

type PrivateDataResponse = {
  writeHead(status: number, headers: Record<string, string>): unknown; end(body?: string): unknown;
};
function denyRead(method: string | undefined, response: PrivateDataResponse): void {
  const body = JSON.stringify({ nodes: [], datasets: [], treeDatasets: [], treeLibrary: [], error: PRIVATE_DATA_LOCK_MESSAGE, errors: [PRIVATE_DATA_LOCK_MESSAGE] });
  response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '1', 'X-Content-Type-Options': 'nosniff' });
  response.end(method === 'HEAD' ? undefined : body);
}

/** Capture the epoch before checking the lock, so a complete restore cannot hide between awaits. */
export async function beginPrivateDataRead(root: string, method: string | undefined, response: PrivateDataResponse): Promise<PrivateDataReadVersion | null> {
  const version = await generation(root);
  if (!version || await privateDataLocked(root)) { denyRead(method, response); return null; }
  return version;
}

/** A restore/rollback that began and completed during the scan still changes the durable epoch. */
export async function stopForPrivateDataRestore(root: string, method: string | undefined, response: PrivateDataResponse, initial: PrivateDataReadVersion): Promise<boolean> {
  const current = await generation(root);
  if (current && current.generation === initial.generation && !await privateDataLocked(root)) return false;
  denyRead(method, response);
  return true;
}
