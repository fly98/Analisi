/* Illustrazioni stilizzate per gli itinerari preparati (viewBox 64x64) */
window.VR_ILL = (function () {
  const bg = (a, b, id) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" fill="url(#${id})"/>`;
  const colosseo = n => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${bg('#ffb36b', '#ffe3c2', 'gc' + n)}
    <circle cx="46" cy="20" r="9" fill="#fff3d6" opacity=".9"/>
    <path d="M6 50 V30 Q32 18 58 30 V50 Z" fill="#c9793f"/>
    <path d="M6 30 Q32 18 58 30 V34 Q32 23 6 34 Z" fill="#a95f2b"/>
    ${[10, 17, 24, 31, 38, 45, 52].map(x => `<path d="M${x} 49 v-6 a2.6 2.6 0 0 1 5.2 0 v6 Z" fill="#6e3a17"/><path d="M${x} 40 v-3.6 a2.6 2.6 0 0 1 5.2 0 v3.6 Z" fill="#7d4420"/>`).join('')}
    <rect x="0" y="50" width="64" height="14" fill="#8a5a36"/>
    <circle cx="20" cy="47" r="13" fill="#2a2622" stroke="#fff" stroke-width="2.5"/>
    <text x="20" y="53.5" text-anchor="middle" font-family="-apple-system,Segoe UI,Arial,sans-serif" font-weight="800" font-size="18" fill="#fff">${n}</text></svg>`;
  return {
    n1: colosseo(1), n2: colosseo(2), n3: colosseo(3),
    sera: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${bg('#1b2240', '#3b3a6b', 'gs')}
      ${[[8,10],[18,6],[28,14],[52,30],[40,8],[12,26]].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#fff"/>`).join('')}
      <circle cx="47" cy="15" r="7" fill="#fff4c8"/><circle cx="50" cy="13" r="6" fill="#1f2645"/>
      <path d="M14 52 V40 Q22 26 30 40 V52 Z" fill="#11152b"/><rect x="21" y="23" width="2" height="6" fill="#11152b"/>
      <path d="M0 52 V44 h10 v-6 h6 v14 M34 52 V42 h8 v-4 h6 v4 h8 v10 z M56 52 V46 h8 v6z" fill="#11152b"/>
      ${[[6,47],[38,45],[44,46],[58,49]].map(([x,y]) => `<rect x="${x}" y="${y}" width="2" height="2.4" fill="#ffc86b"/>`).join('')}
      <rect y="52" width="64" height="12" fill="#0c0f22"/><path d="M4 58 h12 M24 58 h18 M48 58 h10" stroke="#ffc86b" stroke-width="1.2" opacity=".6"/></svg>`,
    antica: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${bg('#9fd0ee', '#e8f4fb', 'ga')}
      <path d="M8 22 L32 10 L56 22 Z" fill="#e7d9bf" stroke="#b39c74" stroke-width="1.2"/>
      <rect x="8" y="22" width="48" height="4" fill="#d8c6a2"/>
      ${[11, 20, 29, 38, 47].map(x => `<rect x="${x}" y="26" width="5" height="22" fill="#efe3cb"/><rect x="${x+1.5}" y="27" width="1" height="20" fill="#d3c09c"/>`).join('')}
      <rect x="6" y="48" width="52" height="4" fill="#d8c6a2"/><rect x="3" y="52" width="58" height="4" fill="#c4ae86"/>
      <rect y="56" width="64" height="8" fill="#9bb86b"/></svg>`,
    arte: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" fill="#1c1410"/>
      <radialGradient id="gl" cx=".38" cy=".38" r=".7"><stop offset="0" stop-color="#e9b86a"/><stop offset=".5" stop-color="#6b3f1e"/><stop offset="1" stop-color="#1c1410"/></radialGradient>
      <rect x="9" y="8" width="46" height="48" rx="2" fill="#c9a24a"/><rect x="12" y="11" width="40" height="42" fill="#8f6d27"/>
      <rect x="15" y="14" width="34" height="36" fill="url(#gl)"/>
      <path d="M22 50 Q23 36 30 33 Q27 27 31 24 Q37 23 36 30 Q42 34 42 50 Z" fill="#2b1a10" opacity=".85"/>
      <path d="M29 26 Q33 23 35 27" stroke="#f3d59c" stroke-width="1.4" fill="none"/>
      <circle cx="10" cy="9" r="2.4" fill="#e7c469"/><circle cx="54" cy="9" r="2.4" fill="#e7c469"/><circle cx="10" cy="55" r="2.4" fill="#e7c469"/><circle cx="54" cy="55" r="2.4" fill="#e7c469"/></svg>`,
    sotto: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" fill="#3a2c22"/>
      <radialGradient id="gt" cx=".5" cy=".45" r=".55"><stop offset="0" stop-color="#ffbe6b" stop-opacity=".9"/><stop offset="1" stop-color="#3a2c22" stop-opacity="0"/></radialGradient>
      <path d="M12 64 V30 Q32 6 52 30 V64 Z" fill="#1e1611"/><rect width="64" height="64" fill="url(#gt)"/>
      ${[0,1,2,3,4].map(i => `<rect x="${16+i*2}" y="${44+i*4}" width="${32-i*4}" height="4" fill="${i%2?'#6b5140':'#7d6150'}"/>`).join('')}
      <rect x="44" y="26" width="2.4" height="10" fill="#6b4a2a"/><path d="M45.2 26 q-3 -4 0 -9 q3 5 0 9z" fill="#ffb347"/><path d="M45.2 25 q-1.4 -2.4 0 -5 q1.4 2.6 0 5z" fill="#fff0b3"/>
      ${[[4,10],[6,24],[58,14],[56,44],[4,50]].map(([x,y]) => `<rect x="${x}" y="${y}" width="6" height="3" rx="1" fill="#524033"/>`).join('')}</svg>`,
    bambini: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${bg('#bfe6ff', '#e9f7ff', 'gb')}
      <circle cx="12" cy="12" r="6" fill="#ffe27a"/>
      <ellipse cx="44" cy="18" rx="8" ry="10" fill="#ff6b6b"/><path d="M44 28 l-1.6 2.6 h3.2 z" fill="#ff6b6b"/><path d="M44 30 Q40 38 44 44" stroke="#666" stroke-width="1" fill="none"/>
      <ellipse cx="41" cy="14" rx="2" ry="3" fill="#fff" opacity=".6"/>
      <path d="M0 46 Q16 42 32 46 T64 46 V64 H0 Z" fill="#5aaee0"/>
      <path d="M14 48 h20 l-4 6 h-12 z" fill="#FF6628"/><rect x="23" y="36" width="1.6" height="12" fill="#6b4a2a"/><path d="M24.6 37 l8 9 h-8 z" fill="#fff"/>
      <path d="M0 56 Q16 52 32 56 T64 56 V64 H0 Z" fill="#3f93c9"/></svg>`,
    verde: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${bg('#ff9a5a', '#ffd9a0', 'gv')}
      <circle cx="40" cy="34" r="11" fill="#fff0c2" opacity=".95"/>
      <path d="M0 46 Q20 38 40 44 T64 42 V64 H0 Z" fill="#6f9a4b"/><path d="M0 52 Q24 46 64 52 V64 H0 Z" fill="#557d38"/>
      <path d="M21 52 Q20 40 22 30" stroke="#5a3a22" stroke-width="2.4" fill="none"/>
      <ellipse cx="21" cy="24" rx="15" ry="6" fill="#2f5a2a"/><ellipse cx="17" cy="21" rx="9" ry="4" fill="#3d6e33"/><ellipse cx="28" cy="22" rx="8" ry="3.6" fill="#3d6e33"/></svg>`,
    alternativa: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" fill="#e9e3da"/>
      ${[0,1,2,3,4,5].map(i => `<path d="M0 ${i*11} h64" stroke="#d6cdc0" stroke-width="1"/>`).join('')}
      <path d="M6 44 Q12 14 30 20 T56 16 Q52 40 34 40 T6 44 Z" fill="#FF6628" opacity=".9"/>
      <path d="M10 50 Q26 34 44 44 T60 36" stroke="#2f8fd8" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="22" cy="28" r="6" fill="#ffd23f"/><circle cx="40" cy="26" r="4" fill="#8b5fbf"/>
      <rect x="45" y="40" width="10" height="20" rx="3" fill="#2a2622"/><rect x="47" y="36" width="6" height="5" rx="1" fill="#555"/>
      <circle cx="50" cy="33" r="1.6" fill="#FF6628"/><path d="M52 33 l6 -3 M52 33 l6 0 M52 33 l6 3" stroke="#FF6628" stroke-width="1" opacity=".7"/></svg>`,
  };
})();

/* Visita Roma — interfaccia dell'organizzatore di itinerari (condivisa tra Campaldino e Lorenzo).
   Usa: Planner (planner.js), CFG, lang, trackEvent della pagina ospite. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const DB_URL = 'planner/attrazioni.json';
  const KEY_SALVATI = 'ie_itinerari';
  let DB = null;
  let stato = { vista: 'home', risultato: null, meta: null, selezione: new Set() };

  // ---------------- testi: ui_i18n.js (interfaccia) + planner/tr/<lingua>.json (dati) ----------------
  let LINGUA = 'it', TX = Object.assign({}, window.VR_I18N.it), TR = { a: {}, g: {}, s: {} };
  const fmt = (s, v) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? v[k] : m);
  const nomeA = a => (TR.a[a.id] && TR.a[a.id].n) || a.nome;
  const descA = a => (TR.a[a.id] && TR.a[a.id].d) || a.desc;
  const nomeFuori = a => (TR.a[a.id] && TR.a[a.id].fn) || (LINGUA === 'it' && a.esterno && a.esterno.nome) || `${nomeA(a).split(',')[0]} (${TX.da_fuori})`;
  const descFuori = a => (TR.a[a.id] && TR.a[a.id].e) || (a.esterno && a.esterno.desc) || descA(a);
  const nomeG = g => (TR.g[g.id] && TR.g[g.id].n) || g.nome;
  const descG = g => (TR.g[g.id] && TR.g[g.id].d) || g.desc;
  const tappeG = g => (TR.g[g.id] && TR.g[g.id].t) || g.tappe;
  const noteG = g => (TR.g[g.id] && TR.g[g.id].no) || g.note;
  const nomeS = s => (TR.s[s.id] && TR.s[s.id].n) || s.nome;
  const descS = s => (TR.s[s.id] && TR.s[s.id].d) || s.desc;
  const CAT_K = ['musei', 'chiese', 'archeologia', 'parchi', 'piazze', 'panorami', 'quartieri', 'streetart', 'insolito', 'esperienze', 'famiglia'];
  const catLbl = k => TX['c_' + k] || k;
  // Itinerari preparati da noi (tappe; il motore le divide nei giorni e calcola i percorsi)
  const NOSTRI = [
    { id: 'n1', giorni: 1, ico: '1', tappe: ['colosseo', 'fori_imperiali', 'capitolini_fuori', 'pantheon', 'navona', 'trevi', 'spagna'] },
    { id: 'n2', giorni: 2, ico: '2', tappe: ['colosseo', 'fori_imperiali', 'capitolini_fuori', 'pantheon', 'navona', 'trevi', 'spagna',
        'musei_vaticani', 'san_pietro', 'piazza_san_pietro', 'castel_santangelo_fuori'] },
    { id: 'n3', giorni: 3, ico: '3', tappe: ['colosseo', 'fori_imperiali', 'capitolini_fuori', 'ghetto', 'isola_tiberina', 'santa_maria_trastevere',
        'musei_vaticani', 'san_pietro', 'piazza_san_pietro', 'castel_santangelo_fuori', 'galleria_borghese', 'pincio', 'spagna', 'trevi', 'pantheon', 'navona'] },
  ];
  // itinerari a tema: ordine fisso deciso da noi; "serale" = niente pranzo, aperitivo e cena come tappe
  const TEMI = [
    { id: 'sera', ico: '🌙', fisso: true, serale: true, tappe: ['pincio', 'popolo', 'spagna', 'trevi', 'pantheon_fuori', 'navona', 'campo_fiori', 'santa_maria_trastevere', 'trastevere'],
      tag: { pincio: 'tag_tramonto', campo_fiori: 'tag_aperitivo', trastevere: 'tag_cena' } },
    { id: 'antica', ico: '🏛️', fisso: true, tappe: ['colosseo', 'fori_imperiali', 'capitolini_fuori', 'bocca_verita_fuori', 'circo_massimo', 'caracalla'] },
    { id: 'arte', ico: '🎨', tappe: ['santa_maria_popolo', 'sant_agostino', 'san_luigi', 'navona', 'minerva', 'sant_ignazio', 'trevi', 'sant_andrea_quirinale', 'quattro_fontane', 'vittoria'] },
    { id: 'sotto', ico: '🕳️', fisso: true, tappe: ['vicus_caprarius', 'palazzo_valentini', 'carcere_mamertino', 'domus_aurea', 'san_clemente', 'case_celio'] },
    { id: 'bambini', ico: '👨‍👩‍👧', tappe: ['bioparco', 'villa_borghese', 'pincio', 'spagna', 'trevi', 'time_elevator'] },
    { id: 'verde', ico: '🌳', fisso: true, tappe: ['villa_borghese', 'pincio', 'circo_massimo', 'giardino_aranci', 'buco_serratura', 'fontanone', 'gianicolo'] },
    { id: 'alternativa', ico: '🖌️', tappe: ['testaccio', 'cimitero_acattolico', 'ostiense_street_art', 'garbatella', 'tor_marancia'] },
  ];

  // ---------------- stile ----------------
  const CSS = `
  .vr-tabs{display:flex;gap:8px;padding:2px 16px 14px}
  .vr-tab{flex:1;padding:10px;border-radius:12px;border:1px solid var(--border);background:var(--surface);font:inherit;font-size:.85rem;font-weight:700;color:var(--muted);cursor:pointer}
  .vr-tab.on{background:var(--orange);border-color:var(--orange);color:#fff}
  .vr-panel{display:none}.vr-panel.on{display:block}
  .vr-mode{display:flex;gap:14px;align-items:center;width:100%;text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:10px;cursor:pointer;font:inherit;color:var(--text)}
  .vr-mode .ico{font-size:1.7rem;width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:var(--orange-bg);flex-shrink:0}
  .vr-mode .ico.ill{width:60px;height:60px;border-radius:14px;overflow:hidden;background:none;box-shadow:0 2px 6px rgba(0,0,0,.12)}
  .vr-mode .ico.ill svg{width:100%;height:100%;display:block}
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
  .vr-img{width:64px;height:64px;border-radius:12px;object-fit:cover;flex-shrink:0;background:#eee}
  .vr-ico{width:64px;height:64px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.7rem;background:var(--orange-bg)}
  .vr-stop .vr-img,.vr-stop .vr-ico{width:56px;height:56px}
  .vr-gita-img{width:100%;height:130px;object-fit:cover;border-radius:12px;margin:4px 0 6px}
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
  const dur = m => { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} ${(typeof TX !== 'undefined' && TX.min) || 'min'}`; };
  const euro = v => (Math.round(v * 100) / 100).toString().replace('.', ',') + '€';
  const track = (e, s) => { try { if (typeof trackEvent === 'function') trackEvent(e, s); } catch (x) {} };
  const partenza = () => ({ lat: CFG.lat, lon: CFG.lon });
  const leggiSalvati = () => { try { return JSON.parse(localStorage.getItem(KEY_SALVATI) || '[]'); } catch (e) { return []; } };
  const scriviSalvati = l => { try { localStorage.setItem(KEY_SALVATI, JSON.stringify(l)); } catch (e) {} };
  const trova = id => DB.attrazioni.find(a => a.id === id || a.id + '_fuori' === id);

  const ICONE = { chiesa: '⛪', museo: '🏛️', archeologia: '🏺', parco: '🌳', piazza: '⛲', fontana: '⛲', panorama: '🌅', quartiere: '🏘️',
    street_art: '🎨', insolito: '🔮', esperienza: '✨', cibo: '🍝', mercato: '🧺', famiglia: '👨‍👩‍👧', spettacolo: '🎭' };
  const mini = a => a && a.foto
    ? `<img class="vr-img" src="${esc(a.foto)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=&quot;vr-ico&quot;>📍</span>'">`
    : `<span class="vr-ico">${(a && ICONE[(a.cat || [])[0]]) || '📍'}</span>`;

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
    root().querySelectorAll('[data-apri]').forEach(b => b.onclick = () => { const s = leggiSalvati()[+b.dataset.apri]; stato.risultato = s.risultato; stato.meta = Object.assign({}, s, { chiave: null }); vistaRisultato(true); });
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
      <div class="vr-chips">${CAT_K.map(k => `<button class="chip ${form.categorie.has(k) ? 'on' : ''}" data-cat="${k}">${catLbl(k)}</button>`).join('')}</div>
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
      stato.meta = { titolo: form.giorni > 1 ? fmt(TX.titolo_giorni, { n: form.giorni }) : TX.titolo_giorno1, sotto: `${TX['r_' + form.ritmo]} · ${form.gratis ? TX.solo_gratis : fmt(TX.max_giorno, { v: form.budget })}${form.categorie.size ? ' · ' + [...form.categorie].map(k => catLbl(k).split(' ').slice(1).join(' ')).join(', ') : ''}` };
      track('planner_genera', form.ritmo); vistaRisultato();
    };
  }

  // ---------------- vista: scegli tu ----------------
  const filtroCat = new Set(), filtroImp = new Set(), filtroZona = new Set();
  const ZONE_K = ['centro', 'tridente', 'colosseo', 'vaticano', 'trastevere', 'aventino', 'termini', 'nord', 'sud']; let filtroTesto = '', giorniTarget = 0, ritmoScelto = 'medio', unGiorno = false;
  const FASCE = [['9', 9, 10], ['7', 7, 8], ['5', 5, 6], ['1', 1, 4]];
  const fasciaLbl = f => TX['f' + f[0]];
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
      <div class="filter-row" data-grp="fi"><button class="chip ${filtroImp.size ? '' : 'on'}" data-v="">${TX.tutte}</button>${FASCE.map(f => `<button class="chip ${filtroImp.has(f[0]) ? 'on' : ''}" data-v="${f[0]}">${fasciaLbl(f)}</button>`).join('')}</div>
      <div class="vr-h" style="margin:10px 0 4px">${TX.zone}</div>
      <div class="filter-row" data-grp="fz"><button class="chip ${filtroZona.size ? '' : 'on'}" data-v="">${TX.tutte}</button>${ZONE_K.map(k => `<button class="chip ${filtroZona.has(k) ? 'on' : ''}" data-v="${k}">📍 ${TX['z_' + k]}</button>`).join('')}</div>
      <div class="vr-h" style="margin:10px 0 4px">${TX.interessi.replace('?', '').replace('？', '')}</div>
      <div class="filter-row" data-grp="fc"><button class="chip ${filtroCat.size ? '' : 'on'}" data-v="">${TX.tutte}</button>${CAT_K.map(k => `<button class="chip ${filtroCat.has(k) ? 'on' : ''}" data-v="${k}">${catLbl(k)}</button>`).join('')}</div>
      <div id="vrInfo" class="vr-sub" style="margin:4px 2px 8px"></div>
      <div id="vrLista"></div>
      <div class="vr-bar"><button class="btn" id="vrOrg"></button></div>
    `);
    const r = root();
    r.querySelector('[data-back]').onclick = vistaHome;
    r.querySelector('[data-seg]').querySelectorAll('button').forEach(b => b.onclick = () => { r.querySelectorAll('[data-seg] button').forEach(x => x.classList.remove('on')); b.classList.add('on'); ritmoScelto = b.dataset.v; });
    r.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { giorniTarget = Math.min(7, Math.max(0, giorniTarget + +b.dataset.g)); $('#vrGT').textContent = giorniTarget || '–'; });
    // filtri a selezione multipla: si sommano dentro lo stesso gruppo, "Tutte" azzera
    r.querySelectorAll('[data-grp]').forEach(riga => {
      const set = riga.dataset.grp === 'fi' ? filtroImp : riga.dataset.grp === 'fz' ? filtroZona : filtroCat;
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
      stato.meta = { titolo: fmt(TX.titolo_scelte, { n: stato.selezione.size }), sotto: unGiorno ? TX.un_giorno : `${TX['r_' + ritmoScelto]} · ${stato.risultato.giorniNecessari} ${TX.giorni_n}` };
      track('planner_genera', 'scegli'); vistaRisultato();
    };
    lista();
  }
  function lista() {
    const tags = filtroCat.size ? new Set([...filtroCat].flatMap(k => Planner.MACRO[k] || [])) : null;
    const q = filtroTesto.trim().toLowerCase();
    const fasce = FASCE.filter(f => filtroImp.has(f[0])).map(f => [f[0], '', f[1], f[2]]);
    const el = DB.attrazioni.filter(a => !a.chiuso && (!tags || a.cat.some(t => tags.has(t))) && (!q || (a.nome + ' ' + nomeA(a) + ' ' + a.zona).toLowerCase().includes(q))
        && (!fasce.length || fasce.some(f => a.imp >= f[2] && a.imp <= f[3])) && (!filtroZona.size || filtroZona.has(a.area)))
      .sort((a, b) => (a.rank || 999) - (b.rank || 999));
    $('#vrLista').innerHTML = el.map(a => `<div class="vr-cat ${stato.selezione.has(a.id) ? 'on' : ''}" data-id="${a.id}"><span class="ck">✓</span>${mini(a)}<span style="flex:1"><b>${esc(nomeA(a))}</b> <span class="vr-voto v${a.imp >= 9 ? 'top' : a.imp >= 7 ? 'hi' : 'mid'}">${a.imp}/10</span>
      <div class="m">${esc(a.zona)} · ${dur(a.durata)} · ${a.prezzo ? (a.indicativo ? TX.circa + ' ' : '') + euro(a.prezzo) : TX.gratis}</div>
      <div class="m">${esc(descA(a))}</div></span></div>`).join('');
    const nf = filtroImp.size + filtroCat.size + filtroZona.size;
    const nomi = [...FASCE.filter(f => filtroImp.has(f[0])).map(f => fasciaLbl(f).replace('⭐ ', '')), ...CAT_K.filter(k => filtroCat.has(k)).map(catLbl), ...ZONE_K.filter(k => filtroZona.has(k)).map(k => TX['z_' + k])];
    $('#vrInfo').innerHTML = (el.length ? `<b>${el.length}</b> ${el.length === 1 ? TX.risultato1 : TX.risultati}` : (nf ? TX.nessun_con_filtri : TX.nessun_risultato))
      + (nf ? ` · ${TX.filtri_attivi}: ${nomi.map(esc).join(', ')} · <a href="#" id="vrAzzera" style="color:var(--orange);font-weight:700">${TX.azzera}</a>` : '');
    const az = $('#vrAzzera');
    if (az) az.onclick = e => {
      e.preventDefault(); filtroImp.clear(); filtroCat.clear(); filtroZona.clear();
      root().querySelectorAll('[data-grp] [data-v]').forEach(x => x.classList.toggle('on', !x.dataset.v)); lista();
    };
    $('#vrLista').querySelectorAll('[data-id]').forEach(d => d.onclick = () => { const id = d.dataset.id; stato.selezione.has(id) ? stato.selezione.delete(id) : stato.selezione.add(id); d.classList.toggle('on'); barra(); });
    barra();
  }
  function barra() { const n = stato.selezione.size; $('#vrOrg').textContent = n ? `${TX.organizza} · ${n} ${TX.tappe_sel}` : TX.organizza; }

  // ---------------- vista: i nostri itinerari ----------------
  function vistaNostri() {
    stato.vista = 'nostri'; track('planner', 'nostri');
    const card = (id, ico, t, d) => `<button class="vr-mode" data-n="${id}">${window.VR_ILL && VR_ILL[id] ? `<span class="ico ill">${VR_ILL[id]}</span>` : `<span class="ico">${ico}</span>`}<span><h3>${esc(t)}</h3><p>${esc(d)}</p></span></button>`;
    mostra(`<button class="vr-back" data-back>${TX.indietro}</button>
      <div class="vr-h">${TX.g_durata}</div>${NOSTRI.map(n => card(n.id, n.ico, TX[n.id + '_t'], TX[n.id + '_d'])).join('')}
      <div class="vr-h">${TX.g_tema}</div>${TEMI.map(n => card(n.id, n.ico, TX['t_' + n.id], TX['d_' + n.id])).join('')}`);
    root().querySelector('[data-back]').onclick = vistaHome;
    root().querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
      const n = NOSTRI.find(x => x.id === b.dataset.n), tm = TEMI.find(x => x.id === b.dataset.n);
      if (n) {
        stato.risultato = Planner.daSelezione(DB, n.tappe, { ritmo: 'medio', giorni: n.giorni, partenza: partenza(), eta: 35 });
        stato.meta = { titolo: TX[n.id + '_t'], sotto: TX[n.id + '_d'], chiave: n.id };
      } else {
        stato.risultato = Planner.daSelezione(DB, tm.tappe, { ritmo: 'medio', giorni: 1, partenza: partenza(), eta: 35, ordineFisso: !!tm.fisso, serale: !!tm.serale });
        stato.meta = { titolo: TX['t_' + tm.id], sotto: TX['d_' + tm.id], chiave: tm.id, tag: tm.tag || null };
      }
      delete stato.risultato.giorniNecessari; delete stato.risultato.suggerite; delete stato.risultato.daTogliere; // programma gia' pronto
      track('planner_genera', b.dataset.n); vistaRisultato();
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
    return tr.modo === 'mezzi' ? `🚇 ${tr.minuti} ${TX.min} ${TX.mezzi}` : `🚶 ${tr.minuti} ${TX.min} ${TX.piedi}`;
  }
  function vistaRisultato(daSalvati) {
    stato.vista = 'risultato'; daSalvatiCorrente = !!daSalvati;
    const r = stato.risultato;
    const k = stato.meta.chiave, tit = k ? (TX[k + '_t'] || TX['t_' + k] || stato.meta.titolo) : stato.meta.titolo, sot = k ? (TX[k + '_d'] || TX['d_' + k] || stato.meta.sotto) : stato.meta.sotto;
    let html = `<button class="vr-back" data-back>${TX.indietro}</button>
      <div class="vr-h" style="font-size:1.15rem;margin-top:6px">${esc(tit)}</div><p class="vr-sub">${esc(sot)}</p>`;
    (r.avvisi || []).forEach(a => {
      const txt = typeof a === 'string' ? a : fmt(TX['av_' + a.k], Object.assign({}, a, a.id ? { n: nomeG(DB.gite.find(g => g.id === a.id) || { nome: a.id }) } : {}));
      html += `<div class="vr-warn">⚠️ ${esc(txt)}</div>`;
    });
    if (r.giorniNecessari) html += `<div class="vr-warn">🗓️ ${TX.servono} <b>${r.giorniNecessari} ${TX.giorni_n}</b>.</div>`;
    const nomeId = id => { const a = trova(id); return a ? nomeA(a) : id; };
    if (r.daTogliere && r.daTogliere.length) html += `<div class="vr-warn">✂️ ${TX.da_togliere}: ${r.daTogliere.map(id => esc(nomeId(id))).join(', ')}.</div>`;
    if (r.suggerite && r.suggerite.length) html += `<div class="vr-warn">➕ ${TX.suggerite}: ${r.suggerite.map(id => esc(nomeId(id))).join(', ')}.</div>`;
    r.giorni.forEach(g => {
      if (g.tipo === 'gita') {
        const mezzo = { treno: TX.in_treno, auto: TX.in_auto, 'treno veloce': TX.treno_veloce }[g.mezzo] || g.mezzo;
        const gg = DB.gite.find(x => x.id === g.id || x.nome === g.nome) || g;
        html += `<div class="vr-day"><h3>${fmt(TX.giorno_fmt, { n: g.n })} · ${TX.gita}</h3><div class="sum">${esc(nomeG(gg))}</div>${gg && gg.foto ? `<img class="vr-gita-img" src="${esc(gg.foto.replace('/240px-', '/480px-'))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
          <div class="vr-extra"><span class="ico">🚆</span><span>${dur(g.viaggio)} ${mezzo} ${TX.a_tratta} · ${TX.costo_gita} ${euro(g.costo)} ${TX.a_persona}</span></div>
          <div class="vr-extra"><span class="ico">📍</span><span>${tappeG(gg).map(esc).join(' · ')}</span></div>
          <div class="vr-extra"><span class="ico">ℹ️</span><span>${esc(descG(gg))}${noteG(gg) ? '<br><small>' + esc(noteG(gg)) + '</small>' : ''}</span></div></div>`;
        return;
      }
      let n = 0;
      html += `<div class="vr-day"><h3>${fmt(TX.giorno_fmt, { n: g.n })}</h3>
        <div class="sum">${TX.impegno} ${dur(g.visite + g.spostamenti)} · ${TX.visite} ${dur(g.visite)} + ${TX.spostamenti} ${dur(g.spostamenti)} · ${TX.biglietti} ${g.costo ? euro(g.costo) : TX.gratis}</div>`;
      g.righe.forEach(x => {
        if (x.pranzo) { html += `<div class="vr-extra"><span class="ico">🍝</span><span>${TX.pranzo} ${esc(x.zona)}</span></div>`; return; }
        const a = trova(x.id) || {};
        const desc = x.fuori ? descFuori(a) : descA(a);
        const nome = a.id ? (x.fuori ? nomeFuori(a) : nomeA(a)) : x.nome;
        html += `<div class="vr-move">${tratta(x.tratta)}</div>
          <div class="vr-stop" style="border-top:none"><span class="n">${++n}</span>${mini(a)}<div class="t">${stato.meta && stato.meta.tag && stato.meta.tag[a.id] ? `<div class="vr-tag" style="display:table;margin:0 0 3px;background:var(--orange-bg);color:var(--orange)">${TX[stato.meta.tag[a.id]]}</div>` : ''}<b>${esc(nome)}</b>${x.fuori ? `<span class="vr-tag">${TX.da_fuori}</span>` : ''}
          <div class="m">${dur(x.durata)} · ${x.prezzo ? (x.indicativo ? TX.circa + ' ' : '') + euro(x.prezzo) : TX.gratis}</div><div class="d">${esc(desc)}</div></div></div>`;
      });
      if (g.serata) html += `<div class="vr-extra sera"><span class="ico">🍹</span><span><b>${TX.serata} ${esc(nomeS(g.serata))}</b> <small>(${tratta(g.serata.tratta)})</small><br><span style="color:var(--muted);font-size:.8rem">${esc(descS(g.serata))}</span></span></div>`;
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
      l.unshift({ titolo: stato.meta.titolo, sotto: stato.meta.sotto + ' · ' + new Date().toLocaleDateString(LINGUA), risultato: stato.risultato, chiave: stato.meta.chiave, tag: stato.meta.tag });
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
    fetch(DB_URL, { cache: 'no-store' }).then(r => r.json()).then(d => { DB = d; stato.vista = 'home'; return lingua(typeof lang !== 'undefined' ? lang : 'it'); })
      .catch(() => { root().innerHTML = `<p class="vr-sub">${TX.errore}</p>`; });
  }
  let daSalvatiCorrente = false;
  function lingua(l) {
    LINGUA = window.VR_I18N[l] ? l : 'en';
    TX = Object.assign({}, window.VR_I18N.it, window.VR_I18N[LINGUA]);
    document.querySelectorAll('.vr-tab').forEach(b => b.textContent = b.dataset.vr === 'audio' ? TX.tab_audio : TX.tab_itin);
    const bt = $('#vrBadge b'), bs = $('#vrBadge small'); if (bt) bt.textContent = TX.badge_t; if (bs) bs.textContent = TX.badge_d;
    const ridisegna = () => { if (!DB) return; ({ home: vistaHome, auto: vistaAuto, scegli: vistaScegli, nostri: vistaNostri, risultato: () => vistaRisultato(daSalvatiCorrente) })[stato.vista || 'home'](); };
    if (LINGUA === 'it') { TR = { a: {}, g: {}, s: {} }; ridisegna(); return Promise.resolve(); }
    return fetch(`planner/tr/${LINGUA}.json?v=${document.querySelector('script[src*="planner-ui.js"]').src.split('v=')[1] || ''}`).then(r => r.ok ? r.json() : null).then(d => { TR = d || { a: {}, g: {}, s: {} }; ridisegna(); }).catch(() => ridisegna());
  }
  window.VisitaRoma = { apri: apriVisitaRoma, lingua };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
