/**
 * ============================================================================
 * CASHFLOW CALCULATION MODEL V4.4
 * ============================================================================
 * V4.2: Depreciation 80/20 fix + Tax loss carry forward
 * V4.3: Acquisition Fees, Exit Fees, Leasing Fees
 * V4.4: Cash Position tracking + Additional Equity Injections
 *   - Running cash balance per year (cumulative CF Net)
 *   - additional_equity manual override per year (pure equity, no E/D split)
 *   - Liquidity warnings when cash < 0 with no injection
 *   - KPIs adjusted: injections as negative CF in IRR, increase MOIC denominator
 */

import { NextResponse } from 'next/server';

interface Asset {
  id: string;
  name: string;
  purchase_price: number;
  spot_price: number;
  annual_rent: number;
  noi_margin: number;
  total_gla?: number;
  gla?: number;
  exit_rent_multiple: number;
  disposition_year: number;
  disposition_costs_pct: number;
}

interface Assumptions {
  cashflow_period: number;
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
  tax_rate: number;
  noi_margin_overrides: Record<number, number>;
  // V4.3: Fee percentages
  acquisition_fee_pct?: number;   // default 2%, % of base equity, financed in E/D split
  exit_fee_pct?: number;          // default 2, % of net proceeds (disp price - disp costs)
  leasing_fee_pct?: number;       // default 2, % of gross rent per year
  // V4.4: Additional equity (single lump sum, pure equity, not in E/D split)
  additional_equity?: number;     // default 0
  manual_overrides?: {
    capex?: Record<number, number>;
    leasing_ti?: Record<number, number>;
    amortization_pct?: Record<number, number>;
    // NEW V4.3: Per-year leasing fee override (absolute amount, replaces auto calc)
    leasing_fees?: Record<number, number>;
  };
}

export async function POST(request: Request) {
  try {
    const { assets, assumptions } = await request.json();
    if (!assets || assets.length === 0) {
      return NextResponse.json({ error: 'No assets provided' }, { status: 404 });
    }
    
    const fullAssumptions = {
      ...assumptions,
      tax_rate: assumptions.tax_rate ?? 15.825
    };
    
    const cashflow = calculateCashflow(assets, fullAssumptions);
    return NextResponse.json(cashflow);
  } catch (error: any) {
    console.error('Error calculating cashflow:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function calculateIRR(cashflows: number[], guess: number = 0.1): number {
  const maxIterations = 100;
  const tolerance = 0.00001;
  let currentGuess = guess;
  
  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      npv += cashflows[t] / Math.pow(1 + currentGuess, t);
      dnpv -= t * cashflows[t] / Math.pow(1 + currentGuess, t + 1);
    }
    if (Math.abs(dnpv) < 1e-10) break;
    const newGuess = currentGuess - npv / dnpv;
    if (Math.abs(newGuess - currentGuess) < tolerance) {
      return newGuess * 100;
    }
    currentGuess = newGuess;
  }
  return currentGuess * 100;
}

function calculateCashflow(assets: Asset[], assumptions: Assumptions) {
  const {
    cashflow_period,
    cpi_annual,
    asset_management_fee_pct,
    structure_costs_annual,
    capex_per_sqm,
    yield_on_cost,
    equity_pct,
    interest_rate,
    amortization_type,
    amortization_years,
    amortization_pct,
    tax_rate,
    acquisition_costs_pct,
    financing_fee_pct,
    noi_margin_overrides,
    manual_overrides
  } = assumptions;
  
  // NEW V4.3: Fee rates with defaults
  const acquisition_fee_pct = assumptions.acquisition_fee_pct ?? 2;  // 2% of equity
  const exit_fee_pct = assumptions.exit_fee_pct ?? 2;
  const leasing_fee_pct = assumptions.leasing_fee_pct ?? 2;
  
  // ============================================================================
  // DEPRECIATION — 80/20 land/building split (V4.2)
  // ============================================================================
  const depreciation_rate = 3.0;
  const building_ratio = 0.80;
  const effective_depreciation_rate = depreciation_rate * building_ratio; // 2.4%
  
  const years = Array.from({ length: cashflow_period + 1 }, (_, i) => i);
  
  // ============================================================================
  // ACQUISITION (Year 0)
  // ============================================================================
  const totalSpotValue = assets.reduce((sum, a) => sum + (a.spot_price || 0), 0);
  const totalGla = assets.reduce((sum, a) => sum + (a.gla || a.total_gla || 0), 0);
  const acquisitionCosts = totalSpotValue * (acquisition_costs_pct / 100);
  
  // V4.3: Acquisition fees = % of base equity, then financed in E/D split
  // Step 1: Base cost (before fees)
  const baseAcquisitionCost = totalSpotValue + acquisitionCosts;
  const baseEquity = baseAcquisitionCost * (equity_pct / 100);
  
  // Step 2: Acquisition fees on base equity
  const acquisitionFees = baseEquity * (acquisition_fee_pct / 100);
  
  // Step 3: Total cost includes fees → re-split E/D
  const totalAcquisitionCost = baseAcquisitionCost + acquisitionFees;
  const equityAmount = totalAcquisitionCost * (equity_pct / 100);
  const debtAmount = totalAcquisitionCost - equityAmount;
  const financingFees = debtAmount * (financing_fee_pct / 100);
  
  // Equity required = equity portion + financing fees (financing fees are pure equity)
  const totalEquityRequired = equityAmount + financingFees;
  
  // V4.2: Apply building ratio to depreciation
  const annualDepreciation = totalSpotValue * building_ratio * (depreciation_rate / 100);
  
  // ============================================================================
  // DEBT STRUCTURE
  // ============================================================================
  let annualAmortizingPayment = 0;
  let amortizingDebtAmount = 0;
  let bulletDebtAmount = 0;
  
  if (amortization_type === 'amortizing') {
    amortizingDebtAmount = debtAmount;
    bulletDebtAmount = 0;
    const monthlyRate = (interest_rate / 100) / 12;
    const numPayments = amortization_years * 12;
    if (monthlyRate > 0 && numPayments > 0) {
      const monthlyPayment = debtAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
      annualAmortizingPayment = monthlyPayment * 12;
    }
  } else if (amortization_type === 'bullet') {
    amortizingDebtAmount = 0;
    bulletDebtAmount = debtAmount;
    annualAmortizingPayment = 0;
  } else if (amortization_type === 'hybrid') {
    amortizingDebtAmount = debtAmount * (amortization_pct / 100);
    bulletDebtAmount = debtAmount * ((100 - amortization_pct) / 100);
    const monthlyRate = (interest_rate / 100) / 12;
    const numPayments = amortization_years * 12;
    if (monthlyRate > 0 && numPayments > 0 && amortizingDebtAmount > 0) {
      const monthlyPayment = amortizingDebtAmount * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
      annualAmortizingPayment = monthlyPayment * 12;
    }
  }
  
  // ============================================================================
  // ARRAYS FOR RESULTS
  // ============================================================================
  const grossRent: number[] = [];
  const nonRecoverables: number[] = [];
  const noi: number[] = [];
  const capex: number[] = [];
  const leasingTi: number[] = [];
  const leasingFees: number[] = [];     // NEW V4.3
  const cfBeforeDebt: number[] = [];
  const interest: number[] = [];
  const amortization: number[] = [];
  const assetManagementFees: number[] = [];
  const structureCosts: number[] = [];
  const debtRepayment: number[] = [];
  const dispositionPrice: number[] = [];
  const dispositionCosts: number[] = [];
  const exitFees: number[] = [];        // NEW V4.3
  const totalTax: number[] = [];
  const depreciation: number[] = [];
  const cfGross: number[] = [];
  const cfNet: number[] = [];
  
  // V4.2: Tax transparency arrays
  const taxableIncome: number[] = [];
  const taxLossCarryForward: number[] = [];
  
  let remainingAmortizingDebt = amortizingDebtAmount;
  let actualBulletDebt = bulletDebtAmount;
  const initialDebt = debtAmount;
  
  let cumulativeTiSpending = 0;
  let cumulativeCapex = 0;
  
  // V4.2: Tax loss carry forward accumulator
  let currentTaxLossCarryForward = 0;
  
  const baseAnnualRent = assets.reduce((sum, a) => sum + (a.annual_rent || 0), 0);
  
  const weightedNoiMargin = baseAnnualRent > 0 
    ? assets.reduce((sum, a) => {
        const rent = a.annual_rent || 0;
        const weight = rent / baseAnnualRent;
        return sum + (a.noi_margin || 85) * weight;
      }, 0)
    : 85;
  
  const assetsSoldByYear: Record<number, Asset[]> = {};
  assets.forEach(asset => {
    const dispYear = asset.disposition_year || cashflow_period;
    if (!assetsSoldByYear[dispYear]) assetsSoldByYear[dispYear] = [];
    assetsSoldByYear[dispYear].push(asset);
  });
  
  let remainingAssets = [...assets];
  
  // ============================================================================
  // YEARLY CALCULATIONS
  // ============================================================================
  years.forEach(year => {
    if (year === 0) {
      grossRent.push(0);
      nonRecoverables.push(0);
      noi.push(0);
      capex.push(0);
      leasingTi.push(0);
      leasingFees.push(0);
      cfBeforeDebt.push(0);
      interest.push(0);
      amortization.push(0);
      assetManagementFees.push(0);
      structureCosts.push(0);
      debtRepayment.push(0);
      dispositionPrice.push(0);
      dispositionCosts.push(0);
      exitFees.push(0);
      totalTax.push(0);
      depreciation.push(0);
      cfGross.push(-totalEquityRequired);
      cfNet.push(-totalEquityRequired);
      taxableIncome.push(0);
      taxLossCarryForward.push(0);
    } else {
      const noiMarginPct = (noi_margin_overrides[year] ?? weightedNoiMargin) / 100;
      
      const remainingBaseRent = remainingAssets.reduce((sum, a) => sum + (a.annual_rent || 0), 0);
      const additionalRentFromTi = cumulativeTiSpending * (yield_on_cost / 100);
      const adjustedBaseRent = remainingBaseRent + additionalRentFromTi;
      const yearGrossRent = adjustedBaseRent * Math.pow(1 + (cpi_annual / 100), year - 1);
      
      const yearNonRecs = yearGrossRent * (1 - noiMarginPct);
      const yearNoi = yearGrossRent - yearNonRecs;
      
      const remainingGla = remainingAssets.reduce((sum, a) => sum + (a.gla || a.total_gla || 0), 0);
      let yearCapex = remainingGla * capex_per_sqm;
      let yearLeasingTi = 0;
      
      if (manual_overrides?.capex?.[year] !== undefined) {
        yearCapex = manual_overrides.capex[year];
      }
      if (manual_overrides?.leasing_ti?.[year] !== undefined) {
        yearLeasingTi = manual_overrides.leasing_ti[year];
      }
      
      cumulativeTiSpending += yearLeasingTi;
      cumulativeCapex += yearCapex;
      
      // ====================================================================
      // NEW V4.3: Leasing Fees — auto % of gross rent OR manual override
      // ====================================================================
      let yearLeasingFees: number;
      if (manual_overrides?.leasing_fees?.[year] !== undefined) {
        yearLeasingFees = manual_overrides.leasing_fees[year];
      } else {
        yearLeasingFees = yearGrossRent * (leasing_fee_pct / 100);
      }
      
      // UPDATED V4.3: CF before debt now includes leasing fees
      const yearCfBeforeDebt = yearNoi - yearCapex - yearLeasingTi - yearLeasingFees;
      
      const yearInterestAmortizing = remainingAmortizingDebt * (interest_rate / 100);
      const yearInterestBullet = actualBulletDebt * (interest_rate / 100);
      const yearInterest = yearInterestAmortizing + yearInterestBullet;
      
      let yearAmortization = 0;
      if (manual_overrides?.amortization_pct?.[year] !== undefined) {
        yearAmortization = initialDebt * (manual_overrides.amortization_pct[year] / 100);
        if (amortization_type === 'bullet') {
          actualBulletDebt = Math.max(0, actualBulletDebt - yearAmortization);
        } else {
          remainingAmortizingDebt = Math.max(0, remainingAmortizingDebt - yearAmortization);
        }
      } else if (annualAmortizingPayment > 0 && remainingAmortizingDebt > 0) {
        yearAmortization = Math.min(annualAmortizingPayment - yearInterestAmortizing, remainingAmortizingDebt);
        yearAmortization = Math.max(0, yearAmortization);
        remainingAmortizingDebt = Math.max(0, remainingAmortizingDebt - yearAmortization);
      }
      
      const yearAssetMgmtFees = yearNoi * (asset_management_fee_pct / 100);
      const yearStructureCosts = structure_costs_annual * Math.pow(1 + (cpi_annual / 100), year - 1);
      
      let yearDispositionPrice = 0;
      let yearDispositionCosts = 0;
      let yearExitFees = 0;             // NEW V4.3
      let yearDebtRepayment = 0;
      let yearCapitalGainsTax = 0;
      
      const assetsToSellThisYear = assetsSoldByYear[year] || [];
      
      if (assetsToSellThisYear.length > 0) {
        assetsToSellThisYear.forEach(asset => {
          const assetRent = asset.annual_rent * Math.pow(1 + (cpi_annual / 100), year - 1);
          const terminalValue = assetRent * asset.exit_rent_multiple;
          yearDispositionPrice += terminalValue;
          yearDispositionCosts += terminalValue * (asset.disposition_costs_pct / 100);
          
          const assetCapitalGain = terminalValue - asset.spot_price - (cumulativeCapex * (asset.spot_price / totalSpotValue));
          if (assetCapitalGain > 0) {
            yearCapitalGainsTax += assetCapitalGain * (tax_rate / 100);
          }
          
          remainingAssets = remainingAssets.filter(a => a.id !== asset.id);
        });
        
        // NEW V4.3: Exit fees = % of net proceeds (disp price - disp costs)
        const netProceeds = yearDispositionPrice - yearDispositionCosts;
        yearExitFees = netProceeds * (exit_fee_pct / 100);
        
        if (remainingAssets.length === 0) {
          yearDebtRepayment = remainingAmortizingDebt + actualBulletDebt;
          remainingAmortizingDebt = 0;
          actualBulletDebt = 0;
        } else {
          const soldValue = assetsToSellThisYear.reduce((sum, a) => sum + a.spot_price, 0);
          const debtRepaymentRatio = soldValue / totalSpotValue;
          const proportionalDebtRepayment = (remainingAmortizingDebt + actualBulletDebt) * debtRepaymentRatio;
          yearDebtRepayment = proportionalDebtRepayment;
          
          const amortRatio = remainingAmortizingDebt / (remainingAmortizingDebt + actualBulletDebt || 1);
          remainingAmortizingDebt -= proportionalDebtRepayment * amortRatio;
          actualBulletDebt -= proportionalDebtRepayment * (1 - amortRatio);
        }
      }
      
      // V4.2: Depreciation with building ratio
      const yearDepreciation = remainingAssets.length > 0 ? annualDepreciation * (remainingAssets.reduce((sum, a) => sum + a.spot_price, 0) / totalSpotValue) : 0;
      
      // ======================================================================
      // TAX with LOSS CARRY FORWARD (V4.2)
      // ======================================================================
      const operatingTaxableIncome = yearCfBeforeDebt - yearInterest - yearDepreciation;
      const adjustedTaxableIncome = operatingTaxableIncome - currentTaxLossCarryForward;
      
      let operatingTax = 0;
      if (adjustedTaxableIncome > 0) {
        operatingTax = adjustedTaxableIncome * (tax_rate / 100);
        currentTaxLossCarryForward = 0;
      } else {
        operatingTax = 0;
        currentTaxLossCarryForward = Math.abs(adjustedTaxableIncome);
      }
      
      const yearTotalTax = operatingTax + yearCapitalGainsTax;
      
      // UPDATED V4.3: CF gross now includes exit fees
      const yearCfGross = yearCfBeforeDebt 
        - yearInterest 
        - yearAmortization 
        - yearTotalTax
        + yearDispositionPrice
        - yearDispositionCosts
        - yearExitFees             // NEW V4.3
        - yearDebtRepayment;
      
      const yearCfNet = yearCfGross - yearAssetMgmtFees - yearStructureCosts;
      
      grossRent.push(yearGrossRent);
      nonRecoverables.push(yearNonRecs);
      noi.push(yearNoi);
      capex.push(yearCapex);
      leasingTi.push(yearLeasingTi);
      leasingFees.push(yearLeasingFees);     // NEW V4.3
      cfBeforeDebt.push(yearCfBeforeDebt);
      interest.push(yearInterest);
      amortization.push(yearAmortization);
      assetManagementFees.push(yearAssetMgmtFees);
      structureCosts.push(yearStructureCosts);
      debtRepayment.push(yearDebtRepayment);
      dispositionPrice.push(yearDispositionPrice);
      dispositionCosts.push(yearDispositionCosts);
      exitFees.push(yearExitFees);           // NEW V4.3
      totalTax.push(yearTotalTax);
      depreciation.push(yearDepreciation);
      cfGross.push(yearCfGross);
      cfNet.push(yearCfNet);
      
      taxableIncome.push(adjustedTaxableIncome);
      taxLossCarryForward.push(currentTaxLossCarryForward);
    }
  });
  
  // ============================================================================
  // CASH POSITION & ADDITIONAL EQUITY (V4.4)
  // ============================================================================
  // Additional equity = single lump sum, pure equity, creates initial cash buffer
  // Not in E/D split. Paid at Y0 alongside acquisition equity.
  const additionalEquity = assumptions.additional_equity ?? 0;
  
  const cashPosition: number[] = [];
  const liquidityWarnings: boolean[] = [];
  
  let runningCash = additionalEquity; // start with buffer
  
  years.forEach((year, i) => {
    if (year === 0) {
      // Y0: additional equity is the starting cash buffer
      cashPosition.push(additionalEquity);
      liquidityWarnings.push(false);
    } else {
      // Cash = previous balance + this year's net CF
      runningCash = runningCash + cfNet[i];
      cashPosition.push(runningCash);
      liquidityWarnings.push(runningCash < -0.01);
    }
  });
  
  const hasAnyLiquidityWarnings = liquidityWarnings.some(w => w);
  
  // Total equity invested = acquisition equity + additional equity (for KPI denominator)
  const totalEquityInvested = totalEquityRequired + additionalEquity;
  
  // ============================================================================
  // KPIs - GROSS (adjusted for additional equity)
  // ============================================================================
  // For IRR: additional equity is extra money in at Y0 → increase Y0 negative CF
  const cfGrossAdjusted = cfGross.map((cf, i) => i === 0 ? cf - additionalEquity : cf);
  const cfNetAdjusted = cfNet.map((cf, i) => i === 0 ? cf - additionalEquity : cf);
  
  const irrGross = calculateIRR(cfGrossAdjusted);
  const totalProfitGross = cfGrossAdjusted.reduce((sum, cf) => sum + cf, 0);
  
  const totalDistributionsGross = cfGrossAdjusted.slice(1).reduce((sum, cf) => sum + cf, 0);
  const moicGross = totalDistributionsGross / totalEquityInvested;
  
  const operatingCfGross = cfGrossAdjusted.slice(1).filter((_, i) => dispositionPrice[i + 1] === 0);
  const avgAnnualCfGross = operatingCfGross.length > 0 
    ? operatingCfGross.reduce((sum, cf) => sum + cf, 0) / operatingCfGross.length 
    : 0;
  const cashOnCashGross = (avgAnnualCfGross / totalEquityInvested) * 100;
  
  // ============================================================================
  // KPIs - NET (adjusted for equity injections)
  // ============================================================================
  const irrNet = calculateIRR(cfNetAdjusted);
  const totalProfitNet = cfNetAdjusted.reduce((sum, cf) => sum + cf, 0);
  
  const totalDistributionsNet = cfNetAdjusted.slice(1).reduce((sum, cf) => sum + cf, 0);
  const moicNet = totalDistributionsNet / totalEquityInvested;
  
  const operatingCfNet = cfNetAdjusted.slice(1).filter((_, i) => dispositionPrice[i + 1] === 0);
  const avgAnnualCfNet = operatingCfNet.length > 0 
    ? operatingCfNet.reduce((sum, cf) => sum + cf, 0) / operatingCfNet.length 
    : 0;
  const cashOnCashNet = (avgAnnualCfNet / totalEquityInvested) * 100;
  
  const totalTiSpent = leasingTi.reduce((sum, ti) => sum + ti, 0);
  const leasingTiPerSqmYear = totalGla > 0 && cashflow_period > 0 
    ? totalTiSpent / totalGla / cashflow_period 
    : 0;
  
  return {
    years,
    gross_rental_income: grossRent,
    non_recoverables: nonRecoverables,
    noi,
    capex,
    leasing_ti: leasingTi,
    leasing_fees: leasingFees,
    cf_before_debt: cfBeforeDebt,
    interest,
    amortization,
    asset_management_fees: assetManagementFees,
    structure_costs: structureCosts,
    debt_repayment: debtRepayment,
    disposition_price: dispositionPrice,
    disposition_costs: dispositionCosts,
    exit_fees: exitFees,
    total_tax: totalTax,
    depreciation,
    cf_gross: cfGross,
    cf_net: cfNet,
    
    // V4.4: Cash position & additional equity
    additional_equity: additionalEquity,
    cash_position: cashPosition,
    liquidity_warnings: liquidityWarnings,
    total_equity_invested: totalEquityInvested,
    has_liquidity_warnings: hasAnyLiquidityWarnings,
    
    // V4.2: Tax transparency
    taxable_income: taxableIncome,
    tax_loss_carry_forward: taxLossCarryForward,
    
    total_spot_value: totalSpotValue,
    total_gla: totalGla,
    acquisition_costs: acquisitionCosts,
    acquisition_fees: acquisitionFees,
    base_acquisition_cost: baseAcquisitionCost,
    financing_fees: financingFees,
    total_acquisition_cost: totalAcquisitionCost,
    equity_amount: equityAmount,
    total_equity_required: totalEquityRequired,
    debt_amount: debtAmount,
    
    irr_gross: irrGross,
    total_profit_gross: totalProfitGross,
    moic_gross: moicGross,
    cash_on_cash_gross: cashOnCashGross,
    
    irr_net: irrNet,
    total_profit_net: totalProfitNet,
    moic_net: moicNet,
    cash_on_cash_net: cashOnCashNet,
    
    leasing_ti_per_sqm_year: leasingTiPerSqmYear,
    
    // V4.2: Depreciation metadata
    building_ratio,
    effective_depreciation_rate,
    
    assumptions_used: {
      ...assumptions,
      tax_rate,
      acquisition_fee_pct,
      exit_fee_pct,
      leasing_fee_pct,
    },
  };
}