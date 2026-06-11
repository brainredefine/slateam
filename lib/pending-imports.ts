// lib/pending-imports.ts
import { supabaseAdmin } from './supabase';
import { createAssets, createTenants, createExtractionLog, enrichTenant, importTenantsForAssets } from './database';
import { normalizeGerman, normalizeCity, normalizeStreet, containsWords } from './text-normalize';

// ============================================
// TYPES
// ============================================
export interface PendingImport {
  id: string;
  type: 'asset-list' | 'tenant-list';
  status: 'pending_match' | 'pending_review' | 'resolved' | 'rejected';
  issue_type: 'no_match' | 'multiple_matches' | 'existing_data' | 'ambiguous_city' | 'multi_asset_tenants' | null;
  raw_data: {
    assets?: Record<string, unknown>[];
    tenants?: Record<string, unknown>[];
    portfolio?: Record<string, unknown>;
    emailContact?: Record<string, unknown>;
    documentContact?: Record<string, unknown>;
    summary?: string;
  };
  file_name: string | null;
  email_message_id: string | null;
  email_context: string | null;
  forwarder_notes: string | null;
  target_name: string | null;
  suggested_portfolio_id: string | null;
  suggested_asset_id: string | null;
  match_candidates: MatchCandidate[];
  city_asset_mapping: Record<string, AssetCandidate[]>;
  confirmed_portfolio_id: string | null;
  confirmed_asset_id: string | null;
  confirmed_city_mapping: Record<string, string> | null;
  merge_strategy: 'replace' | 'append' | null;
  created_at: string;
  resolved_at: string | null;
}

export interface MatchCandidate {
  id: string;
  name: string;
  city?: string;
  street?: string;
  gla?: number;
  score: number;
  type: 'portfolio' | 'asset';
}

export interface AssetCandidate {
  asset_id: string;
  name?: string;
  street?: string;
  gla?: number;
  annual_rent?: number;
  tenant_count?: number;
}

// ============================================
// CREATE PENDING IMPORT
// ============================================
export async function createPendingImport(data: {
  type: 'asset-list' | 'tenant-list';
  status: 'pending_match' | 'pending_review';
  issue_type: PendingImport['issue_type'];
  raw_data: PendingImport['raw_data'];
  file_name?: string;
  email_message_id?: string;
  email_context?: string;
  forwarder_notes?: string;
  target_name?: string;
  suggested_portfolio_id?: string;
  suggested_asset_id?: string;
  match_candidates?: MatchCandidate[];
  city_asset_mapping?: Record<string, AssetCandidate[]>;
}): Promise<PendingImport> {
  const { data: result, error } = await supabaseAdmin
    .from('pending_imports')
    .insert({
      type: data.type,
      status: data.status,
      issue_type: data.issue_type,
      raw_data: data.raw_data,
      file_name: data.file_name || null,
      email_message_id: data.email_message_id || null,
      email_context: data.email_context || null,
      forwarder_notes: data.forwarder_notes || null,
      target_name: data.target_name || null,
      suggested_portfolio_id: data.suggested_portfolio_id || null,
      suggested_asset_id: data.suggested_asset_id || null,
      match_candidates: data.match_candidates || [],
      city_asset_mapping: data.city_asset_mapping || {},
    })
    .select()
    .single();

  if (error) throw error;
  return result as PendingImport;
}

// ============================================
// GET PENDING IMPORTS
// ============================================
export async function getPendingImports(statusFilter?: string): Promise<PendingImport[]> {
  let query = supabaseAdmin
    .from('pending_imports')
    .select('*')
    .order('created_at', { ascending: false });

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  } else {
    // By default, show non-resolved
    query = query.in('status', ['pending_match', 'pending_review']);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as PendingImport[];
}

// ============================================
// GET PENDING COUNT (for badge)
// ============================================
export async function getPendingCount(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('pending_imports')
    .select('*', { count: 'exact', head: true })
    .in('status', ['pending_match', 'pending_review']);

  if (error) throw error;
  return count || 0;
}

// ============================================
// FUZZY MATCH PORTFOLIO BY NAME
// ============================================
export async function fuzzyMatchPortfolio(targetName: string): Promise<MatchCandidate[]> {
  if (!targetName || targetName.trim().length < 2) return [];

  const { data: portfolios } = await supabaseAdmin
    .from('portfolios')
    .select('id, name, total_gla, annual_rent_income, number_of_assets')
    .order('created_at', { ascending: false })
    .limit(300);

  if (!portfolios || portfolios.length === 0) return [];

  // German-aware normalization (ß/ss, umlauts, Straße/Str., punctuation)
  // + whole-word containment so "burg" never matches "neuburg".
  const target = normalizeGerman(targetName);
  if (!target) return [];
  const candidates: MatchCandidate[] = [];

  for (const p of portfolios) {
    const name = normalizeGerman(p.name);
    if (!name) continue;

    let score = 0;

    // Exact match
    if (name === target) {
      score = 100;
    }
    // Name contains the full target as whole words
    else if (target.length >= 4 && containsWords(name, target)) {
      score = 80;
    }
    // Target contains the portfolio name as whole words
    else if (name.length >= 4 && containsWords(target, name)) {
      score = 70;
    }
    // Word overlap
    else {
      const targetWords = target.split(' ').filter((w: string) => w.length > 2);
      const nameWords = name.split(' ').filter((w: string) => w.length > 2);
      const matchedWords = targetWords.filter((tw: string) => nameWords.includes(tw));
      if (matchedWords.length > 0) {
        score = Math.round((matchedWords.length / Math.max(targetWords.length, 1)) * 60);
      }
    }

    if (score > 20) {
      candidates.push({
        id: p.id,
        name: p.name || 'Unnamed',
        gla: p.total_gla,
        score,
        type: 'portfolio'
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 10);
}

// ============================================
// AUTO-MATCH SELECTION (score + gap rule)
// ============================================
/**
 * Pick a candidate that is safe to auto-suggest: high absolute score AND a
 * clear gap to the runner-up. Avoids both failure modes of the old rule
 * (`length === 1 && score >= 80`): a 100-score match next to a 25-score noise
 * candidate is auto-selected, while two close 80s still go to manual review.
 */
export function selectAutoMatch(candidates: MatchCandidate[]): MatchCandidate | null {
  if (candidates.length === 0) return null;
  const [top, second] = candidates;
  if (top.score < 80) return null;
  if (!second || second.score < 60 || top.score - second.score >= 15) return top;
  return null;
}

// ============================================
// FUZZY MATCH ASSET BY CITY/NAME/STREET
// ============================================
export async function fuzzyMatchAsset(
  targetName: string,
  portfolioId?: string
): Promise<MatchCandidate[]> {
  if (!targetName || targetName.trim().length < 2) return [];

  let query = supabaseAdmin
    .from('assets')
    .select('id, city, street, gla, annual_rent, portfolio_id')
    .order('created_at', { ascending: false })
    .limit(500);

  if (portfolioId) {
    query = query.eq('portfolio_id', portfolioId);
  }

  const { data: assets } = await query;
  if (!assets || assets.length === 0) return [];

  const target = normalizeGerman(targetName);
  if (!target) return [];
  const candidates: MatchCandidate[] = [];

  for (const a of assets) {
    const city = normalizeCity(a.city);
    const street = normalizeStreet(a.street);
    const combined = `${city} ${street}`.trim();

    let score = 0;

    if ((combined && combined === target) || (city && city === target)) {
      score = 100;
    } else if (target.length >= 4 && containsWords(combined, target)) {
      score = 75;
    } else if (city && city.length >= 4 && containsWords(target, city)) {
      score = 60;
    } else if (street && street.length >= 4 && containsWords(target, street)) {
      score = 50;
    } else {
      const targetWords = target.split(' ').filter((w: string) => w.length > 2);
      const combinedWords = combined.split(' ').filter((w: string) => w.length > 2);
      const matchedWords = targetWords.filter((tw: string) => combinedWords.includes(tw));
      if (matchedWords.length > 0) {
        score = Math.round((matchedWords.length / Math.max(targetWords.length, 1)) * 50);
      }
    }

    if (score > 20) {
      candidates.push({
        id: a.id,
        name: `${a.city || ''}${a.street ? ` - ${a.street}` : ''}`,
        city: a.city,
        street: a.street,
        gla: a.gla,
        score,
        type: 'asset'
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 15);
}

// ============================================
// FIND ASSETS BY CITY IN PORTFOLIO (for tenant list matching)
// ============================================
export async function findAssetsByCityInPortfolio(
  portfolioId: string,
  cities: string[]
): Promise<Record<string, AssetCandidate[]>> {
  const { data: assets } = await supabaseAdmin
    .from('assets')
    .select('id, city, street, gla, annual_rent')
    .eq('portfolio_id', portfolioId);

  if (!assets) return {};

  // Count existing tenants per asset
  const assetIds = assets.map(a => a.id);
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('asset_id')
    .in('asset_id', assetIds);

  const tenantCounts: Record<string, number> = {};
  if (tenants) {
    for (const t of tenants) {
      tenantCounts[t.asset_id] = (tenantCounts[t.asset_id] || 0) + 1;
    }
  }

  const mapping: Record<string, AssetCandidate[]> = {};

  // Check if any city has multiple assets — if so, we need street-level matching
  for (const city of cities) {
    const cityNorm = normalizeCity(city);
    const matches = assets.filter(a => {
      const assetCity = normalizeCity(a.city);
      // Normalized equality + whole-word containment ("frankfurt a m" ≈ "frankfurt am main")
      return assetCity === cityNorm
        || (cityNorm.length >= 4 && containsWords(assetCity, cityNorm))
        || (assetCity.length >= 4 && containsWords(cityNorm, assetCity));
    });

    // If multiple assets in same city, create separate entries per street
    if (matches.length > 1) {
      for (const a of matches) {
        const key = a.street ? `${city} — ${a.street}` : city;
        if (!mapping[key]) mapping[key] = [];
        mapping[key].push({
          asset_id: a.id,
          name: `${a.city || ''}${a.street ? ` - ${a.street}` : ''}`,
          street: a.street,
          gla: a.gla,
          annual_rent: a.annual_rent,
          tenant_count: tenantCounts[a.id] || 0,
        });
      }
    } else {
      mapping[city] = matches.map(a => ({
        asset_id: a.id,
        name: `${a.city || ''}${a.street ? ` - ${a.street}` : ''}`,
        street: a.street,
        gla: a.gla,
        annual_rent: a.annual_rent,
        tenant_count: tenantCounts[a.id] || 0,
      }));
    }
  }

  return mapping;
}

// ============================================
// CHECK EXISTING DATA (for conflict detection)
// ============================================
export async function checkExistingData(
  type: 'asset-list' | 'tenant-list',
  portfolioId?: string,
  assetId?: string
): Promise<{ hasExisting: boolean; existingCount: number }> {
  if (type === 'asset-list' && portfolioId) {
    const { count } = await supabaseAdmin
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('portfolio_id', portfolioId);
    // There's always at least 1 default asset, so check > 1
    return { hasExisting: (count || 0) > 1, existingCount: count || 0 };
  }

  if (type === 'tenant-list' && assetId) {
    const { count } = await supabaseAdmin
      .from('tenants')
      .select('*', { count: 'exact', head: true })
      .eq('asset_id', assetId);
    return { hasExisting: (count || 0) > 0, existingCount: count || 0 };
  }

  return { hasExisting: false, existingCount: 0 };
}

// ============================================
// RESOLVE: APPLY PENDING IMPORT
// ============================================
export async function resolvePendingImport(
  pendingId: string,
  resolution: {
    action: 'apply' | 'reject';
    portfolioId?: string;
    assetId?: string;
    cityMapping?: Record<string, string>; // city → asset_id
    mergeStrategy?: 'replace' | 'append';
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get the pending import
    const { data: pending, error: fetchError } = await supabaseAdmin
      .from('pending_imports')
      .select('*')
      .eq('id', pendingId)
      .single();

    if (fetchError || !pending) {
      return { success: false, error: 'Pending import not found' };
    }

    // Reject
    if (resolution.action === 'reject') {
      await supabaseAdmin
        .from('pending_imports')
        .update({
          status: 'rejected',
          resolved_at: new Date().toISOString(),
        })
        .eq('id', pendingId);
      return { success: true };
    }

    // Apply
    const rawData = pending.raw_data as PendingImport['raw_data'];
    const portfolioId = resolution.portfolioId || pending.suggested_portfolio_id;

    if (pending.type === 'asset-list') {
      if (!portfolioId) {
        return { success: false, error: 'No portfolio selected' };
      }

      const assets = rawData.assets || [];
      if (assets.length === 0) {
        return { success: false, error: 'No assets in extracted data' };
      }

      // Handle merge strategy
      if (resolution.mergeStrategy === 'replace') {
        // Delete existing assets (and their tenants via cascade or manual)
        const { data: existingAssets } = await supabaseAdmin
          .from('assets')
          .select('id')
          .eq('portfolio_id', portfolioId);

        if (existingAssets && existingAssets.length > 0) {
          const assetIds = existingAssets.map(a => a.id);
          await supabaseAdmin.from('tenants').delete().in('asset_id', assetIds);
          await supabaseAdmin.from('assets').delete().eq('portfolio_id', portfolioId);
        }
      }

      // Insert new assets — need a valid document_id (FK constraint)
      
      // Create a document record for traceability — REQUIRED
      const { data: doc, error: docError } = await supabaseAdmin
        .from('documents')
        .insert({
          file_name: pending.file_name || 'excel-import',
          document_type: 'portfolio',
          email_body: pending.email_context,
          email_message_id: pending.email_message_id,
          status: 'completed',
        })
        .select()
        .single();

      if (docError || !doc) {
        console.error('Failed to create document for asset import:', docError);
        return { success: false, error: `Failed to create document: ${docError?.message || 'unknown'}` };
      }

      const documentId = doc.id;
      const createdAssets = await createAssets(documentId, portfolioId, assets);

      // ============================================
      // Distribute portfolio purchase_price across assets by GLA share
      // Formula: asset_price = (asset_gla / total_gla) * portfolio_price
      // ============================================
      const { data: portfolio } = await supabaseAdmin
        .from('portfolios')
        .select('purchase_price')
        .eq('id', portfolioId)
        .single();

      if (portfolio?.purchase_price && createdAssets.length > 0) {
        const totalGla = createdAssets.reduce((s, a) => s + (a.gla || 0), 0);
        if (totalGla > 0) {
          console.log(`💰 Distributing portfolio price (${portfolio.purchase_price}) across ${createdAssets.length} assets by GLA (total: ${totalGla} m²)`);
          for (const asset of createdAssets) {
            const assetGla = asset.gla || 0;
            if (assetGla > 0) {
              const assetPrice = Math.round((assetGla / totalGla) * portfolio.purchase_price);
              const pricePerSqm = assetPrice / assetGla;
              await supabaseAdmin
                .from('assets')
                .update({ purchase_price: assetPrice, price_per_sqm: pricePerSqm })
                .eq('id', asset.id);
              console.log(`   ${asset.city || '?'}: ${assetGla} m² → ${assetPrice}€ (${Math.round(pricePerSqm)} €/m²)`);
            }
          }
        }
      }

      // Also import tenants embedded in the same extraction (e.g. a full
      // exposé routed to pending as a deal update) — they would otherwise
      // be silently lost on resolve.
      const embeddedTenants = rawData.tenants || [];
      if (embeddedTenants.length > 0) {
        const tenantResult = await importTenantsForAssets(documentId, createdAssets, embeddedTenants);
        console.log(`👥 Imported ${tenantResult.createdCount} embedded tenant(s), ${tenantResult.skippedCount} skipped`);
        tenantResult.warnings.forEach(w => console.warn(`   ⚠️ ${w}`));
      }

      // Recalculate portfolio totals
      await recalculatePortfolioAfterImport(portfolioId);
    }

    if (pending.type === 'tenant-list') {
      const tenants = rawData.tenants || [];
      if (tenants.length === 0) {
        return { success: false, error: 'No tenants in extracted data' };
      }

      // Create document for traceability — REQUIRED for FK constraint
      const { data: doc, error: docError } = await supabaseAdmin
        .from('documents')
        .insert({
          file_name: pending.file_name || 'excel-import',
          document_type: 'rent-roll',
          email_body: pending.email_context,
          email_message_id: pending.email_message_id,
          status: 'completed',
        })
        .select()
        .single();

      if (docError || !doc) {
        console.error('Failed to create document for tenant import:', docError);
        return { success: false, error: `Failed to create document: ${docError?.message || 'unknown'}` };
      }

      const documentId = doc.id;

      // Use city mapping if provided (for multi-asset tenant lists)
      const cityMapping = resolution.cityMapping || {};
      const singleAssetId = resolution.assetId || pending.suggested_asset_id;

      // Group tenants by city+street key (same keys as findAssetsByCityInPortfolio)
      const tenantsByKey: Record<string, Record<string, unknown>[]> = {};
      for (const t of tenants) {
        const city = (t.asset_city as string) || '_unknown';
        const street = (t.asset_street as string) || '';
        // Build a key that matches what findAssetsByCityInPortfolio produces
        const key = street ? `${city} — ${street}` : city;
        if (!tenantsByKey[key]) tenantsByKey[key] = [];
        tenantsByKey[key].push(t);
      }

      // Track which assets have already been cleared (to avoid deleting freshly inserted tenants)
      const clearedAssetIds = new Set<string>();

      for (const [key, keyTenants] of Object.entries(tenantsByKey)) {
        // Try exact key match first, then fall back to city-only, then single asset
        let targetAssetId = cityMapping[key] || cityMapping[key.toLowerCase()];

        // Fallback: try matching by city only (strip " — street" part)
        if (!targetAssetId) {
          const cityOnly = key.split(' — ')[0];
          targetAssetId = cityMapping[cityOnly] || cityMapping[cityOnly.toLowerCase()];
        }

        // Fallback: try matching asset by street within portfolio
        if (!targetAssetId && singleAssetId) {
          // If we have a portfolioId, try to find the right asset by street
          const street = key.includes(' — ') ? key.split(' — ')[1] : null;
          if (street && portfolioId) {
            const { data: matchingAsset } = await supabaseAdmin
              .from('assets')
              .select('id')
              .eq('portfolio_id', portfolioId)
              .ilike('street', `%${street}%`)
              .limit(1)
              .single();
            if (matchingAsset) targetAssetId = matchingAsset.id;
          }
        }

        // Final fallback: single asset — but only when it's safe.
        // Dumping every unmatched city onto one asset silently mis-assigns
        // tenants; only fall back when the list targets a single building,
        // or when the fallback asset's city actually matches the key.
        if (!targetAssetId && singleAssetId) {
          if (Object.keys(tenantsByKey).length === 1) {
            targetAssetId = singleAssetId;
          } else {
            const { data: fallbackAsset } = await supabaseAdmin
              .from('assets')
              .select('city')
              .eq('id', singleAssetId)
              .single();
            const keyCity = normalizeCity(key.split(' — ')[0]);
            if (fallbackAsset && keyCity && normalizeCity(fallbackAsset.city) === keyCity) {
              targetAssetId = singleAssetId;
            }
          }
        }

        if (!targetAssetId) {
          console.warn(`No asset mapping for "${key}", skipping ${keyTenants.length} tenants`);
          continue;
        }

        // Handle merge strategy for this asset (only delete once per asset)
        if (resolution.mergeStrategy === 'replace' && !clearedAssetIds.has(targetAssetId)) {
          await supabaseAdmin.from('tenants').delete().eq('asset_id', targetAssetId);
          clearedAssetIds.add(targetAssetId);
        }

        // Enrich before insert (lease_end / remaining_lease_years / monthly↔annual
        // conversions) — raw rows used to go in unenriched, breaking WALT recalc.
        await createTenants(documentId, targetAssetId, keyTenants.map(t => enrichTenant(t)));
      }

      // Recalculate portfolio totals if we have a portfolio
      if (portfolioId) {
        await recalculatePortfolioAfterImport(portfolioId);
      } else if (singleAssetId) {
        // Find portfolio from asset
        const { data: asset } = await supabaseAdmin
          .from('assets')
          .select('portfolio_id')
          .eq('id', singleAssetId)
          .single();
        if (asset?.portfolio_id) {
          await recalculatePortfolioAfterImport(asset.portfolio_id);
        }
      }
    }

    // Mark as resolved
    await supabaseAdmin
      .from('pending_imports')
      .update({
        status: 'resolved',
        confirmed_portfolio_id: portfolioId || null,
        confirmed_asset_id: resolution.assetId || null,
        confirmed_city_mapping: resolution.cityMapping || null,
        merge_strategy: resolution.mergeStrategy || null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', pendingId);

    return { success: true };
  } catch (error) {
    console.error('Error resolving pending import:', error);
    return { success: false, error: String(error) };
  }
}

// ============================================
// Helper: Recalculate portfolio after import
// ============================================
async function recalculatePortfolioAfterImport(portfolioId: string) {
  const { data: assets } = await supabaseAdmin
    .from('assets')
    .select('*')
    .eq('portfolio_id', portfolioId);

  if (!assets || assets.length === 0) return;

  const assetIds = assets.map(a => a.id);
  const { data: allTenants } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .in('asset_id', assetIds);

  // Step 1: Recalculate asset-level metrics from tenants
  const today = new Date();
  for (const asset of assets) {
    const assetTenants = allTenants?.filter(t => t.asset_id === asset.id) || [];
    if (assetTenants.length === 0) continue;

    const assetUpdates: Record<string, unknown> = {};

    // Recalculate annual_rent from tenants
    const tenantRentTotal = assetTenants.reduce((s, t) => s + (t.annual_rent || 0), 0);
    if (tenantRentTotal > 0) {
      assetUpdates.annual_rent = tenantRentTotal;
      assetUpdates.monthly_rent = tenantRentTotal / 12;
      asset.annual_rent = tenantRentTotal; // update local copy
    }

    // Recalculate WALT from tenants
    let waltSum = 0, rentSum = 0;
    for (const t of assetTenants) {
      const rent = t.annual_rent || 0;
      if (rent <= 0) continue;
      let remaining = t.remaining_lease_years;
      if (!remaining && t.lease_end) {
        remaining = (new Date(t.lease_end).getTime() - today.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (remaining < 0) remaining = 0;
      }
      if (remaining && remaining > 0) {
        waltSum += remaining * rent;
        rentSum += rent;
      }
    }
    if (rentSum > 0) {
      assetUpdates.walt = waltSum / rentSum;
      asset.walt = waltSum / rentSum; // update local copy
    }

    if (Object.keys(assetUpdates).length > 0) {
      await supabaseAdmin.from('assets').update(assetUpdates).eq('id', asset.id);
    }
  }

  // Step 2: Recalculate portfolio totals from (now-updated) assets
  const totalGla = assets.reduce((s, a) => s + (a.gla || 0), 0);
  const totalRent = assets.reduce((s, a) => s + (a.annual_rent || 0), 0);
  const totalPrice = assets.reduce((s, a) => s + (a.purchase_price || 0), 0);

  const updates: Record<string, unknown> = {
    number_of_assets: assets.length,
  };

  if (totalGla > 0) updates.total_gla = totalGla;
  if (totalRent > 0) updates.annual_rent_income = totalRent;
  if (totalPrice > 0) updates.purchase_price = totalPrice;

  // Portfolio WALT — weighted average of asset WALTs by rent
  const portfolioWaltSum = assets.reduce((s, a) => s + ((a.walt || 0) * (a.annual_rent || 0)), 0);
  if (totalRent > 0 && portfolioWaltSum > 0) {
    updates.walt = portfolioWaltSum / totalRent;
  }

  // Occupancy
  if (allTenants && totalGla > 0) {
    const leasedArea = allTenants.reduce((s, t) => s + (t.leased_area || 0), 0);
    if (leasedArea > 0) updates.occupancy_rate = (leasedArea / totalGla) * 100;
  }

  // Top tenant
  if (allTenants && allTenants.length > 0 && totalRent > 0) {
    const sorted = [...allTenants].sort((a, b) => (b.annual_rent || 0) - (a.annual_rent || 0));
    if (sorted[0]) {
      updates.top_tenant = sorted[0].tenant_name;
      if (sorted[0].annual_rent) updates.top_tenant_share = (sorted[0].annual_rent / totalRent) * 100;
    }
  }

  if (Object.keys(updates).length > 0) {
    await supabaseAdmin.from('portfolios').update(updates).eq('id', portfolioId);
  }
}