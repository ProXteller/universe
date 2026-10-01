/**
 * Moderation engine (SPEC §4.2.6, safety §2, §8.2 #6–#8): fixture tables per category incl. leetspeak, spacing,
 * homoglyph, zero-width and idiom guards; PII fixtures; self-harm path; second pass inert without the env key;
 * moderateWrite / commitModeration / duplicate detector / account modifiers / author-notice hygiene.
 */
import crypto from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModerationCategory, ModerationContext, ModerationSurface } from '@shared/core';
import { ApiError } from '../../src/lib/http';
import {
  blockedTarget, commitModeration, flushSecondPass, getSecondPassClassifier, listRulePacks, modCtx, moderateText, moderateWrite,
  resetSecondPass, secondPassMetrics, setRulePackEnabled, setSecondPassClassifier, supportResourcesFor, toAuthorNotice, type SecondPassClassifier,
} from '../../src/lib/moderation/index';
import { registerContentAdapter, type ContentAdapter, type ContentSnapshot } from '../../src/lib/content';
import { createTestApp, resetTestState, type TestCtx } from '../../src/lib/testing';
import { DAY, HOUR } from '../../src/lib/clock';

type Expect = 'block' | 'flag' | 'allow';
interface Fixture {
  text: string;
  expect: Expect;
  surface?: ModerationSurface;
  category?: ModerationCategory;
  subcode?: string;
  messageId?: string;
  visibility?: 'visible' | 'held';
  support?: boolean;
  accountAgeMs?: number;
  banner?: string;
  isMessageRequest?: boolean;
  recentHashes?: string[];
}

function ctxFor(surface: ModerationSurface, extra: Partial<ModerationContext> = {}): ModerationContext {
  return {
    surface, userId: 'u_test', role: 'user', accountType: 'student', accountAgeMs: 30 * DAY, activeStrikePoints: 0,
    universityId: 'uni_utexas', countryCode: 'US', ...extra,
  };
}

function runTable(name: string, fixtures: Fixture[]): void {
  describe(name, () => {
    for (const f of fixtures) {
      it(`${f.expect.padEnd(5)} · ${f.surface ?? 'buzz'} · ${JSON.stringify(f.text)}`, () => {
        const r = moderateText(f.text, ctxFor(f.surface ?? 'buzz', {
          ...(f.accountAgeMs !== undefined ? { accountAgeMs: f.accountAgeMs } : {}),
          ...(f.isMessageRequest !== undefined ? { isMessageRequest: f.isMessageRequest } : {}),
          ...(f.recentHashes ? { recentHashes: f.recentHashes } : {}),
        }));
        expect(r.action, `category=${r.category} subcode=${r.subcode} msg=${r.userMessage?.id}`).toBe(f.expect);
        if (f.category) expect(r.category).toBe(f.category);
        if (f.subcode) expect(r.subcode).toBe(f.subcode);
        if (f.messageId) expect(r.userMessage?.id).toBe(f.messageId);
        if (f.visibility) expect(r.visibility).toBe(f.visibility);
        if (f.support !== undefined) expect(r.support !== null).toBe(f.support);
        if (f.banner) expect(r.recipientBanner).toBe(f.banner);
        if (f.expect === 'block') {
          expect(r.persistStatus).toBeUndefined();
          expect(r.userMessage).not.toBeNull();
          expect(r.userMessage!.body.length).toBeGreaterThan(10);
        } else {
          expect(r.persistStatus).toBe(r.visibility === 'held' ? 'held' : 'active');
        }
        if (f.expect === 'allow' && !f.support) expect(r.userMessage).toBeNull();
      });
    }
  });
}

// the fixture tables are pure (no DB); one app for the whole file, the DB sections rebuild it per test
beforeAll(async () => {
  await createTestApp({ slices: [] });
});
afterEach(() => {
  setSecondPassClassifier(null);
  resetSecondPass();
  resetTestState();
});

/* ───────────────────────────── #6 fixture tables ───────────────────────────── */

runTable('threat_violence', [
  { text: 'I am going to kill you', expect: 'block', category: 'threat_violence', messageId: 'M-THREAT' },
  { text: 'i will k i l l you tomorrow', expect: 'block', category: 'threat_violence' },
  { text: 'imma sh00t up the library', expect: 'block', category: 'threat_violence' },
  { text: 'someone should stab that guy after class', expect: 'block', category: 'threat_violence', subcode: 'incitement' },
  { text: 'how to make a pipe bomb', expect: 'block', category: 'threat_violence', subcode: 'weapons_instructions' },
  { text: "you're dead when i see you", expect: 'block', category: 'threat_violence' },
  { text: 'hope you die', expect: 'flag', category: 'threat_violence', visibility: 'held' },
  { text: 'I am going to kill you', expect: 'block', surface: 'message', messageId: 'M-THREAT' },
  { text: 'this exam is killing me', expect: 'allow' },
  { text: 'i killed it at the presentation', expect: 'allow' },
  { text: 'im gonna kill it in class today', expect: 'allow' },
  { text: 'that concert was the bomb', expect: 'allow' },
  { text: 'dead tired after the library', expect: 'allow' },
  { text: 'gonna shoot my shot with the ta at the game', expect: 'allow' },
  { text: 'i will attack this problem with you tomorrow', expect: 'allow' },
]);

runTable('harassment_bullying', [
  { text: 'kys loser', expect: 'block', category: 'harassment_bullying', subcode: 'kys', messageId: 'M-KYS' },
  { text: 'k y s', expect: 'block', category: 'harassment_bullying', subcode: 'kys' },
  { text: 'you are so ugly and worthless', expect: 'block', category: 'harassment_bullying', messageId: 'M-HARASS' },
  { text: "let's all spam her dms", expect: 'block', category: 'harassment_bullying', subcode: 'pile_on_call' },
  { text: 'rate the freshmen girls', expect: 'block', category: 'harassment_bullying', subcode: 'rate_people' },
  { text: 'ur a pathetic loser', expect: 'block', category: 'harassment_bullying' },
  { text: 'you are an idiot', expect: 'flag', category: 'harassment_bullying', visibility: 'visible' },
  { text: 'you are so ugly and worthless', expect: 'allow', surface: 'message' },
  { text: 'kys loser', expect: 'block', surface: 'message', subcode: 'kys' },
  { text: "i'm such a loser today", expect: 'allow' },
  { text: 'this assignment is ugly', expect: 'allow' },
  { text: 'my code is trash', expect: 'allow' },
  { text: 'the freshmen are so hyped', expect: 'allow' },
  { text: 'the sky is so pretty tonight', expect: 'allow' },
  { text: 'you killed it at the game', expect: 'allow' },
  { text: 'you freak me out sometimes lol', expect: 'allow' },
  { text: 'did you see the disgusting bathroom in jester', expect: 'allow' },
]);

runTable('hate', [
  { text: 'n1gger', expect: 'block', category: 'hate', subcode: 'slur', messageId: 'M-HATE' },
  { text: 'nіgger', expect: 'block', category: 'hate', subcode: 'slur' }, // Cyrillic і
  { text: 'fa​gg​ot', expect: 'block', category: 'hate', subcode: 'slur' }, // zero-width
  { text: 'jews are vermin', expect: 'block', category: 'hate', subcode: 'dehumanization' },
  { text: "muslims don't belong here", expect: 'block', category: 'hate', subcode: 'exclusion_call' },
  { text: 'the holocaust never happened', expect: 'flag', category: 'hate', visibility: 'held' },
  { text: 'no blacks please', expect: 'block', surface: 'roommate_listing', subcode: 'discriminatory_listing', messageId: 'M-LISTING-DISCRIM' },
  { text: 'the classic assassin movie was great', expect: 'allow' },
  { text: 'i love my jewish friends', expect: 'allow' },
  { text: 'muslims celebrate eid next week', expect: 'allow' },
  { text: 'history lecture on the holocaust today', expect: 'allow' },
  { text: 'black coffee only, no sugar', expect: 'allow' },
  { text: 'no blacks please', expect: 'allow', surface: 'message' },
  { text: 'there are chinks in the armor of that argument', expect: 'allow' },
]);

runTable('sexual_minors', [
  { text: 'child porn links dm me', expect: 'block', category: 'sexual_minors', messageId: 'M-MINORS' },
  { text: 'that 15 year old is so hot', expect: 'block', category: 'sexual_minors' },
  { text: 'cp l1nks anyone', expect: 'block', category: 'sexual_minors' },
  { text: 'high schooler nudes', expect: 'block', category: 'sexual_minors' },
  { text: 'send me pics little girl dont tell your parents', expect: 'block', category: 'sexual_minors' },
  { text: 'u n d e r a g e nudes', expect: 'block', category: 'sexual_minors' },
  { text: 'child porn links dm me', expect: 'block', surface: 'message' },
  { text: 'my 15 year old brother is visiting campus', expect: 'allow' },
  { text: 'high schoolers toured the campus today', expect: 'allow' },
  { text: 'a little girl at the park had a cute dog', expect: 'allow' },
  { text: 'underage drinking is a problem here', expect: 'allow' },
  { text: 'child psychology class was great', expect: 'allow' },
]);

runTable('sexual_explicit', [
  { text: 'blowjob tips', expect: 'block', surface: 'orbit_post', category: 'sexual_explicit', messageId: 'M-SEXUAL' },
  { text: 'blowjob tips', expect: 'flag', surface: 'buzz', visibility: 'held' },
  { text: 'dtf tonight anyone', expect: 'block', subcode: 'solicitation' },
  { text: 'trade nudes with me', expect: 'block', subcode: 'nude_trading' },
  { text: "ill leak your nudes if you leave me", expect: 'block', subcode: 'ncii_threat' },
  { text: 'pay me 200 or everyone gets the recording', expect: 'block', subcode: 'sextortion' },
  { text: 'selling nudes hmu', expect: 'block', subcode: 'solicitation' },
  { text: 'dtf tonight anyone', expect: 'flag', surface: 'message', banner: 'B-SEXUAL' },
  { text: 'sex ed class was informative', expect: 'allow' },
  { text: 'found a nude beach on spring break', expect: 'allow' },
  { text: 'sugar cookies at the union today', expect: 'allow' },
  { text: 'hookup culture essay due tomorrow', expect: 'allow' },
  { text: 'blowjob tips', expect: 'allow', surface: 'message' },
]);

runTable('drugs_illegal_sales', [
  { text: 'selling adderall dm me', expect: 'block', category: 'drugs_illegal_sales', messageId: 'M-DRUGS' },
  { text: 'who has weed for tonight', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'need a plug for shrooms', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'where can i get a fake id', expect: 'block', subcode: 'fake_id' },
  { text: 'selling a glock no paperwork', expect: 'block', subcode: 'weapon_sale' },
  { text: 's3lling m0lly for $20 hmu', expect: 'block', category: 'drugs_illegal_sales' },
  { text: '🍃 for sale dm me', expect: 'block', category: 'drugs_illegal_sales' },
  { text: 'selling adderall dm me', expect: 'block', surface: 'message' },
  { text: 'weed is legal in some states', expect: 'allow' },
  { text: 'harm reduction: fentanyl test strips at the health center', expect: 'allow' },
  { text: 'my prescription for adderall ran out', expect: 'allow' },
  { text: 'selling my textbook and a lamp', expect: 'allow' },
  { text: 'the plug on my charger broke', expect: 'allow' },
  { text: 'nerf gun for sale', expect: 'allow', surface: 'market_listing' },
  { text: 'looking for a bud to study with', expect: 'allow' },
  { text: 'who has coke for the party', expect: 'allow' },
  { text: 'weed is legal in some states', expect: 'flag', surface: 'market_listing', visibility: 'visible' },
]);

runTable('self_harm', [
  { text: 'i want to die', expect: 'allow', category: 'self_harm', support: true },
  { text: 'gonna kill myself after this final', expect: 'allow', category: 'self_harm', support: true },
  { text: "i'm suicidal", expect: 'allow', support: true },
  { text: 'cutting myself again', expect: 'allow', support: true },
  { text: 'my friend wants to die and i dont know what to do', expect: 'allow', support: true },
  { text: 'how many pills does it take to overdose', expect: 'block', subcode: 'method_instructions', messageId: 'S-METHOD', support: true },
  { text: 'painless way to die', expect: 'block', subcode: 'method_instructions', support: true },
  { text: 'i want to die', expect: 'allow', surface: 'message', support: true },
  { text: 'died laughing at that meme', expect: 'allow', support: false },
  { text: 'my phone died in the library', expect: 'allow', support: false },
  { text: 'hurt my ankle at practice', expect: 'allow', support: false },
  { text: 'self care sunday', expect: 'allow', support: false },
  { text: 'the deadline is tomorrow', expect: 'allow', support: false },
]);

runTable('pii_doxxing', [
  { text: 'call me 512-555-0199', expect: 'block', category: 'pii_doxxing', subcode: 'phone', messageId: 'M-PII' },
  { text: 'call me five one two five five five zero one nine nine', expect: 'block', subcode: 'phone' },
  { text: '+44 20 7946 0958 is my number', expect: 'block', subcode: 'phone' },
  { text: '(512) 555.0199 text me', expect: 'block', subcode: 'phone' },
  { text: 'my email is maya (at) utexas (dot) edu', expect: 'block', subcode: 'email' },
  { text: 'email maya.chen@utexas.edu for the notes', expect: 'block', subcode: 'email' },
  { text: 'she lives at 2400 Nueces St apt 4b', expect: 'block', subcode: 'street_address' },
  { text: 'she lives in room 204 jester west go find her', expect: 'block', subcode: 'room_number' },
  { text: 'his ssn is 123-45-6789', expect: 'block', subcode: 'id_number' },
  { text: 'her plate is ABC 1234 the silver civic', expect: 'block', subcode: 'license_plate' },
  { text: 'anon comet is definitely Maya Chen', expect: 'block', subcode: 'unmask_attempt', messageId: 'M-UNMASK' },
  { text: 'i live in room 204 jester and its freezing', expect: 'flag', subcode: 'room_number_self', visibility: 'held' },
  { text: 'selling textbook $45 obo cs 314 78712', expect: 'allow' },
  { text: 'the class of 2026 has 5000 students', expect: 'allow' },
  { text: 'meet at 5pm.ok see you there', expect: 'allow' },
  { text: 'cs 314 midterm 2024-2025', expect: 'allow' },
  { text: '1st place at the hackathon on 2nd street', expect: 'allow' },
  { text: 'my zip is 78712 and the order number is 1234567890', expect: 'allow' },
  { text: 'call me 512-555-0199', expect: 'allow', surface: 'message' },
  { text: 'call me 512-555-0199', expect: 'allow', surface: 'message', isMessageRequest: true, banner: 'B-OFFPLATFORM' },
  { text: 'meet at 2400 Nueces St for the mixer', expect: 'allow', surface: 'event' },
  { text: 'contact me at maya.chen@utexas.edu', expect: 'allow', surface: 'profile' },
  { text: 'the lecture is in room 204 and she said it moved', expect: 'allow' },
]);

runTable('named_accusation', [
  { text: 'Maya Chen cheated on the midterm', expect: 'flag', category: 'named_accusation', visibility: 'held', messageId: 'M-NAMED' },
  { text: 'Maya Chen stole my laptop', expect: 'block', category: 'named_accusation', messageId: 'M-NAMED' },
  { text: 'Prof. Garcia is a creep', expect: 'flag', category: 'named_accusation', visibility: 'held' },
  { text: '@mayachen is a stalker', expect: 'block', category: 'named_accusation' },
  { text: 'Jordan Lee slept with the ta', expect: 'block', category: 'named_accusation' },
  { text: 'Dr Patel plagiarized his paper', expect: 'flag', visibility: 'held' },
  { text: 'Maya Chen cheated on the midterm', expect: 'flag', surface: 'orbit_post', visibility: 'visible' },
  { text: 'Maya Chen is the best ta', expect: 'allow' },
  { text: 'cheated on the midterm and got caught', expect: 'allow' },
  { text: 'Taylor Swift cheated on the tour setlist', expect: 'allow' },
  { text: 'Good Morning everyone the library is packed', expect: 'allow' },
  { text: 'my roommate stole my charger', expect: 'allow' },
  { text: 'Maya Chen cheated on the midterm', expect: 'allow', surface: 'message' },
]);

runTable('impersonation', [
  { text: 'this is universe staff send me your login code', expect: 'block', category: 'impersonation', messageId: 'M-IMPERSONATION' },
  { text: 'UniVerse Support', expect: 'block', surface: 'profile', subcode: 'reserved_handle', messageId: 'M-HANDLE' },
  { text: 'universe staff here send me the code', expect: 'flag', surface: 'message', banner: 'B-STAFF-IMPERSONATION' },
  { text: "i am a universe moderator and you're banned", expect: 'block', category: 'impersonation' },
  { text: 'official message from the dean: classes cancelled', expect: 'flag', visibility: 'held' },
  { text: 'Admin', expect: 'block', surface: 'group_name', subcode: 'reserved_handle' },
  { text: 'the universe is big', expect: 'allow' },
  { text: 'i emailed universe support about a bug', expect: 'allow' },
  { text: 'got an email from the dean about the schedule', expect: 'allow' },
  { text: 'Dean Winters', expect: 'allow', surface: 'profile' },
  { text: 'safety first on campus', expect: 'allow' },
  { text: 'CS 314 study group', expect: 'allow', surface: 'group_name' },
]);

const DUP = 'this is a duplicate post about the same old thing again';
runTable('spam_scam', [
  { text: 'check out https://bit.ly/abc', expect: 'block', category: 'spam_scam', subcode: 'link_flood', messageId: 'M-SPAM' },
  { text: 'https://a.com https://b.com https://c.com', expect: 'block', subcode: 'link_flood' },
  { text: '@aaa @bbb @ccc @ddd @eee @fff', expect: 'block', subcode: 'mention_flood' },
  { text: 'send me the code they texted you', expect: 'block', subcode: 'code_phish' },
  { text: 'pay the deposit first then i ship', expect: 'flag', surface: 'market_listing', visibility: 'held' },
  { text: 'see https://utexas.edu', expect: 'block', accountAgeMs: HOUR, subcode: 'new_link', messageId: 'M-LINK-NEW' },
  { text: 'be your own boss dm me to learn how i make money', expect: 'flag', subcode: 'mlm', visibility: 'visible' },
  { text: 'send me the code they texted you', expect: 'flag', surface: 'message', banner: 'B-SCAM' },
  { text: 'check out canvas.utexas.edu for the syllabus', expect: 'allow' },
  { text: '@mayachen @arjunp lets study', expect: 'allow' },
  { text: 'the door code is on canvas', expect: 'allow' },
  { text: 'scam alert: someone asked me to send the code', expect: 'allow' },
  { text: 'deposit for the apartment is due friday', expect: 'allow' },
  { text: 'see https://utexas.edu', expect: 'allow', accountAgeMs: 30 * DAY },
  { text: 'text me at 5 for the study group', expect: 'allow' },
  { text: 'do i have to pay upfront for housing', expect: 'allow' },
]);

runTable('academic_dishonesty', [
  { text: 'hey ta selling exam answers hmu', expect: 'flag', category: 'academic_dishonesty', visibility: 'held', messageId: 'M-HELD' },
  { text: 'test bank for bio 311 $20', expect: 'block', surface: 'market_listing', messageId: 'M-ACADEMIC' },
  { text: 'will write your essay for $50', expect: 'block', surface: 'market_listing', subcode: 'contract_cheating' },
  { text: 'anyone got the answer key for the midterm', expect: 'flag', visibility: 'held' },
  { text: 'pay someone to write my paper', expect: 'flag', surface: 'orbit_post', visibility: 'visible' },
  { text: 'in the exam rn what did you get for q3', expect: 'flag', subcode: 'live_exam_answers', visibility: 'held' },
  { text: 'practice exam answers are posted on canvas', expect: 'allow' },
  { text: 'study guide for the final', expect: 'allow' },
  { text: 'the answer key is out after the midterm', expect: 'allow' },
  { text: 'essay due tomorrow help me proofread', expect: 'allow' },
  { text: 'tutoring for cs 314', expect: 'allow' },
  { text: 'hey ta selling exam answers hmu', expect: 'allow', surface: 'message' },
]);

runTable('profanity', [
  { text: 'fuck this class lol', expect: 'allow', category: 'profanity' },
  { text: 'shit this is hard', expect: 'allow', category: 'profanity' },
  { text: 'damn the line is long', expect: 'allow', category: 'profanity' },
  { text: 'wtf is this weather', expect: 'allow', category: 'profanity' },
  { text: 'bullshit assignment', expect: 'allow', category: 'profanity' },
  { text: 'Fuck Face', expect: 'block', surface: 'profile', subcode: 'severe_name', messageId: 'M-NAME-PROFANE' },
  { text: 'fuckboy99', expect: 'block', surface: 'handle', subcode: 'severe_name' },
  { text: 'Shitposters Anonymous', expect: 'block', surface: 'group_name', subcode: 'severe_name' },
  { text: 'Alexis Cockburn', expect: 'allow', surface: 'profile' },
  { text: 'Dickinson Fan Club', expect: 'allow', surface: 'group_name' },
  { text: 'Shiitake Lovers', expect: 'allow', surface: 'group_name' },
]);

/* ───────────────────────────── engine invariants ───────────────────────────── */

describe('engine invariants', () => {
  it('never throws and reports the baseline pack + timing', () => {
    const r = moderateText('hello world', ctxFor('buzz'));
    expect(r.engine.rulePacks).toContain('baseline');
    expect(listRulePacks().find((p) => p.id === 'baseline')?.ruleCount).toBeGreaterThan(50);
    expect(moderateText(null as unknown as string, ctxFor('buzz')).action).toBe('allow');
    expect(moderateText('', ctxFor('buzz')).action).toBe('allow');
    // 5,000 chars stays within budget (generous bound for a loaded machine)
    const big = 'a normal sentence about campus life and studying for finals. '.repeat(80);
    moderateText(big, ctxFor('buzz'));
    const t0 = performance.now();
    for (let i = 0; i < 5; i += 1) moderateText(big, ctxFor('buzz'));
    expect((performance.now() - t0) / 5).toBeLessThan(40);
  });

  it('spans point into the original text and signals are reported', () => {
    const text = 'hey Maya Chen — i will k i l l you ❄️';
    const r = moderateText(text, ctxFor('buzz'));
    expect(r.action).toBe('block');
    for (const m of r.matches) {
      expect(m.span[0]).toBeGreaterThanOrEqual(0);
      expect(m.span[1]).toBeLessThanOrEqual(text.length);
      expect(m.span[1]).toBeGreaterThan(m.span[0]);
    }
    expect(r.signals.evasion).toBe(true);
    expect(r.signals.hasFullName).toBe(true);
    const caps = moderateText('THIS IS THE BEST DAY EVER I LOVE THIS CAMPUS SO MUCH YALL', ctxFor('buzz'));
    expect(caps.signals.capsRatio).toBeGreaterThan(0.9);
    expect(caps.action).toBe('allow');
  });

  it('evasion raises severity one level (medium → high blocks a targeted insult in leet)', () => {
    const plain = moderateText('you are an idiot', ctxFor('buzz'));
    expect(plain).toMatchObject({ action: 'flag', severity: 'medium' });
    const evasive = moderateText('y​o​u a​re an idiot', ctxFor('buzz'));
    expect(evasive.signals.invisibleChars).toBe(3);
    expect(evasive.severity).toBe('high');
    expect(evasive.action).toBe('block');
  });

  it('STAFF surfaces always allow, keeping the signals', () => {
    for (const surface of ['report_note', 'appeal'] as const) {
      const r = moderateText('he said he will kill you, call 512-555-0199', ctxFor(surface));
      expect(r.action).toBe('allow');
      expect(r.matches.length).toBeGreaterThan(0);
      expect(r.userMessage).toBeNull();
    }
  });

  it('account modifiers: < 24 h holds visible flags on Buzz; ≥ 5 strike points holds them everywhere public', () => {
    const fresh = moderateText('you are an idiot', ctxFor('buzz', { accountAgeMs: HOUR }));
    expect(fresh).toMatchObject({ action: 'flag', visibility: 'held' });
    const strikes = moderateText('you are an idiot', ctxFor('orbit_post', { activeStrikePoints: 5 }));
    expect(strikes).toMatchObject({ action: 'flag', visibility: 'held' });
    const normal = moderateText('you are an idiot', ctxFor('orbit_post'));
    expect(normal).toMatchObject({ action: 'flag', visibility: 'visible' });
  });

  it('duplicate detector: same folded text within the window blocks; private needs 5 conversations', () => {
    const first = moderateText(DUP, ctxFor('buzz'));
    expect(first.action).toBe('allow');
    const hash = hashOf(DUP);
    expect(moderateText(DUP, ctxFor('buzz', { recentHashes: [hash] }))).toMatchObject({ action: 'block', subcode: 'duplicate' });
    expect(moderateText(DUP, ctxFor('buzz', { recentHashes: [hash] })).userMessage?.id).toBe('M-DUP');
    expect(moderateText(DUP.toUpperCase(), ctxFor('buzz', { recentHashes: [hash] })).action).toBe('block');
    expect(moderateText(DUP, ctxFor('message', { recentHashes: [hash, hash, hash] })).action).toBe('allow');
    expect(moderateText(DUP, ctxFor('message', { recentHashes: [hash, hash, hash, hash] })).action).toBe('block');
    expect(moderateText('ok', ctxFor('buzz', { recentHashes: [hashOf('ok')] })).action).toBe('allow'); // short texts never
  });

  it('rule packs can be disabled; PII detectors keep running', () => {
    setRulePackEnabled('baseline', false);
    try {
      expect(moderateText('I am going to kill you', ctxFor('buzz')).action).toBe('allow');
      expect(moderateText('call me 512-555-0199', ctxFor('buzz')).action).toBe('block');
    } finally {
      setRulePackEnabled('baseline', true);
    }
  });

  it('support resources depend on the country', () => {
    expect(supportResourcesFor('US').lines[0]?.href).toBe('tel:988');
    expect(supportResourcesFor('GB').lines[0]?.label).toContain('Samaritans');
    expect(supportResourcesFor('AU').lines[0]?.label).toContain('13 11 14');
    expect(supportResourcesFor('IN').lines[0]?.label).toContain('14416');
    expect(supportResourcesFor('BR').lines[0]?.href).toContain('findahelpline');
    const r = moderateText('i want to die', ctxFor('buzz', { countryCode: 'GB' }));
    expect(r.support?.lines[0]?.label).toContain('Samaritans');
    expect(r.support?.headline).toBe('It sounds like things are heavy right now');
    expect(r.support?.emergencyNote).toContain('emergency');
  });
});

function hashOf(text: string): string {
  // the engine hashes the FOLDED text; for plain lowercase ASCII that is the lower-cased, whitespace-collapsed text
  return crypto.createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 32);
}

/* ───────────────────────────── moderateWrite / commitModeration (DB) ───────────────────────────── */

let ctx: TestCtx;
const memory = new Map<string, ContentSnapshot>();
let unregister: (() => void) | null = null;

function fakeAdapter(entityType: ContentSnapshot['entityType']): ContentAdapter {
  return {
    entityType,
    load: (id) => memory.get(id) ?? null,
    setStatus: (id, status) => {
      const s = memory.get(id);
      if (s) memory.set(id, { ...s, status });
    },
  };
}

describe('moderateWrite + commitModeration', () => {
  beforeEach(async () => {
    ctx = await createTestApp({ slices: [] });
    memory.clear();
    unregister = registerContentAdapter(fakeAdapter('orbit_post'));
  });
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  const maya = (): ReturnType<TestCtx['createUser']> => ctx.createUser({ handle: 'mod_writer' });

  it('#7 self-harm ideation: allow + support + queue item P0 `wellbeing` + zero strike points', () => {
    const user = maya();
    const mod = moderateWrite([{ text: 'i want to die' }], modCtx(user, 'buzz'), blockedTarget(user, 'buzz'));
    expect(mod.action).toBe('allow');
    expect(mod.support).not.toBeNull();
    expect(mod.persistStatus).toBe('active');
    commitModeration(mod, { ...blockedTarget(user, 'buzz'), entityId: 'buzz_t1' });
    const q = ctx.db.prepare("SELECT * FROM mod_queue WHERE entity_type = 'buzz' AND entity_id = 'buzz_t1'").get() as any;
    expect(q).toMatchObject({ priority: 'p0', label: 'wellbeing', category: 'self_harm', status: 'open', source: 'rule_flag' });
    expect(q.author_id).toBe(user.id);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM strikes').get() as any).n).toBe(0);
    const ev = ctx.db.prepare("SELECT * FROM moderation_events WHERE entity_id = 'buzz_t1'").get() as any;
    expect(ev).toMatchObject({ action: 'allow', surface: 'buzz', category: 'self_harm' });
    expect(toAuthorNotice(mod)).toEqual({ status: 'active', userMessage: null, support: mod.support });
    // private: support but no queue
    const dm = moderateWrite([{ text: 'i want to die' }], modCtx(user, 'message'), blockedTarget(user, 'message'));
    commitModeration(dm, { ...blockedTarget(user, 'message'), entityId: 'msg_t1' });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM mod_queue WHERE entity_id = 'msg_t1'").get()).toEqual({ n: 0 });
    expect(dm.support).not.toBeNull();
  });

  it('block → 422 content_blocked with ContentBlockedDetails; escalation writes a queue item with the blocked text', () => {
    const user = maya();
    let err: ApiError | null = null;
    try {
      moderateWrite([{ text: 'Trip recap', field: 'title' }, { text: 'I am going to kill you' }], modCtx(user, 'orbit_post'), blockedTarget(user, 'orbit_post'));
    } catch (e) {
      err = e as ApiError;
    }
    expect(err).toBeInstanceOf(ApiError);
    expect(err!.status).toBe(422);
    expect(err!.code).toBe('content_blocked');
    expect(err!.details).toMatchObject({ messageId: 'M-THREAT', category: 'threat_violence', guidelineAnchor: '#threats', support: null });
    expect((err!.details as any).title).toBe("This can't be posted");
    const q = ctx.db.prepare("SELECT * FROM mod_queue WHERE entity_type = 'orbit_post' AND entity_id IS NULL").get() as any;
    expect(q).toMatchObject({ source: 'rule_block_escalation', priority: 'p0', category: 'threat_violence' });
    expect(q.blocked_text).toContain('kill you');
    const ev = ctx.db.prepare("SELECT * FROM moderation_events WHERE author_id = ? AND action = 'block'").get(user.id) as any;
    expect(ev).toBeTruthy();
    expect(JSON.parse(ev.matches_json)[0].field).toBe('body');
    // a non-escalated block writes the event but no queue item
    try {
      moderateWrite([{ text: 'kys loser' }], modCtx(user, 'buzz'), blockedTarget(user, 'buzz'));
    } catch {
      /* expected */
    }
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM mod_queue WHERE entity_type = 'buzz'").get() as any).n).toBe(0);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM moderation_events WHERE entity_type = 'buzz' AND action = 'block'").get() as any).n).toBe(1);
  });

  it('flag held → persistStatus held + M-HELD notice + queue item; flag visible → no notice; plain allow → nothing', () => {
    const user = maya();
    const held = moderateWrite([{ text: 'anyone got the answer key for the midterm' }], modCtx(user, 'buzz'), blockedTarget(user, 'buzz'));
    expect(held).toMatchObject({ action: 'flag', visibility: 'held', persistStatus: 'held' });
    expect(toAuthorNotice(held)).toMatchObject({ status: 'held', userMessage: { id: 'M-HELD', title: 'In review' } });
    commitModeration(held, { ...blockedTarget(user, 'buzz'), entityId: 'buzz_held' });
    expect(ctx.db.prepare("SELECT priority, source FROM mod_queue WHERE entity_id = 'buzz_held'").get()).toEqual({ priority: 'p1', source: 'rule_flag' });

    const visible = moderateWrite([{ text: 'you are an idiot' }], modCtx(user, 'orbit_post'), blockedTarget(user, 'orbit_post'));
    expect(visible).toMatchObject({ action: 'flag', visibility: 'visible', persistStatus: 'active', userMessage: null });
    commitModeration(visible, { ...blockedTarget(user, 'orbit_post'), entityId: 'post_vis' });
    expect(ctx.db.prepare("SELECT priority FROM mod_queue WHERE entity_id = 'post_vis'").get()).toEqual({ priority: 'p2' });
    // upsert: a second commit on the same entity merges instead of duplicating
    commitModeration(visible, { ...blockedTarget(user, 'orbit_post'), entityId: 'post_vis' });
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM mod_queue WHERE entity_id = 'post_vis'").get() as any).n).toBe(1);

    const plain = moderateWrite([{ text: 'lovely day on campus' }, { text: null }, { text: '   ' }], modCtx(user, 'orbit_post'), blockedTarget(user, 'orbit_post'));
    expect(plain.action).toBe('allow');
    commitModeration(plain, { ...blockedTarget(user, 'orbit_post'), entityId: 'post_plain' });
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM moderation_events WHERE entity_id = 'post_plain'").get() as any).n).toBe(0);
    // private flag: event row, banner, no queue
    const priv = moderateWrite([{ text: 'send me the code they texted you' }], modCtx(user, 'message'), blockedTarget(user, 'message'));
    expect(priv).toMatchObject({ action: 'flag', privateFlag: true, recipientBanner: 'B-SCAM', persistStatus: 'active' });
    commitModeration(priv, { ...blockedTarget(user, 'message'), entityId: 'msg_priv' });
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM mod_queue WHERE entity_id = 'msg_priv'").get() as any).n).toBe(0);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM moderation_events WHERE entity_id = 'msg_priv'").get() as any).n).toBe(1);
  });

  it('records recent hashes so an identical repost within 10 minutes is M-DUP (edits with changed text are fine)', () => {
    const user = maya();
    const text = 'selling my calculus textbook, barely used, message me';
    expect(moderateWrite([{ text }], modCtx(user, 'market_listing'), blockedTarget(user, 'market_listing')).action).toBe('allow');
    expect(() => moderateWrite([{ text }], modCtx(user, 'market_listing'), blockedTarget(user, 'market_listing'))).toThrow(/same thing/);
    expect(moderateWrite([{ text: `${text} (price drop)` }], modCtx(user, 'market_listing'), blockedTarget(user, 'market_listing')).action).toBe('allow');
    // a different surface group is a different window
    expect(moderateWrite([{ text }], modCtx(user, 'orbit_post'), blockedTarget(user, 'orbit_post')).action).toBe('allow');
  });

  it('author-notice hygiene: toAuthorNotice carries only status / userMessage / support', () => {
    const user = maya();
    const mod = moderateWrite([{ text: 'you are an idiot' }], modCtx(user, 'orbit_post'), blockedTarget(user, 'orbit_post'));
    const notice = toAuthorNotice(mod) as unknown as Record<string, unknown>;
    expect(Object.keys(notice).sort()).toEqual(['status', 'support', 'userMessage']);
    for (const k of ['matches', 'ruleId', 'signals', 'engine', 'priority', 'escalate', 'privateFlag']) expect(JSON.stringify(notice)).not.toContain(k);
  });

  it('PATCH /me runs the real engine: a threatening bio is 422 content_blocked and nothing is persisted', async () => {
    const agent = ctx.as('mayachen');
    const res = await agent.patch('/api/me').send({ bio: 'I am going to kill you' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('content_blocked');
    expect(res.body.error.details.messageId).toBe('M-THREAT');
    expect(JSON.stringify(res.body)).not.toMatch(/matches|ruleId|signals|engine/);
    const bio = (ctx.db.prepare("SELECT bio FROM users WHERE id = 'u_mayachen'").get() as any).bio;
    expect(bio).not.toContain('kill');
    const ok = await agent.patch('/api/me').send({ bio: 'Coffee, code and campus walks.' });
    expect(ok.status).toBe(200);
    expect(ok.body.moderation).toEqual({ status: 'active', userMessage: null, support: null });
  });
});

/* ───────────────────────────── #8 second pass ───────────────────────────── */

describe('#8 second pass', () => {
  beforeEach(async () => {
    ctx = await createTestApp({ slices: [] });
    memory.clear();
    unregister = registerContentAdapter(fakeAdapter('orbit_post'));
  });
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  it('is null without MODERATION_AI_API_KEY and never calls fetch', async () => {
    expect(getSecondPassClassifier()).toBeNull();
    const user = ctx.createUser();
    const mod = moderateWrite([{ text: 'you are an idiot' }], modCtx(user, 'orbit_post'), blockedTarget(user, 'orbit_post'));
    commitModeration(mod, { ...blockedTarget(user, 'orbit_post'), entityId: 'post_sp' });
    await flushSecondPass();
    expect(ctx.fetchSpy.calls).toBe(0);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM mod_queue WHERE source = 'ai_flag'").get() as any).n).toBe(0);
  });

  it('a stub classifier can escalate (allow → flag, active → hidden) but never approve / unblock', async () => {
    const user = ctx.createUser();
    const snap = (id: string, status: ContentSnapshot['status']): ContentSnapshot => ({
      entityType: 'orbit_post', entityId: id, authorId: user.id, universityId: user.universityId, status, surface: 'orbit_post', anon: false,
      autoHideImmune: false, createdAt: 0, label: 'post', fields: [{ field: 'body', text: 'x' }], media: [], href: `/post/${id}`, parent: null,
    });
    memory.set('p_allow', snap('p_allow', 'active'));
    memory.set('p_held', snap('p_held', 'held'));
    const seen: string[] = [];
    const stub: SecondPassClassifier = {
      name: 'stub',
      async classify(input) {
        seen.push(input.text);
        expect(JSON.stringify(input)).not.toContain(user.id);
        if (input.text.includes('coffee')) return { category: 'threat_violence', severity: 'critical', confidence: 0.97, rationale: 'test' };
        return { category: null, severity: 'none', confidence: 1, rationale: 'clean' };
      },
    };
    setSecondPassClassifier(stub);
    expect(getSecondPassClassifier()?.name).toBe('stub');

    // allow → the classifier escalates: hidden + queue item source ai_flag P1
    const ok = moderateWrite([{ text: 'coffee on the quad today' }], modCtx(user, 'orbit_post'), blockedTarget(user, 'orbit_post'));
    expect(ok.action).toBe('allow');
    commitModeration(ok, { ...blockedTarget(user, 'orbit_post'), entityId: 'p_allow' });
    await flushSecondPass();
    expect(secondPassMetrics.processed).toBe(1);
    expect(memory.get('p_allow')?.status).toBe('hidden');
    const q = ctx.db.prepare("SELECT * FROM mod_queue WHERE entity_id = 'p_allow'").get() as any;
    expect(q).toMatchObject({ source: 'ai_flag', priority: 'p1', category: 'threat_violence' });
    expect(JSON.parse(q.ai_verdict_json)).toMatchObject({ confidence: 0.97, classifier: 'stub' });

    // held item + "clean" verdict: nothing is approved, the item stays held and queued
    const held = moderateWrite([{ text: 'anyone got the answer key for the midterm' }], modCtx(user, 'orbit_post'), blockedTarget(user, 'orbit_post'));
    commitModeration(held, { ...blockedTarget(user, 'orbit_post'), entityId: 'p_held' });
    await flushSecondPass();
    expect(memory.get('p_held')?.status).toBe('held');
    expect(ctx.db.prepare("SELECT status, source FROM mod_queue WHERE entity_id = 'p_held'").get()).toEqual({ status: 'open', source: 'rule_flag' });

    // blocks and private surfaces are never sent
    try {
      moderateWrite([{ text: 'I am going to kill you' }], modCtx(user, 'orbit_post'), blockedTarget(user, 'orbit_post'));
    } catch {
      /* expected */
    }
    const dm = moderateWrite([{ text: 'coffee later?' }], modCtx(user, 'message'), blockedTarget(user, 'message'));
    commitModeration(dm, { ...blockedTarget(user, 'message'), entityId: 'm1' });
    await flushSecondPass();
    expect(seen).toEqual(['coffee on the quad today', 'anyone got the answer key for the midterm']);
    expect(ctx.fetchSpy.calls).toBe(0);
  });
});
