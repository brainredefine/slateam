import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// PATCH - Update a single sale listing
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    
    // Allow updating these fields
    const allowedFields = [
      'titre1', 'titre2', 'titre3', 
      'texte1', 'texte2', 'texte3',
      'walt', 'spot_value',
      'walt_type', 'walt_label', 'walt_comment'
    ];
    const updateData: Record<string, string | number | null> = {};
    
    for (const field of allowedFields) {
      if (field in body) {
        updateData[field] = body[field] ?? null;
      }
    }
    
    const { data, error } = await supabaseAdmin
      .from('sale_listings')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Update error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET - Get a single sale listing
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const { data, error } = await supabaseAdmin
      .from('sale_listings')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Fetch error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}