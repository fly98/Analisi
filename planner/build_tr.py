import json, importlib.util, sys, os
db=json.load(open('attrazioni.json'))
ids_a={a['id'] for a in db['attrazioni']}; ids_g={g['id'] for g in db['gite']}; ids_s={s['id'] for s in db['serata']}
est={a['id'] for a in db['attrazioni'] if a.get('esterno')}
os.makedirs('tr',exist_ok=True)
for lang in sys.argv[1:]:
    spec=importlib.util.spec_from_file_location('m',f'tr_{lang}.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    manca=(ids_a-set(m.A))|(ids_g-set(m.G))|(ids_s-set(m.S)); extra=(set(m.A)-ids_a)|(set(m.G)-ids_g)|(set(m.S)-ids_s)
    senza_fuori=[k for k in est if not m.A.get(k,(0,0,None,None))[3]]
    out={'a':{},'g':{},'s':{}}
    for k,(n,d,fn,e) in m.A.items():
        x={'d':d}
        if n: x['n']=n
        if fn: x['fn']=fn
        if e: x['e']=e
        out['a'][k]=x
    for k,(n,d,t,no) in m.G.items():
        x={'d':d,'t':t}
        if n: x['n']=n
        if no: x['no']=no
        out['g'][k]=x
    for k,(n,d) in m.S.items():
        x={'d':d}
        if n: x['n']=n
        out['s'][k]=x
    json.dump(out,open(f'tr/{lang}.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
    print(lang,'| mancanti:',sorted(manca) or 'nessuno','| in piu:',sorted(extra) or 'nessuno','| da fuori senza testo:',senza_fuori or 'nessuno','| KB:',round(os.path.getsize(f'tr/{lang}.json')/1024,1))
