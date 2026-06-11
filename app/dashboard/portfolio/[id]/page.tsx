'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { RecalcModal } from '@/components/RecalcModal';

// ============================================================================
// ASSET / TENANT COLUMNS — unchanged from original
// ============================================================================
const ASSET_COLS = [
  { key: 'city', label: 'City', on: true, editable: true, type: 'text' },
  { key: 'street', label: 'Street', on: true, editable: true, type: 'text' },
  { key: 'street_number', label: 'Street No.', on: false, editable: true, type: 'text' },
  { key: 'postal_code', label: 'ZIP', on: false, editable: true, type: 'text' },
  { key: 'state', label: 'State', on: false, editable: true, type: 'text' },
  { key: 'country', label: 'Country', on: false, editable: true, type: 'text' },
  { key: 'asset_type', label: 'Type', on: true, editable: true, type: 'text' },
  { key: 'name', label: 'Name', on: false, editable: true, type: 'text' },
  { key: 'notes', label: 'Notes', on: false, editable: true, type: 'text' },
  { key: 'purchase_price', label: 'Asking Price', on: true, editable: true, type: 'eur' },
  { key: 'price_per_sqm', label: 'Price/m²', on: false, editable: false, type: 'eur' },
  { key: 'yield_percent', label: 'Yield', on: false, editable: false, type: 'pct' },
  { key: 'annual_rent', label: 'Annual Rent', on: true, editable: true, type: 'eur' },
  { key: 'noi', label: 'NOI', on: true, editable: true, type: 'eur' },
  { key: 'noi_margin', label: 'NOI Margin', on: true, editable: true, type: 'pct' },
  { key: 'multiplier', label: 'Multiple', on: true, editable: true, type: 'multi' },
  { key: 'monthly_rent', label: 'Monthly Rent', on: false, editable: true, type: 'eur' },
  { key: 'rent_per_sqm', label: 'Rent/m²/mo', on: true, editable: false, type: 'eur' },
  { key: 'gla', label: 'GLA', on: true, editable: true, type: 'area' },
  { key: 'plot_area', label: 'Plot Area', on: true, editable: true, type: 'area' },
  { key: 'parking', label: 'Parking', on: true, editable: false, type: 'parking' },
  { key: 'parking_spaces', label: 'Parking (surface)', on: false, editable: true, type: 'num' },
  { key: 'parking_spaces_underground', label: 'Parking (underground)', on: false, editable: true, type: 'num' },
  { key: 'walt', label: 'WALT', on: true, editable: true, type: 'years' },
  { key: 'occupancy_rate', label: 'Occupancy', on: true, editable: true, type: 'pct' },
  { key: 'number_of_tenants', label: 'Tenants', on: false, editable: true, type: 'num' },
  { key: 'anchor_tenant', label: 'Anchor Tenant', on: true, editable: true, type: 'text' },
  { key: 'anchor_tenant_area', label: 'Anchor Area', on: false, editable: true, type: 'area' },
  { key: 'planned_completion', label: 'Completion', on: false, editable: true, type: 'date' },
  { key: 'building_status', label: 'Status', on: false, editable: true, type: 'text' },
  { key: 'construction_year', label: 'Built', on: true, editable: true, type: 'year' },
  { key: 'renovation_year', label: 'Renovated', on: false, editable: true, type: 'year' },
  { key: 'kki', label: 'KKI', on: false, editable: true, type: 'dec' },
  { key: 'einwohner', label: 'Einwohner', on: false, editable: true, type: 'num' },
  { key: 'zentralitaetsindex', label: 'Zentralitätsindex', on: false, editable: true, type: 'dec' },
  { key: 'kaufkraftniveau', label: 'Kaufkraftniveau', on: false, editable: true, type: 'dec' },
  { key: 'catchment_population_5min', label: 'Catchment 5min', on: false, editable: true, type: 'num' },
  { key: 'catchment_population_10min', label: 'Catchment 10min', on: false, editable: true, type: 'num' },
  { key: 'catchment_population_20min', label: 'Catchment 20min', on: false, editable: true, type: 'num' },
  { key: 'green_building_certified', label: 'Green Cert.', on: false, editable: true, type: 'bool' },
];

const TENANT_COLS = [
  { key: 'tenant_name', label: 'Tenant', on: true, editable: true, type: 'text' },
  { key: 'brand', label: 'Brand', on: false, editable: true, type: 'text' },
  { key: 'tenant_type', label: 'Type', on: false, editable: true, type: 'text' },
  { key: 'sector', label: 'Sector', on: true, editable: true, type: 'text' },
  { key: 'notes', label: 'Notes', on: false, editable: true, type: 'text' },
  { key: 'leased_area', label: 'Area', on: true, editable: true, type: 'area' },
  { key: 'annual_rent', label: 'Annual Rent', on: true, editable: true, type: 'eur' },
  { key: 'monthly_rent', label: 'Monthly Rent', on: false, editable: true, type: 'eur' },
  { key: 'rent_per_sqm', label: 'Rent/m²/mo', on: true, editable: false, type: 'eur' },
  { key: 'lease_start', label: 'Lease Start', on: false, editable: true, type: 'date' },
  { key: 'lease_start_note', label: 'Start Note', on: false, editable: true, type: 'text' },
  { key: 'lease_end', label: 'Lease End', on: true, editable: true, type: 'date' },
  { key: 'lease_end_note', label: 'End Note', on: true, editable: true, type: 'text' },
  { key: 'lease_duration_years', label: 'Duration', on: true, editable: true, type: 'years' },
  { key: 'remaining_lease_years', label: 'Remaining', on: false, editable: true, type: 'years' },
  { key: 'has_options', label: 'Has Options', on: false, editable: true, type: 'bool' },
  { key: 'option_details', label: 'Options', on: true, editable: true, type: 'text' },
  { key: 'number_of_options', label: '# Options', on: false, editable: true, type: 'num' },
  { key: 'option_duration_years', label: 'Option Duration', on: false, editable: true, type: 'years' },
  { key: 'indexation_type', label: 'Index Type', on: false, editable: true, type: 'text' },
  { key: 'indexation_details', label: 'Indexation', on: true, editable: true, type: 'text' },
  { key: 'indexation_threshold', label: 'Index Threshold', on: false, editable: true, type: 'pct' },
  { key: 'indexation_adjustment', label: 'Index Adj.', on: false, editable: true, type: 'pct' },
  { key: 'cost_allocation', label: 'Cost Allocation', on: false, editable: true, type: 'text' },
  { key: 'rent_increase_note', label: 'Rent Increase', on: false, editable: true, type: 'text' },
];

type Tab = 'overview' | 'assets' | 'tenants';

const DEAL_STATUS_OPTIONS = ['Tracking', 'Screening', 'Bidding / Negotiating', 'Exclusivity', 'Firm', 'Closed'] as const;
const INVESTMENT_TYPE_OPTIONS = ['value-add', 'core', 'core+', 'opportunistic'] as const;

// ============================================================================
// FORMATTERS
// ============================================================================
const fmt = (v: unknown, type?: string): string => {
  if (v === null || v === undefined || v === '') return '—';
  switch (type) {
    case 'eur': return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v as number);
    case 'eur_sqm': return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(v as number) + ' €/m²';
    case 'num': return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(v as number);
    case 'dec': return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(v as number);
    case 'multi': return (v as number).toFixed(2) + '×';
    case 'pct': return (v as number).toFixed(2) + '%';
    case 'area': return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(v as number) + ' m²';
    case 'years': return (v as number).toFixed(1) + ' yrs';
    case 'year': return String(v);
    case 'date': return v ? new Date(v as string).toLocaleDateString('de-DE') : '—';
    case 'bool': return v ? '✓' : '✗';
    default: return String(v);
  }
};

const fmtM = (n: number | null | undefined) => {
  if (!n) return '—';
  if (Math.abs(n) >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `€${(n / 1_000).toFixed(0)}k`;
  return `€${n.toFixed(0)}`;
};

const parseValue = (val: string, type?: string): unknown => {
  if (val === '' || val === '—') return null;
  switch (type) {
    case 'eur': case 'eur_sqm': case 'num': case 'dec': case 'multi':
    case 'pct': case 'area': case 'years': case 'year':
      return parseFloat(val.replace(/[€%×\s.a-zA-Z²/]/g, '').replace(',', '.')) || null;
    case 'bool':
      return val === 'true' || val === '1' || val === '✓';
    default:
      return val;
  }
};

// ============================================================================
// VACANT DETECTION — used everywhere so we never pick a Vacant as top tenant
// ============================================================================
const isVacant = (t: Record<string, unknown>): boolean => {
  const name = String(t.tenant_name || '').toLowerCase().trim();
  if (!name) return true;
  return /^(vacant|vacancy|leerstand|vakant|leer\s)/i.test(name) ||
         name === 'leer' || name === 'frei' || name === '-';
};

// ============================================================================
// TENANT SECTOR CLASSIFICATION (for donut)
// ============================================================================
const LEH_KEYS = ['leh','lebensmittel','food','supermarket','grocery','edeka','rewe','aldi','lidl','netto','penny','nahkauf','norma','kaufland','tegut','combi'];
const DISCOUNT_KEYS = ['discount','tedi','action','kik','woolworth','euroshop','mäc geiz','mac geiz','takko'];
const SERVICES_KEYS = ['friseur','reinigung','arzt','apotheke','pharm','services','health','dental','rossmann','dm','müller'];

function classifyTenant(t: Record<string, unknown>): 'food_retail' | 'discount' | 'services' | 'other' {
  const haystack = `${String(t.sector || '')} ${String(t.tenant_name || '')} ${String(t.brand || '')}`.toLowerCase();
  if (LEH_KEYS.some(k => haystack.includes(k))) return 'food_retail';
  if (DISCOUNT_KEYS.some(k => haystack.includes(k))) return 'discount';
  if (SERVICES_KEYS.some(k => haystack.includes(k))) return 'services';
  return 'other';
}

// ============================================================================
// COMPONENT
// ============================================================================
export default function PortfolioPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [portfolio, setPortfolio] = useState<Record<string, unknown> | null>(null);
  const [assets, setAssets] = useState<Record<string, unknown>[]>([]);
  const [tenants, setTenants] = useState<Record<string, unknown>[]>([]);
  const [comparables, setComparables] = useState<Record<string, unknown>[]>([]);
  const [forceCompareAll, setForceCompareAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [assetFilter, setAssetFilter] = useState<string>('all');
  const [assetCols, setAssetCols] = useState(ASSET_COLS.filter(c => c.on).map(c => c.key));
  const [tenantCols, setTenantCols] = useState(TENANT_COLS.filter(c => c.on).map(c => c.key));
  const [showColPicker, setShowColPicker] = useState<'assets' | 'tenants' | null>(null);
  const [editingCell, setEditingCell] = useState<{ type: 'asset' | 'tenant'; id: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [searchCol, setSearchCol] = useState('');
  const [editingPortfolioField, setEditingPortfolioField] = useState<string | null>(null);
  const [editPortfolioValue, setEditPortfolioValue] = useState('');
  const [showAllMetrics, setShowAllMetrics] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmDeletePortfolio, setConfirmDeletePortfolio] = useState(false);
  const [deletingPortfolio, setDeletingPortfolio] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [attachments, setAttachments] = useState<Array<{
    id: string;
    file_name: string;
    content_type: string | null;
    size_bytes: number | null;
    public_url: string | null;
    storage_path: string;
    attachment_role: string;
    received_at: string;
    email_subject: string | null;
    email_from: string | null;
  }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const portfolioInputRef = useRef<HTMLInputElement>(null);

  // ─── Load data ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/data?portfolioId=${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setPortfolio(d.data.portfolio);
          setAssets(d.data.assets || []);
          setTenants(d.data.tenants || []);
        }
      })
      .finally(() => setLoading(false));

    // Load attachments (don't block main page)
    fetch(`/api/portfolios/${id}/attachments`)
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.attachments)) {
          setAttachments(d.attachments);
        }
      })
      .catch(() => { /* ignore */ });
  }, [id]);

  // Load comparables — same investment_type by default, OR all if forced
  useEffect(() => {
    if (!portfolio) return;
    if (!portfolio.investment_type && !forceCompareAll) {
      setComparables([]);
      return;
    }
    fetch('/api/data?view=portfolios')
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d) ? d : (d.data || []);
        const comps = list.filter((p: Record<string, unknown>) => {
          if (p.id === id) return false;
          if (typeof p.cap_rate !== 'number' || p.cap_rate <= 0) return false;
          if (forceCompareAll) return true;
          return p.investment_type === portfolio.investment_type;
        });
        setComparables(comps);
      })
      .catch(() => {});
  }, [id, portfolio, forceCompareAll]);

  // Focus management
  useEffect(() => { if (editingCell && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editingCell]);
  useEffect(() => { if (editingPortfolioField && portfolioInputRef.current) { portfolioInputRef.current.focus(); portfolioInputRef.current.select(); } }, [editingPortfolioField]);
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowColPicker(null); setConfirmDelete(false); } };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  // ─── Derived analytics ──────────────────────────────────────────────────
  const analytics = useMemo(() => {
    if (!portfolio) return null;
    const nonVacantTenants = tenants.filter(t => !isVacant(t));
    const totalRent = (portfolio.annual_rent_income as number) ||
      nonVacantTenants.reduce((s, t) => s + ((t.annual_rent as number) || 0), 0);
    const totalGla = (portfolio.total_gla as number) ||
      assets.reduce((s, a) => s + ((a.gla as number) || 0), 0);

    const sortedTenants = [...nonVacantTenants]
      .filter(t => ((t.annual_rent as number) || 0) > 0)
      .sort((a, b) => ((b.annual_rent as number) || 0) - ((a.annual_rent as number) || 0));
    const topTenant = sortedTenants[0];
    const topTenantShare = topTenant && totalRent > 0
      ? ((topTenant.annual_rent as number) / totalRent) * 100 : 0;

    const mix: Record<string, number> = { food_retail: 0, discount: 0, services: 0, other: 0 };
    for (const t of nonVacantTenants) {
      const cat = classifyTenant(t);
      mix[cat] += (t.annual_rent as number) || 0;
    }
    const mixTotal = Object.values(mix).reduce((s, v) => s + v, 0);

    const leasedArea = tenants.reduce((s, t) => isVacant(t) ? s : s + ((t.leased_area as number) || 0), 0);
    const vacantArea = Math.max(0, totalGla - leasedArea);
    const occupancyPct = totalGla > 0 ? (leasedArea / totalGla) * 100 : (portfolio.occupancy_rate as number) || 0;

    const today = new Date();
    let shortLeaseRent = 0;
    for (const t of nonVacantTenants) {
      const rent = (t.annual_rent as number) || 0;
      if (rent <= 0) continue;
      let remaining = (t.remaining_lease_years as number) || 0;
      if (!remaining && t.lease_end) {
        remaining = (new Date(t.lease_end as string).getTime() - today.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      }
      if (remaining > 0 && remaining < 3) shortLeaseRent += rent;
    }
    const shortLeasePct = totalRent > 0 ? (shortLeaseRent / totalRent) * 100 : 0;

    const lehPct = mixTotal > 0 ? (mix.food_retail / mixTotal) * 100 : 0;
    const walt = (portfolio.walt as number) || 0;

    const myCap = (portfolio.cap_rate as number) || 0;
    const myMulti = (portfolio.multiplier as number) || 0;
    const compCaps = comparables.map(c => c.cap_rate as number).filter(v => v > 0);
    const compMultis = comparables.map(c => c.multiplier as number).filter(v => v > 0);
    const meanCap = compCaps.length ? compCaps.reduce((s,v)=>s+v,0) / compCaps.length : 0;
    const meanMulti = compMultis.length ? compMultis.reduce((s,v)=>s+v,0) / compMultis.length : 0;

    return {
      topTenant: topTenant ? String(topTenant.tenant_name) : null,
      topTenantShare,
      mix, mixTotal,
      vacantArea, occupancyPct,
      shortLeasePct,
      lehPct,
      walt,
      myCap, myMulti, meanCap, meanMulti,
      compCount: comparables.length,
      capDelta: myCap && meanCap ? (myCap - meanCap) * 100 : 0,
      multiDelta: myMulti && meanMulti ? myMulti - meanMulti : 0,
    };
  }, [portfolio, tenants, assets, comparables]);

  // ─── Persistence helpers ────────────────────────────────────────────────
  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/data?portfolioId=${id}`, { method: 'DELETE' });
      if (res.ok) router.push('/dashboard');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const savePortfolioField = async (field: string, value: unknown) => {
    setSaving('portfolio-' + field);
    try {
      const res = await fetch(`/api/portfolios/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.portfolio) setPortfolio(data.portfolio);
      }
    } finally {
      setSaving(null);
      setEditingPortfolioField(null);
    }
  };

  const startPortfolioEdit = (key: string, value: unknown) => {
    setEditingPortfolioField(key);
    setEditPortfolioValue(value === null || value === undefined ? '' : String(value));
  };

  const cancelPortfolioEdit = () => { setEditingPortfolioField(null); setEditPortfolioValue(''); };

  const startEdit = (type: 'asset' | 'tenant', recordId: string, key: string, currentValue: unknown, colType?: string) => {
    if (colType === 'bool') { saveValue(type, recordId, key, !currentValue, colType); return; }
    if (colType === 'parking') return;
    setEditingCell({ type, id: recordId, key });
    const rawValue = currentValue === null || currentValue === undefined ? '' :
      (colType === 'date' && currentValue) ? (currentValue as string).split('T')[0] : String(currentValue);
    setEditValue(rawValue);
  };

  const saveValue = async (type: 'asset' | 'tenant', recordId: string, key: string, value: unknown, colType?: string) => {
    setSaving(recordId + key);
    try {
      const table = type === 'asset' ? 'assets' : 'tenants';
      const parsedValue = colType === 'bool' ? value : parseValue(String(value), colType);
      const res = await fetch('/api/data', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, id: recordId, field: key, value: parsedValue }),
      });
      if (res.ok) {
        const updated = await res.json();
        if (type === 'asset') setAssets(assets.map(a => a.id === recordId ? { ...a, ...updated.record } : a));
        else setTenants(tenants.map(t => t.id === recordId ? { ...t, ...updated.record } : t));
      }
    } finally {
      setSaving(null);
      setEditingCell(null);
    }
  };

  const saveEdit = () => {
    if (!editingCell) return;
    const col = editingCell.type === 'asset'
      ? ASSET_COLS.find(c => c.key === editingCell.key)
      : TENANT_COLS.find(c => c.key === editingCell.key);
    saveValue(editingCell.type, editingCell.id, editingCell.key, editValue, col?.type);
  };

  const cancelEdit = () => { setEditingCell(null); setEditValue(''); };

  // ─── Cell renderer ──────────────────────────────────────────────────────
  const renderCell = (type: 'asset' | 'tenant', record: Record<string, unknown>, col: typeof ASSET_COLS[0]) => {
    const isEditing = editingCell?.type === type && editingCell?.id === record.id && editingCell?.key === col.key;
    const isSaving = saving === (record.id as string) + col.key;
    const value = record[col.key];

    if (isEditing) {
      return (
        <input
          ref={inputRef}
          type={col.type === 'date' ? 'date' : 'text'}
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') saveEdit();
            if (e.key === 'Escape') cancelEdit();
            if (e.key === 'Tab') { e.preventDefault(); saveEdit(); }
          }}
          onBlur={saveEdit}
          className="w-full px-2 py-1 text-sm border-2 border-[#6D7C60] rounded outline-none bg-white"
        />
      );
    }

    let displayValue: string;
    if (col.type === 'parking') {
      const s = record.parking_spaces as number | null;
      const u = record.parking_spaces_underground as number | null;
      if (!s && !u) displayValue = '—';
      else if (s && u) displayValue = `${s} + ${u}`;
      else displayValue = String(s || u || '—');
    } else {
      displayValue = fmt(value, col.type);
    }

    if (!col.editable) return <span className="text-zinc-500">{displayValue}</span>;

    return (
      <button
        onClick={() => startEdit(type, record.id as string, col.key, value, col.type)}
        disabled={isSaving}
        className={`w-full text-left px-2 py-1 -mx-2 -my-1 rounded transition-all
          ${isSaving ? 'opacity-50' : 'hover:bg-zinc-100 active:bg-zinc-200'}
          ${col.type === 'bool' ? 'text-center' : ''}`}
      >
        {isSaving ? <span className="animate-pulse">...</span> : displayValue}
      </button>
    );
  };

  // Column picker modal
  const ColumnPickerModal = ({ cols, selected, setSelected, onClose }: {
    cols: typeof ASSET_COLS; selected: string[];
    setSelected: (s: string[]) => void; onClose: () => void;
  }) => {
    const toggle = (key: string) => setSelected(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]);
    const filtered = cols.filter(c => c.label.toLowerCase().includes(searchCol.toLowerCase()));
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="p-4 border-b border-zinc-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-zinc-900">Select Columns</h3>
              <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded-lg"><svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <input type="text" placeholder="Search columns..." value={searchCol} onChange={e => setSearchCol(e.target.value)}
              className="w-full px-4 py-2.5 bg-zinc-100 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6D7C60]" autoFocus />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setSelected(cols.map(c => c.key))} className="px-3 py-1.5 text-sm bg-[#6D7C60]/10 text-[#6D7C60] rounded-lg hover:bg-[#6D7C60]/20 font-medium">Select All</button>
              <button onClick={() => setSelected(cols.filter(c => c.on).map(c => c.key))} className="px-3 py-1.5 text-sm bg-zinc-100 text-zinc-700 rounded-lg hover:bg-zinc-200 font-medium">Reset Default</button>
              <button onClick={() => setSelected([])} className="px-3 py-1.5 text-sm bg-zinc-100 text-zinc-700 rounded-lg hover:bg-zinc-200 font-medium">Clear All</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <div className="grid grid-cols-2 gap-1">
              {filtered.map(c => (
                <label key={c.key} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer ${selected.includes(c.key) ? 'bg-[#6D7C60]/5' : 'hover:bg-zinc-50'}`}>
                  <input type="checkbox" checked={selected.includes(c.key)} onChange={() => toggle(c.key)} className="w-4 h-4 text-[#6D7C60] rounded border-zinc-300" />
                  <span className="text-sm text-zinc-700 flex-1">{c.label}</span>
                  {!c.editable && <span className="text-xs text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded">auto</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="p-4 border-t border-zinc-200 bg-zinc-50 rounded-b-xl flex items-center justify-between">
            <span className="text-sm text-zinc-500">{selected.length} of {cols.length} columns selected</span>
            <button onClick={onClose} className="px-4 py-2 bg-[#6D7C60] text-white rounded-lg hover:bg-[#5a6950] font-medium text-sm">Done</button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Loading / not found ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#6D7C60] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!portfolio) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-zinc-800 mb-2">Portfolio not found</h1>
          <Link href="/dashboard" className="text-[#6D7C60] hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const filteredTenants = (assetFilter === 'all' ? tenants : tenants.filter(t => t.asset_id === assetFilter))
    .slice()
    .sort((a, b) => {
      const av = isVacant(a), bv = isVacant(b);
      if (av && !bv) return 1;
      if (!av && bv) return -1;
      return ((b.annual_rent as number) || 0) - ((a.annual_rent as number) || 0);
    });

  const capRate = portfolio.cap_rate as number | null;
  const multiplier = portfolio.multiplier as number | null;
  const walt = portfolio.walt as number | null;

  return (
    <div className="min-h-screen bg-zinc-50" style={{ fontFeatureSettings: "'cv11','ss01'" }}>

      {/* ═══════ DELETE MODAL ═══════ */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setConfirmDelete(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zinc-900 mb-2">Delete portfolio</h3>
            <p className="text-zinc-600 mb-6 text-sm">
              Delete <strong>{String(portfolio.name || 'this portfolio')}</strong> and its {assets.length} assets and {tenants.length} tenants? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(false)} className="px-4 py-2 text-sm text-zinc-700 bg-zinc-100 rounded-lg hover:bg-zinc-200 font-medium">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 font-medium">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showColPicker === 'assets' && <ColumnPickerModal cols={ASSET_COLS} selected={assetCols} setSelected={setAssetCols} onClose={() => { setShowColPicker(null); setSearchCol(''); }} />}
      {showColPicker === 'tenants' && <ColumnPickerModal cols={TENANT_COLS} selected={tenantCols} setSelected={setTenantCols} onClose={() => { setShowColPicker(null); setSearchCol(''); }} />}

      {/* ═══════ HEADER ═══════ */}
      <header className="bg-black text-white sticky top-0 z-40 border-b border-zinc-800">
        <div className="max-w-[1500px] mx-auto px-7 py-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm">
              <Link href="/dashboard" className="flex items-center gap-2.5 hover:opacity-80">
                <div className="w-7 h-7 bg-[#6D7C60] rounded-md grid place-items-center font-bold text-xs">R</div>
                <span className="font-semibold">RE Analyzer</span>
              </Link>
              <span className="text-zinc-500 text-xs ml-1">
                /&nbsp;<Link href="/dashboard" className="hover:text-white">Portfolios</Link>&nbsp;/&nbsp;
                <strong className="text-white font-medium">{String(portfolio.name || 'Unnamed')}</strong>
              </span>
            </div>
            <div className="flex items-center gap-1">
              {attachments.length > 0 ? (
                <button
                  onClick={() => {
                    const el = document.getElementById('attachments-section');
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded-md font-medium transition-colors inline-flex items-center gap-1.5"
                  title="Jump to the attachments list at the bottom of the page"
                >
                  📎 Attachments
                  <span className="px-1.5 py-0.5 text-[10px] font-bold tabular-nums rounded-full bg-white/10 text-white">
                    {attachments.length}
                  </span>
                </button>
              ) : portfolio.document_url ? (
                <a href={String(portfolio.document_url)} target="_blank" rel="noopener noreferrer"
                   className="px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded-md font-medium transition-colors">View PDF</a>
              ) : null}
              <Link href={`/dashboard/cashflow?ids=${id}`}
                    className="px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded-md font-medium transition-colors">Cashflow ↗</Link>
              <Link href={`/dashboard/compare?ids=${id}`}
                    className="px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded-md font-medium transition-colors">Compare</Link>
              <button onClick={() => setConfirmDelete(true)}
                      className="ml-1 p-1.5 text-zinc-400 hover:text-red-400 hover:bg-white/10 rounded-md" title="Delete portfolio">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
              <a href="/api/auth/logout" className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-md" title="Logout">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-7 py-8 pb-20">

        {/* ═══════ HERO ═══════ */}
        <div className="grid grid-cols-[1fr_auto] gap-10 pb-7 mb-8 border-b border-zinc-200">
          <div>
            {editingPortfolioField === 'name' ? (
              <input ref={portfolioInputRef} type="text" value={editPortfolioValue}
                onChange={e => setEditPortfolioValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') savePortfolioField('name', editPortfolioValue); if (e.key === 'Escape') cancelPortfolioEdit(); }}
                onBlur={() => savePortfolioField('name', editPortfolioValue)}
                className="text-4xl font-bold tracking-tight px-2 py-1 -mx-2 border-2 border-[#6D7C60] rounded-lg outline-none bg-white w-full" />
            ) : (
              <button onClick={() => startPortfolioEdit('name', portfolio.name)}
                className="text-4xl font-bold tracking-tight text-zinc-900 hover:bg-zinc-100 px-2 py-1 -mx-2 rounded-lg text-left leading-none mb-3">
                {String(portfolio.name || 'Unnamed Portfolio')}
              </button>
            )}
            <div className="flex gap-2.5 items-center flex-wrap text-[13px] text-zinc-500 mt-3">
              {portfolio.investment_type ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-50 text-cyan-700 inline-flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-cyan-700" />
                  {String(portfolio.investment_type).charAt(0).toUpperCase() + String(portfolio.investment_type).slice(1)}
                </span>
              ) : null}
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 ${
                String(portfolio.deal_status || '').toLowerCase().includes('bid') ? 'bg-amber-50 text-amber-700' :
                String(portfolio.deal_status || '').toLowerCase().includes('exclus') ? 'bg-purple-50 text-purple-700' :
                String(portfolio.deal_status || '').toLowerCase().includes('firm') ? 'bg-emerald-50 text-emerald-700' :
                String(portfolio.deal_status || '').toLowerCase().includes('clos') ? 'bg-zinc-100 text-zinc-600' :
                String(portfolio.deal_status || '').toLowerCase().includes('screen') ? 'bg-blue-50 text-blue-700' :
                'bg-zinc-100 text-zinc-600'
              }`}>
                <span className="w-1 h-1 rounded-full bg-current" />
                {String(portfolio.deal_status || 'Tracking')}
                {portfolio.bid_submitted ? ` · ${new Date(String(portfolio.bid_submitted)).toLocaleDateString('en-GB', { day:'2-digit', month:'short' })}` : ''}
              </span>
              <span className="opacity-40">·</span>
              <span><span className="tabular-nums font-medium text-zinc-700">{assets.length}</span> assets</span>
              <span className="opacity-40">·</span>
              <span><span className="tabular-nums font-medium text-zinc-700">{fmt(portfolio.total_gla, 'num')}</span> m² GLA</span>
              {assets.length > 0 ? (
                <>
                  <span className="opacity-40">·</span>
                  <span>{[...new Set(assets.map(a => a.city).filter(Boolean))].slice(0, 3).join(', ')}{[...new Set(assets.map(a => a.city).filter(Boolean))].length > 3 ? ` +${[...new Set(assets.map(a => a.city).filter(Boolean))].length - 3}` : ''}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2 items-start">
            <select value={String(portfolio.deal_status || 'Tracking')}
              onChange={async (e) => { setSaving('deal_status'); await fetch(`/api/portfolios/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ deal_status: e.target.value }) }); setPortfolio(prev => prev ? { ...prev, deal_status: e.target.value } : null); setSaving(null); }}
              disabled={saving === 'deal_status'}
              className="px-3 py-2 text-[13px] font-medium bg-white border border-zinc-300 rounded-lg hover:border-zinc-400 focus:ring-2 focus:ring-[#6D7C60]/30 cursor-pointer">
              {DEAL_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={String(portfolio.investment_type || '')}
              onChange={async (e) => { const v = e.target.value || null; setSaving('investment_type'); await fetch(`/api/portfolios/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ investment_type: v }) }); setPortfolio(prev => prev ? { ...prev, investment_type: v } : null); setSaving(null); }}
              disabled={saving === 'investment_type'}
              className="px-3 py-2 text-[13px] font-medium bg-white border border-zinc-300 rounded-lg hover:border-zinc-400 focus:ring-2 focus:ring-[#6D7C60]/30 cursor-pointer">
              <option value="">No type</option>
              {INVESTMENT_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
            <button
              onClick={() => setRecalcOpen(true)}
              className="px-3 py-2 text-[13px] font-medium bg-white border border-zinc-300 rounded-lg hover:border-zinc-400 hover:bg-zinc-50 inline-flex items-center gap-1.5"
              title="Recompute portfolio values from assets and tenants">
              ⚡ Recalc from children
            </button>
            <Link
              href={`/dashboard/data-quality?portfolio=${id}`}
              className="px-3 py-2 text-[13px] font-medium bg-white border border-zinc-300 rounded-lg hover:border-zinc-400 hover:bg-zinc-50 inline-flex items-center gap-1.5"
              title="Review data quality issues for this portfolio only">
              🔍 Data quality
            </Link>
            <Link href={`/dashboard/cashflow?ids=${id}`}
              className="px-3 py-2 text-[13px] font-medium bg-black text-white rounded-lg hover:bg-zinc-800">
              Open in Cashflow ↗
            </Link>
          </div>
        </div>

        {/* ═══════ PRIMARY KPIs ═══════ */}
        <div className="grid grid-cols-5 bg-white border border-zinc-200 rounded-xl overflow-hidden mb-8">
          <KpiCell label="Asking Price" value={fmtM(portfolio.purchase_price as number)}
            sub={portfolio.total_gla ? `${Math.round((portfolio.purchase_price as number) / (portfolio.total_gla as number)).toLocaleString('de-DE')} €/m²` : null} />
          <KpiCell label="Multiplier" value={multiplier ? `${multiplier.toFixed(2)}×` : '—'}
            sub={analytics?.multiDelta && analytics.compCount >= 1 ? {
              text: `${analytics.multiDelta > 0 ? '+' : ''}${analytics.multiDelta.toFixed(2)}× vs mean`,
              direction: analytics.multiDelta > 0 ? 'down' : 'up'
            } : null} />
          <KpiCell label="Cap Rate" value={capRate ? `${capRate.toFixed(2)}%` : '—'}
            sub={analytics?.capDelta && analytics.compCount >= 1 ? {
              text: `${analytics.capDelta > 0 ? '+' : ''}${analytics.capDelta.toFixed(0)} bps vs mean`,
              direction: analytics.capDelta > 0 ? 'up' : 'down'
            } : null} />
          <KpiCell label="WALT" value={walt ? `${walt.toFixed(1)} yrs` : '—'}
            sub={analytics && analytics.shortLeasePct > 0 ? {
              text: `${analytics.shortLeasePct.toFixed(0)}% expires < 3y`,
              direction: analytics.shortLeasePct > 30 ? 'warn' : 'neutral'
            } : null} />
          <KpiCell label="Occupancy" value={analytics ? `${analytics.occupancyPct.toFixed(1)}%` : '—'}
            sub={analytics && analytics.vacantArea > 0 ? {
              text: `${analytics.vacantArea.toLocaleString('de-DE', {maximumFractionDigits:0})} m² vacant`,
              direction: 'neutral'
            } : null}
            isLast />
        </div>

        {/* ═══════ ANALYTICS ROW ═══════ */}
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-4 mb-8">
          <Panel title="Cap Rate vs Comparables"
                 sub={
                   !portfolio.investment_type && !forceCompareAll
                     ? 'No investment type'
                     : forceCompareAll
                       ? `All deals (n=${comparables.length})`
                       : `${String(portfolio.investment_type)} (n=${comparables.length})`
                 }>
            <CompareChart analytics={analytics} comparables={comparables}
                          myCap={capRate}
                          hasInvestmentType={!!portfolio.investment_type}
                          forceCompareAll={forceCompareAll}
                          onForceCompareAll={() => setForceCompareAll(true)}
                          onResetForce={() => setForceCompareAll(false)} />
          </Panel>

          <Panel title="Tenant Mix by Rent"
                 sub={analytics ? `${fmtM(analytics.mixTotal)} annual` : ''}>
            <TenantMixDonut analytics={analytics} />
          </Panel>

          <Panel title="Risk Signals" sub="Quick health check">
            <RiskSignals analytics={analytics} />
          </Panel>
        </div>

        {/* ═══════ INVESTMENT THESIS ═══════ */}
        <div className="bg-white border border-zinc-200 rounded-xl p-6 mb-8 grid grid-cols-[200px_1fr] gap-8">
          <div>
            <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Investment Thesis</div>
            <div className="text-[11px] text-zinc-400 mt-1.5">Notes &amp; deal context</div>
            {!editingPortfolioField && (
              <button onClick={() => startPortfolioEdit('notes', portfolio.notes || '')}
                className="text-[11px] text-[#6D7C60] hover:underline mt-3">✎ Edit notes</button>
            )}
          </div>
          <div className="text-[14px] leading-relaxed text-zinc-800">
            {editingPortfolioField === 'notes' ? (
              <textarea
                value={editPortfolioValue}
                onChange={e => setEditPortfolioValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') cancelPortfolioEdit(); }}
                onBlur={() => savePortfolioField('notes', editPortfolioValue)}
                rows={5} autoFocus
                placeholder="Add deal context, thesis, risks, broker notes..."
                className="w-full px-3 py-2 border-2 border-[#6D7C60] rounded-lg outline-none resize-none"
              />
            ) : portfolio.notes ? (
              <div className="whitespace-pre-wrap">{String(portfolio.notes)}</div>
            ) : (
              <button onClick={() => startPortfolioEdit('notes', '')}
                className="text-zinc-400 italic hover:text-zinc-600 text-left">
                + Add investment thesis, risks, and deal context...
              </button>
            )}
          </div>
        </div>

        {/* ═══════ SECONDARY METRICS ═══════ */}
        <div className="flex items-center justify-between mb-3.5">
          <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">All Metrics</div>
          <button onClick={() => setShowAllMetrics(!showAllMetrics)}
            className="text-[11px] text-zinc-500 hover:text-zinc-800">
            {showAllMetrics ? 'Show essentials' : `Show all (${SECONDARY_METRICS.length})`}
          </button>
        </div>
        <SecondaryMetricsGrid portfolio={portfolio} analytics={analytics} showAll={showAllMetrics}
          startEdit={startPortfolioEdit} editingField={editingPortfolioField}
          editValue={editPortfolioValue} setEditValue={setEditPortfolioValue}
          saveEdit={savePortfolioField} cancelEdit={cancelPortfolioEdit}
          inputRef={portfolioInputRef} saving={saving} />

        {/* ═══════ CONTACTS ═══════ */}
        <div className="grid grid-cols-3 gap-4 mb-8 mt-8">
          <ContactCard title="Email Contact"
            name={portfolio.email_contact_name} company={portfolio.email_contact_company}
            email={portfolio.email_contact_email} phone={portfolio.email_contact_phone} />
          <ContactCard title="Document Contact"
            name={portfolio.doc_contact_name} role={portfolio.doc_contact_role}
            company={portfolio.doc_contact_company}
            email={portfolio.doc_contact_email} phone={portfolio.doc_contact_phone} />
          <div className="bg-white border border-zinc-200 rounded-xl p-5">
            <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">Activity</h4>
            <div className="text-sm font-semibold text-zinc-900">Last updated</div>
            <div className="text-xs text-zinc-500 mb-3">{new Date(String(portfolio.updated_at || portfolio.created_at || Date.now())).toLocaleString('en-GB')}</div>
            <Link href={`/dashboard/cashflow?ids=${id}`} className="text-xs text-[#6D7C60] hover:underline">Run cashflow simulation →</Link>
          </div>
        </div>

        {/* ═══════ TABS ═══════ */}
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="flex border-b border-zinc-200 px-5 bg-zinc-50/60">
            {([
              { key: 'overview', label: 'Top tenants' },
              { key: 'assets', label: `Assets (${assets.length})` },
              { key: 'tenants', label: `Tenants (${tenants.length})` },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-3.5 text-[13px] font-medium border-b-2 transition-colors -mb-px ${
                  tab === t.key ? 'text-zinc-900 border-zinc-900' : 'text-zinc-500 border-transparent hover:text-zinc-700'
                }`}>{t.label}</button>
            ))}
            <div className="flex-1" />
            {tab === 'assets' && (
              <button onClick={() => setShowColPicker('assets')}
                className="my-2 px-3 py-1.5 text-xs font-medium bg-white border border-zinc-300 rounded-md hover:border-zinc-400">
                Columns ({assetCols.length}/{ASSET_COLS.length})
              </button>
            )}
            {tab === 'tenants' && (
              <div className="flex gap-2 items-center">
                <select value={assetFilter} onChange={e => setAssetFilter(e.target.value)}
                  className="my-2 px-3 py-1.5 text-xs bg-white border border-zinc-300 rounded-md hover:border-zinc-400 font-medium">
                  <option value="all">All assets ({tenants.length})</option>
                  {assets.map(a => (
                    <option key={String(a.id)} value={String(a.id)}>
                      {String(a.city || 'Unknown')} ({tenants.filter(t => t.asset_id === a.id).length})
                    </option>
                  ))}
                </select>
                <button onClick={() => setShowColPicker('tenants')}
                  className="my-2 px-3 py-1.5 text-xs font-medium bg-white border border-zinc-300 rounded-md hover:border-zinc-400">
                  Columns ({tenantCols.length}/{TENANT_COLS.length})
                </button>
              </div>
            )}
          </div>

          {tab === 'overview' && (
            <div className="grid grid-cols-2 divide-x divide-zinc-200">
              <div className="p-5">
                <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">Top 5 Tenants by Rent</h4>
                <div className="divide-y divide-zinc-100">
                  {filteredTenants.filter(t => !isVacant(t)).slice(0, 5).map((t, i) => (
                    <div key={String(t.id)} className="py-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-[#6D7C60]/10 text-[#6D7C60] text-[10px] font-bold grid place-items-center flex-shrink-0">{i + 1}</span>
                        <span className="font-medium text-zinc-900 truncate">{String(t.tenant_name)}</span>
                      </div>
                      <span className="text-sm text-zinc-600 tabular-nums flex-shrink-0">{fmt(t.annual_rent, 'eur')}</span>
                    </div>
                  ))}
                  {filteredTenants.filter(t => !isVacant(t)).length === 0 && (
                    <div className="py-6 text-center text-sm text-zinc-400">No tenants yet</div>
                  )}
                </div>
              </div>
              <div className="p-5">
                <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">Top 5 Assets by Rent</h4>
                <div className="divide-y divide-zinc-100">
                  {[...assets].sort((a, b) => ((b.annual_rent as number) || 0) - ((a.annual_rent as number) || 0)).slice(0, 5).map(a => (
                    <div key={String(a.id)} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-zinc-900 truncate">{String(a.city || 'Unknown')}</div>
                        {a.street ? <div className="text-xs text-zinc-500 truncate">{String(a.street)}</div> : null}
                      </div>
                      <div className="text-sm text-zinc-600 tabular-nums flex-shrink-0">{fmt(a.annual_rent, 'eur')}</div>
                    </div>
                  ))}
                  {assets.length === 0 && (
                    <div className="py-6 text-center text-sm text-zinc-400">No assets yet</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'assets' && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-zinc-50">
                    {ASSET_COLS.filter(c => assetCols.includes(c.key)).map(c => (
                      <th key={c.key} className="px-4 py-2.5 text-left text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap border-b border-zinc-200">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {assets.map(a => (
                    <tr key={String(a.id)} className="hover:bg-zinc-50">
                      {ASSET_COLS.filter(c => assetCols.includes(c.key)).map(c => (
                        <td key={c.key} className="px-4 py-2.5 text-[13px] text-zinc-900 whitespace-nowrap">{renderCell('asset', a, c)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {assets.length === 0 && <div className="py-12 text-center text-zinc-500">No assets found</div>}
            </div>
          )}

          {tab === 'tenants' && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-zinc-50">
                    {TENANT_COLS.filter(c => tenantCols.includes(c.key)).map(c => (
                      <th key={c.key} className="px-4 py-2.5 text-left text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap border-b border-zinc-200">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredTenants.map(t => {
                    const vac = isVacant(t);
                    return (
                      <tr key={String(t.id)} className={`hover:bg-zinc-50 ${vac ? 'bg-amber-50/40' : ''}`}>
                        {TENANT_COLS.filter(c => tenantCols.includes(c.key)).map(c => (
                          <td key={c.key} className={`px-4 py-2.5 text-[13px] whitespace-nowrap ${vac && c.key === 'tenant_name' ? 'text-amber-700 italic' : 'text-zinc-900'}`}>
                            {c.key === 'tenant_name' && vac ? (
                              <span className="inline-flex items-center gap-2">
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 rounded">VACANT</span>
                                {String(t.tenant_name || 'Vacant')}
                              </span>
                            ) : renderCell('tenant', t, c)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredTenants.length === 0 && <div className="py-12 text-center text-zinc-500">No tenants found</div>}
            </div>
          )}
        </div>

        {/* ═══════ ATTACHMENTS ═══════ */}
        {attachments.length > 0 && (
          <div id="attachments-section" className="mt-12 pt-6 border-t border-zinc-100 scroll-mt-20">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <h3 className="text-[13px] font-bold text-zinc-900 tracking-tight">
                  Attachments
                  <span className="ml-2 text-[10.5px] font-medium text-zinc-400 tabular-nums">({attachments.length})</span>
                </h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">Files received with the original email — PDF, Excel, documents, images.</p>
              </div>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-zinc-50/60">
                  <tr className="border-b border-zinc-200">
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">File</th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Type</th>
                    <th className="px-4 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Size</th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Received</th>
                    <th className="px-4 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {attachments.map(a => (
                    <AttachmentRow key={a.id} att={a} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══════ DANGER ZONE — Archive / Delete ═══════ */}
        <div className="mt-16 pt-6 border-t border-zinc-100">
          <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-[0.7px] mb-3">
            Portfolio actions
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {portfolio.archived_at ? (
              <button
                onClick={async () => {
                  setArchiving(true);
                  await fetch(`/api/portfolios/${id}/unarchive`, { method: 'POST' });
                  router.push('/dashboard');
                }}
                disabled={archiving}
                className="px-3 py-1.5 text-[11.5px] font-medium bg-white border border-zinc-200 rounded-md hover:bg-zinc-50 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {archiving ? '...' : '↩'} Unarchive portfolio
              </button>
            ) : (
              <button
                onClick={async () => {
                  setArchiving(true);
                  await fetch(`/api/portfolios/${id}/archive`, { method: 'POST' });
                  router.push('/dashboard');
                }}
                disabled={archiving}
                className="px-3 py-1.5 text-[11.5px] font-medium bg-white border border-zinc-200 rounded-md hover:bg-zinc-50 hover:text-zinc-900 text-zinc-600 disabled:opacity-50 inline-flex items-center gap-1.5"
                title="Hide this portfolio from the dashboard. It can be restored later from 'Show archived' at the bottom of the dashboard."
              >
                {archiving ? '...' : '📦'} Archive portfolio
              </button>
            )}
            <button
              onClick={() => setConfirmDeletePortfolio(true)}
              className="px-3 py-1.5 text-[11.5px] font-medium bg-white border border-zinc-200 hover:border-red-300 hover:bg-red-50 hover:text-red-700 text-zinc-500 rounded-md inline-flex items-center gap-1.5"
              title="Permanently delete this portfolio along with all its assets and tenants. Irreversible."
            >
              🗑 Delete portfolio…
            </button>
            <p className="text-[10.5px] text-zinc-400 ml-2">
              Archive hides from the dashboard but keeps data · Delete is permanent
            </p>
          </div>
        </div>
      </main>

      {recalcOpen && (
        <RecalcModal
          portfolioId={String(id)}
          onClose={() => setRecalcOpen(false)}
          onCommitted={() => {
            setRecalcOpen(false);
            window.location.reload();
          }}
        />
      )}

      {/* ═══════ DELETE CONFIRM MODAL ═══════ */}
      {confirmDeletePortfolio && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4"
             onClick={() => !deletingPortfolio && setConfirmDeletePortfolio(false)}
             style={{ fontFeatureSettings: "'cv11','ss01'" }}>
          <div onClick={e => e.stopPropagation()}
               className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-5 border-b border-zinc-200">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-red-50 text-red-600 grid place-items-center rounded-lg flex-shrink-0 text-lg">⚠</div>
                <div>
                  <h2 className="text-[15px] font-bold tracking-tight text-zinc-900">
                    Delete this portfolio?
                  </h2>
                  <p className="text-[12px] text-zinc-500 mt-1 leading-relaxed">
                    This will permanently delete <strong className="text-zinc-700">{String(portfolio.name || 'this portfolio')}</strong>{' '}
                    along with <strong className="text-zinc-700">{assets.length} asset{assets.length === 1 ? '' : 's'}</strong>{' '}
                    and <strong className="text-zinc-700">{tenants.length} tenant{tenants.length === 1 ? '' : 's'}</strong>.
                    This cannot be undone.
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-3">
                    If you only want to hide it, use <strong>Archive</strong> instead.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-zinc-50/60">
              <label className="text-[11px] font-semibold text-zinc-600 block mb-1.5">
                Type <span className="font-mono text-red-700">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                autoFocus
                disabled={deletingPortfolio}
                placeholder="DELETE"
                className="w-full px-3 py-2 text-[13px] font-mono bg-white border border-zinc-300 rounded-md focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-400/20"
              />
            </div>

            <div className="px-6 py-4 border-t border-zinc-200 flex items-center justify-end gap-2 bg-white">
              <button
                onClick={() => { setConfirmDeletePortfolio(false); setDeleteConfirmText(''); }}
                disabled={deletingPortfolio}
                className="px-4 py-2 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-100 rounded-md disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (deleteConfirmText !== 'DELETE') return;
                  setDeletingPortfolio(true);
                  await fetch(`/api/data?portfolioId=${id}`, { method: 'DELETE' });
                  router.push('/dashboard');
                }}
                disabled={deleteConfirmText !== 'DELETE' || deletingPortfolio}
                className="px-4 py-2 text-[12px] font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {deletingPortfolio && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {deletingPortfolio ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================
function KpiCell({ label, value, sub, isLast }: {
  label: string; value: string;
  sub?: string | { text: string; direction: 'up' | 'down' | 'neutral' | 'warn' } | null;
  isLast?: boolean;
}) {
  const subColor = typeof sub === 'object' && sub ? {
    up: 'text-emerald-600', down: 'text-red-600', warn: 'text-amber-600', neutral: 'text-zinc-500'
  }[sub.direction] : 'text-zinc-500';
  const subText = typeof sub === 'object' && sub ? sub.text : sub;
  return (
    <div className={`px-6 py-5 ${isLast ? '' : 'border-r border-zinc-200'} flex flex-col gap-1`}>
      <div className="text-[10.5px] text-zinc-500 font-semibold uppercase tracking-[0.7px]">{label}</div>
      <div className="text-[26px] font-bold tracking-tight text-zinc-900 mt-1 tabular-nums">{value}</div>
      {subText ? <div className={`text-[11px] mt-0.5 ${subColor} font-medium`}>{subText}</div> : null}
    </div>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5">
      <div className="flex justify-between items-baseline mb-4">
        <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-[0.6px]">{title}</span>
        {sub ? <span className="text-[11px] text-zinc-400">{sub}</span> : null}
      </div>
      {children}
    </div>
  );
}

function CompareChart({ analytics, comparables, myCap, hasInvestmentType, forceCompareAll, onForceCompareAll, onResetForce }: {
  analytics: ReturnType<typeof Object> | null;
  comparables: Record<string, unknown>[];
  myCap: number | null;
  hasInvestmentType: boolean;
  forceCompareAll: boolean;
  onForceCompareAll: () => void;
  onResetForce: () => void;
}) {
  const a = analytics as { meanCap: number; meanMulti: number; capDelta: number; compCount: number } | null;

  if (!hasInvestmentType && !forceCompareAll) {
    return (
      <div className="h-[154px] flex flex-col items-center justify-center text-center px-4 gap-2">
        <div className="text-[28px] text-zinc-300">🏷️</div>
        <div className="text-xs text-zinc-600 font-medium">Please select an investment type</div>
        <div className="text-[10.5px] text-zinc-400 max-w-[240px]">
          Use the dropdown above to set core, value-add, etc. — then we&apos;ll benchmark against similar deals.
        </div>
        <button onClick={onForceCompareAll}
          className="text-[10.5px] text-[#6D7C60] hover:underline mt-1">
          Or compare against all deals →
        </button>
      </div>
    );
  }

  const hasEnough = a && a.compCount >= 1;
  if (!hasEnough) {
    return (
      <div className="h-[154px] flex flex-col items-center justify-center text-center px-4 gap-2">
        <div className="text-[28px] text-zinc-300">📊</div>
        <div className="text-xs text-zinc-500">No comparable deals yet</div>
        <div className="text-[10.5px] text-zinc-400 max-w-[220px]">
          {forceCompareAll
            ? 'No other deals in your database have a cap rate set.'
            : 'No other deals of this investment type yet.'}
        </div>
        {forceCompareAll ? (
          <button onClick={onResetForce} className="text-[10.5px] text-[#6D7C60] hover:underline mt-1">← Back to type-only</button>
        ) : (
          <button onClick={onForceCompareAll} className="text-[10.5px] text-[#6D7C60] hover:underline mt-1">Or compare against all deals →</button>
        )}
      </div>
    );
  }

  const caps = comparables.map(c => c.cap_rate as number).filter(v => v > 0);
  const minCap = Math.min(...caps, myCap || 99) - 0.3;
  const maxCap = Math.max(...caps, myCap || 0) + 0.3;
  const range = maxCap - minCap || 1;
  const x = (i: number, total: number) => 30 + (i / Math.max(total - 1, 1)) * 420;
  const y = (cap: number) => 110 - ((cap - minCap) / range) * 90;

  const myY = myCap ? y(myCap) : 0;
  const meanY = y(a!.meanCap);

  return (
    <div>
      <svg viewBox="0 0 500 130" preserveAspectRatio="none" className="w-full h-[130px]">
        <line x1="0" y1="20" x2="500" y2="20" stroke="#f4f4f5" strokeWidth="1"/>
        <line x1="0" y1="65" x2="500" y2="65" stroke="#f4f4f5" strokeWidth="1"/>
        <line x1="0" y1="110" x2="500" y2="110" stroke="#f4f4f5" strokeWidth="1"/>
        <line x1="0" y1={meanY} x2="500" y2={meanY} stroke="#a1a1aa" strokeWidth="1.5" strokeDasharray="3 3"/>
        <text x="496" y={meanY - 4} fontSize="9" fill="#71717a" textAnchor="end">mean {a!.meanCap.toFixed(2)}%</text>
        {comparables.map((c, i) => {
          const cap = c.cap_rate as number;
          if (!cap) return null;
          return <circle key={String(c.id)} cx={x(i, comparables.length)} cy={y(cap)} r="3.5" fill="#d4d4d8" />;
        })}
        {myCap && (
          <>
            <circle cx="475" cy={myY} r="6.5" fill="#6D7C60" stroke="white" strokeWidth="2.5"/>
            <text x="475" y={myY - 12} fontSize="10" fontWeight="600" fill="#6D7C60" textAnchor="middle">{myCap.toFixed(2)}%</text>
          </>
        )}
      </svg>
      <div className="flex justify-between text-[10.5px] text-zinc-500 mt-2">
        <span>n = {a!.compCount} deal{a!.compCount === 1 ? '' : 's'}{forceCompareAll ? ' · all types' : ''}</span>
        <span>Mean: <strong className="text-zinc-800 tabular-nums">{a!.meanCap.toFixed(2)}%</strong></span>
        <span>This: <strong className="text-[#6D7C60] tabular-nums">{myCap?.toFixed(2)}%</strong></span>
      </div>
    </div>
  );
}

function TenantMixDonut({ analytics }: { analytics: ReturnType<typeof Object> | null }) {
  const a = analytics as { mix: Record<string, number>; mixTotal: number } | null;
  if (!a || a.mixTotal === 0) {
    return (
      <div className="h-[154px] flex flex-col items-center justify-center text-center px-4 gap-2">
        <div className="text-[28px] text-zinc-300">🥧</div>
        <div className="text-xs text-zinc-500">No tenant data yet</div>
      </div>
    );
  }

  const segments = [
    { key: 'food_retail', label: 'Food retail (LEH)', color: '#6D7C60', val: a.mix.food_retail },
    { key: 'discount',    label: 'Discount',          color: '#9CA88B', val: a.mix.discount },
    { key: 'services',    label: 'Services & Health', color: '#C4D0B5', val: a.mix.services },
    { key: 'other',       label: 'Other',             color: '#e4e4e7', val: a.mix.other },
  ];

  let offset = 25;
  const renderedSegments = segments.map(s => {
    const pct = (s.val / a.mixTotal) * 100;
    if (pct <= 0) return null;
    const seg = (
      <circle key={s.key} cx="21" cy="21" r="15.91" fill="transparent"
        stroke={s.color} strokeWidth="6.5"
        strokeDasharray={`${pct} ${100 - pct}`}
        strokeDashoffset={offset} />
    );
    offset -= pct;
    return seg;
  });

  return (
    <div className="flex items-center gap-5 h-[154px]">
      <div className="aspect-square h-full flex-shrink-0">
        <svg viewBox="0 0 42 42" className="w-full h-full -rotate-90">
          <circle cx="21" cy="21" r="15.91" fill="white" />
          {renderedSegments}
        </svg>
      </div>
      <div className="flex-1 flex flex-col gap-2 text-[12px] min-w-0">
        <div className="mb-1">
          <div className="text-[10.5px] text-zinc-500 font-medium">Annual rent</div>
          <div className="text-[18px] font-bold text-zinc-900 tabular-nums tracking-tight leading-tight">
            {a.mixTotal >= 1_000_000 ? `€${(a.mixTotal / 1_000_000).toFixed(2)}M` : `€${(a.mixTotal / 1_000).toFixed(0)}k`}
          </div>
        </div>
        {segments.map(s => {
          const pct = (s.val / a.mixTotal) * 100;
          if (pct < 0.5) return null;
          return (
            <div key={s.key} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: s.color }} />
              <span className="flex-1 text-zinc-700 truncate text-[11.5px]">{s.label}</span>
              <span className="text-zinc-900 font-semibold tabular-nums text-[12px]">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RiskSignals({ analytics }: { analytics: ReturnType<typeof Object> | null }) {
  const a = analytics as {
    occupancyPct: number; topTenantShare: number; topTenant: string | null;
    shortLeasePct: number; walt: number; lehPct: number;
  } | null;
  if (!a) return <div className="text-xs text-zinc-400">No data yet</div>;

  const bars = [
    { name: 'Occupancy', val: a.occupancyPct, max: 100, fmt: (v:number) => `${v.toFixed(1)}%`, warnLow: 85 },
    { name: 'Top tenant share', val: a.topTenantShare, max: 100, fmt: (v:number) => `${v.toFixed(1)}%`, warnHigh: 40, sub: a.topTenant || '—' },
    { name: 'Leases < 3y', val: a.shortLeasePct, max: 100, fmt: (v:number) => `${v.toFixed(0)}%`, warnHigh: 30 },
    { name: 'Avg WALT', val: a.walt, max: 10, fmt: (v:number) => `${v.toFixed(1)} y`, warnLow: 4 },
    { name: 'LEH share', val: a.lehPct, max: 100, fmt: (v:number) => `${v.toFixed(0)}%` },
  ];

  return (
    <div className="flex flex-col gap-3">
      {bars.map(b => {
        const warn =
          (b.warnHigh !== undefined && b.val > b.warnHigh) ||
          (b.warnLow !== undefined && b.val > 0 && b.val < b.warnLow);
        const widthPct = Math.min(100, (b.val / b.max) * 100);
        return (
          <div key={b.name} className="flex flex-col gap-1.5">
            <div className="flex justify-between items-baseline text-[12px]">
              <span className="text-zinc-700">{b.name}{b.sub ? <span className="text-zinc-400 ml-1.5 text-[10.5px]">· {b.sub}</span> : ''}</span>
              <span className={`tabular-nums font-bold text-[13px] ${warn ? 'text-amber-600' : 'text-zinc-900'}`}>{b.fmt(b.val)}</span>
            </div>
            <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${warn ? 'bg-amber-500' : 'bg-[#6D7C60]'}`} style={{ width: `${widthPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ESSENTIAL_METRICS = [
  { key: 'spot', label: 'Spot Value', type: 'eur', editable: true },
  { key: 'noi', label: 'NOI', type: 'eur', editable: true },
  { key: 'annual_rent_income', label: 'Annual Rent', type: 'eur', editable: true },
  { key: 'ltv', label: 'LTV', type: 'pct', editable: true },
  { key: 'equity_on_spot', label: 'Equity on Spot', type: 'eur', editable: false },
  { key: 'price_per_sqm', label: 'Price / m²', type: 'eur_sqm', editable: false },
];
const SECONDARY_METRICS = [
  ...ESSENTIAL_METRICS,
  { key: 'rent_per_sqm', label: 'Rent / m² (mo.)', type: 'eur', editable: false },
  { key: 'total_plot_area', label: 'Plot area', type: 'area', editable: false },
  { key: 'total_parking_spaces', label: 'Parking', type: 'num', editable: false },
  { key: 'noi_margin', label: 'NOI margin %', type: 'pct', editable: true },
  { key: 'top_tenant', label: 'Top tenant', type: 'text', editable: false },
  { key: 'leh_percentage', label: 'LEH share', type: 'pct', editable: false },
];

function SecondaryMetricsGrid({ portfolio, analytics, showAll, startEdit, editingField, editValue, setEditValue, saveEdit, cancelEdit, inputRef, saving }: {
  portfolio: Record<string, unknown>;
  analytics: ReturnType<typeof Object> | null;
  showAll: boolean;
  startEdit: (key: string, value: unknown) => void;
  editingField: string | null;
  editValue: string;
  setEditValue: (v: string) => void;
  saveEdit: (key: string, value: unknown) => Promise<void>;
  cancelEdit: () => void;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  saving: string | null;
}) {
  const list = showAll ? SECONDARY_METRICS : ESSENTIAL_METRICS;
  return (
    <div className="grid grid-cols-6 gap-px bg-zinc-200 border border-zinc-200 rounded-xl overflow-hidden mb-8">
      {list.map(m => {
        let v: unknown = portfolio[m.key];
        if (m.key === 'top_tenant' && analytics) {
          const a = analytics as { topTenant: string | null; topTenantShare: number };
          v = a.topTenant;
        }
        const isEditing = editingField === m.key;
        const isSaving = saving === 'portfolio-' + m.key;
        return (
          <div key={m.key} className="bg-white px-4 py-3.5 flex flex-col gap-1">
            <div className="text-[10.5px] text-zinc-500 font-medium">{m.label}</div>
            {isEditing ? (
              <input ref={inputRef} type="text" value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveEdit(m.key, parseValue(editValue, m.type));
                  if (e.key === 'Escape') cancelEdit();
                }}
                onBlur={() => saveEdit(m.key, parseValue(editValue, m.type))}
                className="text-[15px] font-semibold px-1 py-0.5 -mx-1 border-2 border-[#6D7C60] rounded outline-none" />
            ) : m.editable ? (
              <button onClick={() => startEdit(m.key, v)} disabled={isSaving}
                className="text-[15px] font-semibold text-zinc-900 tabular-nums tracking-tight hover:bg-zinc-50 -mx-1 px-1 py-0.5 rounded text-left">
                {isSaving ? <span className="animate-pulse">...</span> : fmt(v, m.type)}
              </button>
            ) : (
              <div className="text-[15px] font-semibold text-zinc-900 tabular-nums tracking-tight">{fmt(v, m.type)}</div>
            )}
            {m.key === 'top_tenant' && analytics ? (
              <div className="text-[10.5px] text-zinc-500 tabular-nums">{((analytics as { topTenantShare: number }).topTenantShare).toFixed(1)}% of rent</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ContactCard({ title, name, company, email, phone, role }: {
  title: string;
  name?: unknown; company?: unknown; email?: unknown; phone?: unknown; role?: unknown;
}) {
  const hasAny = name || email || phone || company;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5">
      <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">{title}</h4>
      {hasAny ? (
        <>
          {name ? (
            <div className="font-semibold text-[14px] text-zinc-900 mb-0.5">
              {String(name)}
              {role ? <span className="ml-2 px-1.5 py-0.5 text-[10.5px] bg-zinc-100 text-zinc-600 rounded font-medium">{String(role)}</span> : null}
            </div>
          ) : null}
          {company ? <div className="text-[12px] text-zinc-500 mb-2">{String(company)}</div> : null}
          {email ? <a href={`mailto:${email}`} className="text-[12px] text-[#6D7C60] hover:underline block">{String(email)}</a> : null}
          {phone ? <div className="text-[12px] text-zinc-700 font-mono mt-0.5">{String(phone)}</div> : null}
        </>
      ) : (
        <div className="text-[12px] text-zinc-400 italic">No contact info</div>
      )}
    </div>
  );
}

// ─── Attachment row sub-component ───────────────────────────────────────────
function AttachmentRow({ att }: {
  att: {
    id: string;
    file_name: string;
    content_type: string | null;
    size_bytes: number | null;
    public_url: string | null;
    attachment_role: string;
    received_at: string;
    email_subject: string | null;
    email_from: string | null;
  };
}) {
  // File icon based on content type / extension
  const fileExtension = att.file_name.split('.').pop()?.toLowerCase() || '';
  const icon = (() => {
    if (att.content_type?.includes('pdf') || fileExtension === 'pdf') return '📄';
    if (['xlsx', 'xls', 'xlsm', 'xlsb', 'csv'].includes(fileExtension)) return '📊';
    if (['doc', 'docx'].includes(fileExtension)) return '📝';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fileExtension)) return '🖼️';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(fileExtension)) return '🗜️';
    if (['ppt', 'pptx'].includes(fileExtension)) return '📑';
    return '📎';
  })();

  const typeLabel = (() => {
    if (fileExtension === 'pdf') return 'PDF';
    if (['xlsx', 'xls', 'xlsm', 'xlsb'].includes(fileExtension)) return 'Excel';
    if (fileExtension === 'csv') return 'CSV';
    if (['doc', 'docx'].includes(fileExtension)) return 'Word';
    if (['ppt', 'pptx'].includes(fileExtension)) return 'PowerPoint';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(fileExtension)) return 'Image';
    if (['zip', 'rar', '7z'].includes(fileExtension)) return 'Archive';
    return fileExtension.toUpperCase() || 'File';
  })();

  const sizeStr = (() => {
    if (!att.size_bytes) return '—';
    const b = att.size_bytes;
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${b} B`;
  })();

  const receivedDate = new Date(att.received_at);
  const dateStr = receivedDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  const timeStr = receivedDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <tr className="hover:bg-zinc-50/60">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base flex-shrink-0">{icon}</span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-zinc-900 truncate">{att.file_name}</div>
            {att.attachment_role === 'primary' && (
              <span className="text-[9.5px] font-bold tracking-wider text-[#6D7C60] uppercase">Primary</span>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <span className="text-[10.5px] font-medium text-zinc-600 bg-zinc-100 px-1.5 py-0.5 rounded">{typeLabel}</span>
      </td>
      <td className="px-4 py-2.5 text-right text-[11.5px] tabular-nums text-zinc-600">{sizeStr}</td>
      <td className="px-4 py-2.5 text-[11px] text-zinc-500" title={att.email_subject || ''}>
        {dateStr} <span className="text-zinc-300">·</span> {timeStr}
      </td>
      <td className="px-4 py-2.5 text-right">
        {att.public_url ? (
          <div className="inline-flex items-center gap-1">
            <a href={att.public_url} target="_blank" rel="noopener noreferrer"
               className="px-2 py-1 text-[10.5px] font-medium bg-white border border-zinc-200 rounded hover:bg-zinc-50 text-zinc-700">
              View
            </a>
            <a href={att.public_url} download={att.file_name}
               className="px-2 py-1 text-[10.5px] font-medium bg-white border border-zinc-200 rounded hover:bg-zinc-50 text-zinc-700">
              ↓ Download
            </a>
          </div>
        ) : (
          <span className="text-[10.5px] text-zinc-400 italic">No URL</span>
        )}
      </td>
    </tr>
  );
}