import { NextRequest, NextResponse } from 'next/server';
import { chatWithFallback } from '@/lib/hai/providers';

interface ComponentSummary {
  title: string;
  finalGrade: number | null;
  averageGrade: number | null;
  totalHours: number;
}

interface SoftSkillsSummary {
  averages: {
    fachkompetenz: number | null;
    methodenkompetenz: number | null;
    sozialkompetenz: number | null;
    personalkompetenz: number | null;
  };
  overallAverage: number | null;
}

interface GenerateSummaryBody {
  traineeName: string;
  gender: 'male' | 'female' | 'neutral';
  certificateType: 'INTERIM' | 'FINAL';
  overallAverage: number | null;
  manualOverallGrade: number | null;
  components: ComponentSummary[];
  softSkills?: SoftSkillsSummary | null;
  summaryContext?: string;
  shorteningEligible?: boolean;
}

const gradeText: Record<number, string> = {
  1: 'sehr gut',
  2: 'gut',
  3: 'befriedigend',
  4: 'ausreichend',
  5: 'mangelhaft',
  6: 'ungenügend',
};

export async function POST(request: NextRequest) {
  try {
    const body: GenerateSummaryBody = await request.json();
    const {
      traineeName,
      gender,
      certificateType,
      overallAverage,
      manualOverallGrade,
      components,
      softSkills,
      summaryContext = '',
      shorteningEligible = false,
    } = body;

    if (!traineeName) {
      return NextResponse.json(
        { error: 'Missing traineeName' },
        { status: 400 }
      );
    }

    const effectiveOverallGrade =
      manualOverallGrade ??
      (overallAverage !== null ? Math.round(overallAverage) : null);

    if (effectiveOverallGrade === null) {
      return NextResponse.json(
        { error: 'No overall grade available for summary generation' },
        { status: 400 }
      );
    }

    const pronounSubject =
      gender === 'male' ? 'Er' : gender === 'female' ? 'Sie' : 'Die Person';
    const pronounPossessive =
      gender === 'male' ? 'seiner' : gender === 'female' ? 'ihrer' : 'der';
    const title =
      gender === 'male' ? 'Herr' : gender === 'female' ? 'Frau' : '';

    const gradeLabel = gradeText[effectiveOverallGrade] || 'befriedigend';
    const certificateLabel =
      certificateType === 'INTERIM' ? 'Zwischenzeugnis' : 'Ausbildungszeugnis';

    const componentLines = components
      .filter(c => c.finalGrade !== null)
      .map(
        c =>
          `- ${c.title}: Note ${c.finalGrade} (${gradeText[c.finalGrade!]}), ${c.totalHours} Std.`
      )
      .join('\n');

    const softSkillLines = softSkills
      ? [
          softSkills.averages.fachkompetenz !== null
            ? `Fachkompetenz: ${softSkills.averages.fachkompetenz.toFixed(1)}`
            : null,
          softSkills.averages.methodenkompetenz !== null
            ? `Methodenkompetenz: ${softSkills.averages.methodenkompetenz.toFixed(1)}`
            : null,
          softSkills.averages.sozialkompetenz !== null
            ? `Sozialkompetenz: ${softSkills.averages.sozialkompetenz.toFixed(1)}`
            : null,
          softSkills.averages.personalkompetenz !== null
            ? `Personalkompetenz: ${softSkills.averages.personalkompetenz.toFixed(1)}`
            : null,
          softSkills.overallAverage !== null
            ? `Soft-Skill-Gesamtdurchschnitt: ${softSkills.overallAverage.toFixed(1)}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      : 'Keine Soft-Skill-Bewertungen vorhanden.';

    const systemPrompt = `Du bist ein erfahrener Ausbilder in einer deutschen IHK-Ausbildung und verfasst Zeugnistexte.

Regeln:
- Schreibe auf Deutsch in professioneller, IHK-konformer Zeugnissprache.
- Verwende keine Aufzählungen, keine Markdown-Formatierung und keine Überschriften.
- Der Text ist das "Gesamturteil" eines ${certificateLabel}s.
- Er soll max. 600 Zeichen lang sein und als Fließtext formuliert sein.
- Beziehe dich auf die Gesamtnote und die wichtigsten Stärken.
- Wenn eine Verkürzung der Ausbildungszeit möglich ist (< 2,45), erwähne dies positiv.
- Wenn der Nutzer zusätzliche Bemerkungen liefert, arbeite diese sinnvoll ein.
- Verwende NICHT die Schlussformel "Wir danken für die angenehme Zusammenarbeit...". Diese wird separat ergänzt.
- Verwende folgende Anredeformen: ${pronounSubject} / ${pronounPossessive}.`;

    const userPrompt = `Erstelle das Gesamturteil für folgende/n Auszubildende/n:

Name: ${title} ${traineeName}
Gesamtnote: ${effectiveOverallGrade} (${gradeLabel})
Zeugnistyp: ${certificateLabel}

Bewertete Ausbildungsbereiche:
${componentLines || 'Keine Einzelbewertungen vorhanden.'}

Soft Skills:
${softSkillLines}

Verkürzung möglich: ${shorteningEligible ? 'Ja' : 'Nein'}

Zusätzliche Bemerkungen des Ausbilders:
${summaryContext || 'Keine zusätzlichen Bemerkungen.'}

Schreibe nun ausschließlich das Gesamturteil (max. 600 Zeichen, Fließtext).`;

    const response = await chatWithFallback(
      systemPrompt,
      [],
      userPrompt,
      undefined,
      {
        temperature: 0.6,
        maxOutputTokens: 1024,
      }
    );

    let generatedSummary = response.text.trim();

    if (!generatedSummary) {
      return NextResponse.json(
        { error: 'KI hat keinen Text generiert' },
        { status: 500 }
      );
    }

    // Strip markdown artifacts and truncate to 600 chars as requested in the prompt
    generatedSummary = generatedSummary
      .replace(/\*\*/g, '')
      .replace(/#{1,6}\s?/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    if (generatedSummary.length > 600) {
      generatedSummary = generatedSummary.slice(0, 597) + '...';
    }

    return NextResponse.json({
      summary: generatedSummary,
      provider: response.provider,
      finishReason: response.finishReason,
    });
  } catch (error: unknown) {
    console.error('Error generating certificate summary:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Fehler bei der KI-Generierung: ${message}` },
      { status: 500 }
    );
  }
}
