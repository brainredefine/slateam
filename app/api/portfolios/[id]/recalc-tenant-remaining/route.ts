// app/api/portfolios/[id]/recalc-tenant-remaining/route.ts
// =============================================================================
// Recalculate `remaining_lease_years` on all tenants of a given asset.
//
// For each tenant:
//   - if lease_end is set → remaining = max(0, (lease_end - today) / 365.25)
//     and we WRITE the value to the DB
//   - if lease_end is NOT set:
//       - keep existing remaining_lease_years if it exists
//       - skip (don't touch) if it doesn't
//
// Body: { assetId: string }
// Returns: { ok, updatedCount, skippedCount, totalTenants }
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Note: portfolioId is in the URL but we use assetId from the body
    // to constrain the recalc to one asset at a time.
    const { id: portfolioId } = await params;
    const body = await req.json().catch(() => ({}));
    const assetId: string | undefined = body.assetId;

    if (!assetId) {
      return NextResponse.json({ error: 'assetId is required' }, { status: 400 });
    }

    // Verify the asset belongs to this portfolio (security check)
    const { data: asset, error: assetErr } = await supabase
      .from('assets')
      .select('id, portfolio_id')
      .eq('id', assetId)
      .single();

    if (assetErr || !asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }
    if (asset.portfolio_id !== portfolioId) {
      return NextResponse.json({ error: 'Asset does not belong to this portfolio' }, { status: 403 });
    }

    // Fetch all tenants of the asset
    const { data: tenants, error: tenantsErr } = await supabase
      .from('tenants')
      .select('id, lease_end, remaining_lease_years')
      .eq('asset_id', assetId);

    if (tenantsErr) throw tenantsErr;

    const today = Date.now();
    let updatedCount = 0;
    let skippedCount = 0;

    for (const t of tenants || []) {
      // No lease_end → respect existing remaining, or skip if none
      if (!t.lease_end) {
        skippedCount++;
        continue;
      }

      const end = new Date(t.lease_end);
      if (isNaN(end.getTime())) {
        skippedCount++;
        continue;
      }

      const diffYears = (end.getTime() - today) / (1000 * 60 * 60 * 24 * 365.25);
      const newRemaining = Math.max(0, diffYears);

      // Round to 2 decimals for cleaner storage
      const rounded = Math.round(newRemaining * 100) / 100;

      const { error: updateErr } = await supabase
        .from('tenants')
        .update({ remaining_lease_years: rounded })
        .eq('id', t.id);

      if (updateErr) {
        console.error(`Failed to update tenant ${t.id}:`, updateErr);
        skippedCount++;
        continue;
      }

      updatedCount++;
    }

    return NextResponse.json({
      ok: true,
      updatedCount,
      skippedCount,
      totalTenants: tenants?.length || 0,
    });
  } catch (err) {
    console.error('recalc-tenant-remaining error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}