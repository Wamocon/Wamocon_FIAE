'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ReportEntry {
  useCaseId: string;
  plannedHours: number;
  actualHours: number;
  isOverbooked: boolean;
  notes: string | null;
  traineeGrade?: string | number | null;
  trainerGrade?: string | number | null;
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
  // Optional trainer comment for the week
  trainerComment?: string;
  // Soft skill ratings for the week
  softSkills?: {
    fachkompetenz: number | null;
    methodenkompetenz: number | null;
    personalkompetenz: number | null;
    overallAverage: number | null;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Professional color scheme – aligned with the Arbeitszeugnis PDF
// ──────────────────────────────────────────────────────────────────────────────
const COLORS = {
  primary: [33, 37, 41] as [number, number, number], // Dark charcoal
  secondary: [108, 117, 125] as [number, number, number], // Medium gray
  accent: [220, 80, 60] as [number, number, number], // WMC coral/red
  success: [40, 167, 69] as [number, number, number], // Signed green
  danger: [200, 30, 30] as [number, number, number], // Overbooked red
  warning: [200, 150, 0] as [number, number, number], // Pending amber
  muted: [128, 128, 128] as [number, number, number],
  lightGray: [222, 226, 230] as [number, number, number], // Borders
  lightBg: [248, 249, 250] as [number, number, number], // Alternating rows
  tableHeader: [220, 80, 60] as [number, number, number], // Coral header
  tableFoot: [248, 249, 250] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  black: [0, 0, 0] as [number, number, number],
  signedBg: [232, 245, 233] as [number, number, number],
  pendingBg: [255, 248, 225] as [number, number, number],
  overbookedBg: [255, 235, 235] as [number, number, number],
};

// Company & training constants
const COMPANY_NAME = 'WAMOCON GmbH';
const COMPANY_ADDRESS = 'Mergenthalerallee 79-81, 65760 Eschborn';
const AUSBILDUNGSBERUF = 'Fachinformatiker/-in';
const FACHRICHTUNG = 'Anwendungsentwicklung';
const AUSBILDUNGSBERUF_FULL = `${AUSBILDUNGSBERUF} – ${FACHRICHTUNG}`;

/**
 * Generates a simple hash for document verification
 */
function generateDocumentHash(report: ReportData): string {
  const hashInput = `${report.id}-${report.traineeId}-${report.weekNumber}-${report.year}-${report.entries.length}`;
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Generates a professional IHK-standard PDF for an activity report
 * (Wöchentlicher Ausbildungsnachweis / Tätigkeitsnachweis)
 *
 * Layout follows the IHK Frankfurt recommended format per BBiG §13 Nr. 7:
 *  – Company letterhead with WAMOCON logo
 *  – Structured metadata block (Azubi, Ausbilder, Beruf, Ausbildungsjahr, KW, Zeitraum)
 *  – Activity table with planned/actual hours
 *  – Trainer comment section
 *  – Bestätigungen (confirmations) section per BBiG § 13 Satz 2
 *  – Document verification footer with company address
 */
export async function generateActivityReportPDF(
  report: ReportData,
  useCases: TrainingUseCase[],
  components: TrainingComponent[],
  returnBlob: boolean = false
): Promise<Blob | void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;

  // ── Helpers ──────────────────────────────────────────────────────────────
  const getUseCaseById = (id: string) => useCases.find(uc => uc.id === id);
  const getComponentById = (id: string) => components.find(c => c.id === id);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const setColor = (color: [number, number, number]) => {
    doc.setTextColor(color[0], color[1], color[2]);
  };

  const drawLine = (y: number, color = COLORS.lightGray) => {
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
  };

  /** Draws a professional section heading with accent bar */
  const drawSectionHeading = (title: string, y: number): number => {
    const barHeight = 5.5;

    // Den roten Akzentbalken vertikal exakt auf der y-Achse zentrieren
    doc.setFillColor(COLORS.accent[0], COLORS.accent[1], COLORS.accent[2]);
    doc.rect(margin, y - barHeight / 2, 1.5, barHeight, 'F');

    // Den Text mit { baseline: 'middle' } ebenfalls perfekt auf y zentrieren
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    setColor(COLORS.primary);

    // margin + 4 sorgt für einen sauberen Abstand zwischen Balken und Text
    doc.text(title, margin + 4, y, { baseline: 'middle' });

    // y + 7 liefert den optimalen Abstand für das nachfolgende Element
    return y + 7;
  };

  const ensureSpace = (
    currentY: number,
    needed: number,
    resetY: number = 25
  ): number => {
    if (currentY + needed > pageHeight - 20) {
      doc.addPage();
      return resetY;
    }
    return currentY;
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  HEADER — Company letterhead with WAMOCON Logo
  // ══════════════════════════════════════════════════════════════════════════
  let yPos = 15;

  try {
    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      logoImg.onload = () => resolve();
      logoImg.onerror = () => reject(new Error('Logo not found'));
      logoImg.src = '/WMC_Logo.png';
    });
    const logoWidth = 50;
    const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
    doc.addImage(
      logoImg,
      'PNG',
      (pageWidth - logoWidth) / 2,
      yPos,
      logoWidth,
      logoHeight
    );
    yPos += logoHeight + 8;
  } catch {
    // Fallback: company name as text
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    setColor(COLORS.secondary);
    doc.text(COMPANY_NAME, pageWidth / 2, yPos + 8, { align: 'center' });
    yPos += 18;
  }

  // ── Document Title ──────────────────────────────────────────────────────
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  setColor(COLORS.primary);
  doc.text('AUSBILDUNGSNACHWEIS', pageWidth / 2, yPos, { align: 'center' });
  yPos += 6;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  setColor(COLORS.secondary);
  doc.text(
    'W\u00f6chentlicher Ausbildungsnachweis gem\u00e4\u00df \u00a7 13 BBiG',
    pageWidth / 2,
    yPos,
    { align: 'center' }
  );
  yPos += 6;

  drawLine(yPos, COLORS.accent);
  yPos += 8;

  // ══════════════════════════════════════════════════════════════════════════
  //  METADATA BLOCK — IHK-standard structured fields
  // ══════════════════════════════════════════════════════════════════════════
  const metaBoxY = yPos;
  const metaBoxHeight = 48;

  // Light background box for metadata
  doc.setFillColor(COLORS.lightBg[0], COLORS.lightBg[1], COLORS.lightBg[2]);
  doc.setDrawColor(
    COLORS.lightGray[0],
    COLORS.lightGray[1],
    COLORS.lightGray[2]
  );
  doc.roundedRect(margin, metaBoxY, contentWidth, metaBoxHeight, 2, 2, 'FD');

  const col1X = margin + 5; // Labels left column
  const col1ValX = margin + 48; // Values left column
  const col2X = pageWidth / 2 + 5; // Labels right column
  const col2ValX = pageWidth / 2 + 40; // Values right column

  doc.setFontSize(9);
  let metaY = metaBoxY + 8;

  // Row 1: Azubi Name | Ausbildungsberuf
  doc.setFont('helvetica', 'bold');
  setColor(COLORS.primary);
  doc.text('Auszubildende/r:', col1X, metaY);
  doc.setFont('helvetica', 'normal');
  doc.text(report.traineeName || 'Nicht angegeben', col1ValX, metaY);

  doc.setFont('helvetica', 'bold');
  doc.text('Ausbildungsberuf:', col2X, metaY);
  doc.setFont('helvetica', 'normal');
  doc.text(AUSBILDUNGSBERUF, col2ValX, metaY);
  metaY += 4;
  doc.setFontSize(7.5);
  setColor(COLORS.secondary);
  doc.text(FACHRICHTUNG, col2ValX, metaY);
  doc.setFontSize(9);
  setColor(COLORS.primary);
  metaY += 6;

  // Row 2: Ausbilder | Ausbildungsjahr
  doc.setFont('helvetica', 'bold');
  setColor(COLORS.primary);
  doc.text('Ausbilder/in:', col1X, metaY);
  doc.setFont('helvetica', 'normal');
  doc.text(report.reviewerName || 'Nicht zugewiesen', col1ValX, metaY);

  doc.setFont('helvetica', 'bold');
  doc.text('Ausbildungsjahr:', col2X, metaY);
  doc.setFont('helvetica', 'normal');
  doc.text(`${report.ausbildungsjahr}. Ausbildungsjahr`, col2ValX, metaY);
  metaY += 8;

  // Row 3: Ausbildungsbetrieb | Kalenderwoche
  doc.setFont('helvetica', 'bold');
  setColor(COLORS.primary);
  doc.text('Ausb.-Betrieb:', col1X, metaY);
  doc.setFont('helvetica', 'normal');
  doc.text(COMPANY_NAME, col1ValX, metaY);

  doc.setFont('helvetica', 'bold');
  doc.text('Kalenderwoche:', col2X, metaY);
  doc.setFont('helvetica', 'normal');
  doc.text(`KW ${report.weekNumber} / ${report.year}`, col2ValX, metaY);
  metaY += 8;

  // Row 4: Berichtszeitraum (full width)
  doc.setFont('helvetica', 'bold');
  setColor(COLORS.primary);
  doc.text('Berichtszeitraum:', col1X, metaY);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `${formatDate(report.periodStart)}  –  ${formatDate(report.periodEnd)}`,
    col1ValX,
    metaY
  );

  // Status badge on the right side of row 4
  let statusText: string;
  let statusColor: [number, number, number];
  switch (report.status) {
    case 'APPROVED':
      statusText = 'Genehmigt';
      statusColor = COLORS.success;
      break;
    case 'REJECTED':
      statusText = 'Abgelehnt';
      statusColor = COLORS.danger;
      break;
    case 'REVISION_NEEDED':
      statusText = 'Überarbeitung erforderlich';
      statusColor = COLORS.warning;
      break;
    case 'SUBMITTED':
      statusText = 'Eingereicht';
      statusColor = [0, 100, 180] as [number, number, number];
      break;
    case 'DRAFT':
      statusText = 'Entwurf';
      statusColor = COLORS.muted;
      break;
    default:
      statusText = report.status;
      statusColor = COLORS.muted;
  }

  doc.setFont('helvetica', 'bold');
  doc.text('Status:', col2X, metaY);
  doc.setFont('helvetica', 'normal');
  const badgeX = col2ValX;
  const badgeText = statusText;
  const badgeW = doc.getTextWidth(badgeText) + 6;
  doc.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
  doc.roundedRect(badgeX - 1, metaY - 3.2, badgeW, 4.8, 1.2, 1.2, 'F');
  setColor(COLORS.white);
  doc.setFontSize(8);
  doc.text(badgeText, badgeX + 2, metaY);
  doc.setFontSize(9);

  yPos = metaBoxY + metaBoxHeight + 14;

  // ══════════════════════════════════════════════════════════════════════════
  //  ACTIVITY TABLE — Use cases with Planned / Actual hours
  // ══════════════════════════════════════════════════════════════════════════
  yPos = drawSectionHeading('Ausgef\u00fchrte T\u00e4tigkeiten', yPos);
  yPos += 2;

  // Grade helper
  const gradeText = (grade: string | number | null | undefined): string => {
    if (grade == null) return '–';
    const n = Number(grade);
    if (isNaN(n)) return '–';
    const labels: Record<number, string> = {
      1: 'sehr gut',
      2: 'gut',
      3: 'befriedigend',
      4: 'ausreichend',
      5: 'mangelhaft',
      6: 'ungen\u00fcgend',
    };
    return labels[Math.round(n)] || '–';
  };

  const tableHead = [
    [
      { content: 'Komp.', rowSpan: 2 },
      { content: 'Themenkreise', rowSpan: 2 },
      { content: 'IST (Std)', rowSpan: 2 },
      { content: 'Bewertung', colSpan: 2 },
    ],
    ['Auszubildende/r', 'Ausbilder/in'],
  ];

  const overbookedRows: number[] = [];

  const tableData = report.entries.map((entry, index) => {
    const useCase = getUseCaseById(entry.useCaseId);
    const component = useCase ? getComponentById(useCase.componentId) : null;

    if (entry.isOverbooked) {
      overbookedRows.push(index);
    }

    return [
      component?.code || '-',
      `${useCase?.letter || '-'}) ${useCase?.description || 'Unbekannt'}`,
      `${entry.actualHours}`,
      gradeText(entry.traineeGrade),
      gradeText(entry.trainerGrade),
    ];
  });

  const totalActual = report.entries.reduce((sum, e) => sum + e.actualHours, 0);
  const MAX_WEEKLY_HOURS = 40;
  const exceeds40h = totalActual > MAX_WEEKLY_HOURS;

  const avgTraineeGrade =
    report.entries.length > 0
      ? report.entries.reduce(
          (sum, e) => sum + (Number(e.traineeGrade) || 0),
          0
        ) / report.entries.length
      : 0;

  const avgTrainerGrade =
    report.entries.length > 0
      ? report.entries.reduce(
          (sum, e) => sum + (Number(e.trainerGrade) || 0),
          0
        ) / report.entries.length
      : 0;

  const tableFoot = [
    [
      {
        content: `Gesamt max. ${MAX_WEEKLY_HOURS} Std./Woche:`,
        colSpan: 2,
        styles: { halign: 'left' as const },
      },
      { content: `${totalActual}`, styles: { halign: 'center' as const } },
      {
        content: gradeText(avgTraineeGrade),
        styles: { halign: 'center' as const },
      },
      {
        content: gradeText(avgTrainerGrade),
        styles: { halign: 'center' as const },
      },
    ],
  ];

  autoTable(doc, {
    startY: yPos,
    head: tableHead,
    body: tableData,
    foot: tableFoot,
    theme: 'grid',
    headStyles: {
      fillColor: COLORS.tableHeader,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: 3,
      halign: 'center' as const,
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: COLORS.primary,
    },
    footStyles: {
      fillColor: COLORS.accent,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: 3,
    },
    alternateRowStyles: {
      fillColor: COLORS.lightBg,
    },
    columnStyles: {
      0: {
        cellWidth: 18,
        halign: 'center' as const,
        fontStyle: 'bold' as const,
      },
      1: { cellWidth: 'auto' as const },
      2: { cellWidth: 22, halign: 'center' as const },
      3: { cellWidth: 30, halign: 'center' as const },
      4: { cellWidth: 30, halign: 'center' as const },
    },
    margin: { left: margin, right: margin },
    didParseCell: data => {
      if (
        data.section === 'body' &&
        data.column.index === 2 &&
        overbookedRows.includes(data.row.index)
      ) {
        data.cell.styles.textColor = COLORS.danger;
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.section === 'foot' && data.column.index === 2 && exceeds40h) {
        data.cell.styles.textColor = [255, 100, 100];
        data.cell.styles.fontStyle = 'bold';
      }
    },
    willDrawCell: data => {
      if (data.section === 'body' && overbookedRows.includes(data.row.index)) {
        doc.setFillColor(
          COLORS.overbookedBg[0],
          COLORS.overbookedBg[1],
          COLORS.overbookedBg[2]
        );
        doc.rect(
          data.cell.x,
          data.cell.y,
          data.cell.width,
          data.cell.height,
          'F'
        );
      }
    },
  });

  // @ts-expect-error - jspdf-autotable extends jsPDF prototype
  let finalY = doc.lastAutoTable?.finalY || yPos + 50;
  yPos = finalY + 8;

  // Hours summary
  if (exceeds40h) {
    doc.setFontSize(7.5);
    setColor(COLORS.danger);
    doc.setFont('helvetica', 'bold');
    doc.text(
      `Achtung: ${totalActual} Std. \u2013 vertragliche Wochenarbeitszeit von ${MAX_WEEKLY_HOURS} Std. \u00fcberschritten`,
      margin,
      yPos
    );
    setColor(COLORS.primary);
    yPos += 4;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SKILLS TABLE — Competency areas with constant sub-skills
  // ══════════════════════════════════════════════════════════════════════════
  if (report.softSkills) {
    yPos = ensureSpace(yPos, 40);
    yPos = drawSectionHeading('Skills', yPos);
    yPos += 2;

    const skillsBody = [
      [
        'Fachkompetenz (Sorgfalt, Qualit\u00e4tsbewusstsein)',
        report.softSkills.fachkompetenz != null
          ? gradeText(report.softSkills.fachkompetenz)
          : '\u2013',
      ],
      [
        'Methodenkompetenz (Probleml\u00f6sung, Zeitmanagement, Analytisches Denken)',
        report.softSkills.methodenkompetenz != null
          ? gradeText(report.softSkills.methodenkompetenz)
          : '\u2013',
      ],
      [
        'Personalkompetenz (Zuverl\u00e4ssigkeit, Selbstst\u00e4ndigkeit, Lernbereitschaft)',
        report.softSkills.personalkompetenz != null
          ? gradeText(report.softSkills.personalkompetenz)
          : '\u2013',
      ],
    ];

    const skillsFoot =
      report.softSkills.overallAverage != null
        ? [
            [
              {
                content: 'Gesamtdurchschnitt:',
                styles: { halign: 'left' as const },
              },
              gradeText(report.softSkills.overallAverage),
            ],
          ]
        : [];

    autoTable(doc, {
      startY: yPos,
      head: [['Kompetenzbereich', 'Bewertung']],
      body: skillsBody,
      foot: skillsFoot,
      theme: 'grid',
      styles: {
        lineColor: COLORS.lightGray,
        lineWidth: 0.4,
      },
      headStyles: {
        fillColor: COLORS.tableHeader,
        textColor: COLORS.white,
        fontStyle: 'bold',
        fontSize: 8,
        cellPadding: 3,
        lineColor: COLORS.tableHeader,
        halign: 'center' as const,
      },
      bodyStyles: {
        fontSize: 8,
        cellPadding: 2.5,
        textColor: COLORS.primary,
      },
      footStyles: {
        fillColor: COLORS.accent,
        textColor: COLORS.white,
        fontStyle: 'bold',
        fontSize: 8,
        cellPadding: 3,
        halign: 'center' as const,
        lineColor: COLORS.accent,
      },
      alternateRowStyles: {
        fillColor: COLORS.lightBg,
      },
      columnStyles: {
        0: { cellWidth: 'auto' as const },
        1: {
          cellWidth: 35,
          halign: 'center' as const,
          fontStyle: 'bold' as const,
        },
      },
      margin: { left: margin, right: margin },
    });

    // @ts-expect-error - jspdf-autotable extends jsPDF prototype
    yPos = doc.lastAutoTable?.finalY + 8 || yPos + 40;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TRAINER COMMENT SECTION
  // ══════════════════════════════════════════════════════════════════════════
  const effectiveComment = report.trainerComment || '';
  if (effectiveComment) {
    yPos = ensureSpace(yPos, 30);
    yPos = drawSectionHeading('Anmerkungen des Ausbilders', yPos);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    const splitComment = doc.splitTextToSize(
      effectiveComment,
      contentWidth - 10
    );
    const commentBoxH = splitComment.length * 4.5 + 8;

    doc.setFillColor(COLORS.lightBg[0], COLORS.lightBg[1], COLORS.lightBg[2]);
    doc.setDrawColor(
      COLORS.lightGray[0],
      COLORS.lightGray[1],
      COLORS.lightGray[2]
    );
    doc.roundedRect(margin, yPos - 3, contentWidth, commentBoxH, 2, 2, 'FD');

    setColor(COLORS.primary);
    doc.text(splitComment, margin + 5, yPos + 2);
    yPos += commentBoxH + 4;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DIGITAL CONFIRMATIONS — Bestätigungen gemäß BBiG § 13
  // ══════════════════════════════════════════════════════════════════════════
  yPos += 4;
  yPos = ensureSpace(yPos, 55);

  yPos = drawSectionHeading('Best\u00e4tigungen', yPos);
  yPos += 2;

  const sigBoxWidth = (contentWidth - 10) / 2;
  const sigBoxHeight = 32;
  const traineeSigned = !!report.traineeSignedAt;
  const trainerSigned = !!report.trainerSignedAt;

  // ── Trainee signature box ────────────────────────────────────────────
  const traineeBoxX = margin;
  doc.setFillColor(...(traineeSigned ? COLORS.signedBg : COLORS.pendingBg));
  doc.setDrawColor(
    COLORS.lightGray[0],
    COLORS.lightGray[1],
    COLORS.lightGray[2]
  );
  doc.roundedRect(traineeBoxX, yPos, sigBoxWidth, sigBoxHeight, 2, 2, 'FD');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  setColor(COLORS.primary);
  doc.text('Auszubildende/r', traineeBoxX + 5, yPos + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(report.traineeName || '-', traineeBoxX + 5, yPos + 13);

  // Signature line
  doc.setDrawColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
  doc.setLineWidth(0.3);
  doc.line(
    traineeBoxX + 5,
    yPos + 20,
    traineeBoxX + sigBoxWidth - 5,
    yPos + 20
  );

  doc.setFontSize(7);
  if (traineeSigned) {
    setColor(COLORS.success);
    doc.setFont('helvetica', 'bold');
    doc.text(
      `Bestätigt am: ${formatDate(report.traineeSignedAt)}`,
      traineeBoxX + 5,
      yPos + 26
    );
  } else {
    setColor(COLORS.warning);
    doc.setFont('helvetica', 'italic');
    doc.text('Best\u00e4tigung ausstehend', traineeBoxX + 5, yPos + 26);
  }

  // ── Trainer signature box ────────────────────────────────────────────
  const trainerBoxX = margin + sigBoxWidth + 10;
  doc.setFillColor(...(trainerSigned ? COLORS.signedBg : COLORS.pendingBg));
  doc.setDrawColor(
    COLORS.lightGray[0],
    COLORS.lightGray[1],
    COLORS.lightGray[2]
  );
  doc.roundedRect(trainerBoxX, yPos, sigBoxWidth, sigBoxHeight, 2, 2, 'FD');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  setColor(COLORS.primary);
  doc.text('Ausbilder/in', trainerBoxX + 5, yPos + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(report.reviewerName || 'Ausstehend', trainerBoxX + 5, yPos + 13);

  // Signature line
  doc.setDrawColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
  doc.setLineWidth(0.3);
  doc.line(
    trainerBoxX + 5,
    yPos + 20,
    trainerBoxX + sigBoxWidth - 5,
    yPos + 20
  );

  doc.setFontSize(7);
  if (trainerSigned) {
    setColor(COLORS.success);
    doc.setFont('helvetica', 'bold');
    doc.text(
      `Bestätigt am: ${formatDate(report.trainerSignedAt)}`,
      trainerBoxX + 5,
      yPos + 26
    );
  } else {
    setColor(COLORS.warning);
    doc.setFont('helvetica', 'italic');
    doc.text('Best\u00e4tigung ausstehend', trainerBoxX + 5, yPos + 26);
  }

  yPos += sigBoxHeight + 10;

  // ══════════════════════════════════════════════════════════════════════════
  //  DOCUMENT VERIFICATION FOOTER
  // ══════════════════════════════════════════════════════════════════════════

  drawLine(yPos, COLORS.lightGray);
  yPos += 5;

  const docHash = generateDocumentHash(report);
  const azubiStatus = traineeSigned ? 'Ja' : 'Nein';
  const trainerStatus = trainerSigned ? 'Ja' : 'Nein';

  // Professional verification paragraph
  doc.setFontSize(6.5);
  setColor(COLORS.secondary);
  doc.setFont('helvetica', 'normal');
  const verificationText =
    `Dieser Ausbildungsnachweis wurde elektronisch erstellt und best\u00e4tigt. ` +
    `Er dient als w\u00f6chentlicher Ausbildungsnachweis gem\u00e4\u00df \u00a7 13 BBiG und dokumentiert die durchgef\u00fchrten ` +
    `Ausbildungsinhalte im Rahmen der betrieblichen Berufsausbildung bei ${COMPANY_NAME}.`;
  const splitVerification = doc.splitTextToSize(verificationText, contentWidth);
  doc.text(splitVerification, margin, yPos);
  yPos += splitVerification.length * 3 + 2;

  // Document reference line
  doc.setFontSize(5.5);
  setColor(COLORS.muted);
  doc.text(
    `Dok. ${report.id.substring(0, 8)}  |  ${docHash}  |  ${new Date().toLocaleDateString('de-DE')}  |  Azubi: ${azubiStatus}  |  Ausbilder: ${trainerStatus}`,
    margin,
    yPos
  );

  // ── Watermark for non-approved documents ─────────────────────────────
  const watermarkText =
    report.status === 'DRAFT'
      ? 'ENTWURF'
      : report.status === 'SUBMITTED'
        ? 'EINGEREICHT'
        : report.status === 'REJECTED'
          ? 'ABGELEHNT'
          : null;

  // ── Page numbers ─────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Watermark (diagonal, semi-transparent)
    if (watermarkText) {
      doc.saveGraphicsState();
      // @ts-expect-error - jsPDF GState for opacity
      doc.setGState(new doc.GState({ opacity: 0.06 }));
      doc.setFontSize(72);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(150, 150, 150);
      // Rotate and center the watermark
      const centerX = pageWidth / 2;
      const centerY = pageHeight / 2;
      doc.text(watermarkText, centerX, centerY, {
        align: 'center',
        angle: 45,
      });
      doc.restoreGraphicsState();
    }

    // ── Professional page footer with address ──────────────────────
    const footerY = pageHeight - 12;

    // Thin accent line above footer
    doc.setDrawColor(COLORS.accent[0], COLORS.accent[1], COLORS.accent[2]);
    doc.setLineWidth(0.4);
    doc.line(margin, footerY - 2, pageWidth - margin, footerY - 2);

    // Left: Company name + address
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    setColor(COLORS.secondary);
    doc.text(`${COMPANY_NAME}  |  ${COMPANY_ADDRESS}`, margin, footerY + 2);

    // Right: Page number
    doc.text(`Seite ${i} / ${totalPages}`, pageWidth - margin, footerY + 2, {
      align: 'right',
    });
  }

  // ── Save / Return ────────────────────────────────────────────────────
  const filename = `Ausbildungsnachweis_KW${report.weekNumber}_${report.year}_${report.traineeName?.replace(/\s+/g, '_') || 'Unbekannt'}.pdf`;

  if (returnBlob) {
    return doc.output('blob');
  }

  doc.save(filename);
}
