'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

interface Portfolio {
  id: string;
  name: string;
  number_of_assets: number;
  total_gla: number;
  purchase_price: number;
  spot: number;
  annual_rent_income: number;
  noi: number;
  noi_margin: number;
  walt: number;
  multiplier: number;
  cap_rate: number;
  ltv: number;
  equity_on_spot: number;
  occupancy_rate: number;
  deal_status: string;
  investment_type: string;
  top_tenant: string;
  top_tenant_share: number;
  leh_percentage: number;
  price_per_sqm: number;
}

// ============================================================================
// FORMATTERS
// ============================================================================
const fmt = (val: unknown) => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : (val as number);
  return isNaN(num) ? '—' : num.toLocaleString('de-DE', { maximumFractionDigits: 0 });
};
const fmtDec = (val: unknown, decimals = 2) => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : (val as number);
  return isNaN(num) ? '—' : num.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};
const fmtM = (val: unknown) => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : (val as number);
  if (isNaN(num) || num === 0) return '—';
  if (Math.abs(num) >= 1_000_000) return '€' + (num / 1_000_000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M';
  if (Math.abs(num) >= 1_000) return '€' + (num / 1_000).toFixed(0) + 'k';
  return '€' + num.toFixed(0);
};
const fmtPct = (val: unknown) => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : (val as number);
  return isNaN(num) ? '—' : num.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
};

const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-50 text-blue-600 border border-blue-200',
  reviewing: 'bg-amber-50 text-amber-600 border border-amber-200',
  passed: 'bg-zinc-50 text-zinc-500 border border-zinc-200',
  won: 'bg-emerald-50 text-emerald-600 border border-emerald-200',
  lost: 'bg-red-50 text-red-500 border border-red-200',
};

// ============================================================================
// INVESTMENT TYPE CONFIG
// ============================================================================
const INVESTMENT_TYPES = [
  { key: 'core',          label: 'Core',          bgClass: 'bg-teal-500',   bgSoft: 'bg-teal-50',   text: 'text-teal-700',   border: 'border-teal-200' },
  { key: 'core+',         label: 'Core+',         bgClass: 'bg-cyan-500',   bgSoft: 'bg-cyan-50',   text: 'text-cyan-700',   border: 'border-cyan-200' },
  { key: 'value-add',     label: 'Value-add',     bgClass: 'bg-purple-500', bgSoft: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  { key: 'opportunistic', label: 'Opportunistic', bgClass: 'bg-orange-500', bgSoft: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
];

// ============================================================================
// PORTFOLIO COLOR PALETTE (12 distinct colors, cycles after 12)
// ============================================================================
const PORTFOLIO_PALETTE = [
  '#6D7C60', // brand green
  '#2563eb', // blue
  '#dc2626', // red
  '#ea580c', // orange
  '#7c3aed', // purple
  '#0891b2', // cyan
  '#db2777', // pink
  '#65a30d', // lime
  '#ca8a04', // yellow
  '#0d9488', // teal
  '#9333ea', // violet
  '#475569', // slate
];

// Assigns a stable color from the palette based on ORDER of selected portfolios.
// We don't hash the id — we want the *first* selected to get the brand green,
// the second the blue, etc., so the visual stays consistent during a session.
function buildColorMap(portfolios: Portfolio[]): Record<string, string> {
  const map: Record<string, string> = {};
  portfolios.forEach((p, i) => {
    map[p.id] = PORTFOLIO_PALETTE[i % PORTFOLIO_PALETTE.length];
  });
  return map;
}

// ============================================================================
// METRIC DEFINITIONS — all normalized so portfolios of any size are comparable
// ============================================================================
type MetricKey =
  | 'price_per_sqm_calc' | 'spot_per_sqm' | 'noi_per_sqm'
  | 'multiplier' | 'cap_rate'
  | 'noi_margin' | 'walt' | 'occupancy_rate'
  | 'ltv' | 'leh_percentage';

const METRICS: Array<{
  key: MetricKey;
  label: string;
  category: 'pricing' | 'income' | 'risk';
  /** how to compute the value from a portfolio (handles derived fields) */
  compute: (p: Portfolio) => number;
  format: (v: number) => string;
  shortFormat: (v: number) => string;
  /** higher value = better (true) or worse (false) — used for color coding the leader */
  higherIsBetter: boolean;
}> = [
  // ─── Pricing & valuation (€/m²) ────────────────────────────────────────
  {
    key: 'price_per_sqm_calc', label: 'Asking Price / m²', category: 'pricing',
    compute: p => p.total_gla > 0 ? p.purchase_price / p.total_gla : 0,
    format: v => `€${v.toLocaleString('de-DE', {maximumFractionDigits:0})} /m²`,
    shortFormat: v => `€${v.toFixed(0)}`,
    higherIsBetter: false,
  },
  {
    key: 'spot_per_sqm', label: 'Spot Value / m²', category: 'pricing',
    compute: p => p.total_gla > 0 ? p.spot / p.total_gla : 0,
    format: v => `€${v.toLocaleString('de-DE', {maximumFractionDigits:0})} /m²`,
    shortFormat: v => `€${v.toFixed(0)}`,
    higherIsBetter: false,
  },
  {
    key: 'noi_per_sqm', label: 'NOI / m²', category: 'pricing',
    compute: p => p.total_gla > 0 ? p.noi / p.total_gla : 0,
    format: v => `€${v.toFixed(0)} /m²/yr`,
    shortFormat: v => `€${v.toFixed(0)}`,
    higherIsBetter: true,
  },
  // ─── Pricing ratios ─────────────────────────────────────────────────────
  {
    key: 'multiplier', label: 'Multiplier', category: 'pricing',
    compute: p => p.multiplier || 0,
    format: v => `${v.toFixed(2)}×`,
    shortFormat: v => `${v.toFixed(1)}×`,
    higherIsBetter: false,
  },
  {
    key: 'cap_rate', label: 'Cap Rate', category: 'pricing',
    compute: p => p.cap_rate || 0,
    format: v => `${v.toFixed(2)}%`,
    shortFormat: v => `${v.toFixed(2)}%`,
    higherIsBetter: true,
  },
  // ─── Income quality ─────────────────────────────────────────────────────
  {
    key: 'noi_margin', label: 'NOI Margin', category: 'income',
    compute: p => p.noi_margin || 0,
    format: v => `${v.toFixed(1)}%`,
    shortFormat: v => `${v.toFixed(1)}%`,
    higherIsBetter: true,
  },
  {
    key: 'walt', label: 'WALT', category: 'income',
    compute: p => p.walt || 0,
    format: v => `${v.toFixed(1)} years`,
    shortFormat: v => `${v.toFixed(1)} y`,
    higherIsBetter: true,
  },
  {
    key: 'occupancy_rate', label: 'Occupancy', category: 'income',
    compute: p => p.occupancy_rate || 0,
    format: v => `${v.toFixed(1)}%`,
    shortFormat: v => `${v.toFixed(1)}%`,
    higherIsBetter: true,
  },
  // ─── Risk profile ───────────────────────────────────────────────────────
  {
    key: 'ltv', label: 'LTV', category: 'risk',
    compute: p => p.ltv || 0,
    format: v => `${v.toFixed(1)}%`,
    shortFormat: v => `${v.toFixed(0)}%`,
    higherIsBetter: false,
  },
  {
    key: 'leh_percentage', label: 'LEH Share', category: 'risk',
    compute: p => p.leh_percentage || 0,
    format: v => `${v.toFixed(1)}%`,
    shortFormat: v => `${v.toFixed(0)}%`,
    higherIsBetter: true,
  },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function ComparePage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set(INVESTMENT_TYPES.map(t => t.key)));
  const [loading, setLoading] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const [openTypeMenu, setOpenTypeMenu] = useState<string | null>(null);

  // Load portfolios
  useEffect(() => {
    fetch('/api/data?view=portfolios')
      .then(res => res.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data.data || []);
        setPortfolios(list);

        const urlParams = new URLSearchParams(window.location.search);
        const idsParam = urlParams.get('ids');
        if (idsParam) {
          const wanted = new Set(idsParam.split(',').filter(Boolean));
          setSelectedIds(new Set(list.filter((p: Portfolio) => wanted.has(p.id)).map((p: Portfolio) => p.id as string)));
        } else {
          setSelectedIds(new Set(list.map((p: Portfolio) => p.id)));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Close popovers on outside click
  useEffect(() => {
    if (!openTypeMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-type-menu]')) setOpenTypeMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openTypeMenu]);

  // ─── Derived data ────────────────────────────────────────────────────────
  const portfoliosByType = useMemo(() => {
    const map: Record<string, Portfolio[]> = {};
    INVESTMENT_TYPES.forEach(t => { map[t.key] = []; });
    map['_none'] = [];
    portfolios.forEach(p => {
      const t = p.investment_type;
      if (t && map[t]) map[t].push(p);
      else map['_none'].push(p);
    });
    return map;
  }, [portfolios]);

  const visiblePortfolios = useMemo(() => {
    return portfolios
      .filter(p => {
        if (!selectedIds.has(p.id)) return false;
        if (!p.investment_type) return true;
        return activeTypes.has(p.investment_type);
      })
      .sort((a, b) => (b.purchase_price || 0) - (a.purchase_price || 0));
  }, [portfolios, selectedIds, activeTypes]);

  const colorMap = useMemo(() => buildColorMap(visiblePortfolios), [visiblePortfolios]);

  // ─── Toggle handlers ────────────────────────────────────────────────────
  const toggleType = (typeKey: string) => {
    const next = new Set(activeTypes);
    const typesPortfolios = portfoliosByType[typeKey] || [];
    if (next.has(typeKey)) {
      next.delete(typeKey);
      setSelectedIds(prev => {
        const ns = new Set(prev);
        typesPortfolios.forEach(p => ns.delete(p.id));
        return ns;
      });
    } else {
      next.add(typeKey);
      setSelectedIds(prev => {
        const ns = new Set(prev);
        typesPortfolios.forEach(p => ns.add(p.id));
        return ns;
      });
    }
    setActiveTypes(next);
  };

  const togglePortfolio = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ─── Aggregates ─────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const count = visiblePortfolios.length;
    const assets = visiblePortfolios.reduce((s, p) => s + (p.number_of_assets || 0), 0);
    const gla = visiblePortfolios.reduce((s, p) => s + (p.total_gla || 0), 0);
    const askingPrice = visiblePortfolios.reduce((s, p) => s + (p.purchase_price || 0), 0);
    const spot = visiblePortfolios.reduce((s, p) => s + (p.spot || 0), 0);
    const noi = visiblePortfolios.reduce((s, p) => s + (p.noi || 0), 0);
    const rent = visiblePortfolios.reduce((s, p) => s + (p.annual_rent_income || 0), 0);
    const equity = visiblePortfolios.reduce((s, p) => s + (p.equity_on_spot || 0), 0);
    return { count, assets, gla, askingPrice, spot, noi, rent, equity };
  }, [visiblePortfolios]);

  const averages = useMemo(() => {
    const avg = (key: keyof Portfolio) => {
      const valid = visiblePortfolios.filter(p => typeof p[key] === 'number' && (p[key] as number) > 0);
      if (valid.length === 0) return 0;
      return (valid.reduce((s, p) => s + (p[key] as number), 0)) / valid.length;
    };
    return {
      multiplier: avg('multiplier'),
      capRate: avg('cap_rate'),
      noiMargin: avg('noi_margin'),
      walt: avg('walt'),
      ltv: avg('ltv'),
      occupancy: avg('occupancy_rate'),
      leh: avg('leh_percentage'),
    };
  }, [visiblePortfolios]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#6D7C60] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50" style={{ fontFeatureSettings: "'cv11','ss01'" }}>

      {/* ═══════ HEADER ═══════ */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-[1500px] mx-auto px-7 py-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm">
              <Link href="/dashboard" className="flex items-center gap-2.5 hover:opacity-80">
                <div className="w-7 h-7 bg-[#6D7C60] rounded-md grid place-items-center font-bold text-xs">R</div>
                <span className="font-semibold">RE Analyzer</span>
              </Link>
              <span className="text-zinc-500 text-xs ml-1">
                /&nbsp;<Link href="/dashboard" className="hover:text-white">Portfolios</Link>&nbsp;/&nbsp;
                <strong className="text-white font-medium">Compare</strong>
              </span>
            </div>
            <Link href="/dashboard" className="px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded-md font-medium">
              ← Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-7 py-8 pb-20">

        {/* ═══════ HERO + FILTERS ═══════ */}
        <div className="pb-7 mb-8 border-b border-zinc-200">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 leading-none mb-2">Portfolio Comparison</h1>
          <p className="text-sm text-zinc-500">
            <span className="tabular-nums font-medium text-zinc-700">{visiblePortfolios.length}</span> of {portfolios.length} portfolios
            {totals.askingPrice > 0 && (
              <> · <span className="tabular-nums font-medium text-zinc-700">{fmtM(totals.askingPrice)}</span> total asking</>
            )}
          </p>

          {/* Type pills */}
          <div className="flex flex-wrap gap-2 mt-5">
            {INVESTMENT_TYPES.map(t => {
              const typePortfolios = portfoliosByType[t.key] || [];
              const isActive = activeTypes.has(t.key);
              const visibleCount = typePortfolios.filter(p => selectedIds.has(p.id)).length;
              const totalCount = typePortfolios.length;
              const isMenuOpen = openTypeMenu === t.key;

              return (
                <div key={t.key} className="relative" data-type-menu>
                  <button
                    onClick={() => toggleType(t.key)}
                    className={`px-3 py-1.5 text-[12px] font-semibold rounded-lg border transition-all inline-flex items-center gap-2 ${
                      isActive
                        ? `${t.bgClass} text-white border-transparent`
                        : `${t.bgSoft} ${t.text} ${t.border} hover:brightness-95`
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : t.bgClass}`} />
                    {t.label}
                    <span className={`tabular-nums text-[10.5px] font-medium ${isActive ? 'opacity-75' : ''}`}>
                      {visibleCount}/{totalCount}
                    </span>
                    {totalCount > 0 && (
                      <span
                        role="button"
                        onClick={e => { e.stopPropagation(); setOpenTypeMenu(isMenuOpen ? null : t.key); }}
                        className="ml-0.5 text-[10px] opacity-70 hover:opacity-100 cursor-pointer"
                        aria-label="Show portfolios"
                      >
                        ▾
                      </span>
                    )}
                  </button>

                  {isMenuOpen && (
                    <div className="absolute top-full left-0 mt-1.5 bg-white border border-zinc-200 rounded-lg shadow-lg p-1 min-w-[300px] max-h-[400px] overflow-y-auto z-30">
                      <div className="px-3 py-2 border-b border-zinc-100 flex justify-between items-center">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{t.label} · {totalCount} deals</span>
                        <div className="flex gap-1">
                          <button onClick={() => setSelectedIds(prev => { const ns = new Set(prev); typePortfolios.forEach(p => ns.add(p.id)); return ns; })}
                            className="text-[10px] text-zinc-500 hover:text-zinc-900">All</button>
                          <span className="text-[10px] text-zinc-300">|</span>
                          <button onClick={() => setSelectedIds(prev => { const ns = new Set(prev); typePortfolios.forEach(p => ns.delete(p.id)); return ns; })}
                            className="text-[10px] text-zinc-500 hover:text-zinc-900">None</button>
                        </div>
                      </div>
                      {typePortfolios.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-zinc-400 text-center italic">No portfolios of this type</div>
                      ) : (
                        typePortfolios.map(p => (
                          <label key={p.id}
                            className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-zinc-50 rounded">
                            <input type="checkbox" checked={selectedIds.has(p.id)}
                              onChange={() => togglePortfolio(p.id)}
                              className="w-3.5 h-3.5 text-[#6D7C60] border-zinc-300 rounded" />
                            <span className="flex-1 text-[13px] text-zinc-800 truncate">{p.name || 'Unnamed'}</span>
                            <span className="text-[11px] text-zinc-500 tabular-nums">{fmtM(p.purchase_price)}</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {(portfoliosByType['_none']?.length || 0) > 0 && (
              <div className="relative" data-type-menu>
                <button
                  onClick={() => setOpenTypeMenu(openTypeMenu === '_none' ? null : '_none')}
                  className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-dashed border-zinc-300 bg-white text-zinc-500 hover:bg-zinc-50 inline-flex items-center gap-2"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                  No type
                  <span className="tabular-nums text-[10.5px]">
                    {portfoliosByType['_none'].filter(p => selectedIds.has(p.id)).length}/{portfoliosByType['_none'].length}
                  </span>
                  <span className="text-[10px] opacity-70">▾</span>
                </button>
                {openTypeMenu === '_none' && (
                  <div className="absolute top-full left-0 mt-1.5 bg-white border border-zinc-200 rounded-lg shadow-lg p-1 min-w-[300px] max-h-[400px] overflow-y-auto z-30">
                    {portfoliosByType['_none'].map(p => (
                      <label key={p.id} className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-zinc-50 rounded">
                        <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => togglePortfolio(p.id)}
                          className="w-3.5 h-3.5 text-[#6D7C60] border-zinc-300 rounded" />
                        <span className="flex-1 text-[13px] text-zinc-800 truncate">{p.name || 'Unnamed'}</span>
                        <span className="text-[11px] text-zinc-500 tabular-nums">{fmtM(p.purchase_price)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 mt-2">Click pill to toggle entire type · Click ▾ to pick individual deals</p>
        </div>

        {/* ═══════ KPI STRIP ═══════ */}
        {visiblePortfolios.length > 0 && (
          <div className="grid grid-cols-8 bg-white border border-zinc-200 rounded-xl overflow-hidden mb-8">
            <KpiCell label="Deals" value={String(totals.count)} />
            <KpiCell label="Assets" value={fmt(totals.assets)} />
            <KpiCell label="Total GLA" value={`${(totals.gla / 1000).toFixed(1)}k m²`} />
            <KpiCell label="Asking Total" value={fmtM(totals.askingPrice)} />
            <KpiCell label="Spot Total" value={fmtM(totals.spot)} />
            <KpiCell label="NOI Total" value={fmtM(totals.noi)} />
            <KpiCell label="Avg Cap" value={averages.capRate ? `${averages.capRate.toFixed(2)}%` : '—'} highlight />
            <KpiCell label="Avg Multi" value={averages.multiplier ? `${averages.multiplier.toFixed(2)}×` : '—'} highlight isLast />
          </div>
        )}

        {/* ═══════ COLOR LEGEND ═══════ */}
        {visiblePortfolios.length > 0 && (
          <div className="bg-white border border-zinc-200 rounded-xl px-5 py-3 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wider">Portfolios in this view</span>
              <span className="text-[10.5px] text-zinc-400">Each portfolio keeps the same color across all charts</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {visiblePortfolios.map(p => (
                <Link key={p.id} href={`/dashboard/portfolio/${p.id}`}
                  className="inline-flex items-center gap-1.5 text-[12px] text-zinc-700 hover:text-zinc-900 hover:underline">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: colorMap[p.id] }} />
                  <span className="truncate max-w-[180px]">{p.name || 'Unnamed'}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ═══════ CHARTS ═══════ */}
        {visiblePortfolios.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-zinc-300 rounded-xl bg-white">
            <div className="text-4xl mb-3">📊</div>
            <h3 className="text-lg font-bold text-zinc-900 mb-1">No portfolios selected</h3>
            <p className="text-zinc-500 text-sm">Activate some types above or pick individual deals.</p>
          </div>
        ) : (
          <>
            {/* Pricing & Valuation section */}
            <ChartSection title="Pricing & Valuation"
              metrics={METRICS.filter(m => m.category === 'pricing')}
              portfolios={visiblePortfolios} colorMap={colorMap} />
            <ChartSection title="Income Quality"
              metrics={METRICS.filter(m => m.category === 'income')}
              portfolios={visiblePortfolios} colorMap={colorMap} />
            <ChartSection title="Risk Profile"
              metrics={METRICS.filter(m => m.category === 'risk')}
              portfolios={visiblePortfolios} colorMap={colorMap} />
          </>
        )}

        {/* ═══════ DETAILED TABLE TOGGLE ═══════ */}
        <button
          onClick={() => setShowTable(!showTable)}
          className="w-full px-5 py-3 bg-white border border-zinc-200 rounded-xl text-[13px] font-semibold text-zinc-700 hover:bg-zinc-50 transition-colors flex items-center justify-center gap-2 mt-4"
        >
          {showTable ? 'Hide detailed table' : 'View detailed table'}
          <span className={`transition-transform ${showTable ? 'rotate-180' : ''}`}>▾</span>
        </button>

        {showTable && visiblePortfolios.length > 0 && (
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden shadow-sm mt-4">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-600 uppercase tracking-wider sticky left-0 bg-zinc-50 z-10">Portfolio</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-600 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-zinc-600 uppercase tracking-wider">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">Assets</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">Asking</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">Spot</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">Equity</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">LTV</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">Multi</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">Cap</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">Annual Rent</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">NOI Margin</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">GLA</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">WALT</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">Occupancy</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-600 uppercase tracking-wider">LEH</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {visiblePortfolios.map(p => (
                    <tr key={p.id} className="hover:bg-zinc-50 group">
                      <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-zinc-50">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: colorMap[p.id] }} />
                          <Link href={`/dashboard/portfolio/${p.id}`}
                            className="font-medium text-zinc-900 hover:text-[#6D7C60] hover:underline">
                            {p.name || 'Unnamed'}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium inline-block ${STATUS_COLORS[p.deal_status] || STATUS_COLORS.new}`}>
                          {capitalize(p.deal_status || 'new')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.investment_type ? <TypeBadge type={p.investment_type} /> : <span className="text-zinc-400 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{fmt(p.number_of_assets)}</td>
                      <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">{fmtM(p.purchase_price)}</td>
                      <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">{fmtM(p.spot)}</td>
                      <td className="px-4 py-3 text-right text-sm font-medium tabular-nums">{fmtM(p.equity_on_spot)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{fmtPct(p.ltv)}</td>
                      <td className="px-4 py-3 text-right text-sm text-[#6D7C60] font-semibold tabular-nums">{fmtDec(p.multiplier)}×</td>
                      <td className="px-4 py-3 text-right text-sm text-[#6D7C60] font-semibold tabular-nums">{fmtPct(p.cap_rate)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{fmtM(p.annual_rent_income)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{fmtPct(p.noi_margin)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{fmt(p.total_gla)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{fmtDec(p.walt)} y</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{fmtPct(p.occupancy_rate)}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{fmtPct(p.leh_percentage)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-zinc-300 bg-blue-50/60">
                    <td className="px-4 py-3 text-sm font-bold sticky left-0 bg-blue-50/60">TOTAL ({totals.count})</td>
                    <td colSpan={2}></td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{fmt(totals.assets)}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{fmtM(totals.askingPrice)}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{fmtM(totals.spot)}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{fmtM(totals.equity)}</td>
                    <td colSpan={3}></td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{fmtM(totals.rent)}</td>
                    <td></td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{fmt(totals.gla)}</td>
                    <td colSpan={3}></td>
                  </tr>
                  <tr className="bg-emerald-50/60">
                    <td className="px-4 py-3 text-sm font-bold sticky left-0 bg-emerald-50/60">AVERAGE</td>
                    <td colSpan={6}></td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{averages.ltv ? fmtPct(averages.ltv) : '—'}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-[#6D7C60] tabular-nums">{averages.multiplier ? `${averages.multiplier.toFixed(2)}×` : '—'}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-[#6D7C60] tabular-nums">{averages.capRate ? `${averages.capRate.toFixed(2)}%` : '—'}</td>
                    <td></td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{averages.noiMargin ? fmtPct(averages.noiMargin) : '—'}</td>
                    <td></td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{averages.walt ? `${averages.walt.toFixed(1)} y` : '—'}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{averages.occupancy ? fmtPct(averages.occupancy) : '—'}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{averages.leh ? fmtPct(averages.leh) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================
function KpiCell({ label, value, sub, highlight, isLast }: { label: string; value: string; sub?: string; highlight?: boolean; isLast?: boolean }) {
  return (
    <div className={`px-4 py-4 ${isLast ? '' : 'border-r border-zinc-200'} flex flex-col gap-0.5`}>
      <div className="text-[10px] text-zinc-500 font-semibold uppercase tracking-[0.7px]">{label}</div>
      <div className={`text-[18px] font-bold tracking-tight tabular-nums mt-0.5 ${highlight ? 'text-[#6D7C60]' : 'text-zinc-900'}`}>{value}</div>
      {sub ? <div className="text-[10px] text-zinc-500">{sub}</div> : null}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const cfg = INVESTMENT_TYPES.find(t => t.key === type);
  if (!cfg) return <span className="text-zinc-500 text-xs">{type}</span>;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium inline-block ${cfg.bgSoft} ${cfg.text} border ${cfg.border}`}>
      {cfg.label}
    </span>
  );
}

// ─── Chart section (grid of bars under a category header) ──────────────
function ChartSection({ title, metrics, portfolios, colorMap }: {
  title: string;
  metrics: typeof METRICS;
  portfolios: Portfolio[];
  colorMap: Record<string, string>;
}) {
  return (
    <div className="mb-8">
      <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3.5">{title}</div>
      <div className="grid grid-cols-2 gap-4">
        {metrics.map(m => (
          <BarChart key={m.key} metric={m} portfolios={portfolios} colorMap={colorMap} />
        ))}
      </div>
    </div>
  );
}

// ─── Bar chart panel (horizontal, sorted desc, height adapts) ──────────
function BarChart({ metric, portfolios, colorMap }: {
  metric: typeof METRICS[0];
  portfolios: Portfolio[];
  colorMap: Record<string, string>;
}) {
  const rows = portfolios.map(p => ({
    id: p.id,
    name: p.name || 'Unnamed',
    value: metric.compute(p),
    color: colorMap[p.id],
  }));

  const validRows = rows.filter(r => r.value > 0);
  const sorted = [...validRows].sort((a, b) => b.value - a.value);
  const max = sorted.length ? Math.max(...sorted.map(r => r.value)) : 0;
  const mean = sorted.length ? sorted.reduce((s, r) => s + r.value, 0) / sorted.length : 0;
  const meanPct = max > 0 ? (mean / max) * 100 : 0;

  // Adaptive: 32px per bar + ~80px chrome
  const ROW_HEIGHT = 28;
  const ROW_GAP = 6;
  const innerHeight = sorted.length * ROW_HEIGHT + (sorted.length - 1) * ROW_GAP;

  if (sorted.length === 0) {
    return (
      <div className="bg-white border border-zinc-200 rounded-xl p-5 min-h-[200px] flex flex-col">
        <div className="flex justify-between items-baseline mb-3">
          <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-[0.6px]">{metric.label}</span>
        </div>
        <div className="flex-1 grid place-items-center text-center">
          <div>
            <div className="text-2xl text-zinc-300 mb-1">—</div>
            <div className="text-[11px] text-zinc-400">No data for {metric.label.toLowerCase()}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5 flex flex-col">
      <div className="flex justify-between items-baseline mb-3">
        <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-[0.6px]">{metric.label}</span>
        <span className="text-[10.5px] text-zinc-400 tabular-nums">
          mean <strong className="text-zinc-600 font-semibold">{metric.shortFormat(mean)}</strong> · n={sorted.length}
        </span>
      </div>

      {/* Bars container with mean line overlay */}
      <div className="relative flex-1" style={{ height: innerHeight }}>
        {/* Mean line (dashed vertical) — positioned at the start of the bar area (after labels) */}
        <div className="absolute top-0 bottom-0 pointer-events-none"
             style={{
               left: 'calc(100px + 8px + ' + meanPct + '% * (100% - 100px - 8px - 70px - 8px) / 100%)',
               // simpler & robust: use a wrapper later
             }}>
        </div>

        <div className="flex flex-col gap-[6px]">
          {sorted.map(r => {
            const widthPct = (r.value / max) * 100;
            return (
              <Link key={r.id} href={`/dashboard/portfolio/${r.id}`}
                className="group flex items-center gap-2 hover:bg-zinc-50 -mx-2 px-2 rounded transition-colors"
                title={`${r.name} · ${metric.format(r.value)}`}>
                <div className="w-[100px] truncate text-[11px] text-zinc-700 group-hover:text-zinc-900 flex-shrink-0">
                  {r.name}
                </div>
                <div className="flex-1 h-[18px] relative bg-zinc-50 rounded overflow-hidden">
                  <div className="h-full rounded transition-all"
                       style={{ width: `${widthPct}%`, background: r.color }} />
                  {/* mean line marker, only shows on first bar for cleaner visual */}
                </div>
                <div className="w-[70px] text-right text-[11px] font-semibold text-zinc-800 tabular-nums flex-shrink-0">
                  {metric.shortFormat(r.value)}
                </div>
              </Link>
            );
          })}
        </div>

        {/* Mean overlay: dashed line across the whole bar area */}
        <div className="absolute top-0 bottom-0 border-l border-dashed border-zinc-400 pointer-events-none"
             style={{
               left: `calc(100px + 8px + ${meanPct}% * (100% - 178px) / 100%)`,
             }}
        >
          <span className="absolute -top-4 left-0 -translate-x-1/2 text-[9px] text-zinc-500 font-semibold whitespace-nowrap bg-white px-1">
            mean
          </span>
        </div>
      </div>
    </div>
  );
}