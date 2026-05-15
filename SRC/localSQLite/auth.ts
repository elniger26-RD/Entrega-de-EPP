export interface User {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  tenantId: string | null;
  displayName?: string | null;
  providerData: Array<{
    providerId: string;
    displayName: string | null;
    email: string | null;
    photoURL: string | null;
  }>;
}

type Listener = (user: User | null) => void;

const TOKEN_KEY = 'sqlite_auth_token';
const USER_KEY = 'sqlite_auth_user';
const listeners = new Set<Listener>();

export const auth = {
  currentUser: readUser(),
};

function readUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

function setSession(token: string | null, user: User | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);

  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);

  auth.currentUser = user;
  listeners.forEach(listener => listener(user));
}

export function clearAuthSession() {
  setSession(null, null);
}

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
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
    const error: any = new Error(body.error || 'Error de autenticacion');
    error.code = body.code;
    throw error;
  }
  return body;
}

export function onAuthStateChanged(_auth: typeof auth, listener: Listener) {
  listeners.add(listener);
  queueMicrotask(() => listener(auth.currentUser));
  return () => {
    listeners.delete(listener);
  };
}

export async function signInWithEmailAndPassword(_auth: typeof auth, email: string, password: string) {
  const result = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setSession(result.token, result.user);
  return { user: result.user };
}

export async function signInWithLocalAdmin() {
  const result = await api('/auth/google', { method: 'POST' });
  setSession(result.token, result.user);
  return { user: result.user };
}

export async function signOut() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    // Local logout should still clear stale sessions.
  }
  setSession(null, null);
}

export async function createUserWithEmailAndPassword(_auth: typeof auth, email: string, password: string) {
  const result = await api('/auth/users', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return { user: result.user };
}

export async function sendPasswordResetEmail(_auth: typeof auth, email: string) {
  return api('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}
