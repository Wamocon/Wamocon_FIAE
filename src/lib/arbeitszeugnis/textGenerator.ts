/**
 * Generate certificate text based on grades and gender
 * Compliant with IHK standards and German labor law (BGB/GewO) techniques.
 */

interface ComponentForText {
  code: string;
  title: string;
  finalGrade: number | null;
}

interface SoftSkillsForText {
  averages: {
    fachkompetenz: number | null;
    methodenkompetenz: number | null;
    sozialkompetenz: number | null;
    personalkompetenz: number | null;
  };
  overallAverage: number | null;
}

const gradeText: Record<number, string> = {
  1: 'den Anforderungen in besonderem Maße entsprochen',
  2: 'den Anforderungen voll entsprochen',
  3: 'den Anforderungen im Allgemeinen entsprochen',
  4: 'den Anforderungen entsprochen, wenngleich mit Mängeln',
  5: 'den Anforderungen nicht entsprochen, obwohl Grundkenntnisse vorhanden sind',
  6: 'den Anforderungen nicht entsprochen',
};

const gradeLabel: Record<number, string> = {
  1: 'sehr gut',
  2: 'gut',
  3: 'befriedigend',
  4: 'ausreichend',
  5: 'mangelhaft',
  6: 'ungenügend',
};

function getPronouns(gender: string) {
  const pronouns = {
    male: {
      subject: 'Er',
      object: 'ihn',
      possessive: 'seiner',
      possessiveAdj: 'Seine',
      title: 'Herr',
    },
    female: {
      subject: 'Sie',
      object: 'sie',
      possessive: 'ihrer',
      possessiveAdj: 'Ihre',
      title: 'Frau',
    },
    neutral: {
      subject: 'Die Person',
      object: 'die Person',
      possessive: 'der',
      possessiveAdj: 'Die',
      title: '',
    },
  } as const;

  return (
    pronouns[gender as keyof typeof pronouns] || {
      subject: 'Die Person',
      object: 'die Person',
      possessive: 'der',
      possessiveAdj: 'Die',
      title: '',
    }
  );
}

export function generateCertificateText(
  traineeName: string,
  components: ComponentForText[],
  overallAverage: number | null,
  gender: string,
  certificateType: string
): string {
  const p = getPronouns(gender);

  const isInterim = certificateType === 'INTERIM';
  const certTitle = isInterim ? 'ZWISCHENZEUGNIS' : 'AUSBILDUNGSZEUGNIS';

  let text = `${certTitle}\n\n`;
  text += `${p.title} ${traineeName} hat während ${p.possessive} Ausbildung folgende Leistungen erbracht:\n\n`;

  for (const comp of components) {
    if (comp.finalGrade) {
      const gradeDesc =
        gradeText[comp.finalGrade] || 'den Anforderungen entsprochen';
      text += `**${comp.title}**: ${p.subject} hat ${gradeDesc}.\n\n`;
    }
  }

  if (overallAverage !== null) {
    const roundedAvg = Math.round(overallAverage);
    const avgDesc =
      gradeText[roundedAvg] || 'den Anforderungen entsprochen';
    text += `\n**Gesamtbewertung**: ${p.subject} hat insgesamt ${avgDesc} (Durchschnitt: ${overallAverage.toFixed(2)}).\n`;

    if (overallAverage < 2.45) {
      text += `\n> Aufgrund der überdurchschnittlichen Leistungen (< 2,45) ist ${p.subject} gemäß IHK-Vorgabe für eine Verkürzung der Ausbildungszeit geeignet.\n`;
    }
  }

  return text;
}

/**
 * Generate a rule-based overall assessment (Gesamturteil) for the certificate.
 * This is used when the trainer chooses "Generate without AI".
 */
export function generateOverallAssessmentText(
  traineeName: string,
  gender: string,
  certificateType: 'INTERIM' | 'FINAL',
  overallGrade: number,
  overallAverage: number | null,
  components: ComponentForText[],
  softSkills?: SoftSkillsForText | null,
  summaryContext?: string,
  shorteningEligible?: boolean
): string {
  const p = getPronouns(gender);
  const titlePrefix = p.title ? `${p.title} ` : '';
  const gradeDesc = gradeText[overallGrade] || 'den Anforderungen entsprochen';
  const gradeWord = gradeLabel[overallGrade] || 'befriedigend';
  const isInterim = certificateType === 'INTERIM';

  // Collect strong component areas (grade 1-2)
  const strongComponents = components
    .filter(c => c.finalGrade !== null && c.finalGrade <= 2)
    .map(c => c.title);

  const strongAreasText =
    strongComponents.length > 0
      ? ` Besonders hervorzuheben sind dabei ${strongComponents.slice(0, 3).join(', ')}.`
      : '';

  // Soft skills mention
  let softSkillText = '';
  if (softSkills?.overallAverage !== null && softSkills?.overallAverage !== undefined) {
    const ssGrade = Math.round(softSkills.overallAverage);
    const ssLabel = gradeLabel[ssGrade] || 'befriedigend';
    softSkillText = ` ${p.possessiveAdj} soziale und methodische Kompetenzen wurden ebenfalls positiv bewertet (Durchschnitt: ${softSkills.overallAverage.toFixed(1)} — ${ssLabel}).`;
  }

  // Shortening mention
  const shorteningText = shorteningEligible
    ? ` Aufgrund der guten Leistungen ist ${p.subject} für eine Verkürzung der Ausbildungszeit geeignet.`
    : '';

  // Trainer context integration
  const contextText = summaryContext?.trim()
    ? ` ${summaryContext.trim()}`
    : '';

  const closing = isInterim
    ? `Wir freuen uns auf die weitere gemeinsame Ausbildung.`
    : `Wir danken für die angenehme Zusammenarbeit und wünschen für die berufliche und private Zukunft alles Gute.`;

  return (
    `${titlePrefix}${traineeName} hat die Ausbildung insgesamt mit der Note ${overallGrade} (${gradeWord}) abgeschlossen, ${gradeDesc}.${strongAreasText}${softSkillText}${shorteningText}${contextText} ${closing}`
  );
}
