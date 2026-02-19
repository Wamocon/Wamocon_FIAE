import { NextResponse } from 'next/server';

const DEFAULT_PIN = 'wamocon2026';

export async function POST(request: Request) {
  try {
    const { pin } = await request.json();
    const expectedPin = process.env.HAI_ADMIN_PIN || DEFAULT_PIN;

    if (!pin || pin !== expectedPin) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }
}
