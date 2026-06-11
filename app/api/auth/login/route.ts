import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();
    
    const validCode = process.env.ACCESS_CODE;
    
    if (!validCode) {
      console.error('ACCESS_CODE not configured in environment');
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    if (code !== validCode) {
      return NextResponse.json({ success: false, error: 'Invalid access code' }, { status: 401 });
    }

    // Create response with auth cookie
    const response = NextResponse.json({ success: true });
    
    // Set cookie with timestamp (valid for 24h)
    const cookieValue = `authenticated:${Date.now()}`;
    
    response.cookies.set('re-analyzer-auth', cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours in seconds
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}