'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Step1 from './components/Step1';
import Step2 from './components/Step2';
import Step3 from './components/Step3';

interface Asset {
  id: string;
  name: string;
  city: string;
  portfolio_id: string;
  portfolio_name: string;
  asset_type: string;
  purchase_price: number;
  spot_price: number;
  annual_rent: number;
  total_gla: number;
  gla: number;
  investment_type: string;
  noi_margin: number;
}

interface Portfolio {
  id: string;
  name: string;
  investment_type: string;
  spot_value: number;
  noi_margin: number;
  assets: Asset[];
}

interface AssetExitConfig {
  exit_rent_multiple: number;
  disposition_year: number;
  disposition_costs_pct: number;
}

interface Assumptions {
  // Cashflow Period
  cashflow_period: 5 | 10 | 15;
  
  // Transaction - Entry
  acquisition_costs_pct: number;
  acquisition_fee_pct: number;
  
  // Financing
  equity_pct: number;
  additional_equity: number;
  interest_rate: number;
  financing_fee_pct: number;
  amortization_type: 'amortizing' | 'bullet' | 'hybrid';
  amortization_years: number;
  amortization_pct: number;
  
  // Operations
  cpi_annual: number;
  asset_management_fee_pct: number;
  structure_costs_annual: number;
  capex_per_sqm: number;
  yield_on_cost: number;
  leasing_fee_pct: number;
  
  // Exit - per asset
  asset_exit_configs: Record<string, AssetExitConfig>;
  default_exit_rent_multiple: number;
  default_disposition_year: number;
  default_disposition_costs_pct: number;
  exit_fee_pct: number;
  
  // Overrides
  asset_overrides: Record<string, { spot_price?: number; noi_margin?: number; annual_rent?: number }>;
  noi_margin_overrides: Record<number, number>;
  manual_overrides: {
    capex: Record<number, number>;
    leasing_ti: Record<number, number>;
    amortization_pct: Record<number, number>;
  };
}

export default function CashflowSimulatorPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [cashflowResults, setCashflowResults] = useState<any>(null);
  const [calculating, setCalculating] = useState(false);
  
  const [assumptions, setAssumptions] = useState<Assumptions>({
    // Cashflow Period
    cashflow_period: 10,
    
    // Transaction - Entry
    acquisition_costs_pct: 2.5,
    acquisition_fee_pct: 0,
    
    // Financing
    equity_pct: 30.0,
    additional_equity: 0,
    interest_rate: 4.0,
    financing_fee_pct: 1.0,
    amortization_type: 'bullet',
    amortization_years: 10,
    amortization_pct: 50,
    
    // Operations
    cpi_annual: 2.0,
    asset_management_fee_pct: 1.5,
    structure_costs_annual: 25000,
    capex_per_sqm: 5.0,
    yield_on_cost: 7.0,
    leasing_fee_pct: 0,
    
    // Exit defaults
    asset_exit_configs: {},
    default_exit_rent_multiple: 15.0,
    default_disposition_year: 10,
    default_disposition_costs_pct: 2.0,
    exit_fee_pct: 0,
    
    // Overrides
    asset_overrides: {},
    noi_margin_overrides: {},
    manual_overrides: {
      capex: {},
      leasing_ti: {},
      amortization_pct: {}
    }
  });

  useEffect(() => {
    loadPortfoliosWithAssets();
  }, []);

  const loadPortfoliosWithAssets = async () => {
    try {
      console.log('🔄 Loading portfolios...');
      
      const portfoliosRes = await fetch('/api/portfolios');
      const portfoliosData = await portfoliosRes.json();
      const portfoliosList = Array.isArray(portfoliosData) ? portfoliosData : (portfoliosData.data || []);
      
      console.log('📊 Portfolios loaded:', portfoliosList.length);
      
      if (portfoliosList.length === 0) {
        console.warn('⚠️ No portfolios found');
        setLoading(false);
        return;
      }
      
      const portfoliosWithAssets = await Promise.all(
        portfoliosList.map(async (portfolio: any) => {
          try {
            console.log(`🔄 Loading assets for portfolio: ${portfolio.name}`);
            const assetsRes = await fetch(`/api/portfolios/${portfolio.id}/assets`);
            
            if (!assetsRes.ok) {
              console.error(`❌ Error loading assets for ${portfolio.name}: ${assetsRes.status}`);
              return {
                id: portfolio.id,
                name: portfolio.name,
                investment_type: portfolio.investment_type,
                spot_value: portfolio.spot_value,
                noi_margin: portfolio.noi_margin,
                assets: []
              };
            }
            
            const assetsData = await assetsRes.json();
            const assetsList = Array.isArray(assetsData) ? assetsData : (assetsData.data || []);
            
            console.log(`✅ Loaded ${assetsList.length} assets for ${portfolio.name}`);
            
            return {
              id: portfolio.id,
              name: portfolio.name,
              investment_type: portfolio.investment_type,
              spot_value: portfolio.spot_value,
              noi_margin: portfolio.noi_margin,
              assets: assetsList.map((asset: any) => {
                let defaultSpot = asset.spot_price;
                if (!defaultSpot || defaultSpot === 0) {
                  defaultSpot = assetsList.length === 1 && portfolio.spot_value 
                    ? portfolio.spot_value 
                    : asset.purchase_price;
                }

                let defaultNoi = asset.noi_margin;
                if (!defaultNoi || defaultNoi === 0) {
                  defaultNoi = assetsList.length === 1 && portfolio.noi_margin
                    ? portfolio.noi_margin
                    : 85;
                }

                const glaValue = asset.gla || asset.total_gla || 0;

                return {
                  ...asset,
                  portfolio_id: portfolio.id,
                  portfolio_name: portfolio.name,
                  investment_type: portfolio.investment_type,
                  spot_price: defaultSpot,
                  noi_margin: defaultNoi,
                  gla: glaValue,
                  total_gla: glaValue
                };
              })
            };
          } catch (err) {
            console.error(`❌ Error loading assets for portfolio ${portfolio.id}:`, err);
            return {
              id: portfolio.id,
              name: portfolio.name,
              investment_type: portfolio.investment_type,
              spot_value: portfolio.spot_value,
              noi_margin: portfolio.noi_margin,
              assets: []
            };
          }
        })
      );
      
      const portfoliosWithActualAssets = portfoliosWithAssets.filter(p => p.assets.length > 0);
      
      console.log(`✅ Total portfolios with assets: ${portfoliosWithActualAssets.length}`);
      
      setPortfolios(portfoliosWithActualAssets);

      // Read ?ids=a,b,c from URL — pre-select assets from those portfolios
      // and skip directly to Step 2 since the user already chose on the dashboard
      const urlParams = new URLSearchParams(window.location.search);
      const idsParam = urlParams.get('ids');
      if (idsParam) {
        const requestedPortfolioIds = idsParam.split(',').filter(Boolean);
        console.log(`🔗 URL contains ?ids=`, requestedPortfolioIds);
        console.log(`📦 Available portfolios:`, portfoliosWithActualAssets.map(p => ({ id: p.id, name: p.name, assetCount: p.assets.length })));
        
        const requestedSet = new Set(requestedPortfolioIds);
        const assetIdsToSelect = new Set<string>();
        const matchedPortfolios: string[] = [];
        
        for (const portfolio of portfoliosWithActualAssets) {
          if (requestedSet.has(portfolio.id)) {
            matchedPortfolios.push(portfolio.name || portfolio.id);
            console.log(`  ✅ Match: portfolio "${portfolio.name}" has ${portfolio.assets.length} asset(s):`,
              portfolio.assets.map((a: Asset) => ({ id: a.id, name: a.name, city: a.city })));
            portfolio.assets.forEach((a: Asset) => {
              if (assetIdsToSelect.has(a.id)) {
                console.warn(`  ⚠️  Duplicate asset ID ${a.id} (${a.name}) — already in selection`);
              }
              assetIdsToSelect.add(a.id);
            });
          }
        }
        
        console.log(`🎯 Total assets to pre-select: ${assetIdsToSelect.size} from ${matchedPortfolios.length} portfolio(s)`);
        console.log(`   Asset IDs:`, Array.from(assetIdsToSelect));
        
        if (assetIdsToSelect.size > 0) {
          setSelectedAssetIds(assetIdsToSelect);
          setStep(2); // Skip Step 1 — user already picked on the dashboard
        } else {
          console.warn(`⚠️  No matching portfolios found for IDs:`, requestedPortfolioIds);
        }
      }
      
      if (portfoliosWithActualAssets.length === 0) {
        console.warn('⚠️ No portfolios have assets. You may need to upload assets first.');
      }
    } catch (error) {
      console.error('❌ Error loading portfolios:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleAsset = (assetId: string) => {
    const newSelected = new Set(selectedAssetIds);
    if (newSelected.has(assetId)) {
      newSelected.delete(assetId);
    } else {
      newSelected.add(assetId);
    }
    setSelectedAssetIds(newSelected);
  };

  const selectAllFromPortfolio = (portfolioId: string) => {
    const portfolio = portfolios.find(p => p.id === portfolioId);
    if (!portfolio) return;
    
    const newSelected = new Set(selectedAssetIds);
    portfolio.assets.forEach(asset => newSelected.add(asset.id));
    setSelectedAssetIds(newSelected);
  };

  const deselectAllFromPortfolio = (portfolioId: string) => {
    const portfolio = portfolios.find(p => p.id === portfolioId);
    if (!portfolio) return;
    
    const newSelected = new Set(selectedAssetIds);
    portfolio.assets.forEach(asset => newSelected.delete(asset.id));
    setSelectedAssetIds(newSelected);
  };

  const calculateCashflow = async () => {
    setCalculating(true);
    try {
      const selectedAssets = portfolios.flatMap(p => p.assets).filter(a => selectedAssetIds.has(a.id));
      
      const res = await fetch('/api/cashflow/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assets: selectedAssets.map(a => ({
            id: a.id,
            name: a.name,
            purchase_price: a.purchase_price,
            spot_price: assumptions.asset_overrides[a.id]?.spot_price ?? a.spot_price,
            annual_rent: assumptions.asset_overrides[a.id]?.annual_rent ?? a.annual_rent,
            noi_margin: assumptions.asset_overrides[a.id]?.noi_margin ?? a.noi_margin,
            gla: a.gla || a.total_gla || 0,
            total_gla: a.gla || a.total_gla || 0,
            exit_rent_multiple: assumptions.asset_exit_configs[a.id]?.exit_rent_multiple ?? assumptions.default_exit_rent_multiple,
            disposition_year: assumptions.asset_exit_configs[a.id]?.disposition_year ?? assumptions.default_disposition_year,
            disposition_costs_pct: assumptions.asset_exit_configs[a.id]?.disposition_costs_pct ?? assumptions.default_disposition_costs_pct
          })),
          assumptions
        })
      });
      
      const data = await res.json();
      data.assets_used = selectedAssets.map(a => ({
        id: a.id,
        name: a.name,
        city: a.city,
        spot_price: assumptions.asset_overrides[a.id]?.spot_price ?? a.spot_price,
        annual_rent: assumptions.asset_overrides[a.id]?.annual_rent ?? a.annual_rent,
        noi_margin: assumptions.asset_overrides[a.id]?.noi_margin ?? a.noi_margin,
        gla: a.gla || a.total_gla || 0,
        exit_rent_multiple: assumptions.asset_exit_configs[a.id]?.exit_rent_multiple ?? assumptions.default_exit_rent_multiple,
        disposition_year: assumptions.asset_exit_configs[a.id]?.disposition_year ?? assumptions.default_disposition_year,
        disposition_costs_pct: assumptions.asset_exit_configs[a.id]?.disposition_costs_pct ?? assumptions.default_disposition_costs_pct
      }));
      
      setCashflowResults(data);
      setStep(3);
    } catch (error) {
      console.error('Error calculating cashflow:', error);
    } finally {
      setCalculating(false);
    }
  };

  const selectedAssets = portfolios.flatMap(p => p.assets).filter(a => selectedAssetIds.has(a.id));
  const totalValue = selectedAssets.reduce((sum, a) => sum + (a.purchase_price || 0), 0);

  // 🔍 DEBUG: log what's actually being passed to Step2
  if (typeof window !== 'undefined') {
    console.log(`🔍 Render: step=${step}, selectedAssetIds.size=${selectedAssetIds.size}, selectedAssets.length=${selectedAssets.length}`);
    if (step === 2 && selectedAssets.length !== selectedAssetIds.size) {
      console.warn(`⚠️  MISMATCH: ${selectedAssetIds.size} IDs selected but only ${selectedAssets.length} assets found in portfolios`);
      console.warn(`   Selected IDs:`, Array.from(selectedAssetIds));
      console.warn(`   All loaded asset IDs:`, portfolios.flatMap(p => p.assets).map(a => a.id));
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#6D7C60] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-[#6D7C60] rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <h1 className="text-lg font-bold">RE Analyzer</h1>
              <span className="text-gray-400 text-sm ml-2">→</span>
              <span className="text-sm text-gray-300">Cashflow Simulator</span>
            </div>
            <div className="flex items-center gap-3">
              <Link 
                href="/dashboard"
                className="px-4 py-2 bg-white/10 text-white text-sm rounded-lg hover:bg-white/20 font-medium transition-colors"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        {step === 1 && (
          <Step1
            portfolios={portfolios}
            selectedAssetIds={selectedAssetIds}
            searchTerm={searchTerm}
            typeFilter={typeFilter}
            setSearchTerm={setSearchTerm}
            setTypeFilter={setTypeFilter}
            toggleAsset={toggleAsset}
            selectAllFromPortfolio={selectAllFromPortfolio}
            deselectAllFromPortfolio={deselectAllFromPortfolio}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <Step2
            selectedAssets={selectedAssets}
            assumptions={assumptions}
            setAssumptions={setAssumptions}
            onBack={() => setStep(1)}
            onNext={calculateCashflow}
            calculating={calculating}
          />
        )}

        {step === 3 && cashflowResults && (
          <Step3
            cashflowResults={cashflowResults}
            selectedAssetsCount={selectedAssetIds.size}
            totalValue={totalValue}
            cashflowPeriod={assumptions.cashflow_period}
            onEditAssumptions={() => setStep(2)}
            onNewSimulation={() => {
              setStep(1);
              setCashflowResults(null);
            }}
          />
        )}
      </main>
    </div>
  );
}