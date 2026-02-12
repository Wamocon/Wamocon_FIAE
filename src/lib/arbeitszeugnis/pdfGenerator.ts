import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import QRCode from 'qrcode';

interface CertificateData {
    traineeName: string;
    traineeBirthDate?: string;
    startDate: string;
    endDate: string;
    izhkProfile: string;
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
    summary?: string;
    radarImage?: string;
    logoImage?: string;
    softSkills?: {
        averages: {
            fachkompetenz: number | null;
            methodenkompetenz: number | null;
            sozialkompetenz: number | null;
            personalkompetenz: number | null;
        };
        overallAverage: number | null;
    };
}

// Professional color scheme
const COLORS = {
    primary: [33, 37, 41] as [number, number, number],      // Dark charcoal for text
    secondary: [108, 117, 125] as [number, number, number], // Medium gray
    accent: [0, 123, 255] as [number, number, number],      // Professional blue
    tableHeader: [52, 58, 64] as [number, number, number],  // Dark header
    tableBorder: [222, 226, 230] as [number, number, number], // Light border
    success: [40, 167, 69] as [number, number, number],     // Green for good grades
    lightBg: [248, 249, 250] as [number, number, number],   // Light background
};

const IHK_LEGEND = [
    ['1', 'Sehr gut', 'Die Anforderungen wurden in besonderem Maße erfüllt.'],
    ['2', 'Gut', 'Die Anforderungen wurden voll erfüllt.'],
    ['3', 'Befriedigend', 'Die Anforderungen wurden im Allgemeinen erfüllt.'],
    ['4', 'Ausreichend', 'Die Leistung weist Mängel auf, entspricht aber noch den Anforderungen.'],
    ['5', 'Mangelhaft', 'Die Leistung entspricht nicht den Anforderungen, Grundkenntnisse sind vorhanden.'],
    ['6', 'Ungenügend', 'Die Leistung entspricht nicht den Anforderungen, Grundkenntnisse fehlen.'],
];

export async function generateArbeitszeugnisPDF(data: CertificateData): Promise<Blob> {
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 25;
    const contentWidth = pageWidth - (margin * 2);
    let y = 20;

    // Helper functions
    const formatDate = (isoString: string): string => {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            return format(date, 'dd. MMMM yyyy', { locale: de });
        } catch {
            return isoString;
        }
    };

    const formatDateShort = (isoString: string): string => {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            return format(date, 'dd.MM.yyyy');
        } catch {
            return isoString;
        }
    };

    const getGradeText = (grade: number): string => {
        const grades: Record<number, string> = {
            1: 'sehr gut', 2: 'gut', 3: 'befriedigend',
            4: 'ausreichend', 5: 'mangelhaft', 6: 'ungenügend'
        };
        return grades[Math.round(grade)] || '';
    };

    const addSectionTitle = (title: string, yPos: number): number => {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.primary);
        doc.text(title, margin, yPos);
        return yPos + 8;
    };

    const drawHorizontalLine = (yPos: number, color = COLORS.tableBorder) => {
        doc.setDrawColor(...color);
        doc.setLineWidth(0.3);
        doc.line(margin, yPos, pageWidth - margin, yPos);
    };

    // ==================== PAGE 1: MAIN CERTIFICATE ====================

    // -- HEADER WITH LOGO --
    if (data.logoImage && data.logoImage.startsWith('data:image')) {
        // Load image to get actual dimensions for proper aspect ratio
        try {
            const img = new Image();
            img.src = data.logoImage;
            
            // Wait for image to load to get actual dimensions
            await new Promise<void>((resolve) => {
                if (img.complete) {
                    resolve();
                } else {
                    img.onload = () => resolve();
                    img.onerror = () => resolve();
                }
            });
            
            // Calculate proper dimensions preserving aspect ratio (like Tätigkeitsnachweis)
            const logoWidth = 50; // Fixed width
            const logoHeight = img.height && img.width ? (img.height / img.width) * logoWidth : 15;
            const logoX = (pageWidth - logoWidth) / 2;
            
            doc.addImage(data.logoImage, 'PNG', logoX, y, logoWidth, logoHeight);
            y += logoHeight + 10;
        } catch {
            // Fallback if image fails
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...COLORS.secondary);
            doc.text(data.companyName, pageWidth / 2, y + 6, { align: 'center' });
            y += 18;
        }
    } else {
        // Company name as fallback
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.secondary);
        doc.text(data.companyName, pageWidth / 2, y + 8, { align: 'center' });
        y += 18;
    }

    // -- DOCUMENT TITLE --
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.primary);
    doc.text('AUSBILDUNGSZEUGNIS', pageWidth / 2, y, { align: 'center' });
    y += 6;

    // Subtitle
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.secondary);
    doc.text('gemäß § 16 BBiG', pageWidth / 2, y, { align: 'center' });
    y += 15;

    drawHorizontalLine(y);
    y += 10;

    // -- PERSONAL INFORMATION SECTION --
    const pronoun = data.gender === 'male' ? 'Herr' : data.gender === 'female' ? 'Frau' : '';
    const pronounRef = data.gender === 'male' ? 'Er' : data.gender === 'female' ? 'Sie' : 'Die Person';
    const pronounPoss = data.gender === 'male' ? 'Seine' : data.gender === 'female' ? 'Ihre' : 'Die';

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.primary);

    const nameText = pronoun ? `${pronoun} ${data.traineeName}` : data.traineeName;
    const introLines = [
        nameText,
        `geboren am ${data.traineeBirthDate || '[Geburtsdatum]'},`,
        '',
        `war vom ${formatDate(data.startDate)} bis ${formatDate(data.endDate)}`,
        `in unserem Unternehmen als Auszubildende${data.gender === 'male' ? 'r' : data.gender === 'female' ? '' : '(r)'} im Beruf`,
        '',
    ];

    for (const line of introLines) {
        doc.text(line, margin, y);
        y += 6;
    }

    // Profession highlight
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(data.izhkProfile, pageWidth / 2, y, { align: 'center' });
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text('tätig.', margin, y);
    y += 15;

    // -- COMPANY DESCRIPTION --
    const companyDesc = `${data.companyName} ist ein innovatives Unternehmen im Bereich der Softwareentwicklung und digitalen Lösungen. Wir bieten unseren Auszubildenden eine praxisnahe und zukunftsorientierte Berufsausbildung.`;
    const companyLines = doc.splitTextToSize(companyDesc, contentWidth);
    doc.text(companyLines, margin, y);
    y += (companyLines.length * 6) + 12;

    // -- PERFORMANCE GRADES TABLE --
    y = addSectionTitle('Leistungsbeurteilung nach Ausbildungsrahmenplan', y);

    const tableBody = data.components.map((c, i) => [
        `${i + 1}. ${c.title}`,
        c.grade ? c.grade.toString() : '–',
        c.grade ? getGradeText(c.grade) : '–'
    ]);

    autoTable(doc, {
        startY: y,
        head: [['Ausbildungsinhalt', 'Note', 'Bewertung']],
        body: tableBody,
        theme: 'grid',
        headStyles: {
            fillColor: COLORS.tableHeader,
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 10,
            cellPadding: 4,
        },
        bodyStyles: {
            fontSize: 9,
            cellPadding: 3,
            textColor: COLORS.primary,
        },
        alternateRowStyles: {
            fillColor: COLORS.lightBg,
        },
        columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
            2: { cellWidth: 35, halign: 'center' },
        },
        margin: { left: margin, right: margin },
    });

    // @ts-ignore
    y = doc.lastAutoTable.finalY + 8;

    // -- OVERALL GRADE --
    doc.setFillColor(...COLORS.lightBg);
    doc.roundedRect(margin, y, contentWidth, 18, 2, 2, 'F');
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.primary);
    doc.text('Gesamtdurchschnitt:', margin + 5, y + 11);
    
    const avgText = `${data.averageGrade.toFixed(2)} – ${getGradeText(data.averageGrade)}`;
    doc.setTextColor(...COLORS.accent);
    doc.text(avgText, pageWidth - margin - 5, y + 11, { align: 'right' });
    y += 25;

    // -- SOFT SKILLS TABLE (if available) --
    if (data.softSkills && data.softSkills.overallAverage !== null) {
        y = addSectionTitle('Kompetenzbewertung (Soft Skills)', y);

        const softSkillsBody = [
            ['Fachkompetenz', data.softSkills.averages.fachkompetenz?.toFixed(2) || '–'],
            ['Methodenkompetenz', data.softSkills.averages.methodenkompetenz?.toFixed(2) || '–'],
            ['Sozialkompetenz', data.softSkills.averages.sozialkompetenz?.toFixed(2) || '–'],
            ['Personalkompetenz', data.softSkills.averages.personalkompetenz?.toFixed(2) || '–'],
        ];

        autoTable(doc, {
            startY: y,
            head: [['Kompetenzbereich', 'Durchschnittsnote']],
            body: softSkillsBody,
            foot: [['Gesamtdurchschnitt Soft Skills', data.softSkills.overallAverage.toFixed(2)]],
            theme: 'grid',
            headStyles: {
                fillColor: COLORS.success,
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                fontSize: 10,
            },
            footStyles: {
                fillColor: COLORS.success,
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                fontSize: 10,
            },
            bodyStyles: {
                fontSize: 9,
                cellPadding: 3,
            },
            columnStyles: {
                0: { cellWidth: 'auto' },
                1: { cellWidth: 45, halign: 'center', fontStyle: 'bold' },
            },
            margin: { left: margin, right: margin },
        });

        // @ts-ignore
        y = doc.lastAutoTable.finalY + 12;
    }

    // Check if we need a new page
    if (y > pageHeight - 80) {
        doc.addPage();
        y = 25;
    }

    // -- CLOSING SUMMARY --
    const defaultSummary = `${pronounRef} hat die übertragenen Aufgaben stets zu unserer vollen Zufriedenheit erledigt. ${pronounPoss} Leistungen wurden insgesamt mit der Note ${data.averageGrade.toFixed(2)} (${getGradeText(data.averageGrade)}) bewertet. Wir danken für die angenehme Zusammenarbeit und wünschen für die berufliche und private Zukunft alles Gute.`;
    const summaryText = data.summary || defaultSummary;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.primary);

    const summaryLines = doc.splitTextToSize(summaryText, contentWidth);
    doc.text(summaryLines, margin, y);
    y += (summaryLines.length * 6) + 20;

    // -- SIGNATURE SECTION --
    // Ensure we have space for signature + footer
    if (y > pageHeight - 90) {
        doc.addPage();
        y = 25;
    }

    // Location and date
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.primary);
    doc.text(`${data.companyName}`, margin, y);
    doc.text(`${formatDateShort(data.issuedAt.toISOString())}`, margin, y + 6);
    y += 20;

    // Signature line
    doc.setLineWidth(0.5);
    doc.setDrawColor(...COLORS.primary);
    doc.line(margin, y, margin + 75, y);
    y += 5;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(data.signerName, margin, y);
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.secondary);
    doc.text('Ausbilder / verantwortliche Fachkraft', margin, y + 5);

    // -- QR CODE & VERIFICATION (Bottom of page, separated from signature) --
    const footerY = pageHeight - 25;
    
    // Horizontal line above footer
    drawHorizontalLine(footerY - 15, COLORS.tableBorder);
    
    // QR Code - positioned on the right, smaller
    let qrImageData = data.qrCodeUrl;
    
    // Generate QR code from URL if not already base64
    if (data.qrCodeUrl && !data.qrCodeUrl.startsWith('data:image')) {
        try {
            qrImageData = await QRCode.toDataURL(data.qrCodeUrl, {
                errorCorrectionLevel: 'H',
                margin: 1,
                width: 200,
                color: { dark: '#000000', light: '#ffffff' },
            });
        } catch (e) {
            console.error('Error generating QR code in PDF:', e);
        }
    }
    
    if (qrImageData && qrImageData.startsWith('data:image')) {
        doc.addImage(qrImageData, 'PNG', pageWidth - margin - 18, footerY - 12, 18, 18);
    }

    // Verification info on the left
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.secondary);
    doc.text('Dokumentenverifikation gemäß §126a BGB', margin, footerY - 6);
    doc.text(`Verifizierungs-ID: ${data.verificationCode}`, margin, footerY - 2);
    doc.text('Scannen Sie den QR-Code zur Echtheitsprüfung', margin, footerY + 2);

    // ==================== PAGE 2: IHK LEGEND ====================
    doc.addPage();
    y = 25;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.primary);
    doc.text('Anhang: IHK-Notenschlüssel', margin, y);
    y += 15;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.secondary);
    const legendIntro = 'Die Benotung erfolgt nach dem bundeseinheitlichen IHK-Bewertungsschlüssel für die duale Berufsausbildung:';
    doc.text(legendIntro, margin, y);
    y += 12;

    autoTable(doc, {
        startY: y,
        head: [['Note', 'Bezeichnung', 'Definition']],
        body: IHK_LEGEND,
        theme: 'striped',
        headStyles: {
            fillColor: COLORS.tableHeader,
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 10,
        },
        bodyStyles: {
            fontSize: 9,
            cellPadding: 4,
        },
        columnStyles: {
            0: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
            1: { cellWidth: 35, fontStyle: 'bold' },
            2: { cellWidth: 'auto' },
        },
        margin: { left: margin, right: margin },
    });

    // @ts-ignore
    y = doc.lastAutoTable.finalY + 20;

    // Additional info
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.secondary);
    const additionalInfo = [
        'Hinweise:',
        '• Die Durchschnittsnote errechnet sich aus dem arithmetischen Mittel aller Einzelnoten.',
        '• Bei einer Durchschnittsnote von 2,44 oder besser kann eine Verkürzung der Ausbildungszeit beantragt werden.',
        '• Die Soft-Skill-Bewertung basiert auf dem MES-Kompetenzmodell (19 Kriterien in 4 Kompetenzbereichen).',
    ];
    
    for (const line of additionalInfo) {
        const splitLine = doc.splitTextToSize(line, contentWidth);
        doc.text(splitLine, margin, y);
        y += splitLine.length * 5;
    }

    // ==================== PAGE 3: RADAR CHART (if available) ====================
    if (data.radarImage) {
        doc.addPage();
        y = 25;

        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.primary);
        doc.text('Anhang: Kompetenzprofil', margin, y);
        y += 12;

        // Explanation
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COLORS.secondary);
        const radarExplanation = 'Das folgende Kompetenzprofil visualisiert die Leistungen in den verschiedenen Ausbildungsbereichen. Die Darstellung ermöglicht einen schnellen Überblick über Stärken und Entwicklungspotenziale.';
        const radarLines = doc.splitTextToSize(radarExplanation, contentWidth);
        doc.text(radarLines, margin, y);
        y += (radarLines.length * 5) + 15;

        // Center the radar chart
        const maxImgWidth = contentWidth;
        const maxImgHeight = 140;
        const imgX = (pageWidth - maxImgWidth) / 2 + 20;

        doc.addImage(data.radarImage, 'PNG', imgX, y, maxImgWidth - 40, maxImgHeight);
        y += maxImgHeight + 15;

        // Legend explanation
        doc.setFontSize(9);
        doc.setTextColor(...COLORS.secondary);
        doc.text('Legende: Die Farbcodierung zeigt die Leistungsstufe (grün = sehr gut bis rot = ungenügend).', margin, y);
        doc.text('Bei Radar-Ansicht entsprechen größere Flächen besseren Bewertungen.', margin, y + 5);
    }

    return doc.output('blob');
}
