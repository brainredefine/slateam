// app/api/pending/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPendingImports, getPendingCount } from '@/lib/pending-imports';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET pending imports (with optional status filter)
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || undefined;
    const countOnly = url.searchParams.get('countOnly') === 'true';

    if (countOnly) {
      const count = await getPendingCount();
      return NextResponse.json({ count });
    }

    // Fetch assets for a specific portfolio (used by dropdown)
    const portfolioIdParam = url.searchParams.get('portfolioId');
    if (portfolioIdParam) {
      const { data: assets } = await supabaseAdmin
        .from('assets')
        .select('id, city, street, gla, annual_rent, portfolio_id')
        .eq('portfolio_id', portfolioIdParam)
        .order('city');
      return NextResponse.json({ assets: assets || [] });
    }

    // Also fetch portfolio and asset names for display
    const pending = await getPendingImports(status);
    
    // Enrich with portfolio/asset names
    const portfolioIds = [...new Set(pending
      .map(p => p.suggested_portfolio_id)
      .filter(Boolean))] as string[];
    
    const assetIds = [...new Set(pending
      .map(p => p.suggested_asset_id)
      .filter(Boolean))] as string[];

    let portfolioNames: Record<string, string> = {};
    let assetNames: Record<string, string> = {};

    if (portfolioIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('portfolios')
        .select('id, name')
        .in('id', portfolioIds);
      if (data) {
        portfolioNames = Object.fromEntries(data.map(p => [p.id, p.name || 'Unnamed']));
      }
    }

    if (assetIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('assets')
        .select('id, city, street')
        .in('id', assetIds);
      if (data) {
        assetNames = Object.fromEntries(data.map(a => [a.id, `${a.city || ''}${a.street ? ` - ${a.street}` : ''}`]));
      }
    }

    return NextResponse.json({
      pending,
      portfolioNames,
      assetNames,
    });
  } catch (error) {
    console.error('Error fetching pending imports:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE a pending import (soft delete → mark as rejected)
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('pending_imports')
      .update({ status: 'rejected', resolved_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}