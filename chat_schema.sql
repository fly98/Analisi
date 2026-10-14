CREATE TABLE IF NOT EXISTS messaggi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  h TEXT NOT NULL UNIQUE,
  tel TEXT NOT NULL DEFAULT '',
  booking_id TEXT NOT NULL DEFAULT '',
  canale TEXT NOT NULL,
  dir TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT '',
  ts_approx INTEGER NOT NULL DEFAULT 0,
  testo TEXT NOT NULL,
  lingua TEXT,
  testo_it TEXT,
  creato INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS msg_tel ON messaggi(tel, ts);
CREATE INDEX IF NOT EXISTS msg_bk ON messaggi(booking_id, ts);
CREATE INDEX IF NOT EXISTS msg_da_tradurre ON messaggi(lingua);

-- ChatI1: una riga per numero, con il nome come WhatsApp lo mostra (rubrica o numero)
CREATE TABLE IF NOT EXISTS conversazioni (
  tel TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  letta_il INTEGER NOT NULL DEFAULT 0
);

-- numero completo (con prefisso) di ogni conversazione: la chiave interna e' solo di 9 cifre
CREATE TABLE IF NOT EXISTS contatti (
  tel TEXT PRIMARY KEY,
  completo TEXT NOT NULL DEFAULT ''
);

-- aggiornamento incrementale: com'era la riga nell'elenco di WhatsApp l'ultima volta che la chat e' stata letta.
-- firma_nuova viene vista nell'elenco, firma diventa quella buona solo quando la chat e' stata letta davvero.
CREATE TABLE IF NOT EXISTS lettura_wa (
  titolo TEXT PRIMARY KEY,
  firma TEXT NOT NULL DEFAULT '',
  firma_nuova TEXT NOT NULL DEFAULT '',
  letta_il INTEGER NOT NULL DEFAULT 0
);

-- lingua della chat scelta a mano (se manca, si usa quella dei messaggi dell'ospite)
CREATE TABLE IF NOT EXISTS lingue (
  tel TEXT PRIMARY KEY,
  lingua TEXT NOT NULL DEFAULT ''
);

-- messaggi che ho inviato dall'app: testo mandato (tradotto) e originale italiano. Quando WhatsApp
-- lo restituisce alla lettura successiva, si ritrova per testo e si abbina all'italiano.
CREATE TABLE IF NOT EXISTS inviati (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tel TEXT NOT NULL,
  testo TEXT NOT NULL,
  it TEXT NOT NULL DEFAULT '',
  lingua TEXT NOT NULL DEFAULT '',
  creato INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS inviati_tel ON inviati(tel, creato);
