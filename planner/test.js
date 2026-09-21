const P = require('./planner.js');
const db = require('./attrazioni.json');
const hhmm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
function stampa(r){
  r.avvisi.forEach(a=>console.log('⚠️ ',a));
  r.giorni.forEach(g=>{
    if(g.tipo==='gita'){ console.log(`\n=== GIORNO ${g.n}: GITA ${g.nome} (${g.mezzo}, ${g.viaggio} min, ~${g.costo}€)`); return; }
    console.log(`\n=== GIORNO ${g.n} — ${Math.round(g.minuti/60*10)/10}h, fatica ${g.fatica}, biglietti ${g.costo}€`);
    g.righe.forEach(x=>{
      if(x.pranzo){ console.log(`  ${hhmm(x.ora)} 🍝 Pausa pranzo (zona ${x.zona})`); return; }
      const tr = x.tratta.modo==='mezzi' ? `🚇 ${x.tratta.minuti}'` : x.tratta.modo==='piedi' ? `🚶 ${x.tratta.metri}m` : '';
      console.log(`  ${hhmm(x.arrivo)} ${x.nome} (${x.durata}') ${x.prezzo? x.prezzo+'€':'gratis'}  ${tr}`);
    });
    console.log(`  ${hhmm(g.fine)} fine visite`);
    if(g.serata){ const s=g.serata; console.log(`  ${hhmm(s.aperitivo)} 🍹 Aperitivo e ${hhmm(s.cena)} 🍽️ cena a ${s.nome} (${s.tratta.modo==='mezzi'?'🚇 '+s.tratta.minuti+"'":'🚶 '+s.tratta.metri+'m'})`); }
  });
  console.log('\nTotale biglietti:', r.costoTotale+'€');
  console.log('Rimaste fuori (per tempo/fatica/budget):', r.escluse.length);
}
console.log('######## ESEMPIO FILIPPO: 50 anni, 2 giorni, 30€/giorno, parchi+chiese+musei, intenso');
stampa(P.genera(db,{giorni:2, eta:50, budgetGiorno:30, ritmo:'intenso', categorie:['parchi','chiese','musei']}));
console.log('\n\n######## 1 GIORNO, 40 anni, 25€, tutte le categorie, medio');
stampa(P.genera(db,{giorni:1, eta:40, budgetGiorno:25, ritmo:'medio', categorie:[]}));
console.log('\n\n######## 3 GIORNI con TIVOLI, 35 anni, solo gratis, rilassato, quartieri+panorami+insolito');
stampa(P.genera(db,{giorni:3, eta:35, soloGratis:true, ritmo:'rilassato', categorie:['quartieri','panorami','insolito'], gite:['tivoli']}));
