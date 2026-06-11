// app/api/portfolios/[id]/archive/route.ts
// =============================================================================
// Soft-delete: set archived_at = now() on a portfolio. The portfolio remains
// in the database and can be restored via the unarchive endpoint.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { error } = await supabaseAdmin
      .from('portfolios')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('archive error:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}