import fs from 'node:fs';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import XLSX from 'xlsx';

const workbookPath = process.argv[2] || 'C:/Users/elnig/Downloads/extraccion_entrega_uniformes-COMPLETO.xlsx';
const dbPath = process.argv[3] || path.resolve('data/epp-control.sqlite');
const sources = [
  {
    source: 'extraccion_entrega_uniformes-COMPLETO',
    idPrefix: 'import-uniformes-completo-',
  },
  {
    source: 'extraccion_entrega_uniformes-COMPLETO-otros-epp',
    idPrefix: 'import-otros-epp-completo-',
  },
];

const wb = XLSX.readFile(workbookPath, { cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets.Extraccion, { defval: '' });
const dateByRowNumber = new Map();
let lastValidDate = null;
rows.forEach((row, index) => {
  const rowNumber = index + 2;
  const parsed = row.fecha instanceof Date ? row.fecha : new Date(row.fecha);
  if (!Number.isNaN(parsed.getTime())) {
    lastValidDate = parsed.toISOString();
  }
  if (lastValidDate) {
    dateByRowNumber.set(rowNumber, lastValidDate);
  }
});

function getRowNumberFromId(id, prefix) {
  if (!String(id || '').startsWith(prefix)) return null;
  const rest = String(id).slice(prefix.length);
  const row = Number.parseInt(rest.split('-')[0], 10);
  return Number.isFinite(row) ? row : null;
}

const db = await open({ filename: dbPath, driver: sqlite3.Database });
await db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

fs.mkdirSync(path.resolve('data/backups'), { recursive: true });
const backupPath = path.resolve('data/backups', `epp-control-before-import-date-sync-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
fs.copyFileSync(dbPath, backupPath);

let deliveriesUpdated = 0;
let alertsUpdated = 0;
const samples = [];
const now = new Date().toISOString();

await db.exec('BEGIN IMMEDIATE TRANSACTION;');
try {
  for (const config of sources) {
    const deliveryRows = await db.all(
      "SELECT id, data FROM documents WHERE collection_name = 'deliveries' AND json_extract(data, '$.source') = ?",
      config.source,
    );
    for (const row of deliveryRows) {
      const rowNumber = getRowNumberFromId(row.id, config.idPrefix);
      const excelDate = dateByRowNumber.get(rowNumber);
      if (!excelDate) continue;
      const data = JSON.parse(row.data);
      const previousDate = data.date;
      data.date = excelDate;
      await db.run(
        "UPDATE documents SET data = ?, updated_at = ? WHERE collection_name = 'deliveries' AND id = ?",
        JSON.stringify(data),
        now,
        row.id,
      );
      deliveriesUpdated += 1;
      if (samples.length < 5) samples.push({ id: row.id, rowNumber, previousDate, excelDate });
    }

    const alertRows = await db.all(
      "SELECT id, data FROM documents WHERE collection_name = 'alerts' AND json_extract(data, '$.source') = ?",
      config.source,
    );
    for (const row of alertRows) {
      const deliveryId = String(row.id || '').replace(/^alert-/, '');
      const rowNumber = getRowNumberFromId(deliveryId, config.idPrefix);
      const excelDate = dateByRowNumber.get(rowNumber);
      if (!excelDate) continue;
      const data = JSON.parse(row.data);
      data.date = excelDate;
      await db.run(
        "UPDATE documents SET data = ?, updated_at = ? WHERE collection_name = 'alerts' AND id = ?",
        JSON.stringify(data),
        now,
        row.id,
      );
      alertsUpdated += 1;
    }
  }
  await db.exec('COMMIT;');
} catch (error) {
  await db.exec('ROLLBACK;');
  throw error;
}

await db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
await db.close();

console.log(JSON.stringify({
  backupPath,
  deliveriesUpdated,
  alertsUpdated,
  samples,
}, null, 2));
