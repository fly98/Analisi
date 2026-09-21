const P=require('./planner.js'), db=require('./attrazioni.json');
const NOSTRI = {
 n1:{g:1, t:['colosseo','fori_imperiali','capitolini_fuori','pantheon','navona','trevi','spagna']},
 n2:{g:2, t:['colosseo','fori_imperiali','capitolini_fuori','pantheon','navona','trevi','spagna',
             'musei_vaticani','san_pietro','piazza_san_pietro','castel_santangelo_fuori']},
 n3:{g:3, t:['colosseo','fori_imperiali','capitolini_fuori','ghetto','isola_tiberina','santa_maria_trastevere',
             'musei_vaticani','san_pietro','piazza_san_pietro','castel_santangelo_fuori',
             'galleria_borghese','pincio','spagna','trevi','pantheon','navona']},
};
for (const [k,v] of Object.entries(NOSTRI)){
  const r=P.daSelezione(db,v.t,{ritmo:'medio',giorni:v.g,partenza:{lat:41.9085842,lon:12.5216869},eta:35});
  console.log(k,'obiettivo',v.g,'-> servono',r.giorniNecessari, r.daTogliere?('togliere: '+r.daTogliere.join(', ')):'');
  r.giorni.forEach(g=>console.log('   G'+g.n, Math.round((g.visite+g.spostamenti)/6)/10+'h', g.righe.filter(x=>!x.pranzo).map(x=>x.nome).join(' → '), '|| sera:', g.serata&&g.serata.nome));
}
