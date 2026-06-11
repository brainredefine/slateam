'use client';

// app/dashboard/data-quality/page.tsx
// =============================================================================
// Data Quality Center — full page listing all detected issues, grouped by
// severity, with filter pills, ack/unack support and click-through to portfolios.
// =============================================================================

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { DataQualityIssue, DataQualityReport, IssueSeverity } from '@/lib/data-quality';
import { SEVERITY_META } from '@/lib/data-quality';

type FilterKey = 'all' | IssueSeverity;

const STATUS_BADGE: Record<string, string> = {
  screening: 'bg-blue-50 text-blue-600 border border-blue-200',
  bidding: 'bg-amber-50 text-amber-600 border border-amber-200',
  exclusivity: 'bg-purple-50 text-purple-600 border border-purple-200',
  firm: 'bg-emerald-50 text-emerald-600 border border-emerald-200',
  closed: 'bg-zinc-50 text-zinc-500 border border-zinc-200',
  new: 'bg-blue-50 text-blue-600 border border-blue-200',
};

// Markdown-lite (bold only) for issue descriptions
function MaybeBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-zinc-900">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export default function DataQualityPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-50 grid place-items-center">
        <div className="w-6 h-6 border-2 border-[#6D7C60] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DataQualityInner />
    </Suspense>
  );
}

function DataQualityInner() {
  const searchParams = useSearchParams();
  // When set, the page only shows issues for this one portfolio.
  const portfolioFilter = searchParams.get('portfolio');

  const [report, setReport] = useState<DataQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sortBy, setSortBy] = useState<'severity' | 'portfolio'>('severity');
  const [fixing, setFixing] = useState(false);
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [pendingAck, setPendingAck] = useState<Set<string>>(new Set());

  const reload = async () => {
    const res = await fetch('/api/data-quality');
    const data: DataQualityReport = await res.json();
    setReport(data);
  };

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  // Filter + group issues for display
  const visibleIssues: DataQualityIssue[] = useMemo(() => {
    if (!report) return [];
    let base: DataQualityIssue[];
    if (showAcknowledged) {
      base = filter === 'all'
        ? report.acknowledged
        : report.acknowledged.filter(i => i.severity === filter);
    } else if (filter === 'all') {
      base = [
        ...report.byCategory.critical,
        ...report.byCategory.derivable,
        ...report.byCategory.missing,
        ...report.byCategory.anomaly,
      ];
    } else {
      base = report.byCategory[filter];
    }
    // Narrow to a single portfolio when the ?portfolio= param is present
    if (portfolioFilter) {
      base = base.filter(i => i.portfolioId === portfolioFilter);
    }
    return base;
  }, [report, filter, showAcknowledged, portfolioFilter]);

  const grouped: Record<IssueSeverity, DataQualityIssue[]> = useMemo(() => {
    const out: Record<IssueSeverity, DataQualityIssue[]> = {
      critical: [], derivable: [], missing: [], anomaly: [],
    };
    for (const issue of visibleIssues) out[issue.severity].push(issue);
    if (sortBy === 'portfolio') {
      (Object.keys(out) as IssueSeverity[]).forEach(k => {
        out[k].sort((a, b) => a.portfolioName.localeCompare(b.portfolioName));
      });
    }
    return out;
  }, [visibleIssues, sortBy]);

  // Acknowledge / un-acknowledge
  const handleAck = async (issueId: string, acked: boolean) => {
    setPendingAck(prev => new Set(prev).add(issueId));
    try {
      if (acked) {
        await fetch(`/api/data-quality?issue_id=${encodeURIComponent(issueId)}`, { method: 'DELETE' });
      } else {
        await fetch('/api/data-quality', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issue_id: issueId }),
        });
      }
      await reload();
    } finally {
      setPendingAck(prev => {
        const next = new Set(prev);
        next.delete(issueId);
        return next;
      });
    }
  };

  // Auto-fix all derivable issues
  const handleAutoFix = async () => {
    if (!report) return;
    setFixing(true);
    const derivables = report.byCategory.derivable.filter(i => i.autoFixable);
    const portfolioIds = Array.from(new Set(derivables.map(i => i.portfolioId)));
    try {
      await Promise.all(portfolioIds.map(id =>
        fetch(`/api/portfolios/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'recalc' }),
        })
      ));
      await reload();
    } catch (err) {
      console.error('Auto-fix failed:', err);
    } finally {
      setFixing(false);
    }
  };

  if (loading || !report) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#6D7C60] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const derivableAutoFixCount = report.byCategory.derivable.filter(i => i.autoFixable).length;

  return (
    <div className="min-h-screen bg-zinc-50" style={{ fontFeatureSettings: "'cv11','ss01'" }}>

      {/* HEADER */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-[1500px] mx-auto px-7 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm">
            <Link href="/dashboard" className="flex items-center gap-2.5 hover:opacity-80">
              <div className="w-7 h-7 bg-[#6D7C60] rounded-md grid place-items-center font-bold text-xs">R</div>
              <span className="font-semibold">RE Analyzer</span>
            </Link>
            <span className="text-zinc-500 text-xs ml-1">
              /&nbsp;<Link href="/dashboard" className="hover:text-white">Dashboard</Link>&nbsp;/&nbsp;
              <strong className="text-white font-medium">Data Quality</strong>
            </span>
          </div>
          <Link href="/dashboard" className="px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded-md font-medium">
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-7 py-8 pb-20">

        {/* HERO */}
        <div className="pb-7 mb-7 border-b border-zinc-200">
          <h1 className="text-3xl font-bold tracking-tight leading-none mb-2">Data Quality Center</h1>
          {portfolioFilter && (
            <div className="mb-3 inline-flex items-center gap-2 px-3 py-1.5 bg-[#6D7C60]/10 border border-[#6D7C60]/20 rounded-lg">
              <span className="text-[12px] font-medium text-[#5d6c50]">
                🔍 Filtered to{' '}
                <strong>{visibleIssues[0]?.portfolioName || report.acknowledged.find(i => i.portfolioId === portfolioFilter)?.portfolioName || 'one portfolio'}</strong>
                {' '}— showing {visibleIssues.length} issue{visibleIssues.length === 1 ? '' : 's'}
              </span>
              <Link href="/dashboard/data-quality"
                className="text-[11px] font-semibold text-[#6D7C60] hover:underline">
                Show all portfolios →
              </Link>
            </div>
          )}
          <p className="text-sm text-zinc-500">
            <span className="tabular-nums font-medium text-zinc-700">{report.totalIssues}</span> active issues across{' '}
            <span className="tabular-nums font-medium text-zinc-700">{report.affectedPortfolios}</span> of{' '}
            <span className="tabular-nums">{report.totalPortfolios}</span> portfolios ·{' '}
            <span className="font-medium text-zinc-700">{report.overallScore}%</span> completeness score
            {report.totalAcknowledged > 0 && (
              <> · <span className="text-zinc-400">{report.totalAcknowledged} acknowledged</span></>
            )}
          </p>
        </div>

        {/* SCORE KPIs */}
        <div className="grid grid-cols-5 gap-3 mb-8">
          <div className="bg-white border border-zinc-200 rounded-xl p-5 relative overflow-hidden">
            <div className="text-[10px] text-zinc-500 font-semibold uppercase tracking-[0.7px] mb-3">Overall completeness</div>
            <div className="flex items-end gap-3">
              <div className="text-[34px] font-bold tracking-tight tabular-nums leading-none text-[#6D7C60]">
                {report.overallScore}<span className="text-[20px] text-zinc-400">%</span>
              </div>
            </div>
            <div className="h-1.5 bg-zinc-100 rounded-full mt-4 overflow-hidden">
              <div className="h-full bg-[#6D7C60] rounded-full" style={{ width: `${report.overallScore}%` }} />
            </div>
          </div>

          {(['critical', 'derivable', 'missing', 'anomaly'] as IssueSeverity[]).map(sev => {
            const m = SEVERITY_META[sev];
            const count = report.byCategory[sev].length;
            return (
              <div key={sev} className="bg-white border border-zinc-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2 h-2 rounded-full ${m.dotClass}`} />
                  <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-[0.7px]">{m.label}</span>
                </div>
                <div className="text-[34px] font-bold tracking-tight tabular-nums leading-none">{count}</div>
                <div className="text-[11px] text-zinc-500 mt-2">{m.description}</div>
              </div>
            );
          })}
        </div>

        {/* FILTER PILLS + ACK TOGGLE */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <FilterPill
              active={filter === 'all'}
              onClick={() => setFilter('all')}
              label="All"
              count={showAcknowledged ? report.totalAcknowledged : report.totalIssues}
              variant="dark"
            />
            {(['critical', 'derivable', 'missing', 'anomaly'] as IssueSeverity[]).map(sev => {
              const m = SEVERITY_META[sev];
              const count = showAcknowledged
                ? report.acknowledged.filter(i => i.severity === sev).length
                : report.byCategory[sev].length;
              return (
                <FilterPill
                  key={sev}
                  active={filter === sev}
                  onClick={() => setFilter(sev)}
                  label={m.label}
                  count={count}
                  dotClass={m.dotClass}
                  textClass={m.textClass}
                />
              );
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowAcknowledged(!showAcknowledged)}
              className={`px-3 py-1.5 text-[12px] font-semibold rounded-lg border inline-flex items-center gap-1.5 ${
                showAcknowledged
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white border-zinc-200 hover:bg-zinc-50 text-zinc-700'
              }`}
            >
              {showAcknowledged ? '👁️ Showing acknowledged' : '👁️‍🗨️ Show acknowledged'}
              {report.totalAcknowledged > 0 && (
                <span className="tabular-nums opacity-75">{report.totalAcknowledged}</span>
              )}
            </button>

            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'severity' | 'portfolio')}
              className="px-3 py-1.5 text-[12px] bg-white border border-zinc-200 rounded-lg font-medium"
            >
              <option value="severity">Sort by severity</option>
              <option value="portfolio">Sort by portfolio</option>
            </select>

            {!showAcknowledged && derivableAutoFixCount > 0 && (
              <button
                onClick={handleAutoFix}
                disabled={fixing}
                className="px-3 py-1.5 text-[12px] bg-[#6D7C60] hover:bg-[#5d6c50] text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-wait flex items-center gap-1.5"
              >
                {fixing && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {fixing ? 'Computing…' : `⚡ Auto-fix derivable (${derivableAutoFixCount})`}
              </button>
            )}
          </div>
        </div>

        {/* ISSUES LIST */}
        {visibleIssues.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-zinc-300 rounded-xl bg-white">
            <div className="text-4xl mb-3">{showAcknowledged ? '🗂️' : '🎉'}</div>
            <h3 className="text-lg font-bold text-zinc-900 mb-1">
              {showAcknowledged ? 'No acknowledged issues' : 'No issues in this filter'}
            </h3>
            <p className="text-zinc-500 text-sm">
              {showAcknowledged ? "You haven't acknowledged any issues yet." : 'Everything looks clean here.'}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            {(['critical', 'derivable', 'missing', 'anomaly'] as IssueSeverity[]).map(sev => {
              const issues = grouped[sev];
              if (issues.length === 0) return null;
              const m = SEVERITY_META[sev];
              return (
                <div key={sev}>
                  <div className={`px-5 py-2.5 ${m.bgSoftClass} border-b border-zinc-200 flex items-center justify-between`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${m.dotClass}`} />
                      <span className={`text-[10.5px] font-bold uppercase tracking-wider ${m.textClass}`}>
                        {m.label} · {m.description}
                      </span>
                    </div>
                    <span className={`text-[10.5px] tabular-nums ${m.textClass}`}>
                      {issues.length} issue{issues.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  {issues.map(issue => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      pending={pendingAck.has(issue.id)}
                      onAck={() => handleAck(issue.id, !!issue.acknowledged)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}

      </main>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================
function FilterPill({ active, onClick, label, count, dotClass, textClass, variant }: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  dotClass?: string;
  textClass?: string;
  variant?: 'dark';
}) {
  if (variant === 'dark') {
    return (
      <button
        onClick={onClick}
        className={`px-3 py-1.5 text-[12px] font-semibold rounded-lg ${
          active ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700'
        }`}
      >
        {label} <span className="tabular-nums opacity-75 ml-1">{count}</span>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-[12px] font-semibold rounded-lg border inline-flex items-center gap-1.5 ${
        active
          ? `${textClass} bg-zinc-50 border-zinc-300`
          : 'bg-white border-zinc-200 hover:bg-zinc-50 ' + (textClass || 'text-zinc-700')
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {label} <span className="tabular-nums opacity-75">{count}</span>
    </button>
  );
}

function IssueRow({ issue, pending, onAck }: {
  issue: DataQualityIssue;
  pending: boolean;
  onAck: () => void;
}) {
  const m = SEVERITY_META[issue.severity];
  const portfolioHref = issue.targetSubpath
    ? `/dashboard/portfolio/${issue.portfolioId}#${issue.targetSubpath}`
    : `/dashboard/portfolio/${issue.portfolioId}`;

  const actionLabel = issue.autoFixable
    ? '⚡ Compute'
    : issue.severity === 'critical'
      ? 'Fix now →'
      : issue.targetSubpath === 'tenants'
        ? 'Review tenants →'
        : issue.targetSubpath === 'assets'
          ? 'Review assets →'
          : 'Review →';

  const acked = !!issue.acknowledged;

  return (
    <div className={`px-5 py-3 border-b border-zinc-100 hover:bg-zinc-50 flex items-center gap-4 group last:border-b-0 ${acked ? 'opacity-70' : ''}`}>
      <div className={`w-1 h-10 rounded-full flex-shrink-0 ${acked ? 'bg-zinc-300' : m.bgClass}`} />

      {/* Acknowledge checkbox */}
      <label
        className="relative flex items-center justify-center w-4 h-4 cursor-pointer flex-shrink-0"
        title={acked ? 'Un-acknowledge: bring this issue back to the active view' : 'Acknowledge: hide from active view (kept for later)'}
      >
        <input
          type="checkbox"
          checked={acked}
          disabled={pending}
          onChange={onAck}
          className="peer absolute opacity-0 w-full h-full cursor-pointer"
        />
        <span className={`w-4 h-4 border-[1.5px] rounded transition-all ${
          acked ? 'bg-zinc-700 border-zinc-700' : 'bg-white border-zinc-300 peer-hover:border-zinc-500'
        } flex items-center justify-center`}>
          {pending ? (
            <span className="w-2 h-2 border-[1.5px] border-zinc-400 border-t-transparent rounded-full animate-spin" />
          ) : acked ? (
            <svg viewBox="0 0 14 14" className="w-3 h-3 text-white">
              <path d="M3 7l3 3 5-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </span>
      </label>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Link
            href={portfolioHref}
            className={`text-[13px] font-semibold hover:underline ${acked ? 'text-zinc-500 line-through decoration-zinc-300' : 'text-zinc-900 group-hover:text-[#6D7C60]'}`}
          >
            {issue.portfolioName}
          </Link>
          {issue.dealStatus && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[issue.dealStatus.toLowerCase()] || STATUS_BADGE.new}`}>
              {issue.dealStatus.charAt(0).toUpperCase() + issue.dealStatus.slice(1)}
            </span>
          )}
          {acked && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-zinc-100 text-zinc-500 border border-zinc-200">
              Acknowledged
            </span>
          )}
        </div>
        <p className={`text-[12px] ${acked ? 'text-zinc-500' : 'text-zinc-600'}`}>
          <MaybeBold text={issue.description} />
          {issue.details && (
            <span className="text-zinc-500 ml-1">{issue.details}</span>
          )}
        </p>
      </div>

      {!acked && (
        <Link href={portfolioHref} className={`px-3 py-1.5 text-[11.5px] font-semibold rounded-md flex-shrink-0 ${m.buttonClass}`}>
          {actionLabel}
        </Link>
      )}
    </div>
  );
}