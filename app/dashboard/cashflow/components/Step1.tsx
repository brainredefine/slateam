'use client';

import { useState } from 'react';
import Link from 'next/link';

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
  investment_type: string;
  noi_margin: number;
}

interface Portfolio {
  id: string;
  name: string;
  investment_type: string;
  assets: Asset[];
}

const fmt = (val: any, suffix = '') => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(num) ? '—' : num.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + suffix;
};

const fmtM = (val: any) => {
  if (val === null || val === undefined) return '—';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return '—';
  return '€' + (num / 1_000_000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M';
};

const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

const TYPE_COLORS: Record<string, string> = {
  'value-add': 'bg-purple-50 text-purple-600 border border-purple-200',
  'core': 'bg-teal-50 text-teal-600 border border-teal-200',
  'core+': 'bg-cyan-50 text-cyan-600 border border-cyan-200',
  'opportunistic': 'bg-orange-50 text-orange-600 border border-orange-200',
};

interface Step1Props {
  portfolios: Portfolio[];
  selectedAssetIds: Set<string>;
  searchTerm: string;
  typeFilter: string;
  setSearchTerm: (val: string) => void;
  setTypeFilter: (val: string) => void;
  toggleAsset: (id: string) => void;
  selectAllFromPortfolio: (id: string) => void;
  deselectAllFromPortfolio: (id: string) => void;
  onNext: () => void;
}

export default function Step1({
  portfolios,
  selectedAssetIds,
  searchTerm,
  typeFilter,
  setSearchTerm,
  setTypeFilter,
  toggleAsset,
  selectAllFromPortfolio,
  deselectAllFromPortfolio,
  onNext,
}: Step1Props) {
  const filteredPortfolios = portfolios.filter(p => {
    if (typeFilter !== 'all' && p.investment_type !== typeFilter) return false;
    if (searchTerm && !p.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const selectedAssets = portfolios.flatMap(p => p.assets).filter(a => selectedAssetIds.has(a.id));
  const totalValue = selectedAssets.reduce((sum, a) => sum + (a.purchase_price || 0), 0);
  const totalSpot = selectedAssets.reduce((sum, a) => sum + (a.spot_price || 0), 0);
  const totalRent = selectedAssets.reduce((sum, a) => sum + (a.annual_rent || 0), 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm max-w-full overflow-hidden">
      <div className="p-6 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-xl font-bold text-black mb-4">Select Assets for Simulation</h2>
        
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search portfolios..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#6D7C60] focus:ring-2 focus:ring-[#6D7C60]/20"
            />
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                typeFilter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All Types
            </button>
            <button
              onClick={() => setTypeFilter('core')}
              className={`px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                typeFilter === 'core' ? 'bg-teal-500 text-white' : 'bg-teal-50 text-teal-600 hover:bg-teal-100'
              }`}
            >
              Core
            </button>
            <button
              onClick={() => setTypeFilter('value-add')}
              className={`px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                typeFilter === 'value-add' ? 'bg-purple-500 text-white' : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
              }`}
            >
              Value-add
            </button>
          </div>
        </div>

        {selectedAssetIds.size > 0 && (
          <div className="flex items-center gap-4 p-4 bg-[#6D7C60]/5 border border-[#6D7C60]/20 rounded-lg">
            <div className="flex-1">
              <p className="text-sm text-gray-600">
                <span className="font-bold text-gray-900">{selectedAssetIds.size}</span> asset{selectedAssetIds.size !== 1 ? 's' : ''} selected
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Total Asking</p>
              <p className="font-bold text-gray-900">{fmtM(totalValue)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Total Spot</p>
              <p className="font-bold text-gray-900">{fmtM(totalSpot)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Total Rent</p>
              <p className="font-bold text-gray-900">{fmtM(totalRent)}</p>
            </div>
          </div>
        )}
      </div>

      <div className={`p-6 overflow-y-auto space-y-4 ${selectedAssetIds.size > 0 ? 'max-h-[calc(100vh-500px)]' : 'max-h-[calc(100vh-400px)]'}`}>
        {portfolios.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">No Assets Found</h3>
            <p className="text-gray-500 text-sm mb-4">
              No portfolios with assets were found.<br />
              You need to upload assets first.
            </p>
            <Link 
              href="/upload"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#6D7C60] text-white text-sm rounded-lg hover:bg-[#5a6950] font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Upload Assets
            </Link>
          </div>
        ) : filteredPortfolios.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No portfolios match your filters</p>
            <button
              onClick={() => {
                setSearchTerm('');
                setTypeFilter('all');
              }}
              className="mt-2 text-sm text-[#6D7C60] hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          filteredPortfolios.map(portfolio => {
            const portfolioAssetIds = portfolio.assets.map(a => a.id);
            const selectedFromPortfolio = portfolioAssetIds.filter(id => selectedAssetIds.has(id)).length;
            const allSelected = selectedFromPortfolio === portfolio.assets.length;
            
            return (
              <div key={portfolio.id} className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-gray-900">{portfolio.name}</h3>
                    {portfolio.investment_type && (
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${TYPE_COLORS[portfolio.investment_type] || 'bg-gray-50 text-gray-600'}`}>
                        {capitalize(portfolio.investment_type)}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      {portfolio.assets.length} asset{portfolio.assets.length !== 1 ? 's' : ''}
                    </span>
                    {selectedFromPortfolio > 0 && (
                      <span className="text-xs text-[#6D7C60] font-medium">
                        {selectedFromPortfolio} selected
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => allSelected ? deselectAllFromPortfolio(portfolio.id) : selectAllFromPortfolio(portfolio.id)}
                    className="text-xs font-medium text-[#6D7C60] hover:text-[#5a6950] transition-colors"
                  >
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                
                <div className="divide-y divide-gray-100">
                  {portfolio.assets.map(asset => (
                    <label
                      key={asset.id}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                        selectedAssetIds.has(asset.id) ? 'bg-[#6D7C60]/5' : 'hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedAssetIds.has(asset.id)}
                        onChange={() => toggleAsset(asset.id)}
                        className="w-4 h-4 text-[#6D7C60] border-gray-300 rounded focus:ring-[#6D7C60]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">
                          {asset.name || 'Unnamed Asset'}
                          {asset.city && <span className="text-gray-500"> · {asset.city}</span>}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {asset.asset_type && <span className="capitalize">{asset.asset_type}</span>}
                          {asset.asset_type && asset.total_gla && <span> · </span>}
                          {asset.total_gla && <span>{fmt(asset.total_gla)}m²</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-gray-900">{fmtM(asset.purchase_price)}</div>
                        <div className="text-xs text-gray-500">{fmtM(asset.annual_rent)}/yr</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="sticky bottom-0 p-6 border-t border-gray-200 bg-white shadow-lg flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {selectedAssetIds.size === 0 ? (
            'Select at least one asset to continue'
          ) : (
            <>
              <span className="font-semibold text-gray-900">{selectedAssetIds.size}</span> asset{selectedAssetIds.size !== 1 ? 's' : ''} ready for simulation
            </>
          )}
        </p>
        <button
          disabled={selectedAssetIds.size === 0}
          onClick={onNext}
          className={`px-6 py-2.5 text-sm font-medium text-white rounded-lg transition-colors ${
            selectedAssetIds.size === 0
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-[#6D7C60] hover:bg-[#5a6950]'
          }`}
        >
          Next: Set Assumptions →
        </button>
      </div>
    </div>
  );
}