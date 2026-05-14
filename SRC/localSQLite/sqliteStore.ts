import { getAuthToken } from './auth';

type Filter = { field: string; op: string; value: any };
type Order = { field: string; direction: 'asc' | 'desc' };
type QuerySpec = {
  collectionName: string;
  filters: Filter[];
  orderBy?: Order;
  limit?: number;
};

type DocRef = { collectionName: string; id: string };
type CollectionRef = { collectionName: string };

class LocalTimestamp {
  private value: string;

  constructor(value: string) {
    this.value = value;
  }

  toDate() {
    return new Date(this.value);
  }

  toJSON() {
    return this.value;
  }
}

async function api(path: string, options: RequestInit = {}) {
  const token = getAuthToken();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || 'Error de base de datos SQLite');
  }
  return reviveDates(body);
}

function reviveDates(value: any): any {
  if (Array.isArray(value)) return value.map(reviveDates);
  if (!value || typeof value !== 'object') return value;
  const revived: any = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      typeof child === 'string' &&
      ['date', 'createdAt', 'updatedAt'].includes(key) &&
      !Number.isNaN(Date.parse(child))
    ) {
      revived[key] = new LocalTimestamp(child);
    } else {
      revived[key] = reviveDates(child);
    }
  }
  return revived;
}

function cleanForJson(value: any): any {
  if (Array.isArray(value)) return value.map(cleanForJson);
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== 'object') return value;
  if (value.__op) return value;
  const cleaned: any = {};
  for (const [key, child] of Object.entries(value)) {
    cleaned[key] = cleanForJson(child);
  }
  return cleaned;
}

export function getSQLiteDatabase() {
  return { type: 'sqlite' };
}

export function collection(_db: any, collectionName: string): CollectionRef {
  return { collectionName };
}

export function doc(_db: any, collectionName: string, id: string): DocRef {
  return { collectionName, id };
}

export function where(field: string, op: string, value: any): Filter {
  return { field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): Order {
  return { field, direction };
}

export function limit(value: number) {
  return { type: 'limit', value };
}

export function query(base: CollectionRef, ...constraints: any[]): QuerySpec {
  const spec: QuerySpec = { collectionName: base.collectionName, filters: [] };
  for (const constraint of constraints) {
    if (!constraint) continue;
    if ('op' in constraint) spec.filters.push(constraint);
    if ('direction' in constraint) spec.orderBy = constraint;
    if (constraint.type === 'limit') spec.limit = constraint.value;
  }
  return spec;
}

function normalizeSpec(refOrQuery: CollectionRef | QuerySpec): QuerySpec {
  if ('filters' in refOrQuery) return refOrQuery;
  return { collectionName: refOrQuery.collectionName, filters: [] };
}

export async function getDocs(refOrQuery: CollectionRef | QuerySpec) {
  const spec = normalizeSpec(refOrQuery);
  const result = await api(`/documents/${encodeURIComponent(spec.collectionName)}?q=${encodeURIComponent(JSON.stringify(spec))}`);
  const docs = (result.documents || []).map((document: any) => ({
    id: document.id,
    ref: { collectionName: spec.collectionName, id: document.id },
    data: () => ({ ...document }),
    exists: () => true,
  }));
  return {
    docs,
    empty: docs.length === 0,
    forEach(callback: (doc: any) => void) {
      docs.forEach(callback);
    },
  };
}

export const getDocsFromServer = getDocs;

export async function searchDocuments(collectionName: string, term: string, maxResults = 25) {
  const result = await api(
    `/search/${encodeURIComponent(collectionName)}?term=${encodeURIComponent(term)}&limit=${encodeURIComponent(String(maxResults))}`
  );
  return (result.documents || []).map((document: any) => ({ ...document }));
}

export async function getDocFromServer(ref: DocRef) {
  let result;
  try {
    result = await api(`/documents/${encodeURIComponent(ref.collectionName)}/${encodeURIComponent(ref.id)}`);
  } catch {
    return {
      id: ref.id,
      exists: () => false,
      data: () => undefined,
    };
  }
  return {
    id: ref.id,
    exists: () => Boolean(result.exists),
    data: () => result.document,
  };
}

export async function addDoc(ref: CollectionRef, data: any) {
  const result = await api(`/documents/${encodeURIComponent(ref.collectionName)}`, {
    method: 'POST',
    body: JSON.stringify({ data: cleanForJson(data) }),
  });
  return { id: result.id };
}

export async function setDoc(ref: DocRef, data: any, options?: { merge?: boolean }) {
  await api(`/documents/${encodeURIComponent(ref.collectionName)}/${encodeURIComponent(ref.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ data: cleanForJson(data), merge: Boolean(options?.merge) }),
  });
}

export async function updateDoc(ref: DocRef, data: any) {
  await api(`/documents/${encodeURIComponent(ref.collectionName)}/${encodeURIComponent(ref.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ data: cleanForJson(data) }),
  });
}

export async function deleteDoc(ref: DocRef) {
  await api(`/documents/${encodeURIComponent(ref.collectionName)}/${encodeURIComponent(ref.id)}`, {
    method: 'DELETE',
  });
}

export function onSnapshot(refOrQuery: CollectionRef | QuerySpec, optionsOrNext: any, maybeNext?: any, maybeError?: any) {
  const next = typeof optionsOrNext === 'function' ? optionsOrNext : maybeNext;
  const error = typeof optionsOrNext === 'function' ? maybeNext : maybeError;
  let active = true;

  const load = async () => {
    try {
      if (!active) return;
      next(await getDocs(refOrQuery));
    } catch (err) {
      if (error) error(err);
    }
  };

  load();
  const interval = window.setInterval(load, 2500);
  return () => {
    active = false;
    window.clearInterval(interval);
  };
}

export function increment(amount: number) {
  return { __op: 'increment', amount };
}

export function serverTimestamp() {
  return { __op: 'serverTimestamp' };
}

export function writeBatch(_db: any) {
  const operations: any[] = [];
  return {
    set(ref: DocRef, data: any, options?: { merge?: boolean }) {
      operations.push({
        type: 'set',
        collectionName: ref.collectionName,
        id: ref.id,
        data: cleanForJson(data),
        merge: Boolean(options?.merge),
      });
    },
    update(ref: DocRef, data: any) {
      operations.push({
        type: 'update',
        collectionName: ref.collectionName,
        id: ref.id,
        data: cleanForJson(data),
      });
    },
    delete(ref: DocRef) {
      operations.push({
        type: 'delete',
        collectionName: ref.collectionName,
        id: ref.id,
      });
    },
    async commit() {
      await api('/batch', {
        method: 'POST',
        body: JSON.stringify({ operations }),
      });
    },
  };
}
