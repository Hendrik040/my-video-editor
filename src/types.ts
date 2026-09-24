export type Kind = 'note' | 'keep' | 'change';
export type Asset = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  status: 'review' | 'changes' | 'approved';
  sourcePath?: string | null;
  cameraProxyPath?: string | null;
  sourceIn?: number | null;
  sourceOut?: number | null;
  keepCount?: number;
  commentCount: number;
  openCount: number;
  createdAt: string;
};
export type Project = { id: string; name: string; description: string; assets: Asset[] };
export type Comment = {
  id: string;
  assetId: string;
  parentId: string | null;
  author: string;
  body: string;
  time: number;
  endTime: number | null;
  kind: Kind;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
};
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'The studio is not responding.' }));
    throw new Error(error.error || 'Could not save. Please try again.');
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export function timecode(t: number, precise = false) {
  const s = Math.max(0, t || 0);
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}${
    precise
      ? '.' +
        Math.floor((s % 1) * 100)
          .toString()
          .padStart(2, '0')
      : ''
  }`;
}
export function parseTime(value: string) {
  if (!/^\d+(?::[0-5]\d)?(?:\.\d{1,3})?$/.test(value.trim())) return NaN;
  const parts = value.split(':').map(Number);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
}
export function savedName() {
  try {
    return localStorage.getItem('cutroom-reviewer') || 'Hendrik';
  } catch {
    return 'Hendrik';
  }
}
