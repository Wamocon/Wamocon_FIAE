/**
 * ICS Calendar Generator - Creates iCalendar (.ics) files for calendar invites
 * RFC 5545 compliant
 */

interface ICSEvent {
    uid: string;
    summary: string;
    description?: string;
    startDate: Date;
    endDate: Date;
    location?: string;
    organizer?: {
        name: string;
        email: string;
    };
    attendees?: Array<{
        email: string;
        name?: string;
    }>;
}

/**
 * Format date for iCalendar (UTC format)
 */
function formatICSDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Format date for all-day events
 */
function formatICSDateOnly(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

/**
 * Escape special characters in iCalendar text
 */
function escapeICSText(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

/**
 * Fold long lines (iCalendar lines should be max 75 characters)
 */
function foldLine(line: string): string {
    const maxLength = 75;
    if (line.length <= maxLength) return line;

    let result = '';
    let remaining = line;
    while (remaining.length > maxLength) {
        result += remaining.substring(0, maxLength) + '\r\n ';
        remaining = remaining.substring(maxLength);
    }
    result += remaining;
    return result;
}

/**
 * Generate iCalendar (.ics) content for a calendar event
 */
export function generateICS(event: ICSEvent): string {
    const now = new Date();
    const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//FIAE Platform//Block Calendar//DE',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        `UID:${event.uid}`,
        `DTSTAMP:${formatICSDate(now)}`,
        `DTSTART;VALUE=DATE:${formatICSDateOnly(event.startDate)}`,
        `DTEND;VALUE=DATE:${formatICSDateOnly(new Date(event.endDate.getTime() + 86400000))}`, // Add 1 day for all-day event end
        `SUMMARY:${escapeICSText(event.summary)}`,
    ];

    if (event.description) {
        lines.push(`DESCRIPTION:${escapeICSText(event.description)}`);
    }

    if (event.location) {
        lines.push(`LOCATION:${escapeICSText(event.location)}`);
    }

    if (event.organizer) {
        lines.push(`ORGANIZER;CN=${escapeICSText(event.organizer.name)}:mailto:${event.organizer.email}`);
    }

    if (event.attendees && event.attendees.length > 0) {
        for (const attendee of event.attendees) {
            const name = attendee.name || attendee.email.split('@')[0];
            lines.push(`ATTENDEE;CN=${escapeICSText(name)};RSVP=TRUE:mailto:${attendee.email}`);
        }
    }

    lines.push('END:VEVENT');
    lines.push('END:VCALENDAR');

    // Fold long lines and join with CRLF
    return lines.map(foldLine).join('\r\n');
}

/**
 * Generate a unique ID for calendar events
 */
export function generateEventUID(blockId: string): string {
    return `${blockId}@fiae-platform`;
}

/**
 * Block type labels for calendar invites
 */
export const BLOCK_TYPE_LABELS: Record<string, string> = {
    SCHOOL: 'Berufsschule',
    COMPANY: 'WMC',
    HOLIDAY: 'Urlaub',
    EXAM: 'Prüfung',
    PERSONAL: 'Persönlicher Termin',
    SONSTIGES: 'Sonstiges',
    TRAINER_BLOCKER: 'Trainer-Termin',
};

/**
 * Exam sub-type labels
 */
export const EXAM_SUB_TYPE_LABELS: Record<string, string> = {
    IHK_ABSCHLUSSPRUEFUNG_T1: 'IHK Abschlussprüfung Teil 1',
    IHK_ABSCHLUSSPRUEFUNG_T2: 'IHK Abschlussprüfung Teil 2',
    KLAUSUR_WMC: 'Klausur WMC',
    KLAUSUR_ALLGEMEIN: 'Klausur (Allgemein)',
    PRAKTISCHE_PRUEFUNG: 'Praktische Prüfung',
    MUENDLICHE_PRUEFUNG: 'Mündliche Prüfung',
    PROJEKTARBEIT: 'Projektarbeit',
    ANDERE: 'Andere Prüfung',
};
