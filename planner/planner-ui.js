/* Visita Roma — interfaccia dell'organizzatore di itinerari (condivisa tra Campaldino e Lorenzo).
   Usa: Planner (planner.js), CFG, lang, trackEvent della pagina ospite. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const DB_URL = 'planner/attrazioni.json';
  const KEY_SALVATI = 'ie_itinerari';
  let DB = null;
  let stato = { vista: 'home', risultato: null, meta: null, selezione: new Set() };

  // ---------------- testi (IT; le altre lingue arriveranno dopo) ----------------
  const TX = {
    m_auto_t: 'Itinerario su misura', m_auto_d: 'Dicci giorni, budget e interessi: organizziamo noi le giornate.',
    m_scegli_t: 'Scegli tu le tappe', m_scegli_d: 'Sfoglia oltre 140 attrazioni e ti diciamo quanti giorni servono.',
    m_nostri_t: 'I nostri itinerari', m_nostri_d: 'Programmi da 1, 2 e 3 giorni preparati da noi.',
    salvati_t: 'I miei itinerari', salvati_vuoto: 'Qui ritroverai gli itinerari che salvi.',
    giorni: 'Quanti giorni hai a Roma?', eta: 'La tua età', budget: 'Biglietti d\'ingresso',
    solo_gratis: 'Solo gratis', con_budget: 'Con budget', budget_lbl: 'Massimo a persona al giorno',
    ritmo: 'Che ritmo preferisci?', r_rilassato: 'Rilassato', r_medio: 'Medio', r_intenso: 'Intenso',
    r_rilassato_d: 'Poche tappe, tempo libero', r_medio_d: 'Giornate piene ma godibili', r_intenso_d: 'Vedere il più possibile',
    interessi: 'Cosa ti interessa?', interessi_d: 'Se non scegli niente, ti proponiamo un po\' di tutto.',
    gite: 'Gite fuori porta', gite_d: 'Ognuna occupa un giorno intero.',
    crea: '✨ Crea il mio itinerario', indietro: '← Indietro',
    cerca: 'Cerca un\'attrazione…', organizza: 'Organizza', tappe_sel: 'tappe scelte',
    giorni_target: 'Giorni a disposizione (facoltativo)',
    giorno: 'Giorno', impegno: 'Impegno', visite: 'visite', spostamenti: 'spostamenti', biglietti: 'biglietti',
    gratis: 'gratis', da_fuori: 'da fuori', circa: 'circa', piedi: 'a piedi', mezzi: 'con i mezzi', accanto: 'accanto',
    pranzo: 'Pausa pranzo in zona', serata: 'Aperitivo e cena a', vicino_casa: 'vicino casa',
    mappa_giorno: '📍 Apri il percorso su Google Maps',
    salva: '💾 Salva itinerario', salvato: '✓ Salvato', nuovo: 'Nuovo itinerario', elimina: 'Elimina',
    totale: 'Totale biglietti', a_persona: 'a persona',
    gita: 'Gita fuori porta', in_treno: 'in treno', in_auto: 'in auto', treno_veloce: 'in treno veloce',
    a_tratta: 'a tratta', costo_gita: 'viaggio e ingressi circa',
    servono: 'Per vedere tutto con questo ritmo servono', giorni_n: 'giorni',
    da_togliere: 'Per starci nei tuoi giorni potresti togliere', suggerite: 'Ti avanza tempo: qui vicino ci sono anche',
    rimaste: 'altre attrazioni non ci stavano: prova ad aggiungere un giorno o un ritmo più intenso.',
    nessuna: 'Scegli almeno una tappa.',
    un_giorno: 'Tutto in un unico itinerario', un_giorno_d: 'Non dividere in giorni: un solo percorso con tutte le tappe scelte.',
    importanza: 'Importanza', importanza_d: 'Voto da 1 a 10: 10 sono le attrazioni da non perdere assolutamente, poi a scendere fino alle chicche per chi ha più tempo.',
    tutte: 'Tutte', voto: 'voto',
    note_prezzi: 'Prezzi dei biglietti interi aggiornati al 2026. Molti siti statali sono gratuiti la prima domenica del mese.',
  };
  const CAT = [
    ['musei', '🏛️ Musei'], ['chiese', '⛪ Chiese'], ['archeologia', '🏺 Archeologia'], ['parchi', '🌳 Parchi'],
    ['piazze', '⛲ Piazze e fontane'], ['panorami', '🌅 Panorami'], ['quartieri', '🏘️ Quartieri'],
    ['streetart', '🎨 Street art'], ['insolito', '🔮 Insolito'], ['esperienze', '🍝 Esperienze e cibo'], ['famiglia', '👨‍👩‍👧 Famiglia'],
  ];
  // Itinerari preparati da noi (tappe; il motore le divide nei giorni e calcola i percorsi)
  const NOSTRI = [
    { id: 'n1', giorni: 1, titolo: 'Roma in un giorno', desc: 'I simboli della città in una giornata piena, con cena a Monti.',
      tappe: ['colosseo', 'fori_imperiali', 'capitolini_fuori', 'pantheon', 'navona', 'trevi', 'spagna'] },
    { id: 'n2', giorni: 2, titolo: 'Roma in due giorni', desc: 'Un giorno per la Roma antica e il centro, uno per il Vaticano.',
      tappe: ['colosseo', 'fori_imperiali', 'capitolini_fuori', 'pantheon', 'navona', 'trevi', 'spagna',
        'musei_vaticani', 'san_pietro', 'piazza_san_pietro', 'castel_santangelo_fuori'] },
    { id: 'n3', giorni: 3, titolo: 'Roma in tre giorni', desc: 'Aggiunge il Ghetto, l\'Isola Tiberina, la Galleria Borghese e il tramonto al Pincio.',
      tappe: ['colosseo', 'fori_imperiali', 'capitolini_fuori', 'ghetto', 'isola_tiberina', 'santa_maria_trastevere',
        'musei_vaticani', 'san_pietro', 'piazza_san_pietro', 'castel_santangelo_fuori',
        'galleria_borghese', 'pincio', 'spagna', 'trevi', 'pantheon', 'navona'] },
  ];

  // ---------------- stile ----------------
  const CSS = `
  .vr-tabs{display:flex;gap:8px;padding:2px 16px 14px}
  .vr-tab{flex:1;padding:10px;border-radius:12px;border:1px solid var(--border);background:var(--surface);font:inherit;font-size:.85rem;font-weight:700;color:var(--muted);cursor:pointer}
  .vr-tab.on{background:var(--orange);border-color:var(--orange);color:#fff}
  .vr-panel{display:none}.vr-panel.on{display:block}
  .vr-mode{display:flex;gap:14px;align-items:center;width:100%;text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:10px;cursor:pointer;font:inherit;color:var(--text)}
  .vr-mode .ico{font-size:1.7rem;width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:var(--orange-bg);flex-shrink:0}
  .vr-mode h3{font-size:1rem;margin:0 0 2px}.vr-mode p{font-size:.82rem;color:var(--muted);margin:0}
  .vr-mode.main{background:linear-gradient(135deg,#2a2622,#4a3a2e);color:#fff;border:none}
  .vr-mode.main p{color:rgba(255,255,255,.75)}.vr-mode.main .ico{background:rgba(255,102,40,.25)}
  .vr-h{font-size:.95rem;font-weight:700;margin:18px 0 8px}.vr-sub{font-size:.78rem;color:var(--muted);margin:-4px 0 8px}
  .vr-seg{display:flex;gap:6px}.vr-seg button{flex:1;padding:10px 6px;border-radius:12px;border:1px solid var(--border);background:var(--surface);font:inherit;font-size:.84rem;font-weight:700;color:var(--muted);cursor:pointer}
  .vr-seg button small{display:block;font-weight:500;font-size:.68rem;margin-top:2px}
  .vr-seg button.on{background:var(--orange);border-color:var(--orange);color:#fff}
  .vr-step{display:flex;align-items:center;gap:14px}.vr-step button{width:42px;height:42px;border-radius:50%;border:1px solid var(--border-s);background:var(--surface);font-size:1.3rem;cursor:pointer}
  .vr-step b{font-size:1.4rem;min-width:28px;text-align:center}
  .vr-chips{display:flex;flex-wrap:wrap;gap:6px}.vr-chips .chip{flex-shrink:1}
  .vr-range{width:100%;accent-color:var(--orange)}
  .vr-input{width:100%;padding:11px 12px;border-radius:12px;border:1px solid var(--border-s);font:inherit;font-size:.95rem;background:var(--surface)}
  .vr-back{background:none;border:none;font:inherit;font-weight:700;color:var(--orange);padding:6px 0;cursor:pointer}
  .vr-day{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:14px 14px 8px;margin-bottom:12px}
  .vr-day h3{font-size:1.05rem;margin:0}.vr-day .sum{font-size:.78rem;color:var(--muted);margin:3px 0 10px}
  .vr-stop{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--border)}
  .vr-stop .n{width:24px;height:24px;border-radius:50%;background:var(--orange);color:#fff;font-size:.75rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
  .vr-stop .t{flex:1}.vr-stop b{font-size:.93rem}.vr-stop .m{font-size:.76rem;color:var(--muted)}.vr-stop .d{font-size:.8rem;color:var(--muted);margin-top:2px}
  .vr-move{font-size:.72rem;color:var(--faint);padding:4px 0 0 34px}
  .vr-tag{display:inline-block;font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;border-radius:6px;padding:1px 6px;margin-left:4px;vertical-align:1px;background:var(--blue-bg);color:var(--blue)}
  .vr-extra{display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--border);font-size:.85rem}
  .vr-extra .ico{width:24px;text-align:center;flex-shrink:0}
  .vr-extra.sera{background:linear-gradient(90deg,rgba(255,102,40,.08),transparent);margin:0 -14px;padding:10px 14px;border-radius:0 0 16px 16px}
  .vr-warn{background:#fff7e6;border:1px solid #f3d9a4;border-radius:12px;padding:10px 12px;font-size:.82rem;margin-bottom:10px}
  .vr-cat{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:6px;cursor:pointer}
  .vr-cat.on{border-color:var(--orange);background:var(--orange-bg)}
  .vr-cat .ck{width:22px;height:22px;border-radius:6px;border:2px solid var(--border-s);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.8rem;margin-top:1px}
  .vr-cat.on .ck{background:var(--orange);border-color:var(--orange)}
  .vr-cat b{font-size:.9rem}.vr-cat .m{font-size:.74rem;color:var(--muted)}
  .vr-voto{display:inline-block;font-size:.66rem;font-weight:800;border-radius:6px;padding:1px 6px;margin-left:4px;vertical-align:1px;background:#eee;color:#555}
  .vr-voto.vtop{background:var(--orange);color:#fff}.vr-voto.vhi{background:var(--orange-bg);color:var(--orange)}
  .vr-bar{position:sticky;bottom:calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 6px);z-index:5;margin-top:10px}
  .vr-saved{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px}
  .vr-saved .t{flex:1;cursor:pointer}.vr-saved b{font-size:.9rem}.vr-saved .m{font-size:.74rem;color:var(--muted)}
  .vr-saved button{background:none;border:none;color:var(--faint);font-size:1rem;cursor:pointer;padding:6px}
  .vr-note{font-size:.72rem;color:var(--faint);margin:6px 2px 14px}
  .vr-badge{position:relative;overflow:hidden;display:flex;align-items:center;gap:12px;width:calc(100% - 32px);margin:14px 16px 4px;padding:14px 16px;border:none;border-radius:16px;
    background:linear-gradient(120deg,#FF6628,#ff8f4f,#FF6628);background-size:200% 100%;animation:vrShift 5s ease infinite;color:#fff;font:inherit;text-align:left;cursor:pointer;box-shadow:0 6px 18px rgba(255,102,40,.35)}
  .vr-badge .spk{font-size:1.6rem;animation:vrTwinkle 1.8s ease-in-out infinite}
  .vr-badge b{display:block;font-size:1rem}.vr-badge small{font-size:.78rem;opacity:.9}
  .vr-badge::after{content:'';position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.45),transparent);animation:vrShine 3.2s ease-in-out infinite}
  @keyframes vrShift{0%,100%{background-position:0 0}50%{background-position:100% 0}}
  @keyframes vrTwinkle{0%,100%{transform:scale(1) rotate(0)}50%{transform:scale(1.18) rotate(12deg)}}
  @keyframes vrShine{0%{left:-60%}60%,100%{left:130%}}
  @media (prefers-reduced-motion:reduce){.vr-badge,.vr-badge .spk,.vr-badge::after{animation:none}}
  `;

  // ---------------- utilità ----------------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dur = m => { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`; };
  const euro = v => (Math.round(v * 100) / 100).toString().replace('.', ',') + '€';
  const track = (e, s) => { try { if (typeof trackEvent === 'function') trackEvent(e, s); } catch (x) {} };
  const partenza = () => ({ lat: CFG.lat, lon: CFG.lon });
  const leggiSalvati = () => { try { return JSON.parse(localStorage.getItem(KEY_SALVATI) || '[]'); } catch (e) { return []; } };
  const scriviSalvati = l => { try { localStorage.setItem(KEY_SALVATI, JSON.stringify(l)); } catch (e) {} };
  const trova = id => DB.attrazioni.find(a => a.id === id || a.id + '_fuori' === id);

  // ---------------- form: stato ----------------
  const form = { giorni: 2, eta: 35, gratis: false, budget: 30, ritmo: 'medio', categorie: new Set(), gite: new Set() };

  function root() { return $('#planner'); }
  function mostra(html) { root().innerHTML = html; window.scrollTo(0, $('#scr-tour').offsetTop - 60); }

  // ---------------- vista: home ----------------
  function vistaHome() {
    stato.vista = 'home';
    const salvati = leggiSalvati();
    mostra(`
      <button class="vr-mode main" data-go="auto"><span class="ico">✨</span><span><h3>${TX.m_auto_t}</h3><p>${TX.m_auto_d}</p></span></button>
      <button class="vr-mode" data-go="scegli"><span class="ico">🗺️</span><span><h3>${TX.m_scegli_t}</h3><p>${TX.m_scegli_d}</p></span></button>
      <button class="vr-mode" data-go="nostri"><span class="ico">⭐</span><span><h3>${TX.m_nostri_t}</h3><p>${TX.m_nostri_d}</p></span></button>
      <div class="vr-h">${TX.salvati_t}</div>
      ${salvati.length ? salvati.map((s, i) => `<div class="vr-saved"><div class="t" data-apri="${i}"><b>${esc(s.titolo)}</b><div class="m">${esc(s.sotto)}</div></div><button data-del="${i}" aria-label="${TX.elimina}">✕</button></div>`).join('')
        : `<p class="vr-sub">${TX.salvati_vuoto}</p>`}
    `);
    root().querySelectorAll('[data-go]').forEach(b => b.onclick = () => ({ auto: vistaAuto, scegli: vistaScegli, nostri: vistaNostri })[b.dataset.go]());
    root().querySelectorAll('[data-apri]').forEach(b => b.onclick = () => { const s = leggiSalvati()[+b.dataset.apri]; stato.risultato = s.risultato; stato.meta = s; vistaRisultato(true); });
    root().querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const l = leggiSalvati(); l.splice(+b.dataset.del, 1); scriviSalvati(l); vistaHome(); });
  }

  // ---------------- vista: su misura ----------------
  function vistaAuto() {
    stato.vista = 'auto'; track('planner', 'auto');
    const seg = (nome, opzioni, val) => `<div class="vr-seg" data-seg="${nome}">${opzioni.map(([k, l, s]) => `<button data-v="${k}" class="${val === k ? 'on' : ''}">${l}${s ? `<small>${s}</small>` : ''}</button>`).join('')}</div>`;
    mostra(`
      <button class="vr-back" data-back>${TX.indietro}</button>
      <div class="vr-h">${TX.giorni}</div>
      <div class="vr-step"><button data-g="-1">−</button><b id="vrGiorni">${form.giorni}</b><button data-g="1">+</button></div>
      <div class="vr-h">${TX.eta}</div>
      <input class="vr-input" id="vrEta" type="number" min="1" max="99" inputmode="numeric" value="${form.eta}">
      <div class="vr-h">${TX.budget}</div>
      ${seg('gratis', [['1', TX.solo_gratis], ['0', TX.con_budget]], form.gratis ? '1' : '0')}
      <div id="vrBudgetBox" style="margin-top:10px;${form.gratis ? 'display:none' : ''}">
        <div class="vr-sub">${TX.budget_lbl}: <b id="vrBudgetVal">${form.budget}€</b></div>
        <input class="vr-range" id="vrBudget" type="range" min="5" max="100" step="5" value="${form.budget}">
      </div>
      <div class="vr-h">${TX.ritmo}</div>
      ${seg('ritmo', [['rilassato', TX.r_rilassato, TX.r_rilassato_d], ['medio', TX.r_medio, TX.r_medio_d], ['intenso', TX.r_intenso, TX.r_intenso_d]], form.ritmo)}
      <div class="vr-h">${TX.interessi}</div><p class="vr-sub">${TX.interessi_d}</p>
      <div class="vr-chips">${CAT.map(([k, l]) => `<button class="chip ${form.categorie.has(k) ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('')}</div>
      <div class="vr-h">${TX.gite}</div><p class="vr-sub">${TX.gite_d}</p>
      <div class="vr-chips">${DB.gite.slice().sort((a, b) => b.imp - a.imp).map(g => `<button class="chip ${form.gite.has(g.id) ? 'on' : ''}" data-gita="${g.id}">${esc(g.nome.split(':')[0])}${g.mezzo === 'auto' ? ' 🚗' : ''}</button>`).join('')}</div>
      <div class="vr-bar"><button class="btn" id="vrCrea">${TX.crea}</button></div>
    `);
    const r = root();
    r.querySelector('[data-back]').onclick = vistaHome;
    r.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { form.giorni = Math.min(7, Math.max(1, form.giorni + +b.dataset.g)); $('#vrGiorni').textContent = form.giorni; });
    r.querySelectorAll('[data-seg]').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => {
      s.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on');
      if (s.dataset.seg === 'gratis') { form.gratis = b.dataset.v === '1'; $('#vrBudgetBox').style.display = form.gratis ? 'none' : ''; }
      if (s.dataset.seg === 'ritmo') form.ritmo = b.dataset.v;
    }));
    $('#vrBudget').oninput = e => { form.budget = +e.target.value; $('#vrBudgetVal').textContent = form.budget + '€'; };
    r.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { const k = b.dataset.cat; form.categorie.has(k) ? form.categorie.delete(k) : form.categorie.add(k); b.classList.toggle('on'); });
    r.querySelectorAll('[data-gita]').forEach(b => b.onclick = () => { const k = b.dataset.gita; form.gite.has(k) ? form.gite.delete(k) : form.gite.add(k); b.classList.toggle('on'); });
    $('#vrCrea').onclick = () => {
      form.eta = Math.max(1, Math.min(99, +$('#vrEta').value || 35));
      const opz = { giorni: form.giorni, eta: form.eta, soloGratis: form.gratis, budgetGiorno: form.gratis ? 0 : form.budget,
        ritmo: form.ritmo, categorie: [...form.categorie], gite: [...form.gite], partenza: partenza() };
      stato.risultato = Planner.genera(DB, opz);
      stato.meta = { titolo: `Roma in ${form.giorni} ${form.giorni > 1 ? 'giorni' : 'giorno'}`, sotto: `${TX['r_' + form.ritmo]} · ${form.gratis ? TX.solo_gratis : 'max ' + form.budget + '€/giorno'}${form.categorie.size ? ' · ' + [...form.categorie].map(k => CAT.find(c => c[0] === k)[1].split(' ').slice(1).join(' ')).join(', ') : ''}` };
      track('planner_genera', form.ritmo); vistaRisultato();
    };
  }

  // ---------------- vista: scegli tu ----------------
  const filtroCat = new Set(), filtroImp = new Set(); let filtroTesto = '', giorniTarget = 0, ritmoScelto = 'medio', unGiorno = false;
  const FASCE = [['9', '⭐ Imperdibili (9-10)', 9, 10], ['7', 'Da vedere (7-8)', 7, 8], ['5', 'Interessanti (5-6)', 5, 6], ['1', 'Chicche e curiosità (1-4)', 1, 4]];
  function vistaScegli() {
    stato.vista = 'scegli'; track('planner', 'scegli');
    mostra(`
      <button class="vr-back" data-back>${TX.indietro}</button>
      <div class="vr-h">${TX.ritmo}</div>
      <div class="vr-seg" data-seg="ritmo">${[['rilassato', TX.r_rilassato], ['medio', TX.r_medio], ['intenso', TX.r_intenso]].map(([k, l]) => `<button data-v="${k}" class="${ritmoScelto === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="vr-cat ${unGiorno ? 'on' : ''}" id="vrUnGiorno" style="margin-top:14px"><span class="ck">✓</span><span><b>${TX.un_giorno}</b><div class="m">${TX.un_giorno_d}</div></span></div>
      <div id="vrGTBox" style="${unGiorno ? 'display:none' : ''}">
        <div class="vr-h">${TX.giorni_target}</div>
        <div class="vr-step"><button data-g="-1">−</button><b id="vrGT">${giorniTarget || '–'}</b><button data-g="1">+</button></div>
      </div>
      <div class="vr-h" style="margin-top:20px"><input class="vr-input" id="vrCerca" placeholder="${TX.cerca}" value="${esc(filtroTesto)}"></div>
      <div class="vr-h" style="margin:12px 0 2px">${TX.importanza}</div><p class="vr-sub" style="margin:0 0 6px">${TX.importanza_d}</p>
      <div class="filter-row" data-grp="fi"><button class="chip ${filtroImp.size ? '' : 'on'}" data-v="">${TX.tutte}</button>${FASCE.map(([k, l]) => `<button class="chip ${filtroImp.has(k) ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="filter-row" data-grp="fc"><button class="chip ${filtroCat.size ? '' : 'on'}" data-v="">${TX.tutte}</button>${CAT.map(([k, l]) => `<button class="chip ${filtroCat.has(k) ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
      <div id="vrLista"></div>
      <div class="vr-bar"><button class="btn" id="vrOrg"></button></div>
    `);
    const r = root();
    r.querySelector('[data-back]').onclick = vistaHome;
    r.querySelector('[data-seg]').querySelectorAll('button').forEach(b => b.onclick = () => { r.querySelectorAll('[data-seg] button').forEach(x => x.classList.remove('on')); b.classList.add('on'); ritmoScelto = b.dataset.v; });
    r.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { giorniTarget = Math.min(7, Math.max(0, giorniTarget + +b.dataset.g)); $('#vrGT').textContent = giorniTarget || '–'; });
    // filtri a selezione multipla: si sommano dentro lo stesso gruppo, "Tutte" azzera
    r.querySelectorAll('[data-grp]').forEach(riga => {
      const set = riga.dataset.grp === 'fi' ? filtroImp : filtroCat;
      riga.querySelectorAll('[data-v]').forEach(b => b.onclick = () => {
        const v = b.dataset.v;
        if (!v) set.clear(); else set.has(v) ? set.delete(v) : set.add(v);
        riga.querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', x.dataset.v ? set.has(x.dataset.v) : set.size === 0));
        lista();
      });
    });
    $('#vrUnGiorno').onclick = () => { unGiorno = !unGiorno; $('#vrUnGiorno').classList.toggle('on', unGiorno); $('#vrGTBox').style.display = unGiorno ? 'none' : ''; };
    $('#vrCerca').oninput = e => { filtroTesto = e.target.value; lista(); };
    $('#vrOrg').onclick = () => {
      if (!stato.selezione.size) { alert(TX.nessuna); return; }
      const opz = { ritmo: ritmoScelto, giorni: unGiorno ? null : (giorniTarget || null), partenza: partenza(), eta: 35, unGiorno };
      stato.risultato = Planner.daSelezione(DB, [...stato.selezione], opz);
      stato.meta = { titolo: `${stato.selezione.size} tappe scelte da te`, sotto: unGiorno ? TX.un_giorno : `${TX['r_' + ritmoScelto]} · ${stato.risultato.giorniNecessari} ${TX.giorni_n}` };
      track('planner_genera', 'scegli'); vistaRisultato();
    };
    lista();
  }
  function lista() {
    const tags = filtroCat.size ? new Set([...filtroCat].flatMap(k => Planner.MACRO[k] || [])) : null;
    const q = filtroTesto.trim().toLowerCase();
    const fasce = FASCE.filter(f => filtroImp.has(f[0]));
    const el = DB.attrazioni.filter(a => !a.chiuso && (!tags || a.cat.some(t => tags.has(t))) && (!q || (a.nome + ' ' + a.zona).toLowerCase().includes(q))
        && (!fasce.length || fasce.some(f => a.imp >= f[2] && a.imp <= f[3])))
      .sort((a, b) => b.imp - a.imp);
    $('#vrLista').innerHTML = el.map(a => `<div class="vr-cat ${stato.selezione.has(a.id) ? 'on' : ''}" data-id="${a.id}"><span class="ck">✓</span><span style="flex:1"><b>${esc(a.nome)}</b> <span class="vr-voto v${a.imp >= 9 ? 'top' : a.imp >= 7 ? 'hi' : 'mid'}">${a.imp}/10</span>
      <div class="m">${esc(a.zona)} · ${dur(a.durata)} · ${a.prezzo ? (a.indicativo ? TX.circa + ' ' : '') + euro(a.prezzo) : TX.gratis}</div>
      <div class="m">${esc(a.desc)}</div></span></div>`).join('');
    $('#vrLista').querySelectorAll('[data-id]').forEach(d => d.onclick = () => { const id = d.dataset.id; stato.selezione.has(id) ? stato.selezione.delete(id) : stato.selezione.add(id); d.classList.toggle('on'); barra(); });
    barra();
  }
  function barra() { const n = stato.selezione.size; $('#vrOrg').textContent = n ? `${TX.organizza} · ${n} ${TX.tappe_sel}` : TX.organizza; }

  // ---------------- vista: i nostri itinerari ----------------
  function vistaNostri() {
    stato.vista = 'nostri'; track('planner', 'nostri');
    mostra(`<button class="vr-back" data-back>${TX.indietro}</button>` + NOSTRI.map(n =>
      `<button class="vr-mode" data-n="${n.id}"><span class="ico">${n.giorni}</span><span><h3>${n.titolo}</h3><p>${n.desc}</p></span></button>`).join(''));
    root().querySelector('[data-back]').onclick = vistaHome;
    root().querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
      const n = NOSTRI.find(x => x.id === b.dataset.n);
      stato.risultato = Planner.daSelezione(DB, n.tappe, { ritmo: 'medio', giorni: n.giorni, partenza: partenza(), eta: 35 });
      delete stato.risultato.giorniNecessari; delete stato.risultato.suggerite; delete stato.risultato.daTogliere; // programma gia' pronto
      stato.meta = { titolo: n.titolo, sotto: n.desc };
      track('planner_genera', n.id); vistaRisultato();
    });
  }

  // ---------------- vista: risultato ----------------
  function linkMappa(g) {
    const pts = g.righe.filter(x => !x.pranzo).map(x => trova(x.id)).filter(Boolean);
    if (!pts.length) return '';
    const ll = p => `${p.lat},${p.lon}`;
    const mezzi = g.righe.some(x => x.tratta && x.tratta.modo === 'mezzi');
    const wp = pts.slice(0, -1).slice(0, 9).map(ll).join('|');
    return `https://www.google.com/maps/dir/?api=1&origin=${ll(partenza())}&destination=${ll(pts[pts.length - 1])}${wp ? '&waypoints=' + encodeURIComponent(wp) : ''}&travelmode=${mezzi ? 'transit' : 'walking'}`;
  }
  function tratta(tr) {
    if (!tr) return '';
    if (tr.modo === 'vicino') return `📍 ${TX.accanto}`;
    return tr.modo === 'mezzi' ? `🚇 ${tr.minuti} min ${TX.mezzi}` : `🚶 ${tr.minuti} min ${TX.piedi}`;
  }
  function vistaRisultato(daSalvati) {
    stato.vista = 'risultato';
    const r = stato.risultato;
    let html = `<button class="vr-back" data-back>${TX.indietro}</button>
      <div class="vr-h" style="font-size:1.15rem;margin-top:6px">${esc(stato.meta.titolo)}</div><p class="vr-sub">${esc(stato.meta.sotto)}</p>`;
    (r.avvisi || []).forEach(a => html += `<div class="vr-warn">⚠️ ${esc(a)}</div>`);
    if (r.giorniNecessari) html += `<div class="vr-warn">🗓️ ${TX.servono} <b>${r.giorniNecessari} ${TX.giorni_n}</b>.</div>`;
    if (r.daTogliere && r.daTogliere.length) html += `<div class="vr-warn">✂️ ${TX.da_togliere}: ${r.daTogliere.map(esc).join(', ')}.</div>`;
    if (r.suggerite && r.suggerite.length) html += `<div class="vr-warn">➕ ${TX.suggerite}: ${r.suggerite.map(esc).join(', ')}.</div>`;
    r.giorni.forEach(g => {
      if (g.tipo === 'gita') {
        const mezzo = { treno: TX.in_treno, auto: TX.in_auto, 'treno veloce': TX.treno_veloce }[g.mezzo] || g.mezzo;
        html += `<div class="vr-day"><h3>${TX.giorno} ${g.n} · ${TX.gita}</h3><div class="sum">${esc(g.nome)}</div>
          <div class="vr-extra"><span class="ico">🚆</span><span>${dur(g.viaggio)} ${mezzo} ${TX.a_tratta} · ${TX.costo_gita} ${euro(g.costo)} ${TX.a_persona}</span></div>
          <div class="vr-extra"><span class="ico">📍</span><span>${g.tappe.map(esc).join(' · ')}</span></div>
          <div class="vr-extra"><span class="ico">ℹ️</span><span>${esc(g.desc)}${g.note ? '<br><small>' + esc(g.note) + '</small>' : ''}</span></div></div>`;
        return;
      }
      let n = 0;
      html += `<div class="vr-day"><h3>${TX.giorno} ${g.n}</h3>
        <div class="sum">${TX.impegno} ${dur(g.visite + g.spostamenti)} · ${TX.visite} ${dur(g.visite)} + ${TX.spostamenti} ${dur(g.spostamenti)} · ${TX.biglietti} ${g.costo ? euro(g.costo) : TX.gratis}</div>`;
      g.righe.forEach(x => {
        if (x.pranzo) { html += `<div class="vr-extra"><span class="ico">🍝</span><span>${TX.pranzo} ${esc(x.zona)}</span></div>`; return; }
        const a = trova(x.id) || {};
        const desc = x.fuori && a.esterno ? a.esterno.desc : a.desc;
        html += `<div class="vr-move">${tratta(x.tratta)}</div>
          <div class="vr-stop" style="border-top:none"><span class="n">${++n}</span><div class="t"><b>${esc(x.nome)}</b>${x.fuori ? `<span class="vr-tag">${TX.da_fuori}</span>` : ''}
          <div class="m">${dur(x.durata)} · ${x.prezzo ? (x.indicativo ? TX.circa + ' ' : '') + euro(x.prezzo) : TX.gratis}</div><div class="d">${esc(desc)}</div></div></div>`;
      });
      if (g.serata) html += `<div class="vr-extra sera"><span class="ico">🍹</span><span><b>${TX.serata} ${esc(g.serata.nome)}</b> <small>(${tratta(g.serata.tratta)})</small><br><span style="color:var(--muted);font-size:.8rem">${esc(g.serata.desc)}</span></span></div>`;
      const url = linkMappa(g);
      if (url) html += `<a class="btn alt" style="margin-top:10px" href="${url}" target="_blank" rel="noopener">${TX.mappa_giorno}</a>`;
      html += `</div>`;
    });
    html += `<div class="vr-h">${TX.totale}: ${r.costoTotale ? euro(r.costoTotale) + ' ' + TX.a_persona : TX.gratis}</div>
      <p class="vr-note">${TX.note_prezzi}</p>
      ${daSalvati ? '' : `<button class="btn" id="vrSalva">${TX.salva}</button>`}
      <button class="btn alt" id="vrNuovo">${TX.nuovo}</button>`;
    mostra(html);
    root().querySelector('[data-back]').onclick = vistaHome;
    $('#vrNuovo').onclick = vistaHome;
    const s = $('#vrSalva');
    if (s) s.onclick = () => {
      const l = leggiSalvati();
      l.unshift({ titolo: stato.meta.titolo, sotto: stato.meta.sotto + ' · ' + new Date().toLocaleDateString('it-IT'), risultato: stato.risultato });
      scriviSalvati(l.slice(0, 20)); s.textContent = TX.salvato; s.disabled = true; track('planner_salva', stato.vista);
    };
  }

  // ---------------- avvio ----------------
  function apriVisitaRoma(tab) {
    document.querySelectorAll('#tabbar button').forEach(x => x.classList.toggle('on', x.dataset.scr === 'tour'));
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 'scr-tour'));
    scegliTab(tab || 'itinerari'); window.scrollTo(0, 0);
  }
  function scegliTab(t) {
    document.querySelectorAll('.vr-tab').forEach(b => b.classList.toggle('on', b.dataset.vr === t));
    document.querySelectorAll('.vr-panel').forEach(p => p.classList.toggle('on', p.id === 'vr-' + t));
  }
  function init() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    document.querySelectorAll('.vr-tab').forEach(b => b.onclick = () => { scegliTab(b.dataset.vr); track('visita_tab', b.dataset.vr); });
    const badge = $('#vrBadge'); if (badge) badge.onclick = () => { apriVisitaRoma('itinerari'); track('badge', 'itinerario'); };
    fetch(DB_URL, { cache: 'no-store' }).then(r => r.json()).then(d => { DB = d; vistaHome(); })
      .catch(() => { root().innerHTML = '<p class="vr-sub">Impossibile caricare le attrazioni. Riprova più tardi.</p>'; });
  }
  window.VisitaRoma = { apri: apriVisitaRoma };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
