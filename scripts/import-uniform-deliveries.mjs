import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import XLSX from 'xlsx';

const workbookPath = process.argv[2] || 'C:/Users/elnig/Downloads/extraccion_entrega_uniformes-COMPLETO.xlsx';
const dbPath = process.argv[3] || path.resolve('data/epp-control.sqlite');
const outputDir = path.resolve('outputs');
const reportPath = path.join(outputDir, 'reporte_importacion_uniformes.xlsx');
const sourceKey = 'extraccion_entrega_uniformes-COMPLETO';

const nowIso = () => new Date().toISOString();
const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/\s+/g, ' ')
  .trim();
const compact = (value) => normalize(value).replace(/[^A-Z0-9]/g, '');

function normalizeId(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  return digits ? String(Number(digits)) : raw.toUpperCase();
}

function normalizeSize(value) {
  let size = normalize(value)
    .replace(/^SIZE\s+/, '')
    .replace(/^TALLA\s+/, '')
    .replace(/\s+/g, '')
    .replace(/^XXXL$/, '3XL')
    .replace(/^XXL$/, '2XL')
    .replace(/^X-L$/, 'XL')
    .replace(/^2-XL$/, '2XL')
    .replace(/^3-XL$/, '3XL')
    .replace(/^4-XL$/, '4XL')
    .replace(/^5-XL$/, '5XL');
  const match = size.match(/(5XL|4XL|3XL|2XL|XL|L|M|S|XS|\d{2})/);
  return match ? match[1] : '';
}

function parseUniformCell(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parts = raw
    .replace(/\//g, '-')
    .split('-')
    .map(part => part.trim())
    .filter(Boolean);
  let quantity = Number.parseInt(parts[0], 10);
  if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;
  let size = '';
  let color = '';
  for (const part of parts.slice(1)) {
    const normalizedPart = normalize(part);
    const maybeSize = normalizeSize(normalizedPart);
    if (!size && maybeSize) {
      size = maybeSize;
    } else if (normalizedPart) {
      color = normalizedPart;
    }
  }
  return { raw, quantity, size, color };
}

function getInitials(name) {
  const words = normalize(name).split(/\s+/).filter(Boolean);
  return words.slice(0, 3).map(word => word[0]).join('') || 'EPP';
}

function signatureFor(name) {
  const initials = getInitials(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="180" viewBox="0 0 420 180"><rect width="420" height="180" fill="white"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-family="Brush Script MT, Segoe Script, cursive" font-size="72" fill="#111827">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function classifyPoloColor(employee, requestedColor = '') {
  const text = normalize(`${employee.department || ''} ${employee.position || ''}`);
  if (/(MECHANIC|MECHANICAL|MECANIC|MECANICO|MECANICA|TECHNICIAN|TECNIC|TECNICO|ELECTRIC|MAINTENANCE|MANTENIMIENTO)/.test(text)) return 'AZUL';
  if (/(TRUCK|DRIVER|CHOFER|OPERATOR|OPERADOR|RTG|GRUA|CRANE|EQUIPMENT|EQUIPO|FORKLIFT|TOP LOADER|STACKER|TRACTOR)/.test(text)) return 'AMA';
  if (/AZU|AZUL/.test(requestedColor)) return 'AZUL';
  return 'AMA';
}

function itemText(item) {
  return compact(`${item.name} ${item.category} ${item.size}`);
}

function exactSizeMatches(catalogItem, size) {
  const wanted = normalizeSize(size);
  if (!wanted) return false;
  const explicit = normalizeSize(catalogItem.size);
  if (explicit && explicit !== '0') return explicit === wanted;
  const text = normalize(`${catalogItem.name} ${catalogItem.category}`);
  const variants = wanted === '2XL' ? ['2XL', '2 XL', 'XXL'] :
    wanted === '3XL' ? ['3XL', '3 XL', 'XXXL'] :
    wanted === '4XL' ? ['4XL', '4 XL'] :
    wanted === '5XL' ? ['5XL', '5 XL'] :
    [wanted];
  return variants.some(variant => new RegExp(`(^|[^A-Z0-9])${variant.replace(/\s+/g, '\\s*')}([^A-Z0-9]|$)`, 'i').test(text));
}

function findCatalog(catalog, kind, size, color) {
  const wantedColor = normalize(color);
  const candidates = catalog.filter(item => {
    const text = itemText(item);
    if (!exactSizeMatches(item, size)) return false;
    if (kind === 'polo') {
      if (!text.includes('POLO')) return false;
      if (wantedColor === 'AZUL') return text.includes('AZUL') && !text.includes('BLANCO') && !text.includes('ROJO');
      return text.includes('AMAR') || text.includes('POLA');
    }
    if (kind === 'pantalon') {
      return text.includes('PANTAL') || /^PAN[DR]/i.test(String(item.name || ''));
    }
    return false;
  });
  const scored = candidates.map(item => {
    const name = normalize(item.name);
    const category = normalize(item.category);
    let score = Number(item.stock || 0) > 0 ? 10 : 0;
    if (kind === 'polo' && wantedColor === 'AZUL' && /^POLAZ/i.test(item.name || '')) score += 50;
    if (kind === 'polo' && wantedColor === 'AMA' && /^POLA/i.test(item.name || '') && !/^POLAZ/i.test(item.name || '')) score += 50;
    if (kind === 'pantalon' && /^PAND/i.test(item.name || '')) score += 50;
    if (kind === 'pantalon' && category.includes('RODILLAS')) score -= 5;
    return { item, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.item || null;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function resolveDeliveryDate(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  const now = new Date();
  if (!Number.isNaN(parsed.getTime()) && parsed <= addDays(now, 1)) return parsed;
  return now;
}

function makeDeliveryId(rowIndex, employeeId, items) {
  const hash = crypto.createHash('sha1').update(JSON.stringify(items)).digest('hex').slice(0, 10);
  return `import-uniformes-completo-${rowIndex}-${employeeId}-${hash}`;
}

function getUniformFamily(name) {
  const text = normalize(name);
  if (/POLO|SHIRT|CAMISA/.test(text)) return 'polo';
  if (/PANTAL/.test(text)) return 'pantalon';
  return null;
}

function buildUniformWarnings(employeeId, items, deliveryDate, allDeliveries) {
  const warnings = [];
  for (const item of items) {
    const family = getUniformFamily(item.eppName);
    if (!family) continue;
    let recentQty = 0;
    let lastDate = null;
    let lastItemName = '';
    for (const delivery of allDeliveries) {
      if (delivery.employeeId !== employeeId) continue;
      const date = new Date(delivery.date);
      if (Number.isNaN(date.getTime()) || date > deliveryDate) continue;
      const days = Math.floor(Math.abs(deliveryDate.getTime() - date.getTime()) / 86400000);
      if (days >= 45) continue;
      for (const previousItem of delivery.items || []) {
        if (getUniformFamily(previousItem.eppName) === family) {
          recentQty += Number(previousItem.quantity || 1);
          if (!lastDate || date > lastDate) {
            lastDate = date;
            lastItemName = previousItem.eppName;
          }
        }
      }
    }
    if (recentQty + Number(item.quantity || 1) > 2 && lastDate) {
      warnings.push(`ALERTA DE UNIFORME: EPP entregado "${item.eppName}" supera 2 unidades recientes para este colaborador (${recentQty} previas + ${item.quantity} actuales). Entrega anterior relacionada: "${lastItemName || 'uniforme'}" (${lastDate.toLocaleDateString()}).`);
    }
  }
  return warnings;
}

const db = await open({ filename: dbPath, driver: sqlite3.Database });
await db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

const employees = (await db.all("SELECT id, data FROM documents WHERE collection_name = 'employees'"))
  .map(row => ({ docId: row.id, data: JSON.parse(row.data) }));
const employeesById = new Map();
for (const employee of employees) {
  employeesById.set(normalizeId(employee.data.id || employee.docId), employee);
}

const catalog = (await db.all("SELECT id, data FROM documents WHERE collection_name = 'epp_catalog'"))
  .map(row => ({ ...JSON.parse(row.data), id: row.id }));
const existingDeliveries = (await db.all("SELECT id, data FROM documents WHERE collection_name = 'deliveries'"))
  .map(row => ({ docId: row.id, ...JSON.parse(row.data) }));

const wb = XLSX.readFile(workbookPath, { cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets.Extraccion, { defval: '' });

const imported = [];
const notFound = [];
const ignored = [];
const noCatalog = [];
const alertsCreated = [];
const stockUpdates = new Map();
const deliveryDocs = [];
const allDeliveriesForAlerts = [...existingDeliveries];

for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const rowNumber = index + 2;
  const employeeId = normalizeId(row.ID);
  if (!employeeId) {
    ignored.push({ rowNumber, reason: 'Fila sin ID', rawId: row.ID || '' });
    continue;
  }
  const employee = employeesById.get(employeeId);
  if (!employee) {
    notFound.push({ rowNumber, id: employeeId, reason: 'ID no encontrado en employees' });
    continue;
  }

  const polo = parseUniformCell(row.Poloshirt);
  const pants = parseUniformCell(row.Pantalon);
  if (!polo && !pants) {
    ignored.push({ rowNumber, id: employeeId, employeeName: employee.data.fullName, reason: 'Sin Poloshirt ni Pantalon' });
    continue;
  }

  const items = [];
  const catalogIssues = [];
  if (polo) {
    const color = classifyPoloColor(employee.data, polo.color);
    const item = findCatalog(catalog, 'polo', polo.size, color);
    if (!polo.size || !item) {
      catalogIssues.push({ rowNumber, id: employeeId, employeeName: employee.data.fullName, kind: 'Poloshirt', raw: polo.raw, size: polo.size, color, reason: !polo.size ? 'Sin talla legible' : 'No se encontro EPP en catalogo' });
    } else {
      items.push({ eppId: item.id, eppName: item.category || item.name, eppSize: item.size && item.size !== '0' ? item.size : polo.size, quantity: polo.quantity, sourceRaw: polo.raw, resolvedColor: color });
    }
  }
  if (pants) {
    const item = findCatalog(catalog, 'pantalon', pants.size, '');
    if (!pants.size || !item) {
      catalogIssues.push({ rowNumber, id: employeeId, employeeName: employee.data.fullName, kind: 'Pantalon', raw: pants.raw, size: pants.size, color: '', reason: !pants.size ? 'Sin talla legible' : 'No se encontro EPP en catalogo' });
    } else {
      items.push({ eppId: item.id, eppName: item.category || item.name, eppSize: item.size && item.size !== '0' ? item.size : pants.size, quantity: pants.quantity, sourceRaw: pants.raw, resolvedColor: 'AZUL' });
    }
  }

  if (catalogIssues.length > 0) noCatalog.push(...catalogIssues);
  if (items.length === 0) continue;

  const deliveryId = makeDeliveryId(rowNumber, employee.data.id, items);
  const exists = existingDeliveries.some(delivery => delivery.docId === deliveryId || delivery.id === deliveryId);
  if (exists) {
    ignored.push({ rowNumber, id: employeeId, employeeName: employee.data.fullName, reason: 'Entrega ya importada previamente' });
    continue;
  }

  const deliveryDate = resolveDeliveryDate(row.fecha);
  const signature = signatureFor(employee.data.fullName);
  const delivery = {
    id: deliveryId,
    employeeId: employee.data.id,
    employeeName: employee.data.fullName,
    items: items.map(({ eppId, eppName, eppSize, quantity }) => ({ eppId, eppName, eppSize, quantity })),
    type: 'nuevo',
    date: deliveryDate.toISOString(),
    signature,
    createdByEmail: 'importacion.uniformes@local',
    createdByName: 'Importacion de uniformes Excel',
    createdAt: nowIso(),
    source: sourceKey,
  };
  deliveryDocs.push(delivery);
  allDeliveriesForAlerts.push(delivery);

  for (const item of delivery.items) {
    stockUpdates.set(item.eppId, (stockUpdates.get(item.eppId) || 0) + Number(item.quantity || 1));
  }

  const warnings = buildUniformWarnings(delivery.employeeId, delivery.items, deliveryDate, allDeliveriesForAlerts.filter(d => d.id !== deliveryId && d.docId !== deliveryId));
  for (const item of delivery.items) {
    const catalogItem = catalog.find(c => c.id === item.eppId);
    const pendingQty = stockUpdates.get(item.eppId) || 0;
    const remaining = Number(catalogItem?.stock || 0) - pendingQty;
    if (remaining <= 10) warnings.push(`⚠️ ALERTA DE STOCK: El artículo "${item.eppName}" tiene poco stock (${remaining} unidades restantes).`);
  }
  if (warnings.length > 0) {
    const alertId = `alert-${deliveryId}`;
    alertsCreated.push({
      id: alertId,
      employeeId: delivery.employeeId,
      employeeName: delivery.employeeName,
      warnings,
      items: delivery.items,
      date: delivery.date,
      status: 'pendiente',
      source: sourceKey,
    });
  }

  imported.push({
    rowNumber,
    id: delivery.employeeId,
    employeeName: delivery.employeeName,
    department: employee.data.department || employee.data.position || '',
    items: delivery.items.map(item => `${item.eppName} (${item.eppSize}) x${item.quantity}`).join(' / '),
    alerts: warnings.join(' | '),
  });
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(path.resolve('data/backups'), { recursive: true });
const backupPath = path.resolve('data/backups', `epp-control-before-uniform-import-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
fs.copyFileSync(dbPath, backupPath);

await db.exec('BEGIN IMMEDIATE TRANSACTION;');
try {
  const now = nowIso();
  for (const delivery of deliveryDocs) {
    await db.run(
      `INSERT INTO documents (collection_name, id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(collection_name, id) DO NOTHING`,
      'deliveries',
      delivery.id,
      JSON.stringify(delivery),
      now,
      now,
    );
  }
  for (const alert of alertsCreated) {
    await db.run(
      `INSERT INTO documents (collection_name, id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(collection_name, id) DO NOTHING`,
      'alerts',
      alert.id,
      JSON.stringify(alert),
      now,
      now,
    );
  }
  for (const [eppId, quantity] of stockUpdates.entries()) {
    const catalogItem = catalog.find(item => item.id === eppId);
    if (!catalogItem) continue;
    const next = { ...catalogItem, stock: Number(catalogItem.stock || 0) - quantity, updatedAt: now };
    await db.run(
      `UPDATE documents SET data = ?, updated_at = ? WHERE collection_name = 'epp_catalog' AND id = ?`,
      JSON.stringify(next),
      now,
      eppId,
    );
  }
  await db.exec('COMMIT;');
} catch (error) {
  await db.exec('ROLLBACK;');
  throw error;
}
await db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
await db.close();

fs.mkdirSync(outputDir, { recursive: true });
const reportWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(reportWb, XLSX.utils.json_to_sheet(imported), 'Importados');
XLSX.utils.book_append_sheet(reportWb, XLSX.utils.json_to_sheet(notFound), 'IDs no encontrados');
XLSX.utils.book_append_sheet(reportWb, XLSX.utils.json_to_sheet(noCatalog), 'Sin match catalogo');
XLSX.utils.book_append_sheet(reportWb, XLSX.utils.json_to_sheet(ignored), 'Ignorados');
XLSX.writeFile(reportWb, reportPath);

console.log(JSON.stringify({
  source: workbookPath,
  dbPath,
  reportPath,
  backupPath,
  importedDeliveries: deliveryDocs.length,
  importedRows: imported.length,
  alertsCreated: alertsCreated.length,
  stockItemsUpdated: stockUpdates.size,
  notFound: notFound.length,
  noCatalog: noCatalog.length,
  ignored: ignored.length,
}, null, 2));
