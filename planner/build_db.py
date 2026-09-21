import json
# campi: id, nome, cat, zona, lat, lon, prezzo (intero adulto, None=gratis? no: 0=gratis, None=da verificare),
# imp 1-5, fatica 1-3, durata (min), desc, verifica (True se prezzo da confermare), temp (data fine o None)
A=[]
def add(id,nome,cat,zona,lat,lon,prezzo,imp,fat,dur,desc,verifica=False,temp=None,momento=None):
    A.append(dict(id=id,nome=nome,cat=cat,zona=zona,lat=lat,lon=lon,prezzo=prezzo,imp=imp,fatica=fat,durata=dur,desc=desc,verifica=verifica,temp=temp,momento=momento or ['qualsiasi']))

# ---------- BLOCCO 1: insolite / musei particolari ----------
add('illusioni','Museo delle Illusioni',['insolito','museo'],'Monti',41.8946,12.5025,22,3,1,75,'Oltre 70 illusioni ottiche e stanze interattive: divertente per tutte le età.',True)
add('cappuccini','Cripta dei Cappuccini',['insolito','chiesa'],'Via Veneto',41.9044,12.4886,10,3,1,45,'Cappelle decorate con le ossa di migliaia di frati: macabra e unica al mondo.')
add('montemartini','Centrale Montemartini',['insolito','museo','archeologia'],'Ostiense',41.8665,12.4777,None,3,1,75,'Statue romane esposte tra le turbine di una vecchia centrale elettrica.',True)
add('serra_moresca','Serra Moresca di Villa Torlonia',['insolito','parco'],'Nomentano',41.9155,12.5125,None,2,1,45,'Serra ottocentesca in stile Alhambra, con vetrate colorate.',True)
add('museo_luce','Museo della Luce',['insolito','museo'],'Campidoglio',41.8950,12.4800,None,2,1,60,'Fisica della luce raccontata con installazioni da toccare.',True)
add('welcome_rome','Welcome to Rome',['insolito','museo'],'Centro Storico',41.8990,12.4700,None,3,1,60,'Viaggio multimediale nei 2700 anni della città, ottimo come introduzione.',True)
add('barracco','Museo Barracco',['museo','archeologia'],'Centro Storico',41.8967,12.4727,0,2,1,45,'Piccola collezione di sculture egizie, assire, greche e romane.')
add('museo_mura','Museo delle Mura',['insolito','archeologia'],'Appia Antica',41.8733,12.5014,0,2,2,45,'Si cammina dentro Porta San Sebastiano e lungo le Mura Aureliane.')
add('lab_mente','Museo Laboratorio della Mente',['insolito','museo'],'Monte Mario',41.9536,12.4300,None,2,1,75,'Nell\'ex manicomio di Santa Maria della Pietà: toccante e poco conosciuto.',True)
add('anime_purgatorio','Museo delle Anime del Purgatorio',['insolito','chiesa'],'Prati',41.9036,12.4737,0,2,1,20,'Minuscola raccolta di "impronte dall\'aldilà" dentro una chiesa neogotica.')
add('buco_serratura','Buco della Serratura dell\'Aventino',['insolito','panorama'],'Aventino',41.8834,12.4787,0,4,1,20,'San Pietro incorniciato nella serratura dei Cavalieri di Malta.')
add('coppede','Quartiere Coppedè',['insolito','quartiere'],'Trieste',41.9178,12.5028,0,3,1,40,'Architettura fiabesca tra liberty, gotico e medievale.')
add('palazzo_valentini','Domus Romane di Palazzo Valentini',['insolito','archeologia'],'Piazza Venezia',41.8963,12.4834,None,4,1,75,'Case romane sotto un palazzo, rianimate da proiezioni multimediali.',True)
add('case_celio','Case Romane del Celio',['insolito','archeologia'],'Celio',41.8871,12.4924,None,3,1,60,'Abitazioni romane affrescate sotto una basilica.',True)
add('galleria_spada','Galleria Spada',['museo','insolito'],'Campo de\' Fiori',41.8940,12.4715,None,3,1,45,'Famosa per la finta prospettiva di Borromini: 9 metri che sembrano 35.',True)
add('galleria_sciarra','Galleria Sciarra',['insolito'],'Trevi',41.8998,12.4818,0,2,1,15,'Cortile liberty affrescato, nascosto a due passi da via del Corso.')
add('maxxi','MAXXI',['museo'],'Flaminio',41.9286,12.4666,None,3,1,90,'Arte contemporanea nell\'edificio progettato da Zaha Hadid.',True)
add('dreamers','Museum of Dreamers',['insolito','museo'],'Prati',41.9160,12.4600,None,2,1,60,'Stanze immersive e colorate, pensate per le foto.',True)
add('ikono','Ikono',['insolito','museo'],'Pantheon',41.8991,12.4781,None,2,1,60,'Esperienza sensoriale a stanze tematiche.',True)
add('time_elevator','Time Elevator',['insolito','museo'],'Trevi',41.8981,12.4830,None,2,1,45,'Cinema 5D con sedili mobili sulla storia di Roma, adatto ai bambini.',True)

# ---------- BLOCCO 2: imperdibili centro storico ----------
add('colosseo','Colosseo, Foro Romano e Palatino',['archeologia'],'Colosseo',41.8902,12.4922,18,5,3,180,'Il simbolo di Roma e il cuore della città antica, con un unico biglietto.')
add('pantheon','Pantheon',['archeologia','chiesa'],'Pantheon',41.8986,12.4769,7,5,1,45,'Il tempio romano meglio conservato, con la cupola più grande in calcestruzzo mai costruita.')
add('trevi','Fontana di Trevi',['piazza','fontana'],'Trevi',41.9009,12.4833,0,5,1,20,'La fontana più famosa del mondo. Vista libera dalla piazza, 2€ per scendere vicino all\'acqua.')
add('navona','Piazza Navona',['piazza','fontana'],'Navona',41.8992,12.4731,0,5,1,30,'Piazza barocca con la Fontana dei Quattro Fiumi di Bernini.')
add('spagna','Piazza di Spagna e Trinità dei Monti',['piazza'],'Spagna',41.9058,12.4823,0,5,1,30,'La scalinata più famosa di Roma, con la Barcaccia ai suoi piedi.')
add('capitolini','Musei Capitolini e Piazza del Campidoglio',['museo','archeologia'],'Campidoglio',41.8933,12.4828,17,4,2,120,'Il museo pubblico più antico del mondo, nella piazza disegnata da Michelangelo.')
add('castel_santangelo','Castel Sant\'Angelo',['museo','panorama'],'Borgo',41.9031,12.4663,18,4,2,90,'Da mausoleo di Adriano a fortezza dei papi, con terrazza panoramica.')
add('vittoriano','Vittoriano',['panorama','museo'],'Piazza Venezia',41.8946,12.4831,0,4,1,60,'Monumento imponente a ingresso libero; la terrazza panoramica costa 18€.')
add('fori_imperiali','Via dei Fori Imperiali',['archeologia','passeggiata'],'Colosseo',41.8925,12.4876,0,4,1,30,'Passeggiata tra i fori di Cesare, Augusto e Traiano, visibili dalla strada.')
add('ghetto','Ghetto ebraico e Portico d\'Ottavia',['quartiere'],'Ghetto',41.8925,12.4775,0,4,1,45,'Il quartiere ebraico più antico d\'Europa, tra rovine romane e carciofi alla giudia.')
add('popolo','Piazza del Popolo',['piazza'],'Flaminio',41.9107,12.4763,0,4,1,20,'Grande piazza neoclassica con l\'obelisco e le chiese gemelle.')
add('campo_fiori','Campo de\' Fiori',['piazza','mercato'],'Campo de\' Fiori',41.8956,12.4722,0,3,1,20,'Mercato la mattina, vita notturna la sera, con la statua di Giordano Bruno.')
add('bocca_verita','Bocca della Verità',['insolito'],'Foro Boario',41.8881,12.4814,None,3,1,20,'La leggendaria maschera che morde la mano dei bugiardi.',True)
add('torre_argentina','Largo di Torre Argentina',['archeologia'],'Centro Storico',41.8955,12.4768,0,3,1,15,'Area sacra dove fu ucciso Cesare, oggi anche colonia felina.')
add('teatro_marcello','Teatro di Marcello',['archeologia'],'Ghetto',41.8918,12.4798,0,3,1,15,'Teatro romano su cui è stato costruito un palazzo abitato.')
add('isola_tiberina','Isola Tiberina',['passeggiata'],'Trastevere',41.8906,12.4775,0,3,1,20,'L\'unica isola del Tevere, collegata dal ponte romano più antico ancora in uso.')
add('circo_massimo','Circo Massimo',['archeologia','parco'],'Aventino',41.8861,12.4851,0,3,1,20,'Il più grande stadio dell\'antichità, oggi un grande prato.')
add('ara_pacis','Ara Pacis',['museo','archeologia'],'Flaminio',41.9063,12.4755,None,3,1,45,'Altare di Augusto nella teca di Richard Meier.',True)

# ---------- BLOCCO 3: Vaticano e dintorni ----------
add('musei_vaticani','Musei Vaticani e Cappella Sistina',['museo'],'Vaticano',41.9065,12.4536,20,5,3,210,'Una delle collezioni più grandi al mondo, fino al Giudizio di Michelangelo. Online con salta fila 25€.')
add('san_pietro','Basilica di San Pietro',['chiesa'],'Vaticano',41.9022,12.4539,0,5,2,60,'La chiesa più grande della cristianità, con la Pietà di Michelangelo.')
add('piazza_san_pietro','Piazza San Pietro',['piazza'],'Vaticano',41.9022,12.4568,0,5,1,20,'Il colonnato di Bernini abbraccia i fedeli.')
add('cupola','Cupola di San Pietro',['panorama','chiesa'],'Vaticano',41.9021,12.4533,17,4,3,60,'Oltre 500 gradini fino alla vista più famosa di Roma.',True)
add('grotte_vaticane','Grotte Vaticane',['chiesa'],'Vaticano',41.9022,12.4539,0,3,1,30,'Le tombe dei papi sotto la basilica.')
add('necropoli','Necropoli Vaticana (Scavi)',['archeologia','insolito'],'Vaticano',41.9020,12.4530,13,3,2,90,'Visita guidata alla tomba di San Pietro: prenotazione con largo anticipo.',True)
add('giardini_vaticani','Giardini Vaticani',['parco'],'Vaticano',41.9040,12.4500,None,3,2,120,'Visita guidata ai giardini dei papi, solo su prenotazione.',True)
add('ponte_santangelo','Ponte Sant\'Angelo',['passeggiata'],'Borgo',41.9014,12.4664,0,3,1,15,'Il ponte degli angeli di Bernini, davanti al castello.')
add('borgo_pio','Borgo Pio e Passetto di Borgo',['quartiere'],'Borgo',41.9040,12.4610,0,2,1,30,'Viuzze sotto il corridoio segreto che portava i papi al castello.')
add('prati','Prati e Via Cola di Rienzo',['quartiere','shopping'],'Prati',41.9080,12.4640,0,2,1,45,'Quartiere elegante umbertino, ottimo per shopping.')
add('palazzaccio','Palazzo di Giustizia',['architettura'],'Prati',41.9030,12.4700,0,2,1,10,'Il "Palazzaccio", monumentale e controverso.')

# ---------- BLOCCO 4: chiese e basiliche ----------
add('laterano','San Giovanni in Laterano',['chiesa'],'San Giovanni',41.8859,12.5057,0,5,2,60,'La cattedrale di Roma, madre di tutte le chiese del mondo.')
add('santa_maria_maggiore','Santa Maria Maggiore',['chiesa'],'Esquilino',41.8976,12.4984,0,5,2,60,'Mosaici del V secolo e soffitto dorato con il primo oro delle Americhe.')
add('san_paolo','San Paolo fuori le Mura',['chiesa'],'Ostiense',41.8587,12.4768,0,4,2,60,'Basilica immensa con i ritratti di tutti i papi e un chiostro splendido.')
add('vincoli','San Pietro in Vincoli',['chiesa'],'Monti',41.8938,12.4930,0,4,1,20,'Il Mosè di Michelangelo e le catene di San Pietro.')
add('san_clemente','San Clemente e i suoi sotterranei',['chiesa','archeologia','insolito'],'Colosseo',41.8894,12.4975,10,4,2,90,'Tre livelli sovrapposti: chiesa medievale, basilica del IV secolo e tempio di Mitra. Scavi su prenotazione.')
add('santa_maria_trastevere','Santa Maria in Trastevere',['chiesa'],'Trastevere',41.8894,12.4700,0,4,1,20,'Una delle chiese più antiche di Roma, con mosaici d\'oro in facciata e abside.')
add('san_luigi','San Luigi dei Francesi',['chiesa','arte'],'Navona',41.8997,12.4745,0,4,1,20,'Tre capolavori di Caravaggio sulla vita di San Matteo, gratis.')
add('sant_ignazio','Sant\'Ignazio',['chiesa','insolito'],'Pantheon',41.8990,12.4797,0,4,1,20,'La finta cupola dipinta di Andrea Pozzo: uno specchio al centro svela l\'inganno.')
add('santa_maria_popolo','Santa Maria del Popolo',['chiesa','arte'],'Flaminio',41.9115,12.4765,0,4,1,20,'Due Caravaggio e la Cappella Chigi di Raffaello e Bernini.')
add('gesu','Chiesa del Gesù',['chiesa'],'Centro Storico',41.8959,12.4798,0,4,1,20,'Capolavoro barocco dei gesuiti; ogni giorno alle 17:30 la "macchina" dell\'altare di Sant\'Ignazio.')
add('minerva','Santa Maria sopra Minerva',['chiesa'],'Pantheon',41.8980,12.4776,0,3,1,20,'L\'unica chiesa gotica di Roma, con davanti l\'elefantino di Bernini.')
add('scala_santa','Scala Santa',['chiesa','insolito'],'San Giovanni',41.8876,12.5063,0,3,2,30,'La scala che Gesù avrebbe salito da Pilato: i fedeli la salgono in ginocchio.')
add('vittoria','Santa Maria della Vittoria',['chiesa','arte'],'Repubblica',41.9046,12.4943,0,3,1,15,'L\'Estasi di Santa Teresa, capolavoro di Bernini.')
add('sant_agostino','Sant\'Agostino',['chiesa','arte'],'Navona',41.9007,12.4742,0,3,1,15,'La Madonna dei Pellegrini di Caravaggio.')
add('aracoeli','Santa Maria in Aracoeli',['chiesa','panorama'],'Campidoglio',41.8940,12.4830,0,3,2,30,'Si arriva salendo 124 gradini; dentro affreschi del Pinturicchio.')
add('santa_cecilia','Santa Cecilia in Trastevere',['chiesa'],'Trastevere',41.8876,12.4760,0,3,1,30,'La statua della santa scolpita come fu ritrovata e un raro affresco di Cavallini.')
add('santa_prassede','Santa Prassede',['chiesa','arte'],'Esquilino',41.8960,12.4985,0,3,1,20,'La cappella di San Zenone, interamente coperta di mosaici d\'oro.')
add('quattro_fontane','San Carlo alle Quattro Fontane',['chiesa','architettura'],'Quirinale',41.9017,12.4910,0,3,1,20,'Il capolavoro di Borromini: una cupola ovale grande quanto un pilastro di San Pietro.')
add('sant_andrea_quirinale','Sant\'Andrea al Quirinale',['chiesa','architettura'],'Quirinale',41.9006,12.4889,0,3,1,15,'La "perla" di Bernini, a cento metri dalla rivale di Borromini.')
add('santo_stefano_rotondo','Santo Stefano Rotondo',['chiesa','insolito'],'Celio',41.8847,12.4968,0,3,1,30,'Chiesa circolare del V secolo, con crudi affreschi di martiri.')
add('quattro_coronati','Santi Quattro Coronati',['chiesa','insolito'],'Celio',41.8881,12.5003,None,3,1,40,'Monastero fortificato con la cappella di San Silvestro e un chiostro nascosto.',True)
add('santa_sabina','Santa Sabina',['chiesa'],'Aventino',41.8843,12.4795,0,3,1,20,'Basilica del V secolo con porta in legno originale e giardino degli aranci accanto.')
add('tempietto_bramante','Tempietto del Bramante',['chiesa','architettura'],'Trastevere',41.8886,12.4668,0,3,2,20,'Il gioiello del Rinascimento, dove secondo la tradizione fu crocifisso Pietro.')
add('santa_maria_angeli','Santa Maria degli Angeli',['chiesa','insolito'],'Repubblica',41.9030,12.4965,0,3,1,30,'Michelangelo trasformò le Terme di Diocleziano in chiesa; sul pavimento una meridiana.')
add('sant_ivo','Sant\'Ivo alla Sapienza',['chiesa','architettura'],'Navona',41.8986,12.4747,0,2,1,15,'La cupola a spirale di Borromini; aperta di solito solo la domenica mattina.')
add('san_lorenzo','San Lorenzo fuori le Mura',['chiesa'],'San Lorenzo',41.9024,12.5213,0,2,1,30,'Basilica medievale col chiostro, accanto al cimitero del Verano.')
add('santa_costanza','Mausoleo di Santa Costanza',['chiesa','insolito'],'Nomentano',41.9225,12.5180,0,3,1,30,'Mausoleo del IV secolo con mosaici di vendemmia ancora pagani.')
add('chiostro_bramante','Chiostro del Bramante',['architettura','museo'],'Navona',41.8997,12.4715,None,2,1,60,'Chiostro rinascimentale che ospita mostre temporanee, con caffetteria affacciata sulla Pace.',True)
add('cosma_damiano','Santi Cosma e Damiano',['chiesa','insolito'],'Fori',41.8923,12.4880,0,2,1,20,'Mosaico absidale del VI secolo e un grande presepe napoletano del Settecento.')

# ---------- BLOCCO 5: parchi, ville e panorami ----------
add('galleria_borghese','Galleria Borghese',['museo','arte'],'Villa Borghese',41.9142,12.4921,18,5,2,120,'Bernini e Caravaggio in una villa barocca. Prenotazione obbligatoria, turni da 2 ore.')
add('villa_borghese','Villa Borghese',['parco'],'Villa Borghese',41.9130,12.4850,0,4,2,90,'Il parco più famoso di Roma: viali, laghetto con barchette, noleggio bici e risciò.')
add('pincio','Terrazza del Pincio',['panorama','parco'],'Villa Borghese',41.9115,12.4800,0,4,1,20,'Vista su Piazza del Popolo e sulle cupole, splendida al tramonto.')
add('giardino_aranci','Giardino degli Aranci',['panorama','parco'],'Aventino',41.8849,12.4796,0,4,1,20,'Il tramonto più romantico di Roma, tra gli aranci sopra il Tevere.')
add('gianicolo','Belvedere del Gianicolo',['panorama','parco'],'Gianicolo',41.8918,12.4612,0,4,2,45,'La terrazza più ampia sulla città; a mezzogiorno spara un colpo di cannone.')
add('fontanone','Fontanone del Gianicolo',['fontana','panorama'],'Gianicolo',41.8888,12.4659,0,3,1,15,'La mostra dell\'Acqua Paola, con vista su Trastevere.')
add('terrazza_caffarelli','Terrazza Caffarelli',['panorama'],'Campidoglio',41.8928,12.4815,0,3,1,20,'Terrazza sul Campidoglio con vista sui tetti e sul Vittoriano.')
add('parco_acquedotti','Parco degli Acquedotti',['parco','archeologia'],'Appia',41.8528,12.5580,0,4,2,90,'Archi di acquedotti romani in mezzo ai prati: la Roma della "Grande Bellezza".')
add('appia_antica','Via Appia Antica',['archeologia','parco','passeggiata'],'Appia',41.8590,12.5200,0,4,3,180,'La "regina delle strade": basoli romani, tombe e campagna, da fare a piedi o in bici.')
add('villa_doria_pamphilj','Villa Doria Pamphilj',['parco'],'Monteverde',41.8862,12.4467,0,3,2,90,'Il parco più grande di Roma, amato dai romani per correre e fare picnic.')
add('villa_torlonia','Villa Torlonia',['parco','museo'],'Nomentano',41.9142,12.5118,0,3,1,60,'La villa di Mussolini con la Casina delle Civette in stile liberty.')
add('roseto','Roseto Comunale',['parco'],'Aventino',41.8843,12.4833,0,2,1,30,'Oltre mille varietà di rose, aperto solo in primavera.')
add('villa_celimontana','Villa Celimontana',['parco'],'Celio',41.8845,12.4930,0,2,1,40,'Parco tranquillo a due passi dal Colosseo, con un obelisco egizio.')
add('villa_sciarra','Villa Sciarra',['parco','insolito'],'Monteverde',41.8834,12.4660,0,2,1,40,'Piccolo giardino romantico con fontane e statue, quasi sconosciuto ai turisti.')
add('villa_ada','Villa Ada',['parco'],'Salario',41.9330,12.4990,0,2,2,90,'Grande parco naturale con laghetto, ex residenza reale.')
add('caffarella','Parco della Caffarella',['parco'],'Appia',41.8650,12.5180,0,2,2,90,'Campagna romana in città: fattorie, ninfei e ruderi.')
add('orto_botanico','Orto Botanico',['parco'],'Trastevere',41.8927,12.4686,None,2,1,60,'Giardino botanico ai piedi del Gianicolo, con serre e bambù.',True)
add('bioparco','Bioparco',['parco','famiglia'],'Villa Borghese',41.9168,12.4832,None,2,2,150,'Lo zoo di Roma, ideale per chi viaggia con bambini.',True)
add('villa_medici','Villa Medici',['arte','parco'],'Spagna',41.9087,12.4796,None,2,1,60,'Sede dell\'Accademia di Francia: giardini rinascimentali con visita guidata.',True)
add('zodiaco','Belvedere dello Zodiaco',['panorama'],'Monte Mario',41.9290,12.4440,0,2,1,20,'Il punto più alto di Roma, lontano dal centro: si raggiunge in bus o taxi.')

# ---------- BLOCCO 6: Roma sotterranea e archeologia ----------
add('domus_aurea','Domus Aurea',['archeologia','insolito'],'Colle Oppio',41.8913,12.4955,18,4,2,90,'Il palazzo sepolto di Nerone, con visore VR che mostra le sale com\'erano. Piccoli gruppi, prenotare presto.')
add('colosseo_sotterranei','Colosseo: arena e sotterranei',['archeologia','insolito'],'Colosseo',41.8902,12.4922,None,3,2,90,'Visita speciale dove passavano gladiatori e belve, con accesso all\'arena.',True)
add('caracalla','Terme di Caracalla',['archeologia'],'Aventino',41.8790,12.4924,None,4,2,90,'Le terme più imponenti dell\'antichità, meno affollate del Foro. In estate ospitano l\'opera.',True)
add('ostia_antica','Ostia Antica',['archeologia'],'Fuori Roma',41.7556,12.2923,None,4,3,240,'Una Pompei a 30 minuti di treno: strade, taverne, teatro e case intatte.',True,momento=['mattina'])
add('palazzo_massimo','Museo Nazionale Romano – Palazzo Massimo',['museo','archeologia'],'Termini',41.9013,12.4984,None,4,2,90,'Affreschi della villa di Livia, il Pugile in riposo e mosaici straordinari.',True)
add('terme_diocleziano','Terme di Diocleziano',['archeologia','museo'],'Termini',41.9029,12.4983,None,3,1,60,'Enormi terme romane con un chiostro di Michelangelo.',True)
add('palazzo_altemps','Palazzo Altemps',['museo','arte'],'Navona',41.9014,12.4726,None,3,1,60,'Sculture antiche in un palazzo rinascimentale, tra cui il Trono Ludovisi.',True)
add('crypta_balbi','Crypta Balbi',['archeologia','museo'],'Ghetto',41.8950,12.4787,None,2,1,45,'Come Roma si è trasformata dall\'antichità al Medioevo, strato dopo strato.',True)
add('mercati_traiano','Mercati di Traiano',['archeologia','museo','panorama'],'Fori',41.8958,12.4866,None,3,2,75,'Il "centro commerciale" di Roma antica, con vista dall\'alto sui Fori.',True)
add('carcere_mamertino','Carcere Mamertino',['archeologia','insolito'],'Fori',41.8932,12.4843,None,3,1,40,'La prigione dove secondo la tradizione fu rinchiuso San Pietro.',True)
add('stadio_domiziano','Stadio di Domiziano',['archeologia','insolito'],'Navona',41.9004,12.4725,None,3,1,45,'Lo stadio romano nascosto sotto Piazza Navona, che ne spiega la forma.',True)
add('vicus_caprarius','Vicus Caprarius – Città dell\'Acqua',['archeologia','insolito'],'Trevi',41.9005,12.4830,None,3,1,40,'Sotto Trevi, un\'antica casa romana attraversata dall\'acqua che alimenta la fontana.',True)
add('mausoleo_augusto','Mausoleo di Augusto',['archeologia'],'Flaminio',41.9060,12.4764,None,3,1,45,'La tomba circolare del primo imperatore, riaperta dopo decenni di restauri.',True)
add('san_callisto','Catacombe di San Callisto',['archeologia','chiesa'],'Appia',41.8588,12.5108,None,4,2,60,'Le catacombe più grandi e famose, con la cripta dei papi. Visita guidata inclusa.',True)
add('domitilla','Catacombe di Domitilla',['archeologia','chiesa'],'Appia',41.8574,12.5054,10,3,2,60,'Catacombe con una basilica sotterranea e affreschi paleocristiani. Visita guidata inclusa.')
add('san_sebastiano','Catacombe di San Sebastiano',['archeologia','chiesa'],'Appia',41.8554,12.5157,None,3,2,60,'Catacombe con mausolei romani perfettamente conservati.',True)
add('priscilla','Catacombe di Priscilla',['archeologia','chiesa'],'Salario',41.9303,12.5070,None,3,2,60,'La più antica raffigurazione conosciuta della Madonna. Vicina alle nostre strutture.',True)
add('cecilia_metella','Tomba di Cecilia Metella',['archeologia'],'Appia',41.8519,12.5199,None,3,2,45,'Il mausoleo-fortezza simbolo dell\'Appia Antica.',True)
add('villa_quintili','Villa dei Quintili',['archeologia','insolito'],'Appia',41.8318,12.5470,None,2,2,75,'Villa imperiale enorme e quasi deserta, fuori dai circuiti turistici.',True)
add('cimitero_acattolico','Cimitero Acattolico e Piramide Cestia',['insolito','archeologia'],'Testaccio',41.8762,12.4800,0,3,1,45,'Il cimitero romantico di Keats e Shelley, all\'ombra di una piramide romana.')
add('monte_testaccio','Monte dei Cocci',['archeologia','insolito'],'Testaccio',41.8757,12.4755,None,2,1,45,'Una collina fatta interamente di anfore rotte: la discarica di Roma antica.',True)

# ---------- BLOCCO 7: quartieri da girare (importanza gia' in scala 1-10) ----------
def add10(*args, **kw):
    add(*args, **kw)
    A[-1]['_imp10'] = True
add10('trastevere','Trastevere',['quartiere'],'Trastevere',41.8890,12.4700,0,8,2,120,'Vicoli di sanpietrini, edera e trattorie: il quartiere più romano di Roma, al meglio la sera.',momento=['sera'])
add10('monti','Rione Monti',['quartiere'],'Monti',41.8950,12.4930,0,7,2,90,'Il rione più antico, oggi pieno di botteghe vintage, artigiani e piazzette.',momento=['sera'])
add10('testaccio','Testaccio e il suo mercato',['quartiere','mercato'],'Testaccio',41.8775,12.4765,0,6,2,90,'Il quartiere della cucina romana verace, col mercato coperto e lo street food.',momento=['mattina'])
add10('via_margutta','Via Margutta',['quartiere','insolito'],'Spagna',41.9070,12.4790,0,5,1,20,'La via degli artisti e di "Vacanze romane", con botteghe e gallerie.')
add10('piazza_mattei','Fontana delle Tartarughe',['fontana','insolito'],'Ghetto',41.8938,12.4776,0,5,1,10,'Piccola fontana rinascimentale in una piazzetta nascosta del Ghetto.')
add10('garbatella','Garbatella',['quartiere','insolito'],'Garbatella',41.8620,12.4870,0,5,2,90,'Città giardino degli anni \'20: villini, cortili e lotti popolari da cartolina.')
add10('pigneto','Pigneto',['quartiere','street_art'],'Pigneto',41.8890,12.5280,0,5,2,75,'Il quartiere di Pasolini, oggi murales, locali e vita notturna alternativa.',momento=['sera'])
add10('via_giulia','Via Giulia',['quartiere'],'Campo de\' Fiori',41.8960,12.4690,0,4,1,30,'Strada rinascimentale dritta come un fuso, con palazzi nobiliari e l\'arco Farnese.')
add10('piazza_farnese','Piazza Farnese',['piazza'],'Campo de\' Fiori',41.8948,12.4710,0,4,1,15,'Piazza elegante col palazzo di Michelangelo, oggi ambasciata di Francia.')
add10('via_coronari','Via dei Coronari',['quartiere','shopping'],'Navona',41.9005,12.4705,0,4,1,30,'La via degli antiquari, a due passi da Piazza Navona.')
add10('san_lorenzo_quartiere','San Lorenzo',['quartiere','street_art'],'San Lorenzo',41.8980,12.5150,0,4,2,60,'Il quartiere universitario, murales e locali. A pochi passi dalle nostre strutture.',momento=['sera'])
add10('eur','EUR',['quartiere','architettura'],'EUR',41.8360,12.4690,0,4,2,120,'La città razionalista voluta per l\'Esposizione del 1942, col "Colosseo quadrato".')
add10('ostiense_street_art','Ostiense e Gazometro',['street_art','insolito'],'Ostiense',41.8700,12.4790,0,4,2,60,'Archeologia industriale e grandi murales, dal Gazometro all\'ex Mercati Generali.')
add10('tor_marancia','Tor Marancia – Big City Life',['street_art','insolito'],'Garbatella',41.8560,12.4930,0,4,1,45,'Ventidue palazzine popolari dipinte da street artist internazionali.')
add10('governo_vecchio','Via del Governo Vecchio',['quartiere','shopping'],'Navona',41.8985,12.4705,0,3,1,20,'Negozi vintage e botteghe tra Navona e Chiesa Nuova.')
add10('quadraro','Quadraro e il MURo',['street_art','insolito'],'Quadraro',41.8570,12.5580,0,3,2,75,'Museo di urban art a cielo aperto in un quartiere popolare della Resistenza.')

# ---------- IMPORTANZA 1-10 ----------
# conversione dalla vecchia scala 1-5 (5->9, 4->7, 3->5, 2->3), poi ritocchi manuali
IMP10 = {
 # 10: i simboli assoluti di Roma
 'colosseo':10,'musei_vaticani':10,'san_pietro':10,'pantheon':10,'trevi':10,
 # 9
 'navona':9,'galleria_borghese':9,'piazza_san_pietro':9,
 # 8
 'spagna':8,'laterano':8,'santa_maria_maggiore':8,'castel_santangelo':8,'capitolini':8,'fori_imperiali':8,'cupola':8,
 # 7
 'vittoriano':7,'ghetto':7,'popolo':7,'villa_borghese':7,'pincio':7,'giardino_aranci':7,'gianicolo':7,'buco_serratura':7,
 'domus_aurea':7,'caracalla':7,'ostia_antica':7,'appia_antica':7,'san_paolo':7,'vincoli':7,'santa_maria_trastevere':7,
 'san_luigi':7,'san_clemente':7,'san_callisto':7,'campo_fiori':6,
 # 6
 'parco_acquedotti':6,'sant_ignazio':6,'santa_maria_popolo':6,'gesu':6,'palazzo_valentini':6,'palazzo_massimo':6,
 'cappuccini':6,'isola_tiberina':6,'coppede':6,'bocca_verita':6,'mercati_traiano':6,
 # 5
 'illusioni':5,'torre_argentina':5,'circo_massimo':5,'montemartini':5,'welcome_rome':5,'galleria_spada':5,'maxxi':5,
 'minerva':5,'vittoria':5,'quattro_fontane':5,'cimitero_acattolico':5,'vicus_caprarius':5,'stadio_domiziano':5,
 'carcere_mamertino':5,'mausoleo_augusto':5,'ara_pacis':5,'teatro_marcello':5,'scala_santa':5,'tempietto_bramante':5,
 'fontanone':5,'terrazza_caffarelli':5,'villa_doria_pamphilj':5,'villa_torlonia':5,'aracoeli':5,'santa_prassede':5,
 'domitilla':5,'priscilla':5,'san_sebastiano':5,'terme_diocleziano':5,'palazzo_altemps':5,'grotte_vaticane':5,
 'ponte_santangelo':5,'necropoli':5,'colosseo_sotterranei':5,
 # 4
 'case_celio':4,'sant_agostino':4,'sant_andrea_quirinale':4,'santo_stefano_rotondo':4,'quattro_coronati':4,
 'santa_sabina':4,'santa_maria_angeli':4,'santa_cecilia':4,'giardini_vaticani':4,'cecilia_metella':4,
 'santa_costanza':4,'borgo_pio':4,'museo_luce':4,'barracco':4,'galleria_sciarra':4,'anime_purgatorio':4,
 'museo_mura':4,'monte_testaccio':4,'crypta_balbi':4,'villa_celimontana':4,'villa_sciarra':4,'roseto':4,
 # 3
 'serra_moresca':3,'lab_mente':3,'dreamers':3,'ikono':3,'time_elevator':3,'prati':3,'orto_botanico':3,
 'bioparco':3,'villa_medici':3,'villa_ada':3,'caffarella':3,'sant_ivo':3,'chiostro_bramante':3,'cosma_damiano':3,
 'villa_quintili':3,'san_lorenzo':3,
 # 2
 'palazzaccio':2,'zodiaco':2,
}
for a in A:
    if not a.get('_imp10'):
        a['imp'] = IMP10.get(a['id'], a['imp']*2-1)
    a.pop('_imp10', None)

# ---------- MOMENTO IDEALE ----------
# mattina = presto per caldo/folla; sera = dopo cena/illuminato; tramonto = ultima tappa del giorno
MOMENTO = {
 'tramonto': ['pincio','giardino_aranci','gianicolo','zodiaco','terrazza_caffarelli','fontanone'],
 'mattina':  ['colosseo','musei_vaticani','cupola','appia_antica','parco_acquedotti','campo_fiori','san_pietro','pantheon'],
 'sera':     ['trevi','navona','ghetto','isola_tiberina','spagna','campo_fiori','ponte_santangelo','fori_imperiali'],
 'pomeriggio':['gesu'],
}
for a in A:
    m=[k for k,ids in MOMENTO.items() if a['id'] in ids]
    if m: a['momento']=m

json.dump(A,open('attrazioni.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
ver=sum(1 for a in A if a['verifica'])
print(len(A),'attrazioni |',ver,'con prezzo da verificare')
