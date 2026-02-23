/**
 * Upload Szenarien PDFs to Supabase Storage & create content_document records.
 *
 * Usage:
 *   node scripts/upload-szenarien.mjs --env qa --dry-run     # Verify mapping only
 *   node scripts/upload-szenarien.mjs --env qa               # Upload to QA
 *   node scripts/upload-szenarien.mjs --env production        # Upload to Production
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// ─── Configuration ─────────────────────────────────────────────────────────────
const ENVS = {
  qa: {
    url: 'https://thzssnabxgchzbsnbgoh.supabase.co',
    serviceKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoenNzbmFieGdjaHpic25iZ29oIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQ5MDE5NCwiZXhwIjoyMDgyMDY2MTk0fQ.DEp7REslGk-iX15Mt_5i6cAxOB76b8pqBlQhx-OzGgA',
  },
  production: {
    url: 'https://ngpsgwwlnlliphfgtrya.supabase.co',
    serviceKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ncHNnd3dsbmxsaXBoZmd0cnlhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM0OTIwMCwiZXhwIjoyMDc3OTI1MjAwfQ.B8kLXUizUPUSSWno74HjyvqtX764v6xp81K-MdDd3ZM',
  },
};

const SZENARIEN_BASE = path.join('D:', 'FIAE UI', 'Wamocon_FIAE', 'Szenarien');
const STORAGE_BUCKET = 'content';

// Folders that contain scenario PDFs (case-insensitive match)
const SCENARIO_FOLDER_NAMES = ['szenario parts', 'szenarien parts', 'szenarien'];

// ─── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const envArg = args.includes('--env') ? args[args.indexOf('--env') + 1] : null;
const dryRun = args.includes('--dry-run');

if (!envArg || !ENVS[envArg]) {
  console.error('Usage: node scripts/upload-szenarien.mjs --env <qa|production> [--dry-run]');
  process.exit(1);
}

const config = ENVS[envArg];
const supabase = createClient(config.url, config.serviceKey);

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize text for comparison: lowercase, collapse whitespace, strip special chars, handle German chars */
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/[_\-,.\(\)§]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Additional normalization that also handles common OCR/typo issues */
function normalizeAggressive(text) {
  return normalize(text)
    .replace(/ii/g, 'ae')       // Qualitiitssicherung → Qualitaetssicherung
    .replace(/b(?=nahmen)/g, 'ss') // MaBnahmen → Massnahmen (OCR error for ß)
    .replace(/ck/g, 'k')        // Lerntechnicken → Lerntechniken
    .replace(/\s*\(vertiefung\)/g, '') // strip "(Vertiefung)" suffix
    .trim();
}

// Manual overrides for known folder-to-DB mismatches
const MANUAL_OVERRIDES = {
  // K17: folder "TOM" abbreviation vs full DB title
  'wirksamkeit und effizienz der umgesetzten tom pruefen':
    'Wirksamkeit und Effizienz der umgesetzten Technisch Organisatorischen Maßnahmen (TOM) zur IT-Sicherheit und zum Datenschutz prüfen',
};

/** Strip numeric prefix from folder names: "01_01_Name" → "Name", "01_Name" → "Name" */
function stripPrefix(name) {
  // Patterns: "01_01_xxx", "01_xxx", "01 xxx"
  return name.replace(/^\d+[_ ]\d+[_ ]/, '').replace(/^\d+[_ ]/, '').trim();
}

/** Find the "Szenario parts" folder inside an enabler folder */
function findScenarioFolder(enablerPath) {
  const entries = fs.readdirSync(enablerPath);
  for (const entry of entries) {
    const full = path.join(enablerPath, entry);
    if (fs.statSync(full).isDirectory()) {
      if (SCENARIO_FOLDER_NAMES.includes(entry.toLowerCase())) {
        return full;
      }
    }
  }
  return null;
}

/** Sanitize a filename for use as a Supabase Storage key (no special chars) */
function sanitizeStorageName(name) {
  return name
    .replace(/ä/g, 'ae').replace(/Ä/g, 'Ae')
    .replace(/ö/g, 'oe').replace(/Ö/g, 'Oe')
    .replace(/ü/g, 'ue').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^\w\-. ()]/g, '_') // replace remaining special chars with underscore
    .replace(/_+/g, '_');         // collapse multiple underscores
}

/** Get all PDF files from a directory */
function getPdfFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort()
    .map((f) => ({
      name: f,
      safeName: sanitizeStorageName(f),
      fullPath: path.join(dirPath, f),
      size: fs.statSync(path.join(dirPath, f)).size,
    }));
}

/** Extract K-number from folder name: "K01_ Planen..." → "K01" */
function extractKNumber(folderName) {
  const match = folderName.match(/^(K\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

// ─── Step 1: Scan folder structure ─────────────────────────────────────────────
function scanFolders() {
  const results = [];
  const kDirs = fs
    .readdirSync(SZENARIEN_BASE)
    .filter((d) => fs.statSync(path.join(SZENARIEN_BASE, d)).isDirectory())
    .sort();

  for (const kDir of kDirs) {
    const kNumber = extractKNumber(kDir);
    if (!kNumber) continue;

    const kPath = path.join(SZENARIEN_BASE, kDir);
    const enablerDirs = fs
      .readdirSync(kPath)
      .filter((d) => fs.statSync(path.join(kPath, d)).isDirectory())
      .sort();

    for (const enablerDir of enablerDirs) {
      const enablerPath = path.join(kPath, enablerDir);
      const scenarioFolder = findScenarioFolder(enablerPath);

      // Try scenario subfolder first, then fall back to PDFs directly in enabler folder
      const pdfs = scenarioFolder ? getPdfFiles(scenarioFolder) : getPdfFiles(enablerPath);
      if (pdfs.length === 0) continue;

      const enablerName = stripPrefix(enablerDir);

      results.push({
        kNumber,
        kFolder: kDir,
        enablerFolder: enablerDir,
        enablerName,
        enablerNameNorm: normalize(enablerName),
        pdfs,
      });
    }
  }

  return results;
}

// ─── Step 2: Query DB for all enablers ─────────────────────────────────────────
async function fetchEnablers() {
  const { data, error } = await supabase
    .from('enablers')
    .select('id, title, course_id, courses(id, title)')
    .order('title');

  if (error) {
    console.error('Failed to fetch enablers:', error);
    process.exit(1);
  }
  return data;
}

async function fetchCourses() {
  const { data, error } = await supabase.from('courses').select('id, title').order('title');
  if (error) {
    console.error('Failed to fetch courses:', error);
    process.exit(1);
  }
  return data;
}

// ─── Step 3: Build K-folder → Course mapping ──────────────────────────────────
function buildKToCourseMap(courses) {
  // Map K-numbers to course IDs based on the paragraph references in course titles
  const map = {};
  const kPatterns = {
    K01: /planen.*vorbereiten.*durchf.*hren.*arbeitsaufgaben.*abs.*2.*nr.*1/i,
    K02: /informieren.*beraten.*kunden.*abs.*2.*nr.*2(?!.*vertiefung)(?!.*j2)/i,
    K03: /beurteilen.*marktg.*ngig.*it.*system.*abs.*2.*nr.*3(?!.*j2)/i,
    K04: /entwickeln.*erstellen.*betreuen.*it.*l.*sung.*abs.*2.*nr.*4(?!.*j2)/i,
    K05: /durchf.*hren.*qualit.*tssichernd.*ma.*nahmen.*abs.*2.*nr.*5(?!.*j2)/i,
    K06: /ma.*nahmen.*it.*sicherheit.*datenschutz.*abs.*2.*nr.*6(?!.*j2)/i,
    K07: /erbringen.*leistung.*auftragsabschluss.*abs.*2.*nr.*7/i,
    K08: /betreiben.*it.*system.*abs.*2.*nr.*8(?!.*j2)/i,
    K09: /programmieren.*softwarel.*sung.*abs.*2.*nr.*10(?!.*j2)/i,
    K10: /konzipieren.*umsetzen.*softwareanwendung.*abs.*3.*nr.*1(?!.*j2)/i,
    K11: /sicherstellen.*qualit.*t.*softwareanwendung.*abs.*3.*nr.*2/i,
    K12: /vernetzt.*zusammenarbeit.*abs.*7.*nr.*5/i,
    // J2 / Vertiefung courses
    K14: /beurteilen.*marktg.*ngig.*it.*system.*vertiefung.*j2/i,
    K15: /entwickeln.*it.*l.*sung.*vertiefung.*j2/i,
    K16: /durchf.*hren.*qs.*ma.*nahmen.*vertiefung.*j2/i,
    K17: /it.*sicherheit.*datenschutz.*vertiefung.*j2/i,
    K18: /betreiben.*it.*system.*vertiefung.*j2/i,
    K19: /inbetriebnehmen.*speicherl.*sung.*abs.*2.*nr.*9/i,
    K20: /programmieren.*softwarel.*sung.*vertiefung.*j2/i,
    K21: /konzipieren.*softwareanwendung.*vertiefung.*j2/i,
    K23: /berufsbildung.*arbeits.*tarifrecht.*abs.*7.*nr.*1/i,
    K24: /aufbau.*organisation.*ausbildungsbetrieb.*abs.*7.*nr.*2/i,
    K25: /sicherheit.*gesundheitsschutz.*arbeit.*abs.*7.*nr.*3/i,
    K26: /umweltschutz.*abs.*7.*nr.*4/i,
  };

  for (const course of courses) {
    for (const [k, pattern] of Object.entries(kPatterns)) {
      if (pattern.test(course.title)) {
        const isVertiefung = /vertiefung|j2/i.test(course.title);
        const isVertiefungKey = parseInt(k.slice(1)) >= 13 && parseInt(k.slice(1)) <= 22;
        // For base K-numbers (K01-K12, K23-K26), prefer non-Vertiefung
        // For Vertiefung K-numbers (K13-K22), prefer Vertiefung
        if (!map[k]) {
          map[k] = course.id;
        } else if (isVertiefungKey === isVertiefung) {
          map[k] = course.id; // Better match: Vertiefung key → Vertiefung course
        }
        break;
      }
    }
  }

  return map;
}

// ─── Step 4: Match folders to enablers ─────────────────────────────────────────
function matchFoldersToEnablers(folderData, dbEnablers, kToCourse) {
  const matched = [];
  const unmatched = [];

  for (const folder of folderData) {
    const courseId = kToCourse[folder.kNumber];
    if (!courseId) {
      unmatched.push({
        ...folder,
        reason: `No course mapping for ${folder.kNumber}`,
      });
      continue;
    }

    // Get enablers for this course
    const courseEnablers = dbEnablers.filter((e) => e.course_id === courseId);

    // Check manual overrides first
    const folderNormAgg = normalizeAggressive(folder.enablerName);
    let manualMatch = null;
    for (const [overrideKey, dbTitle] of Object.entries(MANUAL_OVERRIDES)) {
      if (normalizeAggressive(overrideKey) === folderNormAgg ||
          normalize(overrideKey) === normalize(folder.enablerName)) {
        manualMatch = courseEnablers.find(e => e.title === dbTitle);
        break;
      }
    }

    if (manualMatch) {
      matched.push({
        ...folder,
        enablerId: manualMatch.id,
        enablerDbTitle: manualMatch.title,
        courseId,
        matchScore: 1.0,
        matchType: 'manual',
      });
      continue;
    }

    // Try to match folder enabler name to DB enabler title
    let bestMatch = null;
    let bestScore = 0;

    for (const dbEnabler of courseEnablers) {
      const dbNorm = normalize(dbEnabler.title);
      const folderNorm = folder.enablerNameNorm;

      // Exact normalized match
      if (dbNorm === folderNorm) {
        bestMatch = dbEnabler;
        bestScore = 1.0;
        break;
      }

      // Aggressive normalization match (handles typos, ß/B, ä/ii etc.)
      const dbAgg = normalizeAggressive(dbEnabler.title);
      if (dbAgg === folderNormAgg) {
        bestMatch = dbEnabler;
        bestScore = 0.95;
        break;
      }

      // Spaceless comparison (handles "ZielgerichteteMethoden" vs "Zielgerichtete Methoden")
      if (dbNorm.replace(/\s/g, '') === folderNorm.replace(/\s/g, '')) {
        bestMatch = dbEnabler;
        bestScore = 0.95;
        break;
      }

      // One contains the other
      if (dbNorm.includes(folderNorm) || folderNorm.includes(dbNorm)) {
        const score = Math.min(dbNorm.length, folderNorm.length) / Math.max(dbNorm.length, folderNorm.length);
        if (score > bestScore) {
          bestMatch = dbEnabler;
          bestScore = score;
        }
      }

      // Aggressive containment
      if (dbAgg.includes(folderNormAgg) || folderNormAgg.includes(dbAgg)) {
        const score = Math.min(dbAgg.length, folderNormAgg.length) / Math.max(dbAgg.length, folderNormAgg.length);
        if (score > bestScore) {
          bestMatch = dbEnabler;
          bestScore = Math.max(score, 0.85);
        }
      }

      // Significant overlap (first N words match)
      const dbWords = dbNorm.split(' ').filter(Boolean);
      const folderWords = folderNorm.split(' ').filter(Boolean);
      let matchingWords = 0;
      for (let i = 0; i < Math.min(dbWords.length, folderWords.length); i++) {
        if (dbWords[i] === folderWords[i]) matchingWords++;
        else break;
      }
      if (matchingWords >= 3) {
        const score = matchingWords / Math.max(dbWords.length, folderWords.length);
        if (score > bestScore) {
          bestMatch = dbEnabler;
          bestScore = score;
        }
      }
    }

    if (bestMatch && bestScore >= 0.4) {
      matched.push({
        ...folder,
        enablerId: bestMatch.id,
        enablerDbTitle: bestMatch.title,
        courseId,
        matchScore: bestScore,
      });
    } else {
      unmatched.push({
        ...folder,
        reason: `No matching enabler found (best score: ${bestScore.toFixed(2)})`,
        courseId,
      });
    }
  }

  return { matched, unmatched };
}

// ─── Step 5: Upload PDFs & insert records ──────────────────────────────────────
async function uploadAndInsert(matched) {
  let uploaded = 0;
  let skipped = 0;
  let errors = 0;
  const total = matched.reduce((sum, m) => sum + m.pdfs.length, 0);

  for (const entry of matched) {
    console.log(`\n📁 Enabler: ${entry.enablerDbTitle} (${entry.pdfs.length} PDFs)`);

    // Check for existing scenario documents to avoid duplicates
    const { data: existingDocs } = await supabase
      .from('content_documents')
      .select('title, storage_url')
      .eq('enabler_id', entry.enablerId)
      .eq('document_type', 'EXERCISE');

    const existingTitles = new Set((existingDocs || []).map((d) => d.title));

    for (let i = 0; i < entry.pdfs.length; i++) {
      const pdf = entry.pdfs[i];
      const partTitle = pdf.name.replace(/\.pdf$/i, '');

      // Skip if already uploaded
      if (existingTitles.has(`Szenario: ${partTitle}`)) {
        console.log(`  ⏩ Skip (exists): ${pdf.name}`);
        skipped++;
        continue;
      }

      // Storage path: szenarien/{enablerFolder}/{sanitized_filename}
      const storagePath = `szenarien/${entry.enablerId}/${pdf.safeName}`;

      try {
        // Upload to storage
        const fileBuffer = fs.readFileSync(pdf.fullPath);
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, fileBuffer, {
            contentType: 'application/pdf',
            upsert: true,
          });

        if (uploadErr) {
          console.error(`  ❌ Upload failed: ${pdf.name} - ${uploadErr.message}`);
          errors++;
          continue;
        }

        // Get public URL
        const {
          data: { publicUrl },
        } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

        // Insert content_document record
        const { error: insertErr } = await supabase.from('content_documents').insert({
          enabler_id: entry.enablerId,
          title: `Szenario: ${partTitle}`,
          document_type: 'EXERCISE',
          visibility: 'ALL',
          file_name: pdf.name,
          file_size: pdf.size,
          mime_type: 'application/pdf',
          storage_url: publicUrl,
          storage_path: storagePath,
          order_index: i + 100, // Offset to come after theory docs
        });

        if (insertErr) {
          console.error(`  ❌ DB insert failed: ${pdf.name} - ${insertErr.message}`);
          errors++;
          continue;
        }

        uploaded++;
        console.log(`  ✅ [${uploaded}/${total}] ${pdf.name}`);
      } catch (err) {
        console.error(`  ❌ Error: ${pdf.name} - ${err.message}`);
        errors++;
      }
    }
  }

  return { uploaded, skipped, errors, total };
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Szenarien PDF Upload - ${envArg.toUpperCase()} ${dryRun ? '(DRY RUN)' : ''}`);
  console.log(`${'='.repeat(60)}\n`);

  // Step 1: Scan folders
  console.log('📂 Scanning Szenarien folder structure...');
  const folderData = scanFolders();
  const totalPdfs = folderData.reduce((sum, f) => sum + f.pdfs.length, 0);
  console.log(`   Found ${folderData.length} enabler folders with ${totalPdfs} PDFs total\n`);

  // Step 2: Fetch DB data
  console.log('🔍 Fetching enablers from DB...');
  const [dbEnablers, dbCourses] = await Promise.all([fetchEnablers(), fetchCourses()]);
  console.log(`   Found ${dbEnablers.length} enablers in ${dbCourses.length} courses\n`);

  // Step 3: Build K → Course mapping
  const kToCourse = buildKToCourseMap(dbCourses);
  console.log('🗺️  K-folder → Course mapping:');
  for (const [k, courseId] of Object.entries(kToCourse).sort()) {
    const course = dbCourses.find((c) => c.id === courseId);
    console.log(`   ${k} → ${course?.title?.substring(0, 60)}...`);
  }
  console.log();

  // Step 4: Match folders to enablers
  const { matched, unmatched } = matchFoldersToEnablers(folderData, dbEnablers, kToCourse);

  const matchedPdfs = matched.reduce((sum, m) => sum + m.pdfs.length, 0);
  console.log(`✅ Matched: ${matched.length} enablers (${matchedPdfs} PDFs)`);
  console.log(`❌ Unmatched: ${unmatched.length} enablers\n`);

  // Show matched summary
  console.log('--- MATCHED ENABLERS ---');
  for (const m of matched) {
    console.log(`  ${m.kNumber} | ${m.enablerDbTitle.substring(0, 55).padEnd(55)} | ${m.pdfs.length} PDFs | score=${m.matchScore.toFixed(2)}`);
  }

  // Show unmatched
  if (unmatched.length > 0) {
    console.log('\n--- UNMATCHED ENABLERS (will be skipped) ---');
    for (const u of unmatched) {
      console.log(`  ${u.kNumber} | ${u.enablerName.substring(0, 55).padEnd(55)} | ${u.pdfs.length} PDFs | ${u.reason}`);
    }
  }

  if (dryRun) {
    console.log('\n🏁 DRY RUN complete. No files were uploaded.\n');
    return;
  }

  // Step 5: Upload and insert
  console.log('\n🚀 Starting upload...\n');
  const result = await uploadAndInsert(matched);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Upload Complete!`);
  console.log(`  ✅ Uploaded: ${result.uploaded}`);
  console.log(`  ⏩ Skipped (duplicates): ${result.skipped}`);
  console.log(`  ❌ Errors: ${result.errors}`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(console.error);
