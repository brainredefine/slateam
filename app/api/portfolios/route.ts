import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const { data: portfolios, error } = await supabaseAdmin
      .from('portfolios')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching portfolios:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(portfolios || []);
  } catch (error: any) {
    console.error('Error in portfolios API:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}