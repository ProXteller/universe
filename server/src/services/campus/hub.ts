/**
 * Campus hub (SPEC §5.9): member count + launch meter, the Today counts, today's / upcoming events, the viewer's course
 * chats, and the launch milestones (`campus_milestones` + one `campus.milestone` notification per newly crossed goal).
 */
import type { Id } from '@shared/core';
import type { CampusHub } from '@shared/campus';
import { LAUNCH_GOALS } from '@shared/campus';
import { db, prep, tx } from '../../db/index';
import { now } from '../../lib/clock';
import { log } from '../../lib/logger';
import { notify } from '../../lib/notify';
import { getUniversityRow } from '../../lib/universities';
import { getUniversity, type AuthedUser } from '../../lib/users';
import { listMyCourses } from './courses';
import { hubEvents, serializeEventCards } from './events';

export function nextLaunchGoal(count: number): number | null {
  for (const goal of LAUNCH_GOALS) if (count < goal) return goal;
  return null;
}

/**
 * Inserts a `campus_milestones` row for every ladder entry the campus has crossed and notifies the campus once for the
 * HIGHEST newly crossed goal (a first hub fetch on a 180-member campus does not produce two rows per user).
 * Seeds pre-insert rows consistent with seeded counts so a fresh `db:reset` never fires. Never throws.
 */
export function checkMilestones(universityId: Id, memberCount: number, universityName: string): number | null {
  try {
    const uni = getUniversityRow(universityId);
    if (!uni || uni.is_hidden) return null;
    const reached = (prep('SELECT goal FROM campus_milestones WHERE university_id = ?').all(universityId) as { goal: number }[]).map((r) => r.goal);
    const crossed = LAUNCH_GOALS.filter((g) => memberCount >= g && !reached.includes(g));
    if (crossed.length === 0) return null;
    const at = now();
    const top = Math.max(...crossed);
    tx(() => {
      const ins = prep('INSERT OR IGNORE INTO campus_milestones (university_id, goal, reached_at) VALUES (?,?,?)');
      for (const g of crossed) ins.run(universityId, g, at);
      const members = db.prepare("SELECT id FROM users WHERE university_id = ? AND status = 'active'").all(universityId) as { id: Id }[];
      for (const m of members) {
        notify({
          userId: m.id, type: 'campus.milestone', actorId: null, href: '/campus',
          target: { entityType: 'university', entityId: universityId }, data: { universityName, goal: top }, collapse: false,
        });
      }
    });
    return top;
  } catch (err) {
    log.error('campus milestone check failed', err);
    return null;
  }
}

export function getHub(viewer: AuthedUser): CampusHub {
  const university = getUniversity(viewer.universityId);
  checkMilestones(university.id, university.memberCount, university.name);
  const ev = hubEvents(viewer);
  return {
    university,
    launch: { count: university.memberCount, goal: nextLaunchGoal(university.memberCount) },
    today: { events: ev.todayCount, freeFood: ev.freeFoodToday, newListings: null },
    todayEvents: serializeEventCards(ev.today, viewer.id),
    upcoming: serializeEventCards(ev.upcoming, viewer.id),
    myCourses: listMyCourses(viewer),
  };
}
