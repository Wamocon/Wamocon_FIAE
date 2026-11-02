/**
 * Deterministic recognition of the day companion question ("Was steht heute
 * an?", "Was steht für mich an?", "Was habe ich diese Woche zu tun?").
 *
 * Pure module (no database, no model): the data context classifies the message
 * with it (intent `day_briefing`) and the pipeline asks it before retrieval, so
 * a question about the own tasks never runs through the knowledge search.
 *
 * The message is read with folded umlauts (foldUmlauts), so a spoken "für"
 * meets "fuer". Two kinds of recognition:
 *  - fixed phrases (substrings), the original list of the day companion,
 *  - natural questions about the own tasks, appointments and state, matched
 *    against a WHOLE sentence. A knowledge question has more words after the
 *    cue ("Was steht in Enabler 3 an", "Was muss ich tun, um einen Join zu
 *    schreiben"), so it does not match and stays with the knowledge search.
 *
 * Questions that other data intents already answer with the right data keep
 * them: "Wie ist mein Fortschritt", "Wie weit bin ich", "Habe ich
 * Rückmeldungen", "Habe ich neue Benachrichtigungen" and "Was gibt es Neues"
 * are not matched here (progress, submissions and notification intents of
 * dataContext.ts).
 *
 * @module lib/hai/dayQuestion
 */

const UMLAUT_FOLD: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
};

/** Lower case with ae, oe, ue, ss: a spoken or typed "für" meets the keyword "fuer". */
export function foldUmlauts(text: string): string {
  return text.toLowerCase().replace(/[äöüß]/g, c => UMLAUT_FOLD[c]);
}

/**
 * The fixed phrases of the day companion (folded). "guten morgen" is the
 * opening of the day, a greeting that is kept apart (see isDayQuestion).
 */
const GREETING_KEYWORD = 'guten morgen';
const DAY_KEYWORDS = [
  'was steht heute an',
  'was steht an',
  'was steht heute',
  'was liegt heute an',
  'was liegt an',
  'was ansteht',
  'mein tag',
  'meinen tag',
  'tagesplan',
  'tageslage',
  'tagesstart',
  'tagesueberblick',
  'plan fuer heute',
  'plane heute',
  'heute dringend',
  'heute wichtig',
  'was muss ich heute',
  'was ist heute wichtig',
  'was ist dringend',
  'wochenplan',
  'wochenueberblick',
  'wochenlage',
];

/** Words a person puts in front of the question ("Hallo, sag mal, ..."). */
const LEAD =
  '(?:(?:hallo|hi|hey|moin|servus|ahoi|hai|na|also|und|okay|ok|guten\\s+(?:tag|morgen|abend)|sag(?:\\s+mir)?(?:\\s+mal)?|kannst\\s+du(?:\\s+mir)?(?:\\s+sagen)?|koenntest\\s+du(?:\\s+mir)?(?:\\s+sagen)?|bitte|weisst\\s+du|ich\\s+(?:moechte|will|wuerde\\s+gerne?)\\s+wissen)\\s+)*';

/** Words after the question that change nothing ("..., bitte", "... eigentlich"). */
const TAIL =
  '(?:\\s+(?:eigentlich|denn|bitte|mal|gerade|jetzt|nun|noch|so|ueberhaupt|alles|aktuell|derzeit|schon|danke|hai|im\\s+moment|fuer\\s+heute|heute|morgen|diese\\s+woche|naechste\\s+woche))*';

/** Small words that may stand between the cue and the end of the question. */
const FILL =
  '(?:heute|morgen|jetzt|nun|gerade|noch|so|denn|eigentlich|aktuell|alles|hier|derzeit|im\\s+moment|diese\\s+woche|naechste\\s+woche|bei\\s+mir|fuer\\s+mich|mir)';

const QUESTIONS: readonly string[] = [
  // "Was steht für mich an", "Was liegt bei mir an", "Was steht denn heute so an"
  `was\\s+(?:steht|liegt)\\s+(?:(?:${FILL}|fuer\\s+uns|bei\\s+uns|als\\s+naechstes)\\s+)*an`,
  // "Was für mich ansteht", "Was heute bei mir ansteht"
  `was\\s+(?:(?:fuer\\s+mich|bei\\s+mir|heute|jetzt|aktuell|so|denn|eigentlich)\\s+)*ansteht`,
  // "Was habe ich heute zu tun", "Was habe ich vor", "Was habe ich diese Woche zu erledigen"
  `was\\s+habe\\s+ich\\s+(?:(?:${FILL}|in\\s+dieser\\s+woche)\\s+)*(?:zu\\s+tun|zu\\s+erledigen|zu\\s+machen|vor|offen)`,
  // "Was muss ich machen", "Was soll ich heute erledigen", "Was muss ich als Nächstes tun"
  `was\\s+(?:muss|soll|sollte)\\s+ich\\s+(?:(?:${FILL}|als\\s+naechstes|zuerst|bis\\s+\\w+)\\s+)*(?:machen|erledigen|tun|bearbeiten|angehen)`,
  // "Was ist zu tun", "Was ist offen", "Was ist als Nächstes dran", "Was ist heute fällig"
  `was\\s+ist\\s+(?:(?:${FILL}|als\\s+naechstes)\\s+)*(?:zu\\s+tun|zu\\s+erledigen|offen|dran|faellig)`,
  // "Was sind meine Aufgaben", "Was sind meine nächsten Schritte", "Was sind meine offenen Termine"
  `was\\s+sind\\s+(?:meine|unsere)\\s+(?:(?:aktuellen|offenen|heutigen|naechsten|anstehenden|wichtigsten)\\s+)*(?:aufgaben|schritte|termine|todos?|to-?dos?|to\\s+dos?|pflichten|punkte)`,
  // "Welche Aufgaben habe ich", "Welche Termine stehen an"
  `welche\\s+(?:aufgaben|termine|to-?dos?)\\s+(?:habe\\s+ich|stehen\\s+an|liegen\\s+an|sind\\s+offen|sind\\s+faellig|warten\\s+auf\\s+mich)`,
  // "Gibt es etwas Neues für mich"
  `gibt\\s+es\\s+(?:noch\\s+)?(?:etwas|was|irgendetwas|irgendwas)\\s+neues(?:\\s+(?:fuer|bei)\\s+(?:mich|mir))?`,
  `habe\\s+ich\\s+(?:etwas|was|irgendetwas|irgendwas)\\s+neues`,
  // "Wo stehe ich", "Wo stehe ich gerade in der Ausbildung"
  `wo\\s+stehe\\s+ich(?:\\s+(?:gerade|jetzt|aktuell|eigentlich|denn|so|derzeit|im\\s+moment|(?:in|mit|bei)\\s+(?:der|meiner)\\s+ausbildung))*`,
  // "Plane meine Woche", "Kannst du meine Woche planen", "Plane mir die Woche"
  `(?:plan|plane|planst|organisier|organisiere|strukturier|strukturiere|teil)\\s+(?:mir\\s+)?(?:bitte\\s+)?(?:meine|die|diese)\\s+woche(?:\\s+ein)?`,
  `(?:meine|die|diese)\\s+woche\\s+(?:bitte\\s+)?(?:planen|organisieren|strukturieren|einteilen)`,
  // "Wie sieht meine Woche aus", "Wie sieht es heute bei mir aus"
  `wie\\s+sieht\\s+meine\\s+woche\\s+aus`,
  `wie\\s+sieht\\s+es\\s+(?:heute\\s+|jetzt\\s+|aktuell\\s+)?bei\\s+mir\\s+(?:heute\\s+)?aus`,
];

const QUESTION_PATTERNS: readonly RegExp[] = QUESTIONS.map(
  q => new RegExp(`^${LEAD}(?:${q})${TAIL}$`)
);

/** The sentences of a folded message, without the punctuation inside them. */
function sentencesOf(folded: string): string[] {
  return folded
    .split(/[.?!;\n]+/)
    .map(s =>
      s
        .replace(/[,:"'()„“”]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);
}

/**
 * The message asks for the day, the tasks or the state of the person. A bare
 * greeting ("Guten Morgen!") is no question: the pipeline answers it with its
 * greeting, the data context still loads the day for it (isDayBriefingMessage).
 */
export function isDayQuestion(message: string): boolean {
  const folded = foldUmlauts(message);
  if (DAY_KEYWORDS.some(k => folded.includes(k))) return true;
  return sentencesOf(folded).some(s => QUESTION_PATTERNS.some(p => p.test(s)));
}

/** The data intent `day_briefing`: a day question or the greeting of the day. */
export function isDayBriefingMessage(message: string): boolean {
  return (
    isDayQuestion(message) || foldUmlauts(message).includes(GREETING_KEYWORD)
  );
}
