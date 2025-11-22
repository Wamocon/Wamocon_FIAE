import { NextResponse } from 'next/server';
// Geschäftsprozesse feature removed
export async function GET() { return NextResponse.json({ error: 'Removed' }, { status: 410 }); }
