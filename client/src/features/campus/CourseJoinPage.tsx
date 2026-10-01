/**
 * `/c/:courseId` (SPEC §4.5): the course-chat link. Preview (code, title, term, classmates, last active) → Join →
 * `/messages/:conversationId`; already joined → Open chat. Also the growth loop's "Invite classmates" (copies the
 * link, "Join {code} on UniVerse"), the "Textbooks for {code}" deep link into Market, and Leave.
 */
import { useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { BookOpen, Link2, LogOut, MessageCircle, Store, Users } from 'lucide-react';
import { APP_NAME } from '@shared/core';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, PageHeader, Screen, Skeleton } from '@/ui';
import { TimeAgo } from '@/components';
import { track, useScreenView } from '@/lib/analytics';
import { errorMessage, isApiError } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { routes } from '@/lib/links';
import { absoluteUrl, copyLink } from '@/lib/share';
import { toast } from '@/lib/toast';
import { invalidateCampus, joinCourseRequest, leaveCourseRequest, useCourse } from './api';
import { CodeTile } from './CoursesPage';

export const CourseJoinPage: FC = () => {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const q = useCourse(courseId);
  const [leaveOpen, setLeaveOpen] = useState(false);
  useScreenView('course_join');

  const join = useMutation({
    mutationFn: () => joinCourseRequest(courseId),
    onSuccess: (res) => {
      track('course_join', { code: q.data?.code ?? '', source: 'link' });
      void invalidateCampus();
      navigate(routes.chat(res.conversationId), { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const invite = async () => {
    const code = q.data?.code ?? 'the class';
    const url = absoluteUrl(routes.course(courseId));
    track('invite_link_copied', { source: 'course' });
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Join ${code} on ${APP_NAME}`, text: `Join ${code} on ${APP_NAME}`, url });
        return;
      } catch {
        /* dismissed → copy instead */
      }
    }
    await copyLink(url);
  };

  const gone = q.isError && isApiError(q.error) && q.error.status === 404;
  const title = q.data?.code ?? 'Course chat';

  return (
    <Screen header={<PageHeader mode="compact" back title={title} />}>
      {q.isLoading ? (
        <div className="flex flex-col gap-4 px-4 py-4" aria-busy="true" aria-label="Loading course">
          <div className="flex items-center gap-3">
            <Skeleton w={56} h={56} className="rounded-sm" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton w="60%" h={16} />
              <Skeleton w="40%" h={10} />
            </div>
          </div>
          <Skeleton w="100%" h={52} className="rounded-full" />
          <Skeleton w="100%" h={44} className="rounded-full" />
        </div>
      ) : gone ? (
        <EmptyState
          icon={BookOpen}
          title="That course chat isn't available"
          description="It may be from another campus. Course chats are only open to students of that university."
          action={{ label: 'Browse course chats', onClick: () => navigate(routes.courses(), { replace: true }) }}
        />
      ) : q.isError || !q.data ? (
        <ErrorState title="Couldn't load this course" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-4 px-4 py-4">
          <Card variant="hero" className="flex items-center gap-3">
            <CodeTile code={q.data.code} className="size-14 type-label" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 className="type-title-3 text-ink">{q.data.title}</h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 type-caption text-ink-2">
                <Badge variant="soft" tone="neutral">{q.data.term}</Badge>
                <span className="flex items-center gap-1">
                  <Users size={14} strokeWidth={2} aria-hidden />
                  {formatCount(q.data.memberCount)} {q.data.memberCount === 1 ? 'classmate' : 'classmates'}
                </span>
                {q.data.lastActiveAt ? (
                  <span>
                    active <TimeAgo ts={q.data.lastActiveAt} />
                  </span>
                ) : null}
              </div>
            </div>
          </Card>

          {q.data.joined && q.data.conversationId ? (
            <Button size="lg" fullWidth leftIcon={MessageCircle} to={routes.chat(q.data.conversationId)}>
              Open chat{q.data.unread > 0 ? ` · ${q.data.unread} new` : ''}
            </Button>
          ) : (
            <Button size="lg" fullWidth loading={join.isPending} onClick={() => join.mutate()}>
              Join {q.data.code}
            </Button>
          )}
          <Button variant="secondary" fullWidth leftIcon={Link2} onClick={() => void invite()}>
            Invite classmates
          </Button>
          <Button variant="ghost" fullWidth leftIcon={Store} to={routes.market({ course: q.data.code })}>
            Textbooks for {q.data.code}
          </Button>
          <p className="type-caption text-ink-3">Course chats are for help, not answers. Sharing exam or graded-assignment answers breaks the guidelines.</p>
          {q.data.joined ? (
            <Button variant="danger-ghost" fullWidth leftIcon={LogOut} onClick={() => setLeaveOpen(true)}>
              Leave chat
            </Button>
          ) : null}
        </div>
      )}
      <Dialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={`Leave ${q.data?.code ?? 'this chat'}?`}
        description="You can rejoin any time from the course directory."
        icon={LogOut}
        tone="danger"
        confirmLabel="Leave"
        onConfirm={async () => {
          try {
            await leaveCourseRequest(courseId);
            await invalidateCampus();
            toast.success('Left the chat');
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </Screen>
  );
};
