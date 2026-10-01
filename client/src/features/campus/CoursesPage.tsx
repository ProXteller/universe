/**
 * `/campus/courses` (product §2.9, design §7.8): search by code or title, rows with the code tile · title · term ·
 * classmates · last active and a Join / Open button; "Your courses" first; create sheet with the normalised code;
 * the dedupe 409 becomes "{code} already has a chat with {n} classmates. Join it instead?".
 */
import { useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { BookOpen, Plus, Search } from 'lucide-react';
import type { Course, CourseConflictDetails } from '@shared/campus';
import { COURSE_CODE_INPUT_MAX, COURSE_TITLE_MAX } from '@shared/campus';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, FAB, InfiniteSentinel, Input, ListRow, PageHeader, Screen, Sheet, Skeleton } from '@/ui';
import { ComposerGuard, ComposerModeBanner, TimeAgo } from '@/components';
import { track, useScreenView } from '@/lib/analytics';
import { errorMessage, isApiError } from '@/lib/api';
import { formatCount, normalizeCourseCode } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { handleModerationError } from '@/lib/moderation';
import { toast } from '@/lib/toast';
import { createCourseRequest, invalidateCampus, joinCourseRequest, useCourses, useMyCourses } from './api';

export function CodeTile({ code, className }: { code: string; className?: string }) {
  return (
    <span className={`flex size-12 shrink-0 items-center justify-center rounded-sm bg-surface-3 px-1 text-center font-display type-caption leading-tight text-ink ${className ?? ''}`}>
      {code}
    </span>
  );
}

function classmates(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'classmate' : 'classmates'}`;
}

export function CourseRow({ course, onJoin, joining }: { course: Course; onJoin(c: Course): void; joining: boolean }) {
  return (
    <ListRow
      leading={<CodeTile code={course.code} />}
      title={course.title}
      subtitle={`${course.term} · ${classmates(course.memberCount)}`}
      meta={course.lastActiveAt ? <TimeAgo ts={course.lastActiveAt} className="type-caption text-ink-3" /> : null}
      unread={course.unread > 0}
      to={routes.course(course.id)}
      trailing={
        course.joined && course.conversationId ? (
          <Button size="sm" variant="secondary" to={routes.chat(course.conversationId)}>
            Open
          </Button>
        ) : (
          <Button size="sm" loading={joining} onClick={() => onJoin(course)}>
            Join
          </Button>
        )
      }
    />
  );
}

function RowSkeleton() {
  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-2" aria-hidden>
      <Skeleton w={48} h={48} className="rounded-sm" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton w="55%" h={12} />
        <Skeleton w="35%" h={10} />
      </div>
      <Skeleton w={64} h={36} className="rounded-full" />
    </div>
  );
}

export const CoursesPage: FC = () => {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const mine = useMyCourses();
  const results = useCourses(dq);
  const [createOpen, setCreateOpen] = useState(false);
  const [createCode, setCreateCode] = useState('');
  useScreenView('campus_courses');

  const join = useMutation({
    mutationFn: (c: Course) => joinCourseRequest(c.id),
    onSuccess: (res, c) => {
      track('course_join', { code: c.code });
      void invalidateCampus();
      navigate(routes.chat(res.conversationId));
    },
    onError: (e) => {
      if (!handleModerationError(e)) toast.error(errorMessage(e));
    },
  });

  const openCreate = (code: string) => {
    setCreateCode(code);
    setCreateOpen(true);
  };

  const searching = dq.length > 0;
  const myItems = mine.data?.items ?? [];
  const listItems = searching ? results.items : results.items.filter((c) => !myItems.some((m) => m.id === c.id));

  return (
    <Screen
      header={
        <PageHeader
          mode="compact"
          back
          title="Course chats"
          below={
            <div className="px-4 py-2">
              <Input
                variant="search"
                leftIcon={Search}
                placeholder="Search by code or title (CS 314)"
                value={q}
                onChange={(ev) => setQ(ev.target.value)}
                onClear={() => setQ('')}
                aria-label="Search course chats"
                autoComplete="off"
                autoCapitalize="characters"
              />
            </div>
          }
        />
      }
    >
      <div className="flex flex-col gap-2 pb-24 pt-1">
        {!searching ? (
          <section aria-label="Your courses">
            <h2 className="px-4 pt-3 type-overline text-ink-3">Your courses</h2>
            {mine.isLoading ? (
              <>
                <RowSkeleton />
                <RowSkeleton />
              </>
            ) : mine.isError ? (
              <ErrorState inline title="Couldn't load your courses" error={mine.error} onRetry={() => void mine.refetch()} />
            ) : myItems.length === 0 ? (
              <div className="px-4 pt-2">
                <EmptyState compact icon={BookOpen} title="Add your classes to find your people." description="Search a code below, or start a chat for your class." />
              </div>
            ) : (
              <Card variant="flat" className="mx-4 mt-2 p-0">
                {myItems.map((c) => (
                  <CourseRow key={c.id} course={c} onJoin={(course) => join.mutate(course)} joining={join.isPending && join.variables?.id === c.id} />
                ))}
              </Card>
            )}
          </section>
        ) : null}

        <section aria-label={searching ? 'Results' : 'All course chats'}>
          <h2 className="px-4 pt-3 type-overline text-ink-3">{searching ? `Results for “${dq}”` : 'All course chats'}</h2>
          {results.isLoading ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : results.isError ? (
            <ErrorState title="Couldn't load course chats" error={results.error} onRetry={() => void results.refetch()} />
          ) : listItems.length === 0 ? (
            searching ? (
              <EmptyState
                icon={BookOpen}
                title={`No chat for “${dq}” yet.`}
                description="Start it — classmates who search will find yours."
                action={{ label: `Create ${normalizeCourseCode(dq) ?? dq} chat`, onClick: () => openCreate(dq) }}
              />
            ) : results.items.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No course chats yet."
                description="Start the first one for a class you're in. Classmates who search will find it."
                action={{ label: 'Start a course chat', onClick: () => openCreate('') }}
              />
            ) : (
              <p className="px-4 py-3 type-footnote text-ink-3">You're in every chat on campus. Nice.</p>
            )
          ) : (
            <Card variant="flat" className="mx-4 mt-2 p-0">
              {listItems.map((c) => (
                <CourseRow key={c.id} course={c} onJoin={(course) => join.mutate(course)} joining={join.isPending && join.variables?.id === c.id} />
              ))}
              <InfiniteSentinel {...results.sentinelProps} skeleton={<RowSkeleton />} endLabel={null} />
            </Card>
          )}
        </section>
      </div>
      <FAB icon={Plus} label="Start a course chat" onClick={() => openCreate(searching ? dq : '')} />
      <CreateCourseSheet open={createOpen} onOpenChange={setCreateOpen} initialCode={createCode} />
    </Screen>
  );
};

/* ───────────────────────────── create sheet ───────────────────────────── */

export const CreateCourseSheet: FC<{ open: boolean; onOpenChange(o: boolean): void; initialCode: string }> = ({ open, onOpenChange, initialCode }) => {
  const navigate = useNavigate();
  const [code, setCode] = useState(initialCode);
  const [title, setTitle] = useState('');
  const [conflict, setConflict] = useState<Course | null>(null);
  const [error, setError] = useState<{ code?: string; title?: string }>({});
  const normalized = normalizeCourseCode(code);

  // re-seed the code when the sheet opens with a different search term
  const [seenInitial, setSeenInitial] = useState(initialCode);
  if (open && seenInitial !== initialCode) {
    setSeenInitial(initialCode);
    setCode(initialCode);
  }

  const create = useMutation({
    mutationFn: () => createCourseRequest({ code: code.trim(), title: title.trim() }),
    onSuccess: (course) => {
      track('course_create', { code: course.code });
      void invalidateCampus();
      onOpenChange(false);
      toast.success(`${course.code} chat is live`);
      if (course.conversationId) navigate(routes.chat(course.conversationId));
    },
    onError: (e) => {
      if (isApiError(e, 'conflict')) {
        const d = e.details as Partial<CourseConflictDetails> | undefined;
        if (d?.course) {
          setConflict(d.course);
          return;
        }
      }
      if (!handleModerationError(e)) toast.error(errorMessage(e));
    },
  });

  const join = useMutation({
    mutationFn: (c: Course) => joinCourseRequest(c.id),
    onSuccess: (res, c) => {
      track('course_join', { code: c.code });
      void invalidateCampus();
      setConflict(null);
      onOpenChange(false);
      navigate(routes.chat(res.conversationId));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    const next: { code?: string; title?: string } = {};
    if (!normalized) next.code = "That doesn't look like a course code. Try CS 314.";
    if (title.trim().length < 2) next.title = 'What is the class called?';
    setError(next);
    if (Object.keys(next).length === 0) create.mutate();
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title="Start a course chat"
        description="One chat per course and term. Anyone at your campus can find and join it."
        footer={
          <Button fullWidth size="lg" loading={create.isPending} onClick={submit}>
            {normalized ? `Create ${normalized} chat` : 'Create chat'}
          </Button>
        }
      >
        <ComposerGuard>
          <form
            className="flex flex-col gap-4 py-1"
            onSubmit={(ev) => {
              ev.preventDefault();
              submit();
            }}
          >
            <ComposerModeBanner mode="public" verb="Creating" note="You'll own the chat. Course chats can't be renamed." />
            <Input
              label="Course code"
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
              maxLength={COURSE_CODE_INPUT_MAX}
              placeholder="cs314"
              helper={normalized ? `Will be listed as ${normalized}` : 'Department + number, e.g. CS 314 or BIO 311C'}
              error={error.code}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <Input label="Course title" value={title} onChange={(ev) => setTitle(ev.target.value)} maxLength={COURSE_TITLE_MAX} placeholder="Data Structures" error={error.title} autoComplete="off" />
            <div className="flex items-center justify-between rounded-md border border-line bg-surface-2 px-3.5 py-2.5">
              <span className="type-footnote text-ink-2">Term</span>
              <Badge variant="soft" tone="neutral">Set automatically</Badge>
            </div>
          </form>
        </ComposerGuard>
      </Sheet>
      <Dialog
        open={conflict !== null}
        onOpenChange={(o) => { if (!o) setConflict(null); }}
        title={conflict ? `${conflict.code} already has a chat` : 'Already exists'}
        description={conflict ? `${conflict.code} already has a chat with ${classmates(conflict.memberCount)}. Join it instead?` : undefined}
        icon={BookOpen}
        confirmLabel={conflict?.joined ? 'Open it' : 'Join it'}
        cancelLabel="Not now"
        onConfirm={async () => {
          if (!conflict) return;
          if (conflict.joined && conflict.conversationId) {
            setConflict(null);
            onOpenChange(false);
            navigate(routes.chat(conflict.conversationId));
            return;
          }
          await join.mutateAsync(conflict);
        }}
      />
    </>
  );
};
