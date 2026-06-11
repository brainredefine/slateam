// app/pending/page.tsx
// =============================================================================
// Pending imports review page.
// - Linear/Carta-style design consistent with the rest of the app.
// - Master/detail-ish: list of pending items, each expandable.
// - When an asset/portfolio is selected as target, the diff panel shows
//   "Current vs Incoming" side by side so the user can see exactly what
//   Append (adds new) or Replace (wipes + new) would do.
// - All existing business logic preserved: match candidates, multi-mapping,
//   forwarder notes, merge strategy, suggested portfolio/asset.
// =============================================================================
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';

// ─── Types ───────────────────────────────────────────────────────────────────
interface PendingImport {
  id: string;
  type: 'asset-list' | 'tenant-list';
  status: string;
  issue_type: string | null;
  raw_data: {
    assets?: Record<string, unknown>[];
    tenants?: Record<string, unknown>[];
    portfolio?: Record<string, unknown>;
    summary?: string;
  };
  file_name: string | null;
  target_name: string | null;
  forwarder_notes: string | null;
  suggested_portfolio_id: string | null;
  suggested_asset_id: string | null;
  match_candidates: Array<{ id: string; name: string; city?: string; street?: string; gla?: number; score: number; type: string }>;
  city_asset_mapping: Record<string, Array<{ asset_id: string; name?: string; street?: string; gla?: number; annual_rent?: number; tenant_count?: number }>>;
  created_at: string;
}
interface Portfolio {
  id: string;
  name: string;
  number_of_assets: number;
  total_gla: number;
  annual_rent_income: number;
  created_at: string;
}
interface Asset {
  id: string;
  city: string;
  street: string;
  gla: number;
  annual_rent: number;
  portfolio_id: string;
  name?: string;
}
interface Tenant {
  id: string;
  tenant_name?: string;
  brand?: string;
  asset_id?: string;
  leased_area?: number;
  annual_rent?: number;
  lease_end?: string;
}

// ─── Labels & formatters ─────────────────────────────────────────────────────
const ISSUE_META: Record<string, { label: string; tone: 'red' | 'amber' | 'blue' | 'purple' | 'cyan' }> = {
  no_match:           { label: 'No match',          tone: 'red' },
  multiple_matches:   { label: 'Multiple matches',  tone: 'amber' },
  existing_data:      { label: 'Existing data',     tone: 'blue' },
  ambiguous_city:     { label: 'Ambiguous city',    tone: 'purple' },
  multi_asset_tenants:{ label: 'Multi-asset',       tone: 'cyan' },
};
const TONE_CLASSES = {
  red:    'bg-red-50 text-red-700 border-red-200',
  amber:  'bg-amber-50 text-amber-700 border-amber-200',
  blue:   'bg-blue-50 text-blue-700 border-blue-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  cyan:   'bg-cyan-50 text-cyan-700 border-cyan-200',
  zinc:   'bg-zinc-50 text-zinc-700 border-zinc-200',
} as const;
const TYPE_META: Record<string, { label: string; icon: string }> = {
  'asset-list':  { label: 'Asset list',  icon: '🏢' },
  'tenant-list': { label: 'Tenant list', icon: '👥' },
};

const fmt = (n: number | null | undefined) => n ? n.toLocaleString('de-DE', { maximumFractionDigits: 0 }) : '—';
const fmtArea = (n: number | null | undefined) => n ? `${Math.round(n).toLocaleString('de-DE')} m²` : '—';
const fmtEur = (n: number | null | undefined) => {
  if (!n) return '—';
  if (Math.abs(n) >= 1_000_000) return `€${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `€${(n / 1_000).toFixed(0)}k`;
  return `€${n.toFixed(0)}`;
};
const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};
const fmtRelative = (s: string | null | undefined) => {
  if (!s) return '';
  const d = new Date(s);
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 60 / 24)}d ago`;
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================
export default function PendingPage() {
  const [items, setItems] = useState<PendingImport[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Resolution state per item
  const [selections, setSelections] = useState<Record<string, {
    portfolioId?: string;
    assetId?: string;
    cityMapping?: Record<string, string>;
    mergeStrategy?: 'replace' | 'append';
  }>>({});

  // Current tenants/assets of the selected target (for diff display)
  const [targetTenants, setTargetTenants] = useState<Record<string, Tenant[]>>({});
  const [targetAssets, setTargetAssets] = useState<Record<string, Asset[]>>({});

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/pending');
      const data = await res.json();
      setItems(data.pending || []);

      const pRes = await fetch('/api/data?view=portfolios');
      const pData = await pRes.json();
      setPortfolios(Array.isArray(pData) ? pData : pData.data || []);
    } catch (e) {
      console.error('Failed to load pending imports:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Load assets when a portfolio is selected
  const loadAssetsForPortfolio = async (portfolioId: string) => {
    if (!portfolioId) { setAssets([]); return; }
    try {
      const res = await fetch(`/api/pending?portfolioId=${portfolioId}`);
      const data = await res.json();
      setAssets(data.assets || []);

      // Also fetch the portfolio's full data for the diff panel
      const portRes = await fetch(`/api/data?portfolioId=${portfolioId}`);
      const portData = await portRes.json();
      const fullData = portData.data || portData;
      if (fullData?.assets) {
        setTargetAssets(prev => ({ ...prev, [portfolioId]: fullData.assets }));
      }
      if (fullData?.tenants) {
        // Index tenants by asset_id for fast lookup
        const byAsset: Record<string, Tenant[]> = {};
        for (const t of fullData.tenants) {
          if (t.asset_id) {
            if (!byAsset[t.asset_id]) byAsset[t.asset_id] = [];
            byAsset[t.asset_id].push(t);
          }
        }
        setTargetTenants(prev => ({ ...prev, ...byAsset }));
      }
    } catch (e) {
      console.error('Failed to load assets:', e);
    }
  };

  const updateSelection = (itemId: string, updates: Partial<typeof selections[string]>) => {
    setSelections(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...updates },
    }));
  };

  // Handle match candidate click — auto-fill portfolio & asset dropdowns
  const handleMatchClick = async (item: PendingImport, candidate: PendingImport['match_candidates'][0]) => {
    if (candidate.type === 'portfolio') {
      updateSelection(item.id, { portfolioId: candidate.id, assetId: undefined });
      loadAssetsForPortfolio(candidate.id);
    } else {
      // Asset match — find its parent portfolio
      updateSelection(item.id, { assetId: candidate.id });
      const matchedAsset = assets.find(a => a.id === candidate.id);
      if (matchedAsset?.portfolio_id) {
        updateSelection(item.id, { assetId: candidate.id, portfolioId: matchedAsset.portfolio_id });
        loadAssetsForPortfolio(matchedAsset.portfolio_id);
      } else {
        try {
          const r = await fetch('/api/data?view=assets');
          const d = await r.json();
          const allAssets = d.data || d || [];
          const found = allAssets.find((a: Asset) => a.id === candidate.id);
          if (found?.portfolio_id) {
            updateSelection(item.id, { assetId: candidate.id, portfolioId: found.portfolio_id });
            loadAssetsForPortfolio(found.portfolio_id);
          }
        } catch (e) { /* ignore */ }
      }
    }
  };

  const handleResolve = async (itemId: string, action: 'apply' | 'reject') => {
    setResolving(itemId);
    try {
      const sel = selections[itemId] || {};
      const res = await fetch(`/api/pending/${itemId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          portfolioId: sel.portfolioId,
          assetId: sel.assetId,
          cityMapping: sel.cityMapping,
          mergeStrategy: sel.mergeStrategy || 'append',
        }),
      });
      if (res.ok) {
        setItems(prev => prev.filter(p => p.id !== itemId));
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (e) {
      alert(`Error: ${e}`);
    }
    setResolving(null);
  };

  const handleReject = async (itemId: string) => {
    if (!confirm('Reject this import? The data will be kept but marked as rejected.')) return;
    await handleResolve(itemId, 'reject');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 grid place-items-center">
        <div className="w-6 h-6 border-2 border-[#6D7C60] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50" style={{ fontFeatureSettings: "'cv11','ss01'" }}>
      <Header pendingCount={items.length} />

      <main className="max-w-[1500px] mx-auto px-7 py-8">
        {/* Page title */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 leading-none mb-2">Pending imports</h1>
          <p className="text-[13px] text-zinc-500">
            {items.length === 0
              ? 'Nothing to review right now.'
              : <><span className="tabular-nums font-medium text-zinc-700">{items.length}</span> item{items.length === 1 ? '' : 's'} awaiting your review.</>
            }
          </p>
        </div>

        {items.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {items.map(item => (
              <PendingItemCard
                key={item.id}
                item={item}
                isExpanded={expandedId === item.id}
                onToggleExpand={() => {
                  const newId = expandedId === item.id ? null : item.id;
                  setExpandedId(newId);
                  if (newId && item.suggested_portfolio_id) {
                    loadAssetsForPortfolio(item.suggested_portfolio_id);
                  }
                }}
                portfolios={portfolios}
                assets={assets}
                selection={selections[item.id] || {}}
                onUpdateSelection={(u) => updateSelection(item.id, u)}
                onPortfolioChange={loadAssetsForPortfolio}
                onMatchClick={(c) => handleMatchClick(item, c)}
                targetTenants={targetTenants}
                targetAssets={targetAssets}
                onResolve={(action) => action === 'reject' ? handleReject(item.id) : handleResolve(item.id, action)}
                isResolving={resolving === item.id}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// =============================================================================
// HEADER
// =============================================================================
function Header({ pendingCount }: { pendingCount: number }) {
  return (
    <header className="bg-white border-b border-zinc-200 sticky top-0 z-40">
      <div className="max-w-[1500px] mx-auto px-7 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 bg-[#6D7C60] rounded-md grid place-items-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <span className="text-[14px] font-bold text-zinc-900 tracking-tight">RE Analyzer</span>
          </Link>
          <span className="text-zinc-300 text-sm">/</span>
          <span className="text-[13px] font-medium text-zinc-600 flex items-center gap-1.5">
            Pending imports
            {pendingCount > 0 && (
              <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">
                {pendingCount}
              </span>
            )}
          </span>
        </div>
        <Link href="/dashboard"
              className="px-3 py-1.5 text-[12px] font-medium text-zinc-700 hover:bg-zinc-100 rounded-md inline-flex items-center gap-1">
          ← Dashboard
        </Link>
      </div>
    </header>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================
function EmptyState() {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl py-16 text-center">
      <div className="w-12 h-12 bg-emerald-50 rounded-full grid place-items-center mx-auto mb-3">
        <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-[14px] font-bold text-zinc-900 mb-1">All clear</h3>
      <p className="text-[12px] text-zinc-500">No pending imports to review.</p>
    </div>
  );
}

// =============================================================================
// PENDING ITEM CARD
// =============================================================================
function PendingItemCard({
  item, isExpanded, onToggleExpand,
  portfolios, assets, selection, onUpdateSelection, onPortfolioChange, onMatchClick,
  targetTenants, targetAssets,
  onResolve, isResolving,
}: {
  item: PendingImport;
  isExpanded: boolean;
  onToggleExpand: () => void;
  portfolios: Portfolio[];
  assets: Asset[];
  selection: { portfolioId?: string; assetId?: string; cityMapping?: Record<string, string>; mergeStrategy?: 'replace' | 'append' };
  onUpdateSelection: (u: Partial<typeof selection>) => void;
  onPortfolioChange: (portfolioId: string) => void;
  onMatchClick: (c: PendingImport['match_candidates'][0]) => void;
  targetTenants: Record<string, Tenant[]>;
  targetAssets: Record<string, Asset[]>;
  onResolve: (action: 'apply' | 'reject') => void;
  isResolving: boolean;
}) {
  const typeInfo = TYPE_META[item.type] || { label: item.type, icon: '📄' };
  const issue = item.issue_type ? ISSUE_META[item.issue_type] : null;

  const dataCount = item.type === 'asset-list'
    ? (item.raw_data.assets?.length || 0)
    : (item.raw_data.tenants?.length || 0);

  // Location keys (city or city+street) from city_asset_mapping or extracted from data
  const mappingKeys = item.city_asset_mapping ? Object.keys(item.city_asset_mapping) : [];
  const cities = mappingKeys.length > 0
    ? mappingKeys
    : item.type === 'tenant-list'
      ? [...new Set((item.raw_data.tenants || []).map(t => {
          const city = t.asset_city as string;
          const street = t.asset_street as string;
          return street ? `${city} — ${street}` : city;
        }).filter(Boolean))]
      : [...new Set((item.raw_data.assets || []).map(a => a.city as string).filter(Boolean))];

  // Effective target ids (selection takes priority, then suggested)
  const effectivePortfolioId = selection.portfolioId || item.suggested_portfolio_id || undefined;
  const effectiveAssetId = selection.assetId || item.suggested_asset_id || undefined;

  // For multi-mapping: build the effective mapping = user selection OR auto-selected
  // (when there's exactly 1 candidate for a location, we auto-select it)
  const effectiveCityMapping: Record<string, string> = {};
  if (item.type === 'tenant-list' && cities.length > 1) {
    for (const loc of cities) {
      const userPick = selection.cityMapping?.[loc];
      const candidates = item.city_asset_mapping?.[loc] || [];
      const autoSelected = candidates.length === 1 ? candidates[0].asset_id : '';
      const effective = userPick || autoSelected;
      if (effective) effectiveCityMapping[loc] = effective;
    }
  }
  const mappedCount = Object.keys(effectiveCityMapping).length;

  const canApply =
    (item.type === 'asset-list' && !!effectivePortfolioId) ||
    (item.type === 'tenant-list' && cities.length <= 1 && !!effectiveAssetId) ||
    (item.type === 'tenant-list' && cities.length > 1 && mappedCount === cities.length);

  // Build a diagnostic message for the disabled-Apply tooltip
  let disabledReason = '';
  if (item.type === 'asset-list' && !effectivePortfolioId) {
    disabledReason = 'Select a portfolio first';
  } else if (item.type === 'tenant-list' && cities.length <= 1 && !effectiveAssetId) {
    disabledReason = 'Select an asset first';
  } else if (item.type === 'tenant-list' && cities.length > 1 && mappedCount < cities.length) {
    disabledReason = `Assign an asset for each of the ${cities.length} locations (${mappedCount}/${cities.length} done)`;
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      {/* Collapsed header — clickable */}
      <button
        onClick={onToggleExpand}
        className="w-full text-left px-5 py-3.5 flex items-center justify-between hover:bg-zinc-50/60 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-xl flex-shrink-0">{typeInfo.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13.5px] font-semibold text-zinc-900 truncate">
                {item.file_name || item.target_name || 'Unknown file'}
              </span>
              <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-600 font-medium">
                {typeInfo.label}
              </span>
              {issue && (
                <span className={`text-[10.5px] px-2 py-0.5 rounded-md border font-medium ${TONE_CLASSES[issue.tone]}`}>
                  {issue.label}
                </span>
              )}
            </div>
            <div className="text-[11.5px] text-zinc-500 mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="tabular-nums font-medium text-zinc-600">{dataCount}</span>
              <span>{item.type === 'asset-list' ? 'asset' : 'tenant'}{dataCount === 1 ? '' : 's'}</span>
              {cities.length > 0 && (
                <>
                  <span className="text-zinc-300">·</span>
                  <span>{cities.slice(0, 3).join(', ')}{cities.length > 3 ? ` +${cities.length - 3}` : ''}</span>
                </>
              )}
              {item.target_name && (
                <>
                  <span className="text-zinc-300">·</span>
                  <span>target: <strong className="text-zinc-700">{item.target_name}</strong></span>
                </>
              )}
              <span className="text-zinc-300">·</span>
              <span>{fmtRelative(item.created_at)}</span>
            </div>
          </div>
        </div>
        <svg className={`w-4 h-4 text-zinc-400 transition-transform flex-shrink-0 ml-3 ${isExpanded ? 'rotate-180' : ''}`}
             fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-zinc-100 p-5 space-y-5 bg-zinc-50/40">

          {/* Forwarder notes */}
          {item.forwarder_notes && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">📝 Forwarder note</div>
              <div className="text-[12px] text-amber-900 whitespace-pre-wrap leading-relaxed">{item.forwarder_notes}</div>
            </div>
          )}

          {/* Match candidates */}
          {item.match_candidates && item.match_candidates.length > 0 && (
            <Section title="Suggested matches">
              <div className="flex flex-wrap gap-2">
                {item.match_candidates.map(c => {
                  const isSelected = selection.portfolioId === c.id || selection.assetId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onMatchClick(c)}
                      className={`px-3 py-1.5 text-[12px] rounded-md border inline-flex items-center gap-2 transition-colors ${
                        isSelected
                          ? 'bg-[#6D7C60] text-white border-[#6D7C60]'
                          : 'bg-white text-zinc-700 border-zinc-200 hover:border-[#6D7C60] hover:bg-zinc-50'
                      }`}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className={`text-[10px] tabular-nums ${isSelected ? 'text-white/80' : 'text-zinc-400'}`}>
                        {c.score}%
                      </span>
                      {c.gla ? (
                        <span className={`text-[10px] ${isSelected ? 'text-white/80' : 'text-zinc-400'}`}>· {fmtArea(c.gla)}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Resolution controls */}
          <Section title={item.type === 'asset-list' ? 'Link to portfolio' : 'Link to asset'}>
            <div className="space-y-3">
              {/* Portfolio dropdown */}
              <div>
                <label className="block text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Portfolio</label>
                <select
                  value={effectivePortfolioId || ''}
                  onChange={(e) => {
                    onUpdateSelection({ portfolioId: e.target.value, assetId: undefined });
                    onPortfolioChange(e.target.value);
                  }}
                  className="w-full px-3 py-2 text-[12.5px] bg-white border border-zinc-200 rounded-md focus:outline-none focus:border-[#6D7C60] focus:ring-2 focus:ring-[#6D7C60]/20"
                >
                  <option value="">Select portfolio...</option>
                  {portfolios.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name || 'Unnamed'} — {p.number_of_assets || 0} assets, {fmtEur(p.annual_rent_income)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Asset dropdown (single city tenant-list) */}
              {item.type === 'tenant-list' && cities.length <= 1 && (
                <div>
                  <label className="block text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Asset</label>
                  <select
                    value={effectiveAssetId || ''}
                    onChange={(e) => onUpdateSelection({ assetId: e.target.value })}
                    className="w-full px-3 py-2 text-[12.5px] bg-white border border-zinc-200 rounded-md focus:outline-none focus:border-[#6D7C60] focus:ring-2 focus:ring-[#6D7C60]/20"
                  >
                    <option value="">Select asset...</option>
                    {assets.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name || a.city}{a.street ? ` — ${a.street}` : ''} · {fmtArea(a.gla)} · {fmtEur(a.annual_rent)}/yr
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Multi-location mapping */}
              {item.type === 'tenant-list' && cities.length > 1 && (
                <MultiLocationMapping
                  item={item}
                  cities={cities}
                  assets={assets}
                  cityMapping={selection.cityMapping || {}}
                  onChange={(m) => onUpdateSelection({ cityMapping: m })}
                />
              )}
            </div>
          </Section>

          {/* Diff panel — current vs incoming */}
          {(effectiveAssetId || effectivePortfolioId) && (
            <DiffPanel
              item={item}
              portfolioId={effectivePortfolioId}
              assetId={effectiveAssetId}
              mergeStrategy={selection.mergeStrategy || 'append'}
              targetTenants={targetTenants}
              targetAssets={targetAssets}
              portfolios={portfolios}
              assets={assets}
            />
          )}

          {/* Data preview (collapsed by default) */}
          <RawDataPreview item={item} />

          {/* Actions footer */}
          <div className="flex items-center justify-between gap-3 pt-2">
            {/* Merge strategy toggle */}
            <MergeStrategyToggle
              value={selection.mergeStrategy || 'append'}
              onChange={(v) => onUpdateSelection({ mergeStrategy: v })}
              type={item.type}
            />

            <div className="flex items-center gap-3">
              {!canApply && disabledReason && (
                <span className="text-[10.5px] text-amber-700 italic">⚠ {disabledReason}</span>
              )}
              <button
                onClick={() => onResolve('reject')}
                disabled={isResolving}
                className="px-3 py-2 text-[12px] font-semibold text-red-700 hover:bg-red-50 rounded-md disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={() => onResolve('apply')}
                disabled={isResolving || !canApply}
                title={!canApply ? disabledReason : 'Apply this import to the database'}
                className="px-4 py-2 text-[12px] font-semibold bg-[#6D7C60] hover:bg-[#5d6c50] text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {isResolving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {isResolving ? 'Applying…' : '✓ Apply import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// SECTION (label + content)
// =============================================================================
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] font-bold text-zinc-500 uppercase tracking-[0.7px] mb-2">{title}</div>
      {children}
    </div>
  );
}

// =============================================================================
// MERGE STRATEGY TOGGLE
// =============================================================================
function MergeStrategyToggle({ value, onChange, type }: {
  value: 'append' | 'replace';
  onChange: (v: 'append' | 'replace') => void;
  type: 'asset-list' | 'tenant-list';
}) {
  const childLabel = type === 'asset-list' ? 'assets' : 'tenants';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wider">Strategy:</span>
      <div className="inline-flex bg-white border border-zinc-200 rounded-md p-0.5">
        <button
          onClick={() => onChange('append')}
          className={`px-3 py-1 text-[11.5px] font-semibold rounded transition-colors ${
            value === 'append' ? 'bg-[#6D7C60] text-white' : 'text-zinc-600 hover:bg-zinc-50'
          }`}
          title={`Add new ${childLabel}, keep existing`}
        >
          ➕ Append
        </button>
        <button
          onClick={() => onChange('replace')}
          className={`px-3 py-1 text-[11.5px] font-semibold rounded transition-colors ${
            value === 'replace' ? 'bg-red-600 text-white' : 'text-zinc-600 hover:bg-zinc-50'
          }`}
          title={`Delete existing ${childLabel}, then add new`}
        >
          🔄 Replace
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// MULTI-LOCATION MAPPING
// =============================================================================
function MultiLocationMapping({ item, cities, assets, cityMapping, onChange }: {
  item: PendingImport;
  cities: string[];
  assets: Asset[];
  cityMapping: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
}) {
  return (
    <div>
      <label className="block text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
        Asset per location ({cities.length})
      </label>
      <p className="text-[11px] text-zinc-500 mb-2">
        This tenant list covers {cities.length} locations. Assign each one to an asset.
      </p>
      <div className="space-y-2">
        {cities.map(locationKey => {
          const candidates = item.city_asset_mapping?.[locationKey] || [];
          const [cityPart, streetPart] = locationKey.includes(' — ')
            ? locationKey.split(' — ')
            : [locationKey, null];
          const tenantCount = (item.raw_data.tenants || []).filter(t => {
            if (streetPart) {
              return (t.asset_city as string) === cityPart && (t.asset_street as string) === streetPart;
            }
            return (t.asset_city as string) === cityPart;
          }).length;
          const autoSelected = candidates.length === 1 ? candidates[0].asset_id : '';

          return (
            <div key={locationKey} className="bg-white border border-zinc-200 rounded-md px-3 py-2 flex items-center gap-3">
              <div className="min-w-[160px] flex-shrink-0">
                <div className="text-[12px] font-semibold text-zinc-900">{locationKey}</div>
                <div className="text-[10.5px] text-zinc-500 tabular-nums">{tenantCount} tenant{tenantCount === 1 ? '' : 's'}</div>
              </div>
              <span className="text-zinc-300">→</span>
              <select
                value={cityMapping[locationKey] || autoSelected}
                onChange={(e) => onChange({ ...cityMapping, [locationKey]: e.target.value })}
                className={`flex-1 px-2 py-1.5 text-[11.5px] bg-white border rounded-md focus:outline-none focus:border-[#6D7C60] focus:ring-2 focus:ring-[#6D7C60]/20 ${
                  candidates.length > 1 ? 'border-purple-300' : 'border-zinc-200'
                }`}
              >
                <option value="">Select asset...</option>
                {candidates.length > 0 ? (
                  candidates.map(a => (
                    <option key={a.asset_id} value={a.asset_id}>
                      {a.street || cityPart} · {fmtArea(a.gla)} · {a.tenant_count || 0} existing tenants
                    </option>
                  ))
                ) : (
                  assets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.city}{a.street ? ` — ${a.street}` : ''} · {fmtArea(a.gla)}
                    </option>
                  ))
                )}
              </select>
              {candidates.length > 1 && (
                <span className="text-[10px] font-semibold text-purple-600 flex-shrink-0">
                  ⚠ {candidates.length} options
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// DIFF PANEL — Current vs Incoming
// =============================================================================
function DiffPanel({
  item, portfolioId, assetId, mergeStrategy, targetTenants, targetAssets, portfolios, assets,
}: {
  item: PendingImport;
  portfolioId?: string;
  assetId?: string;
  mergeStrategy: 'append' | 'replace';
  targetTenants: Record<string, Tenant[]>;
  targetAssets: Record<string, Asset[]>;
  portfolios: Portfolio[];
  assets: Asset[];
}) {
  // Tenant import targeting one asset
  if (item.type === 'tenant-list' && assetId) {
    const currentRaw = targetTenants[assetId] || [];
    const incomingRaw = (item.raw_data.tenants || []) as any[];
    // Sort both by leased_area DESC so rows align visually side-by-side
    const current = [...currentRaw].sort((a, b) => (b.leased_area || 0) - (a.leased_area || 0));
    const incoming = [...incomingRaw].sort((a, b) => ((b.leased_area as number) || 0) - ((a.leased_area as number) || 0));
    const targetAsset = assets.find(a => a.id === assetId);
    return (
      <Section title="Current vs Incoming">
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/60">
            <div className="text-[12px] font-semibold text-zinc-900">
              Target: <span className="text-[#6D7C60]">{targetAsset?.name || targetAsset?.city || 'this asset'}</span>
            </div>
            <div className="text-[10.5px] text-zinc-500 mt-0.5">
              {mergeStrategy === 'replace'
                ? <><span className="text-red-700 font-semibold">Replace mode</span> — all {current.length} existing tenant{current.length === 1 ? '' : 's'} will be deleted, then {incoming.length} new added.</>
                : <><span className="text-emerald-700 font-semibold">Append mode</span> — {incoming.length} new tenant{incoming.length === 1 ? '' : 's'} added to the existing {current.length}.</>
              }
            </div>
          </div>
          <div className="grid grid-cols-2 gap-0 divide-x divide-zinc-100">
            <DiffSide
              title={`Current (${current.length})`}
              subtitle={mergeStrategy === 'replace' ? 'Will be DELETED' : 'Will be KEPT'}
              tone={mergeStrategy === 'replace' ? 'red' : 'zinc'}
              items={current.map(t => ({
                primary: t.tenant_name || t.brand || '(unnamed)',
                secondary: `${fmtArea(t.leased_area)} · ${fmtEur(t.annual_rent)} · ends ${fmtDate(t.lease_end)}`,
              }))}
              emptyLabel="No existing tenants on this asset"
            />
            <DiffSide
              title={`Incoming (${incoming.length})`}
              subtitle="Will be ADDED"
              tone="emerald"
              items={incoming.map(t => ({
                primary: (t.tenant_name as string) || (t.brand as string) || '(unnamed)',
                secondary: `${fmtArea(t.leased_area as number)} · ${fmtEur(t.annual_rent as number)} · ends ${fmtDate(t.lease_end as string)}`,
              }))}
              emptyLabel="No tenants in the import"
            />
          </div>
        </div>
      </Section>
    );
  }

  // Asset import targeting a portfolio
  if (item.type === 'asset-list' && portfolioId) {
    const currentRaw = targetAssets[portfolioId] || [];
    const incomingRaw = (item.raw_data.assets || []) as any[];
    // Sort both by gla DESC so rows align visually side-by-side
    const current = [...currentRaw].sort((a, b) => (b.gla || 0) - (a.gla || 0));
    const incoming = [...incomingRaw].sort((a, b) => ((b.gla as number) || 0) - ((a.gla as number) || 0));
    const targetPortfolio = portfolios.find(p => p.id === portfolioId);
    return (
      <Section title="Current vs Incoming">
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/60">
            <div className="text-[12px] font-semibold text-zinc-900">
              Target: <span className="text-[#6D7C60]">{targetPortfolio?.name || 'this portfolio'}</span>
            </div>
            <div className="text-[10.5px] text-zinc-500 mt-0.5">
              {mergeStrategy === 'replace'
                ? <><span className="text-red-700 font-semibold">Replace mode</span> — all {current.length} existing asset{current.length === 1 ? '' : 's'} will be deleted, then {incoming.length} new added.</>
                : <><span className="text-emerald-700 font-semibold">Append mode</span> — {incoming.length} new asset{incoming.length === 1 ? '' : 's'} added to the existing {current.length}.</>
              }
            </div>
          </div>
          <div className="grid grid-cols-2 gap-0 divide-x divide-zinc-100">
            <DiffSide
              title={`Current (${current.length})`}
              subtitle={mergeStrategy === 'replace' ? 'Will be DELETED' : 'Will be KEPT'}
              tone={mergeStrategy === 'replace' ? 'red' : 'zinc'}
              items={current.map(a => ({
                primary: a.name || a.city || '(unnamed)',
                secondary: `${a.street || '—'} · ${fmtArea(a.gla)} · ${fmtEur(a.annual_rent)}/yr`,
              }))}
              emptyLabel="No existing assets in this portfolio"
            />
            <DiffSide
              title={`Incoming (${incoming.length})`}
              subtitle="Will be ADDED"
              tone="emerald"
              items={incoming.map(a => ({
                primary: (a.name as string) || (a.city as string) || '(unnamed)',
                secondary: `${(a.street as string) || '—'} · ${fmtArea(a.gla as number)} · ${fmtEur(a.annual_rent as number)}/yr`,
              }))}
              emptyLabel="No assets in the import"
            />
          </div>
        </div>
      </Section>
    );
  }

  // Tenant import with multi-mapping — we don't show the diff (too complex,
  // the user can validate after one location at a time)
  return null;
}

function DiffSide({ title, subtitle, tone, items, emptyLabel }: {
  title: string;
  subtitle: string;
  tone: 'red' | 'emerald' | 'zinc';
  items: Array<{ primary: string; secondary: string }>;
  emptyLabel: string;
}) {
  const toneClasses = {
    red:     { bg: 'bg-red-50/50',     text: 'text-red-700',     dot: 'bg-red-400' },
    emerald: { bg: 'bg-emerald-50/50', text: 'text-emerald-700', dot: 'bg-emerald-400' },
    zinc:    { bg: 'bg-zinc-50/50',    text: 'text-zinc-600',    dot: 'bg-zinc-400' },
  }[tone];

  return (
    <div className="min-w-0">
      <div className={`px-4 py-2 ${toneClasses.bg} border-b border-zinc-100 flex items-center justify-between gap-2`}>
        <span className="text-[11.5px] font-semibold text-zinc-800 truncate">{title}</span>
        <span className={`text-[9.5px] font-bold tracking-wider uppercase ${toneClasses.text} flex items-center gap-1 flex-shrink-0`}>
          <span className={`w-1.5 h-1.5 rounded-full ${toneClasses.dot}`} />
          {subtitle}
        </span>
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-4 py-6 text-[11px] text-zinc-400 italic text-center">{emptyLabel}</div>
        ) : (
          items.map((it, i) => (
            <div key={i} className={`px-4 py-1.5 ${i === items.length - 1 ? '' : 'border-b border-zinc-50'}`}>
              <div className="text-[11.5px] font-medium text-zinc-800 truncate">{it.primary}</div>
              <div className="text-[10.5px] text-zinc-500 tabular-nums truncate">{it.secondary}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// =============================================================================
// RAW DATA PREVIEW (collapsed by default)
// =============================================================================
function RawDataPreview({ item }: { item: PendingImport }) {
  const [open, setOpen] = useState(false);
  const dataCount = item.type === 'asset-list'
    ? (item.raw_data.assets?.length || 0)
    : (item.raw_data.tenants?.length || 0);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1.5"
      >
        <span className={`transition-transform inline-block ${open ? 'rotate-90' : ''}`}>▸</span>
        {open ? 'Hide' : 'Show'} raw data ({dataCount} row{dataCount === 1 ? '' : 's'})
      </button>
      {open && (
        <div className="mt-2 bg-white border border-zinc-200 rounded-md overflow-hidden">
          <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
            {item.type === 'asset-list' && item.raw_data.assets && (
              <table className="w-full text-[11.5px]">
                <thead className="bg-zinc-50 sticky top-0">
                  <tr className="border-b border-zinc-200">
                    <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">City</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Street</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">GLA</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Rent p.a.</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {item.raw_data.assets.map((a, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-zinc-800">{(a.city as string) || '—'}</td>
                      <td className="px-3 py-1.5 text-zinc-600">{(a.street as string) || '—'}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-800 tabular-nums">{fmtArea(a.gla as number)}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-800 tabular-nums">{fmtEur(a.annual_rent as number)}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-800 tabular-nums">{fmtEur(a.purchase_price as number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {item.type === 'tenant-list' && item.raw_data.tenants && (
              <table className="w-full text-[11.5px]">
                <thead className="bg-zinc-50 sticky top-0">
                  <tr className="border-b border-zinc-200">
                    <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">City</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Tenant</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Area</th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Rent p.a.</th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Lease end</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {item.raw_data.tenants.map((t, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-zinc-600">{(t.asset_city as string) || '—'}</td>
                      <td className="px-3 py-1.5 text-zinc-800 font-medium">{(t.tenant_name as string) || '—'}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-800 tabular-nums">{fmtArea(t.leased_area as number)}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-800 tabular-nums">{fmtEur(t.annual_rent as number)}</td>
                      <td className="px-3 py-1.5 text-zinc-600">{fmtDate(t.lease_end as string)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}