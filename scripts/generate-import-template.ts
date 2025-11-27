import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate Excel template for bulk import of Courses, Enablers, and Use Cases
 */
function generateImportTemplate() {
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Courses
  const coursesData = [
    // Header row with descriptions
    ['Column Name', 'Required', 'Type', 'Description', 'Example'],
    ['title', 'YES', 'Text', 'Course/Chapter title', 'Kapitel 1: IT-Grundlagen'],
    ['description', 'NO', 'Text', 'Course description', 'Einführung in die IT-Grundlagen für FIAE'],
    ['year', 'NO', 'Number', 'Training year: 1, 2, or 3', '1'],
    ['chapter', 'NO', 'Number', 'Chapter number', '1'],
    ['is_active', 'NO', 'Boolean', 'Active status: TRUE or FALSE', 'TRUE'],
    ['is_published', 'NO', 'Boolean', 'Published status: TRUE or FALSE', 'TRUE'],
    [],
    ['=== DATA STARTS HERE - DELETE ROWS ABOVE ==='],
    [],
    // Header row for actual data
    ['title', 'description', 'year', 'chapter', 'is_active', 'is_published'],
    // Example data rows
    ['Kapitel 1: IT-Grundlagen', 'Einführung in die IT-Grundlagen und Netzwerktechnik', 1, 1, 'TRUE', 'TRUE'],
    ['Kapitel 2: Programmierung', 'Grundlagen der objektorientierten Programmierung', 1, 2, 'TRUE', 'FALSE'],
  ];

  const coursesSheet = XLSX.utils.aoa_to_sheet(coursesData);
  
  // Set column widths
  coursesSheet['!cols'] = [
    { wch: 30 }, // title
    { wch: 50 }, // description
    { wch: 8 },  // year
    { wch: 10 }, // chapter
    { wch: 12 }, // is_active
    { wch: 12 }, // is_published
  ];

  XLSX.utils.book_append_sheet(workbook, coursesSheet, 'Courses');

  // Sheet 2: Enablers
  const enablersData = [
    ['Column Name', 'Required', 'Type', 'Description', 'Example'],
    ['course_title', 'YES', 'Text', 'Parent course title (must match exactly)', 'Kapitel 1: IT-Grundlagen'],
    ['title', 'YES', 'Text', 'Enabler/Module title', 'Netzwerktopologien verstehen'],
    ['order_index', 'YES', 'Number', 'Display order (1, 2, 3...)', '1'],
    ['description_text', 'NO', 'Text', 'Module description/content', 'In diesem Modul lernen Sie verschiedene Netzwerktopologien kennen'],
    ['scenario_text', 'NO', 'Text', 'Scenario/task description', 'Sie arbeiten in einem Unternehmen und sollen ein Netzwerk aufbauen...'],
    ['hint_text', 'NO', 'Text', 'Hints for trainees', 'Denken Sie an das OSI-Modell'],
    ['ppt_url', 'NO', 'URL', 'Link to PowerPoint/PDF in Supabase Storage', 'https://storage.supabase.co/...'],
    ['video_url', 'NO', 'URL', 'Link to video (YouTube, Vimeo, etc.)', 'https://youtube.com/watch?v=...'],
    ['scenario_image_url', 'NO', 'URL', 'Link to scenario image', 'https://storage.supabase.co/...'],
    ['duration_value', 'NO', 'Number', 'Duration amount', '120'],
    ['duration_unit', 'NO', 'Text', 'DAYS or WEEKS', 'DAYS'],
    ['is_active', 'NO', 'Boolean', 'Active status: TRUE or FALSE', 'TRUE'],
    [],
    ['=== DATA STARTS HERE - DELETE ROWS ABOVE ==='],
    [],
    ['course_title', 'title', 'order_index', 'description_text', 'scenario_text', 'hint_text', 'ppt_url', 'video_url', 'scenario_image_url', 'duration_value', 'duration_unit', 'is_active'],
    ['Kapitel 1: IT-Grundlagen', 'Netzwerktopologien', 1, 'Lernen Sie verschiedene Netzwerktopologien kennen', 'Sie sollen ein Büro-Netzwerk planen', 'Beachten Sie Stern-, Bus- und Ring-Topologie', '', '', '', 5, 'DAYS', 'TRUE'],
    ['Kapitel 1: IT-Grundlagen', 'OSI-Modell', 2, 'Verstehen Sie die 7 Schichten des OSI-Modells', 'Analysieren Sie einen Datentransfer', 'Denken Sie an Application bis Physical Layer', '', '', '', 3, 'DAYS', 'TRUE'],
  ];

  const enablersSheet = XLSX.utils.aoa_to_sheet(enablersData);
  enablersSheet['!cols'] = [
    { wch: 30 }, // course_title
    { wch: 30 }, // title
    { wch: 12 }, // order_index
    { wch: 40 }, // description_text
    { wch: 40 }, // scenario_text
    { wch: 30 }, // hint_text
    { wch: 30 }, // ppt_url
    { wch: 30 }, // video_url
    { wch: 30 }, // scenario_image_url
    { wch: 15 }, // duration_value
    { wch: 15 }, // duration_unit
    { wch: 12 }, // is_active
  ];

  XLSX.utils.book_append_sheet(workbook, enablersSheet, 'Enablers');

  // Sheet 3: Use Cases
  const useCasesData = [
    ['Column Name', 'Required', 'Type', 'Description', 'Example'],
    ['course_title', 'YES', 'Text', 'Parent course title (must match exactly)', 'Kapitel 1: IT-Grundlagen'],
    ['title', 'YES', 'Text', 'Use case title', 'Netzwerk einrichten'],
    ['description_text', 'YES', 'Text', 'Use case description/instructions', 'Richten Sie ein kleines Firmennetzwerk mit 3 Arbeitsplätzen ein'],
    ['order_index', 'YES', 'Number', 'Display order (1, 2, 3...)', '1'],
    ['duration_value', 'NO', 'Number', 'Duration amount', '240'],
    ['duration_unit', 'NO', 'Text', 'DAYS or WEEKS', 'DAYS'],
    ['is_active', 'NO', 'Boolean', 'Active status: TRUE or FALSE', 'TRUE'],
    [],
    ['=== DATA STARTS HERE - DELETE ROWS ABOVE ==='],
    [],
    ['course_title', 'title', 'description_text', 'order_index', 'duration_value', 'duration_unit', 'is_active'],
    ['Kapitel 1: IT-Grundlagen', 'Netzwerk planen', 'Planen Sie ein Netzwerk für ein Büro mit 10 Mitarbeitern. Erstellen Sie eine Netzwerktopologie und wählen Sie geeignete Hardware.', 1, 14, 'DAYS', 'TRUE'],
    ['Kapitel 1: IT-Grundlagen', 'IP-Adressen vergeben', 'Vergeben Sie IP-Adressen für ein Netzwerk mit 3 Subnetzen. Dokumentieren Sie die Adressvergabe.', 2, 7, 'DAYS', 'TRUE'],
  ];

  const useCasesSheet = XLSX.utils.aoa_to_sheet(useCasesData);
  useCasesSheet['!cols'] = [
    { wch: 30 }, // course_title
    { wch: 30 }, // title
    { wch: 60 }, // description_text
    { wch: 12 }, // order_index
    { wch: 15 }, // duration_value
    { wch: 15 }, // duration_unit
    { wch: 12 }, // is_active
  ];

  XLSX.utils.book_append_sheet(workbook, useCasesSheet, 'Use Cases');

  // Sheet 4: Skills (Optional)
  const skillsData = [
    ['Column Name', 'Required', 'Type', 'Description', 'Example'],
    ['skill_name', 'YES', 'Text', 'Skill name (unique)', 'Netzwerkkonfiguration'],
    ['course_titles', 'NO', 'Text', 'Comma-separated course titles', 'Kapitel 1: IT-Grundlagen, Kapitel 2: Programmierung'],
    [],
    ['=== DATA STARTS HERE - DELETE ROWS ABOVE ==='],
    [],
    ['skill_name', 'course_titles'],
    ['Netzwerkkonfiguration', 'Kapitel 1: IT-Grundlagen'],
    ['IP-Adressierung', 'Kapitel 1: IT-Grundlagen'],
    ['Programmiergrundlagen', 'Kapitel 2: Programmierung'],
    ['Objektorientierung', 'Kapitel 2: Programmierung'],
  ];

  const skillsSheet = XLSX.utils.aoa_to_sheet(skillsData);
  skillsSheet['!cols'] = [
    { wch: 40 }, // skill_name
    { wch: 60 }, // course_titles
  ];

  XLSX.utils.book_append_sheet(workbook, skillsSheet, 'Skills');

  // Sheet 5: Instructions
  const instructionsData = [
    ['📋 BULK IMPORT TEMPLATE - INSTRUCTIONS'],
    [],
    ['HOW TO USE THIS TEMPLATE:'],
    [],
    ['1. Fill in the data in each sheet (Courses, Enablers, Use Cases, Skills)'],
    ['2. Delete the instruction rows (rows 1-9) before importing'],
    ['3. Keep the header row (the row with column names)'],
    ['4. Make sure required fields are filled'],
    ['5. Save the file and upload it in the trainer dashboard'],
    [],
    ['IMPORTANT RULES:'],
    [],
    ['✅ Course Title Matching:'],
    ['   - Enablers and Use Cases must reference existing course titles EXACTLY'],
    ['   - Example: "Kapitel 1: IT-Grundlagen" (case-sensitive, spaces matter)'],
    [],
    ['✅ Boolean Values:'],
    ['   - Use TRUE or FALSE (not true/false or 1/0)'],
    [],
    ['✅ Duration Units:'],
    ['   - Valid values: DAYS, WEEKS (all uppercase)'],
    [],
    ['✅ Order Index:'],
    ['   - Use sequential numbers: 1, 2, 3, 4...'],
    ['   - Determines display order in the UI'],
    [],
    ['✅ URLs:'],
    ['   - Must be full URLs starting with https://'],
    ['   - For Supabase Storage files, upload them first and copy the public URL'],
    [],
    ['IMPORT ORDER:'],
    [],
    ['The system will import in this order:'],
    ['1. Skills (if provided)'],
    ['2. Courses'],
    ['3. Enablers (linked to courses)'],
    ['4. Use Cases (linked to courses)'],
    [],
    ['ERROR HANDLING:'],
    [],
    ['If any row has an error:'],
    ['- The import will continue with other rows'],
    ['- You will receive a detailed error report'],
    ['- Fix the errors and re-upload only the failed rows'],
    [],
    ['TIPS:'],
    [],
    ['💡 Use Excel Data Validation for dropdowns (is_active, duration_unit, year)'],
    ['💡 Keep course titles consistent across all sheets'],
    ['💡 Start with a few rows to test, then add more data'],
    ['💡 Save a backup copy before uploading'],
    [],
    ['NEED HELP?'],
    ['Contact your system administrator or check the documentation.'],
  ];

  const instructionsSheet = XLSX.utils.aoa_to_sheet(instructionsData);
  instructionsSheet['!cols'] = [{ wch: 80 }];

  // Add instructions as first sheet
  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions', true);
  // Move it to the beginning
  const sheetNames = workbook.SheetNames;
  const instructionsIndex = sheetNames.indexOf('Instructions');
  if (instructionsIndex > 0) {
    sheetNames.splice(instructionsIndex, 1);
    sheetNames.unshift('Instructions');
  }

  // Save the workbook
  const outputDir = path.join(process.cwd(), 'public');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'bulk_import_template.xlsx');
  XLSX.writeFile(workbook, outputPath);

  console.log('✅ Excel template generated successfully!');
  console.log(`📁 File location: ${outputPath}`);
  console.log(`📊 Sheets: ${workbook.SheetNames.join(', ')}`);
}

// Run the generator
generateImportTemplate();
