import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET - Fetch all sale listings for the frontend with tenant count
export async function GET() {
  try {
    // Get all listings
    const { data: listings, error: listingsError } = await supabaseAdmin
      .from('sale_listings')
      .select('*')
      .order('code');
    
    if (listingsError) throw listingsError;
    
    // Get tenant counts
    const { data: tenantCounts, error: tenantError } = await supabaseAdmin
      .from('sale_tenants')
      .select('sale_listing_id');
    
    if (tenantError) throw tenantError;
    
    // Count tenants per listing
    const countMap: Record<string, number> = {};
    (tenantCounts || []).forEach(t => {
      countMap[t.sale_listing_id] = (countMap[t.sale_listing_id] || 0) + 1;
    });
    
    // Add tenant_count to each listing
    const data = (listings || []).map(l => ({
      ...l,
      tenant_count: countMap[l.id] || 0
    }));
    
    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      }
    });
  } catch (error) {
    console.error('Error fetching listings:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}