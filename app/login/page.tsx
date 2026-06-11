'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();

      if (data.success) {
        router.push(redirect);
        router.refresh();
      } else {
        setError(data.error || 'Invalid code');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Access code"
          className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#6D7C60] focus:ring-1 focus:ring-[#6D7C60] transition-colors text-center text-lg tracking-widest"
          autoFocus
          autoComplete="off"
        />
      </div>

      {error && (
        <div className="text-red-400 text-sm text-center bg-red-400/10 py-2 rounded-lg">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!code || loading}
        className={`w-full py-3 rounded-lg font-semibold transition-all ${
          !code || loading
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-[#6D7C60] text-white hover:bg-[#5a6950]'
        }`}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Verifying...
          </span>
        ) : (
          'Access'
        )}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#6D7C60] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">RE Analyzer</h1>
          <p className="text-gray-400 mt-1">Enter access code to continue</p>
        </div>

        <Suspense fallback={<div className="text-gray-500 text-center">Loading...</div>}>
          <LoginForm />
        </Suspense>

        <p className="text-center text-gray-600 text-xs mt-8">
          Session expires after 24 hours
        </p>
      </div>
    </div>
  );
}