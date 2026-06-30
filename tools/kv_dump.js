// Dump completo del KV iCompta in icompta_backup/ (copia off-site per disaster recovery).
// Sovrascrive i file esistenti; Git deduplica i contenuti invariati (anni vecchi).
// I backup in-KV (prefisso "backup:") vengono saltati: sono ridondanti e pesanti.
const fs = require('fs');
const { execFileSync } = require('child_process');

const NSID = '1d8d7db930004f9eaa73e17af65b0957';
const OUT = 'icompta_backup';

function wr(args) {
  return execFileSync('wrangler', args, { maxBuffer: 1024 * 1024 * 256 });
}
function listKeys() {
  const raw = wr(['kv', 'key', 'list', '--namespace-id=' + NSID]).toString('utf8');
  return JSON.parse(raw).map((k) => k.name);
}
function getVal(name) {
  return wr(['kv', 'key', 'get', '--namespace-id=' + NSID, name]); // Buffer
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(OUT + '/keys', { recursive: true });

const keys = listKeys();
const manifest = [];
let skipped = 0, errors = 0;

for (const name of keys) {
  if (name.startsWith('backup:')) { skipped++; continue; }
  let val;
  try { val = getVal(name); }
  catch (e) { console.error('GET fallita:', name, e.message); errors++; continue; }

  let file;
  const tx = name.match(/^icompta:tx:(\d{4})$/);
  if (name === 'icompta:meta') file = 'meta.json';
  else if (tx) file = 'tx_' + tx[1] + '.json';
  else file = 'keys/' + name.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json';

  // Sicurezza: meta e tx DEVONO essere JSON validi, altrimenti abortiamo (no dump corrotto)
  if (file === 'meta.json' || file.startsWith('tx_')) {
    try { JSON.parse(val.toString('utf8')); }
    catch (e) { console.error('Valore non-JSON per', name, '— abort dump'); process.exit(1); }
  }

  fs.writeFileSync(OUT + '/' + file, val);
  manifest.push({ key: name, file });
}

fs.writeFileSync(OUT + '/_manifest.json', JSON.stringify({
  generato: new Date().toISOString(),
  chiavi: manifest.length,
  skippati_backup: skipped,
  errori: errors,
  manifest
}, null, 2));

console.log('Dump OK: ' + manifest.length + ' chiavi, ' + skipped + ' backup saltati, ' + errors + ' errori.');
if (errors > 0) process.exit(1);
