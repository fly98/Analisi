/* Planner Roma — motore di calcolo itinerari (InternoUno)
   Funziona nel browser (window.Planner) e in Node (module.exports). */
(function (root) {
  'use strict';

  // ---------- Macro-categorie mostrate all'ospite -> tag del database ----------
  const MACRO = {
    musei:       ['museo', 'arte'],
    chiese:      ['chiesa'],
    archeologia: ['archeologia'],
    parchi:      ['parco'],
    piazze:      ['piazza', 'fontana'],
    panorami:    ['panorama'],
    quartieri:   ['quartiere', 'passeggiata', 'architettura', 'shopping'],
    streetart:   ['street_art'],
    insolito:    ['insolito'],
    esperienze:  ['esperienza', 'cibo', 'mercato', 'spettacolo'],
    famiglia:    ['famiglia'],
  };

  // ---------- Ritmo: tetto di fatica, minuti disponibili, soglia per camminare ----------
  const RITMO = {
    rilassato: { fatica: 8,  minuti: 330, piedi: 800 },
    medio:     { fatica: 12, minuti: 450, piedi: 1500 },
    intenso:   { fatica: 16, minuti: 570, piedi: 2000 },
  };
  const INIZIO_GIORNATA = 9 * 60; // 9:00

  // ---------- Geometria ----------
  function metri(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x)) * 1.3; // +30% per le strade reali
  }
  // Spostamento tra due punti: a piedi sotto soglia, altrimenti mezzi
  function tratta(a, b, soglia) {
    const m = metri(a, b);
    if (m < 60) return { modo: 'vicino', metri: Math.round(m), minuti: 1, fatica: 0 };
    if (m <= soglia) return { modo: 'piedi', metri: Math.round(m), minuti: Math.round(m / 1000 * 13), fatica: m / 1000 * 0.6 };
    return { modo: 'mezzi', metri: Math.round(m), minuti: Math.round(15 + m / 1000 * 3), fatica: 0.4 };
  }

  // una tappa breve pesa meno di una lunga a parita' di livello
  const faticaTappa = a => a.fatica * (0.5 + Math.min(a.durata, 120) / 120);

  // versione gratuita "da fuori" di una tappa a pagamento
  function daFuori(a) {
    if (!a.esterno) return null;
    return Object.assign({}, a, { id: a.id + '_fuori', nome: a.esterno.nome || (a.nome.split(',')[0].split(' e ')[0] + ' (da fuori)'), prezzo: 0, gruppo: null,
      durata: a.esterno.durata, fatica: 1, imp: Math.max(a.esterno.imp, a.imp >= 10 ? 10 : 0), desc: a.esterno.desc, fuori: true, chiuso: false, esterno: null });
  }

  // ---------- Filtri ----------
  function tagDaMacro(macro) {
    const s = new Set();
    (macro || []).forEach(k => (MACRO[k] || []).forEach(t => s.add(t)));
    return s;
  }
  // punteggio: voto (+ bonus categorie) e, a parita', la graduatoria (vale al massimo 0,05: non scavalca mai un voto intero)
  const P = a => (a.prio != null ? a.prio : a.imp) + (a.rank ? (200 - a.rank) / 4000 : 0);
  function candidati(db, opz) {
    const tags = tagDaMacro(opz.categorie);
    const tutteCat = !opz.categorie || opz.categorie.length === 0;
    const bonus = a => (!tutteCat && a.cat.some(t => tags.has(t))) ? 1.5 : 0;
    const garantite = new Set();
    if (!tutteCat) (opz.categorie || []).forEach(m => {
      const best = db.attrazioni.filter(a => !a.chiuso && a.cat.some(t => (MACRO[m] || []).includes(t)) && (opz.soloGratis ? a.prezzo === 0 : (opz.budgetGiorno == null || a.prezzo <= opz.budgetGiorno)))
        .sort((a, b) => b.imp - a.imp || ((MACRO[m] || []).includes(b.cat[0]) ? 1 : 0) - ((MACRO[m] || []).includes(a.cat[0]) ? 1 : 0))[0];
      if (best) garantite.add(best.id);
    });
    const troppoCara = a => (opz.soloGratis && a.prezzo > 0) || (!opz.soloGratis && opz.budgetGiorno != null && a.prezzo > opz.budgetGiorno);
    const base = db.attrazioni.map(a => (a.chiuso || troppoCara(a)) ? daFuori(a) || a : a);
    const simbolo = a => (opz.imperdibiliSempre !== false && a.imp >= 10 && !a.fuori) || (opz.imperdibiliSempre !== false && a.fuori && db.attrazioni.find(x => x.id + '_fuori' === a.id && x.imp >= 10)) ? 2.5 : 0;
    return base.map(a => Object.assign({}, a, { prio: a.imp + bonus(a) + simbolo(a) + (garantite.has(a.id) ? 3 : 0) })).filter(a => {
      if (a.chiuso) return false;
      if (troppoCara(a)) return false;
      if (opz.eta >= 70 && a.fatica >= 3 && a.imp < 9) return false; // tappe pesanti solo se imperdibili
      const inCat = tutteCat || a.cat.some(t => tags.has(t));
      const imperdibile = opz.imperdibiliSempre !== false && a.imp >= 9;
      return inCat || imperdibile;
    });
  }

  function paramGiorno(opz) {
    const p = Object.assign({}, RITMO[opz.ritmo] || RITMO.medio);
    if (opz.eta >= 65) { p.fatica *= 0.8; p.minuti *= 0.9; p.piedi = Math.min(p.piedi, 1000); }
    return p;
  }

  // ---------- Ordinamento di una giornata ----------
  // percorso "vicino piu' vicino" dalla struttura; poi solo ritocchi morbidi:
  // la tappa-mattina piu' importante va in testa, sera/tramonto in coda
  function ordinaGiorno(tappe, partenza) {
    if (tappe.length < 2) return tappe.slice();
    const resto = tappe.slice(); const out = []; let pos = partenza;
    const mattine = resto.filter(a => a.momento.includes('mattina')).sort((x, y) => y.imp - x.imp || y.durata - x.durata);
    if (mattine.length) { out.push(mattine[0]); resto.splice(resto.indexOf(mattine[0]), 1); pos = mattine[0]; }
    const coda = resto.filter(a => a.momento.includes('tramonto'));
    const centro = resto.filter(a => !coda.includes(a));
    const nn = (arr) => { while (arr.length) { arr.sort((x, y) => metri(pos, x) - metri(pos, y)); const n = arr.shift(); out.push(n); pos = n; } };
    const inizio = out.length; nn(centro); dueOpt(out, inizio, partenza);
    nn(coda); // i tramonti chiudono la giornata
    return out;
  }

  // migliora il percorso invertendo tratti finche' si accorcia (2-opt)
  function dueOpt(arr, da, partenza) {
    const lung = () => { let s = 0, pos = da > 0 ? arr[da - 1] : partenza; for (let i = da; i < arr.length; i++) { s += metri(pos, arr[i]); pos = arr[i]; } return s; };
    let meglio = true, giri = 0;
    while (meglio && giri++ < 30) {
      meglio = false;
      for (let i = da; i < arr.length - 1; i++) for (let j = i + 1; j < arr.length; j++) {
        const prima = lung(); const seg = arr.slice(i, j + 1).reverse(); arr.splice(i, seg.length, ...seg);
        if (lung() + 1 < prima) meglio = true; else { const back = arr.slice(i, j + 1).reverse(); arr.splice(i, back.length, ...back); }
      }
      // sposta una singola tappa nel punto del percorso dove allunga meno
      for (let i = da; i < arr.length; i++) {
        const prima = lung(), x = arr.splice(i, 1)[0];
        let bestK = i, bestL = Infinity;
        for (let k = da; k <= arr.length; k++) { arr.splice(k, 0, x); const l = lung(); if (l < bestL) { bestL = l; bestK = k; } arr.splice(k, 1); }
        arr.splice(bestK, 0, x);
        if (bestL + 1 < prima) meglio = true;
      }
    }
  }

  // ---------- Calcolo tempi, fatica e costi di una giornata ----------
  const PRANZO_DA = 12 * 60 + 30, PRANZO_MIN = 60;
  function valutaGiorno(tappe, partenza, p, biglietti) {
    let t = INIZIO_GIORNATA, fatica = 0, costo = 0, pos = partenza, pranzo = null, mVisite = 0, mSpost = 0;
    const righe = [];
    tappe.forEach(a => {
      const tr = tratta(pos, a, p.piedi);
      t += tr.minuti; fatica += tr.fatica; mSpost += tr.minuti;
      const arrivo = t;
      t += a.durata; fatica += faticaTappa(a); mVisite += a.durata;
      let prezzo = a.prezzo || 0;
      if (a.gruppo && biglietti.has(a.gruppo)) prezzo = 0; // biglietto condiviso gia' pagato
      costo += prezzo;
      pos = a;
      righe.push({ id: a.id, nome: a.nome, arrivo, durata: a.durata, tratta: tr, prezzo, indicativo: !!a.indicativo, zona: a.zona, fuori: !!a.fuori });
      if (!pranzo && t >= PRANZO_DA) { pranzo = true; righe.push({ pranzo: true, zona: a.zona }); t += PRANZO_MIN; }
    });
    const minuti = t - INIZIO_GIORNATA - (pranzo ? PRANZO_MIN : 0);
    return { righe, minuti, visite: mVisite, spostamenti: mSpost, fine: t, fatica: Math.round(fatica * 10) / 10, costo, ultima: tappe[tappe.length - 1] || null };
  }

  function sta(val, p, budget) {
    return val.minuti <= p.minuti && val.fatica <= p.fatica && (budget == null || val.costo <= budget);
  }

  // ---------- Assegnazione delle tappe ai giorni ----------
  // 1) scelta per importanza fino a riempire la capacita' totale
  // 2) divisione per zone (k-means pesato sull'importanza)
  // 3) ogni giorno viene "stretto" finche' rispetta tempo, fatica e budget
  // 4) le tappe rimaste fuori vengono riprovate nei giorni con spazio, dal piu' vicino
  function costruisciGiorni(lista, nGiorni, partenza, opz) {
    const p = paramGiorno(opz);
    const budget = opz.soloGratis ? 0 : opz.budgetGiorno;
    const cap = { min: p.minuti * nGiorni * 1.05, fat: p.fatica * nGiorni * 1.05 };
    const scelte = [], riserva = [];
    let min = 0, fat = 0;
    lista.forEach(a => {
      const dm = a.durata + 15, df = faticaTappa(a) + 0.6;
      if (min + dm <= cap.min && fat + df <= cap.fat) { scelte.push(a); min += dm; fat += df; }
      else riserva.push(a);
    });

    // k-means: semi = le piu' importanti e lontane tra loro
    const k = Math.min(nGiorni, scelte.length || 1);
    const centri = [];
    if (scelte.length) centri.push({ lat: scelte[0].lat, lon: scelte[0].lon });
    while (centri.length < k) {
      let best = null, bestD = -1;
      scelte.forEach(a => { const d = Math.min(...centri.map(c => metri(c, a))) * P(a); if (d > bestD) { bestD = d; best = a; } });
      centri.push({ lat: best.lat, lon: best.lon });
    }
    let gruppi = [];
    for (let it = 0; it < 12; it++) {
      gruppi = centri.map(() => []);
      scelte.forEach(a => { let bi = 0, bd = Infinity; centri.forEach((c, i) => { const d = metri(c, a); if (d < bd) { bd = d; bi = i; } }); gruppi[bi].push(a); });
      gruppi.forEach((g, i) => { if (g.length) { const w = g.reduce((s, a) => s + a.imp, 0); centri[i] = { lat: g.reduce((s, a) => s + a.lat * a.imp, 0) / w, lon: g.reduce((s, a) => s + a.lon * a.imp, 0) / w }; } });
    }
    while (gruppi.length < nGiorni) gruppi.push([]);

    // stringi ogni giorno: togli la meno importante finche' non rientra
    const fuori = [];
    const giorni = gruppi.map(g => {
      let t = ordinaGiorno(g.sort((a, b) => P(b) - P(a)), partenza);
      while (t.length && !sta(valutaGiorno(t, partenza, p, new Set()), p, budget)) {
        const v = valutaGiorno(t, partenza, p, new Set());
        if (budget != null && v.costo > budget) {
          const pagata = t.filter(a => a.prezzo > 0).sort((a, b) => P(a) - P(b))[0];
          const f = pagata && daFuori(pagata);
          if (f) { f.prio = (pagata.prio || pagata.imp) - (pagata.imp - f.imp); t = ordinaGiorno(t.map(a => a === pagata ? f : a), partenza); continue; }
        }
        const via = t.slice().sort((a, b) => P(a) - P(b) || b.durata - a.durata)[0]; // si toglie sempre la meno importante
        fuori.push(via); t = ordinaGiorno(t.filter(a => a !== via), partenza);
      }
      return t;
    });

    // riempi: prima le tolte, poi la riserva, sempre dalla piu' importante, nel giorno piu' vicino con spazio
    const escluse = [];
    fuori.concat(riserva).sort((a, b) => P(b) - P(a)).forEach(a => {
      const ordine = giorni.map((g, i) => ({ i, d: g.length ? Math.min(...g.map(x => metri(x, a))) : metri(partenza, a) })).sort((x, y) => x.d - y.d);
      for (const { i, d } of ordine) {
        if (nGiorni > 1 && giorni[i].length && d > 1200) continue; // con piu' giorni: niente tappe lontane dalla zona del giorno
        const prova = ordinaGiorno(giorni[i].concat(a), partenza);
        if (sta(valutaGiorno(prova, partenza, p, new Set()), p, budget)) { giorni[i] = prova; return; }
      }
      escluse.push(a);
    });

    // ribilanciamento: per ogni esclusa, libera posto spostando una tappa "di confine" in un giorno vicino con spazio
    const vicina = (g, a) => g.length === 0 || Math.min(...g.map(x => metri(x, a))) <= 1200;
    const entra = (g, a) => vicina(g, a) && sta(valutaGiorno(ordinaGiorno(g.concat(a), partenza), partenza, p, new Set()), p, budget);
    for (let giro = 0; giro < 3; giro++) {
      let cambiato = false;
      for (const x of escluse.slice().sort((a, b) => P(b) - P(a))) {
        let fatto = false;
        const ordine = giorni.map((g, i) => ({ i, d: g.length ? Math.min(...g.map(y => metri(y, x))) : Infinity })).filter(o => o.d <= 1200).sort((a, b) => a.d - b.d);
        for (const { i } of ordine) {
          for (const y of giorni[i].slice().sort((a, b) => P(a) - P(b))) {
            const resto = giorni[i].filter(z => z !== y);
            if (!entra(resto, x)) continue;
            const dest = giorni.findIndex((g, j) => j !== i && entra(g, y));
            if (dest < 0) continue;
            giorni[i] = ordinaGiorno(resto.concat(x), partenza);
            giorni[dest] = ordinaGiorno(giorni[dest].concat(y), partenza);
            escluse.splice(escluse.indexOf(x), 1); fatto = cambiato = true; break;
          }
          if (fatto) break;
        }
      }
      if (!cambiato) break;
    }
    return { giorni, escluse, p };
  }

  // ---------- Modalita' automatica ----------
  function genera(db, opz) {
    const avvisi = [];
    const partenza = opz.partenza || { lat: 41.9085842, lon: 12.5216869 };
    const gite = (opz.gite || []).map(id => db.gite.find(g => g.id === id)).filter(Boolean);
    let giorniRoma = opz.giorni - gite.length;
    if (giorniRoma < 0) {
      avvisi.push({ k: 'troppe_gite', a: gite.length, b: opz.giorni });
      gite.length = opz.giorni; giorniRoma = 0;
    }
    if (opz.ritmo === 'rilassato') gite.filter(g => g.fatica >= 3).forEach(g => avvisi.push({ k: 'gita_faticosa', id: g.id }));

    if (opz.soloGratis) gite.filter(g => (g.costo_viaggio || 0) + (g.biglietti || 0) > 0).forEach(g => avvisi.push({ k: 'gita_costi', id: g.id, v: (g.costo_viaggio || 0) + (g.biglietti || 0) }));
    let risultato = { giorni: [], escluse: [] , p: paramGiorno(opz) };
    if (giorniRoma > 0) {
      const lista = candidati(db, opz).sort((a, b) => P(b) - P(a) || a.fatica - b.fatica);
      risultato = costruisciGiorni(lista, giorniRoma, partenza, opz);
    }
    return componi(risultato, gite, partenza, opz, avvisi, db);
  }

  // ---------- Modalita' "scelgo io" ----------
  function daSelezione(db, ids, opz) {
    const avvisi = [];
    const partenza = opz.partenza || { lat: 41.9085842, lon: 12.5216869 };
    const scelte = ids.map(id => {
      if (id.endsWith('_fuori')) { const o = db.attrazioni.find(a => a.id === id.slice(0, -6)); return o && daFuori(o); }
      return db.attrazioni.find(a => a.id === id);
    }).filter(Boolean).filter(a => !a.chiuso);
    const gite = (opz.gite || []).map(id => db.gite.find(g => g.id === id)).filter(Boolean);
    const lista = scelte.sort((a, b) => P(b) - P(a));
    // quanti giorni servono? si prova da 1 in su finche' non resta fuori niente
    let n = 1, r;
    const senzaBudget = Object.assign({}, opz, { budgetGiorno: null, soloGratis: false });
    if (opz.unGiorno) {
      // tutto in un unico percorso, senza limiti di tempo o fatica
      r = { giorni: [ordinaGiorno(lista, partenza)], escluse: [], p: paramGiorno(senzaBudget) };
      const out = componi(r, gite, partenza, senzaBudget, avvisi, db);
      const g = out.giorni[0], ore = (g.visite + g.spostamenti) / 60, cap = r.p.minuti / 60;
      if (ore > cap) out.avvisi.push({ k: 'giornata_lunga', a: Math.round(ore * 10) / 10, b: Math.round(cap * 10) / 10 });
      out.giorniNecessari = null;
      return out;
    }
    do { r = costruisciGiorni(lista, n, partenza, senzaBudget); n++; } while (r.escluse.length && n <= 14);
    const giorniNecessari = r.giorni.length + gite.length;
    const out = componi(r, gite, partenza, senzaBudget, avvisi, db);
    out.giorniNecessari = giorniNecessari;
    // se l'ospite ha indicato un numero di giorni, suggerisci cosa togliere o aggiungere
    if (opz.giorni) {
      if (giorniNecessari > opz.giorni) {
        const target = costruisciGiorni(lista, Math.max(opz.giorni - gite.length, 1), partenza, senzaBudget);
        out.daTogliere = target.escluse.map(a => a.id);
      } else if (giorniNecessari <= opz.giorni) {
        const presi = new Set(ids.map(id => id.replace(/_fuori$/, '')));
        const vicine = candidati(db, opz).filter(a => !presi.has(a.id))
          .map(a => ({ a, d: Math.min(...scelte.map(s => metri(s, a))) }))
          .filter(x => x.d < 800).sort((x, y) => y.a.imp - x.a.imp).slice(0, 5);
        out.suggerite = vicine.map(x => x.a.id);
      }
    }
    return out;
  }

  // ---------- Output finale ----------
  // quartiere per aperitivo e cena: importante e vicino a dove finisce il giro, senza ripetersi
  function scegliSerata(db, da, usati, p, visitati) {
    const zone = (db.serata || []).map(z => {
      const km = metri(da, z) / 1000;
      const giaVisto = visitati.has(z.id) ? 3 : 0; // quartiere gia' girato di giorno
      return { z, km, punti: z.imp - 1.5 * km + (z.casa ? 0.3 : 0) - (usati.has(z.id) ? 4 : 0) - giaVisto };
    }).sort((a, b) => b.punti - a.punti);
    if (!zone.length) return null;
    const best = zone[0].z; usati.add(best.id);
    return { zona: best, tratta: tratta(da, best, p.piedi) };
  }

  function componi(r, gite, partenza, opz, avvisi, db) {
    const pagati = new Set(), usati = new Set();
    const giorni = r.giorni.map((g, i) => {
      const v = valutaGiorno(g, partenza, r.p, pagati);
      g.forEach(a => { if (a.gruppo) pagati.add(a.gruppo); });
      const giorno = Object.assign({ tipo: 'roma', n: i + 1 }, v);
      if (db && (opz.serata !== false)) {
        const sr = scegliSerata(db, v.ultima || partenza, usati, r.p, new Set(g.map(a => a.id)));
        if (sr) {
          giorno.serata = { id: sr.zona.id, nome: sr.zona.nome, desc: sr.zona.desc, tipo: sr.zona.tipo, tratta: sr.tratta, casa: !!sr.zona.casa };
        }
      }
      return giorno;
    });
    gite.forEach(g => giorni.push({
      tipo: 'gita', n: giorni.length + 1, id: g.id, nome: g.nome, tappe: g.tappe, mezzo: g.mezzo,
      viaggio: g.viaggio, costo: (g.costo_viaggio || 0) + (g.biglietti || 0), desc: g.desc, note: g.note,
    }));
    const totale = giorni.reduce((s, d) => s + (d.costo || 0), 0);
    return { giorni, escluse: r.escluse.map(a => a.nome), avvisi, costoTotale: totale, ritmo: opz.ritmo };
  }

  const Planner = { genera, daSelezione, MACRO, RITMO, metri, tratta };
  if (typeof module !== 'undefined' && module.exports) module.exports = Planner;
  else root.Planner = Planner;
})(typeof window !== 'undefined' ? window : this);
