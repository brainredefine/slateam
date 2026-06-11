import { NextRequest, NextResponse } from 'next/server';
import { getDocuments, getPortfolios, getPortfolioWithData } from '@/lib/database';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view');
    const portfolioId = searchParams.get('portfolioId');
    // 'true' → only archived; 'false' or absent → only active (default)
    const archivedParam = searchParams.get('archived');

    // Get specific portfolio with all data
    if (portfolioId) {
      const data = await getPortfolioWithData(portfolioId);
      if (!data) {
        return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data });
    }

    // List views
    switch (view) {
      case 'portfolios': {
        const all = await getPortfolios();
        // Filter by archived_at (active vs archived). We filter here so we
        // don't need to touch lib/database.getPortfolios().
        const filtered = archivedParam === 'true'
          ? (all || []).filter((p: any) => p.archived_at != null)
          : (all || []).filter((p: any) => p.archived_at == null);
        return NextResponse.json({ success: true, data: filtered });
      }

      case 'assets': {
        const { data } = await supabaseAdmin.from('assets').select('*').order('city');
        return NextResponse.json({ success: true, data: data || [] });
      }

      case 'tenants': {
        const { data } = await supabaseAdmin.from('tenants').select('*').order('annual_rent', { ascending: false });
        return NextResponse.json({ success: true, data: data || [] });
      }

      case 'documents':
      default:
        return NextResponse.json({ success: true, data: await getDocuments() });
    }

  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// PATCH - Update a single field
export async function PATCH(req: NextRequest) {
  try {
    const { table, id, field, value } = await req.json();

    // Validate table
    if (!['portfolios', 'assets', 'tenants'].includes(table)) {
      return NextResponse.json({ success: false, error: 'Invalid table' }, { status: 400 });
    }

    // Update the field
    const { error } = await supabaseAdmin
      .from(table)
      .update({ [field]: value })
      .eq('id', id);

    if (error) throw error;

    // Recalculate computed fields and get updated record
    const updatedRecord = await recalculateComputedFields(table, id);

    return NextResponse.json({ success: true, record: updatedRecord });

  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// Recalculate computed fields after an update
async function recalculateComputedFields(table: string, id: string) {
  if (table === 'tenants') {
    const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('id', id).single();
    if (!tenant) return null;

    const updates: Record<string, unknown> = {};

    // monthly_rent ↔ annual_rent
    if (tenant.annual_rent && !tenant.monthly_rent) {
      updates.monthly_rent = tenant.annual_rent / 12;
    }
    if (tenant.monthly_rent && !tenant.annual_rent) {
      updates.annual_rent = tenant.monthly_rent * 12;
    }

    // rent_per_sqm = loyer mensuel / m² = annual_rent / 12 / leased_area
    const annualRent = tenant.annual_rent || (tenant.monthly_rent ? tenant.monthly_rent * 12 : null);
    if (annualRent && tenant.leased_area) {
      updates.rent_per_sqm = annualRent / 12 / tenant.leased_area;
    }

    // remaining_lease_years from lease_end
    if (tenant.lease_end) {
      const today = new Date();
      const endDate = new Date(tenant.lease_end);
      const remainingYears = (endDate.getTime() - today.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      updates.remaining_lease_years = remainingYears > 0 ? Math.round(remainingYears * 10) / 10 : 0;
    }

    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from('tenants').update(updates).eq('id', id);
    }

    // Recalculate parent asset WALT and portfolio
    if (tenant.asset_id) {
      // Recalculate asset WALT from its tenants
      const { data: assetTenants } = await supabaseAdmin.from('tenants').select('*').eq('asset_id', tenant.asset_id);
      if (assetTenants && assetTenants.length > 0) {
        const today = new Date();
        let waltSum = 0;
        let rentSum = 0;
        
        for (const t of assetTenants) {
          const rent = t.annual_rent || 0;
          if (rent <= 0) continue;
          
          let remainingYears = t.remaining_lease_years;
          if (!remainingYears && t.lease_end) {
            const endDate = new Date(t.lease_end);
            remainingYears = (endDate.getTime() - today.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
            if (remainingYears < 0) remainingYears = 0;
          }
          
          if (remainingYears && remainingYears > 0) {
            waltSum += remainingYears * rent;
            rentSum += rent;
          }
        }
        
        if (rentSum > 0 && waltSum > 0) {
          await supabaseAdmin.from('assets').update({ walt: waltSum / rentSum }).eq('id', tenant.asset_id);
        }
      }
      
      // Then recalculate portfolio
      const { data: asset } = await supabaseAdmin.from('assets').select('portfolio_id').eq('id', tenant.asset_id).single();
      if (asset?.portfolio_id) {
        await recalculatePortfolio(asset.portfolio_id);
      }
    }

    const { data: updated } = await supabaseAdmin.from('tenants').select('*').eq('id', id).single();
    return updated;
  }

  if (table === 'assets') {
    const { data: asset } = await supabaseAdmin.from('assets').select('*').eq('id', id).single();
    if (!asset) return null;

    const updates: Record<string, unknown> = {};

    // monthly_rent ↔ annual_rent
    if (asset.annual_rent && !asset.monthly_rent) {
      updates.monthly_rent = asset.annual_rent / 12;
    }
    if (asset.monthly_rent && !asset.annual_rent) {
      updates.annual_rent = asset.monthly_rent * 12;
    }

    const annualRent = asset.annual_rent || (asset.monthly_rent ? asset.monthly_rent * 12 : null);

    // rent_per_sqm = loyer mensuel / m² = annual_rent / 12 / gla
    if (annualRent && asset.gla) {
      updates.rent_per_sqm = annualRent / 12 / asset.gla;
    }

    // price_per_sqm
    if (asset.purchase_price && asset.gla) {
      updates.price_per_sqm = asset.purchase_price / asset.gla;
    }

    // yield_percent = annual_rent / purchase_price * 100
    if (annualRent && asset.purchase_price) {
      updates.yield_percent = (annualRent / asset.purchase_price) * 100;
    }

    // WALT - calculate from tenants if not already set
    if (!asset.walt) {
      const { data: tenants } = await supabaseAdmin.from('tenants').select('*').eq('asset_id', id);
      if (tenants && tenants.length > 0) {
        const today = new Date();
        let waltSum = 0;
        let rentSum = 0;
        
        for (const t of tenants) {
          const rent = t.annual_rent || 0;
          if (rent <= 0) continue;
          
          // Use remaining_lease_years if available, otherwise calculate from lease_end
          let remainingYears = t.remaining_lease_years;
          if (!remainingYears && t.lease_end) {
            const endDate = new Date(t.lease_end);
            remainingYears = (endDate.getTime() - today.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
            if (remainingYears < 0) remainingYears = 0;
          }
          
          if (remainingYears && remainingYears > 0) {
            waltSum += remainingYears * rent;
            rentSum += rent;
          }
        }
        
        if (rentSum > 0 && waltSum > 0) {
          updates.walt = waltSum / rentSum;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from('assets').update(updates).eq('id', id);
    }

    // Update parent portfolio
    if (asset.portfolio_id) {
      await recalculatePortfolio(asset.portfolio_id);
    }

    const { data: updated } = await supabaseAdmin.from('assets').select('*').eq('id', id).single();
    return updated;
  }

  if (table === 'portfolios') {
    await recalculatePortfolio(id);
    const { data: updated } = await supabaseAdmin.from('portfolios').select('*').eq('id', id).single();
    return updated;
  }

  return null;
}

// Recalculate portfolio totals from its assets
async function recalculatePortfolio(portfolioId: string) {
  const { data: portfolio } = await supabaseAdmin.from('portfolios').select('*').eq('id', portfolioId).single();
  if (!portfolio) return;

  const { data: assets } = await supabaseAdmin.from('assets').select('*').eq('portfolio_id', portfolioId);
  
  const updates: Record<string, unknown> = {};

  // Get totals from assets (or use existing portfolio values)
  const totalGla = assets?.reduce((s, a) => s + (a.gla || 0), 0) || portfolio.total_gla || 0;
  const totalRent = assets?.reduce((s, a) => s + (a.annual_rent || 0), 0) || portfolio.annual_rent_income || 0;
  const totalPrice = assets?.reduce((s, a) => s + (a.purchase_price || 0), 0) || 0;
  const totalPlot = assets?.reduce((s, a) => s + (a.plot_area || 0), 0) || 0;
  const totalParking = assets?.reduce((s, a) => s + (a.parking_spaces || 0), 0) || 0;
  const totalParkingUnderground = assets?.reduce((s, a) => s + (a.parking_spaces_underground || 0), 0) || 0;

  // Update aggregates if we have assets
  if (assets && assets.length > 0) {
    if (totalGla > 0) updates.total_gla = totalGla;
    if (totalRent > 0) updates.annual_rent_income = totalRent;
    if (totalPlot > 0) updates.total_plot_area = totalPlot;
    if (totalParking > 0) updates.total_parking_spaces = totalParking;
    if (totalParkingUnderground > 0) updates.total_parking_spaces_underground = totalParkingUnderground;
    updates.number_of_assets = assets.length;
    if (!portfolio.purchase_price && totalPrice > 0) updates.purchase_price = totalPrice;
  }

  // Always recalculate derived metrics using current portfolio values
  const purchasePrice = portfolio.purchase_price || totalPrice;
  const annualRent = portfolio.annual_rent_income || totalRent;
  const gla = portfolio.total_gla || totalGla;

  // rent_per_sqm = loyer mensuel / m² = annual_rent / 12 / gla
  if (annualRent > 0 && gla > 0) {
    updates.rent_per_sqm = annualRent / 12 / gla;
  }

  // yield_percent - ALWAYS recalculate
  if (annualRent > 0 && purchasePrice > 0) {
    updates.yield_percent = (annualRent / purchasePrice) * 100;
  }

  // WALT - first try from assets, then fallback to tenants
  let waltCalculated = false;
  if (assets && assets.length > 0) {
    const waltSum = assets.reduce((s, a) => s + ((a.walt || 0) * (a.annual_rent || 0)), 0);
    if (totalRent > 0 && waltSum > 0) {
      updates.walt = waltSum / totalRent;
      waltCalculated = true;
    }
  }

  // Tenant-based metrics
  const assetIds = assets?.map(a => a.id) || [];
  const { data: tenants } = assetIds.length > 0 
    ? await supabaseAdmin.from('tenants').select('*').in('asset_id', assetIds)
    : { data: [] };

  // If no WALT from assets, calculate from tenants lease_end
  if (!waltCalculated && tenants && tenants.length > 0) {
    const today = new Date();
    let waltSum = 0;
    let rentSum = 0;
    
    for (const t of tenants) {
      const rent = t.annual_rent || 0;
      if (rent <= 0) continue;
      
      // Use remaining_lease_years if available, otherwise calculate from lease_end
      let remainingYears = t.remaining_lease_years;
      if (!remainingYears && t.lease_end) {
        const endDate = new Date(t.lease_end);
        remainingYears = (endDate.getTime() - today.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (remainingYears < 0) remainingYears = 0;
      }
      
      if (remainingYears && remainingYears > 0) {
        waltSum += remainingYears * rent;
        rentSum += rent;
      }
    }
    
    if (rentSum > 0 && waltSum > 0) {
      updates.walt = waltSum / rentSum;
    }
  }
    
  if (tenants && tenants.length > 0) {
    // Occupancy
    if (gla > 0) {
      const leasedArea = tenants.reduce((s, t) => s + (t.leased_area || 0), 0);
      if (leasedArea > 0) updates.occupancy_rate = (leasedArea / gla) * 100;
    }

    // Top tenant (by annual rent)
    if (annualRent > 0) {
      const sortedByRent = [...tenants].sort((a, b) => (b.annual_rent || 0) - (a.annual_rent || 0));
      const topTenant = sortedByRent[0];
      if (topTenant) {
        updates.top_tenant = topTenant.tenant_name;
        if (topTenant.annual_rent) {
          updates.top_tenant_share = (topTenant.annual_rent / annualRent) * 100;
        }
      }
    }

    // LEH percentage
    if (annualRent > 0) {
      const lehSectors = ['leh', 'lebensmittel', 'food', 'supermarket', 'grocery', 'edeka', 'rewe', 'aldi', 'lidl', 'netto', 'penny', 'nahkauf', 'norma', 'kaufland'];
      const lehRent = tenants
        .filter(t => {
          const sector = (t.sector || '').toLowerCase();
          const name = (t.tenant_name || '').toLowerCase();
          return lehSectors.some(s => sector.includes(s) || name.includes(s));
        })
        .reduce((s, t) => s + (t.annual_rent || 0), 0);
      if (lehRent > 0) {
        updates.leh_percentage = (lehRent / annualRent) * 100;
      }
    }
  }

  // --- NEW FINANCIAL METRICS ---

  // NOI propagation from assets → portfolio:
  //   - If ALL assets have a non-null NOI, sum them and overwrite portfolio.noi
  //     (so a change on an asset propagates to the portfolio).
  //   - Else, fall back to derivation from annual_rent × (1 - leakage/100)
  //     when portfolio.noi is missing.
  //   - leakage_percent default 15% only when portfolio.noi is null AND
  //     portfolio.leakage_percent is null AND we have annual_rent.
  let portfolioNoi: number | null = portfolio.noi;
  if (assets && assets.length > 0) {
    const allAssetsHaveNoi = assets.every(a => a.noi !== null && a.noi !== undefined && Number(a.noi) > 0);
    if (allAssetsHaveNoi) {
      const totalAssetNoi = assets.reduce((sum, a) => sum + Number(a.noi || 0), 0);
      portfolioNoi = totalAssetNoi;
      updates.noi = totalAssetNoi;
    }
  }
  if (!portfolioNoi && annualRent > 0) {
    if (portfolio.leakage_percent) {
      portfolioNoi = annualRent * (1 - portfolio.leakage_percent / 100);
    } else {
      portfolioNoi = annualRent * 0.85;
      updates.leakage_percent = 15; // Default
    }
    updates.noi = portfolioNoi;
  }

  // Always keep noi_margin and leakage_percent in sync with portfolioNoi/annualRent.
  // noi_margin = portfolioNoi / annualRent × 100
  // leakage_percent = 100 - noi_margin
  if (portfolioNoi && portfolioNoi > 0 && annualRent > 0) {
    const computedMargin = (portfolioNoi / annualRent) * 100;
    updates.noi_margin = computedMargin;
    updates.leakage_percent = 100 - computedMargin;
  }

  // LTV default 70%
  const ltv = portfolio.ltv || 70;
  if (!portfolio.ltv) {
    updates.ltv = 70;
  }

  // Multiplier = Asking Price / Annual Rent
  if (purchasePrice > 0 && annualRent > 0) {
    updates.multiplier = purchasePrice / annualRent;
  }

  // Cap Rate = NOI / Asking Price (as percentage)
  if (portfolioNoi && portfolioNoi > 0 && purchasePrice > 0) {
    updates.cap_rate = (portfolioNoi / purchasePrice) * 100;
  }

  // Equity Requirement = Asking Price × (1 - LTV/100)
  if (purchasePrice > 0) {
    updates.equity_requirement = purchasePrice * (1 - ltv / 100);
  }

  // Equity on Spot = Spot × (1 - LTV/100)
  if (portfolio.spot && portfolio.spot > 0) {
    updates.equity_on_spot = portfolio.spot * (1 - ltv / 100);
  }

  if (Object.keys(updates).length > 0) {
    await supabaseAdmin.from('portfolios').update(updates).eq('id', portfolioId);
  }
}

// DELETE - Delete a portfolio and all related data
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const portfolioId = searchParams.get('portfolioId');

    if (!portfolioId) {
      return NextResponse.json({ success: false, error: 'portfolioId required' }, { status: 400 });
    }

    // Get all assets for this portfolio
    const { data: assets } = await supabaseAdmin
      .from('assets')
      .select('id')
      .eq('portfolio_id', portfolioId);

    // Delete tenants for these assets
    if (assets && assets.length > 0) {
      const assetIds = assets.map(a => a.id);
      await supabaseAdmin.from('tenants').delete().in('asset_id', assetIds);
      await supabaseAdmin.from('market_data').delete().in('asset_id', assetIds);
    }

    // Delete assets
    await supabaseAdmin.from('assets').delete().eq('portfolio_id', portfolioId);

    // Get document_id before deleting portfolio
    const { data: portfolio } = await supabaseAdmin
      .from('portfolios')
      .select('document_id')
      .eq('id', portfolioId)
      .single();

    // Delete portfolio
    await supabaseAdmin.from('portfolios').delete().eq('id', portfolioId);

    // Delete document if exists
    if (portfolio?.document_id) {
      await supabaseAdmin.from('documents').delete().eq('id', portfolio.document_id);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}