import { supabaseAdmin } from './supabase';
import { normalizeCity, normalizeStreet, containsWords } from './text-normalize';

/** Append a line to an existing notes value (string or null/undefined). */
function appendNoteText(existing: unknown, note: string): string {
  const cur = typeof existing === 'string' && existing.trim() ? existing.trim() + '\n' : '';
  return cur + note;
}

// Upload PDF to Supabase Storage and return public URL
export async function uploadPDF(base64: string, fileName: string, portfolioId: string): Promise<string | null> {
  try {
    // Convert base64 to buffer
    const buffer = Buffer.from(base64, 'base64');
    
    // Clean filename and create path
    const cleanName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const path = `portfolios/${portfolioId}/${Date.now()}_${cleanName}`;
    
    // Upload to Supabase Storage
    const { error } = await supabaseAdmin.storage
      .from('documents')
      .upload(path, buffer, {
        contentType: 'application/pdf',
        upsert: true
      });
    
    if (error) {
      console.error('PDF upload error:', error);
      return null;
    }
    
    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('documents')
      .getPublicUrl(path);
    
    return urlData.publicUrl;
  } catch (e) {
    console.error('PDF upload failed:', e);
    return null;
  }
}

// CREATE DOCUMENT
// documents.document_type has a CHECK constraint allowing only these values.
// Classification can return 'deal-summary'/'unknown' — clamp to avoid a failed insert.
const ALLOWED_DOCUMENT_TYPES = ['portfolio', 'asset', 'rent-roll'];

export async function createDocument(
  fileName: string,
  documentType: string,
  emailBody?: string,
  emailSubject?: string,
  emailMessageId?: string
) {
  const safeType = ALLOWED_DOCUMENT_TYPES.includes(documentType) ? documentType : 'portfolio';
  const { data, error } = await supabaseAdmin
    .from('documents')
    .insert({
      file_name: fileName,
      document_type: safeType,
      email_body: emailBody,
      email_subject: emailSubject,
      email_message_id: emailMessageId,
      status: 'processing'
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// UPDATE DOCUMENT STATUS
export async function updateDocumentStatus(id: string, status: string, error?: string, rawExtraction?: unknown) {
  await supabaseAdmin
    .from('documents')
    .update({ status, processing_error: error, raw_extraction: rawExtraction })
    .eq('id', id);
}

// CREATE PORTFOLIO
export async function createPortfolio(documentId: string, data: Record<string, unknown>) {
  // 🔍 DEBUG: Log toutes les valeurs > 9999.99
  console.log('\n🔍 DEBUG createPortfolio - Checking for potential overflows:');
  
  const numericFields = [
    'price_per_sqm', 'rent_per_sqm', 'multiplier',
    'noi_margin', 'leakage_percent', 'yield_percent', 'cap_rate',
    'annual_rent_income', 'purchase_price', 'noi', 'equity_on_spot', 'spot',
    'total_gla', 'walt', 'occupancy_rate', 'leh_percentage', 'ltv'
  ];
  
  console.log(`   Portfolio: ${data.name || 'unknown'}`);
  numericFields.forEach(field => {
    const value = data[field];
    if (typeof value === 'number') {
      if (value > 9999.99) {
        console.log(`      🚨 ${field}: ${value} (> 9999.99 - WILL OVERFLOW if column is NUMERIC(6,2)!)`);
      } else if (value > 999.99) {
        console.log(`      ⚠️  ${field}: ${value} (high value)`);
      } else if (value !== null && value !== 0) {
        console.log(`      ✅ ${field}: ${value}`);
      }
    }
  });
  
  console.log('   Attempting to insert portfolio into DB...');
  // Strip schema documentation fields (e.g. _note)
  const cleanData = { ...data };
  for (const key of Object.keys(cleanData)) {
    if (key.startsWith('_')) delete cleanData[key];
  }
  const { data: portfolio, error } = await supabaseAdmin
    .from('portfolios')
    .insert({ document_id: documentId, ...cleanData })
    .select()
    .single();
  
  if (error) {
    console.error('   ❌ Insert failed with error:', error);
    throw error;
  }
  
  console.log('   ✅ Insert successful');
  return portfolio;
}

// CREATE ASSETS
export async function createAssets(documentId: string, portfolioId: string | null, assets: Record<string, unknown>[]) {
  // 🔥 Strip fields that only exist on portfolios table, not assets
  const PORTFOLIO_ONLY_FIELDS = [
    'investment_type', 'exclusivity', 'deal_status',
    'annual_rent_income', 'total_gla', 'total_plot_area',
    'total_parking_spaces', 'total_parking_spaces_underground',
    'number_of_assets', 'top_tenant', 'top_tenant_share',
    'leh_percentage', 'ltv', 'equity_on_spot', 'equity_requirement',
    'spot', 'cap_rate', 'email_contact_name', 'email_contact_email',
    'email_contact_phone', 'email_contact_company',
    'doc_contact_name', 'doc_contact_email', 'doc_contact_phone',
    'doc_contact_company', 'doc_contact_role',
    'document_url', 'document_id_ref',
  ];

  const cleanedAssets = assets.map(a => {
    const clean = { ...a };
    for (const field of PORTFOLIO_ONLY_FIELDS) {
      delete clean[field];
    }
    // Strip schema documentation fields (e.g. _note)
    for (const key of Object.keys(clean)) {
      if (key.startsWith('_')) delete clean[key];
    }
    return clean;
  });
  // 🔍 DEBUG: Log toutes les valeurs > 9999.99 qui peuvent overflow avec NUMERIC(6,2)
  console.log('\n🔍 DEBUG createAssets - Checking for potential overflows:');
  
  const numericFields = [
    'price_per_sqm', 'rent_per_sqm', 'multiplier', 
    'noi_margin', 'leakage_percent', 'yield_percent',
    'annual_rent', 'monthly_rent', 'purchase_price', 'noi', 'leakage',
    'gla', 'plot_area', 'parking_spaces'
  ];
  
  cleanedAssets.forEach((asset, index) => {
    console.log(`   Asset ${index + 1} (${asset.city || 'unknown'}):`);
    
    numericFields.forEach(field => {
      const value = asset[field];
      if (typeof value === 'number') {
        if (value > 9999.99) {
          console.log(`      🚨 ${field}: ${value} (> 9999.99 - WILL OVERFLOW if column is NUMERIC(6,2)!)`);
        } else if (value > 999.99) {
          console.log(`      ⚠️  ${field}: ${value} (high value)`);
        } else if (value !== null && value !== 0) {
          console.log(`      ✅ ${field}: ${value}`);
        }
      }
    });
  });
  
  const rows = cleanedAssets.map(a => ({ document_id: documentId, portfolio_id: portfolioId, ...a }));
  
  console.log('\n   Attempting to insert assets into DB...');
  const { data, error } = await supabaseAdmin.from('assets').insert(rows).select();
  
  if (error) {
    console.error('   ❌ Insert failed with error:', error);
    throw error;
  }
  
  console.log('   ✅ Insert successful');
  return data;
}

// CREATE TENANTS
export async function createTenants(documentId: string, assetId: string, tenants: Record<string, unknown>[]) {
  // Fields that don't belong in tenants table
  const NON_TENANT_FIELDS = [
    'asset_city', 'asset_street', 'investment_type', 'exclusivity',
    'deal_status', 'purchase_price', 'price_per_sqm', 'gla',
    'plot_area', 'parking_spaces', 'parking_spaces_underground',
    'construction_year', 'renovation_year', '_note',
  ];
  const rows = tenants.map(t => {
    const clean = { ...t };
    for (const field of NON_TENANT_FIELDS) {
      delete clean[field];
    }
    // Strip schema documentation fields (e.g. _note)
    for (const key of Object.keys(clean)) {
      if (key.startsWith('_')) delete clean[key];
    }
    return { document_id: documentId, asset_id: assetId, ...clean };
  });
  const { data, error } = await supabaseAdmin.from('tenants').insert(rows).select();
  if (error) throw error;
  return data;
}

// CREATE MARKET DATA
export async function createMarketData(assetId: string, data: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('market_data').insert({ asset_id: assetId, ...data });
  if (error) throw error;
}

// CREATE EXTRACTION LOG
export async function createExtractionLog(documentId: string, data: Record<string, unknown>) {
  await supabaseAdmin.from('extraction_logs').insert({ document_id: documentId, ...data });
}

// ============================================
// TENANT → ASSET LINKING (city + street aware)
// ============================================
interface AssetRef {
  id: string;
  city: string;   // normalized
  street: string; // normalized
}

/**
 * Find the asset a tenant belongs to. City narrows the pool, street
 * disambiguates when several assets share a city. Returns no assetId when a
 * city is given but matches nothing (better to skip-with-warning than to
 * silently attach the tenant to the wrong building).
 */
function findAssetForTenant(
  tenant: Record<string, unknown>,
  refs: AssetRef[]
): { assetId?: string; warning?: string } {
  if (refs.length === 0) return {};
  if (refs.length === 1) return { assetId: refs[0].id };

  const city = normalizeCity(tenant.asset_city as string | null);
  const street = normalizeStreet(tenant.asset_street as string | null);

  let pool = refs;
  if (city) {
    const cityPool = refs.filter(r =>
      r.city && (r.city === city || containsWords(r.city, city) || containsWords(city, r.city))
    );
    if (cityPool.length === 0) return {};
    pool = cityPool;
  }
  if (pool.length === 1) return { assetId: pool[0].id };

  if (street) {
    const streetPool = pool.filter(r =>
      r.street && (r.street === street || containsWords(r.street, street) || containsWords(street, r.street))
    );
    if (streetPool.length >= 1) return { assetId: streetPool[0].id };
  }

  // Several assets in the same city and no street to disambiguate → first one, flagged.
  return {
    assetId: pool[0].id,
    warning: `Tenant "${tenant.tenant_name || '?'}" assigned to first asset of ${tenant.asset_city || 'unknown city'} — multiple assets share this city and no street matched`,
  };
}

/**
 * Import a tenant list onto a set of existing/just-created assets, matching by
 * city + street. Used by the pending-import resolve flow so tenants embedded
 * in an asset-list extraction (full exposé routed to review) aren't lost.
 */
export async function importTenantsForAssets(
  documentId: string,
  assetRows: Array<{ id: string; city?: string | null; street?: string | null }>,
  tenants: Record<string, unknown>[],
): Promise<{ createdCount: number; skippedCount: number; warnings: string[] }> {
  const refs: AssetRef[] = assetRows.map(a => ({
    id: a.id,
    city: normalizeCity(a.city),
    street: normalizeStreet(a.street),
  }));
  const warnings: string[] = [];
  const byAsset = new Map<string, Record<string, unknown>[]>();
  let skippedCount = 0;

  for (const t of tenants) {
    const match = findAssetForTenant(t, refs);
    if (!match.assetId) {
      skippedCount++;
      warnings.push(`Tenant skipped — no matching asset: ${t.tenant_name || '?'}${t.asset_city ? ` (${t.asset_city})` : ''}`);
      continue;
    }
    if (match.warning) warnings.push(match.warning);
    const list = byAsset.get(match.assetId) || [];
    list.push(enrichTenant(t));
    byAsset.set(match.assetId, list);
  }

  let createdCount = 0;
  for (const [assetId, list] of byAsset) {
    const rows = await createTenants(documentId, assetId, list);
    createdCount += rows.length;
  }
  return { createdCount, skippedCount, warnings };
}

// SAVE ALL EXTRACTED DATA
export async function saveExtractedData(documentId: string, extracted: {
  portfolio?: Record<string, unknown>;
  assets?: Record<string, unknown>[];
  tenants?: Record<string, unknown>[];
  marketData?: Record<string, unknown>[];
  emailContact?: Record<string, unknown>;
  documentContact?: Record<string, unknown>;
  extraction_warnings?: string[];
}, pdfData?: { base64: string; fileName: string }) {
  const result = { portfolioId: '', assetIds: [] as string[], tenantIds: [] as string[], errors: [] as string[] };

  try {
    // Merge both contacts into portfolio data
    const contactData = {
      ...(extracted.emailContact || {}),
      ...(extracted.documentContact || {})
    };
    
    // Enrich assets first (needed for portfolio NOI calculation)
    const enrichedAssets = extracted.assets?.map(a => enrichAsset(a)) || [];
    
    // 🔥 FALLBACK: If no assets were extracted, create a minimal asset from portfolio data
    // There should ALWAYS be at least one asset in every portfolio
    if (enrichedAssets.length === 0) {
      console.log('🚨 FALLBACK TRIGGERED: enrichedAssets is empty after extraction!');
      console.log('   extracted.assets:', JSON.stringify(extracted.assets || 'undefined').substring(0, 200));
      console.log('⚠️ No assets extracted — creating minimal asset from portfolio/email data');
      const fallbackAsset: Record<string, unknown> = {};
      
      if (extracted.portfolio) {
        // Try to derive asset info from portfolio
        if (extracted.portfolio.name) fallbackAsset.city = extracted.portfolio.name;
        if (extracted.portfolio.total_gla) fallbackAsset.gla = extracted.portfolio.total_gla;
        if (extracted.portfolio.annual_rent_income) fallbackAsset.annual_rent = extracted.portfolio.annual_rent_income;
        if (extracted.portfolio.purchase_price) fallbackAsset.purchase_price = extracted.portfolio.purchase_price;
        if (extracted.portfolio.noi) fallbackAsset.noi = extracted.portfolio.noi;
        if (extracted.portfolio.noi_margin) fallbackAsset.noi_margin = extracted.portfolio.noi_margin;
        if (extracted.portfolio.walt) fallbackAsset.walt = extracted.portfolio.walt;
        if (extracted.portfolio.total_plot_area) fallbackAsset.plot_area = extracted.portfolio.total_plot_area;
      }
      
      // If we still have no city, use a placeholder
      if (!fallbackAsset.city) fallbackAsset.city = 'Unknown';
      
      enrichedAssets.push(enrichAsset(fallbackAsset));
    }
    
    // 1. Portfolio - create one even if not provided (for single assets)
    let portfolioId: string | null = null;
    
    if (extracted.portfolio) {
      // Enrich portfolio with computed fields (uses enriched assets for NOI)
      const enrichedPortfolio = enrichPortfolio({ ...extracted.portfolio, ...contactData }, enrichedAssets);
      const p = await createPortfolio(documentId, enrichedPortfolio);
      portfolioId = p.id;
      result.portfolioId = p.id;
    } else if (enrichedAssets.length) {
      // Auto-create portfolio from assets + contact details
      const firstAsset = enrichedAssets[0];
      const autoPortfolio = {
        name: (firstAsset.city as string) || (firstAsset.street as string) || 'Single Asset',
        number_of_assets: enrichedAssets.length,
        total_gla: enrichedAssets.reduce((sum, a) => sum + ((a.gla as number) || 0), 0) || null,
        annual_rent_income: enrichedAssets.reduce((sum, a) => sum + ((a.annual_rent as number) || 0), 0) || null,
        purchase_price: enrichedAssets.reduce((sum, a) => sum + ((a.purchase_price as number) || 0), 0) || null,
        ...contactData
      };
      const enrichedPortfolio = enrichPortfolio(autoPortfolio, enrichedAssets);
      const p = await createPortfolio(documentId, enrichedPortfolio);
      portfolioId = p.id;
      result.portfolioId = p.id;
    }

    // 1b. Upload PDF and link to portfolio
    if (portfolioId && pdfData) {
      const pdfUrl = await uploadPDF(pdfData.base64, pdfData.fileName, portfolioId);
      if (pdfUrl) {
        await supabaseAdmin
          .from('portfolios')
          .update({ document_url: pdfUrl })
          .eq('id', portfolioId);
        console.log(`PDF uploaded: ${pdfUrl}`);
      }
    }

    // 2. Assets - save enriched assets, build matching refs (city + street)
    console.log(`\n🏢 Creating assets...`);
    console.log(`   - enrichedAssets.length: ${enrichedAssets.length}`);

    const assetRefs: AssetRef[] = [];
    if (enrichedAssets.length) {
      console.log(`   - Calling createAssets() with ${enrichedAssets.length} asset(s)...`);
      console.log(`   - First asset preview:`, {
        city: enrichedAssets[0].city,
        street: enrichedAssets[0].street,
        annual_rent: enrichedAssets[0].annual_rent,
        noi_margin: enrichedAssets[0].noi_margin,
        multiplier: enrichedAssets[0].multiplier
      });

      try {
        const assets = await createAssets(documentId, portfolioId, enrichedAssets);
        console.log(`   ✅ Created ${assets.length} asset(s) successfully`);

        assets.forEach((a, i) => {
          result.assetIds.push(a.id);
          assetRefs.push({
            id: a.id,
            city: normalizeCity(enrichedAssets[i].city as string | null),
            street: normalizeStreet(enrichedAssets[i].street as string | null),
          });
        });
      } catch (assetError) {
        console.error(`   ❌ createAssets() failed:`, assetError);
        throw assetError; // Re-throw to be caught by outer catch
      }
    } else {
      console.log(`   ⏭️  No assets to create (enrichedAssets is empty)`);
    }

    // 3. Tenants — link by city + street (street disambiguates same-city assets).
    // Unmatched tenants are skipped WITH a warning that lands in the portfolio
    // notes — never dropped silently.
    const linkWarnings: string[] = [];
    if (extracted.tenants?.length) {
      const tenantsByAsset = new Map<string, Record<string, unknown>[]>();
      for (const t of extracted.tenants) {
        const match = findAssetForTenant(t, assetRefs);
        if (!match.assetId) {
          const label = `${t.tenant_name || '?'}${t.asset_city ? ` (${t.asset_city})` : ''}`;
          console.warn(`   ⚠️ Tenant not linked to any asset, skipped: ${label}`);
          linkWarnings.push(`Tenant skipped — no matching asset: ${label}`);
          continue;
        }
        if (match.warning) {
          console.warn(`   ⚠️ ${match.warning}`);
          linkWarnings.push(match.warning);
        }
        const list = tenantsByAsset.get(match.assetId) || [];
        list.push(enrichTenant(t));
        tenantsByAsset.set(match.assetId, list);
      }
      for (const [assetId, list] of tenantsByAsset) {
        const created = await createTenants(documentId, assetId, list);
        result.tenantIds.push(...created.map(c => c.id));
      }
    }

    // 4. Market Data
    if (extracted.marketData?.length) {
      for (const m of extracted.marketData) {
        const city = normalizeCity(m.city as string | null);
        const ref = city
          ? assetRefs.find(r => r.city && (r.city === city || containsWords(r.city, city) || containsWords(city, r.city)))
          : undefined;
        const assetId = ref?.id || result.assetIds[0];
        if (assetId) await createMarketData(assetId, m);
      }
    }

    // 4b. Surface extraction + linking warnings on the portfolio so reviewers see them
    const allWarnings = [...(extracted.extraction_warnings || []), ...linkWarnings];
    if (portfolioId && allWarnings.length > 0) {
      const { data: pRow } = await supabaseAdmin
        .from('portfolios').select('notes').eq('id', portfolioId).single();
      const warningBlock = `⚠️ Extraction warnings:\n- ${allWarnings.join('\n- ')}`;
      await supabaseAdmin
        .from('portfolios')
        .update({ notes: appendNoteText(pRow?.notes, warningBlock) })
        .eq('id', portfolioId);
    }

    // 5. Recalculate portfolio totals
    if (portfolioId) {
      await recalculatePortfolioTotals(portfolioId);
    }

    await updateDocumentStatus(documentId, 'completed', undefined, extracted);
  } catch (e) {
    // 🔥 FIX: Properly serialize error message
    const errorMessage = e instanceof Error 
      ? `${e.name}: ${e.message}\n${e.stack}` 
      : JSON.stringify(e, null, 2);
    
    console.error('❌ saveExtractedData failed:', errorMessage);
    result.errors.push(errorMessage);
    await updateDocumentStatus(documentId, 'failed', errorMessage);
  }

  return result;
}

// Enrich asset with computed fields
function enrichAsset(asset: Record<string, unknown>): Record<string, unknown> {
  const enriched = { ...asset };
  
  // ============================================
  // 1. RENT CONVERSIONS (monthly ↔ annual)
  // ============================================
  if (asset.annual_rent && !asset.monthly_rent) {
    enriched.monthly_rent = (asset.annual_rent as number) / 12;
  }
  if (asset.monthly_rent && !asset.annual_rent) {
    enriched.annual_rent = (asset.monthly_rent as number) * 12;
  }

  const annualRent = (enriched.annual_rent as number) || null;

  // ============================================
  // 2. NOI_MARGIN ↔ LEAKAGE_PERCENT (bidirectional)
  // ============================================
  // If noi_margin is given, calculate leakage_percent
  if (enriched.noi_margin !== null && enriched.noi_margin !== undefined && !enriched.leakage_percent) {
    enriched.leakage_percent = 100 - (enriched.noi_margin as number);
  }
  // If leakage_percent is given, calculate noi_margin
  if (enriched.leakage_percent !== null && enriched.leakage_percent !== undefined && !enriched.noi_margin) {
    enriched.noi_margin = 100 - (enriched.leakage_percent as number);
  }

  // ============================================
  // 3. NOI CALCULATION (from noi_margin or leakage_percent)
  // ============================================
  if (!enriched.noi && annualRent) {
    if (enriched.noi_margin !== null && enriched.noi_margin !== undefined) {
      // NOI = annual_rent × (noi_margin / 100)
      enriched.noi = annualRent * ((enriched.noi_margin as number) / 100);
    } else if (enriched.leakage) {
      // NOI = annual_rent - leakage (absolute amount)
      enriched.noi = annualRent - (enriched.leakage as number);
    } else if (enriched.leakage_percent !== null && enriched.leakage_percent !== undefined) {
      // NOI = annual_rent × (1 - leakage_percent / 100)
      enriched.noi = annualRent * (1 - (enriched.leakage_percent as number) / 100);
    } else {
      // Default assumption: 15% leakage → 85% NOI margin.
      // Flagged in notes so estimated values stay distinguishable from extracted ones.
      enriched.noi = annualRent * 0.85;
      enriched.leakage_percent = 15;
      enriched.noi_margin = 85;
      enriched.notes = appendNoteText(enriched.notes, '⚠️ NOI margin not in source — default 85% assumed');
    }
  }

  // INVERSE: If NOI is given but no noi_margin/leakage_percent, calculate them
  if (enriched.noi && annualRent && annualRent > 0) {
    if (enriched.noi_margin === null || enriched.noi_margin === undefined) {
      enriched.noi_margin = ((enriched.noi as number) / annualRent) * 100;
    }
    if (enriched.leakage_percent === null || enriched.leakage_percent === undefined) {
      enriched.leakage_percent = 100 - ((enriched.noi as number) / annualRent) * 100;
    }
  }

  // ============================================
  // 4. MULTIPLIER ↔ PURCHASE_PRICE (bidirectional)
  // ============================================
  // If multiplier is given, calculate purchase_price
  if (enriched.multiplier && annualRent && !enriched.purchase_price) {
    enriched.purchase_price = (enriched.multiplier as number) * annualRent;
  }
  // If purchase_price is given, calculate multiplier
  if (enriched.purchase_price && annualRent && annualRent > 0 && !enriched.multiplier) {
    enriched.multiplier = (enriched.purchase_price as number) / annualRent;
  }

  // ============================================
  // 5. DERIVED METRICS
  // ============================================
  // rent_per_sqm = monthly rent / gla
  if (annualRent && enriched.gla) {
    enriched.rent_per_sqm = annualRent / 12 / (enriched.gla as number);
  }

  // price_per_sqm
  if (enriched.purchase_price && enriched.gla && !enriched.price_per_sqm) {
    enriched.price_per_sqm = (enriched.purchase_price as number) / (enriched.gla as number);
  }
  
  // yield_percent (cap rate)
  if (annualRent && enriched.purchase_price) {
    enriched.yield_percent = (annualRent / (enriched.purchase_price as number)) * 100;
  }

  // leakage_percent from absolute leakage
  if (enriched.leakage && annualRent && !enriched.leakage_percent) {
    enriched.leakage_percent = ((enriched.leakage as number) / annualRent) * 100;
  }
  
  return enriched;
}

// Enrich portfolio with computed fields
function enrichPortfolio(portfolio: Record<string, unknown>, assets: Record<string, unknown>[]): Record<string, unknown> {
  const enriched = { ...portfolio };
  
  const askingPrice = (portfolio.purchase_price as number) || null;
  const annualRent = (portfolio.annual_rent_income as number) || null;
  
  // 🔥 Spot = Asking Price par défaut (jusqu'à ce qu'on le change)
  let spot = (portfolio.spot as number) || null;
  if (!spot && askingPrice) {
    spot = askingPrice;
    enriched.spot = askingPrice;
  }
  
  // ============================================
  // 1. NOI_MARGIN ↔ LEAKAGE_PERCENT (bidirectional)
  // ============================================
  if (enriched.noi_margin !== null && enriched.noi_margin !== undefined && !enriched.leakage_percent) {
    enriched.leakage_percent = 100 - (enriched.noi_margin as number);
  }
  if (enriched.leakage_percent !== null && enriched.leakage_percent !== undefined && !enriched.noi_margin) {
    enriched.noi_margin = 100 - (enriched.leakage_percent as number);
  }
  
  // ============================================
  // 2. NOI CALCULATION
  // ============================================
  let portfolioNoi = portfolio.noi as number | null;
  
  // Calculate from assets if not given at portfolio level
  if (!portfolioNoi && assets.length > 0) {
    const totalAssetNoi = assets.reduce((sum, a) => sum + ((a.noi as number) || 0), 0);
    if (totalAssetNoi > 0) {
      portfolioNoi = totalAssetNoi;
      enriched.noi = totalAssetNoi;
    }
  }
  
  // Calculate from annual_rent using noi_margin or leakage_percent
  if (!portfolioNoi && annualRent) {
    if (enriched.noi_margin !== null && enriched.noi_margin !== undefined) {
      portfolioNoi = annualRent * ((enriched.noi_margin as number) / 100);
    } else if (enriched.leakage_percent !== null && enriched.leakage_percent !== undefined) {
      portfolioNoi = annualRent * (1 - (enriched.leakage_percent as number) / 100);
    } else {
      // Default assumption: 15% leakage → 85% NOI margin (flagged in notes).
      portfolioNoi = annualRent * 0.85;
      enriched.leakage_percent = 15;
      enriched.noi_margin = 85;
      enriched.notes = appendNoteText(enriched.notes, '⚠️ NOI margin not in source — default 85% assumed');
    }
    enriched.noi = portfolioNoi;
  }
  
  // INVERSE: If NOI is given but no noi_margin/leakage_percent, calculate them
  if (portfolioNoi && annualRent && annualRent > 0) {
    if (enriched.noi_margin === null || enriched.noi_margin === undefined) {
      enriched.noi_margin = (portfolioNoi / annualRent) * 100;
    }
    if (enriched.leakage_percent === null || enriched.leakage_percent === undefined) {
      enriched.leakage_percent = 100 - (portfolioNoi / annualRent) * 100;
    }
  }
  
  // ============================================
  // 3. MULTIPLIER ↔ PURCHASE_PRICE (bidirectional)
  // ============================================
  // If multiplier is given, calculate purchase_price
  if (enriched.multiplier && annualRent && !enriched.purchase_price) {
    enriched.purchase_price = (enriched.multiplier as number) * annualRent;
  }
  // If purchase_price is given, calculate multiplier
  if (enriched.purchase_price && annualRent && annualRent > 0 && !enriched.multiplier) {
    enriched.multiplier = (enriched.purchase_price as number) / annualRent;
  }
  
  // ============================================
  // 4. DERIVED METRICS
  // ============================================
  // LTV default 70% — flagged as an assumption in the notes
  const ltv = (portfolio.ltv as number) || 70;
  if (!portfolio.ltv) {
    enriched.ltv = 70;
    enriched.notes = appendNoteText(enriched.notes, '⚠️ LTV not in source — default 70% assumed');
  }
  
  const finalAskingPrice = (enriched.purchase_price as number) || askingPrice;
  const finalNoi = (enriched.noi as number) || portfolioNoi;
  
  // Cap Rate = NOI / Asking Price (use spot if available)
  const priceForCapRate = spot || finalAskingPrice;
  if (finalNoi && priceForCapRate) {
    enriched.cap_rate = (finalNoi / priceForCapRate) * 100;
  }
  
  // 🔥 Equity on Spot = Spot × (1 - LTV/100)
  // Spot = asking price par défaut, donc toujours calculé
  if (spot) {
    enriched.equity_on_spot = spot * (1 - ltv / 100);
  }
  
  // Price per sqm
  if (finalAskingPrice && enriched.total_gla) {
    enriched.price_per_sqm = finalAskingPrice / (enriched.total_gla as number);
  }
  
  // Rent per sqm (MONTHLY)
  if (annualRent && enriched.total_gla) {
    enriched.rent_per_sqm = (annualRent / 12) / (enriched.total_gla as number);
  }
  
  return enriched;
}

// Enrich tenant with computed fields
export function enrichTenant(tenant: Record<string, unknown>): Record<string, unknown> {
  const enriched = { ...tenant };
  
  // monthly_rent ↔ annual_rent
  if (tenant.annual_rent && !tenant.monthly_rent) {
    enriched.monthly_rent = (tenant.annual_rent as number) / 12;
  }
  if (tenant.monthly_rent && !tenant.annual_rent) {
    enriched.annual_rent = (tenant.monthly_rent as number) * 12;
  }

  const annualRent = (enriched.annual_rent as number) || null;

  // rent_per_sqm = loyer MENSUEL / m² = annual_rent / 12 / leased_area
  // ALWAYS recalculate to ensure it's monthly (don't trust extracted value which may be annual)
  if (annualRent && tenant.leased_area) {
    enriched.rent_per_sqm = annualRent / 12 / (tenant.leased_area as number);
  }

  const today = new Date();

  // LEASE_END CALCULATION (priority order):
  // 1. If we have lease_end → use it
  // 2. If we have lease_start + lease_duration_years → calculate lease_end
  // 3. If we have remaining_lease_years → calculate lease_end (today + remaining)
  
  if (!tenant.lease_end) {
    if (tenant.lease_start && tenant.lease_duration_years) {
      // Calculate lease_end from lease_start + duration
      const startDate = new Date(tenant.lease_start as string);
      const durationYears = tenant.lease_duration_years as number;
      if (!isNaN(startDate.getTime()) && durationYears > 0) {
        const endDate = new Date(startDate);
        endDate.setFullYear(endDate.getFullYear() + Math.floor(durationYears));
        endDate.setMonth(endDate.getMonth() + Math.round((durationYears % 1) * 12));
        enriched.lease_end = endDate.toISOString().split('T')[0];
      }
    } else if (tenant.remaining_lease_years) {
      // Calculate lease_end from remaining_lease_years (today + remaining)
      const remainingYears = tenant.remaining_lease_years as number;
      if (remainingYears > 0) {
        const endDate = new Date(today);
        endDate.setFullYear(endDate.getFullYear() + Math.floor(remainingYears));
        endDate.setMonth(endDate.getMonth() + Math.round((remainingYears % 1) * 12));
        enriched.lease_end = endDate.toISOString().split('T')[0];
      }
    }
  }

  // Calculate remaining_lease_years from lease_end if not provided
  if (!enriched.remaining_lease_years && enriched.lease_end) {
    const endDate = new Date(enriched.lease_end as string);
    const remainingYears = (endDate.getTime() - today.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (remainingYears > 0) {
      enriched.remaining_lease_years = Math.round(remainingYears * 10) / 10;
    }
  }

  // Calculate lease_duration_years if we have start and end but no duration
  if (!enriched.lease_duration_years && enriched.lease_start && enriched.lease_end) {
    const startDate = new Date(enriched.lease_start as string);
    const endDate = new Date(enriched.lease_end as string);
    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
      const durationYears = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (durationYears > 0) {
        enriched.lease_duration_years = Math.round(durationYears * 10) / 10;
      }
    }
  }
  
  return enriched;
}

// Recalculate portfolio totals from assets
async function recalculatePortfolioTotals(portfolioId: string) {
  const { data: assets } = await supabaseAdmin.from('assets').select('*').eq('portfolio_id', portfolioId);
  if (!assets || assets.length === 0) return;

  const { data: portfolio } = await supabaseAdmin.from('portfolios').select('*').eq('id', portfolioId).single();
  if (!portfolio) return;

  // Calculate WALT for each asset from its tenants (always recalculate)
  const assetIds = assets.map(a => a.id);
  const { data: allTenants } = await supabaseAdmin.from('tenants').select('*').in('asset_id', assetIds);
  
  const today = new Date();
  for (const asset of assets) {
    const assetTenants = allTenants?.filter(t => t.asset_id === asset.id) || [];
    if (assetTenants.length === 0) continue;
    
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
      await supabaseAdmin.from('assets').update({ walt: waltSum / rentSum }).eq('id', asset.id);
      asset.walt = waltSum / rentSum; // Update local copy for portfolio calc
    }
  }

  const updates: Record<string, unknown> = {};

  const totalGla = assets.reduce((s, a) => s + (a.gla || 0), 0);
  const totalRent = assets.reduce((s, a) => s + (a.annual_rent || 0), 0);
  const totalPrice = assets.reduce((s, a) => s + (a.purchase_price || 0), 0);
  const totalPlot = assets.reduce((s, a) => s + (a.plot_area || 0), 0);
  const totalParking = assets.reduce((s, a) => s + (a.parking_spaces || 0), 0);
  const totalParkingUnderground = assets.reduce((s, a) => s + (a.parking_spaces_underground || 0), 0);

  if (totalGla > 0 && !portfolio.total_gla) updates.total_gla = totalGla;
  if (totalRent > 0 && !portfolio.annual_rent_income) updates.annual_rent_income = totalRent;
  if (totalPrice > 0 && !portfolio.purchase_price) updates.purchase_price = totalPrice;
  if (totalPlot > 0 && !portfolio.total_plot_area) updates.total_plot_area = totalPlot;
  if (totalParking > 0 && !portfolio.total_parking_spaces) updates.total_parking_spaces = totalParking;
  if (totalParkingUnderground > 0 && !portfolio.total_parking_spaces_underground) updates.total_parking_spaces_underground = totalParkingUnderground;
  if (!portfolio.number_of_assets) updates.number_of_assets = assets.length;

  // Derived
  const purchasePrice = portfolio.purchase_price || totalPrice;
  const annualRent = portfolio.annual_rent_income || totalRent;
  const gla = portfolio.total_gla || totalGla;
  
  // rent_per_sqm = loyer MENSUEL / m² = annual_rent / 12 / gla
  if (annualRent > 0 && gla > 0 && !portfolio.rent_per_sqm) {
    updates.rent_per_sqm = annualRent / 12 / gla;
  }
  if (annualRent > 0 && purchasePrice > 0 && !portfolio.yield_percent) {
    updates.yield_percent = (annualRent / purchasePrice) * 100;
  }

  // WALT - weighted average of asset WALTs by rent (always recalculate)
  const waltSum = assets.reduce((s, a) => s + ((a.walt || 0) * (a.annual_rent || 0)), 0);
  if (totalRent > 0 && waltSum > 0) {
    updates.walt = waltSum / totalRent;
  }

  // Use allTenants already fetched above
  const tenants = allTenants;

  if (tenants && gla > 0) {
    const leasedArea = tenants.reduce((s, t) => s + (t.leased_area || 0), 0);
    if (leasedArea > 0) updates.occupancy_rate = (leasedArea / gla) * 100;
  }

  // Top tenant (by annual rent)
  if (tenants && tenants.length > 0 && annualRent > 0) {
    const sortedByRent = [...tenants].sort((a, b) => (b.annual_rent || 0) - (a.annual_rent || 0));
    const topTenant = sortedByRent[0];
    if (topTenant) {
      updates.top_tenant = topTenant.tenant_name;
      if (topTenant.annual_rent) {
        updates.top_tenant_share = (topTenant.annual_rent / annualRent) * 100;
      }
    }
  }

  // LEH percentage (Lebensmitteleinzelhandel - food retail)
  if (tenants && tenants.length > 0 && annualRent > 0) {
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

  if (Object.keys(updates).length > 0) {
    await supabaseAdmin.from('portfolios').update(updates).eq('id', portfolioId);
  }
}

// GET DOCUMENTS
export async function getDocuments() {
  const { data } = await supabaseAdmin.from('documents').select('*').order('created_at', { ascending: false });
  return data || [];
}

// GET PORTFOLIOS
export async function getPortfolios() {
  const { data } = await supabaseAdmin.from('portfolios').select('*').order('created_at', { ascending: false });
  return data || [];
}

// GET PORTFOLIO WITH DATA
export async function getPortfolioWithData(portfolioId: string) {
  const { data: portfolio } = await supabaseAdmin.from('portfolios').select('*').eq('id', portfolioId).single();
  if (!portfolio) return null;

  const { data: assets } = await supabaseAdmin.from('assets').select('*').eq('portfolio_id', portfolioId).order('city');
  const assetIds = (assets || []).map(a => a.id);

  let tenants: Record<string, unknown>[] = [];
  if (assetIds.length) {
    const { data } = await supabaseAdmin.from('tenants').select('*').in('asset_id', assetIds).order('annual_rent', { ascending: false });
    tenants = data || [];
  }

  return { portfolio, assets: assets || [], tenants };
}

// =============================================================================
// EMAIL ATTACHMENTS — store ALL email attachments (pdf, xlsx, docx, images, ...)
// not just the PDF that triggered the portfolio extraction.
// =============================================================================
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.-]/g, '_');
}

/**
 * Upload a single attachment to Supabase Storage and create a row in email_attachments.
 *
 * If portfolioId is provided, the file lives under `portfolios/{id}/...`.
 * Otherwise, it lives under `unassigned/{emailMessageId}/...` and the row's
 * portfolio_id is null. Call linkAttachmentsToPortfolio() later to relink.
 *
 * Returns the inserted row or null if upload failed.
 */
export async function storeEmailAttachment(opts: {
  base64: string;
  fileName: string;
  contentType?: string;
  sizeBytes?: number;
  emailMessageId?: string;
  emailSubject?: string;
  emailFrom?: string;
  portfolioId?: string | null;
  role?: 'primary' | 'secondary';
}): Promise<{ id: string; storage_path: string; public_url: string | null } | null> {
  try {
    const {
      base64, fileName, contentType, sizeBytes,
      emailMessageId, emailSubject, emailFrom,
      portfolioId, role = 'secondary',
    } = opts;

    const buffer = Buffer.from(base64, 'base64');
    const cleanName = sanitizeFileName(fileName);
    const folder = portfolioId
      ? `portfolios/${portfolioId}`
      : `unassigned/${emailMessageId || 'no-message-id'}`;
    const path = `${folder}/${Date.now()}_${cleanName}`;

    // Upload to Storage
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('documents')
      .upload(path, buffer, {
        contentType: contentType || 'application/octet-stream',
        upsert: true,
      });
    if (uploadErr) {
      console.error(`Attachment upload error (${fileName}):`, uploadErr);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('documents')
      .getPublicUrl(path);
    const publicUrl = urlData?.publicUrl || null;

    // Insert row in email_attachments
    const { data: row, error: insertErr } = await supabaseAdmin
      .from('email_attachments')
      .insert({
        portfolio_id: portfolioId || null,
        email_message_id: emailMessageId || null,
        email_subject: emailSubject || null,
        email_from: emailFrom || null,
        file_name: fileName,
        content_type: contentType || null,
        size_bytes: sizeBytes || buffer.length,
        storage_path: path,
        public_url: publicUrl,
        attachment_role: role,
      })
      .select('id, storage_path, public_url')
      .single();

    if (insertErr) {
      console.error(`email_attachments insert error (${fileName}):`, insertErr);
      return null;
    }
    return row;
  } catch (e) {
    console.error('storeEmailAttachment failed:', e);
    return null;
  }
}

/**
 * After a portfolio is created from a PDF extraction, link attachments
 * from the same email to that portfolio. Also moves files from the
 * 'unassigned/' folder to 'portfolios/{id}/' to keep storage organized.
 *
 * Pass `onlyFileName` to link a single file (used in multi-PDF emails so each
 * primary PDF lands on ITS portfolio instead of everything going to the first).
 */
export async function linkAttachmentsToPortfolio(
  emailMessageId: string,
  portfolioId: string,
  onlyFileName?: string,
): Promise<{ linkedCount: number; movedCount: number }> {
  try {
    // Find attachments from this email that aren't linked yet
    let query = supabaseAdmin
      .from('email_attachments')
      .select('id, storage_path, file_name, content_type')
      .eq('email_message_id', emailMessageId)
      .is('portfolio_id', null);
    if (onlyFileName) query = query.eq('file_name', onlyFileName);
    const { data: rows, error: fetchErr } = await query;

    if (fetchErr) {
      console.error('Failed to fetch unlinked attachments:', fetchErr);
      return { linkedCount: 0, movedCount: 0 };
    }

    if (!rows || rows.length === 0) return { linkedCount: 0, movedCount: 0 };

    let movedCount = 0;

    // For each, move from unassigned/ to portfolios/{id}/ if applicable
    for (const row of rows) {
      if (row.storage_path.startsWith('unassigned/')) {
        const filename = row.storage_path.split('/').pop();
        const newPath = `portfolios/${portfolioId}/${filename}`;

        // Supabase Storage doesn't have a native "move", so we download + re-upload + delete
        const { data: fileData, error: downErr } = await supabaseAdmin.storage
          .from('documents')
          .download(row.storage_path);
        if (downErr || !fileData) {
          console.warn(`Couldn't download ${row.storage_path}:`, downErr);
          continue;
        }
        const buffer = Buffer.from(await fileData.arrayBuffer());
        const { error: upErr } = await supabaseAdmin.storage
          .from('documents')
          .upload(newPath, buffer, {
            contentType: row.content_type || 'application/octet-stream',
            upsert: true,
          });
        if (upErr) {
          console.warn(`Couldn't upload to new path ${newPath}:`, upErr);
          continue;
        }

        const { data: urlData } = supabaseAdmin.storage
          .from('documents')
          .getPublicUrl(newPath);

        // Update the row with new path
        await supabaseAdmin
          .from('email_attachments')
          .update({
            storage_path: newPath,
            public_url: urlData?.publicUrl || null,
            portfolio_id: portfolioId,
          })
          .eq('id', row.id);

        // Delete the old unassigned file
        await supabaseAdmin.storage.from('documents').remove([row.storage_path]);
        movedCount++;
      } else {
        // Just update the portfolio_id
        await supabaseAdmin
          .from('email_attachments')
          .update({ portfolio_id: portfolioId })
          .eq('id', row.id);
      }
    }

    return { linkedCount: rows.length, movedCount };
  } catch (e) {
    console.error('linkAttachmentsToPortfolio failed:', e);
    return { linkedCount: 0, movedCount: 0 };
  }
}

/**
 * Fetch all attachments for a given portfolio.
 */
export async function getPortfolioAttachments(portfolioId: string) {
  const { data, error } = await supabaseAdmin
    .from('email_attachments')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .order('received_at', { ascending: false });
  if (error) {
    console.error('getPortfolioAttachments error:', error);
    return [];
  }
  return data || [];
}