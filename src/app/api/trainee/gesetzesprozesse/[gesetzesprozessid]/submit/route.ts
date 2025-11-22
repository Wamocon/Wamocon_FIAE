import { NextResponse } from 'next/server';
// Geschäftsprozesse feature removed
export async function POST() { return NextResponse.json({ error: 'Removed' }, { status: 410 }); }
