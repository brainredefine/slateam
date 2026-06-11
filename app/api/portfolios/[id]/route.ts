// app/api/portfolios/[id]/route.ts
// =============================================================================
// PATCH: update portfolio fields and recalculate derived metrics.
// DELETE: permanently delete portfolio + its assets + its tenants.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// =============================================================================
// PATCH — Update portfolio fields (for deal tracking + metrics)
// =============================================================================
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: portfolioId } = await params;
    const updates = await req.json();

    // Validate that we're only updating allowed fields
    const allowedFields = [
      'deal_status', 'investment_type', 'exclusivity',
      'bid_submitted', 'actively_uw', 'tracking', 'comparable',
      'spot', 'ltv', 'noi', 'purchase_price', 'name', 'notes',
      'noi_margin', 'leakage_percent', 'multiplier', 'annual_rent_income', 'walt'
    ];

    const filteredUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        filteredUpdates[key] = value;
      }
    }
    if (Object.keys(filteredUpdates).length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    // Update the portfolio
    const { error } = await supabaseAdmin
      .from('portfolios')
      .update(filteredUpdates)
      .eq('id', portfolioId);
    if (error) throw error;

    // 🔥 Recalculate derived fields
    const { data: portfolio } = await supabaseAdmin.from('portfolios').select('*').eq('id', portfolioId).single();

    if (portfolio) {
      const recalcUpdates: Record<string, unknown> = {};

      const ltv = portfolio.ltv || 70;
      const spot = portfolio.spot;
      const askingPrice = portfolio.purchase_price;
      const annualRent = portfolio.annual_rent_income;
      const noi = portfolio.noi;
      const noiMargin = portfolio.noi_margin;
      const leakagePercent = portfolio.leakage_percent;
      const multiplier = portfolio.multiplier;

      // 1. NOI_MARGIN ↔ LEAKAGE_PERCENT (bidirectional)
      if (noiMargin !== null && noiMargin !== undefined && (leakagePercent === null || leakagePercent === undefined)) {
        recalcUpdates.leakage_percent = 100 - noiMargin;
      }
      if (leakagePercent !== null && leakagePercent !== undefined && (noiMargin === null || noiMargin === undefined)) {
        recalcUpdates.noi_margin = 100 - leakagePercent;
      }

      // 2. NOI CALCULATION (from noi_margin or leakage_percent)
      const finalNoiMargin = recalcUpdates.noi_margin || noiMargin;
      const finalLeakagePercent = recalcUpdates.leakage_percent || leakagePercent;

      if (annualRent && !noi) {
        if (finalNoiMargin !== null && finalNoiMargin !== undefined) {
          recalcUpdates.noi = annualRent * (Number(finalNoiMargin) / 100);
        } else if (finalLeakagePercent !== null && finalLeakagePercent !== undefined) {
          recalcUpdates.noi = annualRent * (1 - Number(finalLeakagePercent) / 100);
        }
      }

      // 3. MULTIPLIER ↔ PURCHASE_PRICE (bidirectional)
      const finalMultiplier = recalcUpdates.multiplier || multiplier;
      const finalAskingPrice = recalcUpdates.purchase_price || askingPrice;

      if ('multiplier' in filteredUpdates && annualRent && finalMultiplier) {
        recalcUpdates.purchase_price = Number(finalMultiplier) * annualRent;
      }
      if ('purchase_price' in filteredUpdates && annualRent && annualRent > 0 && finalAskingPrice) {
        recalcUpdates.multiplier = Number(finalAskingPrice) / annualRent;
      }
      if ('annual_rent_income' in filteredUpdates && annualRent && annualRent > 0) {
        if (finalMultiplier) {
          recalcUpdates.purchase_price = Number(finalMultiplier) * annualRent;
        }
        if (finalAskingPrice) {
          recalcUpdates.multiplier = Number(finalAskingPrice) / annualRent;
        }
      }

      // 4. EQUITY ON SPOT (when spot or ltv changes)
      if (spot) {
        recalcUpdates.equity_on_spot = spot * (1 - ltv / 100);
      }

      // 5. CAP RATE (NOI / Spot or Asking Price)
      const finalNoi = recalcUpdates.noi || noi;
      const priceForCapRate = spot || finalAskingPrice;
      if (finalNoi && priceForCapRate) {
        recalcUpdates.cap_rate = (Number(finalNoi) / Number(priceForCapRate)) * 100;
      }

      // 6. PRICE PER SQM
      if (finalAskingPrice && portfolio.total_gla) {
        recalcUpdates.price_per_sqm = Number(finalAskingPrice) / portfolio.total_gla;
      }

      // Update with recalculated fields
      if (Object.keys(recalcUpdates).length > 0) {
        console.log('🔄 Recalculating derived fields:', recalcUpdates);
        await supabaseAdmin.from('portfolios').update(recalcUpdates).eq('id', portfolioId);
      }
    }

    // Return updated portfolio
    const { data: updated } = await supabaseAdmin.from('portfolios').select('*').eq('id', portfolioId).single();
    return NextResponse.json({ success: true, portfolio: updated });
  } catch (error) {
    console.error('Portfolio update error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// =============================================================================
// DELETE — Permanently remove portfolio + its assets + its tenants
// =============================================================================
// We delete explicitly (tenants → assets → portfolio) so this works
// regardless of whether the schema has ON DELETE CASCADE constraints.
// =============================================================================
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: portfolioId } = await params;

    // Find all assets of the portfolio (we need their ids to delete linked tenants)
    const { data: assets, error: assetsErr } = await supabaseAdmin
      .from('assets')
      .select('id')
      .eq('portfolio_id', portfolioId);
    if (assetsErr) throw assetsErr;

    const assetIds = (assets || []).map(a => a.id);

    // Delete tenants linked via asset_id
    if (assetIds.length > 0) {
      const { error: tenantsByAssetErr } = await supabaseAdmin
        .from('tenants')
        .delete()
        .in('asset_id', assetIds);
      if (tenantsByAssetErr) throw tenantsByAssetErr;
    }

    // Delete tenants linked via portfolio_id (denormalized column)
    const { error: tenantsByPidErr } = await supabaseAdmin
      .from('tenants')
      .delete()
      .eq('portfolio_id', portfolioId);
    if (tenantsByPidErr) throw tenantsByPidErr;

    // Delete assets
    const { error: assetsDelErr } = await supabaseAdmin
      .from('assets')
      .delete()
      .eq('portfolio_id', portfolioId);
    if (assetsDelErr) throw assetsDelErr;

    // Delete the portfolio itself
    const { error: portfolioErr } = await supabaseAdmin
      .from('portfolios')
      .delete()
      .eq('id', portfolioId);
    if (portfolioErr) throw portfolioErr;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Portfolio delete error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}