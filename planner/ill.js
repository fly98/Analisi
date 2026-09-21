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
