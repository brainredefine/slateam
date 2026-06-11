'use client';

import { useState, useRef } from 'react';
import { NumberInput } from './NumberInput';

interface Asset {
  id: string;
  name: string;
  city: string;
  purchase_price: number;
  spot_price: number;
  annual_rent: number;
  investment_type: string;
  noi_margin: number;
  total_gla: number;
  gla: number;
}

interface AssetExitConfig {
  exit_rent_multiple: number;
  disposition_year: number;
  disposition_costs_pct: number;
}

interface AssetOverrides {
  spot_price?: number;
  noi_margin?: number;
  annual_rent?: number;
}

interface Assumptions {
  cashflow_period: 5 | 10 | 15;
  acquisition_costs_pct: number;
  equity_pct: number;
  interest_rate: number;
  financing_fee_pct: number;
  amortization_type: 'amortizing' | 'bullet' | 'hybrid';
  amortization_years: number;
  amortization_pct: number;
  cpi_annual: number;
  asset_management_fee_pct: number;
  structure_costs_annual: number;
  capex_per_sqm: number;
  yield_on_cost: number;
  asset_exit_configs: Record<string, AssetExitConfig>;
  default_exit_rent_multiple: number;
  default_disposition_year: number;
  default_disposition_costs_pct: number;
  asset_overrides: Record<string, AssetOverrides>;
  noi_margin_overrides: Record<number, number>;
  manual_overrides: {
    capex: Record<number, number>;
    leasing_ti: Record<number, number>;
    amortization_pct: Record<number, number>;
  };
  // V4.3: Fees
  acquisition_fee_pct: number;
  exit_fee_pct: number;
  leasing_fee_pct: number;
  // V4.4: Additional equity
  additional_equity: number;
}

interface Tenant {
  id: string;
  tenant_name: string;
  remaining_lease_years: number;
  annual_rent: number;
}

const fmtK = (val: any) => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return '—';
  const thousands = num / 1000;
  return '€' + thousands.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + 'k';
};

const fmtM = (val: any) => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return '—';
  return '€' + (num / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'M';
};

const fmt = (val: any, suffix = '') => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(num) ? '—' : num.toLocaleString('en-US', { maximumFractionDigits: 0 }) + suffix;
};

interface Step2Props {
  selectedAssets: Asset[];
  assumptions: Assumptions;
  setAssumptions: (a: Assumptions) => void;
  onBack: () => void;
  onNext: () => void;
  calculating: boolean;
}

// Card Component
function Card({ 
  title, 
  children,
  className = ""
}: { 
  title: string; 
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg p-3 border border-gray-300 bg-white ${className}`}>
      <h4 className="text-xs font-bold text-black uppercase tracking-wider pb-1.5 mb-2 border-b border-gray-200">
        {title}
      </h4>
      {children}
    </div>
  );
}

// Input Row Component - NO suffix display, hint below
function InputRow({ 
  label, 
  value, 
  onChange, 
  suffix = '',
  hint,
  decimals = 2,
  multiplier = 1,
  type = 'number',
  options,
  disabled = false,
  linkText,
  onLinkClick
}: { 
  label: string; 
  value: number | string; 
  onChange: (val: any) => void;
  suffix?: string;
  hint?: string;
  decimals?: number;
  multiplier?: number;
  type?: 'number' | 'select';
  options?: { value: string; label: string }[];
  disabled?: boolean;
  linkText?: string;
  onLinkClick?: () => void;
}) {
  // Combine suffix into label
  const displayLabel = suffix ? `${label} (${suffix})` : label;
  
  return (
    <div className="py-0.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-1">
          <span className="text-sm text-black">{displayLabel}</span>
          {linkText && onLinkClick && (
            <button 
              onClick={onLinkClick}
              className="text-[10px] text-gray-500 hover:text-black hover:underline"
            >
              {linkText}
            </button>
          )}
        </div>
        <div className="shrink-0">
          {type === 'select' && options ? (
            <select
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              className="w-24 px-2 py-1 text-sm border border-gray-300 rounded text-right focus:border-gray-500 focus:ring-1 focus:ring-gray-200 bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <NumberInput 
              value={typeof value === 'number' ? value : 0}
              onChange={onChange}
              decimals={decimals}
              multiplier={multiplier}
              className={`w-20 px-2 py-1 text-sm border border-gray-300 rounded text-right focus:border-gray-500 focus:ring-1 focus:ring-gray-200 ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''}`}
            />
          )}
        </div>
      </div>
      {hint && <div className="text-[10px] text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

// Asset Row
function AssetRow({ 
  asset, 
  getAssetSpot, 
  getAssetRent, 
  getAssetNoi,
  getAssetExitMultiple,
  getAssetDispositionYear,
  handleAssetChange,
  handleExitChange,
  maxYear
}: {
  asset: Asset;
  getAssetSpot: (asset: Asset) => number;
  getAssetRent: (asset: Asset) => number;
  getAssetNoi: (asset: Asset) => number;
  getAssetExitMultiple: (asset: Asset) => number;
  getAssetDispositionYear: (asset: Asset) => number;
  handleAssetChange: (assetId: string, field: 'spot_price' | 'noi_margin' | 'annual_rent', value: number) => void;
  handleExitChange: (assetId: string, field: 'exit_rent_multiple' | 'disposition_year' | 'disposition_costs_pct', value: number) => void;
  maxYear: number;
}) {
  const [showRentRoll, setShowRentRoll] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);

  const glaValue = asset.gla || asset.total_gla || 0;

  const loadRentRoll = async () => {
    if (showRentRoll) {
      setShowRentRoll(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/assets/${asset.id}/tenants`);
      const data = await res.json();
      setTenants(data);
      setShowRentRoll(true);
    } catch (error) {
      console.error('Error loading tenants:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-11 gap-1 items-center py-1 hover:bg-gray-50 rounded transition-colors text-xs">
        <div className="col-span-2 text-black truncate font-medium pl-2">{asset.name}</div>
        <div className="col-span-1 text-right text-gray-600">{fmt(glaValue)}m²</div>
        <div className="col-span-2">
          <NumberInput 
            value={getAssetSpot(asset)}
            onChange={(val) => handleAssetChange(asset.id, 'spot_price', val)}
            multiplier={1_000}
            decimals={0}
            className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:border-gray-500"
          />
        </div>
        <div className="col-span-2">
          <NumberInput 
            value={getAssetRent(asset)}
            onChange={(val) => handleAssetChange(asset.id, 'annual_rent', val)}
            multiplier={1_000}
            decimals={0}
            className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:border-gray-500"
          />
        </div>
        <div className="col-span-1">
          <NumberInput 
            value={getAssetNoi(asset)}
            onChange={(val) => handleAssetChange(asset.id, 'noi_margin', val)}
            decimals={1}
            className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:border-gray-500"
          />
        </div>
        <div className="col-span-1">
          <NumberInput 
            value={getAssetExitMultiple(asset)}
            onChange={(val) => handleExitChange(asset.id, 'exit_rent_multiple', val)}
            decimals={1}
            className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:border-gray-500"
          />
        </div>
        <div className="col-span-1">
          <select
            value={getAssetDispositionYear(asset)}
            onChange={(e) => handleExitChange(asset.id, 'disposition_year', parseInt(e.target.value))}
            className="w-full px-0.5 py-0.5 text-xs border border-gray-300 rounded text-center focus:border-gray-500 bg-white"
          >
            {Array.from({ length: maxYear }, (_, i) => i + 1).map(year => (
              <option key={year} value={year}>Y{year}</option>
            ))}
          </select>
        </div>
        <div className="col-span-1 text-center">
          <button onClick={loadRentRoll} disabled={loading} className="text-gray-600 hover:text-black font-semibold px-1 hover:bg-gray-100 rounded transition-colors">
            {loading ? '..' : showRentRoll ? '▲' : '▼'}
          </button>
        </div>
      </div>
      {showRentRoll && (
        <div className="mx-2 mb-1 bg-gray-50 border border-gray-200 rounded p-2">
          {tenants.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No tenants</p>
          ) : (
            <div className="space-y-0.5">
              {tenants.map(tenant => (
                <div key={tenant.id} className="bg-white px-2 py-1 rounded text-xs flex items-center gap-2 border border-gray-200">
                  <span className="font-medium text-black">{tenant.tenant_name}</span>
                  <span className="text-gray-600">{tenant.remaining_lease_years}y • {fmtK(tenant.annual_rent)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function Step2({ selectedAssets, assumptions, setAssumptions, onBack, onNext, calculating }: Step2Props) {
  const [showCapexOverrides, setShowCapexOverrides] = useState(false);
  const [showTiOverrides, setShowTiOverrides] = useState(false);
  const [showAmortOverrides, setShowAmortOverrides] = useState(false);
  const [showNoiOverrides, setShowNoiOverrides] = useState(false);

  const capexOverrideRef = useRef<HTMLDivElement>(null);
  const tiOverrideRef = useRef<HTMLDivElement>(null);
  const amortOverrideRef = useRef<HTMLDivElement>(null);

  const hasCapexOverrides = Object.keys(assumptions.manual_overrides.capex).length > 0;
  const hasTiOverrides = Object.keys(assumptions.manual_overrides.leasing_ti).length > 0;
  const hasAmortOverrides = Object.keys(assumptions.manual_overrides.amortization_pct).length > 0;
  const hasNoiOverrides = Object.keys(assumptions.noi_margin_overrides).length > 0;

  const showCapex = showCapexOverrides || hasCapexOverrides;
  const showTi = showTiOverrides || hasTiOverrides;
  const showAmort = showAmortOverrides || hasAmortOverrides;
  const showNoi = showNoiOverrides || hasNoiOverrides;

  const scrollToCapexOverride = () => {
    setShowCapexOverrides(true);
    setTimeout(() => capexOverrideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  };
  const scrollToTiOverride = () => {
    setShowTiOverrides(true);
    setTimeout(() => tiOverrideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  };
  const scrollToAmortOverride = () => {
    setShowAmortOverrides(true);
    setTimeout(() => amortOverrideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  };

  const getAssetSpot = (asset: Asset) => assumptions.asset_overrides[asset.id]?.spot_price ?? asset.spot_price;
  const getAssetRent = (asset: Asset) => assumptions.asset_overrides[asset.id]?.annual_rent ?? asset.annual_rent;
  const getAssetNoi = (asset: Asset) => assumptions.asset_overrides[asset.id]?.noi_margin ?? asset.noi_margin;
  const getAssetExitMultiple = (asset: Asset) => assumptions.asset_exit_configs[asset.id]?.exit_rent_multiple ?? assumptions.default_exit_rent_multiple;
  const getAssetDispositionYear = (asset: Asset) => assumptions.asset_exit_configs[asset.id]?.disposition_year ?? assumptions.default_disposition_year;

  const totalSpot = selectedAssets.reduce((sum, a) => sum + (getAssetSpot(a) || 0), 0);
  const totalGla = selectedAssets.reduce((sum, a) => sum + (a.gla || a.total_gla || 0), 0);
  const totalRent = selectedAssets.reduce((sum, a) => sum + (getAssetRent(a) || 0), 0);
  const acquisitionCosts = totalSpot * (assumptions.acquisition_costs_pct / 100);
  // V4.3: Acquisition fees in E/D split
  const baseAcquisitionCost = totalSpot + acquisitionCosts;
  const baseEquity = baseAcquisitionCost * (assumptions.equity_pct / 100);
  const acquisitionFees = baseEquity * (assumptions.acquisition_fee_pct / 100);
  const totalAcquisition = baseAcquisitionCost + acquisitionFees;
  const equityAmount = totalAcquisition * (assumptions.equity_pct / 100);
  const debtAmount = totalAcquisition - equityAmount;
  const financingFees = debtAmount * (assumptions.financing_fee_pct / 100);
  const totalEquityRequired = equityAmount + financingFees;
  // V4.4: Additional equity (pure equity, not in split)
  const additionalEquity = assumptions.additional_equity || 0;
  const totalEquityInvested = totalEquityRequired + additionalEquity;

  const totalTiOverrides = Object.values(assumptions.manual_overrides.leasing_ti).reduce((sum, v) => sum + v, 0);
  const tiPerSqmPerYear = totalGla > 0 && assumptions.cashflow_period > 0 
    ? totalTiOverrides / totalGla / assumptions.cashflow_period 
    : 0;

  const avgExitMultiple = totalSpot > 0
    ? selectedAssets.reduce((sum, a) => {
        const assetSpot = getAssetSpot(a);
        const weight = assetSpot / totalSpot;
        return sum + getAssetExitMultiple(a) * weight;
      }, 0)
    : assumptions.default_exit_rent_multiple;

  const handleAssetChange = (assetId: string, field: 'spot_price' | 'noi_margin' | 'annual_rent', value: number) => {
    setAssumptions({
      ...assumptions,
      asset_overrides: {
        ...assumptions.asset_overrides,
        [assetId]: { ...assumptions.asset_overrides[assetId], [field]: value }
      }
    });
  };

  const handleExitChange = (assetId: string, field: 'exit_rent_multiple' | 'disposition_year' | 'disposition_costs_pct', value: number) => {
    setAssumptions({
      ...assumptions,
      asset_exit_configs: {
        ...assumptions.asset_exit_configs,
        [assetId]: { 
          exit_rent_multiple: assumptions.asset_exit_configs[assetId]?.exit_rent_multiple ?? assumptions.default_exit_rent_multiple,
          disposition_year: assumptions.asset_exit_configs[assetId]?.disposition_year ?? assumptions.default_disposition_year,
          disposition_costs_pct: assumptions.asset_exit_configs[assetId]?.disposition_costs_pct ?? assumptions.default_disposition_costs_pct,
          [field]: value 
        }
      }
    });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-300 shadow-sm max-w-full overflow-hidden">
      {/* Header Summary */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-bold text-black mb-3">Configure Assumptions</h2>
        
        {/* Key Metrics Bar */}
        <div className={`grid gap-2 ${additionalEquity > 0 ? 'grid-cols-9' : 'grid-cols-8'}`}>
          <div className="bg-white rounded p-2 border border-gray-200">
            <div className="text-[10px] text-gray-500">Assets</div>
            <div className="text-sm font-bold text-black">{selectedAssets.length}</div>
          </div>
          <div className="bg-white rounded p-2 border border-gray-200">
            <div className="text-[10px] text-gray-500">Total GLA</div>
            <div className="text-sm font-bold text-black">{fmt(totalGla)}m²</div>
          </div>
          <div className="bg-white rounded p-2 border border-gray-200">
            <div className="text-[10px] text-gray-500">Spot Price</div>
            <div className="text-sm font-bold text-black">{fmtM(totalSpot)}</div>
          </div>
          <div className="bg-white rounded p-2 border border-gray-200">
            <div className="text-[10px] text-gray-500">Annual Rent</div>
            <div className="text-sm font-bold text-black">{fmtK(totalRent)}</div>
          </div>
          <div className="bg-white rounded p-2 border border-gray-200">
            <div className="text-[10px] text-gray-500">Wtd Exit ×</div>
            <div className="text-sm font-bold text-black">{avgExitMultiple.toFixed(1)}×</div>
          </div>
          <div className="bg-white rounded p-2 border border-gray-200">
            <div className="text-[10px] text-gray-500">Total Acq.</div>
            <div className="text-sm font-bold text-black">{fmtM(totalAcquisition)}</div>
          </div>
          <div className="bg-white rounded p-2 border-2 border-gray-300">
            <div className="text-[10px] text-gray-500 font-medium">Acq. Equity</div>
            <div className="text-sm font-bold text-black">{fmtM(totalEquityRequired)}</div>
          </div>
          {additionalEquity > 0 && (
            <div className="bg-green-50 rounded p-2 border-2 border-green-300">
              <div className="text-[10px] text-green-700 font-medium">Add. Equity</div>
              <div className="text-sm font-bold text-green-800">{fmtM(additionalEquity)}</div>
              <div className="text-[9px] text-green-600">Total: {fmtM(totalEquityInvested)}</div>
            </div>
          )}
          <div className="bg-white rounded p-2 border-2 border-gray-300">
            <div className="text-[10px] text-gray-500 font-medium">Debt</div>
            <div className="text-sm font-bold text-black">{fmtM(debtAmount)}</div>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="p-4 max-h-[calc(100vh-340px)] overflow-y-auto space-y-3">
        
        {/* Row 1: Transaction + Financing + Operations */}
        <div className="grid grid-cols-3 gap-3">
          
          {/* TRANSACTION */}
          <Card title="Transaction">
            <div className="space-y-0">
              <div className="flex items-center justify-between py-0.5">
                <span className="text-sm text-black">Cashflow Period</span>
                <div className="flex gap-1">
                  {[5, 10, 15].map(period => (
                    <button
                      key={period}
                      onClick={() => setAssumptions({ ...assumptions, cashflow_period: period as 5 | 10 | 15 })}
                      className={`px-2 py-0.5 text-xs font-medium rounded transition-all border ${
                        assumptions.cashflow_period === period 
                          ? 'bg-black text-white border-black' 
                          : 'bg-white text-black border-gray-300 hover:bg-gray-100'
                      }`}
                    >
                      {period}y
                    </button>
                  ))}
                </div>
              </div>
              <InputRow 
                label="Acquisition Costs" 
                value={assumptions.acquisition_costs_pct} 
                onChange={(val) => setAssumptions({ ...assumptions, acquisition_costs_pct: val })}
                suffix="%"
                hint={fmtK(acquisitionCosts)}
              />
              <InputRow 
                label="Acquisition Fees" 
                value={assumptions.acquisition_fee_pct} 
                onChange={(val) => setAssumptions({ ...assumptions, acquisition_fee_pct: val })}
                suffix="% eq."
                hint={fmtK(acquisitionFees)}
              />
              <InputRow 
                label="CPI Annual" 
                value={assumptions.cpi_annual} 
                onChange={(val) => setAssumptions({ ...assumptions, cpi_annual: val })}
                suffix="%"
              />
            </div>
          </Card>

          {/* FINANCING */}
          <Card title="Financing">
            <div className="space-y-0">
              <InputRow 
                label="Equity" 
                value={assumptions.equity_pct} 
                onChange={(val) => setAssumptions({ ...assumptions, equity_pct: val })}
                suffix="%"
                hint={`LTV ${(100 - assumptions.equity_pct).toFixed(0)}%`}
                decimals={1}
              />
              <InputRow 
                label="Interest Rate" 
                value={assumptions.interest_rate} 
                onChange={(val) => setAssumptions({ ...assumptions, interest_rate: val })}
                suffix="%"
              />
              <InputRow 
                label="Financing Fees" 
                value={assumptions.financing_fee_pct} 
                onChange={(val) => setAssumptions({ ...assumptions, financing_fee_pct: val })}
                suffix="%"
              />
              <InputRow 
                label="Add. Equity" 
                value={assumptions.additional_equity} 
                onChange={(val) => setAssumptions({ ...assumptions, additional_equity: val })}
                multiplier={1000}
                decimals={0}
                suffix="k€"
                hint="pure equity"
              />
              <InputRow 
                label="Amort. Type" 
                value={assumptions.amortization_type} 
                onChange={(val) => setAssumptions({ ...assumptions, amortization_type: val })}
                type="select"
                options={[
                  { value: 'bullet', label: 'Bullet' },
                  { value: 'amortizing', label: 'Amortizing' },
                  { value: 'hybrid', label: 'Hybrid' }
                ]}
                linkText="override →"
                onLinkClick={scrollToAmortOverride}
              />
              {assumptions.amortization_type !== 'bullet' && (
                <InputRow 
                  label="Amort. Years" 
                  value={assumptions.amortization_years} 
                  onChange={(val) => setAssumptions({ ...assumptions, amortization_years: val })}
                  decimals={0}
                />
              )}
            </div>
          </Card>

          {/* OPERATIONS */}
          <Card title="Operations">
            <div className="space-y-0">
              <InputRow 
                label="Asset Mgmt Fees" 
                value={assumptions.asset_management_fee_pct} 
                onChange={(val) => setAssumptions({ ...assumptions, asset_management_fee_pct: val })}
                suffix="% NOI"
              />
              <InputRow 
                label="Structure Costs" 
                value={assumptions.structure_costs_annual} 
                onChange={(val) => setAssumptions({ ...assumptions, structure_costs_annual: val })}
                multiplier={1000}
                decimals={0}
                suffix="k€/y"
              />
              <InputRow 
                label="Capex" 
                value={assumptions.capex_per_sqm} 
                onChange={(val) => setAssumptions({ ...assumptions, capex_per_sqm: val })}
                suffix="€/m²"
                linkText="override →"
                onLinkClick={scrollToCapexOverride}
              />
              <div className="flex items-center justify-between py-0.5">
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-500">Leasing TI (€/m²/y)</span>
                  <button 
                    onClick={scrollToTiOverride}
                    className="text-[10px] text-gray-500 hover:text-black hover:underline"
                  >
                    edit →
                  </button>
                </div>
                <span className="text-sm text-black">{tiPerSqmPerYear.toFixed(2)}</span>
              </div>
              <InputRow 
                label="Yield on Cost" 
                value={assumptions.yield_on_cost} 
                onChange={(val) => setAssumptions({ ...assumptions, yield_on_cost: val })}
                suffix="%"
                hint="TI → rent"
              />
              <InputRow 
                label="Leasing Fees" 
                value={assumptions.leasing_fee_pct} 
                onChange={(val) => setAssumptions({ ...assumptions, leasing_fee_pct: val })}
                suffix="% rent"
              />
            </div>
          </Card>
        </div>

        {/* Row 2: Exit Defaults + Assets Table */}
        <div className="grid grid-cols-4 gap-3">
          <Card title="Exit Defaults">
            <div className="space-y-0">
              <InputRow 
                label="Exit Multiple" 
                value={assumptions.default_exit_rent_multiple} 
                onChange={(val) => setAssumptions({ ...assumptions, default_exit_rent_multiple: val })}
                suffix="×"
                decimals={1}
              />
              <InputRow 
                label="Disp. Year" 
                value={assumptions.default_disposition_year} 
                onChange={(val) => setAssumptions({ ...assumptions, default_disposition_year: Math.min(val, assumptions.cashflow_period) })}
                decimals={0}
              />
              <InputRow 
                label="Disp. Costs" 
                value={assumptions.default_disposition_costs_pct} 
                onChange={(val) => setAssumptions({ ...assumptions, default_disposition_costs_pct: val })}
                suffix="%"
              />
              <InputRow 
                label="Exit Fees" 
                value={assumptions.exit_fee_pct} 
                onChange={(val) => setAssumptions({ ...assumptions, exit_fee_pct: val })}
                suffix="% net"
              />
            </div>
          </Card>
          
          {/* Assets Table */}
          <div className="col-span-3 border border-gray-300 rounded-lg overflow-hidden bg-white">
            <div className="bg-white px-3 py-1.5 border-b border-gray-200">
              <h4 className="text-xs font-bold text-black uppercase tracking-wider">Assets ({selectedAssets.length})</h4>
            </div>
            <div className="p-1.5">
              <div className="grid grid-cols-11 gap-1 text-[9px] font-bold text-gray-500 uppercase tracking-wider px-2 py-1 border-b border-gray-100">
                <div className="col-span-2 pl-1">Name</div>
                <div className="col-span-1 text-right">GLA</div>
                <div className="col-span-2 text-center">Spot (k€)</div>
                <div className="col-span-2 text-center">Rent (k€)</div>
                <div className="col-span-1 text-center">NOI%</div>
                <div className="col-span-1 text-center">Exit×</div>
                <div className="col-span-1 text-center">Disp</div>
                <div className="col-span-1 text-center">Roll</div>
              </div>
              <div className="divide-y divide-gray-50 max-h-[140px] overflow-y-auto">
                {selectedAssets.map(asset => (
                  <AssetRow 
                    key={asset.id} 
                    asset={asset}
                    getAssetSpot={getAssetSpot}
                    getAssetRent={getAssetRent}
                    getAssetNoi={getAssetNoi}
                    getAssetExitMultiple={getAssetExitMultiple}
                    getAssetDispositionYear={getAssetDispositionYear}
                    handleAssetChange={handleAssetChange}
                    handleExitChange={handleExitChange}
                    maxYear={assumptions.cashflow_period}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Row 3: Manual Overrides */}
        <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
          <div className="bg-white px-3 py-1.5 border-b border-gray-200">
            <h4 className="text-xs font-bold text-black uppercase tracking-wider">Manual Overrides</h4>
          </div>
          <div className="p-3 space-y-2">
            
            {/* NOI Margin */}
            <div className="bg-white rounded border border-gray-200 p-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showNoi} 
                  onChange={(e) => { if (!e.target.checked && hasNoiOverrides) return; setShowNoiOverrides(e.target.checked); }} 
                  className="w-3.5 h-3.5 rounded border-gray-300" 
                />
                <span className="text-sm font-medium text-black">NOI Margin Development</span>
              </label>
              {showNoi && (
                <div className="grid grid-cols-5 gap-2 mt-2 pt-2 border-t border-gray-100">
                  {Array.from({ length: assumptions.cashflow_period }, (_, i) => i + 1).map(year => (
                    <div key={year}>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Y{year} %</label>
                      <NumberInput
                        value={assumptions.noi_margin_overrides[year] || 0}
                        onChange={(val) => {
                          const newOverrides = { ...assumptions.noi_margin_overrides };
                          if (val === 0) delete newOverrides[year];
                          else newOverrides[year] = val;
                          setAssumptions({ ...assumptions, noi_margin_overrides: newOverrides });
                        }}
                        decimals={1}
                        placeholder="Auto"
                        className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:border-gray-500"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Capex */}
            <div ref={capexOverrideRef} className="bg-white rounded border border-gray-200 p-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showCapex} 
                  onChange={(e) => { if (!e.target.checked && hasCapexOverrides) return; setShowCapexOverrides(e.target.checked); }} 
                  className="w-3.5 h-3.5 rounded border-gray-300" 
                />
                <span className="text-sm font-medium text-black">Capex (€k/year)</span>
              </label>
              {showCapex && (
                <div className="grid grid-cols-5 gap-2 mt-2 pt-2 border-t border-gray-100">
                  {Array.from({ length: assumptions.cashflow_period }, (_, i) => i + 1).map(year => (
                    <div key={year}>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Y{year}</label>
                      <NumberInput
                        value={assumptions.manual_overrides.capex[year] || 0}
                        onChange={(val) => {
                          const newCapex = { ...assumptions.manual_overrides.capex };
                          if (val === 0) delete newCapex[year];
                          else newCapex[year] = val;
                          setAssumptions({ ...assumptions, manual_overrides: { ...assumptions.manual_overrides, capex: newCapex } });
                        }}
                        multiplier={1000}
                        decimals={0}
                        placeholder="Auto"
                        className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:border-gray-500"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Leasing TI */}
            <div ref={tiOverrideRef} className="bg-white rounded border border-gray-200 p-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showTi} 
                  onChange={(e) => { if (!e.target.checked && hasTiOverrides) return; setShowTiOverrides(e.target.checked); }} 
                  className="w-3.5 h-3.5 rounded border-gray-300" 
                />
                <span className="text-sm font-medium text-black">Leasing TI (€k/year)</span>
                <span className="text-[10px] text-gray-400">— only way to add TI</span>
              </label>
              {showTi && (
                <div className="grid grid-cols-5 gap-2 mt-2 pt-2 border-t border-gray-100">
                  {Array.from({ length: assumptions.cashflow_period }, (_, i) => i + 1).map(year => (
                    <div key={year}>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Y{year}</label>
                      <NumberInput
                        value={assumptions.manual_overrides.leasing_ti[year] || 0}
                        onChange={(val) => {
                          const newTi = { ...assumptions.manual_overrides.leasing_ti };
                          if (val === 0) delete newTi[year];
                          else newTi[year] = val;
                          setAssumptions({ ...assumptions, manual_overrides: { ...assumptions.manual_overrides, leasing_ti: newTi } });
                        }}
                        multiplier={1000}
                        decimals={0}
                        placeholder="0"
                        className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:border-gray-500"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Amortization */}
            <div ref={amortOverrideRef} className="bg-white rounded border border-gray-200 p-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showAmort} 
                  onChange={(e) => { if (!e.target.checked && hasAmortOverrides) return; setShowAmortOverrides(e.target.checked); }} 
                  className="w-3.5 h-3.5 rounded border-gray-300" 
                />
                <span className="text-sm font-medium text-black">Amortization (% of debt/year)</span>
              </label>
              {showAmort && (
                <div className="grid grid-cols-5 gap-2 mt-2 pt-2 border-t border-gray-100">
                  {Array.from({ length: assumptions.cashflow_period }, (_, i) => i + 1).map(year => (
                    <div key={year}>
                      <label className="block text-[10px] text-gray-500 mb-0.5">Y{year} %</label>
                      <NumberInput
                        value={assumptions.manual_overrides.amortization_pct[year] || 0}
                        onChange={(val) => {
                          const newAmort = { ...assumptions.manual_overrides.amortization_pct };
                          if (val === 0) delete newAmort[year];
                          else newAmort[year] = val;
                          setAssumptions({ ...assumptions, manual_overrides: { ...assumptions.manual_overrides, amortization_pct: newAmort } });
                        }}
                        decimals={1}
                        placeholder="Auto"
                        className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:border-gray-500"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 p-4 border-t border-gray-200 bg-white flex justify-between z-10">
        <button 
          onClick={onBack} 
          className="px-5 py-2 text-sm font-semibold text-black bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
        >
          ← Back
        </button>
        <button 
          onClick={onNext} 
          disabled={calculating} 
          className={`px-6 py-2 text-sm font-bold text-white rounded-lg transition-all ${
            calculating 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-black hover:bg-gray-800'
          }`}
        >
          {calculating ? 'Calculating...' : 'Calculate Results →'}
        </button>
      </div>
    </div>
  );
}