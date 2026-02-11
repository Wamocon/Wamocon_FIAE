import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface CertificateData {
    traineeName: string;
    traineeBirthDate?: string; // Optional if not in profile yet
    startDate: string;
    endDate: string;
    izhkProfile: string; // e.g., "Fachinformatiker für Anwendungsentwicklung"
    companyName: string;
    components: {
        title: string;
        grade: number | null;
    }[];
    averageGrade: number;
    qrCodeUrl: string;
    verificationCode: string;
    issuedAt: Date;
    signerName: string;
    gender: 'male' | 'female' | 'neutral';
    summary?: string; // Optional custom summary
    radarImage?: string; // Base64 image of the radar chart
}

const IHK_LEGEND = [
    ['1', 'Sehr gut', 'entspricht den Anforderungen in besonderem Maße'],
    ['2', 'Gut', 'entspricht den Anforderungen voll'],
    ['3', 'Befriedigend', 'entspricht den Anforderungen im Allgemeinen'],
    ['4', 'Ausreichend', 'weist Mängel auf, entspricht aber im Ganzen noch den Anforderungen'],
    ['5', 'Mangelhaft', 'entspricht nicht den Anforderungen, Grundkenntnisse sind vorhanden'],
    ['6', 'Ungenügend', 'entspricht nicht den Anforderungen, Grundkenntnisse nicht ausreichend'],
];

export async function generateArbeitszeugnisPDF(data: CertificateData): Promise<Blob> {
    const doc = new jsPDF();

    // -- CONSTANTS --
    const pageWidth = doc.internal.pageSize.width;
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    let y = 20;

    // -- HEADER --
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('Ausbildungszeugnis', pageWidth / 2, y, { align: 'center' });
    y += 15;

    // -- PERSONAL INFO --
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');

    const pronoun = data.gender === 'male' ? 'Herr' : data.gender === 'female' ? 'Frau' : 'Person';
    const possesive = data.gender === 'male' ? 'Sein' : data.gender === 'female' ? 'Ihr' : 'Deren';

    const formatDate = (isoString: string) => {
        if (!isoString) return '';
        try {
            const [year, month, day] = isoString.split('T')[0].split('-');
            return `${day}.${month}.${year}`;
        } catch (e) {
            return format(new Date(isoString), 'dd.MM.yyyy'); // Fallback
        }
    };

    const introText = `${pronoun} ${data.traineeName}, geboren am [Geburtsdatum], hat vom ${formatDate(data.startDate)} bis ${formatDate(data.endDate)} in unserem Unternehmen eine Ausbildung zum ${data.izhkProfile} absolviert.`;

    const splitIntro = doc.splitTextToSize(introText, contentWidth);
    doc.text(splitIntro, margin, y);
    y += (splitIntro.length * 7) + 10;

    // -- COMPANY DESCRIPTION (Placeholder) --
    const companyText = `${data.companyName} ist ein führendes Unternehmen im Bereich Softwareentwicklung... (Firmenbeschreibung)`;
    const splitCompany = doc.splitTextToSize(companyText, contentWidth);
    doc.text(splitCompany, margin, y);
    y += (splitCompany.length * 7) + 10;

    // -- COMPONENTS TABLE --
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Leistungsbeurteilung nach Ausbildungsrahmenplan', margin, y);
    y += 8;

    const tableBody = data.components.map(c => [
        c.title,
        c.grade ? c.grade.toString() : '–'
    ]);

    autoTable(doc, {
        startY: y,
        head: [['Ausbildungsinhalt / Kompetenzbereich', 'Note']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185], textColor: 255 },
        columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 30, halign: 'center' },
        },
        styles: { fontSize: 11, cellPadding: 3 },
    });

    // @ts-ignore
    y = doc.lastAutoTable.finalY + 15;

    // -- SUMMARY --
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');

    const averageText = `${possesive} Leistungen wurden insgesamt mit der Durchschnittsnote ${data.averageGrade.toFixed(2)} bewertet.`;
    doc.text(averageText, margin, y);
    y += 10;

    // Use custom summary if provided, else use default boiler-plate
    const defaultSummary = `${pronoun} ${data.traineeName} hat die ihm übertragenen Aufgaben stets zu unserer vollen Zufriedenheit erledigt. Wir danken für die angenehme Zusammenarbeit und wünschen für die berufliche und private Zukunft alles Gute.`;
    const summaryText = data.summary || defaultSummary;

    const splitSummary = doc.splitTextToSize(summaryText, contentWidth);
    doc.text(splitSummary, margin, y);
    y += (splitSummary.length * 7) + 20;

    // -- SIGNATURE --
    doc.text(`${data.companyName}, den ${format(data.issuedAt, 'dd.MM.yyyy')}`, margin, y);
    y += 20;

    doc.line(margin, y, margin + 80, y);
    y += 5;
    doc.text(data.signerName, margin, y);
    doc.setFontSize(10);
    doc.text('Ausbilder / Verantwortlicher', margin, y + 5);

    // -- QR CODE & VERIFICATION (Bottom) --
    const footerY = 270;

    doc.setDrawColor(200);
    doc.line(margin, footerY - 5, pageWidth - margin, footerY - 5);

    // QR Code Image
    if (data.qrCodeUrl && data.qrCodeUrl.startsWith('data:image')) {
        doc.addImage(data.qrCodeUrl, 'PNG', pageWidth - 35, footerY - 15, 25, 25);
    }

    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Dokumentenverifikation gemäß §126a BGB', margin, footerY);
    doc.text(`ID: ${data.verificationCode}`, margin, footerY + 5);

    // Display full verification URL
    // doc.text(`URL: ${data.qrCodeUrl}`, margin, footerY + 10); 
    // The previous code had `URL: ${data.verificationCode}` which was wrong.
    // Also, if qrCodeUrl is a data URI (image), we can't print it as text. 
    // We should probably pass the "verificationUrl" string separately if we want to print it textually, 
    // OR we assume the `verificationCode` is enough for manual entry if needed.
    // Let's print a base URL + code if possible, or just the code explanation.
    doc.text(`Verifikation unter: ${window.location.origin}/verify/${data.verificationCode}`, margin, footerY + 10);


    // -- PAGE 2: LEGEND --
    doc.addPage();
    y = 20;

    doc.setFontSize(16);
    doc.setTextColor(0);
    doc.text('Anhang: IHK Notenschlüssel', margin, y);
    y += 15;

    autoTable(doc, {
        startY: y,
        head: [['Note', 'Bezeichnung', 'Definition']],
        body: IHK_LEGEND,
        theme: 'striped',
        headStyles: { fillColor: [100, 100, 100], textColor: 255 },
        columnStyles: {
            0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
            1: { cellWidth: 40, fontStyle: 'bold' },
            2: { cellWidth: 'auto' },
        },
    });



    // -- PAGE 3: SKILL RADAR (if available) --
    if (data.radarImage) {
        doc.addPage();
        y = 20;

        doc.setFontSize(16);
        doc.setTextColor(0);
        doc.text('Anhang: Kompetenzprofil (Skill-Radar)', margin, y);
        y += 15;

        // Add explanation
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const radarExplanation = 'Das folgende Diagramm visualisiert die Kompetenzschwerpunkte basierend auf den bewerteten IHK-Komponenten. Es zeigt anschaulich Stärken und Entwicklungspotenziale in den verschiedenen Ausbildungsbereichen.';
        const splitRadar = doc.splitTextToSize(radarExplanation, contentWidth);
        doc.text(splitRadar, margin, y);
        y += (splitRadar.length * 5) + 10;

        // Add Image
        const imgWidth = 120;
        const imgHeight = 120;
        const x = (pageWidth - imgWidth) / 2;

        doc.addImage(data.radarImage, 'PNG', x, y, imgWidth, imgHeight);
    }

    return doc.output('blob');
}
