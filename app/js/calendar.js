// Expiry reminders → aapka Google Calendar (phone par notification wahi se aayegi).
// Calendar mein sirf chhota title jaata hai ("DL expire ho raha hai", "Naresh se ₹500 lene hain"), document ki details nahi.
import { gfetch, hasToken, SCOPE_CALENDAR } from './drive.js';
import { liveDocs, liveReminders, liveMoney, nowIso } from './model.js';

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const DAY = 24 * 60;

const nextDay = (iso) => new Date(Date.parse(iso + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);

// Calendar mein jaane wali har cheez: document expiry, tareekh wala reminder, udhaar wapsi
function calendarItems(state) {
  const items = [];
  for (const d of Object.values(state.docs || {})) {
    items.push({ coll: 'docs', rec: d, want: !d.deleted && Boolean(d.expiry_date), date: d.expiry_date, title: `⏰ ${d.title} expire ho raha hai`, allDay: true, alerts: [28 * DAY, 7 * DAY] });
  }
  for (const r of Object.values(state.reminders || {})) {
    items.push({ coll: 'reminders', rec: r, want: !r.deleted && !r.done && Boolean(r.due_date), date: r.due_date, title: `🔔 ${r.text}`, allDay: false, alerts: [0, DAY] });
  }
  for (const m of Object.values(state.money || {})) {
    const title = m.direction === 'lent' ? `💰 ${m.person} se ₹${m.amount} wapas lene hain` : `💰 ${m.person} ko ₹${m.amount} lautane hain`;
    items.push({ coll: 'money', rec: m, want: !m.deleted && !m.settled && Boolean(m.due_date), date: m.due_date, title, allDay: false, alerts: [0, DAY] });
  }
  return items;
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

// Expiry: poore din ka event, 4 hafte + 1 hafta pehle alert (Google max 4 hafte deta hai).
// Reminder / udhaar: us din subah 9 baje ka event — alert us din 9 baje aur ek din pehle 9 baje.
function eventBody(item) {
  const when = item.allDay
    ? { start: { date: item.date }, end: { date: nextDay(item.date) } }
    : { start: { dateTime: `${item.date}T09:00:00`, timeZone: TZ }, end: { dateTime: `${item.date}T09:30:00`, timeZone: TZ } };
  return {
    summary: item.title,
    description: 'P-Dock reminder',
    ...when,
    reminders: { useDefault: false, overrides: item.alerts.map((minutes) => ({ method: 'popup', minutes })) },
  };
}

// state ko badalta hai (event id save karta hai); badla to true
export async function syncCalendar(state) {
  if (!state.settings.calendar_sync || !hasToken(SCOPE_CALENDAR)) return false;
  let changed = false;
  for (const item of calendarItems(state)) {
    const r = item.rec;
    try {
      if (item.want && (!r.calendar_event_id || r.calendar_event_date !== item.date || r.calendar_event_title !== item.title)) {
        const url = r.calendar_event_id ? `${API}/${r.calendar_event_id}` : API;
        const res = await gfetch(url, {
          method: r.calendar_event_id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody(item)),
        });
        const ev = await res.json();
        Object.assign(r, { calendar_event_id: ev.id, calendar_event_date: item.date, calendar_event_title: item.title, updated_at: nowIso() });
        changed = true;
      } else if (!item.want && r.calendar_event_id) {
        await gfetch(`${API}/${r.calendar_event_id}`, { method: 'DELETE' }).catch(() => {});
        Object.assign(r, { calendar_event_id: null, calendar_event_date: null, updated_at: nowIso() });
        changed = true;
      }
    } catch (e) {
      // Event Calendar se haath se mita diya gaya ho to dobara banao
      if (/error 404|error 410/.test(e.message)) { r.calendar_event_id = null; changed = true; } else throw e;
    }
  }
  return changed;
}

export const _test = { calendarItems, eventBody };

// .ics file (bina Google ke bhi iPhone Calendar mein daal sakte ho)
export function icsFile(state) {
  const esc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//P-Dock//EN', 'X-WR-CALNAME:P-Dock Reminders'];
  for (const d of liveDocs(state).filter((x) => x.expiry_date)) {
    lines.push('BEGIN:VEVENT', `UID:pdock-${d.id}@pdock`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d.expiry_date.replace(/-/g, '')}`, `SUMMARY:${esc(`${d.title} expire ho raha hai`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P30D', `DESCRIPTION:${esc(d.title)} — 30 din baaki`, 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P7D', `DESCRIPTION:${esc(d.title)} — 7 din baaki`, 'END:VALARM',
      'END:VEVENT');
  }
  for (const r of liveReminders(state).filter((x) => !x.done && x.due_date)) {
    lines.push('BEGIN:VEVENT', `UID:pdock-r-${r.id}@pdock`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${r.due_date.replace(/-/g, '')}`,
      `SUMMARY:${esc(r.text)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT9H', `DESCRIPTION:${esc(r.text)}`, 'END:VALARM', 'END:VEVENT');
  }
  for (const m of liveMoney(state).filter((x) => !x.settled && x.due_date)) {
    const t = m.direction === 'lent' ? `${m.person} se ₹${m.amount} wapas lene hain` : `${m.person} ko ₹${m.amount} lautane hain`;
    lines.push('BEGIN:VEVENT', `UID:pdock-m-${m.id}@pdock`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${m.due_date.replace(/-/g, '')}`,
      `SUMMARY:${esc(t)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT9H', `DESCRIPTION:${esc(t)}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Blob([lines.join('\r\n')], { type: 'text/calendar' });
}
