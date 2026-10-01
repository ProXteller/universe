/**
 * Personal mailbox providers (Constitution §6: rejected with a friendly message). Matched exactly or as a suffix
 * (`mail.yahoo.com`). Bundled; no network lookups.
 */
export const PERSONAL_DOMAINS: ReadonlySet<string> = new Set([
  // Google / Microsoft / Apple / Yahoo / AOL
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'outlook.de', 'outlook.es', 'outlook.it', 'outlook.in',
  'outlook.com.au', 'outlook.co.uk', 'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.it',
  'hotmail.es', 'hotmail.ca', 'live.com', 'live.co.uk', 'live.ca', 'live.fr', 'live.com.au', 'msn.com',
  'passport.com', 'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.ca', 'yahoo.fr', 'yahoo.de',
  'yahoo.it', 'yahoo.es', 'yahoo.in', 'yahoo.co.in', 'yahoo.co.jp', 'yahoo.com.au', 'yahoo.com.br', 'yahoo.com.mx',
  'yahoo.com.sg', 'yahoo.com.ph', 'ymail.com', 'rocketmail.com', 'aol.com', 'aim.com',
  // privacy-focused & independent
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me', 'tutanota.com', 'tutanota.de', 'tutamail.com', 'tuta.io',
  'tuta.com', 'keemail.me', 'fastmail.com', 'fastmail.fm', 'hey.com', 'duck.com', 'zoho.com', 'zohomail.com',
  'mail.com', 'email.com', 'usa.com', 'gmx.com', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch', 'gmx.us', 'hushmail.com',
  'runbox.com', 'mailbox.org', 'posteo.de', 'posteo.net', 'startmail.com', 'skiff.com', 'inbox.com',
  // ISPs (US / CA / UK / AU)
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net',
  'spectrum.net', 'earthlink.net', 'optonline.net', 'frontier.com', 'windstream.net', 'centurylink.net',
  'shaw.ca', 'rogers.com', 'bell.net', 'sympatico.ca', 'telus.net', 'videotron.ca', 'btinternet.com',
  'sky.com', 'virginmedia.com', 'talktalk.net', 'ntlworld.com', 'blueyonder.co.uk', 'bigpond.com',
  'bigpond.net.au', 'optusnet.com.au', 'iinet.net.au', 'xtra.co.nz',
  // Europe
  'web.de', 't-online.de', 'freenet.de', 'arcor.de', 'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net',
  'sfr.fr', 'neuf.fr', 'libero.it', 'virgilio.it', 'tiscali.it', 'alice.it', 'tin.it', 'telefonica.net',
  'terra.es', 'sapo.pt', 'ziggo.nl', 'kpnmail.nl', 'hetnet.nl', 'telenet.be', 'skynet.be', 'bluewin.ch',
  'seznam.cz', 'centrum.cz', 'wp.pl', 'o2.pl', 'onet.pl', 'interia.pl', 'abv.bg', 'mail.bg', 'ukr.net',
  'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'yandex.ru', 'yandex.com', 'ya.ru', 'rambler.ru',
  // Asia / Middle East / LatAm / Africa
  'qq.com', 'foxmail.com', '163.com', '126.com', 'yeah.net', 'sina.com', 'sina.cn', 'sohu.com', 'aliyun.com',
  '139.com', '189.cn', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com', 'docomo.ne.jp',
  'ezweb.ne.jp', 'softbank.ne.jp', 'rediffmail.com', 'indiatimes.com', 'uol.com.br', 'bol.com.br',
  'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com', 'prodigy.net.mx', 'walla.co.il', 'walla.com',
  'mweb.co.za', 'webmail.co.za', 'telkomsa.net',
]);
