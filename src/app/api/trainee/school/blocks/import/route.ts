/**
 * Block Calendar CSV Import API
 * 
 * POST /api/trainee/school/blocks/import
 * 
 * Accepts CSV data for bulk import of block schedules.
 * Supports flexible column mapping for different school formats.
 * 
 * Expected CSV structure (BWS Hofheim example):
 * KW,Datum,10IT,11IT,12IT,Anmerkungen
 * 33,10.08. - 14.08.,,5,,1. Schultag für Klasse 12
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { ausbildungBlocks, profiles } from '@/db/migrations/schemas/schema';

// Helper to parse German date format "10.08." or "10.08. - 14.08."
function parseGermanDateRange(dateStr: string, year: number): { start: Date; end: Date } | null {
    if (!dateStr) return null;

    const trimmed = dateStr.trim();

    // Format: "10.08. - 14.08." or "10.08.-14.08."
    if (trimmed.includes('-')) {
        const parts = trimmed.split('-').map(p => p.trim().replace(/\./g, ''));
        if (parts.length === 2) {
            const start = parseGermanDate(parts[0], year);
            const end = parseGermanDate(parts[1], year);
            if (start && end) return { start, end };
        }
    }

    // Single date "10.08."
    const single = parseGermanDate(trimmed.replace(/\./g, ''), year);
    if (single) {
        // Single date = start and end of that day
        const end = new Date(single);
        end.setHours(23, 59, 59);
        return { start: single, end };
    }

    return null;
}

// Parse "1008" (DDMM) to Date
function parseGermanDate(ddmm: string, year: number): Date | null {
    if (!ddmm || ddmm.length < 2) return null;

    // Remove dots and spaces
    const clean = ddmm.replace(/[\.\s]/g, '');

    // Try to extract day and month
    let day: number, month: number;

    if (clean.length === 4) {
        // Format: DDMM
        day = parseInt(clean.substring(0, 2), 10);
        month = parseInt(clean.substring(2, 4), 10);
    } else if (clean.length === 3) {
        // Format: DMM (e.g., 508 = 5th of August)
        day = parseInt(clean.substring(0, 1), 10);
        month = parseInt(clean.substring(1, 3), 10);
    } else if (clean.length === 2) {
        // Format: DD (assume current month)
        day = parseInt(clean, 10);
        month = new Date().getMonth() + 1;
    } else {
        return null;
    }

    if (isNaN(day) || isNaN(month) || day < 1 || day > 31 || month < 1 || month > 12) {
        return null;
    }

    return new Date(year, month - 1, day);
}

// Helper to get ISO week number
function getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Helper to get current Schuljahr
function getCurrentSchuljahr(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    return month >= 8 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

// Helper to calculate Ausbildungsjahr
function calculateAusbildungsjahr(startDate: Date): number {
    const now = new Date();
    const monthsSince = (now.getFullYear() - startDate.getFullYear()) * 12 +
        (now.getMonth() - startDate.getMonth());
    if (monthsSince < 12) return 1;
    if (monthsSince < 24) return 2;
    return 3;
}

// Determine block type from block number or notes
function determineBlockType(blockNumber: number | null, notes: string): 'SCHOOL' | 'COMPANY' | 'HOLIDAY' | 'EXAM' | 'PERSONAL' {
    const lowerNotes = notes?.toLowerCase() || '';

    if (lowerNotes.includes('ferien') || lowerNotes.includes('feiertag')) {
        return 'HOLIDAY';
    }
    if (lowerNotes.includes('prüfung') || lowerNotes.includes('klausur')) {
        return 'EXAM';
    }
    if (blockNumber && blockNumber > 0) {
        return 'SCHOOL';
    }
    return 'COMPANY';
}

interface ImportResult {
    imported: number;
    skipped: number;
    errors: Array<{ row: number; error: string }>;
}

// POST /api/trainee/school/blocks/import
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            traineeId,
            csvData,
            schuljahr,
            baseYear, // Calendar year for date parsing (e.g., 2026)
            clearExisting = false,
            columnMapping // Optional custom column mapping
        } = body;

        // Validation
        if (!traineeId) return NextResponse.json({ error: 'traineeId required' }, { status: 400 });
        if (!csvData || !Array.isArray(csvData)) {
            return NextResponse.json({ error: 'csvData array required' }, { status: 400 });
        }

        // Get trainee profile for Ausbildungsjahr calculation
        const [trainee] = await db
            .select({ startOfTrainingDate: profiles.startOfTrainingDate })
            .from(profiles)
            .where(eq(profiles.id, traineeId));

        const ausbildungsjahr = trainee?.startOfTrainingDate
            ? calculateAusbildungsjahr(trainee.startOfTrainingDate)
            : 1;

        const targetSchuljahr = schuljahr || getCurrentSchuljahr();
        const yearForParsing = baseYear || new Date().getFullYear();

        // Optionally clear existing blocks for this schuljahr
        if (clearExisting) {
            await db
                .delete(ausbildungBlocks)
                .where(eq(ausbildungBlocks.traineeId, traineeId as any));
        }

        const result: ImportResult = {
            imported: 0,
            skipped: 0,
            errors: [],
        };

        // Default column mapping (BWS Hofheim format)
        const mapping = columnMapping || {
            kw: 'KW',
            datum: 'Datum',
            year1: '10IT',
            year2: '11IT',
            year3: '12IT',
            notes: 'Anmerkungen',
        };

        // Determine which column to use based on Ausbildungsjahr
        const yearColumn = ausbildungsjahr === 1 ? mapping.year1
            : ausbildungsjahr === 2 ? mapping.year2
                : mapping.year3;

        for (let i = 0; i < csvData.length; i++) {
            const row = csvData[i];
            const rowNum = i + 1;

            try {
                // Extract fields using mapping
                const kw = parseInt(row[mapping.kw], 10);
                const datumStr = row[mapping.datum];
                const blockValue = row[yearColumn];
                const notes = row[mapping.notes] || '';

                // Skip empty rows or rows without data for this year
                if (!kw || isNaN(kw)) {
                    result.skipped++;
                    continue;
                }

                // Parse date range
                const dateRange = parseGermanDateRange(datumStr, yearForParsing);
                if (!dateRange) {
                    result.errors.push({ row: rowNum, error: `Invalid date format: ${datumStr}` });
                    continue;
                }

                // Parse block number (if present)
                let blockNumber: number | null = null;
                if (blockValue) {
                    const parsed = parseInt(blockValue, 10);
                    if (!isNaN(parsed)) blockNumber = parsed;
                }

                // Determine block type
                const blockType = determineBlockType(blockNumber, notes);

                // Skip weeks without school blocks (no blockNumber and not a holiday/exam)
                if (!blockNumber && blockType === 'COMPANY' && !notes) {
                    result.skipped++;
                    continue;
                }

                // Insert block
                await db.insert(ausbildungBlocks).values({
                    traineeId: traineeId as any,
                    schuljahr: targetSchuljahr,
                    ausbildungsjahr,
                    calendarWeek: kw,
                    year: dateRange.start.getFullYear(),
                    startDate: dateRange.start,
                    endDate: dateRange.end,
                    blockType,
                    blockNumber,
                    notes: notes || null,
                    isPersonal: false,
                    importedFrom: 'CSV Import',
                });

                result.imported++;
            } catch (rowError: any) {
                result.errors.push({ row: rowNum, error: rowError.message || 'Unknown error' });
            }
        }

        return NextResponse.json({
            success: true,
            result,
            meta: {
                targetSchuljahr,
                ausbildungsjahr,
                totalRows: csvData.length,
            },
        }, { status: result.errors.length > 0 ? 207 : 201 }); // 207 = Multi-Status for partial success
    } catch (e) {
        console.error('CSV import error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
