// components/RecalcModal.tsx
// =============================================================================
// Master/detail modal for rigorous recalc-from-children audit.
//
// Two tabs (Assets / Portfolio).
//
// ASSETS TAB:
//   - Left: list of all assets with change indicators
//   - Right: details for the selected asset
//        - Per-field card (GLA, Annual rent, WALT)
//        - Checkbox to opt in/out of applying that field
//        - Current vs proposed value
//        - Expandable list of contributing tenants
//        - Indicator when WALT remaining was derived from lease_end
//   - Apply button at bottom commits ONLY the checked fields
//
// PORTFOLIO TAB:
//   - List of portfolio fields with checkboxes
//   - Same per-field opt-in pattern
//   - Coverage stats at top
// =============================================================================
'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';

type Scope = 'assets' | 'portfolio';
type AssetField = 'gla' | 'annual_rent' | 'walt';

interface TenantContribution {
  id: string;
  name: string;
  is_vacant: boolean;
  value: number;
  source?: 'stored' | 'computed';
  lease_end?: string | null;
}

interface AssetTenantInfo {
  id: string;
  name: string;
  is_vacant: boolean;
  gla: number | null;
  annual_rent: number | null;
  remaining_lease_years: number | null;
  lease_end: string | null;
  has_computed_remaining: boolean;
}

interface AssetRecalcDetail {
  id: string;
  name: string;
  current: { gla: number | null; annual_rent: number | null; walt: number | null };
  proposed: { gla?: number; annual_rent?: number; walt?: number };
  contributions: { gla: TenantContribution[]; annual_rent: TenantContribution[]; walt: TenantContribution[] };
  allTenants: AssetTenantInfo[];
  tenantCount: number;
}

interface AssetsPreview {
  scope: 'assets';
  assets: AssetRecalcDetail[];
  coverage: { totalAssets: number; assetsWithTenants: number; assetsWithChanges: number };
}

interface PortfolioDiff {
  field: string;
  label: string;
  before: number | string | null;
  after: number | string;
  changed: boolean;
}

interface PortfolioPreview {
  scope: 'portfolio';
  diff: PortfolioDiff[];
  coverage: {
    totalAssets: number;
    assetsWithGla: number;
    assetsWithRent: number;
    assetsWithWalt: number;
    totalTenants: number;
    nonVacantTenants: number;
    tenantsWithRent: number;
    tenantsWithLease: number;
    glaCoveragePct: number;
    rentCoveragePct: number;
    leaseCoveragePct: number;
    leaseCoverageSource: 'tenants' | 'assets' | 'none';
  };
}

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmtVal = (field: string, v: number | string | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (field === 'total_gla' || field === 'gla') return `${Math.round(v).toLocaleString('de-DE')} m²`;
  if (field === 'annual_rent_income' || field === 'annual_rent' || field === 'noi') {
    if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
    return `€${v.toFixed(0)}`;
  }
  if (field === 'multiplier') return `${v.toFixed(2)}×`;
  if (['cap_rate', 'noi_margin', 'ltv', 'occupancy_rate', 'leh_percentage', 'top_tenant_share'].includes(field)) {
    return `${v.toFixed(2)}%`;
  }
  if (field === 'walt') return `${v.toFixed(1)} yrs`;
  if (field === 'price_per_sqm') return `€${v.toFixed(0)}/m²`;
  if (field === 'rent_per_sqm') return `€${v.toFixed(1)}/m²/mo`;
  if (field === 'number_of_assets') return `${Math.round(v)}`;
  return v.toFixed(2);
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const assetHasProposedField = (a: AssetRecalcDetail, f: AssetField): boolean => {
  return a.proposed[f] !== undefined;
};

const assetFieldChanged = (a: AssetRecalcDetail, f: AssetField): boolean => {
  const after = a.proposed[f];
  if (after === undefined) return false;
  const before = a.current[f];
  if (before === null) return true;
  return Math.abs(after - before) / Math.max(Math.abs(after), 1) > 0.001;
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================
export function RecalcModal({
  portfolioId,
  onClose,
  onCommitted,
}: {
  portfolioId: string;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const [scope, setScope] = useState<Scope>('assets');

  const [assetsPreview, setAssetsPreview] = useState<AssetsPreview | null>(null);
  const [portfolioPreview, setPortfolioPreview] = useState<PortfolioPreview | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [loadingPortfolio, setLoadingPortfolio] = useState(true);
  const [committingScope, setCommittingScope] = useState<Scope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Selected asset in the master list
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  // Field selections per asset:
  // Map<assetId, Set<AssetField>>  → set of fields user wants to apply
  // We initialize each asset with all CHANGED fields auto-checked.
  const [assetSelections, setAssetSelections] = useState<Map<string, Set<AssetField>>>(new Map());

  // Portfolio field selections (initialized with all changed fields)
  const [portfolioSelections, setPortfolioSelections] = useState<Set<string>>(new Set());

  // ─── Fetch previews ────────────────────────────────────────────────────────
  const loadPreview = useCallback(async (s: Scope) => {
    if (s === 'assets') setLoadingAssets(true);
    else setLoadingPortfolio(true);
    setError(null);

    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/recalc-from-children?scope=${s}`);
      const data = await res.json();
      if ('error' in data) {
        setError(data.error);
      } else {
        if (s === 'assets') {
          setAssetsPreview(data);
          // Auto-select changed fields per asset
          const initial = new Map<string, Set<AssetField>>();
          data.assets.forEach((a: AssetRecalcDetail) => {
            const set = new Set<AssetField>();
            (['gla', 'annual_rent', 'walt'] as AssetField[]).forEach(f => {
              if (assetFieldChanged(a, f)) set.add(f);
            });
            initial.set(a.id, set);
          });
          setAssetSelections(initial);

          // Auto-select first asset with changes
          const firstWithChanges = data.assets.find((a: AssetRecalcDetail) =>
            (['gla', 'annual_rent', 'walt'] as AssetField[]).some(f => assetFieldChanged(a, f))
          );
          setSelectedAssetId((firstWithChanges || data.assets[0])?.id || null);
        } else {
          setPortfolioPreview(data);
          const initial = new Set<string>();
          data.diff.forEach((d: PortfolioDiff) => {
            if (d.changed) initial.add(d.field);
          });
          setPortfolioSelections(initial);
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      if (s === 'assets') setLoadingAssets(false);
      else setLoadingPortfolio(false);
    }
  }, [portfolioId]);

  useEffect(() => { loadPreview('assets'); loadPreview('portfolio'); }, [loadPreview]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !committingScope) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [committingScope, onClose]);

  // ─── Toggle helpers ────────────────────────────────────────────────────────
  const toggleAssetField = (assetId: string, field: AssetField) => {
    setAssetSelections(prev => {
      const next = new Map(prev);
      const set = new Set(next.get(assetId) || []);
      if (set.has(field)) set.delete(field);
      else set.add(field);
      next.set(assetId, set);
      return next;
    });
  };

  const togglePortfolioField = (field: string) => {
    setPortfolioSelections(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  // ─── Counts ────────────────────────────────────────────────────────────────
  const totalAssetSelections = useMemo(() => {
    let count = 0;
    assetSelections.forEach(set => { count += set.size; });
    return count;
  }, [assetSelections]);

  const totalAssetsWithSelections = useMemo(() => {
    let count = 0;
    assetSelections.forEach(set => { if (set.size > 0) count++; });
    return count;
  }, [assetSelections]);

  // ─── Commit ────────────────────────────────────────────────────────────────
  const handleCommit = async (s: Scope) => {
    setCommittingScope(s);
    setError(null);
    setSuccessMsg(null);
    try {
      let body: any;
      if (s === 'assets') {
        const selections: Array<{ assetId: string; fields: AssetField[] }> = [];
        assetSelections.forEach((set, assetId) => {
          if (set.size > 0) selections.push({ assetId, fields: Array.from(set) });
        });
        body = { selections };
      } else {
        body = { fields: Array.from(portfolioSelections) };
      }

      const res = await fetch(`/api/portfolios/${portfolioId}/recalc-from-children?scope=${s}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Recalc ${s} failed`);

      setSuccessMsg(s === 'assets'
        ? `✓ ${data.writtenCount || 0} asset${data.writtenCount === 1 ? '' : 's'} updated. Portfolio preview refreshed.`
        : '✓ Portfolio updated.');

      // Refresh
      if (s === 'assets') {
        await loadPreview('assets');
        await loadPreview('portfolio');
      } else {
        await loadPreview('portfolio');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setCommittingScope(null);
    }
  };

  // ─── Rendering ─────────────────────────────────────────────────────────────
  const isCommitting = committingScope !== null;
  const selectedAsset = useMemo(() =>
    assetsPreview?.assets.find(a => a.id === selectedAssetId) || null
  , [assetsPreview, selectedAssetId]);

  const portfolioChangedFields = portfolioPreview?.diff.filter(d => d.changed) || [];

  // Triggered by the "Recalc remaining" button inside an asset's WALT card.
  // Refreshes the assets preview so the user sees the new values immediately.
  const handleRecalcRemainingDone = useCallback(async (msg: string) => {
    setSuccessMsg(msg);
    await loadPreview('assets');
  }, [loadPreview]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4"
         onClick={() => !isCommitting && onClose()}
         style={{ fontFeatureSettings: "'cv11','ss01'" }}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden"
      >

        {/* HEADER */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight text-zinc-900">Recalculate from children</h2>
            <p className="text-[12px] text-zinc-500 mt-0.5">
              Pick what to update — nothing is written until you click Apply.
            </p>
          </div>
          <button onClick={() => !isCommitting && onClose()}
                  className="w-7 h-7 grid place-items-center rounded-md hover:bg-zinc-100 text-zinc-500"
                  disabled={isCommitting}>
            ✕
          </button>
        </div>

        {/* TABS */}
        <div className="flex border-b border-zinc-200 px-6 pt-3 flex-shrink-0 bg-zinc-50/40">
          <TabButton
            active={scope === 'assets'}
            onClick={() => setScope('assets')}
            label="Assets"
            sub="from tenants"
            badge={totalAssetSelections}
          />
          <TabButton
            active={scope === 'portfolio'}
            onClick={() => setScope('portfolio')}
            label="Portfolio"
            sub="from assets & tenants"
            badge={portfolioSelections.size}
          />
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-hidden flex">

          {scope === 'assets' && (
            loadingAssets ? <LoadingBox label="Scanning tenants per asset…" /> :
            !assetsPreview ? <div className="p-6 text-zinc-500">No data.</div> :
            <AssetsMasterDetail
              portfolioId={portfolioId}
              preview={assetsPreview}
              selectedAssetId={selectedAssetId}
              setSelectedAssetId={setSelectedAssetId}
              selectedAsset={selectedAsset}
              assetSelections={assetSelections}
              toggleAssetField={toggleAssetField}
              onRecalcRemainingDone={handleRecalcRemainingDone}
            />
          )}

          {scope === 'portfolio' && (
            loadingPortfolio ? <LoadingBox label="Scanning assets and tenants…" /> :
            !portfolioPreview ? <div className="p-6 text-zinc-500">No data.</div> :
            <PortfolioTabBody
              preview={portfolioPreview}
              selections={portfolioSelections}
              toggle={togglePortfolioField}
            />
          )}
        </div>

        {/* FOOTER */}
        <div className="px-6 py-3 border-t border-zinc-200 flex items-center justify-between bg-zinc-50/60 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {error && (
              <p className="text-[11px] text-red-700 truncate"><strong>Error:</strong> {error}</p>
            )}
            {successMsg && !error && (
              <p className="text-[11px] text-emerald-700">{successMsg}</p>
            )}
            {!error && !successMsg && (
              <p className="text-[11px] text-zinc-500">
                {scope === 'assets' ? (
                  <><strong className="tabular-nums text-zinc-700">{totalAssetSelections}</strong> field
                  {totalAssetSelections === 1 ? '' : 's'} selected
                  {totalAssetsWithSelections > 0 && <> across <strong className="tabular-nums text-zinc-700">{totalAssetsWithSelections}</strong> asset{totalAssetsWithSelections === 1 ? '' : 's'}</>}</>
                ) : (
                  <><strong className="tabular-nums text-zinc-700">{portfolioSelections.size}</strong> field{portfolioSelections.size === 1 ? '' : 's'} selected</>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => !isCommitting && onClose()}
                    disabled={isCommitting}
                    className="px-4 py-2 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-100 rounded-md disabled:opacity-50">
              Close
            </button>
            <button
              onClick={() => handleCommit(scope)}
              disabled={
                isCommitting ||
                (scope === 'assets' && totalAssetSelections === 0) ||
                (scope === 'portfolio' && portfolioSelections.size === 0)
              }
              className="px-4 py-2 text-[12px] font-semibold bg-[#6D7C60] hover:bg-[#5d6c50] text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              {committingScope === scope && (
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {committingScope === scope ? 'Writing…' :
               scope === 'assets' ? `Apply selected (${totalAssetSelections})` : `Apply selected (${portfolioSelections.size})`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

// =============================================================================
// SHARED — Tab button, loading state
// =============================================================================
function TabButton({ active, onClick, label, sub, badge }: {
  active: boolean; onClick: () => void; label: string; sub: string; badge: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-[12.5px] font-semibold border-b-2 -mb-px flex items-center gap-2 transition-colors ${
        active ? 'border-[#6D7C60] text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700'
      }`}
    >
      <span>
        {label}
        <span className="ml-1.5 text-[10.5px] font-medium text-zinc-400">{sub}</span>
      </span>
      {badge > 0 && (
        <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-full font-bold ${
          active ? 'bg-[#6D7C60] text-white' : 'bg-zinc-200 text-zinc-600'
        }`}>{badge}</span>
      )}
    </button>
  );
}

function LoadingBox({ label }: { label: string }) {
  return (
    <div className="flex-1 grid place-items-center">
      <div className="text-center">
        <div className="w-6 h-6 border-2 border-[#6D7C60] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-[11px] text-zinc-500 mt-3">{label}</p>
      </div>
    </div>
  );
}

// =============================================================================
// ASSETS — Master/Detail
// =============================================================================
function AssetsMasterDetail({
  portfolioId, preview, selectedAssetId, setSelectedAssetId, selectedAsset,
  assetSelections, toggleAssetField, onRecalcRemainingDone,
}: {
  portfolioId: string;
  preview: AssetsPreview;
  selectedAssetId: string | null;
  setSelectedAssetId: (id: string | null) => void;
  selectedAsset: AssetRecalcDetail | null;
  assetSelections: Map<string, Set<AssetField>>;
  toggleAssetField: (assetId: string, field: AssetField) => void;
  onRecalcRemainingDone: (msg: string) => void;
}) {
  return (
    <>
      {/* MASTER: asset list */}
      <div className="w-[280px] border-r border-zinc-200 overflow-y-auto flex-shrink-0 bg-zinc-50/40">
        <div className="px-4 py-2.5 border-b border-zinc-200 bg-white sticky top-0 z-10">
          <div className="text-[10.5px] font-bold text-zinc-500 uppercase tracking-wider">
            Assets ({preview.assets.length})
          </div>
          <div className="text-[10.5px] text-zinc-400 mt-0.5">
            {preview.coverage.assetsWithChanges} with proposed changes
          </div>
        </div>
        {preview.assets.map(a => {
          const sel = assetSelections.get(a.id) || new Set();
          const totalChangeable = (['gla', 'annual_rent', 'walt'] as AssetField[])
            .filter(f => assetFieldChanged(a, f)).length;
          const isSelected = selectedAssetId === a.id;
          return (
            <button
              key={a.id}
              onClick={() => setSelectedAssetId(a.id)}
              className={`w-full text-left px-4 py-2.5 border-b border-zinc-100 hover:bg-white transition-colors ${
                isSelected ? 'bg-white border-l-2 border-l-[#6D7C60]' : ''
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <span className={`text-[12.5px] truncate ${isSelected ? 'font-semibold text-zinc-900' : 'font-medium text-zinc-700'}`}>
                  {a.name}
                </span>
                {sel.size > 0 && (
                  <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full bg-[#6D7C60] text-white tabular-nums">
                    {sel.size}
                  </span>
                )}
              </div>
              <div className="text-[10.5px] text-zinc-500 flex items-center gap-2">
                <span>{a.tenantCount} tenant{a.tenantCount === 1 ? '' : 's'}</span>
                {totalChangeable > 0 && (
                  <>
                    <span className="text-zinc-300">·</span>
                    <span className="text-amber-700">{totalChangeable} change{totalChangeable === 1 ? '' : 's'}</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* DETAIL: selected asset */}
      <div className="flex-1 overflow-y-auto">
        {!selectedAsset ? (
          <div className="grid place-items-center h-full text-zinc-400 text-[12px]">
            Select an asset on the left
          </div>
        ) : (
          <AssetDetailPanel
            portfolioId={portfolioId}
            asset={selectedAsset}
            selections={assetSelections.get(selectedAsset.id) || new Set()}
            onToggle={(field) => toggleAssetField(selectedAsset.id, field)}
            onRecalcRemainingDone={onRecalcRemainingDone}
          />
        )}
      </div>
    </>
  );
}

function AssetDetailPanel({
  portfolioId, asset, selections, onToggle, onRecalcRemainingDone,
}: {
  portfolioId: string;
  asset: AssetRecalcDetail;
  selections: Set<AssetField>;
  onToggle: (field: AssetField) => void;
  onRecalcRemainingDone: (msg: string) => void;
}) {
  return (
    <div className="px-6 py-5">
      <div className="mb-4">
        <h3 className="text-[15px] font-bold text-zinc-900 tracking-tight">{asset.name}</h3>
        <p className="text-[11.5px] text-zinc-500 mt-0.5">
          {asset.tenantCount} tenant{asset.tenantCount === 1 ? '' : 's'} linked to this asset
        </p>
      </div>

      {/* Per-field cards */}
      <div className="space-y-3">
        <FieldCard
          field="gla"
          label="GLA"
          asset={asset}
          checked={selections.has('gla')}
          onToggle={() => onToggle('gla')}
        />
        <FieldCard
          field="annual_rent"
          label="Annual rent"
          asset={asset}
          checked={selections.has('annual_rent')}
          onToggle={() => onToggle('annual_rent')}
        />
        <FieldCard
          field="walt"
          label="WALT"
          asset={asset}
          checked={selections.has('walt')}
          onToggle={() => onToggle('walt')}
          portfolioId={portfolioId}
          onRecalcRemainingDone={onRecalcRemainingDone}
        />
      </div>

      {/* All tenants context */}
      <div className="mt-6">
        <div className="text-[10.5px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
          All tenants ({asset.tenantCount})
        </div>
        {asset.tenantCount === 0 ? (
          <div className="px-3 py-3 bg-zinc-50 border border-zinc-200 rounded-lg text-[11.5px] text-zinc-500 text-center">
            No tenants linked to this asset.
          </div>
        ) : (
          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-zinc-50">
                <tr className="border-b border-zinc-200">
                  <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Tenant</th>
                  <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">GLA</th>
                  <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Rent</th>
                  <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Remaining</th>
                  <th className="px-3 py-1.5 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Lease end</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {asset.allTenants.map(t => (
                  <tr key={t.id} className={t.is_vacant ? 'bg-amber-50/40' : ''}>
                    <td className="px-3 py-1.5 truncate max-w-[180px]">
                      {t.is_vacant && <span className="text-[9px] font-bold text-amber-700 mr-1.5">VACANT</span>}
                      <span className={t.is_vacant ? 'text-zinc-500' : 'text-zinc-800'}>{t.name}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{t.gla ? fmtVal('gla', t.gla) : <span className="text-zinc-300">—</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{t.annual_rent ? fmtVal('annual_rent', t.annual_rent) : <span className="text-zinc-300">—</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {t.remaining_lease_years !== null ? (
                        <span className="text-zinc-700">{t.remaining_lease_years.toFixed(1)} y</span>
                      ) : t.has_computed_remaining ? (
                        <span className="text-blue-700" title="Computed from lease_end">
                          {((new Date(t.lease_end!).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1)} y*
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-zinc-500">{fmtDate(t.lease_end)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {asset.allTenants.some(t => t.has_computed_remaining) && (
          <p className="text-[10px] text-blue-700 mt-1.5">
            * Remaining derived from lease end date (no stored remaining_lease_years).
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Per-field card with checkbox + breakdown ────────────────────────────────
function FieldCard({
  field, label, asset, checked, onToggle, portfolioId, onRecalcRemainingDone,
}: {
  field: AssetField;
  label: string;
  asset: AssetRecalcDetail;
  checked: boolean;
  onToggle: () => void;
  // Only used by the WALT card — lets the user trigger a tenant remaining recalc
  portfolioId?: string;
  onRecalcRemainingDone?: (msg: string) => void;
}) {
  const current = asset.current[field];
  const proposed = asset.proposed[field];
  const contribs = asset.contributions[field];
  const hasProposed = proposed !== undefined;
  const changed = assetFieldChanged(asset, field);
  const isNew = current === null && hasProposed;

  const [showBreakdown, setShowBreakdown] = useState(false);
  const [recalcingRemaining, setRecalcingRemaining] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);

  // How many tenants on this asset could benefit from a remaining recalc?
  // Anyone with a lease_end — even if remaining_lease_years already exists
  // (we want to refresh it to "today").
  const tenantsWithLeaseEnd = asset.allTenants.filter(t => t.lease_end).length;

  const handleRecalcRemaining = async () => {
    if (!portfolioId || !onRecalcRemainingDone) return;
    setRecalcingRemaining(true);
    setRecalcError(null);
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/recalc-tenant-remaining`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Recalc failed');

      onRecalcRemainingDone(
        `✓ Updated ${data.updatedCount} tenant${data.updatedCount === 1 ? '' : 's'} on ${asset.name}` +
        (data.skippedCount > 0 ? ` (${data.skippedCount} skipped — no lease end date)` : '')
      );
    } catch (err) {
      setRecalcError(String(err));
    } finally {
      setRecalcingRemaining(false);
    }
  };

  return (
    <div className={`border rounded-lg ${changed ? 'border-zinc-200 bg-white' : 'border-zinc-200 bg-zinc-50/60'}`}>
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Checkbox */}
        <label className="flex items-center cursor-pointer flex-shrink-0" title={hasProposed ? 'Toggle to apply this field' : 'No proposed value'}>
          <input
            type="checkbox"
            checked={checked}
            disabled={!changed}
            onChange={onToggle}
            className="peer absolute opacity-0 w-4 h-4 cursor-pointer"
          />
          <span className={`w-4 h-4 border-[1.5px] rounded transition-all flex items-center justify-center ${
            !changed
              ? 'bg-zinc-100 border-zinc-200'
              : checked
                ? 'bg-[#6D7C60] border-[#6D7C60]'
                : 'bg-white border-zinc-300 peer-hover:border-zinc-500'
          }`}>
            {checked && (
              <svg viewBox="0 0 14 14" className="w-3 h-3 text-white">
                <path d="M3 7l3 3 5-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </label>

        {/* Label + values */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between mb-0.5">
            <span className="text-[12px] font-semibold text-zinc-800">{label}</span>
            {!hasProposed && <span className="text-[10px] text-zinc-400 italic">No data to compute</span>}
            {hasProposed && !changed && <span className="text-[10px] text-emerald-600">Already matches</span>}
            {isNew && <span className="text-[10px] text-blue-600 font-medium">New value</span>}
          </div>
          {hasProposed && (
            <div className="flex items-center gap-2 text-[12px] tabular-nums">
              <span className={isNew ? 'text-zinc-300 italic' : 'text-zinc-500 line-through decoration-zinc-300'}>
                {isNew ? 'not set' : fmtVal(field, current)}
              </span>
              <span className="text-zinc-300 text-xs">→</span>
              <span className={`font-semibold ${changed ? 'text-[#6D7C60]' : 'text-zinc-500'}`}>
                {fmtVal(field, proposed)}
              </span>
            </div>
          )}
        </div>

        {/* Breakdown toggle */}
        {hasProposed && contribs.length > 0 && (
          <button
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="text-[10.5px] text-zinc-500 hover:text-zinc-900 flex-shrink-0 px-2 py-1 rounded hover:bg-zinc-100"
          >
            {showBreakdown ? 'Hide' : 'Show'} {contribs.length} tenant{contribs.length === 1 ? '' : 's'} ▾
          </button>
        )}

        {/* Recalc remaining button — WALT card only */}
        {field === 'walt' && portfolioId && onRecalcRemainingDone && (
          <button
            onClick={handleRecalcRemaining}
            disabled={recalcingRemaining || tenantsWithLeaseEnd === 0}
            className={`text-[10.5px] font-semibold flex-shrink-0 px-2 py-1 rounded border inline-flex items-center gap-1 transition-colors ${
              tenantsWithLeaseEnd === 0
                ? 'text-zinc-400 border-zinc-200 cursor-not-allowed'
                : 'text-[#6D7C60] hover:text-[#5d6c50] border-[#6D7C60]/30 hover:bg-[#6D7C60]/5'
            } disabled:opacity-50`}
            title={
              tenantsWithLeaseEnd === 0
                ? `None of the ${asset.tenantCount} tenant${asset.tenantCount === 1 ? '' : 's'} has a lease_end — cannot compute remaining.`
                : `Recompute remaining_lease_years for ${tenantsWithLeaseEnd} tenant${tenantsWithLeaseEnd === 1 ? '' : 's'} based on today's date and their lease_end. Writes to the database.`
            }
          >
            {recalcingRemaining ? (
              <>
                <span className="w-2.5 h-2.5 border-2 border-[#6D7C60] border-t-transparent rounded-full animate-spin" />
                Computing…
              </>
            ) : (
              <>⚡ Recalc remaining ({tenantsWithLeaseEnd})</>
            )}
          </button>
        )}
      </div>

      {/* Diagnostic line — WALT card only */}
      {field === 'walt' && portfolioId && (
        <div className="px-4 pb-2 -mt-1">
          <p className="text-[10px] text-zinc-400">
            {asset.tenantCount} tenant{asset.tenantCount === 1 ? '' : 's'} on this asset ·{' '}
            {tenantsWithLeaseEnd} with lease_end ·{' '}
            {asset.allTenants.filter(t => t.remaining_lease_years !== null).length} with stored remaining
          </p>
        </div>
      )}

      {/* Recalc error toast (inline) */}
      {recalcError && (
        <div className="px-4 py-2 border-t border-red-200 bg-red-50">
          <p className="text-[11px] text-red-700"><strong>Error:</strong> {recalcError}</p>
        </div>
      )}

      {/* Breakdown */}
      {showBreakdown && hasProposed && (
        <div className="border-t border-zinc-100 px-4 py-2 bg-zinc-50/60">
          <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
            Contributing tenants
            {field === 'walt' && contribs.some(c => c.source === 'computed') && (
              <span className="ml-2 text-blue-600 normal-case font-medium">
                · {contribs.filter(c => c.source === 'computed').length} computed from lease_end
              </span>
            )}
          </div>
          <table className="w-full text-[11px]">
            <tbody>
              {contribs.map(c => (
                <tr key={c.id} className="border-b border-zinc-100 last:border-b-0">
                  <td className="py-1 pr-3 truncate max-w-[280px] text-zinc-700">
                    {c.name}
                    {c.source === 'computed' && (
                      <span className="ml-1.5 text-[9px] text-blue-600 font-semibold" title={`Lease end: ${fmtDate(c.lease_end)}`}>
                        *computed
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right tabular-nums text-zinc-700">
                    {field === 'gla' && fmtVal('gla', c.value)}
                    {field === 'annual_rent' && fmtVal('annual_rent', c.value)}
                    {field === 'walt' && `${c.value.toFixed(1)} y`}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold bg-white">
                <td className="py-1 pr-3 text-zinc-900">
                  {field === 'walt' ? 'Weighted average' : `Sum (${contribs.length})`}
                </td>
                <td className="py-1 text-right tabular-nums text-[#6D7C60]">
                  {fmtVal(field, proposed)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PORTFOLIO TAB BODY — list of fields with checkboxes
// =============================================================================
function PortfolioTabBody({
  preview, selections, toggle,
}: {
  preview: PortfolioPreview;
  selections: Set<string>;
  toggle: (field: string) => void;
}) {
  const changedFields = preview.diff.filter(d => d.changed);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      {/* Coverage */}
      <div className="mb-5">
        <div className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-[0.7px] mb-2">
          Coverage
        </div>
        <div className="grid grid-cols-3 gap-2">
          <CoverageCard label="Asset GLA"
            detail={`${preview.coverage.assetsWithGla} of ${preview.coverage.totalAssets} assets`}
            pct={preview.coverage.glaCoveragePct} />
          <CoverageCard label="Asset rents"
            detail={`${preview.coverage.assetsWithRent} of ${preview.coverage.totalAssets} assets`}
            pct={preview.coverage.rentCoveragePct} />
          <CoverageCard
            label={preview.coverage.leaseCoverageSource === 'assets' ? 'Asset WALTs' : 'Tenant leases'}
            detail={
              preview.coverage.leaseCoverageSource === 'assets'
                ? `${preview.coverage.assetsWithWalt} of ${preview.coverage.totalAssets} assets`
                : `${preview.coverage.tenantsWithLease} of ${preview.coverage.nonVacantTenants}`
            }
            pct={preview.coverage.leaseCoveragePct} />
        </div>

        {(preview.coverage.glaCoveragePct < 95 || preview.coverage.rentCoveragePct < 95 || preview.coverage.leaseCoveragePct < 95) && (
          <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <span className="text-amber-600 text-sm leading-none mt-0.5">⚠️</span>
            <p className="text-[11.5px] text-amber-900 leading-relaxed">
              <strong className="font-semibold">Partial data.</strong>{' '}
              Consider running the Assets tab first to fill missing asset values before recalculating the portfolio.
            </p>
          </div>
        )}
      </div>

      {/* Diff */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-[0.7px]">
            Portfolio fields ({changedFields.length} proposed changes)
          </div>
        </div>

        {changedFields.length === 0 ? (
          <div className="px-3 py-4 bg-zinc-50 border border-zinc-200 rounded-lg text-center">
            <p className="text-[12px] text-zinc-500">Nothing to update — portfolio already matches sums.</p>
          </div>
        ) : (
          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            {changedFields.map((d, i) => {
              const checked = selections.has(d.field);
              const isNew = d.before === null || d.before === undefined || d.before === '';
              return (
                <div key={d.field}
                     className={`px-4 py-2.5 flex items-center gap-3 bg-white ${i === changedFields.length - 1 ? '' : 'border-b border-zinc-100'}`}>
                  <label className="flex items-center cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(d.field)}
                      className="peer absolute opacity-0 w-4 h-4 cursor-pointer"
                    />
                    <span className={`w-4 h-4 border-[1.5px] rounded transition-all flex items-center justify-center ${
                      checked ? 'bg-[#6D7C60] border-[#6D7C60]' : 'bg-white border-zinc-300 peer-hover:border-zinc-500'
                    }`}>
                      {checked && (
                        <svg viewBox="0 0 14 14" className="w-3 h-3 text-white">
                          <path d="M3 7l3 3 5-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                  </label>
                  <div className="w-[180px] text-[12px] font-medium text-zinc-700 flex-shrink-0">
                    {d.label}
                  </div>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className={`text-[12px] tabular-nums ${isNew ? 'text-zinc-300 italic' : 'text-zinc-500 line-through decoration-zinc-300'}`}>
                      {isNew ? 'not set' : fmtVal(d.field, d.before)}
                    </div>
                    <span className="text-zinc-300 text-xs">→</span>
                    <div className="text-[12px] font-semibold tabular-nums text-[#6D7C60]">
                      {fmtVal(d.field, d.after)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Coverage card (shared) ──────────────────────────────────────────────────
function CoverageCard({ label, detail, pct }: { label: string; detail: string; pct: number }) {
  const level = pct >= 95 ? 'good' : pct >= 70 ? 'partial' : 'low';
  const STYLES = {
    good:    { bg: 'bg-emerald-50', text: 'text-emerald-700' },
    partial: { bg: 'bg-amber-50',   text: 'text-amber-700' },
    low:     { bg: 'bg-red-50',     text: 'text-red-700' },
  };
  const s = STYLES[level];
  return (
    <div className={`px-3 py-2 rounded-lg ${s.bg}`}>
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-[10.5px] font-semibold text-zinc-700">{label}</span>
        <span className={`text-[10px] font-semibold tabular-nums ${s.text}`}>{Math.round(pct)}%</span>
      </div>
      <div className="text-[10.5px] text-zinc-500">{detail}</div>
    </div>
  );
}