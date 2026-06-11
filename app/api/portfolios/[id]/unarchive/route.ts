// app/api/portfolios/[id]/unarchive/route.ts
// =============================================================================
// Restore an archived portfolio by clearing archived_at.
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
      .update({ archived_at: null })
      .eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('unarchive error:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}