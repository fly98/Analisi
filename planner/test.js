const P = require('./planner.js');
const db = require('./attrazioni.json');
const hhmm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const dur = m => m>=60 ? `${Math.floor(m/60)}h${m%60?String(m%60).padStart(2,'0'):''}` : `${m} min`;
function stampa(r){
  r.avvisi.forEach(a=>console.log('⚠️ ',a));
  r.giorni.forEach(g=>{
    if(g.tipo==='gita'){ console.log(`\n=== GIORNO ${g.n}: GITA ${g.nome} (${g.mezzo}, ${g.viaggio} min a tratta, ~${g.costo}€)`); return; }
    console.log(`\n=== GIORNO ${g.n} — impegno totale ${dur(g.visite+g.spostamenti)} (visite ${dur(g.visite)} + spostamenti ${dur(g.spostamenti)}) · biglietti ${g.costo}€`);
    g.righe.forEach(x=>{
      if(x.pranzo){ console.log(`     🍝 pausa pranzo in zona ${x.zona}`); return; }
      const tr = x.tratta.modo==='mezzi' ? `🚇 ${x.tratta.minuti} min` : x.tratta.modo==='piedi' ? `🚶 ${x.tratta.minuti} min` : '📍 accanto';
      console.log(`     ${tr.padEnd(12)} → ${x.nome} · ${dur(x.durata)} · ${x.prezzo? x.prezzo+'€':'gratis'}`);
    });
    if(g.serata){ const s=g.serata; console.log(`     🍹🍽️ aperitivo e cena a ${s.nome} (${s.tratta.modo==='mezzi'?'🚇 '+s.tratta.minuti+' min':'🚶 '+s.tratta.minuti+' min'})`); }
  });
  console.log('\nTotale biglietti:', r.costoTotale+'€');
}
console.log('######## ESEMPIO FILIPPO: 50 anni, 2 giorni, 30€/giorno, parchi+chiese+musei, intenso');
stampa(P.genera(db,{giorni:2, eta:50, budgetGiorno:30, ritmo:'intenso', categorie:['parchi','chiese','musei']}));
console.log('\n\n######## 1 GIORNO, 40 anni, 25€, tutte le categorie, medio');
stampa(P.genera(db,{giorni:1, eta:40, budgetGiorno:25, ritmo:'medio', categorie:[]}));
console.log('\n\n######## 3 GIORNI con TIVOLI, 35 anni, solo gratis, rilassato, quartieri+panorami+insolito');
stampa(P.genera(db,{giorni:3, eta:35, soloGratis:true, ritmo:'rilassato', categorie:['quartieri','panorami','insolito'], gite:['tivoli']}));

console.log('\n\n######## 1 GIORNO SOLO GRATIS, 40 anni, medio, tutte le categorie');
stampa(P.genera(db,{giorni:1, eta:40, soloGratis:true, ritmo:'medio', categorie:[]}));
console.log('\n\n######## 2 GIORNI, 15€ al giorno, medio');
stampa(P.genera(db,{giorni:2, eta:40, budgetGiorno:15, ritmo:'medio', categorie:[]}));
