/**
 * HAI.ai Action Streaming & Progress System
 *
 * Provides streaming updates for action execution to improve UX.
 * Shows progress indicators, step-by-step updates, and engaging messages.
 *
 * @module lib/hai/actionStreaming
 */

import { ActionType, ActionResult, executeAction } from './actions';

// ============================================================================
// TYPES
// ============================================================================

export interface ActionProgress {
    step: number;
    totalSteps: number;
    message: string;
    emoji?: string;
    status: 'running' | 'completed' | 'error';
}

export type ProgressCallback = (progress: ActionProgress) => void;

// ============================================================================
// STREAMING EXECUTION
// ============================================================================

/**
 * Execute an action with streaming progress updates
 *
 * @param actionType - The action to perform
 * @param parameters - Action parameters
 * @param userId - User ID performing the action
 * @param onProgress - Callback for progress updates
 * @returns Final action result
 */
export async function executeActionWithProgress(
    actionType: ActionType,
    parameters: Record<string, unknown>,
    userId: string,
    onProgress: ProgressCallback
): Promise<ActionResult> {
    const steps = getActionSteps(actionType);

    try {
        // Step 1: Validate parameters
        onProgress({
            step: 1,
            totalSteps: steps.length,
            message: steps[0].message,
            emoji: steps[0].emoji,
            status: 'running',
        });

        await delay(300); // Brief pause for UX

        // Step 2: Execute action
        onProgress({
            step: 2,
            totalSteps: steps.length,
            message: steps[1].message,
            emoji: steps[1].emoji,
            status: 'running',
        });

        const result = await executeAction(actionType, parameters, userId);

        await delay(200);

        // Step 3: Finalize
        onProgress({
            step: 3,
            totalSteps: steps.length,
            message: result.success ? steps[2].successMessage! : steps[2].errorMessage!,
            emoji: result.success ? '✅' : '❌',
            status: result.success ? 'completed' : 'error',
        });

        return result;
    } catch (error) {
        onProgress({
            step: steps.length,
            totalSteps: steps.length,
            message: 'Ein unerwarteter Fehler ist aufgetreten',
            emoji: '❌',
            status: 'error',
        });

        throw error;
    }
}

/**
 * Format an action result as a streaming message with emojis and formatting
 *
 * @param result - The action result
 * @param actionType - The action type
 * @returns Formatted markdown message
 */
export function formatActionResult(result: ActionResult, actionType: ActionType): string {
    if (!result.success) {
        return `❌ **Fehler:** ${result.message}`;
    }

    const emoji = getActionEmoji(actionType);
    const formatted = [`${emoji} **Erfolgreich!**`, '', result.message];

    // Add data-specific formatting
    if (result.data) {
        formatted.push('');
        formatted.push('**Details:**');

        if (actionType === 'create_activity_report' && result.data) {
            const data = result.data as { reportId: string; weekNumber: number; year: number };
            formatted.push(`- 📅 KW ${data.weekNumber}/${data.year}`);
            formatted.push(`- 📝 Status: Entwurf`);
        } else if (actionType === 'complete_enabler' && result.data) {
            const data = result.data as { enablerTitle: string };
            formatted.push(`- 📚 ${data.enablerTitle}`);
        }
    }

    return formatted.join('\n');
}

// ============================================================================
// PROGRESS STEPS
// ============================================================================

interface ActionStep {
    message: string;
    emoji?: string;
    successMessage?: string;
    errorMessage?: string;
}

function getActionSteps(actionType: ActionType): ActionStep[] {
    const steps: Record<ActionType, ActionStep[]> = {
        create_activity_report: [
            { message: 'Prüfe Woche und Jahr...', emoji: '🔍' },
            { message: 'Erstelle Tätigkeitsnachweis...', emoji: '📝' },
            {
                message: 'Abschließen...',
                successMessage: 'Tätigkeitsnachweis erfolgreich erstellt!',
                errorMessage: 'Fehler beim Erstellen des Nachweises',
            },
        ],
        submit_activity_report: [
            { message: 'Suche Tätigkeitsnachweis...', emoji: '🔍' },
            { message: 'Reiche ein...', emoji: '📤' },
            {
                message: 'Abschließen...',
                successMessage: 'Tätigkeitsnachweis eingereicht!',
                errorMessage: 'Fehler beim Einreichen',
            },
        ],
        complete_enabler: [
            { message: 'Prüfe Enabler-Status...', emoji: '🔍' },
            { message: 'Markiere als abgeschlossen...', emoji: '✅' },
            {
                message: 'Abschließen...',
                successMessage: 'Enabler abgeschlossen!',
                errorMessage: 'Fehler beim Abschließen',
            },
        ],
        submit_quiz: [
            { message: 'Validiere Antworten...', emoji: '🔍' },
            { message: 'Reiche Quiz ein...', emoji: '📤' },
            {
                message: 'Abschließen...',
                successMessage: 'Quiz eingereicht!',
                errorMessage: 'Fehler beim Einreichen',
            },
        ],
        mark_notification_read: [
            { message: 'Suche Benachrichtigungen...', emoji: '🔍' },
            { message: 'Markiere als gelesen...', emoji: '✓' },
            {
                message: 'Abschließen...',
                successMessage: 'Benachrichtigungen aktualisiert!',
                errorMessage: 'Fehler beim Markieren',
            },
        ],
        approve_submission: [
            { message: 'Prüfe Berechtigung...', emoji: '🔐' },
            { message: 'Genehmige Abgabe...', emoji: '✅' },
            {
                message: 'Abschließen...',
                successMessage: 'Abgabe genehmigt!',
                errorMessage: 'Fehler beim Genehmigen',
            },
        ],
        reject_submission: [
            { message: 'Prüfe Berechtigung...', emoji: '🔐' },
            { message: 'Lehne Abgabe ab...', emoji: '❌' },
            {
                message: 'Abschließen...',
                successMessage: 'Abgabe abgelehnt',
                errorMessage: 'Fehler beim Ablehnen',
            },
        ],
        approve_report: [
            { message: 'Prüfe Berechtigung...', emoji: '🔐' },
            { message: 'Genehmige Nachweis...', emoji: '✅' },
            {
                message: 'Abschließen...',
                successMessage: 'Tätigkeitsnachweis genehmigt!',
                errorMessage: 'Fehler beim Genehmigen',
            },
        ],
        reject_report: [
            { message: 'Prüfe Berechtigung...', emoji: '🔐' },
            { message: 'Lehne Nachweis ab...', emoji: '❌' },
            {
                message: 'Abschließen...',
                successMessage: 'Tätigkeitsnachweis abgelehnt',
                errorMessage: 'Fehler beim Ablehnen',
            },
        ],
        grade_quiz: [
            { message: 'Prüfe Berechtigung...', emoji: '🔐' },
            { message: 'Bewerte Quiz...', emoji: '📊' },
            {
                message: 'Abschließen...',
                successMessage: 'Quiz bewertet!',
                errorMessage: 'Fehler beim Bewerten',
            },
        ],
        upload_document: [
            { message: 'Prüfe Datei...', emoji: '🔍' },
            { message: 'Lade hoch...', emoji: '☁️' },
            {
                message: 'Abschließen...',
                successMessage: 'Dokument hochgeladen!',
                errorMessage: 'Fehler beim Hochladen',
            },
        ],
        show_progress: [
            { message: 'Lade Fortschrittsdaten...', emoji: '📊' },
            { message: 'Verarbeite...', emoji: '⚙️' },
            {
                message: 'Abschließen...',
                successMessage: 'Fortschritt geladen!',
                errorMessage: 'Fehler beim Laden',
            },
        ],
        show_calendar: [
            { message: 'Lade Kalender...', emoji: '📅' },
            { message: 'Verarbeite...', emoji: '⚙️' },
            {
                message: 'Abschließen...',
                successMessage: 'Kalender geladen!',
                errorMessage: 'Fehler beim Laden',
            },
        ],
        show_reports: [
            { message: 'Lade Nachweise...', emoji: '📄' },
            { message: 'Verarbeite...', emoji: '⚙️' },
            {
                message: 'Abschließen...',
                successMessage: 'Nachweise geladen!',
                errorMessage: 'Fehler beim Laden',
            },
        ],
    };

    return steps[actionType] || [
        { message: 'Verarbeite Anfrage...', emoji: '⚙️' },
        { message: 'Führe Aktion aus...', emoji: '🔄' },
        {
            successMessage: 'Erfolgreich!',
            errorMessage: 'Fehler aufgetreten',
        },
    ];
}

// ============================================================================
// EMOJI HELPERS
// ============================================================================

function getActionEmoji(actionType: ActionType): string {
    const emojis: Record<ActionType, string> = {
        create_activity_report: '📝',
        submit_activity_report: '📤',
        complete_enabler: '✅',
        submit_quiz: '📋',
        mark_notification_read: '✓',
        approve_submission: '✅',
        reject_submission: '❌',
        approve_report: '✅',
        reject_report: '❌',
        grade_quiz: '📊',
        upload_document: '📄',
        show_progress: '📊',
        show_calendar: '📅',
        show_reports: '📋',
    };

    return emojis[actionType] || '✨';
}

// ============================================================================
// UTILITIES
// ============================================================================

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a readable stream of progress updates as Server-Sent Events
 *
 * @param actionType - The action to perform
 * @param parameters - Action parameters
 * @param userId - User ID
 * @returns ReadableStream for SSE
 */
export function createActionProgressStream(
    actionType: ActionType,
    parameters: Record<string, unknown>,
    userId: string
): ReadableStream {
    const encoder = new TextEncoder();

    return new ReadableStream({
        async start(controller) {
            try {
                await executeActionWithProgress(
                    actionType,
                    parameters,
                    userId,
                    (progress) => {
                        const data = JSON.stringify(progress);
                        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                    }
                );

                controller.close();
            } catch (error) {
                const errorProgress: ActionProgress = {
                    step: 1,
                    totalSteps: 1,
                    message: 'Ein Fehler ist aufgetreten',
                    emoji: '❌',
                    status: 'error',
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorProgress)}\n\n`));
                controller.close();
            }
        },
    });
}
