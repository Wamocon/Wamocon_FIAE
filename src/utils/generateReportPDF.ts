'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ReportEntry {
    useCaseId: string;
    plannedHours: number;
    actualHours: number;
    isOverbooked: boolean;
    notes: string | null;
    // Grading fields - 3-column grading
    traineeGrade?: string | number | null;
    trainerGrade?: string | number | null;
    releaseGrade?: string | number | null;
    gradeComment?: string | null;
    releaseGradeComment?: string | null;
}

interface TrainingUseCase {
    id: string;
    componentId: string;
    letter: string;
    description: string;
    plannedHours: number;
}

interface TrainingComponent {
    id: string;
    code: string;
    title: string;
}

interface SoftSkillRating {
    name: string;
    traineeRating?: string;
    trainerRating?: string;
    releaseRating?: string;
}

interface ReportData {
    id: string;
    traineeId: string;
    traineeName: string;
    traineeEmail: string;
    ausbildungsjahr: number;
    weekNumber: number;
    year: number;
    periodStart: string;
    periodEnd: string;
    status: string;
    submittedAt: string | null;
    traineeSignedAt: string | null;
    trainerSignedAt: string | null;
    reviewerId: string | null;
    reviewerName: string | null;
    entries: ReportEntry[];
    // New Fields
    selfRating?: string;
    selfComment?: string;
    trainerRating?: string;
    trainerComment?: string;
    releaseRating?: string;
    releaseComment?: string;
    softSkills?: SoftSkillRating[];
}

/**
 * Generates a professional PDF for an activity report (Tätigkeitsnachweis)
 * Includes WMC logo, entry table, grading, and digital signature sections
 */
export async function generateActivityReportPDF(
    report: ReportData,
    useCases: TrainingUseCase[],
    components: TrainingComponent[],
    returnBlob: boolean = false
): Promise<Blob | void> {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Helper functions
    const getUseCaseById = (id: string) => useCases.find(uc => uc.id === id);
    const getComponentById = (id: string) => components.find(c => c.id === id);
    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        });
    };

    // --- HEADER WITH LOGO ---
    try {
        // Load logo image
        const logoImg = new Image();
        logoImg.crossOrigin = 'anonymous';

        await new Promise<void>((resolve, reject) => {
            logoImg.onload = () => resolve();
            logoImg.onerror = () => reject(new Error('Failed to load logo'));
            logoImg.src = '/WMC_Logo.png';
        });

        // Add logo to PDF (centered at top)
        const logoWidth = 50;
        const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
        doc.addImage(logoImg, 'PNG', (pageWidth - logoWidth) / 2, 10, logoWidth, logoHeight);
    } catch (error) {
        console.warn('Failed to load logo, continuing without it:', error);
    }

    // --- TITLE ---
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Tätigkeitsnachweis', pageWidth / 2, 50, { align: 'center' });
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Ausbildungsnachweis gemäß Berufsbildungsgesetz', pageWidth / 2, 58, { align: 'center' });

    // --- REPORT METADATA ---
    let yPos = 70;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Auszubildende/r:', 14, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(report.traineeName || 'Nicht angegeben', 55, yPos);

    yPos += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('Ausbildungsjahr:', 14, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(`${report.ausbildungsjahr}. Ausbildungsjahr`, 55, yPos);

    yPos += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('Berichtszeitraum:', 14, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(`KW ${report.weekNumber} / ${report.year}`, 55, yPos);

    yPos += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('Zeitraum:', 14, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(`${formatDate(report.periodStart)} - ${formatDate(report.periodEnd)}`, 55, yPos);

    // Status badge
    yPos += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('Status:', 14, yPos);
    doc.setFont('helvetica', 'normal');
    const statusText = report.status === 'APPROVED' ? 'Genehmigt ✓' : report.status === 'REJECTED' ? 'Abgelehnt' : report.status;
    doc.text(statusText, 55, yPos);

    // --- ENTRIES TABLE ---
    yPos += 12;

    // Prepare table data with 3-column grades
    const tableData = report.entries.map(entry => {
        const useCase = getUseCaseById(entry.useCaseId);
        const component = useCase ? getComponentById(useCase.componentId) : null;

        const traineeGradeDisplay = entry.traineeGrade ? String(entry.traineeGrade) : '-';
        const trainerGradeDisplay = entry.trainerGrade ? String(entry.trainerGrade) : '-';
        const releaseGradeDisplay = entry.releaseGrade ? String(entry.releaseGrade) : '-';

        return [
            component?.code || '-',
            `${useCase?.letter || '-'}) ${useCase?.description || 'Unbekannt'}`,
            `${entry.plannedHours} Std`,
            `${entry.actualHours} Std`,
            traineeGradeDisplay,
            trainerGradeDisplay,
            releaseGradeDisplay,
            entry.releaseGradeComment || entry.gradeComment || entry.notes || '-'
        ];
    });

    // Calculate totals
    const totalPlanned = report.entries.reduce((sum, e) => sum + e.plannedHours, 0);
    const totalActual = report.entries.reduce((sum, e) => sum + e.actualHours, 0);

    autoTable(doc, {
        startY: yPos,
        head: [['Komp.', 'Use Case / Tätigkeit', 'Plan', 'IST', 'Azubi', 'Ausb.', 'Freig.', 'Anmerkungen']],
        body: tableData,
        foot: [['', 'Gesamt:', `${totalPlanned} Std`, `${totalActual} Std`, '', '', '', '']],
        theme: 'striped',
        headStyles: {
            fillColor: [51, 51, 51],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8,
        },
        bodyStyles: {
            fontSize: 7,
        },
        footStyles: {
            fillColor: [240, 240, 240],
            textColor: [0, 0, 0],
            fontStyle: 'bold',
            fontSize: 8,
        },
        columnStyles: {
            0: { cellWidth: 13 },
            1: { cellWidth: 55 },
            2: { cellWidth: 16, halign: 'center' },
            3: { cellWidth: 16, halign: 'center' },
            4: { cellWidth: 12, halign: 'center' },
            5: { cellWidth: 12, halign: 'center' },
            6: { cellWidth: 12, halign: 'center' },
            7: { cellWidth: 'auto' },
        },
        margin: { left: 14, right: 14 },
    });

    // Get the Y position after the table
    // @ts-expect-error - jspdf-autotable extends jsPDF prototype
    let finalY = doc.lastAutoTable?.finalY || yPos + 50;

    // --- GRADING & SOFT SKILLS (New Section) ---
    if (report.status === 'APPROVED' && (report.trainerRating || report.selfRating)) {
        yPos = finalY + 15;

        // Ensure space for grading section
        if (yPos > 220) {
            doc.addPage();
            yPos = 20;
        }

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Leistungsbewertung', 14, yPos);
        yPos += 8;

        // Overall Grade Table - 3 columns: Azubi, Ausbilder, Freigabe
        autoTable(doc, {
            startY: yPos,
            head: [['Bewertungskriterium', 'Azubi', 'Ausbilder', 'Freigabe']],
            body: [
                ['Gesamtnote', report.selfRating || '-', report.trainerRating || '-', report.releaseRating || report.trainerRating || '-']
            ],
            theme: 'grid',
            headStyles: { fillColor: [70, 70, 70], textColor: 255, fontSize: 9 },
            bodyStyles: { fontSize: 9, fontStyle: 'bold' },
            margin: { left: 14, right: 14 },
        });

        // @ts-expect-error - jspdf-autotable extends jsPDF prototype
        yPos = doc.lastAutoTable?.finalY + 10;

        // Soft Skills Table - 3 columns: Azubi, Ausbilder, Freigabe
        if (report.softSkills && report.softSkills.length > 0) {
            const softSkillData = report.softSkills.map(s => [
                s.name,
                s.traineeRating || '-',
                s.trainerRating || '-',
                s.releaseRating || s.trainerRating || '-'
            ]);

            autoTable(doc, {
                startY: yPos,
                head: [['Soft Skills / Kompetenzbereich', 'Azubi', 'Ausbilder', 'Freigabe']],
                body: softSkillData,
                theme: 'striped',
                headStyles: { fillColor: [90, 90, 90], textColor: 255, fontSize: 8 },
                bodyStyles: { fontSize: 8 },
                margin: { left: 14, right: 14 },
            });
            // @ts-expect-error - jspdf-autotable extends jsPDF prototype
            yPos = doc.lastAutoTable?.finalY + 10;
        }
    }

    // --- COMMENTS SECTION (Trainer feedback only for Tätigkeitsnachweis) ---
    if (report.trainerComment) {
        // @ts-expect-error - jspdf-autotable extends jsPDF prototype
        yPos = Math.max(yPos, (doc.lastAutoTable?.finalY || yPos) + 10);

        // Ensure space
        if (yPos > 230) {
            doc.addPage();
            yPos = 20;
        }

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Anmerkungen des Ausbilders', 14, yPos);
        yPos += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        const splitComment = doc.splitTextToSize(report.trainerComment, 180);
        doc.text(splitComment, 14, yPos);
        yPos += (splitComment.length * 4) + 4;
    }

    // --- DIGITAL SIGNATURES SECTION ---
    // @ts-expect-error - jspdf-autotable extends jsPDF prototype
    finalY = Math.max(yPos, doc.lastAutoTable?.finalY + 20);
    yPos = finalY + 10;

    // Check if we need a new page
    if (yPos > 240) {
        doc.addPage();
        yPos = 30;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Digitale Unterschriften', 14, yPos);

    yPos += 10;
    doc.setFontSize(10);

    // Trainee signature box
    doc.setDrawColor(200, 200, 200);
    doc.rect(14, yPos, 85, 30);
    doc.setFont('helvetica', 'bold');
    doc.text('Auszubildende/r', 16, yPos + 6);
    doc.setFont('helvetica', 'normal');
    doc.text(report.traineeName || '-', 16, yPos + 14);
    doc.setFontSize(9);
    doc.text(`Unterschrieben am: ${formatDate(report.traineeSignedAt)}`, 16, yPos + 22);

    // Trainer signature box
    doc.rect(105, yPos, 85, 30);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Ausbilder/in', 107, yPos + 6);
    doc.setFont('helvetica', 'normal');
    // For approved reports, if signerName is missing, default to "Genehmigt" or similar
    const signer = report.reviewerName || (report.status === 'APPROVED' ? 'System (Genehmigt)' : 'Ausstehend');
    doc.text(signer, 107, yPos + 14);
    doc.setFontSize(9);
    doc.text(`Unterschrieben am: ${formatDate(report.trainerSignedAt)}`, 107, yPos + 22);

    // --- FOOTER ---
    yPos += 45;
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-DE')} | Dokument-ID: ${report.id.substring(0, 8)}`, 14, yPos);
    doc.text('Dieser Nachweis wurde digital erstellt und signiert.', 14, yPos + 5);

    // --- SAVE PDF OR RETURN BLOB ---
    const filename = `Tätigkeitsnachweis_KW${report.weekNumber}_${report.year}_${report.traineeName?.replace(/\s+/g, '_') || 'Unbekannt'}.pdf`;

    if (returnBlob) {
        return doc.output('blob');
    }

    doc.save(filename);
}
