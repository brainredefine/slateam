import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });
  
  // Delete auth cookie
  response.cookies.delete('re-analyzer-auth');
  
  return response;
}

export async function GET() {
  const response = NextResponse.redirect(new URL('/login', process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'));
  
  // Delete auth cookie
  response.cookies.delete('re-analyzer-auth');
  
  return response;
}