import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params;

    const { data: tenants, error } = await supabaseAdmin
      .from('tenants')
      .select('id, tenant_name, remaining_lease_years, annual_rent')
      .eq('asset_id', assetId)
      .order('annual_rent', { ascending: false });

    if (error) {
      console.error('Error fetching tenants:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(tenants || []);
  } catch (error: any) {
    console.error('Error in tenants route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}