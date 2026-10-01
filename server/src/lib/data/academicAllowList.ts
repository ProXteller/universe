/**
 * Well-known university domains that do NOT match the generic academic patterns (`*.edu`, `*.edu.<cc>`,
 * `*.ac.<cc>`) and are not (yet) full rows of the bundled dataset (Constitution §6). A match makes the domain
 * acceptable; the campus record is auto-created on first sign-up. Matched exactly or as a suffix.
 */
export const ACADEMIC_ALLOW_LIST: ReadonlySet<string> = new Set([
  // Canada
  'concordia.ca', 'carleton.ca', 'uvic.ca', 'usask.ca', 'umanitoba.ca', 'ulaval.ca', 'uqam.ca', 'torontomu.ca',
  'uoguelph.ca', 'unb.ca', 'mun.ca', 'wlu.ca', 'brocku.ca', 'uwindsor.ca', 'polymtl.ca', 'usherbrooke.ca',
  // Germany / Austria / Switzerland
  'uni-muenchen.de', 'uni-bonn.de', 'uni-freiburg.de', 'uni-goettingen.de', 'uni-hamburg.de', 'uni-koeln.de',
  'uni-tuebingen.de', 'uni-mannheim.de', 'uni-leipzig.de', 'uni-frankfurt.de', 'uni-stuttgart.de',
  'tu-dresden.de', 'tu-darmstadt.de', 'uni-muenster.de', 'uni-jena.de', 'uni-wuerzburg.de', 'fau.de',
  'unibas.ch', 'unibe.ch', 'unige.ch', 'unil.ch', 'unisg.ch', 'usi.ch', 'uibk.ac.at', 'jku.at', 'tugraz.at',
  // France
  'ens.fr', 'ens.psl.eu', 'psl.eu', 'u-paris.fr', 'universite-paris-saclay.fr', 'centralesupelec.fr',
  'hec.edu', 'essec.edu', 'insead.edu', 'univ-lyon1.fr', 'univ-amu.fr', 'univ-grenoble-alpes.fr', 'unistra.fr',
  'u-bordeaux.fr', 'univ-lille.fr', 'insa-lyon.fr', 'minesparis.psl.eu',
  // Netherlands / Belgium / Nordics
  'rug.nl', 'ru.nl', 'vu.nl', 'wur.nl', 'tue.nl', 'utwente.nl', 'eur.nl', 'maastrichtuniversity.nl',
  'tilburguniversity.edu', 'uclouvain.be', 'ulb.be', 'uantwerpen.be', 'vub.be', 'su.se', 'gu.se', 'chalmers.se',
  'liu.se', 'umu.se', 'au.dk', 'sdu.dk', 'aau.dk', 'cbs.dk', 'uib.no', 'uit.no', 'nhh.no', 'bi.no',
  'utu.fi', 'tuni.fi', 'oulu.fi', 'jyu.fi', 'hi.is', 'ru.is',
  // Southern & Eastern Europe
  'unimi.it', 'unipd.it', 'unito.it', 'unifi.it', 'unina.it', 'polito.it', 'unibocconi.it', 'unipi.it',
  'uc3m.es', 'upm.es', 'upf.edu', 'uab.cat', 'us.es', 'ugr.es', 'uv.es', 'upv.es', 'unav.es', 'ie.edu',
  'up.pt', 'uc.pt', 'unl.pt', 'uminho.pt', 'uoa.gr', 'auth.gr', 'ntua.gr', 'elte.hu', 'bme.hu', 'ceu.edu',
  'muni.cz', 'cvut.cz', 'vut.cz', 'uj.edu.pl', 'agh.edu.pl', 'pw.edu.pl', 'ut.ee', 'taltech.ee', 'lu.lv',
  'vu.lt', 'uni-lj.si', 'unizg.hr', 'unibuc.ro', 'ubbcluj.ro', 'uni-sofia.bg',
  // Ireland / UK outliers
  'universityofgalway.ie', 'ul.ie', 'dcu.ie', 'mu.ie', 'ucc.ie', 'tudublin.ie',
  // Asia-Pacific & others
  'hkbu.edu.hk', 'polyu.edu.hk', 'cityu.edu.hk', 'connect.polyu.hk', 'my.cityu.edu.hk', 'um.edu.mo',
  'smu.edu.sg', 'sutd.edu.sg', 'uwa.edu.au', 'adelaide.edu.au', 'uts.edu.au', 'rmit.edu.au', 'qut.edu.au',
  'mq.edu.au', 'deakin.edu.au', 'vuw.ac.nz', 'canterbury.ac.nz', 'massey.ac.nz', 'waikato.ac.nz',
  'kaust.edu.sa', 'nyu.edu', 'nyuad.nyu.edu', 'qu.edu.qa', 'aus.edu', 'aud.edu', 'lau.edu.lb', 'aub.edu.lb',
  'strathmore.edu', 'ashesi.edu.gh', 'sun.ac.za', 'up.ac.za', 'uj.ac.za', 'ukzn.ac.za',
  'itam.mx', 'udg.mx', 'ipn.mx', 'uanl.mx', 'puc-rio.br', 'ufrj.br', 'ufmg.br', 'ufrgs.br', 'unesp.br',
  'unb.br', 'utdt.edu', 'itba.edu.ar', 'unc.edu.ar', 'unlp.edu.ar', 'udec.cl', 'usach.cl', 'uai.cl',
  'javeriana.edu.co', 'unal.edu.co', 'pucp.edu.pe', 'pucp.pe', 'up.edu.pe', 'usfq.edu.ec', 'ucr.ac.cr',
]);
