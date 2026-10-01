/**
 * Community Guidelines — final copy = safety §1 verbatim. Section ids = `GUIDELINE_ANCHORS` values + `buzz-anonymity`,
 * `enforcement` (deep-linked from every block / removal notice). `GuidelinesPage` is public (reachable signed-out at
 * `/guidelines`, so it never calls `useMe`); `GuidelinesContent variant="sheet"` is the condensed embed for onboarding.
 */
import { useEffect, type FC, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  BookOpen, Flag, Gavel, GraduationCap, HeartHandshake, KeyRound, Megaphone, MessageSquareWarning, Pill, ShieldAlert, Siren, UserX, VenetianMask, type LucideIcon,
} from 'lucide-react';
import { GUIDELINES_VERSION } from '@shared/core';
import type { GuidelinesContentProps } from '@/app/contracts';
import { Card, PageHeader, Screen } from '@/ui';
import { cn } from '@/lib/cn';
import { Rich } from './parts';

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'do'; text: string }
  | { kind: 'dont'; text: string }
  | { kind: 'zero'; text: string }
  | { kind: 'callout'; text: string };

interface Section {
  id: string;
  number: string;
  title: string;
  icon: LucideIcon;
  blocks: Block[];
}

const INTRO: string[] = [
  "**The short version:** be the person you'd want in your group project. Say what you think, not who to hurt. Disagree with ideas, leave people alone. If someone is in danger, tell us.",
  'These rules apply everywhere on UniVerse: Reels, Buzz, Orbit, Messages, Roommates, Marketplace, events, and your profile.',
];

export const GUIDELINE_SECTIONS: readonly Section[] = [
  {
    id: 'buzz-anonymity', number: '1.1', title: 'Buzz is anonymous to other students — not to the safety team', icon: VenetianMask,
    blocks: [
      { kind: 'p', text: '**What other students see.** A random alias like "Anon Comet". You get a new alias in every thread, so nobody can connect your buzzes to each other, to your profile, or to you. Buzz never shows up on your profile, in search, or in anyone\'s Orbit.' },
      { kind: 'p', text: '**What we keep.** Behind the scenes, every buzz is linked to the account that posted it. We keep that link for one reason: safety.' },
      { kind: 'p', text: '**Who can see it.**' },
      { kind: 'bullets', items: [
        'Moderators review reported buzzes **without** seeing who wrote them.',
        'A very small number of admins can reveal the account behind a buzz, and only for something serious: a credible threat, a risk to someone\'s life, child safety, severe or repeated harassment, or a valid legal request. They must write down why. Every reveal is permanently logged and reviewed.',
      ] },
      { kind: 'p', text: '**What that means for you.**' },
      { kind: 'bullets', items: [
        'Anonymous is not consequence-free. Breaking the rules on Buzz counts against your whole account, and you can be muted, suspended, or banned for it.',
        'If someone\'s safety is at risk, or the law requires it, we may share information with emergency services, campus safety, or law enforcement.',
        'We never show your Buzz identity to other students or advertisers. We don\'t hand it to a university, an employer, or anyone else just because they ask.',
        'Don\'t try to unmask other people. Guessing out loud who wrote a buzz is treated as doxxing.',
      ] },
    ],
  },
  {
    id: 'harassment', number: '1.2', title: 'Harassment & bullying', icon: UserX,
    blocks: [
      { kind: 'p', text: 'Everyone here is a real student on a real campus.' },
      { kind: 'dont', text: 'targeting a person or small group with insults, pile-ons, rumors, or humiliation; rating or ranking people\'s looks or bodies; posting about someone again and again after they\'ve asked you to stop; encouraging others to go after someone; telling anyone to hurt or kill themselves.' },
      { kind: 'do', text: 'criticizing ideas, classes, policies, teams, and public decisions, even sharply. Venting about a situation without pointing at a person.' },
    ],
  },
  {
    id: 'threats', number: '1.3', title: 'Threats & violence', icon: Siren,
    blocks: [
      { kind: 'dont', text: 'threatening to hurt a person, a group, or a place, including "jokes" about attacks on campus. Praising or promoting attacks. Instructions for weapons or explosives.' },
      { kind: 'do', text: 'figures of speech ("that exam killed me"), news, and discussion of violence as a topic.' },
      { kind: 'p', text: 'We treat threats as real. Credible threats are escalated to emergency services and campus safety, and the account is suspended immediately. **If you see one, report it, and call your local emergency number if danger is immediate.**' },
    ],
  },
  {
    id: 'hate', number: '1.4', title: 'Hate', icon: ShieldAlert,
    blocks: [
      { kind: 'dont', text: 'slurs, dehumanizing language, or calls for exclusion or violence against people because of race, ethnicity, nationality, religion, caste, gender, gender identity, sexual orientation, disability, serious illness, or immigration status. Hate symbols. Denying well-documented atrocities.' },
      { kind: 'do', text: 'talking about identity, faith, politics, and your own experience, including hard conversations held in good faith. Quoting a slur to report or discuss it is reviewed in context.' },
    ],
  },
  {
    id: 'sexual', number: '1.5', title: 'Sexual content & minors', icon: KeyRound,
    blocks: [
      { kind: 'dont', text: 'pornography or explicit sexual content; unsolicited sexual messages or images; sharing or threatening to share someone\'s intimate images; selling sexual content or services; sexual comments about identifiable people.' },
      { kind: 'zero', text: 'anything that sexualizes someone under 18. We remove it, ban the account, preserve the evidence, and report it to the authorities as the law requires. Some students are under 18. Act like it.' },
      { kind: 'do', text: 'conversations about dating, relationships, consent, and sexual health.' },
    ],
  },
  {
    id: 'drugs', number: '1.6', title: 'Drugs & illegal sales', icon: Pill,
    blocks: [
      { kind: 'dont', text: 'buying, selling, trading, or sourcing drugs, prescription medication, vapes or alcohol for underage students, weapons, fake IDs, or stolen goods, anywhere on UniVerse, including Messages. Asking "who\'s got a plug" counts.' },
      { kind: 'do', text: 'talking about drug policy, harm reduction, recovery, and your own experiences.' },
    ],
  },
  {
    id: 'self-harm', number: '1.7', title: 'Self-harm & suicide', icon: HeartHandshake,
    blocks: [
      { kind: 'p', text: 'If you\'re struggling, you can say so here. You won\'t be punished for it. When a post sounds like someone is going through it, we show support options and a trained member of our safety team may take a look to make sure you\'re OK.' },
      { kind: 'dont', text: 'encouraging anyone to hurt themselves, sharing methods, or mocking someone who is struggling.' },
      { kind: 'do', text: 'saying you\'re not OK. Checking in on each other. Sharing what helped you.' },
      { kind: 'callout', text: '**Right now, if you need it:** in the US and Canada call or text **988**. In the UK and Ireland call Samaritans at **116 123**. In Australia call Lifeline at **13 11 14**. In India call Tele-MANAS at **14416**. Anywhere else, find a free local line at **findahelpline.com**. Your campus counseling center is there for exactly this. If you or someone else is in immediate danger, call your local emergency number.' },
      { kind: 'p', text: 'Worried about someone\'s buzz? Report it with "I\'m worried about this person". It goes to the front of our queue.' },
    ],
  },
  {
    id: 'private-info', number: '1.8', title: 'Private info & doxxing', icon: KeyRound,
    blocks: [
      { kind: 'dont', text: 'posting anyone\'s phone number, email, address, room number, class schedule, license plate, ID numbers, private photos, or screenshots of private chats without consent. Naming a real person alongside an accusation on Buzz. Guessing or revealing who is behind an anonymous buzz.' },
      { kind: 'do', text: 'sharing **your own** contact details in a private message. Naming public figures and officials in their public role. If something serious happened to you, report it to us, to campus services, or to the police. An anonymous call-out can\'t be verified and can hurt the wrong person.' },
    ],
  },
  {
    id: 'impersonation', number: '1.9', title: 'Impersonation', icon: VenetianMask,
    blocks: [
      { kind: 'dont', text: 'pretending to be another student, a professor, a university office, a club you don\'t run, or UniVerse staff. Misleading handles, names, or photos. On Buzz, claiming to be a specific real person.' },
      { kind: 'do', text: 'parody and fan accounts that say so clearly in the name and bio. UniVerse staff never post anonymously on Buzz and will never ask for your login code.' },
    ],
  },
  {
    id: 'spam', number: '1.10', title: 'Spam & scams', icon: Megaphone,
    blocks: [
      { kind: 'dont', text: 'repetitive or mass posts and messages; fake listings; asking for deposits on things that don\'t exist; phishing for login codes; pyramid schemes and "easy money" offers; fake giveaways; buying or selling accounts; vote or report manipulation.' },
      { kind: 'do', text: 'promoting your club, event, or small business from your public profile, in moderation.' },
    ],
  },
  {
    id: 'academic', number: '1.11', title: 'Academic dishonesty', icon: GraduationCap,
    blocks: [
      { kind: 'dont', text: 'buying, selling, or requesting exam answers, test banks, or graded work; paying or offering to take a test or write an assignment for someone; sharing answers while an exam is live.' },
      { kind: 'do', text: 'study groups, tutoring, sharing your own notes, talking about how hard the midterm was.' },
    ],
  },
  {
    id: 'messages-marketplace-roommates', number: '1.12', title: 'Messages, Marketplace, and Roommates', icon: MessageSquareWarning,
    blocks: [
      { kind: 'bullets', items: [
        'Messages are private between the people in them. Automated safety checks run on all messages, and messages you report are reviewed by our safety team.',
        'Keep deals in the app, meet in public places on campus, and never pay a deposit for something you haven\'t seen. Full tips live on every listing.',
        'Listings must be real, legal, and yours to offer. Roommate listings can\'t exclude people based on the characteristics in section 1.4.',
      ] },
    ],
  },
  {
    id: 'enforcement', number: '1.13', title: 'What happens when rules are broken', icon: Gavel,
    blocks: [
      { kind: 'p', text: 'Most first mistakes get a **warning**. After that: **content removal**, a **timed mute** (you can read but not post), **suspension**, and finally a **permanent ban**. Serious harm skips the ladder. We always tell you what was actioned and which rule it broke, and you can **appeal once** within 14 days. Appeals are reviewed by a different person.' },
    ],
  },
  {
    id: 'reporting', number: '1.14', title: 'Reporting & blocking', icon: Flag,
    blocks: [
      { kind: 'p', text: 'Use **Report** on anything that breaks these rules. Reports are confidential; the person you report never learns it was you. Use **Block** on any profile to cut contact completely. Abusing reports to silence people is itself a violation.' },
    ],
  },
];

const CLOSING = 'We update these guidelines as the community grows and will ask you to review important changes.';

function anchorId(anchor: string | undefined): string | null {
  if (!anchor) return null;
  const id = anchor.replace(/^#/, '').trim();
  return id || null;
}

const BlockView: FC<{ b: Block; sheet: boolean }> = ({ b, sheet }) => {
  const body = sheet ? 'type-footnote' : 'type-body-lg';
  switch (b.kind) {
    case 'p':
      return <p className={cn(body, 'text-ink-2')}><Rich text={b.text} /></p>;
    case 'bullets':
      return (
        <ul className={cn(body, 'list-disc space-y-1 pl-5 text-ink-2')}>
          {b.items.map((t, i) => (
            <li key={i}><Rich text={t} /></li>
          ))}
        </ul>
      );
    case 'do':
      return (
        <Card className={cn('border-success/30 bg-success-soft', sheet ? 'p-2.5' : 'p-3')}>
          <span className="type-caption font-semibold text-success">OK</span>
          <p className={cn(body, 'mt-1 text-ink')}><Rich text={b.text} /></p>
        </Card>
      );
    case 'dont':
      return (
        <Card className={cn('border-danger/30 bg-danger-soft', sheet ? 'p-2.5' : 'p-3')}>
          <span className="type-caption font-semibold text-danger">Not OK</span>
          <p className={cn(body, 'mt-1 text-ink')}><Rich text={b.text} /></p>
        </Card>
      );
    case 'zero':
      return (
        <Card className={cn('border-danger bg-danger-soft', sheet ? 'p-2.5' : 'p-3')}>
          <span className="type-caption font-semibold text-danger">Zero tolerance</span>
          <p className={cn(body, 'mt-1 text-ink')}><Rich text={b.text} /></p>
        </Card>
      );
    case 'callout':
      return (
        <Card variant="raised" className={cn('border-info/30 bg-info-soft', sheet ? 'p-2.5' : 'p-3')}>
          <p className={cn(body, 'text-ink')}><Rich text={b.text} /></p>
        </Card>
      );
  }
};

/** Both variants; `anchor` scrolls that section into view on mount. */
export const GuidelinesContent: FC<GuidelinesContentProps> = ({ variant = 'page', anchor }) => {
  const sheet = variant === 'sheet';
  const target = anchorId(anchor);
  useEffect(() => {
    if (!target) return;
    const el = document.getElementById(target);
    if (el) el.scrollIntoView({ block: 'start' });
  }, [target]);
  return (
    <div className={cn('flex flex-col', sheet ? 'gap-5' : 'gap-8')}>
      {!sheet ? (
        <header className="flex flex-col gap-2">
          <h1 className="type-title-1 text-ink">UniVerse Community Guidelines</h1>
          <p className="type-caption text-ink-3">Version {GUIDELINES_VERSION}</p>
        </header>
      ) : null}
      <div className={cn('flex flex-col gap-3', sheet ? 'type-footnote' : 'type-body-lg', 'text-ink-2')}>
        {INTRO.map((t, i) => (
          <p key={i}><Rich text={t} /></p>
        ))}
      </div>
      {GUIDELINE_SECTIONS.map((s) => {
        const Icon = s.icon;
        const active = target === s.id;
        return (
          <section key={s.id} id={s.id} className={cn('flex flex-col gap-3 scroll-mt-20', active ? '-mx-3 rounded-lg bg-accent-soft px-3 py-3' : '')}>
            <div className="flex items-center gap-3">
              <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 text-accent-ink', sheet ? 'size-8' : 'size-10')} aria-hidden>
                <Icon className={sheet ? 'size-4' : 'size-5'} />
              </span>
              <div className="min-w-0">
                <div className="type-micro uppercase tracking-wide text-ink-3">{s.number}</div>
                <h2 className={cn(sheet ? 'type-headline' : 'type-title-3', 'text-ink')}>{s.title}</h2>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {s.blocks.map((b, i) => (
                <BlockView key={i} b={b} sheet={sheet} />
              ))}
            </div>
          </section>
        );
      })}
      <p className={cn(sheet ? 'type-caption' : 'type-footnote', 'italic text-ink-3')}>{CLOSING}</p>
    </div>
  );
};

/** `/guidelines` — public; hash anchors = `GUIDELINE_ANCHORS` + `#buzz-anonymity`, `#enforcement`. */
export const GuidelinesPage: FC = () => {
  const { hash } = useLocation();
  return (
    <Screen header={<PageHeader title="Community Guidelines" back mode="compact" />} className="px-4 pt-3 pb-10">
      <GuidelinesContent variant="page" anchor={hash || undefined} />
      <Sub />
    </Screen>
  );
};

const Sub: FC = () => {
  const items: ReactNode[] = [
    <span key="a" className="inline-flex items-center gap-1"><BookOpen className="size-3.5" aria-hidden /> Read on every screen from Settings → About</span>,
  ];
  return <div className="mt-6 type-caption text-ink-3">{items}</div>;
};
