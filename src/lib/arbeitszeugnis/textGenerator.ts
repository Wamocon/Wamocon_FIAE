/**
 * Generate certificate text based on grades and gender
 * Compliant with IHK standards and German labor law (BGB/GewO) techniques.
 */
export function generateCertificateText(
    traineeName: string,
    components: Array<{ code: string; title: string; finalGrade: number | null }>,
    overallAverage: number | null,
    gender: string,
    certificateType: string
): string {
    // Gender-neutral pronouns
    const pronouns = {
        male: { subject: 'Er', object: 'ihn', possessive: 'seiner', title: 'Herr' },
        female: { subject: 'Sie', object: 'sie', possessive: 'ihrer', title: 'Frau' },
        neutral: { subject: 'Die Person', object: 'die Person', possessive: 'der', title: '' },
    };
    const p = pronouns[gender as keyof typeof pronouns] || pronouns.neutral;

    // Grade descriptions (IHK standard)
    const gradeText: Record<string, string> = {
        '1': 'den Anforderungen in besonderem Maße entsprochen', // Sehr gut
        '2': 'den Anforderungen voll entsprochen', // Gut
        '3': 'den Anforderungen im Allgemeinen entsprochen', // Befriedigend
        '4': 'den Anforderungen entsprochen, wenngleich mit Mängeln', // Ausreichend
        '5': 'den Anforderungen nicht entsprochen, obwohl Grundkenntnisse vorhanden sind', // Mangelhaft
        '6': 'den Anforderungen nicht entsprochen', // Ungenügend
    };

    const isInterim = certificateType === 'INTERIM';
    const certTitle = isInterim ? 'ZWISCHENZEUGNIS' : 'AUSBILDUNGSZEUGNIS';

    let text = `${certTitle}\n\n`;
    text += `${p.title} ${traineeName} hat während ${p.possessive} Ausbildung folgende Leistungen erbracht:\n\n`;

    for (const comp of components) {
        if (comp.finalGrade) {
            const gradeDesc = gradeText[comp.finalGrade.toString()] || 'den Anforderungen entsprochen';
            text += `**${comp.title}**: ${p.subject} hat ${gradeDesc}.\n\n`;
        }
    }

    if (overallAverage !== null) {
        const roundedAvg = Math.round(overallAverage);
        const avgDesc = gradeText[roundedAvg.toString()] || 'den Anforderungen entsprochen';
        text += `\n**Gesamtbewertung**: ${p.subject} hat insgesamt ${avgDesc} (Durchschnitt: ${overallAverage.toFixed(2)}).\n`;

        if (overallAverage < 2.45) {
            text += `\n> Aufgrund der überdurchschnittlichen Leistungen (< 2,45) ist ${p.subject} gemäß IHK-Vorgabe für eine Verkürzung der Ausbildungszeit geeignet.\n`;
        }
    }

    return text;
}
