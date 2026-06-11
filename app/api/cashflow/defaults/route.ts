import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const { data: defaults, error } = await supabaseAdmin
      .from('cashflow_assumption_defaults')
      .select('*')
      .order('investment_type', { ascending: true });

    if (error) {
      console.error('Error fetching defaults:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform to object keyed by type
    const defaultsByType = (defaults || []).reduce((acc: any, item: any) => {
      acc[item.investment_type] = item;
      return acc;
    }, {});

    return NextResponse.json(defaultsByType);
  } catch (error: any) {
    console.error('Error in defaults API:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}