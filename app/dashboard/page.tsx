'use client';

// app/dashboard/page.tsx
// =============================================================================
// Dashboard — the command center. Hero greeting, KPI strip, pipeline funnel,
// analytics row (deal flow / type mix / top opps), action chips (incl. data
// quality), and compact filterable table at the bottom.
// =============================================================================

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DataQualityReport } from '@/lib/data-quality';

// =============================================================================
// TYPES
// =============================================================================
interface Portfolio {
  id: string;
  name: string;
  deal_status: string;
  investment_type: string;
  purchase_price: number;
  spot: number;
  annual_rent_income: number;
  noi: number;
  noi_margin: number;
  total_gla: number;
  walt: number;
  multiplier: number;
  cap_rate: number;
  occupancy_rate: number;
  ltv: number;
  number_of_assets: number;
  updated_at: string;
  created_at: string;
  closing_date?: string | null;
  archived_at?: string | null;
}

interface PendingImport {
  id: string;
  status?: string;
  created_at?: string;
}

// =============================================================================
// FORMATTERS
// =============================================================================
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
const fmtRelative = (iso: string | undefined | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const diffH = diffMs / 36e5;
  if (diffH < 1) return Math.round(diffMs / 60_000) + 'm ago';
  if (diffH < 24) return Math.round(diffH) + 'h ago';
  const diffD = diffH / 24;
  if (diffD < 1.5) return 'today';
  if (diffD < 7) return Math.floor(diffD) + 'd ago';
  if (diffD < 30) return Math.floor(diffD / 7) + 'w ago';
  return Math.floor(diffD / 30) + 'mo ago';
};
const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

const STATUS_BADGE: Record<string, string> = {
  screening: 'bg-blue-50 text-blue-700 border border-blue-200',
  bidding: 'bg-amber-50 text-amber-700 border border-amber-200',
  exclusivity: 'bg-purple-50 text-purple-700 border border-purple-200',
  firm: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  closed: 'bg-zinc-100 text-zinc-600 border border-zinc-200',
  new: 'bg-blue-50 text-blue-700 border border-blue-200',
};

const TYPE_BADGE: Record<string, string> = {
  'core': 'bg-teal-50 text-teal-700 border border-teal-200',
  'core+': 'bg-cyan-50 text-cyan-700 border border-cyan-200',
  'value-add': 'bg-purple-50 text-purple-700 border border-purple-200',
  'opportunistic': 'bg-orange-50 text-orange-700 border border-orange-200',
};

const TYPE_DONUT_COLORS: Record<string, string> = {
  'core': '#14b8a6',
  'core+': '#06b6d4',
  'value-add': '#a855f7',
  'opportunistic': '#f97316',
};

// Funnel stages, ordered.
const FUNNEL_STAGES = [
  { key: 'screening',   label: 'Screening',   bg: 'bg-blue-500',    bgSoft: 'bg-blue-50' },
  { key: 'bidding',     label: 'Bidding',     bg: 'bg-amber-500',   bgSoft: 'bg-amber-50' },
  { key: 'exclusivity', label: 'Exclusivity', bg: 'bg-purple-500',  bgSoft: 'bg-purple-50' },
  { key: 'firm',        label: 'Firm offer',  bg: 'bg-emerald-500', bgSoft: 'bg-emerald-50' },
  { key: 'closed',      label: 'Closed',      bg: 'bg-zinc-600',    bgSoft: 'bg-zinc-100' },
];
const ACTIVE_STAGES = new Set(['screening', 'bidding', 'exclusivity', 'firm']);

// =============================================================================
// MAIN
// =============================================================================
// useSearchParams() requires a Suspense boundary in Next.js 15 during static
// generation. We wrap the inner component (which reads search params) so the
// build doesn't bail out on CSR.
export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-50 grid place-items-center">
        <div className="w-6 h-6 border-2 border-[#6D7C60] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [archivedPortfolios, setArchivedPortfolios] = useState<Portfolio[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [pendingImports, setPendingImports] = useState<PendingImport[]>([]);
  const [dataQuality, setDataQuality] = useState<DataQualityReport | null>(null);
  const [loading, setLoading] = useState(true);

  // Table filters
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>(searchParams.get('filter') === 'recent' ? '_recent' : 'all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const tableRef = useRef<HTMLDivElement>(null);

  const scrollToTable = () => {
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ─── Fetch all data ────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/data?view=portfolios').then(r => r.json()).catch(() => []),
      fetch('/api/pending').then(r => r.json()).catch(() => []),
      fetch('/api/data-quality').then(r => r.json()).catch(() => null),
      fetch('/api/data?view=portfolios&archived=true').then(r => r.json()).catch(() => []),
    ]).then(([portfoliosRes, importsRes, dqRes, archivedRes]) => {
      const list = Array.isArray(portfoliosRes) ? portfoliosRes : (portfoliosRes?.data || []);
      setPortfolios(list);
      setPendingImports(Array.isArray(importsRes) ? importsRes : (importsRes?.pending || importsRes?.data || []));
      setDataQuality(dqRes);
      const archivedList = Array.isArray(archivedRes) ? archivedRes : (archivedRes?.data || []);
      setArchivedPortfolios(archivedList);
      setLoading(false);
    });
  }, []);

  // ─── Unarchive helper ──────────────────────────────────────────────────────
  const handleUnarchive = async (portfolioId: string) => {
    await fetch(`/api/portfolios/${portfolioId}/unarchive`, { method: 'POST' });
    // Move it from archived list to active list
    const portfolio = archivedPortfolios.find(p => p.id === portfolioId);
    if (portfolio) {
      setArchivedPortfolios(prev => prev.filter(p => p.id !== portfolioId));
      setPortfolios(prev => [{ ...portfolio, archived_at: null } as Portfolio, ...prev]);
    }
  };

  // ─── Compute action chip counters ──────────────────────────────────────────
  const importsPending = pendingImports.filter(i => !i.status || i.status === 'pending').length;
  const recentDealsCount = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 36e5;
    return portfolios.filter(p => p.updated_at && new Date(p.updated_at).getTime() > cutoff).length;
  }, [portfolios]);

  const newDealsThisWeek = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 36e5;
    return portfolios.filter(p => p.created_at && new Date(p.created_at).getTime() > cutoff).length;
  }, [portfolios]);

  // ─── KPI computations ──────────────────────────────────────────────────────
  const activePortfolios = useMemo(() =>
    portfolios.filter(p => ACTIVE_STAGES.has((p.deal_status || '').toLowerCase())),
    [portfolios]
  );
  const closedPortfolios = useMemo(() =>
    portfolios.filter(p => (p.deal_status || '').toLowerCase() === 'closed'),
    [portfolios]
  );
  const closedYTD = useMemo(() => {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    return closedPortfolios.filter(p => {
      const d = p.closing_date ? new Date(p.closing_date) : (p.updated_at ? new Date(p.updated_at) : null);
      return d && d.getTime() >= yearStart;
    });
  }, [closedPortfolios]);

  const kpis = useMemo(() => {
    const sum = (arr: Portfolio[], key: keyof Portfolio): number =>
      arr.reduce((s, p) => s + ((p[key] as number) || 0), 0);
    const avg = (arr: Portfolio[], key: keyof Portfolio): number => {
      const valid = arr.filter(p => typeof p[key] === 'number' && (p[key] as number) > 0);
      if (valid.length === 0) return 0;
      return valid.reduce((s, p) => s + (p[key] as number), 0) / valid.length;
    };
    return {
      activeCount: activePortfolios.length,
      pipelineValue: sum(activePortfolios, 'purchase_price'),
      closedYtdValue: sum(closedYTD, 'purchase_price'),
      avgCap: avg(activePortfolios, 'cap_rate'),
      avgMulti: avg(activePortfolios, 'multiplier'),
      totalGla: sum(activePortfolios, 'total_gla'),
    };
  }, [activePortfolios, closedYTD]);

  // ─── Funnel data ───────────────────────────────────────────────────────────
  const funnelData = useMemo(() => {
    const byStage: Record<string, Portfolio[]> = {};
    FUNNEL_STAGES.forEach(s => { byStage[s.key] = []; });
    portfolios.forEach(p => {
      const stage = (p.deal_status || '').toLowerCase();
      if (byStage[stage]) byStage[stage].push(p);
    });
    const maxCount = Math.max(...FUNNEL_STAGES.map(s => byStage[s.key].length), 1);
    return FUNNEL_STAGES.map(s => {
      const list = byStage[s.key];
      const value = list.reduce((sum, p) => sum + (p.purchase_price || 0), 0);
      return {
        ...s,
        count: list.length,
        value,
        widthPct: (list.length / maxCount) * 100,
      };
    });
  }, [portfolios]);

  // ─── Type mix (donut) ──────────────────────────────────────────────────────
  const typeMix = useMemo(() => {
    const map: Record<string, number> = {};
    activePortfolios.forEach(p => {
      const t = p.investment_type || '_none';
      map[t] = (map[t] || 0) + (p.purchase_price || 0);
    });
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    return Object.entries(map)
      .filter(([k]) => k !== '_none')
      .map(([type, value]) => ({
        type,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [activePortfolios]);

  // ─── Top opportunities (top 5 by cap rate, active only) ────────────────────
  const topOpportunities = useMemo(() =>
    [...activePortfolios]
      .filter(p => typeof p.cap_rate === 'number' && p.cap_rate > 0)
      .sort((a, b) => (b.cap_rate || 0) - (a.cap_rate || 0))
      .slice(0, 5),
    [activePortfolios]
  );

  // ─── Deal flow chart (last 12 months) ──────────────────────────────────────
  const dealFlow = useMemo(() => {
    const months: Array<{ label: string; count: number; date: Date }> = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString('en', { month: 'short' }),
        count: 0,
        date: d,
      });
    }
    portfolios.forEach(p => {
      if (!p.created_at) return;
      const created = new Date(p.created_at);
      const monthKey = `${created.getFullYear()}-${created.getMonth()}`;
      const month = months.find(m => `${m.date.getFullYear()}-${m.date.getMonth()}` === monthKey);
      if (month) month.count += 1;
    });
    return months;
  }, [portfolios]);

  // ─── Filtered table data ───────────────────────────────────────────────────
  const filteredTable = useMemo(() => {
    let result = [...portfolios];

    if (stageFilter === '_recent') {
      const cutoff = Date.now() - 7 * 24 * 36e5;
      result = result.filter(p => p.updated_at && new Date(p.updated_at).getTime() > cutoff);
    } else if (stageFilter !== 'all') {
      result = result.filter(p => (p.deal_status || '').toLowerCase() === stageFilter);
    }

    if (typeFilter !== 'all') {
      result = result.filter(p => (p.investment_type || '') === typeFilter);
    }

    if (search.trim()) {
      const s = search.trim().toLowerCase();
      result = result.filter(p => (p.name || '').toLowerCase().includes(s));
    }

    return result.sort((a, b) => {
      const da = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const db = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return db - da;
    });
  }, [portfolios, stageFilter, typeFilter, search]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#6D7C60] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const today = new Date().toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="min-h-screen bg-zinc-50" style={{ fontFeatureSettings: "'cv11','ss01'" }}>

      {/* ═══════ HEADER ═══════ */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-[1500px] mx-auto px-7 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm">
            <Link href="/dashboard" className="flex items-center gap-2.5 hover:opacity-80">
              <div className="w-7 h-7 bg-[#6D7C60] rounded-md grid place-items-center font-bold text-xs">R</div>
              <span className="font-semibold">RE Analyzer</span>
            </Link>
            <span className="text-zinc-500 text-xs ml-1">/&nbsp;<strong className="text-white font-medium">Dashboard</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/compare" className="px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded-md font-medium">
              Compare
            </Link>
            <Link href="/dashboard/portfolio/new" className="px-3 py-1.5 text-xs bg-[#6D7C60] hover:bg-[#5d6c50] rounded-md font-medium">
              + New deal
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-7 py-8 pb-20">

        {/* ═══════ HERO ═══════ */}
        <div className="pb-7 mb-7 border-b border-zinc-200 flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight leading-none mb-2">Pipeline overview</h1>
            <p className="text-sm text-zinc-500">
              <span className="tabular-nums font-medium text-zinc-700">{today}</span>
              {newDealsThisWeek > 0 && (
                <> · <span className="text-emerald-600 font-medium">{newDealsThisWeek} new deals</span> this week</>
              )}
              {importsPending > 0 && (
                <> · <span className="text-amber-600 font-medium">{importsPending} import{importsPending === 1 ? '' : 's'}</span> awaiting review</>
              )}
              {dataQuality && dataQuality.totalIssues > 0 && (
                <> · <span className="text-red-600 font-medium">{dataQuality.totalIssues} data issues</span> to address</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/pending" className="px-3 py-2 text-xs bg-white border border-zinc-200 rounded-lg font-medium hover:bg-zinc-50 inline-flex items-center gap-1.5">
              📥 Pending imports
              {importsPending > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold tabular-nums rounded-full bg-amber-100 text-amber-800">
                  {importsPending}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* ═══════ KPI STRIP ═══════ */}
        <div className="grid grid-cols-6 bg-white border border-zinc-200 rounded-xl overflow-hidden mb-8">
          <KpiCell label="Active deals" value={String(kpis.activeCount)} sub={newDealsThisWeek > 0 ? `+${newDealsThisWeek} this week` : undefined} />
          <KpiCell label="Pipeline value" value={fmtM(kpis.pipelineValue)} sub="Asking, all active" />
          <KpiCell label="Closed YTD" value={fmtM(kpis.closedYtdValue)} sub={`${closedYTD.length} deals`} />
          <KpiCell label="Avg cap rate" value={kpis.avgCap > 0 ? `${kpis.avgCap.toFixed(2)}%` : '—'} sub="Active pipeline" highlight />
          <KpiCell label="Avg multiplier" value={kpis.avgMulti > 0 ? `${kpis.avgMulti.toFixed(2)}×` : '—'} sub="Active pipeline" highlight />
          <KpiCell label="Total GLA" value={kpis.totalGla > 0 ? `${(kpis.totalGla / 1000).toFixed(0)}k` : '—'} sub="m² under review" isLast />
        </div>

        {/* ═══════ PIPELINE FUNNEL ═══════ */}
        <div className="bg-white border border-zinc-200 rounded-xl p-6 mb-8">
          <div className="flex items-baseline justify-between mb-5">
            <div>
              <div className="text-[11px] font-semibold text-zinc-600 uppercase tracking-[0.6px]">Pipeline by Stage</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                {kpis.activeCount} active deals · {fmtM(kpis.pipelineValue)} total asking
              </div>
            </div>
            <div className="text-[11px] text-zinc-400">Click a stage to filter</div>
          </div>

          <div className="space-y-2.5">
            {funnelData.map(stage => (
              <button
                key={stage.key}
                onClick={() => {
                  setStageFilter(stage.key);
                  setTimeout(scrollToTable, 50);
                }}
                className="group cursor-pointer w-full text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-[100px] flex-shrink-0">
                    <div className="text-[11.5px] font-semibold text-zinc-800">{stage.label}</div>
                    <div className="text-[10px] text-zinc-500 tabular-nums">{stage.count} deals</div>
                  </div>
                  <div className={`flex-1 h-9 ${stage.bgSoft} rounded-md relative overflow-hidden group-hover:brightness-95 transition-all`}>
                    <div className={`h-full ${stage.bg} rounded-md flex items-center justify-between px-3`}
                         style={{ width: `${Math.max(stage.widthPct, stage.count > 0 ? 8 : 0)}%` }}>
                      {stage.count > 0 && (
                        <>
                          <span className="text-white text-[11px] font-medium">{stage.count} deals</span>
                          <span className="text-white text-[12px] font-semibold tabular-nums">{fmtM(stage.value)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ═══════ ANALYTICS ROW (3 panels) ═══════ */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <DealFlowPanel dealFlow={dealFlow} totalThisYear={portfolios.filter(p => {
            if (!p.created_at) return false;
            const d = new Date(p.created_at);
            return d.getFullYear() === new Date().getFullYear();
          }).length} />
          <TypeMixPanel typeMix={typeMix} total={kpis.pipelineValue} />
          <TopOpportunitiesPanel opportunities={topOpportunities} />
        </div>

        {/* ═══════ ACTION CHIPS ═══════ */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-[0.7px]">Needs your attention</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <ActionChip
              href="/pending"
              icon="📥"
              count={importsPending}
              countSuffix="to review"
              label="Pending imports"
              accentColor="amber"
            />
            <ActionChip
              href="/dashboard?filter=recent"
              onClick={() => {
                setStageFilter('_recent');
                setTimeout(scrollToTable, 50);
              }}
              icon="🔄"
              count={recentDealsCount}
              countSuffix="this week"
              label="Deals updated"
              accentColor="emerald"
            />
            <DataQualityChip report={dataQuality} />
          </div>
        </div>

        {/* ═══════ TABLE ═══════ */}
        <div ref={tableRef} className="mb-3 flex items-center justify-between flex-wrap gap-3 scroll-mt-24">
          <div>
            <h2 className="text-[15px] font-bold tracking-tight text-zinc-900">All deals</h2>
            <p className="text-[11px] text-zinc-500">
              Showing {filteredTable.length} of {portfolios.length} deals
              {stageFilter === '_recent' && ' · updated this week'}
              {stageFilter !== 'all' && stageFilter !== '_recent' && ` · ${capitalize(stageFilter)} stage`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <input
                type="text"
                placeholder="Search deals..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="px-3 py-1.5 pl-7 text-[12px] bg-white border border-zinc-200 rounded-lg w-[200px] focus:outline-none focus:border-[#6D7C60]"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs">🔍</span>
            </div>
            <select
              value={stageFilter}
              onChange={e => setStageFilter(e.target.value)}
              className="px-3 py-1.5 text-[12px] bg-white border border-zinc-200 rounded-lg font-medium"
            >
              <option value="all">All stages</option>
              <option value="_recent">Updated this week</option>
              {FUNNEL_STAGES.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-[12px] bg-white border border-zinc-200 rounded-lg font-medium"
            >
              <option value="all">All types</option>
              <option value="core">Core</option>
              <option value="core+">Core+</option>
              <option value="value-add">Value-add</option>
              <option value="opportunistic">Opportunistic</option>
            </select>
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          {filteredTable.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="text-3xl mb-2">🔍</div>
              <p className="text-sm text-zinc-500">No deals match your filters.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/60">
                  <th className="px-4 py-2.5 text-left text-[10.5px] font-semibold text-zinc-600 uppercase tracking-wider">Portfolio</th>
                  <th className="px-4 py-2.5 text-left text-[10.5px] font-semibold text-zinc-600 uppercase tracking-wider">Stage</th>
                  <th className="px-4 py-2.5 text-left text-[10.5px] font-semibold text-zinc-600 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-2.5 text-right text-[10.5px] font-semibold text-zinc-600 uppercase tracking-wider">Asking</th>
                  <th className="px-4 py-2.5 text-right text-[10.5px] font-semibold text-zinc-600 uppercase tracking-wider">Multi</th>
                  <th className="px-4 py-2.5 text-right text-[10.5px] font-semibold text-zinc-600 uppercase tracking-wider">Cap</th>
                  <th className="px-4 py-2.5 text-right text-[10.5px] font-semibold text-zinc-600 uppercase tracking-wider">WALT</th>
                  <th className="px-4 py-2.5 text-right text-[10.5px] font-semibold text-zinc-600 uppercase tracking-wider">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredTable.map(p => (
                  <tr key={p.id}
                      onClick={() => router.push(`/dashboard/portfolio/${p.id}`)}
                      className="hover:bg-zinc-50 cursor-pointer">
                    <td className="px-4 py-3 text-[13px] font-medium text-zinc-900">{p.name || 'Unnamed'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10.5px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[(p.deal_status || '').toLowerCase()] || STATUS_BADGE.new}`}>
                        {capitalize(p.deal_status || 'new')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {p.investment_type ? (
                        <span className={`text-[10.5px] px-2 py-0.5 rounded-full font-medium ${TYPE_BADGE[p.investment_type] || 'bg-zinc-50 text-zinc-600'}`}>
                          {capitalize(p.investment_type)}
                        </span>
                      ) : <span className="text-zinc-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-[13px] tabular-nums font-medium">{fmtM(p.purchase_price)}</td>
                    <td className="px-4 py-3 text-right text-[13px] tabular-nums text-[#6D7C60] font-semibold">{p.multiplier > 0 ? `${fmtDec(p.multiplier)}×` : '—'}</td>
                    <td className="px-4 py-3 text-right text-[13px] tabular-nums text-[#6D7C60] font-semibold">{fmtPct(p.cap_rate)}</td>
                    <td className="px-4 py-3 text-right text-[13px] tabular-nums">{p.walt > 0 ? `${fmtDec(p.walt, 1)}y` : '—'}</td>
                    <td className="px-4 py-3 text-right text-[11px] text-zinc-500">{fmtRelative(p.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ═══════ ARCHIVED REVEAL ═══════ */}
        {archivedPortfolios.length > 0 && (
          <div className="mt-10 pt-6 border-t border-zinc-100">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="text-[11px] text-zinc-400 hover:text-zinc-700 inline-flex items-center gap-1.5 transition-colors"
            >
              <span className={`transition-transform inline-block ${showArchived ? 'rotate-90' : ''}`}>▸</span>
              {showArchived ? 'Hide' : 'Show'} {archivedPortfolios.length} archived portfolio{archivedPortfolios.length === 1 ? '' : 's'}
            </button>

            {showArchived && (
              <div className="mt-3 bg-zinc-50/60 border border-zinc-200 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-200">
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Portfolio</th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Last stage</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Asking</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Archived</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {archivedPortfolios.map(p => (
                      <tr key={p.id} className="hover:bg-white">
                        <td className="px-4 py-2 text-[12px]">
                          <Link href={`/dashboard/portfolio/${p.id}`}
                                className="font-medium text-zinc-600 hover:text-zinc-900 hover:underline">
                            {p.name || 'Unnamed'}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-[11.5px] text-zinc-500">
                          {capitalize(p.deal_status || '—')}
                        </td>
                        <td className="px-4 py-2 text-right text-[12px] tabular-nums text-zinc-500">
                          {fmtM(p.purchase_price)}
                        </td>
                        <td className="px-4 py-2 text-right text-[11px] text-zinc-400">
                          {fmtRelative((p as any).archived_at)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => handleUnarchive(p.id)}
                            className="px-2 py-1 text-[10.5px] font-medium bg-white border border-zinc-200 rounded hover:bg-zinc-50 text-zinc-600 hover:text-zinc-900"
                            title="Restore this portfolio to the active list"
                          >
                            ↩ Restore
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================
function KpiCell({ label, value, sub, highlight, isLast }: {
  label: string; value: string; sub?: string; highlight?: boolean; isLast?: boolean;
}) {
  return (
    <div className={`px-5 py-4 ${isLast ? '' : 'border-r border-zinc-200'}`}>
      <div className="text-[10px] text-zinc-500 font-semibold uppercase tracking-[0.7px]">{label}</div>
      <div className={`text-[26px] font-bold tracking-tight tabular-nums mt-0.5 ${highlight ? 'text-[#6D7C60]' : 'text-zinc-900'}`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

// ─── Action chip ─────────────────────────────────────────────────────────────
function ActionChip({ href, icon, count, countSuffix, label, accentColor, onClick }: {
  href: string;
  icon: string;
  count: number;
  countSuffix: string;
  label: string;
  accentColor: 'amber' | 'emerald' | 'blue';
  onClick?: () => void;
}) {
  const accentMap = {
    amber:   { border: 'hover:border-amber-300',   bg: 'hover:bg-amber-50/40',   iconBg: 'bg-amber-50',   iconBgHover: 'group-hover:bg-amber-100',   iconText: 'text-amber-600',   arrowHover: 'group-hover:text-amber-600' },
    emerald: { border: 'hover:border-emerald-300', bg: 'hover:bg-emerald-50/40', iconBg: 'bg-emerald-50', iconBgHover: 'group-hover:bg-emerald-100', iconText: 'text-emerald-600', arrowHover: 'group-hover:text-emerald-600' },
    blue:    { border: 'hover:border-blue-300',    bg: 'hover:bg-blue-50/40',    iconBg: 'bg-blue-50',    iconBgHover: 'group-hover:bg-blue-100',    iconText: 'text-blue-600',    arrowHover: 'group-hover:text-blue-600' },
  };
  const c = accentMap[accentColor];

  return (
    <Link href={href} onClick={onClick}
      className={`group bg-white border border-zinc-200 ${c.border} ${c.bg} transition-all rounded-xl px-4 py-3 flex items-center gap-3`}>
      <div className={`w-9 h-9 ${c.iconBg} ${c.iconBgHover} rounded-lg grid place-items-center ${c.iconText} flex-shrink-0 transition-colors`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[18px] font-bold tabular-nums text-zinc-900">{count}</span>
          <span className="text-[11px] text-zinc-500">{countSuffix}</span>
        </div>
        <div className="text-[11.5px] font-medium text-zinc-700 truncate">{label}</div>
      </div>
      <span className={`text-zinc-300 ${c.arrowHover} transition-colors text-sm`}>→</span>
    </Link>
  );
}

// ─── Data Quality chip (special, tricolor accent + breakdown) ────────────────
function DataQualityChip({ report }: { report: DataQualityReport | null }) {
  const totalIssues = report?.totalIssues ?? 0;
  const critical = report?.byCategory.critical.length ?? 0;
  const warning = (report?.byCategory.derivable.length ?? 0) + (report?.byCategory.missing.length ?? 0);
  const anomaly = report?.byCategory.anomaly.length ?? 0;

  return (
    <Link href="/dashboard/data-quality"
      className="group bg-white border border-zinc-200 hover:border-red-300 hover:bg-red-50/30 transition-all rounded-xl px-4 py-3 flex items-center gap-3 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-1.5 h-full bg-gradient-to-b from-red-400 via-amber-400 to-blue-400" />
      <div className="w-9 h-9 bg-zinc-100 group-hover:bg-zinc-200 rounded-lg grid place-items-center flex-shrink-0 transition-colors">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 1L1 4.5v4c0 4 3 7 7 7s7-3 7-7v-4L8 1z" stroke="#525252" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M5.5 8L7 9.5L10.5 6" stroke="#525252" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[18px] font-bold tabular-nums text-zinc-900">{totalIssues}</span>
          <span className="text-[11px] text-zinc-500">issues</span>
        </div>
        <div className="text-[11.5px] font-medium text-zinc-700 flex items-center gap-1.5">
          <span className="truncate">Data quality</span>
          {totalIssues > 0 && (
            <span className="flex items-center gap-0.5 text-[9.5px]">
              <span className="w-1 h-1 rounded-full bg-red-500" />
              <span className="text-zinc-500 tabular-nums">{critical}</span>
              <span className="w-1 h-1 rounded-full bg-amber-500 ml-1" />
              <span className="text-zinc-500 tabular-nums">{warning}</span>
              <span className="w-1 h-1 rounded-full bg-blue-500 ml-1" />
              <span className="text-zinc-500 tabular-nums">{anomaly}</span>
            </span>
          )}
        </div>
      </div>
      <span className="text-zinc-300 group-hover:text-zinc-700 transition-colors text-sm">→</span>
    </Link>
  );
}

// ─── Deal flow panel (mini SVG line chart) ───────────────────────────────────
function DealFlowPanel({ dealFlow, totalThisYear }: { dealFlow: Array<{ label: string; count: number; date: Date }>; totalThisYear: number }) {
  const max = Math.max(...dealFlow.map(d => d.count), 1);
  const W = 280, H = 110, PAD_X = 10, PAD_Y = 10;
  const stepX = (W - PAD_X * 2) / Math.max(dealFlow.length - 1, 1);
  const y = (count: number) => H - PAD_Y - ((count / max) * (H - PAD_Y * 2));
  const x = (i: number) => PAD_X + i * stepX;

  const points = dealFlow.map((d, i) => `${x(i)} ${y(d.count)}`);
  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `M ${x(0)} ${H} L ${points.join(' L ')} L ${x(dealFlow.length - 1)} ${H} Z`;

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-[0.6px]">Deal flow</span>
        <span className="text-[10.5px] text-zinc-400">Last 12 months</span>
      </div>
      <div className="text-[10.5px] text-zinc-500 mb-4">New deals added per month</div>

      <svg viewBox={`0 0 ${W} ${H + 15}`} className="w-full">
        <line x1="0" y1={H} x2={W} y2={H} stroke="#e4e4e7" strokeWidth="1" />
        <path d={areaPath} fill="#6D7C60" fillOpacity="0.1" />
        <path d={linePath} stroke="#6D7C60" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {dealFlow.map((d, i) => i === dealFlow.length - 1 || i === dealFlow.length - 2 || i === dealFlow.length - 3 ? (
          <circle key={i} cx={x(i)} cy={y(d.count)} r={i === dealFlow.length - 1 ? 3.5 : 3} fill="#6D7C60" stroke="#fff" strokeWidth="1.5" />
        ) : null)}

        <text x={x(0)} y={H + 12} fontSize="8" fill="#a1a1aa">{dealFlow[0]?.label}</text>
        <text x={x(Math.floor(dealFlow.length / 2))} y={H + 12} fontSize="8" fill="#a1a1aa">{dealFlow[Math.floor(dealFlow.length / 2)]?.label}</text>
        <text x={x(dealFlow.length - 1) - 12} y={H + 12} fontSize="8" fill="#a1a1aa">{dealFlow[dealFlow.length - 1]?.label}</text>
      </svg>

      <div className="flex items-baseline justify-between mt-3 pt-3 border-t border-zinc-100">
        <div>
          <div className="text-[18px] font-bold tabular-nums">{totalThisYear}</div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Total YTD</div>
        </div>
      </div>
    </div>
  );
}

// ─── Type mix donut ──────────────────────────────────────────────────────────
function TypeMixPanel({ typeMix, total }: { typeMix: Array<{ type: string; value: number; pct: number }>; total: number }) {
  const R = 48, CX = 60, CY = 60, STROKE = 14;
  const CIRC = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-[0.6px]">Investment Mix</span>
        <span className="text-[10.5px] text-zinc-400">{fmtM(total)} total</span>
      </div>
      <div className="text-[10.5px] text-zinc-500 mb-4">By investment type · pipeline value</div>

      {typeMix.length === 0 ? (
        <div className="text-center py-10 text-zinc-400 text-xs">No type data</div>
      ) : (
        <div className="flex items-center gap-4">
          <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90 flex-shrink-0">
            <circle cx={CX} cy={CY} r={R} fill="none" stroke="#e4e4e7" strokeWidth={STROKE} />
            {typeMix.map(({ type, pct }) => {
              const length = (pct / 100) * CIRC;
              const seg = (
                <circle key={type} cx={CX} cy={CY} r={R} fill="none"
                        stroke={TYPE_DONUT_COLORS[type] || '#a1a1aa'} strokeWidth={STROKE}
                        strokeDasharray={`${length} ${CIRC - length}`} strokeDashoffset={-offset} />
              );
              offset += length;
              return seg;
            })}
          </svg>
          <div className="flex-1 space-y-2">
            {typeMix.map(({ type, pct }) => (
              <div key={type} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-sm" style={{ background: TYPE_DONUT_COLORS[type] || '#a1a1aa' }} />
                  <span className="text-[11.5px] text-zinc-700">{capitalize(type)}</span>
                </div>
                <span className="text-[11px] font-semibold tabular-nums">{pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Top opportunities panel ─────────────────────────────────────────────────
function TopOpportunitiesPanel({ opportunities }: { opportunities: Portfolio[] }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-[0.6px]">Top Opportunities</span>
        <span className="text-[10.5px] text-zinc-400">By cap rate</span>
      </div>
      <div className="text-[10.5px] text-zinc-500 mb-4">Active pipeline · highest yields</div>

      {opportunities.length === 0 ? (
        <div className="text-center py-10 text-zinc-400 text-xs">No active deals with cap rate</div>
      ) : (
        <div className="space-y-2">
          {opportunities.map((p, i) => (
            <Link key={p.id} href={`/dashboard/portfolio/${p.id}`}
              className="flex items-center justify-between px-2 py-1.5 -mx-2 rounded hover:bg-zinc-50 group">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-bold text-zinc-400 tabular-nums w-3">{i + 1}</span>
                <span className="text-[12px] text-zinc-800 truncate group-hover:text-[#6D7C60]">{p.name || 'Unnamed'}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-[10.5px] text-zinc-500 tabular-nums">{fmtM(p.purchase_price)}</span>
                <span className="text-[12px] font-bold text-[#6D7C60] tabular-nums">{p.cap_rate.toFixed(2)}%</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}