/**
 * Email Service - Sends calendar invitations and notifications
 * Uses Resend for email delivery
 */

import { Resend } from 'resend';
import { generateICS, generateEventUID, BLOCK_TYPE_LABELS, EXAM_SUB_TYPE_LABELS } from './ics';

// Initialize Resend client (requires RESEND_API_KEY env var)
const resend = new Resend(process.env.RESEND_API_KEY);

// Default sender email (use onboarding@resend.dev for testing)
const FROM_EMAIL = process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev';
const FROM_NAME = 'LFA Ausbildungsplattform';

interface BlockInviteData {
    blockId: string;
    blockType: string;
    examSubType?: string | null;
    title?: string | null;
    description?: string | null;
    notes?: string | null;
    startDate: Date;
    endDate: Date;
    traineeName: string;
    traineeEmail: string;
    createdByTrainer?: boolean;
    trainerName?: string;
}

/**
 * Send calendar invitation emails for a block
 */
export async function sendBlockerInvite(
    inviteeEmails: string[],
    blockData: BlockInviteData
): Promise<{ success: boolean; error?: string }> {
    if (!process.env.RESEND_API_KEY) {
        console.warn('RESEND_API_KEY not configured, skipping email send');
        return { success: false, error: 'Email service not configured' };
    }

    try {
        // Generate event summary
        let summary = BLOCK_TYPE_LABELS[blockData.blockType] || blockData.blockType;
        if (blockData.blockType === 'EXAM' && blockData.examSubType) {
            summary = EXAM_SUB_TYPE_LABELS[blockData.examSubType] || summary;
        }
        if (blockData.title) {
            summary = `${summary}: ${blockData.title}`;
        }

        // Generate event description
        let description = `Ausbildungsblock für ${blockData.traineeName}`;
        if (blockData.notes) {
            description += `\n\nNotizen: ${blockData.notes}`;
        }
        if (blockData.description) {
            description += `\n\nBeschreibung: ${blockData.description}`;
        }
        if (blockData.createdByTrainer && blockData.trainerName) {
            description += `\n\nErstellt von: ${blockData.trainerName}`;
        }

        // Generate ICS file
        const icsContent = generateICS({
            uid: generateEventUID(blockData.blockId),
            summary,
            description,
            startDate: blockData.startDate,
            endDate: blockData.endDate,
            organizer: {
                name: blockData.createdByTrainer && blockData.trainerName ? blockData.trainerName : blockData.traineeName,
                email: blockData.traineeEmail,
            },
            attendees: inviteeEmails.map(email => ({ email })),
        });

        // Convert ICS to base64 for attachment
        const icsBase64 = Buffer.from(icsContent).toString('base64');

        // Format dates for email
        const startStr = blockData.startDate.toLocaleDateString('de-DE', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
        });
        const endStr = blockData.endDate.toLocaleDateString('de-DE', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
        });

        // Send email to each invitee
        for (const email of inviteeEmails) {
            await resend.emails.send({
                from: `${FROM_NAME} <${FROM_EMAIL}>`,
                to: email,
                subject: `📅 Kalendereinladung: ${summary}`,
                html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #dc2626, #991b1b); padding: 24px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">📅 Kalendereinladung</h1>
            </div>
            <div style="background: #ffffff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
              <h2 style="color: #1f2937; margin-top: 0;">${summary}</h2>
              
              <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0;">
                <p style="margin: 0 0 8px 0; color: #6b7280;"><strong>Zeitraum:</strong></p>
                <p style="margin: 0; color: #1f2937; font-size: 16px;">${startStr} – ${endStr}</p>
              </div>

              ${blockData.notes ? `
              <div style="margin: 16px 0;">
                <p style="margin: 0 0 4px 0; color: #6b7280;"><strong>Notizen:</strong></p>
                <p style="margin: 0; color: #1f2937;">${blockData.notes}</p>
              </div>
              ` : ''}

              ${blockData.description ? `
              <div style="margin: 16px 0;">
                <p style="margin: 0 0 4px 0; color: #6b7280;"><strong>Beschreibung:</strong></p>
                <p style="margin: 0; color: #1f2937;">${blockData.description}</p>
              </div>
              ` : ''}

              <div style="margin: 16px 0;">
                <p style="margin: 0; color: #6b7280;">
                  Erstellt von: <strong>${blockData.createdByTrainer && blockData.trainerName ? blockData.trainerName : blockData.traineeName}</strong>
                </p>
              </div>

              <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 14px; margin: 0;">
                  📎 Im Anhang findest du eine Kalenderdatei (.ics), die du zu deinem Kalender hinzufügen kannst.
                </p>
              </div>
            </div>
            <div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 12px;">
              <p>Diese E-Mail wurde automatisch von der FIAE Ausbildungsplattform gesendet.</p>
            </div>
          </div>
        `,
                attachments: [
                    {
                        filename: 'termin.ics',
                        content: icsBase64,
                        contentType: 'text/calendar',
                    },
                ],
            });
        }

        return { success: true };
    } catch (error: any) {
        console.error('Failed to send calendar invite:', error);
        return { success: false, error: error.message || 'Failed to send email' };
    }
}

/**
 * Send notification to trainee when trainer creates a blocker
 */
export async function sendTrainerBlockerNotification(
    traineeEmail: string,
    traineeName: string,
    trainerName: string,
    blockData: BlockInviteData
): Promise<{ success: boolean; error?: string }> {
    // Use the same invite function, just include trainer info
    return sendBlockerInvite([traineeEmail], {
        ...blockData,
        createdByTrainer: true,
        trainerName,
    });
}
