const P=require('./planner.js'), db=require('./attrazioni.json');
const T = {
 sera:      {g:1, fisso:true, serale:true, t:['pincio','popolo','spagna','trevi','pantheon_fuori','navona','campo_fiori','santa_maria_trastevere','trastevere']},
 antica:    {g:1, fisso:true, t:['colosseo','fori_imperiali','capitolini_fuori','bocca_verita_fuori','circo_massimo','caracalla']},
 arte:      {g:1, t:['santa_maria_popolo','sant_agostino','san_luigi','navona','minerva','sant_ignazio','trevi','sant_andrea_quirinale','quattro_fontane','vittoria']},
 sotto:     {g:1, fisso:true, t:['vicus_caprarius','palazzo_valentini','carcere_mamertino','domus_aurea','san_clemente','case_celio']},
 bambini:   {g:1, t:['bioparco','villa_borghese','pincio','spagna','trevi','time_elevator']},
 verde:     {g:1, fisso:true, t:['villa_borghese','pincio','circo_massimo','giardino_aranci','buco_serratura','fontanone','gianicolo']},
 alternativa:{g:1, t:['testaccio','cimitero_acattolico','ostiense_street_art','garbatella','tor_marancia']},
};
for (const [k,v] of Object.entries(T)){
  const r=P.daSelezione(db,v.t,{ritmo:'medio',giorni:v.g,partenza:{lat:41.9085842,lon:12.5216869},eta:35,ordineFisso:!!v.fisso,serale:!!v.serale});
  const g=r.giorni[0];
  console.log(`${k.padEnd(11)} giorni: ${r.giorniNecessari??1} | ${Math.round((g.visite+g.spostamenti)/6)/10}h | ${g.costo}€ | ${g.righe.map(x=>x.pranzo?'🍝':(x.tratta.modo==='mezzi'?'🚇':'🚶')+x.nome.split(' (')[0].split(',')[0]).join(' ')}${g.serata?' || sera: '+g.serata.nome:''}${r.daTogliere&&r.daTogliere.length?' || TOGLIERE: '+r.daTogliere.join(','):''}`);
}
