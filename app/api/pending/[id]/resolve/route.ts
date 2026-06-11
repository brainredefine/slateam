// app/api/pending/[id]/resolve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { resolvePendingImport } from '@/lib/pending-imports';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const { action, portfolioId, assetId, cityMapping, mergeStrategy } = body;

    if (!action || !['apply', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const result = await resolvePendingImport(id, {
      action,
      portfolioId,
      assetId,
      cityMapping,
      mergeStrategy,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error resolving pending import:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET available portfolios and assets for the dropdown
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the pending import
    const { data: pending } = await supabaseAdmin
      .from('pending_imports')
      .select('*')
      .eq('id', id)
      .single();

    if (!pending) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Get all portfolios for dropdown
    const { data: portfolios } = await supabaseAdmin
      .from('portfolios')
      .select('id, name, number_of_assets, total_gla, annual_rent_income, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    // If we have a suggested portfolio, get its assets too
    let assets: Array<Record<string, unknown>> = [];
    const portfolioId = pending.suggested_portfolio_id || pending.confirmed_portfolio_id;
    
    if (portfolioId) {
      const { data: portfolioAssets } = await supabaseAdmin
        .from('assets')
        .select('id, city, street, gla, annual_rent, portfolio_id')
        .eq('portfolio_id', portfolioId)
        .order('city');
      assets = portfolioAssets || [];
    }

    // Also get all assets if it's a tenant list (may need different portfolio's assets)
    let allAssets: Array<Record<string, unknown>> = [];
    if (pending.type === 'tenant-list') {
      const { data: allData } = await supabaseAdmin
        .from('assets')
        .select('id, city, street, gla, annual_rent, portfolio_id')
        .order('city')
        .limit(200);
      allAssets = allData || [];
    }

    return NextResponse.json({
      pending,
      portfolios: portfolios || [],
      assets,
      allAssets,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}