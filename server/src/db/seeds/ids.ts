/**
 * Seed world ids (SPEC §7) — FINAL. Slice seeds reference §7 ids only through `kit.users` or this file.
 * Id scheme: university `uni_<key>` · student `u_<handle>` · org `o_<handle>` · background `bg_<4 digits>` ·
 * slice rows `kit.id(prefix, n)`.
 */

export const UNI = {
  utexas: 'uni_utexas',
  umich: 'uni_umich',
  stanford: 'uni_stanford',
  nyu: 'uni_nyu',
  utoronto: 'uni_utoronto',
  ethz: 'uni_ethz',
  tum: 'uni_tum',
  oxford: 'uni_oxford',
  nus: 'uni_nus',
  iitb: 'uni_iitb',
  unimelb: 'uni_unimelb',
} as const;

/** The hero campus. */
export const HERO_UNI = UNI.utexas;

/** Student personas (§7.2), keyed by handle. */
export const U = {
  mayachen: 'u_mayachen',
  jordan_builds: 'u_jordan_builds',
  sofiaram: 'u_sofiaram',
  arjunp: 'u_arjunp',
  priya_n: 'u_priya_n',
  tbrooks: 'u_tbrooks',
  aaliyah_w: 'u_aaliyah_w',
  lucas_oli: 'u_lucas_oli',
  hannahkim: 'u_hannahkim',
  noahg: 'u_noahg',
  emmalq: 'u_emmalq',
  diegoh: 'u_diegoh',
  zoemtz: 'u_zoemtz',
  ethan_ng: 'u_ethan_ng',
  oliviab: 'u_oliviab',
  marcusj: 'u_marcusj',
  bellarossi: 'u_bellarossi',
  calebt: 'u_calebt',
  fatima_as: 'u_fatima_as',
  ryanoc: 'u_ryanoc',
  meitanaka: 'u_meitanaka',
  andresilva: 'u_andresilva',
  graceade: 'u_graceade',
  bencarter: 'u_bencarter',
  laylah: 'u_laylah',
  owenpark: 'u_owenpark',
  chloedub: 'u_chloedub',
  samirk: 'u_samirk',
  ninakow: 'u_ninakow',
  devonw: 'u_devonw',
  aisharahman: 'u_aisharahman',
  leofischer: 'u_leofischer',
  kaiyama: 'u_kaiyama',
  elenap: 'u_elenap',
  jamaled: 'u_jamaled',
  tessam: 'u_tessam',
  rafacruz: 'u_rafacruz',
  hanasato: 'u_hanasato',
  imaniclarke: 'u_imaniclarke',
  liamtrem: 'u_liamtrem',
} as const;

/** Org accounts (§7.3), keyed by handle. */
export const ORG = {
  wic_ut: 'o_wic_ut',
  solarcar: 'o_solarcar',
  events_board: 'o_events_board',
  campusdaily: 'o_campusdaily',
  clubsoccer: 'o_clubsoccer',
  climbing_club: 'o_climbing_club',
  isa_ut: 'o_isa_ut',
  premed_society: 'o_premed_society',
  filmsociety: 'o_filmsociety',
  hacknight: 'o_hacknight',
  umich_robotics: 'o_umich_robotics',
  acappella_su: 'o_acappella_su',
} as const;

/** Staff (§7.4): normal student profiles at the hero campus, with roles. */
export const STAFF = {
  dana_w: 'u_dana_w',
  victor_o: 'u_victor_o',
  rileyshaw: 'u_rileyshaw',
} as const;

export const DEMO = {
  student: U.mayachen,
  admin: STAFF.dana_w,
  admin2: STAFF.victor_o,
  moderator: STAFF.rileyshaw,
} as const;

/** Maya's invite code (§7.5). */
export const MAYA_INVITE_CODE = 'MAYA2026';

/** `bg_0001` … — zero-padded to 4 digits. */
export function bgId(n: number): string {
  return `bg_${String(n).padStart(4, '0')}`;
}
