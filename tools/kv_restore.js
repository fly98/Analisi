// Ripristina il KV iCompta dalla copia off-site in icompta_backup/.
// Usa _manifest.json se presente (restore completo, ogni chiave); altrimenti
// fallback legacy: meta + tx 2001-2030.
const fs = require('fs');
const { execFileSync } = require('child_process');

const NSID = '1d8d7db930004f9eaa73e17af65b0957';
const DIR = 'icompta_backup';

function put(key, path) {
  execFileSync('wrangler', ['kv', 'key', 'put', '--namespace-id=' + NSID, key, '--path', path], { stdio: 'inherit' });
}

if (fs.existsSync(DIR + '/_manifest.json')) {
  const m = JSON.parse(fs.readFileSync(DIR + '/_manifest.json', 'utf8'));
  console.log('Restore da manifest: ' + m.manifest.length + ' chiavi');
  let done = 0;
  for (const e of m.manifest) {
    const p = DIR + '/' + e.file;
    if (!fs.existsSync(p)) { console.log('manca:', p); continue; }
    console.log('restore', e.key);
    put(e.key, p);
    done++;
  }
  console.log('Restore completato: ' + done + ' chiavi.');
} else {
  console.log('Nessun manifest: restore legacy meta + tx 2001-2030');
  if (fs.existsSync(DIR + '/meta.json')) put('icompta:meta', DIR + '/meta.json');
  for (let y = 2001; y <= 2030; y++) {
    const p = DIR + '/tx_' + y + '.json';
    if (fs.existsSync(p)) put('icompta:tx:' + y, p);
  }
  console.log('Restore legacy completato.');
}
