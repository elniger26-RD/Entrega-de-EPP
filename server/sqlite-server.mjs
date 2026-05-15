import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.SQLITE_DB_PATH || path.join(DATA_DIR, 'epp-control.sqlite');
const PORT = Number(process.env.PORT || process.env.API_PORT || 3001);
const SUPERADMIN_EMAIL = 'elniger26@gmail.com';
const DEFAULT_ADMIN_PASSWORD = process.env.SQLITE_ADMIN_PASSWORD || 'Admin123!';
const DEFAULT_DELIVERY_PASSWORD = process.env.SQLITE_DELIVERY_PASSWORD || 'Marcos2026!';
const DEFAULT_DELIVERY_USERS = [
  {
    email: 'marcosmartinezparedes077@gmail.com',
    name: 'Marcos Martinez Paredes',
  },
  {
    email: 'marcosmartenezparedes077@gmail.com',
    name: 'Marcos Martinez Paredes',
  },
];

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = await open({
  filename: DB_PATH,
  driver: sqlite3.Database,
});

await db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS documents (
    collection_name TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (collection_name, id)
  );

  CREATE TABLE IF NOT EXISTS local_users (
    email TEXT PRIMARY KEY,
    name TEXT,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (email) REFERENCES local_users(email) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection_name);
  CREATE INDEX IF NOT EXISTS idx_documents_json_id ON documents(collection_name, json_extract(data, '$.id'));
  CREATE INDEX IF NOT EXISTS idx_documents_employee_name ON documents(collection_name, json_extract(data, '$.fullName'));
  CREATE INDEX IF NOT EXISTS idx_documents_epp_name ON documents(collection_name, json_extract(data, '$.name'));
  CREATE INDEX IF NOT EXISTS idx_documents_employee_id ON documents(collection_name, json_extract(data, '$.employeeId'));
  CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(collection_name, json_extract(data, '$.date'));
`);

const nowIso = () => new Date().toISOString();
const normalizeEmail = (email = '') => String(email).trim().toLowerCase();
const jsonClone = (value) => JSON.parse(JSON.stringify(value ?? null));

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const attempted = crypto.scryptSync(String(password), salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === attempted.length && crypto.timingSafeEqual(stored, attempted);
}

async function getDocument(collectionName, id) {
  const row = await db.get(
    'SELECT data FROM documents WHERE collection_name = ? AND id = ?',
    collectionName,
    id,
  );
  return row ? JSON.parse(row.data) : null;
}

async function putDocument(collectionName, id, data, merge = false) {
  const existing = merge ? await getDocument(collectionName, id) : null;
  const payload = normalizeForStorage({
    ...(existing || {}),
    ...jsonClone(data),
    id,
  });
  await db.run(
    `INSERT INTO documents (collection_name, id, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(collection_name, id)
     DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    collectionName,
    id,
    JSON.stringify(payload),
    nowIso(),
    nowIso(),
  );
  return payload;
}

async function patchDocument(collectionName, id, patch) {
  const existing = await getDocument(collectionName, id);
  if (!existing) {
    const error = new Error('Documento no encontrado');
    error.status = 404;
    throw error;
  }

  const updated = { ...existing };
  for (const [key, value] of Object.entries(jsonClone(patch))) {
    if (value && value.__op === 'increment') {
      updated[key] = Number(updated[key] || 0) + Number(value.amount || 0);
    } else {
      updated[key] = value;
    }
  }

  return putDocument(collectionName, id, updated, false);
}

function normalizeForStorage(value) {
  if (Array.isArray(value)) return value.map(normalizeForStorage);
  if (!value || typeof value !== 'object') return value;
  if (value.__op === 'serverTimestamp') return nowIso();
  if (value.__op === 'increment') return value;
  const normalized = {};
  for (const [key, child] of Object.entries(value)) {
    normalized[key] = normalizeForStorage(child);
  }
  return normalized;
}

async function listDocuments(collectionName, options = {}) {
  const filters = Array.isArray(options.filters) ? options.filters : [];
  const whereParts = ['collection_name = ?'];
  const params = [collectionName];

  for (const filter of filters) {
    const field = safeJsonField(filter.field);
    if (!field || !['==', '>=', '<='].includes(filter.op)) continue;
    whereParts.push(`COALESCE(json_extract(data, '$.${field}'), '') ${filter.op === '==' ? '=' : filter.op} ?`);
    params.push(String(filter.value ?? ''));
  }

  let sql = `SELECT id, data FROM documents WHERE ${whereParts.join(' AND ')}`;
  if (options.orderBy?.field) {
    const field = safeJsonField(options.orderBy.field);
    if (field) {
      sql += ` ORDER BY COALESCE(json_extract(data, '$.${field}'), '') ${options.orderBy.direction === 'desc' ? 'DESC' : 'ASC'}`;
    }
  }

  if (Number.isFinite(Number(options.limit))) {
    sql += ' LIMIT ?';
    params.push(Math.max(0, Number(options.limit)));
  }

  const rows = await db.all(sql, params);
  return rows.map((row) => ({ id: row.id, ...JSON.parse(row.data) }));
}

async function searchDocuments(collectionName, term, limit = 25) {
  const cleanTerm = String(term || '').trim();
  if (!cleanTerm) return [];

  const searchable = `LOWER(id || ' ' || data)`;
  const compactSearchable = `LOWER(REPLACE(REPLACE(REPLACE(id || data, '-', ''), '_', ''), ' ', ''))`;
  const normalizedTerm = cleanTerm.toLowerCase();
  const compactTerm = normalizedTerm.replace(/[-_\s]/g, '');
  const tokens = normalizedTerm.split(/\s+/).filter(Boolean).slice(0, 8);
  const tokenClauses = tokens.map(() => `(${searchable} LIKE ? OR ${compactSearchable} LIKE ?)`);
  const whereSearch = tokenClauses.length > 0 ? `AND ${tokenClauses.join(' AND ')}` : '';
  const searchParams = tokens.flatMap((token) => {
    const compactToken = token.replace(/[-_\s]/g, '');
    return [`%${token}%`, `%${compactToken}%`];
  });

  const rows = await db.all(
    `SELECT id, data
     FROM documents
     WHERE collection_name = ?
       ${whereSearch}
     ORDER BY
       CASE
         WHEN LOWER(id) = ? THEN 0
         WHEN LOWER(id) LIKE ? THEN 1
         WHEN ${compactSearchable} LIKE ? THEN 2
         WHEN ${searchable} LIKE ? THEN 3
         ELSE 4
       END,
       id ASC
     LIMIT ?`,
    collectionName,
    ...searchParams,
    normalizedTerm,
    `${normalizedTerm}%`,
    `${compactTerm}%`,
    `%${normalizedTerm}%`,
    Math.max(1, Math.min(200, Number(limit) || 25)),
  );

  return rows.map((row) => ({ id: row.id, ...JSON.parse(row.data) }));
}

function safeJsonField(field) {
  const value = String(field || '');
  return /^[A-Za-z0-9_]+$/.test(value) ? value : null;
}

async function ensureBootstrapData() {
  const { salt, hash } = hashPassword(DEFAULT_ADMIN_PASSWORD);
  await db.run(
    `INSERT INTO local_users (email, name, password_hash, salt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO NOTHING`,
    SUPERADMIN_EMAIL,
    'Admin Principal',
    hash,
    salt,
    nowIso(),
    nowIso(),
  );

  for (const deliveryUser of DEFAULT_DELIVERY_USERS) {
    const email = normalizeEmail(deliveryUser.email);
    const { salt: userSalt, hash: userHash } = hashPassword(DEFAULT_DELIVERY_PASSWORD);
    await db.run(
      `INSERT INTO local_users (email, name, password_hash, salt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO NOTHING`,
      email,
      deliveryUser.name,
      userHash,
      userSalt,
      nowIso(),
      nowIso(),
    );

    await putDocument('authorized_users', email, {
      id: email,
      email,
      role: 'user',
      name: deliveryUser.name,
      createdAt: nowIso(),
    }, true);
  }

  await putDocument('authorized_users', SUPERADMIN_EMAIL, {
    id: SUPERADMIN_EMAIL,
    email: SUPERADMIN_EMAIL,
    role: 'admin',
    name: 'Admin Principal',
    createdAt: nowIso(),
  }, true);

  await putDocument('test', 'connection', { id: 'connection', ok: true, updatedAt: nowIso() }, true);
}

await ensureBootstrapData();

const app = express();
app.use(express.json({ limit: '25mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: DB_PATH });
});

async function currentUserFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const row = await db.get(
    `SELECT local_users.email, local_users.name
     FROM sessions
     JOIN local_users ON local_users.email = sessions.email
     WHERE sessions.token = ? AND sessions.expires_at > ?`,
    token,
    nowIso(),
  );
  if (!row) return null;
  const authorized = await getDocument('authorized_users', row.email);
  return {
    uid: row.email,
    email: row.email,
    displayName: row.name || authorized?.name || row.email,
    role: authorized?.role || 'user',
  };
}

async function requireAuth(req, res, next) {
  const user = await currentUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  req.user = user;
  next();
}

function isAdmin(user) {
  return user?.email === SUPERADMIN_EMAIL || user?.role === 'admin';
}

function canWriteCollection(user, collectionName, method) {
  if (isAdmin(user)) return true;
  if (['deliveries', 'alerts', 'employees'].includes(collectionName)) return true;
  if (collectionName === 'epp_catalog' && method === 'PATCH') return true;
  return false;
}

app.post('/api/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const row = await db.get('SELECT * FROM local_users WHERE email = ?', email);
  if (!row || !verifyPassword(password, row.salt, row.password_hash)) {
    return res.status(401).json({ code: 'auth/invalid-credential', error: 'Credenciales invalidas' });
  }
  const authorized = await getDocument('authorized_users', email);
  if (!authorized && email !== SUPERADMIN_EMAIL) {
    return res.status(403).json({ code: 'auth/not-authorized', error: 'Usuario no autorizado' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await db.run('INSERT INTO sessions (token, email, expires_at) VALUES (?, ?, ?)', token, email, expiresAt);
  res.json({ token, user: userPayload(email, row.name || authorized?.name) });
});

app.post('/api/auth/google', async (_req, res) => {
  const email = SUPERADMIN_EMAIL;
  const row = await db.get('SELECT * FROM local_users WHERE email = ?', email);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  await db.run('INSERT INTO sessions (token, email, expires_at) VALUES (?, ?, ?)', token, email, expiresAt);
  res.json({ token, user: userPayload(email, row?.name || 'Admin Principal') });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  await db.run('DELETE FROM sessions WHERE token = ?', token);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ user: userPayload(req.user.email, req.user.displayName) });
});

app.post('/api/auth/users', requireAuth, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!email || password.length < 6) {
    return res.status(400).json({ code: 'auth/weak-password', error: 'Correo o contrasena invalida' });
  }
  const { salt, hash } = hashPassword(password);
  await db.run(
    `INSERT INTO local_users (email, name, password_hash, salt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
    email,
    req.body.name || email,
    hash,
    salt,
    nowIso(),
    nowIso(),
  );
  res.json({ user: userPayload(email, req.body.name || email) });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const row = await db.get('SELECT email FROM local_users WHERE email = ?', email);
  if (!row) return res.status(404).json({ code: 'auth/user-not-found', error: 'Usuario no encontrado' });
  res.json({ ok: true, message: 'El restablecimiento local debe hacerlo un administrador.' });
});

app.get('/api/documents/:collectionName', requireAuth, async (req, res, next) => {
  try {
    const options = req.query.q ? JSON.parse(String(req.query.q)) : {};
    res.json({ documents: await listDocuments(req.params.collectionName, options) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/search/:collectionName', requireAuth, async (req, res, next) => {
  try {
    res.json({
      documents: await searchDocuments(req.params.collectionName, req.query.term, req.query.limit),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/documents/:collectionName/:id', requireAuth, async (req, res) => {
  const data = await getDocument(req.params.collectionName, req.params.id);
  if (!data) return res.status(404).json({ exists: false });
  res.json({ exists: true, document: { id: req.params.id, ...data } });
});

app.post('/api/documents/:collectionName', requireAuth, async (req, res, next) => {
  try {
    if (!canWriteCollection(req.user, req.params.collectionName, 'POST')) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    const id = req.body.id || crypto.randomUUID();
    const document = await putDocument(req.params.collectionName, id, req.body.data || {}, false);
    res.status(201).json({ id, document });
  } catch (error) {
    next(error);
  }
});

app.put('/api/documents/:collectionName/:id', requireAuth, async (req, res, next) => {
  try {
    if (!canWriteCollection(req.user, req.params.collectionName, 'PUT')) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    const document = await putDocument(
      req.params.collectionName,
      req.params.id,
      req.body.data || {},
      Boolean(req.body.merge),
    );
    res.json({ document });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/documents/:collectionName/:id', requireAuth, async (req, res, next) => {
  try {
    if (!canWriteCollection(req.user, req.params.collectionName, 'PATCH')) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    const document = await patchDocument(req.params.collectionName, req.params.id, req.body.data || {});
    res.json({ document });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/documents/:collectionName/:id', requireAuth, async (req, res, next) => {
  try {
    if (!canWriteCollection(req.user, req.params.collectionName, 'DELETE')) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    await db.run(
      'DELETE FROM documents WHERE collection_name = ? AND id = ?',
      req.params.collectionName,
      req.params.id,
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/batch', requireAuth, async (req, res, next) => {
  const operations = Array.isArray(req.body.operations) ? req.body.operations : [];
  try {
    await db.exec('BEGIN');
    for (const operation of operations) {
      const method = operation.type === 'delete' ? 'DELETE' : operation.type === 'update' ? 'PATCH' : 'PUT';
      if (!canWriteCollection(req.user, operation.collectionName, method)) {
        const error = new Error('Permisos insuficientes');
        error.status = 403;
        throw error;
      }
      if (operation.type === 'delete') {
        await db.run('DELETE FROM documents WHERE collection_name = ? AND id = ?', operation.collectionName, operation.id);
      } else if (operation.type === 'update') {
        await patchDocument(operation.collectionName, operation.id, operation.data || {});
      } else {
        await putDocument(operation.collectionName, operation.id, operation.data || {}, Boolean(operation.merge));
      }
    }
    await db.exec('COMMIT');
    res.json({ ok: true, count: operations.length });
  } catch (error) {
    await db.exec('ROLLBACK');
    next(error);
  }
});

const DIST_DIR = path.join(ROOT, 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

function userPayload(email, name) {
  return {
    uid: email,
    email,
    emailVerified: true,
    isAnonymous: false,
    tenantId: null,
    displayName: name || email,
    providerData: [{
      providerId: 'sqlite',
      displayName: name || email,
      email,
      photoURL: null,
    }],
  };
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Error interno' });
});

app.listen(PORT, () => {
  console.log(`SQLite API listening on http://127.0.0.1:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Superadmin: ${SUPERADMIN_EMAIL} / ${DEFAULT_ADMIN_PASSWORD}`);
});
