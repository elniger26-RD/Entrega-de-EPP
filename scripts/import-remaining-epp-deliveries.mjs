import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import XLSX from 'xlsx';

const workbookPath = process.argv[2] || 'C:/Users/elnig/Downloads/extraccion_entrega_uniformes-COMPLETO.xlsx';
const dbPath = process.argv[3] || path.resolve('data/epp-control.sqlite');
const outputDir = path.resolve('outputs');
const reportPath = path.join(outputDir, 'reporte_importacion_epp_restante.xlsx');
const sourceKey = 'extraccion_entrega_uniformes-COMPLETO-otros-epp';

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
  const size = normalize(value)
    .replace(/^SIZE\s+/, '')
    .replace(/^TALLA\s+/, '')
    .replace(/\s+/g, '')
    .replace(/^XXXL$/, '3XL')
    .replace(/^XXL$/, '2XL')
    .replace(/^2-XL$/, '2XL')
    .replace(/^3-XL$/, '3XL');
  const match = size.match(/(5XL|4XL|3XL|2XL|XL|L|M|S|XS|\d{2})/);
  return match ? match[1] : '';
}

function parseQtySize(value, mode = 'qty-size') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (mode === 'size-only') return { raw, quantity: 1, size: normalizeSize(raw) };
  if (mode === 'qty-only') {
    const quantity = Number.parseInt(raw, 10);
    return { raw, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1, size: '' };
  }
  const parts = raw.replace(/\//g, '-').split('-').map(part => part.trim()).filter(Boolean);
  const quantity = Number.parseInt(parts[0], 10);
  const size = normalizeSize(parts.slice(1).join('-') || raw);
  return { raw, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1, size };
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

function exactSizeMatches(catalogItem, size) {
  const wanted = normalizeSize(size);
  if (!wanted) return true;
  const explicit = normalizeSize(catalogItem.size);
  if (explicit && explicit !== '0') return explicit === wanted;
  const text = normalize(`${catalogItem.name} ${catalogItem.category}`);
  const variants = wanted === '2XL' ? ['2XL', '2 XL', 'XXL'] :
    wanted === '3XL' ? ['3XL', '3 XL', 'XXXL'] :
    [wanted];
  return variants.some(variant => new RegExp(`(^|[^A-Z0-9])${variant.replace(/\s+/g, '\\s*')}([^A-Z0-9]|$)`, 'i').test(text));
}

function scoreCatalogItem(item, kind, size) {
  const text = compact(`${item.name} ${item.category}`);
  let score = Number(item.stock || 0) > 0 ? 10 : 0;
  if (!exactSizeMatches(item, size)) return -9999;
  if (kind === 'casco') {
    if (!text.includes('CASCO')) return -9999;
    if (text.includes('AMARILLO')) score += 60;
    if (text.includes('SUSPENSION') || text.includes('BARBIQUEJO')) score -= 80;
  }
  if (kind === 'chaleco') {
    if (!text.includes('CHALECO')) return -9999;
    if (text.includes('NARANJA')) score += 60;
    if (text.includes('SALVAVIDAS')) score -= 40;
  }
  if (kind === 'botas') {
    if (!text.includes('BOTA')) return -9999;
    if (text.includes('NEGRO')) score += 60;
    if (text.includes('DIELECTRICA')) score -= 30;
  }
  if (kind === 'lentes') {
    if (!text.includes('LENTE')) return -9999;
    if (text.includes('CLARO')) score += 60;
  }
  if (kind === 'guantes') {
    if (!text.includes('GUANTE')) return -9999;
    if (text.includes('HYFLEX')) score += 70;
  }
  if (kind === 'protector_ruido') {
    if (!text.includes('RUIDO') && !text.includes('TAPON')) return -9999;
    if (text.includes('TAPON')) score += 60;
  }
  if (kind === 'faja') {
    if (!text.includes('FAJA')) return -9999;
  }
  if (kind === 'capa') {
    if (!text.includes('CAPA') && !text.includes('IMPERMEABLE')) return -9999;
  }
  return score;
}

function findCatalog(catalog, kind, size = '') {
  return catalog
    .map(item => ({ item, score: scoreCatalogItem(item, kind, size) }))
    .filter(entry => entry.score > -9999)
    .sort((a, b) => b.score - a.score)[0]?.item || null;
}

function resolveDeliveryDate(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  const now = new Date();
  if (!Number.isNaN(parsed.getTime()) && parsed <= new Date(now.getTime() + 86400000)) return parsed;
  return now;
}

function makeDeliveryId(rowNumber, employeeId, items) {
  const hash = crypto.createHash('sha1').update(JSON.stringify(items)).digest('hex').slice(0, 10);
  return `import-otros-epp-completo-${rowNumber}-${employeeId}-${hash}`;
}

function itemKindForAlerts(item) {
  const text = compact(item.eppName);
  if (text.includes('BOTA')) return { family: 'botas', days: 180, label: 'BOTAS' };
  if (text.includes('HYFLEX')) return { family: 'hyflex', days: 15, label: 'GUANTES HYFLEX' };
  if (text.includes('CIA')) return { family: 'cia', days: 45, label: 'GUANTES CIA' };
  if (text.includes('GUANTE')) return { family: 'guantes', days: 45, label: 'GUANTES' };
  if (text.includes('FAJA')) return { family: 'faja', days: 45, label: 'FAJA' };
  return null;
}

function buildWarnings(employeeId, items, deliveryDate, allDeliveries, catalog, pendingStockUpdates) {
  const warnings = [];
  for (const item of items) {
    const policy = itemKindForAlerts(item);
    if (policy) {
      let lastDate = null;
      let lastItemName = '';
      for (const delivery of allDeliveries) {
        if (delivery.employeeId !== employeeId) continue;
        const date = new Date(delivery.date);
        if (Number.isNaN(date.getTime()) || date > deliveryDate) continue;
        for (const previousItem of delivery.items || []) {
          const previousPolicy = itemKindForAlerts(previousItem);
          if (previousPolicy?.family === policy.family && (!lastDate || date > lastDate)) {
            lastDate = date;
            lastItemName = previousItem.eppName;
          }
        }
      }
      if (lastDate) {
        const days = Math.floor(Math.abs(deliveryDate.getTime() - lastDate.getTime()) / 86400000);
        if (days < policy.days) {
          warnings.push(`ALERTA DE ${policy.label}: EPP entregado "${item.eppName}" genera alerta por entrega anterior relacionada "${lastItemName || policy.label}" hace ${days === 0 ? '0' : days} dias. Periodo minimo: ${policy.days} dias.`);
        }
      }
    }
    const catalogItem = catalog.find(entry => entry.id === item.eppId);
    const remaining = Number(catalogItem?.stock || 0) - Number(pendingStockUpdates.get(item.eppId) || 0);
    if (remaining <= 10) warnings.push(`⚠️ ALERTA DE STOCK: El artículo "${item.eppName}" tiene poco stock (${remaining} unidades restantes).`);
  }
  return warnings;
}

const db = await open({ filename: dbPath, driver: sqlite3.Database });
await db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

const employees = (await db.all("SELECT id, data FROM documents WHERE collection_name = 'employees'")).map(row => ({ docId: row.id, data: JSON.parse(row.data) }));
const employeesById = new Map(employees.map(employee => [normalizeId(employee.data.id || employee.docId), employee]));
const catalog = (await db.all("SELECT id, data FROM documents WHERE collection_name = 'epp_catalog'")).map(row => ({ ...JSON.parse(row.data), id: row.id }));
const existingDeliveries = (await db.all("SELECT id, data FROM documents WHERE collection_name = 'deliveries'")).map(row => ({ docId: row.id, ...JSON.parse(row.data) }));
const uniformSourceRows = new Set(existingDeliveries.filter(delivery => delivery.source === 'extraccion_entrega_uniformes-COMPLETO').map(delivery => Number(String(delivery.id || '').split('-')[3])));

const wb = XLSX.readFile(workbookPath, { cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets.Extraccion, { defval: '' });

const columns = [
  { key: 'CASCO', kind: 'casco', mode: 'qty-only', label: 'Casco' },
  { key: 'Chaleco', kind: 'chaleco', mode: 'qty-size', label: 'Chaleco' },
  { key: 'botas Size', kind: 'botas', mode: 'size-only', label: 'Botas' },
  { key: 'Lentes', kind: 'lentes', mode: 'qty-only', label: 'Lentes' },
  { key: 'Guantes', kind: 'guantes', mode: 'qty-only', label: 'Guantes' },
  { key: 'Protec de ruido', kind: 'protector_ruido', mode: 'qty-only', label: 'Protector de ruido' },
  { key: 'Faja', kind: 'faja', mode: 'qty-size', label: 'Faja' },
  { key: 'CAPAS', kind: 'capa', mode: 'qty-size', label: 'Capas' },
];

const imported = [];
const noCatalog = [];
const notFound = [];
const ignored = [];
const alertsCreated = [];
const deliveryDocs = [];
const stockUpdates = new Map();
const allDeliveriesForAlerts = [...existingDeliveries];

for (let index = 0; index < rows.length; index++) {
  const rowNumber = index + 2;
  if (uniformSourceRows.has(rowNumber)) continue;
  const row = rows[index];
  const employeeId = normalizeId(row.ID);
  if (!employeeId) {
    ignored.push({ rowNumber, reason: 'Fila sin ID' });
    continue;
  }
  const employee = employeesById.get(employeeId);
  if (!employee) {
    notFound.push({ rowNumber, id: employeeId, reason: 'ID no encontrado en employees' });
    continue;
  }

  const items = [];
  for (const column of columns) {
    const parsed = parseQtySize(row[column.key], column.mode);
    if (!parsed) continue;
    const catalogItem = findCatalog(catalog, column.kind, parsed.size);
    if (!catalogItem) {
      noCatalog.push({ rowNumber, id: employeeId, employeeName: employee.data.fullName, epp: column.label, raw: parsed.raw, size: parsed.size, reason: 'No se encontro EPP en catalogo' });
      continue;
    }
    const size = catalogItem.size && catalogItem.size !== '0' ? catalogItem.size : parsed.size || '';
    items.push({
      eppId: catalogItem.id,
      eppName: catalogItem.category || catalogItem.name,
      eppSize: size,
      quantity: parsed.quantity,
      sourceColumn: column.key,
      sourceRaw: parsed.raw,
    });
  }

  if (items.length === 0) {
    ignored.push({ rowNumber, id: employeeId, employeeName: employee.data.fullName, reason: 'Sin otros EPP procesables' });
    continue;
  }

  const deliveryId = makeDeliveryId(rowNumber, employee.data.id, items);
  if (existingDeliveries.some(delivery => delivery.id === deliveryId || delivery.docId === deliveryId)) {
    ignored.push({ rowNumber, id: employeeId, employeeName: employee.data.fullName, reason: 'Entrega ya importada previamente' });
    continue;
  }

  const deliveryDate = resolveDeliveryDate(row.fecha);
  const delivery = {
    id: deliveryId,
    employeeId: employee.data.id,
    employeeName: employee.data.fullName,
    items: items.map(({ eppId, eppName, eppSize, quantity }) => ({ eppId, eppName, eppSize, quantity })),
    type: 'nuevo',
    date: deliveryDate.toISOString(),
    signature: signatureFor(employee.data.fullName),
    createdByEmail: 'importacion.otros.epp@local',
    createdByName: 'Importacion de otros EPP Excel',
    createdAt: nowIso(),
    source: sourceKey,
  };
  deliveryDocs.push(delivery);
  for (const item of delivery.items) stockUpdates.set(item.eppId, (stockUpdates.get(item.eppId) || 0) + Number(item.quantity || 1));
  const warnings = buildWarnings(delivery.employeeId, delivery.items, deliveryDate, allDeliveriesForAlerts, catalog, stockUpdates);
  if (warnings.length > 0) {
    alertsCreated.push({
      id: `alert-${deliveryId}`,
      employeeId: delivery.employeeId,
      employeeName: delivery.employeeName,
      warnings,
      items: delivery.items,
      date: delivery.date,
      status: 'pendiente',
      source: sourceKey,
    });
  }
  allDeliveriesForAlerts.push(delivery);
  imported.push({
    rowNumber,
    id: delivery.employeeId,
    employeeName: delivery.employeeName,
    items: delivery.items.map(item => `${item.eppName} (${item.eppSize || '-'}) x${item.quantity}`).join(' / '),
    alerts: warnings.join(' | '),
  });
}

fs.mkdirSync(path.resolve('data/backups'), { recursive: true });
const backupPath = path.resolve('data/backups', `epp-control-before-other-epp-import-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
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
