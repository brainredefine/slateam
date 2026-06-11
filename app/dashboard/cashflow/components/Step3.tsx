'use client';

import { useState, useRef, useEffect } from 'react';

const fmtK = (val: any) => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return '—';
  return '€' + (num / 1_000).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + 'k';
};

const fmtM = (val: any) => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return '—';
  return '€' + (num / 1_000_000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'M';
};

const fmt = (val: any, suffix = '') => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(num) ? '—' : num.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + suffix;
};

// ============================================================================
// VIEW PRESETS (Chantier 3)
// ============================================================================
type ViewMode = 'full' | 'summary' | 'investor' | 'custom';

const ALL_ROWS = [
  { key: 'acq_price', label: 'Acquisition Price', group: 'Acquisition' },
  { key: 'acq_costs', label: 'Acquisition Costs', group: 'Acquisition' },
  { key: 'acq_fees', label: 'Acquisition Fees', group: 'Acquisition' },
  { key: 'disp_price', label: 'Disposition Price', group: 'Disposition' },
  { key: 'disp_costs', label: 'Disposition Costs', group: 'Disposition' },
  { key: 'exit_fees', label: 'Exit Fees', group: 'Disposition' },
  { key: 'financing_fees', label: 'Financing Fees', group: 'Financing' },
  { key: 'debt_drawn', label: 'Debt Drawn', group: 'Financing' },
  { key: 'debt_repayment', label: 'Debt Repayment', group: 'Financing' },
  { key: 'equity_required', label: 'Equity Required', group: 'Financing' },
  { key: 'additional_equity', label: 'Additional Equity', group: 'Financing' },
  { key: 'gross_rent', label: 'Gross Rental Income', group: 'Operations' },
  { key: 'non_recoverables', label: 'Non-Recoverables', group: 'Operations' },
  { key: 'noi', label: 'NOI', group: 'Operations' },
  { key: 'capex', label: 'Capex', group: 'Operations' },
  { key: 'leasing_ti', label: 'Leasing TI', group: 'Operations' },
  { key: 'leasing_fees', label: 'Leasing Fees', group: 'Operations' },
  { key: 'cf_before_debt', label: 'CF Before Debt', group: 'Subtotals' },
  { key: 'interest', label: 'Interest', group: 'Debt Service' },
  { key: 'amortization', label: 'Amortization', group: 'Debt Service' },
  { key: 'cf_after_debt', label: 'CF After Debt', group: 'Subtotals' },
  { key: 'tax', label: 'Tax', group: 'Tax' },
  { key: 'gross_total', label: 'GROSS TOTAL', group: 'Totals' },
  { key: 'asset_mgmt_fees', label: 'Asset Mgmt Fees', group: 'Management' },
  { key: 'structure_costs', label: 'Structure Costs', group: 'Management' },
  { key: 'net_total', label: 'NET TOTAL', group: 'Totals' },
  { key: 'cash_balance', label: 'Cash Balance', group: 'Cash' },
] as const;

const ALL_ROW_KEYS = ALL_ROWS.map(r => r.key);

const VIEW_PRESETS: Record<Exclude<ViewMode, 'custom'>, Set<string>> = {
  full: new Set(ALL_ROW_KEYS),
  summary: new Set([
    'equity_required', 'additional_equity',
    'gross_rent', 'noi',
    'cf_before_debt', 'cf_after_debt',
    'gross_total', 'net_total', 'cash_balance',
  ]),
  investor: new Set([
    'equity_required', 'additional_equity',
    'disp_price', 'disp_costs',
    'gross_rent', 'non_recoverables', 'noi',
    'capex', 'leasing_ti',
    'cf_before_debt', 'interest', 'amortization', 'cf_after_debt',
    'tax', 'gross_total',
    'asset_mgmt_fees', 'structure_costs', 'net_total',
    'cash_balance',
  ]),
};

interface AssetUsed {
  id: string;
  name: string;
  city: string;
  spot_price: number;
  annual_rent: number;
  noi_margin: number;
  gla: number;
  exit_rent_multiple: number;
  disposition_year: number;
  disposition_costs_pct: number;
}

interface AssumptionsUsed {
  cashflow_period: number;
  acquisition_costs_pct: number;
  financing_fee_pct: number;
  equity_pct: number;
  interest_rate: number;
  amortization_type: string;
  amortization_years: number;
  amortization_pct: number;
  cpi_annual: number;
  asset_management_fee_pct: number;
  structure_costs_annual: number;
  capex_per_sqm: number;
  yield_on_cost: number;
  tax_rate: number;
  default_exit_rent_multiple: number;
  default_disposition_year: number;
  default_disposition_costs_pct: number;
  noi_margin_overrides: Record<number, number>;
  manual_overrides: {
    capex: Record<number, number>;
    leasing_ti: Record<number, number>;
    amortization_pct: Record<number, number>;
  };
}

interface CashflowResults {
  years: number[];
  gross_rental_income: number[];
  non_recoverables: number[];
  noi: number[];
  capex: number[];
  leasing_ti: number[];
  leasing_fees: number[];           // V4.3
  cf_before_debt: number[];
  interest: number[];
  amortization: number[];
  asset_management_fees: number[];
  structure_costs: number[];
  debt_repayment: number[];
  disposition_price: number[];
  disposition_costs: number[];
  exit_fees: number[];              // V4.3
  total_tax: number[];
  depreciation: number[];
  cf_gross: number[];
  cf_net: number[];
  // V4.4: Cash position
  additional_equity: number;
  cash_position: number[];
  liquidity_warnings: boolean[];
  total_equity_invested: number;
  has_liquidity_warnings: boolean;
  // V4.2: Tax
  taxable_income: number[];
  tax_loss_carry_forward: number[];
  building_ratio: number;
  effective_depreciation_rate: number;
  // Scalars
  total_spot_value: number;
  total_gla: number;
  acquisition_costs: number;
  acquisition_fees: number;          // V4.3
  financing_fees: number;
  total_acquisition_cost: number;
  equity_amount: number;
  total_equity_required: number;
  debt_amount: number;
  irr_gross: number;
  total_profit_gross: number;
  moic_gross: number;
  cash_on_cash_gross: number;
  irr_net: number;
  total_profit_net: number;
  moic_net: number;
  cash_on_cash_net: number;
  leasing_ti_per_sqm_year: number;
  
  assumptions_used: AssumptionsUsed;
  assets_used: AssetUsed[];
}

interface Step3Props {
  cashflowResults: CashflowResults;
  selectedAssetsCount: number;
  totalValue: number;
  cashflowPeriod: number;
  onEditAssumptions: () => void;
  onNewSimulation: () => void;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all border ${
        active 
          ? 'bg-black text-white border-black' 
          : 'bg-white text-black border-gray-300 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

function generateExcel(cashflowResults: CashflowResults) {
  import('exceljs').then((ExcelJS) => {
    const assumptions = cashflowResults.assumptions_used;
    const assets = cashflowResults.assets_used || [];
    const years = cashflowResults.years;
    
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'RE Analyzer';
    workbook.created = new Date();
    
    const ws1 = workbook.addWorksheet('Cashflow', {
      views: [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: 8 }],
      pageSetup: { printArea: 'B2:M30', orientation: 'landscape', fitToPage: true }
    });
    
    const fK = (v: number): string | null => {
      if (v === 0) return null;
      const rounded = Math.round(v / 1000);
      if (rounded < 0) {
        return `(${Math.abs(rounded).toLocaleString('en-US')})`;
      }
      return rounded.toLocaleString('en-US');
    };

    const cfAfterDebt = cashflowResults.cf_before_debt.map((cfbd, i) => 
      i === 0 ? 0 : cfbd - cashflowResults.interest[i] - cashflowResults.amortization[i]
    );
    
    const kpiRows: (string | number | null)[][] = [
      ['KEY METRICS', 'Net', 'Gross'],
      ['Total Profit (€M)', Number((cashflowResults.total_profit_net / 1_000_000).toFixed(2)), Number((cashflowResults.total_profit_gross / 1_000_000).toFixed(2))],
      ['IRR (%)', Number(cashflowResults.irr_net.toFixed(2)), Number(cashflowResults.irr_gross.toFixed(2))],
      ['MOIC (×)', Number(cashflowResults.moic_net.toFixed(2)), Number(cashflowResults.moic_gross.toFixed(2))],
      ['Cash on Cash (%)', Number(cashflowResults.cash_on_cash_net.toFixed(2)), Number(cashflowResults.cash_on_cash_gross.toFixed(2))],
      [],
      ['CASHFLOW (€000s)', ...years.map(y => y === 0 ? 'Y0' : `Y${y}`)],
      ['Acquisition Price', ...years.map(y => y === 0 ? fK(-cashflowResults.total_spot_value) : null)],
      ['Acquisition Costs', ...years.map(y => y === 0 ? fK(-cashflowResults.acquisition_costs) : null)],
      cashflowResults.acquisition_fees ? ['Acquisition Fees', ...years.map(y => y === 0 ? fK(-cashflowResults.acquisition_fees) : null)] : null,
      ['Disposition Price', ...cashflowResults.disposition_price.map(v => v === 0 ? null : fK(v))],
      ['Disposition Costs', ...cashflowResults.disposition_costs.map(v => v === 0 ? null : fK(-v))],
      cashflowResults.exit_fees ? ['Exit Fees', ...cashflowResults.exit_fees.map(v => v === 0 ? null : fK(-v))] : null,
      ['Financing Fees', ...years.map(y => y === 0 ? fK(-cashflowResults.financing_fees) : null)],
      ['Debt Drawn', ...years.map(y => y === 0 ? fK(cashflowResults.debt_amount) : null)],
      ['Debt Repayment', ...cashflowResults.debt_repayment.map(v => v === 0 ? null : fK(-v))],
      ['Equity Required', ...years.map(y => y === 0 ? fK(-cashflowResults.total_equity_required) : null)],
      cashflowResults.additional_equity > 0 ? ['Additional Equity', ...years.map((y, i) => i === 0 ? fK(cashflowResults.additional_equity) : null)] : null,
      ['Gross Rental Income', ...cashflowResults.gross_rental_income.map((v, i) => i === 0 ? null : fK(v))],
      ['Non-Recoverables', ...cashflowResults.non_recoverables.map((v, i) => i === 0 ? null : fK(-v))],
      ['NOI', ...cashflowResults.noi.map((v, i) => i === 0 ? null : fK(v))],
      ['Capex', ...cashflowResults.capex.map((v, i) => i === 0 ? null : fK(-v))],
      ['Leasing TI', ...cashflowResults.leasing_ti.map((v, i) => i === 0 ? null : (v > 0 ? fK(-v) : null))],
      cashflowResults.leasing_fees ? ['Leasing Fees', ...cashflowResults.leasing_fees.map((v, i) => i === 0 ? null : (v > 0 ? fK(-v) : null))] : null,
      ['CF Before Debt', ...cashflowResults.cf_before_debt.map((v, i) => i === 0 ? null : fK(v))],
      ['Interest', ...cashflowResults.interest.map((v, i) => i === 0 ? null : fK(-v))],
      ['Amortization', ...cashflowResults.amortization.map((v, i) => i === 0 ? null : (v > 0 ? fK(-v) : null))],
      ['CF After Debt', ...cfAfterDebt.map((v, i) => i === 0 ? null : fK(v))],
      ['Tax', ...cashflowResults.total_tax.map((v, i) => i === 0 ? null : (v > 0 ? fK(-v) : null))],
      ['GROSS TOTAL', ...cashflowResults.cf_gross.map(v => fK(v))],
      ['Asset Management Fees', ...cashflowResults.asset_management_fees.map((v, i) => i === 0 ? null : fK(-v))],
      ['Structure Costs', ...cashflowResults.structure_costs.map((v, i) => i === 0 ? null : fK(-v))],
      ['NET TOTAL', ...cashflowResults.cf_net.map(v => fK(v))],
      [],
      cashflowResults.cash_position ? ['CASH POSITION'] : null,
      cashflowResults.cash_position ? ['Cash Balance', ...cashflowResults.cash_position.map((v, i) => i === 0 && v === 0 ? null : fK(v))] : null,
    ].filter(Boolean) as (string | number | null)[][];
    
    ws1.addRow([]);
    
    const boldRows = ['KEY METRICS', 'CASHFLOW (€000s)', 'Gross Rental Income', 'NOI', 'CF Before Debt', 'CF After Debt', 'GROSS TOTAL', 'NET TOTAL', 'CASH POSITION', 'Cash Balance'];
    
    kpiRows.forEach((rowData) => {
      const row = ws1.addRow(['', ...rowData]);
      const firstCell = rowData[0]?.toString() || '';
      
      if (boldRows.includes(firstCell)) {
        row.font = { bold: true };
      }
      
      if (firstCell === 'KEY METRICS' || firstCell === 'CASHFLOW (€000s)') {
        row.font = { bold: true };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E5E5' } };
      }
    });
    
    ws1.getColumn(1).width = 3;
    ws1.getColumn(2).width = 24;
    for (let i = 3; i <= years.length + 2; i++) {
      ws1.getColumn(i).width = 11;
    }
    
    const ws2 = workbook.addWorksheet('Assumptions & Assets', {
      views: [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: 2 }],
      pageSetup: { printArea: 'B2:H24', orientation: 'portrait', fitToPage: true }
    });
    
    const assumptionsData: (string | number | null)[][] = [
      ['ASSUMPTIONS', 'Value'],
      ['Cashflow Period (years)', assumptions.cashflow_period],
      ['Equity (%)', assumptions.equity_pct],
      ['Debt (%)', 100 - assumptions.equity_pct],
      ['Interest Rate (%)', assumptions.interest_rate],
      ['Financing Fees (%)', assumptions.financing_fee_pct],
      ['Amortization Type', assumptions.amortization_type],
      ['Amortization Years', assumptions.amortization_years],
      ['Acquisition Costs (%)', assumptions.acquisition_costs_pct],
      ['CPI Annual (%)', assumptions.cpi_annual],
      ['Depreciation Rate (%/yr)', '3.0 (assuming 20/80 land/building)'],
      ['Asset Mgmt Fees (% net rent)', assumptions.asset_management_fee_pct],
      ['Structure Costs (€k/yr)', assumptions.structure_costs_annual / 1000],
      ['Capex (€/m²)', assumptions.capex_per_sqm],
      ['Leasing TI (€/m²/yr)', cashflowResults.leasing_ti_per_sqm_year?.toFixed(2) || '0'],
      ['Yield on Cost (%)', assumptions.yield_on_cost],
      ['Default Exit Multiple', assumptions.default_exit_rent_multiple],
      ['Default Disp. Year', assumptions.default_disposition_year],
      ['Default Disp. Costs (%)', assumptions.default_disposition_costs_pct],
      ['Tax Rate (%)', assumptions.tax_rate],
      [],
      ['ASSETS', 'City', 'GLA (m²)', 'Spot (€)', 'Rent (€/yr)', 'NOI %', 'Exit ×', 'Disp Y'],
    ];
    
    ws2.addRow([]);
    
    assumptionsData.forEach((rowData) => {
      const row = ws2.addRow(['', ...rowData]);
      const firstCell = rowData[0]?.toString() || '';
      
      if (firstCell === 'ASSUMPTIONS' || firstCell === 'ASSETS') {
        row.font = { bold: true };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E5E5' } };
      }
    });
    
    assets.forEach((asset: AssetUsed) => {
      ws2.addRow(['', asset.name, asset.city || '—', asset.gla || 0, asset.spot_price, asset.annual_rent, asset.noi_margin?.toFixed(1), asset.exit_rent_multiple, `Y${asset.disposition_year}`]);
    });
    
    ws2.getColumn(1).width = 3;
    ws2.getColumn(2).width = 28;
    for (let i = 3; i <= 9; i++) {
      ws2.getColumn(i).width = 12;
    }
    
    workbook.xlsx.writeBuffer().then((buffer) => {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cashflow_simulation_${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });
}

async function generatePDF(cashflowResults: CashflowResults) {
  try {
    const response = await fetch('/api/cashflow/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cashflowResults,
        assets: cashflowResults.assets_used || [],
        assumptions: cashflowResults.assumptions_used
      })
    });
    
    if (!response.ok) throw new Error('PDF generation failed');
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cashflow_simulation_${new Date().toISOString().split('T')[0]}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error generating PDF:', error);
    alert('Failed to generate PDF');
  }
}

export default function Step3({ cashflowResults, selectedAssetsCount, totalValue, cashflowPeriod, onEditAssumptions, onNewSimulation }: Step3Props) {
  const [activeTab, setActiveTab] = useState<'cashflow' | 'assumptions' | 'assets'>('cashflow');
  const [viewMode, setViewMode] = useState<ViewMode>('full');
  const [customVisible, setCustomVisible] = useState<Set<string>>(new Set(ALL_ROW_KEYS));
  const [showViewPopover, setShowViewPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  
  // Close popover on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setShowViewPopover(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Determine which rows to show
  const getVisibleSet = (): Set<string> => {
    if (viewMode === 'custom') return customVisible;
    return VIEW_PRESETS[viewMode];
  };
  const visibleSet = getVisibleSet();
  const show = (key: string) => visibleSet.has(key);
  
  const toggleCustomRow = (key: string) => {
    const next = new Set(customVisible);
    next.has(key) ? next.delete(key) : next.add(key);
    setCustomVisible(next);
  };
  
  const switchView = (mode: ViewMode) => {
    if (mode === 'custom' && viewMode !== 'custom') {
      // Initialize custom from current preset
      setCustomVisible(new Set(VIEW_PRESETS[viewMode]));
    }
    setViewMode(mode);
  };
  
  const assumptions = cashflowResults.assumptions_used;
  const assets = cashflowResults.assets_used || [];
  const totalSpot = assets.reduce((sum, a) => sum + (a.spot_price || 0), 0);

  const avgExitMultiple = totalSpot > 0
    ? assets.reduce((sum, a) => {
        const weight = a.spot_price / totalSpot;
        return sum + a.exit_rent_multiple * weight;
      }, 0)
    : assumptions.default_exit_rent_multiple;

  const cfAfterDebt = cashflowResults.cf_before_debt.map((cfbd, i) => 
    i === 0 ? 0 : cfbd - cashflowResults.interest[i] - cashflowResults.amortization[i]
  );

  return (
    <div className="space-y-4">
      {/* Liquidity Warning */}
      {cashflowResults.has_liquidity_warnings && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-3">
          <span className="text-red-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-red-800">Liquidity Warning — NO CASH AVAILABLE</p>
            <p className="text-xs text-red-600 mt-0.5">
              Cash position goes negative in {
                cashflowResults.liquidity_warnings
                  .map((w: boolean, i: number) => w ? `Y${i}` : null)
                  .filter(Boolean)
                  .join(', ')
              }. Increase Additional Equity in Assumptions to cover the gap.
            </p>
          </div>
        </div>
      )}

      {/* Header with KPIs */}
      <div className="bg-white rounded-lg border border-gray-300 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-black">Cashflow Projection Results</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {selectedAssetsCount} assets · {fmt(cashflowResults.total_gla)}m² GLA · {fmtM(cashflowResults.total_spot_value)} spot · {cashflowPeriod} years
              {cashflowResults.additional_equity > 0 && (
                <span className="text-green-600 font-medium"> · Eq: {fmtM(cashflowResults.total_equity_required)} acq + {fmtM(cashflowResults.additional_equity)} add = {fmtM(cashflowResults.total_equity_invested)}</span>
              )}
            </p>
          </div>
          <button
            onClick={onEditAssumptions}
            className="px-3 py-1.5 text-xs font-medium text-black bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            ← Edit Assumptions
          </button>
        </div>

        {/* KPIs - 2 columns */}
        <div className="grid grid-cols-2 gap-4">
          {/* Net Column */}
          <div className="bg-white rounded border border-gray-300 p-3">
            <h3 className="text-xs font-bold text-black uppercase tracking-wider mb-3 pb-1.5 border-b border-gray-200">Net</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">Total Profit</span>
                <span className="text-sm font-bold text-black">€{(cashflowResults.total_profit_net / 1_000_000).toFixed(2)}M</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">IRR</span>
                <span className="text-sm font-bold text-black">{cashflowResults.irr_net.toFixed(2)}%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">MOIC</span>
                <span className="text-sm font-bold text-black">{cashflowResults.moic_net.toFixed(2)}×</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">Cash on Cash</span>
                <span className="text-sm font-bold text-black">{cashflowResults.cash_on_cash_net.toFixed(2)}%</span>
              </div>
            </div>
          </div>

          {/* Gross Column */}
          <div className="bg-white rounded border border-gray-300 p-3">
            <h3 className="text-xs font-bold text-black uppercase tracking-wider mb-3 pb-1.5 border-b border-gray-200">Gross</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">Total Profit</span>
                <span className="text-sm font-bold text-black">€{(cashflowResults.total_profit_gross / 1_000_000).toFixed(2)}M</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">IRR</span>
                <span className="text-sm font-bold text-black">{cashflowResults.irr_gross.toFixed(2)}%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">MOIC</span>
                <span className="text-sm font-bold text-black">{cashflowResults.moic_gross.toFixed(2)}×</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-600">Cash on Cash</span>
                <span className="text-sm font-bold text-black">{cashflowResults.cash_on_cash_gross.toFixed(2)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <TabButton active={activeTab === 'cashflow'} onClick={() => setActiveTab('cashflow')}>Cashflow Table</TabButton>
        <TabButton active={activeTab === 'assumptions'} onClick={() => setActiveTab('assumptions')}>Assumptions</TabButton>
        <TabButton active={activeTab === 'assets'} onClick={() => setActiveTab('assets')}>Assets ({assets.length})</TabButton>
      </div>

      {/* Tab Content */}
      {activeTab === 'cashflow' && (
        <div className="bg-white rounded-lg border border-gray-300 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-gray-200 flex items-center justify-between">
            <p className="text-[10px] text-gray-500">All figures in €000s</p>
            <div className="flex items-center gap-1 relative" ref={popoverRef}>
              {(['full', 'summary', 'investor'] as const).map(mode => (
                <button key={mode} onClick={() => switchView(mode)} className={`px-2.5 py-1 text-[10px] font-semibold rounded transition-all border ${viewMode === mode ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
              <button onClick={() => { switchView('custom'); setShowViewPopover(!showViewPopover); }} className={`px-2.5 py-1 text-[10px] font-semibold rounded transition-all border ${viewMode === 'custom' ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                Custom ▾
              </button>
              {showViewPopover && viewMode === 'custom' && (
                <div className="absolute right-0 top-8 z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-3 w-[280px] max-h-[400px] overflow-y-auto">
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-200">
                    <span className="text-[10px] font-bold text-black uppercase tracking-wider">Toggle Rows</span>
                    <div className="flex gap-1">
                      <button onClick={() => setCustomVisible(new Set(ALL_ROW_KEYS))} className="text-[9px] text-gray-500 hover:text-black">All</button>
                      <span className="text-[9px] text-gray-300">|</span>
                      <button onClick={() => setCustomVisible(new Set())} className="text-[9px] text-gray-500 hover:text-black">None</button>
                    </div>
                  </div>
                  {(() => {
                    let lastGroup = '';
                    return ALL_ROWS.map(row => {
                      const groupHeader = row.group !== lastGroup ? <div key={'g-' + row.group} className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mt-2 mb-1 first:mt-0">{row.group}</div> : null;
                      lastGroup = row.group;
                      return [groupHeader, (
                        <label key={row.key} className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-gray-50 px-1 rounded">
                          <input type="checkbox" checked={customVisible.has(row.key)} onChange={() => toggleCustomRow(row.key)} className="w-3 h-3 rounded border-gray-300" />
                          <span className="text-xs text-black">{row.label}</span>
                        </label>
                      )];
                    });
                  })()}
                </div>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-2 py-2 text-left text-[10px] font-bold text-black uppercase tracking-wider sticky left-0 bg-gray-50 z-10 min-w-[160px]">Line Item</th>
                  {cashflowResults.years.map((year: number) => (
                    <th key={year} className="px-1.5 py-2 text-right text-[10px] font-bold text-black uppercase tracking-wider min-w-[70px]">{year === 0 ? 'Y0' : `Y${year}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-xs">
                {/* ACQUISITION */}
                {show('acq_price') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Acquisition Price</td>{cashflowResults.years.map((year: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{year === 0 ? `(${fmtK(cashflowResults.total_spot_value)})` : '—'}</td>))}</tr>}
                {show('acq_costs') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Acquisition Costs</td>{cashflowResults.years.map((year: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{year === 0 ? `(${fmtK(cashflowResults.acquisition_costs)})` : '—'}</td>))}</tr>}
                {show('acq_fees') && (
                  <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Acquisition Fees</td>{cashflowResults.years.map((year: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{year === 0 ? `(${fmtK(cashflowResults.acquisition_fees)})` : '—'}</td>))}</tr>
                )}
                
                {/* DISPOSITION */}
                {show('disp_price') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Disposition Price</td>{cashflowResults.disposition_price.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{val === 0 ? '—' : fmtK(val)}</td>))}</tr>}
                {show('disp_costs') && <tr className="hover:bg-gray-50 border-b border-gray-100"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Disposition Costs</td>{cashflowResults.disposition_costs.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{val === 0 ? '—' : `(${fmtK(val)})`}</td>))}</tr>}
                {show('exit_fees') && (
                  <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Exit Fees</td>{cashflowResults.exit_fees.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{val === 0 ? '—' : `(${fmtK(val)})`}</td>))}</tr>
                )}

                {/* FINANCING */}
                {show('financing_fees') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Financing Fees</td>{cashflowResults.years.map((year: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{year === 0 ? `(${fmtK(cashflowResults.financing_fees)})` : '—'}</td>))}</tr>}
                {show('debt_drawn') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Debt Drawn</td>{cashflowResults.years.map((year: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{year === 0 ? fmtK(cashflowResults.debt_amount) : '—'}</td>))}</tr>}
                {show('debt_repayment') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Debt Repayment</td>{cashflowResults.debt_repayment.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{val === 0 ? '—' : `(${fmtK(val)})`}</td>))}</tr>}
                {show('equity_required') && <tr className="hover:bg-gray-50 border-b border-gray-200"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Equity Required</td>{cashflowResults.years.map((year: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{year === 0 ? `(${fmtK(cashflowResults.total_equity_required)})` : '—'}</td>))}</tr>}
                {show('additional_equity') && (
                  <tr className="bg-green-50 border-b border-gray-200"><td className="px-2 py-1.5 text-green-800 font-medium sticky left-0 bg-green-50 z-10">Additional Equity</td>{cashflowResults.years.map((_: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-green-800">{idx === 0 ? fmtK(cashflowResults.additional_equity) : '—'}</td>))}</tr>
                )}

                {/* GROSS RENTAL INCOME - always visible (subtotal) */}
                <tr className="border-b border-black"><td className="px-2 py-1.5 text-black font-bold sticky left-0 bg-white z-10">Gross Rental Income</td>{cashflowResults.gross_rental_income.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : fmtK(val)}</td>))}</tr>
                {show('non_recoverables') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Non-Recoverables</td>{cashflowResults.non_recoverables.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : `(${fmtK(val)})`}</td>))}</tr>}
                {/* NOI - always visible */}
                <tr className="border-b border-black"><td className="px-2 py-1.5 font-bold text-black sticky left-0 bg-white z-10">NOI</td>{cashflowResults.noi.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : fmtK(val)}</td>))}</tr>

                {/* CAPEX & LEASING */}
                {show('capex') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Capex</td>{cashflowResults.capex.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : `(${fmtK(val)})`}</td>))}</tr>}
                {show('leasing_ti') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Leasing TI</td>{cashflowResults.leasing_ti.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : (val > 0 ? `(${fmtK(val)})` : '—')}</td>))}</tr>}
                {show('leasing_fees') && (
                  <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Leasing Fees</td>{cashflowResults.leasing_fees.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : (val > 0 ? `(${fmtK(val)})` : '—')}</td>))}</tr>
                )}
                {/* CF Before Debt - always visible */}
                <tr className="border-b border-black"><td className="px-2 py-1.5 font-bold text-black sticky left-0 bg-white z-10">CF Before Debt</td>{cashflowResults.cf_before_debt.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : fmtK(val)}</td>))}</tr>

                {/* DEBT SERVICE */}
                {show('interest') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Interest</td>{cashflowResults.interest.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : `(${fmtK(val)})`}</td>))}</tr>}
                {show('amortization') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Amortization</td>{cashflowResults.amortization.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : (val > 0 ? `(${fmtK(val)})` : '—')}</td>))}</tr>}
                {/* CF After Debt - always visible */}
                <tr className="border-b border-black"><td className="px-2 py-1.5 font-bold text-black sticky left-0 bg-white z-10">CF After Debt</td>{cfAfterDebt.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : fmtK(val)}</td>))}</tr>

                {/* TAX */}
                {show('tax') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Tax</td>{cashflowResults.total_tax.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : (val > 0 ? `(${fmtK(val)})` : '—')}</td>))}</tr>}

                {/* GROSS TOTAL - always visible */}
                <tr className="border-b border-black"><td className="px-2 py-2 font-bold text-black sticky left-0 bg-white z-10">GROSS TOTAL</td>{cashflowResults.cf_gross.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-2 text-right text-black">{val < 0 ? `(${fmtK(Math.abs(val))})` : fmtK(val)}</td>))}</tr>

                {/* MANAGEMENT FEES */}
                {show('asset_mgmt_fees') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Asset Management Fees</td>{cashflowResults.asset_management_fees.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : `(${fmtK(val)})`}</td>))}</tr>}
                {show('structure_costs') && <tr className="hover:bg-gray-50"><td className="px-2 py-1.5 text-black sticky left-0 bg-white z-10">Structure Costs</td>{cashflowResults.structure_costs.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-1.5 text-right text-black">{idx === 0 ? '—' : `(${fmtK(val)})`}</td>))}</tr>}

                {/* NET TOTAL - label bold, border below */}
                <tr className="border-b border-black"><td className="px-2 py-2 font-bold text-black sticky left-0 bg-white z-10">NET TOTAL</td>{cashflowResults.cf_net.map((val: number, idx: number) => (<td key={idx} className="px-1.5 py-2 text-right text-black">{val < 0 ? `(${fmtK(Math.abs(val))})` : fmtK(val)}</td>))}</tr>

                {/* CASH POSITION (V4.4) */}
                {cashflowResults.cash_position && (
                  <>
                    <tr><td className="px-2 pt-3 pb-1 font-bold text-black text-[10px] uppercase tracking-wider sticky left-0 bg-white z-10" colSpan={1}>Cash Position</td><td colSpan={cashflowResults.years.length}></td></tr>
                    <tr className="border-b border-black">{(() => { return (<><td className="px-2 py-2 font-bold text-black sticky left-0 bg-white z-10">Cash Balance</td>{cashflowResults.cash_position.map((val: number, idx: number) => { const isNeg = val < -0.01; const hasWarning = cashflowResults.liquidity_warnings?.[idx]; return (<td key={idx} className={`px-1.5 py-2 text-right font-bold ${hasWarning ? 'text-red-600 bg-red-50' : isNeg ? 'text-red-600' : 'text-black'}`}>{idx === 0 && val === 0 ? '—' : (isNeg ? `(${fmtK(Math.abs(val))}) ⚠️` : fmtK(val))}</td>); })}</>); })()}</tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'assumptions' && assumptions && (
        <div className="bg-white rounded-lg border border-gray-300 p-5">
          <h3 className="text-base font-bold text-black mb-5">Assumptions Used</h3>
          <div className="grid grid-cols-3 gap-5">
            <div className="space-y-3 bg-white rounded border border-gray-200 p-4">
              <h4 className="text-sm font-bold text-black uppercase tracking-wider pb-2 border-b border-gray-200">Transaction</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Cashflow Period</span><span className="font-medium text-black">{assumptions.cashflow_period} years</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Acquisition Costs</span><span className="font-medium text-black">{assumptions.acquisition_costs_pct}%</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Acquisition Fees</span><span className="font-medium text-black">{(assumptions as any).acquisition_fee_pct ?? 2}% of equity</span></div>
                <div className="flex justify-between"><span className="text-gray-600">CPI Annual</span><span className="font-medium text-black">{assumptions.cpi_annual}%</span></div>
              </div>
            </div>

            <div className="space-y-3 bg-white rounded border border-gray-200 p-4">
              <h4 className="text-sm font-bold text-black uppercase tracking-wider pb-2 border-b border-gray-200">Financing</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Equity</span><span className="font-medium text-black">{assumptions.equity_pct}%</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Debt</span><span className="font-medium text-black">{(100 - assumptions.equity_pct).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Interest Rate</span><span className="font-medium text-black">{assumptions.interest_rate}%</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Financing Fees</span><span className="font-medium text-black">{assumptions.financing_fee_pct}%</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Amort. Type</span><span className="font-medium text-black capitalize">{assumptions.amortization_type}</span></div>
                {cashflowResults.additional_equity > 0 && (
                  <div className="flex justify-between"><span className="text-gray-600">Additional Equity</span><span className="font-medium text-green-700">{fmtK(cashflowResults.additional_equity)}</span></div>
                )}
              </div>
            </div>

            <div className="space-y-3 bg-white rounded border border-gray-200 p-4">
              <h4 className="text-sm font-bold text-black uppercase tracking-wider pb-2 border-b border-gray-200">Operations</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Asset Mgmt Fees</span><span className="font-medium text-black">{assumptions.asset_management_fee_pct}% of NOI</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Structure Costs</span><span className="font-medium text-black">€{(assumptions.structure_costs_annual / 1000).toFixed(0)}k/yr</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Capex</span><span className="font-medium text-black">€{assumptions.capex_per_sqm}/m²</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Yield on Cost</span><span className="font-medium text-black">{assumptions.yield_on_cost}%</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Leasing Fees</span><span className="font-medium text-black">{(assumptions as any).leasing_fee_pct ?? 2}% of rent</span></div>
              </div>
            </div>

            <div className="space-y-3 bg-white rounded border border-gray-200 p-4">
              <h4 className="text-sm font-bold text-black uppercase tracking-wider pb-2 border-b border-gray-200">Exit</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Wtd Exit Multiple</span><span className="font-medium text-black">{avgExitMultiple.toFixed(1)}×</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Default Disp. Year</span><span className="font-medium text-black">Y{assumptions.default_disposition_year}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Default Disp. Costs</span><span className="font-medium text-black">{assumptions.default_disposition_costs_pct}%</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Exit Fees</span><span className="font-medium text-black">{(assumptions as any).exit_fee_pct ?? 2}% of net proceeds</span></div>
              </div>
            </div>

            <div className="space-y-3 bg-white rounded border border-gray-200 p-4">
              <h4 className="text-sm font-bold text-black uppercase tracking-wider pb-2 border-b border-gray-200">Tax</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Tax Rate</span><span className="font-medium text-black">{assumptions.tax_rate}%</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Depreciation</span><span className="font-medium text-black">3.0%/yr × 80% bldg = {cashflowResults.effective_depreciation_rate?.toFixed(1) || '2.4'}% eff.</span></div>

              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'assets' && (
        <div className="bg-white rounded-lg border border-gray-300 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-200">
            <h3 className="text-sm font-bold text-black">Assets Used ({assets.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-black uppercase">Name</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold text-black uppercase">City</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold text-black uppercase">GLA</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold text-black uppercase">Spot</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold text-black uppercase">Rent</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold text-black uppercase">NOI%</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold text-black uppercase">Exit×</th>
                  <th className="px-3 py-2 text-right text-[10px] font-bold text-black uppercase">Disp.Yr</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset: AssetUsed) => (
                  <tr key={asset.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-black">{asset.name}</td>
                    <td className="px-3 py-2 text-gray-600">{asset.city || '—'}</td>
                    <td className="px-3 py-2 text-right text-black">{fmt(asset.gla)}m²</td>
                    <td className="px-3 py-2 text-right text-black">{fmtM(asset.spot_price)}</td>
                    <td className="px-3 py-2 text-right text-black">{fmtK(asset.annual_rent)}</td>
                    <td className="px-3 py-2 text-right text-black">{asset.noi_margin?.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right text-black">{asset.exit_rent_multiple?.toFixed(1)}×</td>
                    <td className="px-3 py-2 text-right text-black">Y{asset.disposition_year}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr className="font-bold">
                  <td className="px-3 py-2 text-black">TOTAL</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2 text-right text-black">{fmt(assets.reduce((s, a) => s + (a.gla || 0), 0))}m²</td>
                  <td className="px-3 py-2 text-right text-black">{fmtM(assets.reduce((s, a) => s + (a.spot_price || 0), 0))}</td>
                  <td className="px-3 py-2 text-right text-black">{fmtK(assets.reduce((s, a) => s + (a.annual_rent || 0), 0))}</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2 text-right text-black">{avgExitMultiple.toFixed(1)}× wtd</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end">
        <div className="flex gap-2">
          <button onClick={() => generateExcel(cashflowResults)} className="px-4 py-2 text-xs font-semibold text-white bg-black rounded hover:bg-gray-800 transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Export Excel
          </button>
          <button onClick={() => generatePDF(cashflowResults)} className="px-4 py-2 text-xs font-semibold text-black bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}