import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev';
const COMPANY_EMAIL = process.env.ADMIN_EMAIL || 'info@wamocon.com';

// Simple email regex for server-side validation
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const { name, company, email, phone, plan, message } = body as Record<
    string,
    string
  >;

  // Server-side validation
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return NextResponse.json(
      { error: 'Name ist erforderlich.' },
      { status: 422 }
    );
  }
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json(
      { error: 'Gültige E-Mail-Adresse erforderlich.' },
      { status: 422 }
    );
  }
  if (!plan || typeof plan !== 'string') {
    return NextResponse.json(
      { error: 'Kein Tarif ausgewählt.' },
      { status: 422 }
    );
  }

  const safeName = name.trim().slice(0, 200);
  const safeCompany = (company ?? '').trim().slice(0, 300);
  const safeEmail = email.trim().toLowerCase().slice(0, 320);
  const safePhone = (phone ?? '').trim().slice(0, 50);
  const safePlan = plan.trim().slice(0, 50);
  const safeMessage = (message ?? '').trim().slice(0, 2000);

  if (!process.env.RESEND_API_KEY) {
    console.error('[contact] RESEND_API_KEY not configured');
    return NextResponse.json(
      { error: 'E-Mail-Dienst nicht konfiguriert.' },
      { status: 503 }
    );
  }

  // 1. Notify company
  const companyHtml = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><title>Neue LFA-Anfrage</title></head>
<body style="font-family:Inter,system-ui,sans-serif;background:#f5f5f7;margin:0;padding:32px 16px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:linear-gradient(135deg,#e01515,#ff4444);padding:32px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;letter-spacing:-0.5px;">LFA</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">Neue Tarifanfrage eingegangen</p>
    </div>
    <div style="padding:32px;">
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:13px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.08em;">Gewählter Tarif</p>
        <p style="margin:6px 0 0;font-size:22px;font-weight:800;color:#e01515;">${safePlan}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#6b7280;width:130px;font-weight:600;">Name</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#111;">${safeName}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#6b7280;font-weight:600;">Unternehmen</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#111;">${safeCompany || '—'}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#6b7280;font-weight:600;">E-Mail</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#111;"><a href="mailto:${safeEmail}" style="color:#e01515;">${safeEmail}</a></td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#6b7280;font-weight:600;">Telefon</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;color:#111;">${safePhone || '—'}</td></tr>
        ${safeMessage ? `<tr><td style="padding:10px 0;color:#6b7280;font-weight:600;vertical-align:top;">Nachricht</td><td style="padding:10px 0;color:#111;line-height:1.6;">${safeMessage.replace(/\n/g, '<br>')}</td></tr>` : ''}
      </table>
    </div>
    <div style="padding:20px 32px;background:#f8f8fa;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">Diese E-Mail wurde automatisch über das Kontaktformular der LFA-Plattform gesendet.</p>
    </div>
  </div>
</body>
</html>`;

  // 2. Confirmation to user
  const userHtml = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><title>Ihre LFA-Anfrage</title></head>
<body style="font-family:Inter,system-ui,sans-serif;background:#f5f5f7;margin:0;padding:32px 16px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:linear-gradient(135deg,#e01515,#ff4444);padding:32px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;letter-spacing:-0.5px;">LFA</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">Lernzentrum für Auszubildende</p>
    </div>
    <div style="padding:32px;">
      <h2 style="font-size:22px;font-weight:700;color:#111;margin:0 0 12px;">Vielen Dank, ${safeName}!</h2>
      <p style="color:#4b5563;line-height:1.7;margin:0 0 20px;">Wir haben Ihre Anfrage für den <strong style="color:#e01515;">${safePlan}</strong>-Tarif erhalten und melden uns innerhalb von 1–2 Werktagen bei Ihnen.</p>
      <div style="background:#f8f8fa;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.06em;">Ihre Angaben</p>
        <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.8;">
          <strong>Tarif:</strong> ${safePlan}<br>
          <strong>Unternehmen:</strong> ${safeCompany || '—'}<br>
          <strong>Telefon:</strong> ${safePhone || '—'}
        </p>
      </div>
      <p style="color:#4b5563;line-height:1.7;font-size:14px;margin:0;">Bei Rückfragen erreichen Sie uns direkt unter <a href="mailto:info@wamocon.com" style="color:#e01515;font-weight:600;">info@wamocon.com</a>.</p>
    </div>
    <div style="padding:20px 32px;background:#f8f8fa;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">© 2026 WAMOCON GmbH · LFA-Lernplattform</p>
    </div>
  </div>
</body>
</html>`;

  try {
    await Promise.all([
      resend.emails.send({
        from: `LFA Anfrage <${FROM_EMAIL}>`,
        to: [COMPANY_EMAIL],
        replyTo: safeEmail,
        subject: `[LFA] Neue Tarifanfrage: ${safePlan} – ${safeName}${safeCompany ? ` (${safeCompany})` : ''}`,
        html: companyHtml,
      }),
      resend.emails.send({
        from: `LFA Lernplattform <${FROM_EMAIL}>`,
        to: [safeEmail],
        subject: 'Ihre LFA-Anfrage ist eingegangen',
        html: userHtml,
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[contact] Resend error:', err);
    return NextResponse.json(
      {
        error:
          'E-Mail konnte nicht gesendet werden. Bitte versuchen Sie es später erneut.',
      },
      { status: 500 }
    );
  }
}
