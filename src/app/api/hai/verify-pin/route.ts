import { NextResponse } from 'next/server';
import { isErrorResponse } from '@/lib/auth/session';
import { requireHaiIndexManager } from '@/lib/hai/guards';

export async function POST(request: Request) {
  // The PIN is a second factor on top of the session, not a replacement
  const manager = await requireHaiIndexManager(request);
  if (isErrorResponse(manager)) return manager;

  try {
    const { pin } = await request.json();
    const expectedPin = process.env.HAI_ADMIN_PIN;

    if (!expectedPin) {
      console.error('HAI_ADMIN_PIN environment variable is not set');
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    if (!pin || pin !== expectedPin) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }
}
