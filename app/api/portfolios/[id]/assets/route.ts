import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: portfolioId } = await params;

    const { data: assets, error } = await supabaseAdmin
      .from('assets')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching assets:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(assets || []);
  } catch (error: any) {
    console.error('Error in assets API:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}