import { NextRequest, NextResponse } from 'next/server';
import { chatWithFallback } from '@/lib/hai/providers';

const IHK_GRADE_DEFINITIONS: Record<
  number,
  { label: string; definition: string }
> = {
  1: {
    label: 'Sehr gut',
    definition: 'Die Anforderungen wurden in besonderem Maße erfüllt.',
  },
  2: {
    label: 'Gut',
    definition: 'Die Anforderungen wurden voll erfüllt.',
  },
  3: {
    label: 'Befriedigend',
    definition: 'Die Anforderungen wurden im Allgemeinen erfüllt.',
  },
  4: {
    label: 'Ausreichend',
    definition:
      'Die Leistung weist Mängel auf, entspricht aber noch den Anforderungen.',
  },
  5: {
    label: 'Mangelhaft',
    definition:
      'Die Leistung entspricht nicht den Anforderungen, Grundkenntnisse sind vorhanden.',
  },
  6: {
    label: 'Ungenügend',
    definition:
      'Die Leistung entspricht nicht den Anforderungen, Grundkenntnisse fehlen.',
  },
};

export async function POST(req: NextRequest) {
  try {
    const { remark, grade, traineeName, gender } = await req.json();

    if (!remark || !grade) {
      return NextResponse.json(
        { error: 'Bemerkung und Note sind erforderlich' },
        { status: 400 }
      );
    }

    const gradeNum = Number(grade);
    const gradeDef = IHK_GRADE_DEFINITIONS[gradeNum];
    if (!gradeDef) {
      return NextResponse.json(
        { error: 'Ungültige Note (1-6)' },
        { status: 400 }
      );
    }

    const pronounRef =
      gender === 'male' ? 'Er' : gender === 'female' ? 'Sie' : 'Die Person';
    const pronounPoss =
      gender === 'male' ? 'Seine' : gender === 'female' ? 'Ihre' : 'Die';
    const pronounObj =
      gender === 'male' ? 'ihm' : gender === 'female' ? 'ihr' : 'der Person';

    const systemPrompt = `Du bist ein erfahrener Ausbilder in einem deutschen IT-Unternehmen. Du verfasst professionelle Gesamturteil-Texte für betriebliche Leistungsbeurteilungen (Arbeitszeugnisse) nach IHK-Standard.

WICHTIGE REGELN:
- Verwende die offizielle IHK-Notendefinition als Grundlage für die Formulierung.
- Der Text MUSS der gewählten Note ${gradeNum} (${gradeDef.label}) entsprechen: "${gradeDef.definition}"
- Verwende die Formulierungen und den Inhalt aus der Bemerkung des Ausbilders, aber formuliere sie professionell und strukturiert um.
- Der Text soll 3-5 Sätze lang sein.
- Verwende ${pronounRef}/${pronounPoss} als Pronomen für den Auszubildenden.
- Schreibe im typischen Arbeitszeugnis-Stil (wohlwollend, professionell, klar).
- Beende mit einem Dank und Zukunftswunsch.
- Gib NUR den fertigen Text zurück, keine Erklärungen oder Kommentare.`;

    const userMessage = `Auszubildende/r: ${traineeName || 'der/die Auszubildende'}
Gesamtnote: ${gradeNum} (${gradeDef.label}) – "${gradeDef.definition}"
Bemerkung des Ausbilders: ${remark}

Bitte verfasse ein professionelles Gesamturteil für die Leistungsbeurteilung.`;

    const result = await chatWithFallback(systemPrompt, [], userMessage);

    return NextResponse.json({ text: result.text });
  } catch (error: any) {
    console.error('Rewrite error:', error);
    return NextResponse.json(
      { error: 'Fehler bei der KI-Generierung' },
      { status: 500 }
    );
  }
}
