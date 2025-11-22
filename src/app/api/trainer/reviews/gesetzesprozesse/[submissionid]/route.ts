import { NextResponse } from 'next/server';
// Geschäftsprozesse feature removed
export async function PATCH() { return NextResponse.json({ error: 'Removed' }, { status: 410 }); }
