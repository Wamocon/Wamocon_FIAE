import { generateCertificateText } from '../../src/lib/arbeitszeugnis/textGenerator';

describe('Arbeitszeugnis Module - Unit Tests', () => {

    const mockComponents = [
        { code: 'PLAN', title: 'Planen, Vorbereiten und Durchführen', finalGrade: 1 },
        { code: 'DEV', title: 'Entwickeln, Erstellen und Betreuen', finalGrade: 2 },
        { code: 'TEST', title: 'Sicherstellen der Qualität', finalGrade: 3 },
    ];

    describe('Text Generation (German IHK Standards)', () => {

        it('should generate correct pronouns for MALE trainee', () => {
            const text = generateCertificateText('Max Mustermann', mockComponents, 2.0, 'male', 'FINAL');
            expect(text).toContain('Herr Max Mustermann hat während seiner Ausbildung');
            expect(text).toContain('Er hat den Anforderungen');
        });

        it('should generate correct pronouns for FEMALE trainee', () => {
            const text = generateCertificateText('Maria Musterfrau', mockComponents, 2.0, 'female', 'FINAL');
            expect(text).toContain('Frau Maria Musterfrau hat während ihrer Ausbildung');
            expect(text).toContain('Sie hat den Anforderungen');
        });

        it('should generate correct pronouns for NEUTRAL/DIVERS trainee', () => {
            const text = generateCertificateText('Alex Muster', mockComponents, 2.0, 'neutral', 'FINAL');
            expect(text).toContain('Alex Muster hat während der Ausbildung');
            expect(text).toContain('Die Person hat den Anforderungen');
        });

        it('should map grades to correct IHK textual descriptions', () => {
            const text = generateCertificateText('Test User', mockComponents, 2.0, 'male', 'FINAL');

            // Grade 1
            expect(text).toContain('**Planen, Vorbereiten und Durchführen**: Er hat den Anforderungen in besonderem Maße entsprochen.');
            // Grade 2
            expect(text).toContain('**Entwickeln, Erstellen und Betreuen**: Er hat den Anforderungen voll entsprochen.');
            // Grade 3
            expect(text).toContain('**Sicherstellen der Qualität**: Er hat den Anforderungen im Allgemeinen entsprochen.');
        });

        it('should include shortening eligibility note if average < 2.45', () => {
            const text = generateCertificateText('Good Student', [], 1.5, 'male', 'FINAL');
            expect(text).toContain('Verkürzung der Ausbildungszeit geeignet');
        });

        it('should NOT include shortening eligibility note if average >= 2.45', () => {
            const text = generateCertificateText('Average Student', [], 2.5, 'male', 'FINAL');
            expect(text).not.toContain('Verkürzung der Ausbildungszeit geeignet');
        });

        it('should distinguish between Interim and Final certificates', () => {
            const interim = generateCertificateText('Test', [], 2.0, 'male', 'INTERIM');
            expect(interim).toContain('ZWISCHENZEUGNIS');

            const final = generateCertificateText('Test', [], 2.0, 'male', 'FINAL');
            expect(final).toContain('AUSBILDUNGSZEUGNIS');
        });

    });

});
