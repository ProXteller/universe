/**
 * Client-generated `.ics` (SPEC §5.9 "Add to calendar"): one VEVENT, built from the detail payload, offered as a Blob
 * download. No network, no server endpoint.
 */
import { APP_NAME } from '@shared/core';
import type { EventDetail } from '@shared/campus';
import { absoluteUrl } from '@/lib/share';
import { routes } from '@/lib/links';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** UTC timestamp in iCalendar basic format: 20260304T190000Z. */
function icsDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 §3.1: lines ≤ 75 octets, continuation lines start with one space. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = ` ${rest.slice(73)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(event: EventDetail): string {
  const location = [event.locationName, event.address].filter(Boolean).join(', ');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${APP_NAME}//Events//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:event-${event.id}@universe`,
    `DTSTAMP:${icsDate(Date.now())}`,
    `DTSTART:${icsDate(event.startsAt)}`,
    `DTEND:${icsDate(event.endsAt)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `LOCATION:${escapeText(location)}`,
    `DESCRIPTION:${escapeText(event.description ? `${event.description}\n\n${absoluteUrl(routes.event(event.id))}` : absoluteUrl(routes.event(event.id)))}`,
    `URL:${absoluteUrl(routes.event(event.id))}`,
    `ORGANIZER;CN=${escapeText(event.host.displayName)}:MAILTO:noreply@universe.invalid`,
    `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Offers the file to save; returns false when the browser cannot download (nothing to do then). */
export function downloadIcs(event: EventDetail): boolean {
  try {
    const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.title.replace(/[^\w\d-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event'}.ics`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}
