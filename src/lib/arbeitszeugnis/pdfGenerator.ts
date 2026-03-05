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
      personalkompetenz: number | null;
    };
    overallAverage: number | null;
  };
}

// Professional color scheme
const COLORS = {
  primary: [33, 37, 41] as [number, number, number], // Dark charcoal for text
  secondary: [108, 117, 125] as [number, number, number], // Medium gray
  accent: [0, 123, 255] as [number, number, number], // Professional blue
  tableHeader: [220, 80, 60] as [number, number, number], // Coral/red for table headers
  tableBorder: [222, 226, 230] as [number, number, number], // Light border
  success: [40, 167, 69] as [number, number, number], // Green for good grades
  lightBg: [248, 249, 250] as [number, number, number], // Light background
  coral: [220, 80, 60] as [number, number, number], // Coral/red for table footers
};

const IHK_LEGEND = [
  ['1', 'Sehr gut', 'Die Anforderungen wurden in besonderem Maße erfüllt.'],
  ['2', 'Gut', 'Die Anforderungen wurden voll erfüllt.'],
  ['3', 'Befriedigend', 'Die Anforderungen wurden im Allgemeinen erfüllt.'],
  [
    '4',
    'Ausreichend',
    'Die Leistung weist Mängel auf, entspricht aber noch den Anforderungen.',
  ],
  [
    '5',
    'Mangelhaft',
    'Die Leistung entspricht nicht den Anforderungen, Grundkenntnisse sind vorhanden.',
  ],
  [
    '6',
    'Ungenügend',
    'Die Leistung entspricht nicht den Anforderungen, Grundkenntnisse fehlen.',
  ],
];

export async function generateArbeitszeugnisPDF(
  data: CertificateData
): Promise<Blob> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 25;
  const contentWidth = pageWidth - margin * 2;
  const footerHeight = 24; // Reserved space at bottom for footer
  const safeBottom = pageHeight - footerHeight; // Content must not go below this
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
      1: 'sehr gut',
      2: 'gut',
      3: 'befriedigend',
      4: 'ausreichend',
      5: 'mangelhaft',
      6: 'ungenügend',
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
      // Use a fixed aspect ratio fallback that works in both browser and Node.js
      let logoHeight = 15;
      const logoWidth = 50;

      // Try to get actual dimensions if Image API is available (browser)
      if (typeof globalThis.Image !== 'undefined') {
        try {
          const img = new Image();
          img.src = data.logoImage;
          await new Promise<void>(resolve => {
            if (img.complete) {
              resolve();
            } else {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }
          });
          if (img.height && img.width) {
            logoHeight = (img.height / img.width) * logoWidth;
          }
        } catch {
          // Keep default logoHeight
        }
      }

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
  doc.text('BETRIEBLICHE LEISTUNGSBURTEILUNG', pageWidth / 2, y, {
    align: 'center',
  });
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
  const pronoun =
    data.gender === 'male' ? 'Herr' : data.gender === 'female' ? 'Frau' : '';

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.primary);

  // Name Auszubildender
  doc.setFont('helvetica', 'normal');
  doc.text('Name Auszubildender: ' + data.traineeName, margin, y);
  y += 6;

  // Name Ausbilder
  doc.text('Name Ausbilder: Waleri Moretz', margin, y);
  y += 6;

  // Born on birth date
  const formattedBirthDate = data.traineeBirthDate
    ? formatDate(data.traineeBirthDate)
    : '[Geburtsdatum]';
  doc.text(`geboren am ${formattedBirthDate},`, margin, y);
  y += 15;

  // Training period
  doc.text(
    `war vom ${formatDate(data.startDate)} bis ${formatDate(data.endDate)}`,
    margin,
    y
  );
  y += 6;

  doc.text(
    `in unserem Unternehmen als Auszubildende${data.gender === 'male' ? 'r' : data.gender === 'female' ? '' : '(r)'} im Beruf`,
    margin,
    y
  );
  y += 12;

  // Profession highlight - centered and bold
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(data.izhkProfile, pageWidth / 2, y, { align: 'center' });
  y += 8;

  // tätig.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('tätig.', margin, y);
  y += 15;

  // -- PERFORMANCE GRADES TABLE --
  y = addSectionTitle('Betriebliche Leistungsbeurteilung', y);

  const tableBody = data.components.map((c, i) => [
    `${i + 1}. ${c.title}`,
    c.grade ? c.grade.toString() : '–',
    c.grade ? getGradeText(c.grade) : '–',
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
    margin: { left: margin, right: margin, bottom: footerHeight + 5 },
  });

  // @ts-expect-error - jspdf-autotable extends jsPDF prototype
  y = doc.lastAutoTable.finalY + 8;

  // -- OVERALL GRADE --
  doc.setFillColor(...COLORS.coral);
  doc.roundedRect(margin, y, contentWidth, 18, 2, 2, 'F');

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('Gesamtdurchschnitt:', margin + 5, y + 11);

  const avgText = `${data.averageGrade.toFixed(2)} – ${getGradeText(data.averageGrade)}`;
  doc.setTextColor(255, 255, 255);
  doc.text(avgText, pageWidth - margin - 5, y + 11, { align: 'right' });
  y += 25;

  // -- SOFT SKILLS TABLE (if available) --
  if (data.softSkills && data.softSkills.overallAverage !== null) {
    y = addSectionTitle('Kompetenzbewertung (Soft Skills)', y);

    const softSkillsBody = [
      [
        'Fachkompetenz',
        data.softSkills.averages.fachkompetenz?.toFixed(2) || '–',
      ],
      [
        'Methodenkompetenz',
        data.softSkills.averages.methodenkompetenz?.toFixed(2) || '–',
      ],
      [
        'Personalkompetenz',
        data.softSkills.averages.personalkompetenz?.toFixed(2) || '–',
      ],
    ];

    autoTable(doc, {
      startY: y,
      head: [['Kompetenzbereich', 'Durchschnittsnote']],
      body: softSkillsBody,
      foot: [
        [
          'Gesamtdurchschnitt Soft Skills',
          data.softSkills.overallAverage.toFixed(2),
        ],
      ],
      theme: 'grid',
      headStyles: {
        fillColor: COLORS.coral,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 10,
      },
      footStyles: {
        fillColor: COLORS.coral,
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
      margin: { left: margin, right: margin, bottom: footerHeight + 5 },
    });

    // @ts-expect-error - jspdf-autotable extends jsPDF prototype
    y = doc.lastAutoTable.finalY + 12;
  }

  // Check if we need a new page
  if (y > safeBottom - 60) {
    doc.addPage();
    y = 25;
  }

  // -- CLOSING SUMMARY --
  const pronounRef =
    data.gender === 'male'
      ? 'Er'
      : data.gender === 'female'
        ? 'Sie'
        : 'Die Person';
  const pronounPoss =
    data.gender === 'male'
      ? 'Seine'
      : data.gender === 'female'
        ? 'Ihre'
        : 'Die';
  const defaultSummary = `${pronounRef} hat die übertragenen Aufgaben stets zu unserer vollen Zufriedenheit erledigt. ${pronounPoss} Leistungen wurden insgesamt mit der Note ${data.averageGrade.toFixed(2)} (${getGradeText(data.averageGrade)}) bewertet. Wir danken für die angenehme Zusammenarbeit und wünschen für die berufliche und private Zukunft alles Gute.`;
  const summaryText = data.summary || defaultSummary;

  y = addSectionTitle('Abschließende Bemerkung', y);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.primary);

  const summaryLines = doc.splitTextToSize(summaryText, contentWidth);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 6 + 20;

  // -- SIGNATURE SECTION --
  // Ensure we have space for signature + QR verification + footer
  if (y > safeBottom - 75) {
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

  // -- QR CODE & VERIFICATION (placed after signature, above footer) --
  y += 15;

  // Ensure QR section fits above the footer
  if (y > safeBottom - 30) {
    doc.addPage();
    y = 25;
  }

  // ==================== ADD FOOTER TO ALL PAGES ====================
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Footer separator line
    drawHorizontalLine(pageHeight - footerHeight, COLORS.tableBorder);

    // Company info on the left
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.secondary);
    doc.text(
      'WAMOCON GmbH | IT-Testmanagement',
      margin,
      pageHeight - footerHeight + 5
    );
    doc.text(
      'Mergenthalerallee 79-81, 65760 Eschborn',
      margin,
      pageHeight - footerHeight + 9
    );
    doc.text(
      'www.wamocon.de | info@wamocon.de',
      margin,
      pageHeight - footerHeight + 13
    );

    // Page number on the right
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Seite ${i} von ${totalPages}`,
      pageWidth - margin,
      pageHeight - footerHeight + 9,
      { align: 'right' }
    );
  }

  return doc.output('blob');
}
