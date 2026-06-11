// app/api/portfolios/[id]/recalc-from-children/route.ts
// =============================================================================
// Recompute portfolio or asset fields from their children.
//
// Scopes:
//   - scope=assets    → GET returns a detailed per-asset breakdown:
//                       for each asset, proposed values + the list of tenants
//                       that contributed to each computation.
//   - scope=portfolio → GET returns the portfolio recalc preview as before.
//
// POST accepts a JSON body { selections: [{ assetId, fields: ['gla','annual_rent','walt'] }] }
// to apply only the user-selected fields per asset. For scope=portfolio,
// POST body is { fields: ['total_gla', 'multiplier', ...] }.
//
// New: if a tenant has lease_end but no remaining_lease_years, we
// compute remaining = max(0, (lease_end - today) / 365.25). This is used
// for WALT/asset.walt calculations.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
const hasNum = (v: unknown): v is number =>
  typeof v === 'number' && !isNaN(v) && v > 0;

const VACANT_RE = /\b(vacant|vacancy|empty|libre|free|to\s*let|disponible|non[-\s]lou[ée])\b/i;
const isVacant = (t: { tenant_name?: string | null; brand?: string | null; is_vacant?: boolean | null }): boolean => {
  if (t.is_vacant === true) return true;
  if (t.tenant_name && VACANT_RE.test(t.tenant_name)) return true;
  if (t.brand && VACANT_RE.test(t.brand)) return true;
  return false;
};

// Compute "remaining lease years" for a tenant. If `remaining_lease_years` is
// already set, use it. Otherwise, derive from `lease_end` if present.
function effectiveRemaining(t: any): { value: number; source: 'stored' | 'computed' } | null {
  if (hasNum(t.remaining_lease_years)) {
    return { value: t.remaining_lease_years, source: 'stored' };
  }
  if (t.lease_end) {
    const end = new Date(t.lease_end);
    if (!isNaN(end.getTime())) {
      const today = new Date();
      const diffYears = (end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      if (diffYears > 0) {
        return { value: diffYears, source: 'computed' };
      }
    }
  }
  return null;
}

// Weighted WALT computation with fallback weighting.
// Tries weights in order: primary (e.g. rent) → fallback (e.g. gla).
// Returns { walt, weightSource } or null if no usable weighting is available.
//
// Each item has shape { walt: number, primaryWeight?: number, fallbackWeight?: number }
function weightedWalt<T extends { walt: number; primaryWeight?: number | null; fallbackWeight?: number | null }>(
  items: T[]
): { walt: number; weightSource: 'primary' | 'fallback' | 'unweighted' } | null {
  if (items.length === 0) return null;

  // Path 1: primary weights (e.g. rent)
  const withPrimary = items.filter(i => typeof i.primaryWeight === 'number' && i.primaryWeight > 0);
  const totalPrimary = withPrimary.reduce((s, i) => s + (i.primaryWeight as number), 0);
  if (withPrimary.length > 0 && totalPrimary > 0) {
    return {
      walt: withPrimary.reduce((s, i) => s + (i.primaryWeight as number) * i.walt, 0) / totalPrimary,
      weightSource: 'primary',
    };
  }

  // Path 2: fallback weights (e.g. gla)
  const withFallback = items.filter(i => typeof i.fallbackWeight === 'number' && i.fallbackWeight > 0);
  const totalFallback = withFallback.reduce((s, i) => s + (i.fallbackWeight as number), 0);
  if (withFallback.length > 0 && totalFallback > 0) {
    return {
      walt: withFallback.reduce((s, i) => s + (i.fallbackWeight as number) * i.walt, 0) / totalFallback,
      weightSource: 'fallback',
    };
  }

  // Path 3: simple average (no weights at all)
  return {
    walt: items.reduce((s, i) => s + i.walt, 0) / items.length,
    weightSource: 'unweighted',
  };
}

// ─── Fetch all data ──────────────────────────────────────────────────────────
async function fetchPortfolioData(portfolioId: string) {
  const [portfolioRes, assetsRes] = await Promise.all([
    supabase.from('portfolios').select('*').eq('id', portfolioId).single(),
    supabase.from('assets').select('*').eq('portfolio_id', portfolioId),
  ]);

  if (portfolioRes.error) throw portfolioRes.error;
  if (assetsRes.error) throw assetsRes.error;

  const portfolio = portfolioRes.data;
  const assets = assetsRes.data || [];
  const assetIds = assets.map((a: any) => a.id);

  // Two paths: tenants linked via portfolio_id OR via asset_id
  const [tenantsByPidRes, tenantsByAssetRes] = await Promise.all([
    supabase.from('tenants').select('*').eq('portfolio_id', portfolioId),
    assetIds.length > 0
      ? supabase.from('tenants').select('*').in('asset_id', assetIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (tenantsByPidRes.error) throw tenantsByPidRes.error;
  if (tenantsByAssetRes.error) throw tenantsByAssetRes.error;

  const tenantMap = new Map<string, any>();
  for (const t of (tenantsByPidRes.data || [])) tenantMap.set(t.id, t);
  for (const t of (tenantsByAssetRes.data || [])) tenantMap.set(t.id, t);
  const tenants = Array.from(tenantMap.values());

  return { portfolio, assets, tenants };
}

// =============================================================================
// SCOPE = ASSETS — Detailed per-asset breakdown
// =============================================================================
interface TenantContribution {
  id: string;
  name: string;
  is_vacant: boolean;
  value: number;
  source?: 'stored' | 'computed'; // only for remaining (WALT)
  lease_end?: string | null;
}

interface AssetRecalcDetail {
  id: string;
  name: string;
  // current values
  current: {
    gla: number | null;
    annual_rent: number | null;
    walt: number | null;
  };
  // proposed values (undefined = not computable)
  proposed: {
    gla?: number;
    annual_rent?: number;
    walt?: number;
  };
  // tenants that contributed, per field
  contributions: {
    gla: TenantContribution[];
    annual_rent: TenantContribution[];
    walt: TenantContribution[];
  };
  // all tenants of this asset (for context)
  allTenants: Array<{
    id: string;
    name: string;
    is_vacant: boolean;
    gla: number | null;
    annual_rent: number | null;
    remaining_lease_years: number | null;
    lease_end: string | null;
    has_computed_remaining: boolean; // true if we'd derive from lease_end
  }>;
  tenantCount: number;
}

async function computeAssetsRecalc(portfolioId: string): Promise<{
  assets: AssetRecalcDetail[];
  coverage: {
    totalAssets: number;
    assetsWithTenants: number;
    assetsWithChanges: number;
  };
}> {
  const { assets, tenants } = await fetchPortfolioData(portfolioId);

  const details: AssetRecalcDetail[] = [];

  for (const asset of assets) {
    const assetTenants = tenants.filter((t: any) => t.asset_id === asset.id);
    const nonVacant = assetTenants.filter((t: any) => !isVacant(t));

    // ─── GLA contributions ────────────────────────────────────────────────
    // NOTE: on the `tenants` table the column is `leased_area`, not `gla`.
    // We read leased_area from each tenant but expose it under `value` so the
    // rest of the pipeline treats it consistently as a GLA contribution.
    const glaContribs: TenantContribution[] = assetTenants
      .filter((t: any) => hasNum(t.leased_area))
      .map((t: any) => ({
        id: t.id,
        name: t.tenant_name || t.brand || '(unnamed)',
        is_vacant: isVacant(t),
        value: t.leased_area,
      }));

    // ─── Annual rent contributions (non-vacant only) ──────────────────────
    const rentContribs: TenantContribution[] = nonVacant
      .filter((t: any) => hasNum(t.annual_rent))
      .map((t: any) => ({
        id: t.id,
        name: t.tenant_name || t.brand || '(unnamed)',
        is_vacant: false,
        value: t.annual_rent,
      }));

    // ─── WALT contributions (need both rent + remaining) ──────────────────
    const waltContribs: TenantContribution[] = [];
    for (const t of nonVacant) {
      // Don't require rent here — the weighting layer will fall back to
      // leased_area if rent is missing.
      const remaining = effectiveRemaining(t);
      if (!remaining) continue;
      waltContribs.push({
        id: t.id,
        name: t.tenant_name || t.brand || '(unnamed)',
        is_vacant: false,
        value: remaining.value,
        source: remaining.source,
        lease_end: t.lease_end,
      });
    }

    // ─── Compute proposed values ──────────────────────────────────────────
    const proposed: AssetRecalcDetail['proposed'] = {};
    if (glaContribs.length > 0) {
      proposed.gla = glaContribs.reduce((s, c) => s + c.value, 0);
    }
    if (rentContribs.length > 0) {
      proposed.annual_rent = rentContribs.reduce((s, c) => s + c.value, 0);
    }
    if (waltContribs.length > 0) {
      // Find matching tenant for each contribution to get its rent (primary)
      // and leased_area (fallback) weights.
      const tenantById = new Map(nonVacant.map((t: any) => [t.id, t]));
      const items = waltContribs.map(c => {
        const t = tenantById.get(c.id) as any;
        return {
          walt: c.value,
          primaryWeight: hasNum(t?.annual_rent) ? (t.annual_rent as number) : null,
          fallbackWeight: hasNum(t?.leased_area) ? (t.leased_area as number) : null,
        };
      });
      const computed = weightedWalt(items);
      if (computed) {
        proposed.walt = computed.walt;
      }
    }

    // ─── All tenants for context display ──────────────────────────────────
    const allTenantsList = assetTenants.map((t: any) => {
      const rem = effectiveRemaining(t);
      return {
        id: t.id,
        name: t.tenant_name || t.brand || '(unnamed)',
        is_vacant: isVacant(t),
        gla: hasNum(t.leased_area) ? t.leased_area : null,
        annual_rent: hasNum(t.annual_rent) ? t.annual_rent : null,
        remaining_lease_years: hasNum(t.remaining_lease_years) ? t.remaining_lease_years : null,
        lease_end: t.lease_end || null,
        has_computed_remaining: !hasNum(t.remaining_lease_years) && rem !== null,
      };
    });

    details.push({
      id: asset.id,
      name: asset.name || asset.city || asset.street || '(unnamed)',
      current: {
        gla: hasNum(asset.gla) ? asset.gla : null,
        annual_rent: hasNum(asset.annual_rent) ? asset.annual_rent : null,
        walt: hasNum(asset.walt) ? asset.walt : null,
      },
      proposed,
      contributions: {
        gla: glaContribs,
        annual_rent: rentContribs,
        walt: waltContribs,
      },
      allTenants: allTenantsList,
      tenantCount: assetTenants.length,
    });
  }

  // Coverage
  const totalAssets = assets.length;
  const assetsWithTenants = details.filter(d => d.tenantCount > 0).length;
  const assetsWithChanges = details.filter(d => {
    if (proposedChanges(d.proposed.gla, d.current.gla)) return true;
    if (proposedChanges(d.proposed.annual_rent, d.current.annual_rent)) return true;
    if (proposedChanges(d.proposed.walt, d.current.walt)) return true;
    return false;
  }).length;

  return {
    assets: details,
    coverage: { totalAssets, assetsWithTenants, assetsWithChanges },
  };
}

function proposedChanges(after: number | undefined, before: number | null): boolean {
  if (after === undefined) return false;
  if (before === null || !hasNum(before)) return true;
  return Math.abs(after - before) / Math.max(Math.abs(after), 1) > 0.001;
}

// =============================================================================
// SCOPE = PORTFOLIO — Same as before
// =============================================================================
async function computePortfolioRecalc(portfolioId: string) {
  const { portfolio, assets, tenants } = await fetchPortfolioData(portfolioId);
  const nonVacantTenants = tenants.filter((t: any) => !isVacant(t));

  const assetGlaValues = assets.map((a: any) => a.gla).filter((v: any) => hasNum(v));
  const assetRentValues = assets.map((a: any) => a.annual_rent).filter((v: any) => hasNum(v));

  const newTotalGla = assetGlaValues.length > 0
    ? assetGlaValues.reduce((s: number, v: number) => s + v, 0)
    : undefined;

  let newAnnualRent: number | undefined;
  if (assetRentValues.length > 0) {
    newAnnualRent = assetRentValues.reduce((s: number, v: number) => s + v, 0);
  } else {
    const tenantsWithRent = nonVacantTenants.filter((t: any) => hasNum(t.annual_rent));
    if (tenantsWithRent.length > 0) {
      newAnnualRent = tenantsWithRent.reduce((s: number, t: any) => s + (t.annual_rent as number), 0);
    }
  }

  const newNumberOfAssets = assets.length;

  // WALT: rent-weighted (preferred) or GLA-weighted (fallback) remaining lease.
  //
  // Cascading sources:
  //   1. Tenants with remaining lease — weight by rent, fallback to leased_area
  //   2. Assets with walt — weight by annual_rent, fallback to gla
  //
  // We always try the tenant path first because it's more granular.
  let newWalt: number | undefined;

  // Path 1: tenants
  const tenantWaltItems = nonVacantTenants
    .map((t: any) => {
      const rem = effectiveRemaining(t);
      if (!rem) return null;
      return {
        walt: rem.value,
        primaryWeight: hasNum(t.annual_rent) ? (t.annual_rent as number) : null,
        fallbackWeight: hasNum(t.leased_area) ? (t.leased_area as number) : null,
      };
    })
    .filter((x: any): x is { walt: number; primaryWeight: number | null; fallbackWeight: number | null } => x !== null);

  if (tenantWaltItems.length > 0) {
    const computed = weightedWalt(tenantWaltItems);
    if (computed) newWalt = computed.walt;
  }

  // Path 2: assets (only if tenants didn't give us anything)
  if (newWalt === undefined) {
    const assetWaltItems = assets
      .filter((a: any) => hasNum(a.walt))
      .map((a: any) => ({
        walt: a.walt as number,
        primaryWeight: hasNum(a.annual_rent) ? (a.annual_rent as number) : null,
        fallbackWeight: hasNum(a.gla) ? (a.gla as number) : null,
      }));

    if (assetWaltItems.length > 0) {
      const computed = weightedWalt(assetWaltItems);
      if (computed) newWalt = computed.walt;
    }
  }

  const totalRentAll = tenants.reduce((s: number, t: any) => s + (t.annual_rent || 0), 0);
  const nonVacantRent = nonVacantTenants.reduce((s: number, t: any) => s + (t.annual_rent || 0), 0);
  const newOccupancy = totalRentAll > 0 ? (nonVacantRent / totalRentAll) * 100 : undefined;

  const lehTagged = tenants.filter((t: any) => t.is_leh !== null && t.is_leh !== undefined);
  let newLehPercentage: number | undefined = undefined;
  if (lehTagged.length >= tenants.length * 0.7 && totalRentAll > 0) {
    const lehRent = tenants.filter((t: any) => t.is_leh).reduce((s: number, t: any) => s + (t.annual_rent || 0), 0);
    newLehPercentage = (lehRent / totalRentAll) * 100;
  }

  let newTopTenant: string | undefined = undefined;
  let newTopTenantShare: number | undefined = undefined;
  const tenantsWithRent = nonVacantTenants.filter((t: any) => hasNum(t.annual_rent));
  if (tenantsWithRent.length > 0) {
    const top = [...tenantsWithRent].sort((a: any, b: any) => (b.annual_rent || 0) - (a.annual_rent || 0))[0];
    newTopTenant = top.tenant_name || top.brand || undefined;
    if (newTopTenant && nonVacantRent > 0) {
      newTopTenantShare = ((top.annual_rent || 0) / nonVacantRent) * 100;
    }
  }

  const purchasePrice = portfolio.purchase_price;
  const spot = portfolio.spot;
  const equity = portfolio.equity_on_spot;
  const noi = portfolio.noi;

  const newMultiplier = hasNum(purchasePrice) && hasNum(newAnnualRent)
    ? (purchasePrice as number) / (newAnnualRent as number) : undefined;
  const newCapRate = hasNum(noi) && hasNum(purchasePrice)
    ? ((noi as number) / (purchasePrice as number)) * 100 : undefined;
  const newNoiMargin = hasNum(noi) && hasNum(newAnnualRent)
    ? ((noi as number) / (newAnnualRent as number)) * 100 : undefined;
  const newLtv = hasNum(spot) && hasNum(equity)
    ? (((spot as number) - (equity as number)) / (spot as number)) * 100 : undefined;
  const newPricePerSqm = hasNum(purchasePrice) && hasNum(newTotalGla)
    ? (purchasePrice as number) / (newTotalGla as number) : undefined;
  const newRentPerSqm = hasNum(newAnnualRent) && hasNum(newTotalGla)
    ? (newAnnualRent as number) / (newTotalGla as number) / 12 : undefined;

  const proposedPortfolio: Record<string, number | string | undefined> = {
    total_gla: newTotalGla,
    annual_rent_income: newAnnualRent,
    number_of_assets: newNumberOfAssets,
    walt: newWalt,
    occupancy_rate: newOccupancy,
    leh_percentage: newLehPercentage,
    top_tenant: newTopTenant,
    top_tenant_share: newTopTenantShare,
    multiplier: newMultiplier,
    cap_rate: newCapRate,
    noi_margin: newNoiMargin,
    ltv: newLtv,
    price_per_sqm: newPricePerSqm,
    rent_per_sqm: newRentPerSqm,
  };

  const FIELD_LABELS: Record<string, string> = {
    total_gla: 'Total GLA',
    annual_rent_income: 'Annual rent income',
    number_of_assets: 'Number of assets',
    walt: 'WALT',
    occupancy_rate: 'Occupancy rate',
    leh_percentage: 'LEH percentage',
    top_tenant: 'Top tenant',
    top_tenant_share: 'Top tenant share',
    multiplier: 'Multiplier',
    cap_rate: 'Cap rate',
    noi_margin: 'NOI margin',
    ltv: 'LTV',
    price_per_sqm: 'Price / m²',
    rent_per_sqm: 'Rent / m²/mo',
  };

  const diff: Array<{
    field: string;
    label: string;
    before: number | string | null;
    after: number | string;
    changed: boolean;
  }> = [];

  for (const [field, after] of Object.entries(proposedPortfolio)) {
    if (after === undefined) continue;
    const before = portfolio[field] ?? null;
    let changed = false;
    if (typeof after === 'number' && typeof before === 'number') {
      changed = Math.abs(after - before) / Math.max(Math.abs(after), 1) > 0.001;
    } else {
      changed = before !== after;
    }
    diff.push({ field, label: FIELD_LABELS[field] || field, before, after, changed });
  }

  const totalAssets = assets.length;
  const assetsWithGla = assets.filter((a: any) => hasNum(a.gla)).length;
  const assetsWithRent = assets.filter((a: any) => hasNum(a.annual_rent)).length;
  const assetsWithWalt = assets.filter((a: any) => hasNum(a.walt)).length;
  const tenantsWithRentCount = nonVacantTenants.filter((t: any) => hasNum(t.annual_rent)).length;
  const tenantsWithLeaseCount = nonVacantTenants.filter((t: any) => effectiveRemaining(t) !== null).length;

  // Lease coverage: if we have tenant data, report from tenants; otherwise
  // report from assets (since that's the source we'll actually use for WALT).
  let leaseCoveragePct: number;
  let leaseCoverageSource: 'tenants' | 'assets' | 'none';
  if (nonVacantTenants.length > 0 && tenantsWithLeaseCount > 0) {
    leaseCoveragePct = (tenantsWithLeaseCount / nonVacantTenants.length) * 100;
    leaseCoverageSource = 'tenants';
  } else if (totalAssets > 0 && assetsWithWalt > 0) {
    leaseCoveragePct = (assetsWithWalt / totalAssets) * 100;
    leaseCoverageSource = 'assets';
  } else {
    leaseCoveragePct = nonVacantTenants.length > 0 ? 0 : 100;
    leaseCoverageSource = 'none';
  }

  return {
    proposedPortfolio,
    diff,
    coverage: {
      totalAssets,
      assetsWithGla,
      assetsWithRent,
      assetsWithWalt,
      totalTenants: tenants.length,
      nonVacantTenants: nonVacantTenants.length,
      tenantsWithRent: tenantsWithRentCount,
      tenantsWithLease: tenantsWithLeaseCount,
      glaCoveragePct: totalAssets > 0 ? (assetsWithGla / totalAssets) * 100 : 100,
      rentCoveragePct: totalAssets > 0 ? (assetsWithRent / totalAssets) * 100 : 100,
      leaseCoveragePct,
      leaseCoverageSource,
    },
  };
}

// =============================================================================
// GET — preview
// =============================================================================
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope') || 'portfolio';

    if (scope === 'assets') {
      const result = await computeAssetsRecalc(id);
      return NextResponse.json({ scope: 'assets', ...result });
    } else {
      const { diff, coverage } = await computePortfolioRecalc(id);
      return NextResponse.json({ scope: 'portfolio', diff, coverage });
    }
  } catch (err) {
    console.error('recalc preview error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// =============================================================================
// POST — commit (selective)
// =============================================================================
// Body for scope=assets:
//   { selections: [{ assetId: string, fields: ('gla'|'annual_rent'|'walt')[] }] }
// Body for scope=portfolio:
//   { fields: string[] }  // list of field names to apply (e.g. ['total_gla','multiplier'])
// =============================================================================
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope') || 'portfolio';
    const body = await req.json().catch(() => ({}));

    if (scope === 'assets') {
      const { assets } = await computeAssetsRecalc(id);
      const selections: Array<{ assetId: string; fields: string[] }> = body.selections || [];

      if (selections.length === 0) {
        return NextResponse.json({ error: 'No selections provided' }, { status: 400 });
      }

      let writtenCount = 0;
      for (const sel of selections) {
        const detail = assets.find(a => a.id === sel.assetId);
        if (!detail) continue;
        const update: Record<string, number> = {};
        for (const f of sel.fields) {
          if (f === 'gla' && detail.proposed.gla !== undefined) update.gla = detail.proposed.gla;
          if (f === 'annual_rent' && detail.proposed.annual_rent !== undefined) update.annual_rent = detail.proposed.annual_rent;
          if (f === 'walt' && detail.proposed.walt !== undefined) update.walt = detail.proposed.walt;
        }
        if (Object.keys(update).length > 0) {
          await supabase.from('assets').update(update).eq('id', sel.assetId);
          writtenCount++;
        }
      }
      return NextResponse.json({ ok: true, scope: 'assets', writtenCount });
    } else {
      const { proposedPortfolio, diff, coverage } = await computePortfolioRecalc(id);
      const selectedFields: string[] = body.fields || [];

      const portfolioUpdate: Record<string, number | string> = {};
      const fieldsToApply = selectedFields.length > 0
        ? selectedFields
        : Object.keys(proposedPortfolio); // fallback: all if no selection

      for (const field of fieldsToApply) {
        const value = proposedPortfolio[field];
        if (value !== undefined && value !== null) {
          portfolioUpdate[field] = value;
        }
      }

      if (Object.keys(portfolioUpdate).length > 0) {
        await supabase.from('portfolios').update(portfolioUpdate).eq('id', id);
      }

      return NextResponse.json({ ok: true, scope: 'portfolio', diff, coverage, applied: portfolioUpdate });
    }
  } catch (err) {
    console.error('recalc commit error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}