'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';

export default function UploadPage() {
  const [documentType, setDocumentType] = useState<'portfolio' | 'asset' | 'rent-roll'>('portfolio');
  const [file, setFile] = useState<File | null>(null);
  const [emailBody, setEmailBody] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.type === 'application/pdf') {
      if (dropped.size > MAX_FILE_SIZE) {
        setError('File too large. Maximum size is 50MB.');
        return;
      }
      setFile(dropped);
      setError(null);
    }
  };

  const handleAnalyze = async () => {
    if (!file) return setError('Please select a PDF file');

    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType,
          fileBase64: base64,
          fileName: file.name,
          emailBody: emailBody || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || 'Analysis failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-[#6D7C60] rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold">RE Analyzer</h1>
                <p className="text-sm text-gray-400">Commercial Real Estate Intelligence</p>
              </div>
            </div>
            <Link 
              href="/dashboard" 
              className="px-5 py-2.5 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors font-semibold flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              Dashboard
            </Link>
            <a 
              href="/api/auth/logout" 
              className="p-2.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="Logout"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-8 py-16">
        {/* Page Title */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-black mb-4">Upload Document</h2>
          <p className="text-lg text-gray-600">Extract structured data from real estate documents using AI</p>
        </div>

        {/* Upload Form */}
        <div className="space-y-8">
          {/* Document Type */}
          <div>
            <label className="block text-sm font-bold text-black uppercase tracking-wider mb-3">
              Document Type
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'portfolio', label: 'Portfolio', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
                { value: 'asset', label: 'Single Asset', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
                { value: 'rent-roll', label: 'Rent Roll', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
              ].map(type => (
                <button
                  key={type.value}
                  onClick={() => setDocumentType(type.value as 'portfolio' | 'asset' | 'rent-roll')}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    documentType === type.value
                      ? 'border-[#6D7C60] bg-[#6D7C60]/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <svg className={`w-6 h-6 mx-auto mb-2 ${documentType === type.value ? 'text-[#6D7C60]' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={type.icon} />
                  </svg>
                  <span className={`text-sm font-semibold ${documentType === type.value ? 'text-[#6D7C60]' : 'text-gray-600'}`}>
                    {type.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* File Upload */}
          <div>
            <label className="block text-sm font-bold text-black uppercase tracking-wider mb-3">
              PDF Document
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all ${
                dragOver ? 'border-[#6D7C60] bg-[#6D7C60]/5' : 
                file ? 'border-[#6D7C60] bg-[#6D7C60]/5' : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    if (f.size > MAX_FILE_SIZE) {
                      setError('File too large. Maximum size is 50MB.');
                      return;
                    }
                    setFile(f);
                    setError(null);
                  }
                }}
                className="hidden"
              />
              {file ? (
                <div>
                  <svg className="w-12 h-12 mx-auto text-[#6D7C60] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-lg font-semibold text-black">{file.name}</p>
                  <p className="text-sm text-gray-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div>
                  <svg className="w-12 h-12 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-lg font-semibold text-gray-700">Drop your PDF here</p>
                  <p className="text-sm text-gray-500 mt-1">or click to browse</p>
                </div>
              )}
            </div>
          </div>

          {/* Email Context (Optional) */}
          <div>
            <label className="block text-sm font-bold text-black uppercase tracking-wider mb-3">
              Email Context <span className="text-gray-400 font-normal">(Optional)</span>
            </label>
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              placeholder="Paste the email body for additional context..."
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:border-[#6D7C60] focus:ring-1 focus:ring-[#6D7C60] outline-none transition-colors resize-none"
            />
          </div>

          {/* Submit Button */}
          <button
            onClick={handleAnalyze}
            disabled={!file || isAnalyzing}
            className={`w-full py-4 rounded-lg font-bold text-lg transition-all flex items-center justify-center gap-3 ${
              !file || isAnalyzing
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-[#6D7C60] text-white hover:bg-[#5a6950]'
            }`}
          >
            {isAnalyzing ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Analyze Document
              </>
            )}
          </button>
        </div>

        {/* Error */}
        {error ? (
          <div className="mt-8 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <svg className="w-5 h-5 text-red-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-semibold text-red-800">Analysis Failed</p>
              <p className="text-sm text-red-700 mt-1">{String(error)}</p>
            </div>
          </div>
        ) : null}

        {/* Result */}
        {result?.success ? (
          <div className="mt-8 bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex items-center gap-4">
              <div className="w-12 h-12 bg-[#6D7C60]/10 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-[#6D7C60]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-black">Analysis Complete</h3>
                <p className="text-sm text-gray-500">
                  {(((result.processingTimeMs as number) || 0) / 1000).toFixed(1)}s · {((result.usage as Record<string, number>)?.totalTokens || 0).toLocaleString()} tokens
                </p>
              </div>
            </div>
            
            <div className="p-6">
              <Link
                href={`/dashboard/portfolio/${result.portfolioId}`}
                className="flex items-center justify-between p-4 bg-[#6D7C60]/5 border border-[#6D7C60]/20 rounded-lg hover:bg-[#6D7C60]/10 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-8 h-8 text-[#6D7C60]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <div>
                    <p className="font-bold text-black">View in Dashboard</p>
                    <p className="text-sm text-gray-600">
                      {(result.assetIds as string[])?.length || 0} assets · {(result.tenantIds as string[])?.length || 0} tenants extracted
                    </p>
                  </div>
                </div>
                <svg className="w-5 h-5 text-[#6D7C60] group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            <details className="border-t border-gray-100">
              <summary className="px-6 py-4 cursor-pointer text-sm font-semibold text-gray-600 hover:text-black">
                View Raw Extraction
              </summary>
              <pre className="p-4 bg-black text-[#6D7C60] text-xs overflow-auto max-h-80 mx-6 mb-6 rounded-lg">
                {JSON.stringify(result.extractedData, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </main>

      {/* Footer */}
      <footer className="bg-black text-white mt-24">
        <div className="max-w-7xl mx-auto px-8 py-8">
          <p className="text-sm text-gray-400">© 2025 RE Analyzer. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}