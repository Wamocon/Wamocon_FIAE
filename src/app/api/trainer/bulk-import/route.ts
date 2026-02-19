import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import db from '@/db';
import {
  courses,
  enablers,
  useCases,
  skills,
  courseSkills,
  contentDocuments,
} from '@/db/migrations/schemas/schema';
import { eq, and, sql } from 'drizzle-orm';

interface ImportResult {
  success: boolean;
  message: string;
  stats: {
    coursesCreated: number;
    enablersCreated: number;
    useCasesCreated: number;
    skillsCreated: number;
    errors: string[];
  };
}

interface CourseRow {
  title: string;
  description?: string;
  year?: number;
  chapter?: number;
  is_active?: string | boolean;
  is_published?: string | boolean;
}

interface EnablerRow {
  course_title: string;
  title: string;
  order_index: number;
  description_text?: string;
  scenario_text?: string; // Individual scenario text (one row per scenario)
  hint_text?: string; // Hint for this specific scenario
  ppt_url?: string;
  pdf_url?: string; // PDF for flipbook viewer - stored in content_documents
  video_url?: string;
  scenario_image_url?: string;
  duration_value?: number;
  duration_unit?: string;
  is_active?: string | boolean;
}

interface UseCaseRow {
  course_title: string;
  title: string;
  description_text: string;
  order_index: number;
  duration_value?: number;
  duration_unit?: string;
  is_active?: string | boolean;
}

interface SkillRow {
  skill_name: string;
  course_titles?: string;
}

function parseBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    return normalized === 'TRUE' || normalized === '1' || normalized === 'YES';
  }
  return false;
}

function validateDurationUnit(unit?: string): 'DAYS' | 'WEEKS' | null {
  if (!unit) return null;
  const normalized = unit.trim().toUpperCase();
  if (['DAYS', 'WEEKS'].includes(normalized)) {
    return normalized as 'DAYS' | 'WEEKS';
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    // Get form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const trainerId = formData.get('trainerId') as string;

    if (!file) {
      return NextResponse.json(
        { success: false, message: 'No file uploaded' },
        { status: 400 }
      );
    }

    if (!trainerId) {
      return NextResponse.json(
        { success: false, message: 'Trainer ID is required' },
        { status: 400 }
      );
    }

    // Read the Excel file
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    const result: ImportResult = {
      success: true,
      message: 'Import completed',
      stats: {
        coursesCreated: 0,
        enablersCreated: 0,
        useCasesCreated: 0,
        skillsCreated: 0,
        errors: [],
      },
    };

    // Map to store course IDs by title
    const courseIdMap = new Map<string, string>();
    const skillIdMap = new Map<string, string>();

    // Process Skills sheet (if exists)
    if (workbook.SheetNames.includes('Skills')) {
      const skillsSheet = workbook.Sheets['Skills'];
      const skillsData: SkillRow[] = XLSX.utils.sheet_to_json(skillsSheet);

      for (let i = 0; i < skillsData.length; i++) {
        const row = skillsData[i];
        try {
          if (!row.skill_name?.trim()) {
            result.stats.errors.push(
              `Skills row ${i + 2}: skill_name is required`
            );
            continue;
          }

          // Check if skill already exists
          const existingSkill = await db
            .select()
            .from(skills)
            .where(eq(skills.name, row.skill_name.trim()))
            .limit(1);

          let skillId: string;
          if (existingSkill.length > 0) {
            skillId = existingSkill[0].id;
            skillIdMap.set(row.skill_name.trim(), skillId);
          } else {
            // Create new skill
            const [newSkill] = await db
              .insert(skills)
              .values({
                name: row.skill_name.trim(),
              })
              .returning({ id: skills.id });

            skillId = newSkill.id;
            skillIdMap.set(row.skill_name.trim(), skillId);
            result.stats.skillsCreated++;
          }
        } catch (error: any) {
          result.stats.errors.push(`Skills row ${i + 2}: ${error.message}`);
        }
      }
    }

    // Process Courses sheet
    if (workbook.SheetNames.includes('Courses')) {
      const coursesSheet = workbook.Sheets['Courses'];
      const coursesData: CourseRow[] = XLSX.utils.sheet_to_json(coursesSheet);

      for (let i = 0; i < coursesData.length; i++) {
        const row = coursesData[i];
        try {
          if (!row.title?.trim()) {
            result.stats.errors.push(`Courses row ${i + 2}: title is required`);
            continue;
          }

          // Create course
          const [newCourse] = await db
            .insert(courses)
            .values({
              title: row.title.trim(),
              description: row.description?.trim() || null,
              year: row.year || null,
              chapter: row.chapter || null,
              isActive: parseBoolean(row.is_active),
              isPublished: parseBoolean(row.is_published),
              createdById: trainerId,
            })
            .returning({ id: courses.id });

          courseIdMap.set(row.title.trim(), newCourse.id);
          result.stats.coursesCreated++;

          // Link skills to course if provided in Skills sheet
          if (workbook.SheetNames.includes('Skills')) {
            const skillsSheet = workbook.Sheets['Skills'];
            const skillsData: SkillRow[] =
              XLSX.utils.sheet_to_json(skillsSheet);

            for (const skillRow of skillsData) {
              if (skillRow.course_titles) {
                const courseTitles = skillRow.course_titles
                  .split(',')
                  .map(t => t.trim());

                if (courseTitles.includes(row.title.trim())) {
                  const skillId = skillIdMap.get(skillRow.skill_name.trim());
                  if (skillId) {
                    await db
                      .insert(courseSkills)
                      .values({
                        courseId: newCourse.id,
                        skillId: skillId,
                      })
                      .onConflictDoNothing();
                  }
                }
              }
            }
          }
        } catch (error: any) {
          result.stats.errors.push(`Courses row ${i + 2}: ${error.message}`);
        }
      }
    }

    // Process Enablers sheet
    if (workbook.SheetNames.includes('Enablers')) {
      const enablersSheet = workbook.Sheets['Enablers'];
      const enablersData: EnablerRow[] =
        XLSX.utils.sheet_to_json(enablersSheet);

      // Group rows by enabler (course_title + title)
      const enablerGroups = new Map<string, EnablerRow[]>();

      for (let i = 0; i < enablersData.length; i++) {
        const row = enablersData[i];
        if (!row.course_title?.trim() || !row.title?.trim()) {
          result.stats.errors.push(
            `Enablers row ${i + 2}: course_title and title are required`
          );
          continue;
        }

        const key = `${row.course_title.trim()}|||${row.title.trim()}`;
        if (!enablerGroups.has(key)) {
          enablerGroups.set(key, []);
        }
        enablerGroups.get(key)!.push(row);
      }

      // Process each enabler group
      for (const [key, rows] of enablerGroups.entries()) {
        try {
          const firstRow = rows[0];

          if (
            firstRow.order_index === undefined ||
            firstRow.order_index === null
          ) {
            result.stats.errors.push(
              `Enabler "${firstRow.title}": order_index is required`
            );
            continue;
          }

          const courseId = courseIdMap.get(firstRow.course_title.trim());
          if (!courseId) {
            result.stats.errors.push(
              `Enabler "${firstRow.title}": Course "${firstRow.course_title}" not found. Make sure it exists in Courses sheet.`
            );
            continue;
          }

          const durationUnit = validateDurationUnit(firstRow.duration_unit);
          if (firstRow.duration_unit && !durationUnit) {
            result.stats.errors.push(
              `Enabler "${firstRow.title}": Invalid duration_unit "${firstRow.duration_unit}". Must be DAYS or WEEKS.`
            );
            continue;
          }

          // Build scenarios array from multiple rows
          const scenarios: Array<{ text: string; hint?: string }> = [];
          for (const row of rows) {
            if (row.scenario_text?.trim()) {
              scenarios.push({
                text: row.scenario_text.trim(),
                hint: row.hint_text?.trim() || undefined,
              });
            }
          }

          // Check if enabler already exists
          const existing = await db
            .select({ id: enablers.id })
            .from(enablers)
            .where(
              and(
                eq(enablers.courseId, courseId),
                eq(enablers.title, firstRow.title.trim())
              )
            )
            .limit(1);

          if (existing.length > 0) {
            // Update existing enabler with new scenarios
            await db
              .update(enablers)
              .set({
                orderIndex: firstRow.order_index,
                descriptionText: firstRow.description_text?.trim() || null,
                pptUrl: firstRow.ppt_url?.trim() || null,
                videoUrl: firstRow.video_url?.trim() || null,
                durationValue: firstRow.duration_value || null,
                durationUnit: durationUnit,
                isActive: parseBoolean(firstRow.is_active),
              })
              .where(eq(enablers.id, existing[0].id));
          } else {
            // Create new enabler
            const [newEnabler] = await db
              .insert(enablers)
              .values({
                courseId: courseId,
                title: firstRow.title.trim(),
                orderIndex: firstRow.order_index,
                descriptionText: firstRow.description_text?.trim() || null,
                pptUrl: firstRow.ppt_url?.trim() || null,
                videoUrl: firstRow.video_url?.trim() || null,
                durationValue: firstRow.duration_value || null,
                durationUnit: durationUnit,
                isActive: parseBoolean(firstRow.is_active),
              })
              .returning({ id: enablers.id });

            // Insert PDF document if provided
            if (firstRow.pdf_url?.trim()) {
              const pdfUrl = firstRow.pdf_url.trim();
              // Extract filename from URL
              const fileName = pdfUrl.split('/').pop() || 'document.pdf';
              const title = fileName.replace(/\.pdf$/i, '').replace(/_/g, ' ');

              await db.insert(contentDocuments).values({
                enablerId: newEnabler.id,
                title: title,
                fileName: fileName,
                storageUrl: pdfUrl,
                storagePath: pdfUrl.includes(
                  '/storage/v1/object/public/content/'
                )
                  ? pdfUrl.split('/storage/v1/object/public/content/')[1]
                  : null,
                documentType: 'THEORY',
                mimeType: 'application/pdf',
                uploadedById: trainerId as any,
              });
            }
          }

          result.stats.enablersCreated++;
        } catch (error: any) {
          result.stats.errors.push(
            `Enabler "${rows[0].title}": ${error.message}`
          );
        }
      }
    }

    // Process Use Cases sheet
    if (workbook.SheetNames.includes('Use Cases')) {
      const useCasesSheet = workbook.Sheets['Use Cases'];
      const useCasesData: UseCaseRow[] =
        XLSX.utils.sheet_to_json(useCasesSheet);

      for (let i = 0; i < useCasesData.length; i++) {
        const row = useCasesData[i];
        try {
          if (!row.course_title?.trim()) {
            result.stats.errors.push(
              `Use Cases row ${i + 2}: course_title is required`
            );
            continue;
          }
          if (!row.title?.trim()) {
            result.stats.errors.push(
              `Use Cases row ${i + 2}: title is required`
            );
            continue;
          }
          if (!row.description_text?.trim()) {
            result.stats.errors.push(
              `Use Cases row ${i + 2}: description_text is required`
            );
            continue;
          }
          if (row.order_index === undefined || row.order_index === null) {
            result.stats.errors.push(
              `Use Cases row ${i + 2}: order_index is required`
            );
            continue;
          }

          const courseId = courseIdMap.get(row.course_title.trim());
          if (!courseId) {
            result.stats.errors.push(
              `Use Cases row ${i + 2}: Course "${row.course_title}" not found. Make sure it exists in Courses sheet.`
            );
            continue;
          }

          const durationUnit = validateDurationUnit(row.duration_unit);
          if (row.duration_unit && !durationUnit) {
            result.stats.errors.push(
              `Use Cases row ${i + 2}: Invalid duration_unit "${row.duration_unit}". Must be DAYS or WEEKS.`
            );
            continue;
          }

          await db.insert(useCases).values({
            courseId: courseId,
            title: row.title.trim(),
            descriptionText: row.description_text.trim(),
            orderIndex: row.order_index,
            durationValue: row.duration_value || null,
            durationUnit: durationUnit,
            isActive: parseBoolean(row.is_active),
          });

          result.stats.useCasesCreated++;
        } catch (error: any) {
          result.stats.errors.push(`Use Cases row ${i + 2}: ${error.message}`);
        }
      }
    }

    // Process Scenarios sheet
    if (workbook.SheetNames.includes('Scenarios')) {
      const scenariosSheet = workbook.Sheets['Scenarios'];
      // Use raw: false to get formatted strings, but defval: '' so we don't skip empty cells
      const scenariosData: any[] = XLSX.utils.sheet_to_json(scenariosSheet);

      // Group by Enabler (Course + Enabler Title)
      const enablerScenariosMap = new Map<
        string,
        Array<{ text: string; hint?: string }>
      >();

      // Temporary storage data structure to build scenarios row-by-row
      // Key: "CourseTitle|||EnablerTitle"
      // Value: Array of structured scenario objects being built
      interface TempScenario {
        topics: string;
        goals: string;
        theory: string;
        context: string;
        checklist: string;
        hint: string;
        problems: Array<{ p: string; s: string }>;
      }

      const tempEnablerScenarios = new Map<string, TempScenario[]>();
      let lastKey: string | null = null;

      for (let i = 0; i < scenariosData.length; i++) {
        const row = scenariosData[i];
        const rowNum = i + 2;

        const courseTitle =
          row['Kurs / Modul'] ||
          row['Course Title'] ||
          row['course_title'] ||
          row['Course'] ||
          row['Modul'] ||
          row['Module'];
        const enablerTitle =
          row['Enabler Title'] ||
          row['enabler_title'] ||
          row['Enabler'] ||
          row['Lerneinheit'];

        // If generic identifiers are missing, maybe it's a continuation row?
        // But to be safe, require identifiers on every row or assume repetition means continuation?
        // Let's assume user fills identifiers on every row for safety, OR if missing, we assume same as last row?
        // "Row for better tracking" usually implies filling the key columns is repetitive but explicit.
        // Let's require them for now to avoid mix-ups, or use lastKey if strictly sequential.

        let effectiveCourse = courseTitle;
        let effectiveEnabler = enablerTitle;

        if (!effectiveCourse || !effectiveEnabler) {
          // Option: strict header requirement
          // result.stats.errors.push(`...`); continue;

          // Checking user intent: "add them into row".
          // Often means:
          // Row 1: Course | Enabler | Context ... | Prob 1 | Sol 1
          // Row 2:        |         |             | Prob 2 | Sol 2
          // If cells are empty in Excel json, they might be undefined.

          if (lastKey) {
            const [lastC, lastE] = lastKey.split('|||');
            if (!effectiveCourse) effectiveCourse = lastC;
            if (!effectiveEnabler) effectiveEnabler = lastE;
          } else {
            result.stats.errors.push(
              `Scenarios row ${rowNum}: 'Kurs / Modul' and 'Enabler Title' are required`
            );
            continue;
          }
        }

        const key = `${effectiveCourse.trim()}|||${effectiveEnabler.trim()}`;
        lastKey = key;

        if (!tempEnablerScenarios.has(key)) {
          tempEnablerScenarios.set(key, []);
        }

        const scenariosList = tempEnablerScenarios.get(key)!;

        // Determine if this is a NEW scenario definition or a CONTINUATION (just another problem)
        // Indicator: "Ausgangslage" (Context) or "Behandelte Themen" (Topics) is present => New Scenario
        // If those are empty, but "Problem" is present => Continuation of last scenario in the list

        const context = row['Ausgangslage'] || row['ausgangslage'];
        const topics = row['Behandelte Themen'] || row['behandelte_themen'];
        const isNewScenario =
          !!(context || topics) || scenariosList.length === 0;

        const problem = row['Problem'] || row['problem'];
        const solution =
          row['Lösung'] || row['lösung'] || row['Solution'] || row['solution'];

        if (isNewScenario) {
          // Init new scenario
          const newScen: TempScenario = {
            topics: topics || '',
            goals: row['Lernziele'] || row['lernziele'] || '',
            theory:
              row['Theoretische Grundlagen'] ||
              row['theoretische_grundlagen'] ||
              '',
            context: context || '',
            checklist: row['Lernziel-Checkliste'] || row['checklist'] || '',
            hint: row['Hinweis'] || row['hint'] || '',
            problems: [],
          };
          if (problem) {
            newScen.problems.push({
              p: String(problem),
              s: solution ? String(solution) : '',
            });
          }
          scenariosList.push(newScen);
        } else {
          // Continuation - add problem to last scenario
          if (scenariosList.length > 0) {
            const lastScen = scenariosList[scenariosList.length - 1];
            if (problem) {
              lastScen.problems.push({
                p: String(problem),
                s: solution ? String(solution) : '',
              });
            }
            // Also append checklist lines if provided in continuation row?
            const extraChecklist =
              row['Lernziel-Checkliste'] || row['checklist'];
            if (extraChecklist) {
              lastScen.checklist += '\n' + extraChecklist;
            }
          }
        }
      }

      // Convert TempScenarios to Final Structured Format
      // We store BOTH the generated text (for the current Viewer) AND the structured fields (for the new Trainer UI)
      for (const [key, tempScenarios] of tempEnablerScenarios.entries()) {
        const finalScenarios = tempScenarios.map(scen => {
          const blocks: string[] = [];
          if (scen.topics) blocks.push(`Behandelte Themen:\n${scen.topics}`);
          if (scen.goals) blocks.push(`Lernziele:\n${scen.goals}`);
          if (scen.theory)
            blocks.push(`Theoretische Grundlagen:\n${scen.theory}`);
          if (scen.context) blocks.push(`Ausgangslage:\n${scen.context}`);

          if (scen.problems.length > 0) {
            const problemBlock: string[] = [];
            scen.problems.forEach((item, idx) => {
              problemBlock.push(`Problem ${idx + 1}`);
              problemBlock.push(item.p);
              if (item.s) {
                problemBlock.push('LÖSUNG');
                problemBlock.push(item.s);
              }
              problemBlock.push(''); // spacer
            });
            blocks.push(`Problem-Lösung-Paare:\n${problemBlock.join('\n')}`);
          }

          if (scen.checklist)
            blocks.push(`Lernziel-Checkliste:\n${scen.checklist}`);

          const fullText = blocks.join('\n\n' + '-'.repeat(20) + '\n\n');

          return {
            text: fullText,
            hint: scen.hint || undefined,
            // Persist structured data for Trainer UI
            topics: scen.topics,
            goals: scen.goals,
            theory: scen.theory,
            context: scen.context,
            checklist: scen.checklist,
            problems: scen.problems,
          };
        });

        enablerScenariosMap.set(key, finalScenarios);
      }

      // Update DB with collected scenarios
      for (const [key, scenarios] of enablerScenariosMap.entries()) {
        const [courseTitle, enablerTitle] = key.split('|||');

        try {
          // 1. Find Course with whitespace normalization
          const courseRes = await db
            .select({ id: courses.id })
            .from(courses)
            .where(
              sql`regexp_replace(${courses.title}, '\\s+', ' ', 'g') = regexp_replace(${courseTitle.trim()}, '\\s+', ' ', 'g')`
            )
            .limit(1);

          if (courseRes.length === 0) {
            result.stats.errors.push(
              `Scenario Import: Course "${courseTitle}" not found.`
            );
            continue;
          }
          const courseId = courseRes[0].id;

          // 2. Find Enabler with whitespace normalization
          const enablerRes = await db
            .select({ id: enablers.id })
            .from(enablers)
            .where(
              and(
                eq(enablers.courseId, courseId),
                sql`regexp_replace(${enablers.title}, '\\s+', ' ', 'g') = regexp_replace(${enablerTitle.trim()}, '\\s+', ' ', 'g')`
              )
            )
            .limit(1);

          if (enablerRes.length === 0) {
            result.stats.errors.push(
              `Scenario Import: Enabler "${enablerTitle}" not found in course "${courseTitle}".`
            );
            continue;
          }
          const enablerId = enablerRes[0].id;

          // 3. Update Enabler Scenarios
          // 3. Update Enabler Scenarios - SKIPPED (Legacy text scenarios removed from schema)
          /*
          await db
            .update(enablers)
            .set({
               // No fields remaining to update
            })
            .where(eq(enablers.id, enablerId));
          */

          result.stats.enablersCreated++; // Using this stat reusing existing field
        } catch (err: any) {
          result.stats.errors.push(
            `Error updating scenarios for ${enablerTitle}: ${err.message}`
          );
        }
      }
    }

    // Set success based on whether there were any critical errors
    result.success = result.stats.errors.length === 0;
    if (result.stats.errors.length > 0) {
      result.message = `Import completed with ${result.stats.errors.length} error(s)`;
    } else {
      result.message = 'Import completed successfully!';
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error('Bulk import error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Import failed',
        error: error.message,
      },
      { status: 500 }
    );
  }
}
