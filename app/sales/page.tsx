'use client';

import { useState, useEffect } from 'react';

interface SaleListing {
  id: string;
  code: string;
  city: string;
  street: string;
  anchor_tenant: string;
  gla: number;
  rent_annual: number;
  status: string;
  titre1: string | null;
  titre2: string | null;
  titre3: string | null;
  texte1: string | null;
  texte2: string | null;
  texte3: string | null;
  tenant_count: number;
  // New fields
  walt: number | null;
  spot_value: number | null;
  walt_type: string | null; // 'walt' or 'other'
  walt_label: string | null;
  walt_comment: string | null;
}

export default function SaleListingsPage() {
  const [listings, setListings] = useState<SaleListing[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [projectTitle, setProjectTitle] = useState('Project Melba');
  const [projectSubtitle, setProjectSubtitle] = useState('');
  
  // Edit modal state
  const [editingListing, setEditingListing] = useState<SaleListing | null>(null);
  const [editForm, setEditForm] = useState({
    titre1: '', titre2: '', titre3: '',
    texte1: '', texte2: '', texte3: '',
    walt: '' as string | number,
    spot_value: '' as string | number,
    walt_type: 'walt',
    walt_label: '',
    walt_comment: ''
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchListings();
  }, []);

  async function fetchListings() {
    try {
      const res = await fetch('/api/sale-listings/list');
      const data = await res.json();
      if (data.data) {
        setListings(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch listings:', err);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id: string) {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  }

  function selectAll() {
    if (selected.size === listings.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(listings.map(l => l.id)));
    }
  }

  // Open edit modal
  function openEditModal(listing: SaleListing, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingListing(listing);
    setEditForm({
      titre1: listing.titre1 || '',
      titre2: listing.titre2 || '',
      titre3: listing.titre3 || '',
      texte1: listing.texte1 || '',
      texte2: listing.texte2 || '',
      texte3: listing.texte3 || '',
      walt: listing.walt ?? '',
      spot_value: listing.spot_value ?? '',
      walt_type: listing.walt_type || 'walt',
      walt_label: listing.walt_label || '',
      walt_comment: listing.walt_comment || ''
    });
  }

  // Save edit
  async function saveEdit() {
    if (!editingListing) return;
    
    setSaving(true);
    try {
      // Prepare the data, converting numbers properly
      const dataToSend = {
        titre1: editForm.titre1 || null,
        titre2: editForm.titre2 || null,
        titre3: editForm.titre3 || null,
        texte1: editForm.texte1 || null,
        texte2: editForm.texte2 || null,
        texte3: editForm.texte3 || null,
        walt: editForm.walt !== '' ? parseFloat(String(editForm.walt)) : null,
        spot_value: editForm.spot_value !== '' ? parseFloat(String(editForm.spot_value)) : null,
        walt_type: editForm.walt_type,
        walt_label: editForm.walt_label || null,
        walt_comment: editForm.walt_comment || null
      };
      
      const res = await fetch(`/api/sale-listings/${editingListing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSend)
      });
      
      if (!res.ok) throw new Error('Failed to save');
      
      // Update local state
      setListings(listings.map(l => 
        l.id === editingListing.id ? { ...l, ...dataToSend } as SaleListing : l
      ));
      setEditingListing(null);
    } catch (err) {
      console.error('Save error:', err);
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  async function generatePDF() {
    if (selected.size === 0) return;
    
    // Check for single-tenant assets without content
    const selectedListings = listings.filter(l => selected.has(l.id));
    const singleTenantMissingContent = selectedListings.filter(l => {
      const isSingleTenant = (l.tenant_count || 0) < 2;
      const hasContent = l.titre1 || l.titre2 || l.titre3 || l.texte1 || l.texte2 || l.texte3;
      return isSingleTenant && !hasContent;
    });
    
    if (singleTenantMissingContent.length > 0) {
      const codes = singleTenantMissingContent.map(l => l.code).join(', ');
      const proceed = window.confirm(
        `Warning: The following single-tenant assets have no Investment Highlights content:\n\n${codes}\n\nThey will show "No information available" in the PDF.\n\nDo you want to continue anyway?`
      );
      if (!proceed) return;
    }
    
    setGenerating(true);
    try {
      const ids = Array.from(selected).join(',');
      const url = `/api/sale-listings?ids=${ids}&title=${encodeURIComponent(projectTitle)}&subtitle=${encodeURIComponent(projectSubtitle)}`;
      
      const res = await fetch(url);
      if (!res.ok) throw new Error('PDF generation failed');
      
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${projectTitle.replace(/\s+/g, '_')}_Asset_Overview.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('PDF generation error:', err);
      alert('Failed to generate PDF');
    } finally {
      setGenerating(false);
    }
  }

  const fmt = (n: number | null) => n ? n.toLocaleString('en-US') : '—';
  const fmtCurrency = (n: number | null) => n ? `€${n.toLocaleString('en-US')}` : '—';

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#ffffff', 
      fontFamily: "'Titillium Web', sans-serif"
    }}>
      {/* Header */}
      <header style={{
        background: '#000000',
        color: '#ffffff',
        padding: '24px 40px',
        position: 'sticky',
        top: 0,
        zIndex: 40
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ 
              width: '40px', 
              height: '40px', 
              background: '#6D7C60', 
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg style={{ width: '24px', height: '24px', color: 'white' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: '700', margin: 0 }}>Sale Listings</h1>
              <p style={{ color: '#9ca3af', fontSize: '14px', margin: 0 }}>Generate PDF one-pagers</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <a href="/dashboard" style={{ 
              color: '#9ca3af', 
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: '600',
              padding: '10px 16px',
              borderRadius: '8px',
              transition: 'all 0.2s'
            }}>
              ← Dashboard
            </a>
            <a href="/api/auth/logout" style={{
              color: '#9ca3af',
              padding: '10px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }} title="Logout">
              <svg style={{ width: '20px', height: '20px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '40px' }}>

        {/* Project Info */}
        <div style={{ 
          background: 'white', 
          padding: '24px', 
          borderRadius: '8px',
          marginBottom: '24px',
          border: '1px solid #e5e5e5',
          display: 'flex',
          gap: '20px',
          alignItems: 'flex-end',
          flexWrap: 'wrap'
        }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', fontWeight: '700', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Project Title <span style={{ fontWeight: '400', color: '#888', fontSize: '11px', textTransform: 'none' }}>(use | for custom 2nd line)</span>
            </label>
            <input
              type="text"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 14px',
                border: '1px solid #e5e5e5',
                borderRadius: '4px',
                fontSize: '14px'
              }}
              placeholder="Project Melba"
            />
          </div>
          <div style={{ flex: 2, minWidth: '300px' }}>
            <label style={{ display: 'block', fontWeight: '500', fontSize: '14px', marginBottom: '6px' }}>
              Subtitle <span style={{ fontWeight: '300', color: '#888', fontSize: '12px' }}>(optional - replaces "Slate Asset Management + date")</span>
            </label>
            <input
              type="text"
              value={projectSubtitle}
              onChange={(e) => setProjectSubtitle(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
              placeholder="Leave empty for default, or enter custom text"
            />
          </div>
        </div>

        {/* Controls */}
        <div style={{ 
          background: 'white', 
          padding: '20px', 
          borderRadius: '8px',
          marginBottom: '20px',
          display: 'flex',
          gap: '20px',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}>
          <button
            onClick={selectAll}
            style={{
              padding: '8px 16px',
              background: '#f5f5f5',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            {selected.size === listings.length ? 'Deselect All' : 'Select All'}
          </button>
          
          <div style={{ flex: 1 }} />
          
          <div style={{ 
            background: '#f5f5f5', 
            padding: '8px 16px', 
            borderRadius: '4px',
            fontSize: '14px'
          }}>
            <strong>{selected.size}</strong> asset{selected.size !== 1 ? 's' : ''} selected
          </div>
          
          <button
            onClick={generatePDF}
            disabled={selected.size === 0 || generating}
            style={{
              padding: '10px 24px',
              background: selected.size === 0 ? '#ccc' : '#6D7C60',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            {generating ? (
              <>
                <span style={{ 
                  display: 'inline-block', 
                  width: '14px', 
                  height: '14px', 
                  border: '2px solid #fff',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }} />
                Generating...
              </>
            ) : (
              <>📄 Generate PDF</>
            )}
          </button>
        </div>

        {/* Listings Table */}
        <div style={{ 
          background: 'white', 
          borderRadius: '8px',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          {loading ? (
            <div style={{ padding: '60px', textAlign: 'center', color: '#666' }}>
              Loading...
            </div>
          ) : listings.length === 0 ? (
            <div style={{ padding: '60px', textAlign: 'center', color: '#666' }}>
              <p style={{ fontSize: '18px', marginBottom: '10px' }}>No sale listings yet</p>
              <p style={{ fontSize: '14px' }}>Add listings via the API or database</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8f8f8', borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ padding: '14px 16px', textAlign: 'left', width: '50px' }}>
                    <input
                      type="checkbox"
                      checked={selected.size === listings.length && listings.length > 0}
                      onChange={selectAll}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                  </th>
                  <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: '600' }}>Code</th>
                  <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: '600' }}>City</th>
                  <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: '600' }}>Tenant</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: '600' }}>GLA</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: '600' }}>Rent p.a.</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: '600' }}>Spot Value</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: '600' }}>WALT</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '600' }}>Type</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '600' }}>Edit</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing, idx) => {
                  const isSingleTenant = (listing.tenant_count || 0) < 2;
                  const multiplier = listing.spot_value && listing.rent_annual 
                    ? (listing.spot_value / listing.rent_annual).toFixed(1) 
                    : null;
                  
                  return (
                  <tr 
                    key={listing.id}
                    onClick={() => toggleSelect(listing.id)}
                    style={{ 
                      borderBottom: '1px solid #e0e0e0',
                      background: selected.has(listing.id) ? '#f0f7ff' : (idx % 2 === 0 ? 'white' : '#fafafa'),
                      cursor: 'pointer',
                      transition: 'background 0.15s'
                    }}
                  >
                    <td style={{ padding: '12px 16px' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(listing.id)}
                        onChange={() => toggleSelect(listing.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: '600' }}>{listing.code}</td>
                    <td style={{ padding: '12px 16px' }}>{listing.city}</td>
                    <td style={{ padding: '12px 16px' }}>{listing.anchor_tenant || '—'}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {fmt(listing.gla)} m²
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {fmtCurrency(listing.rent_annual)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {listing.spot_value ? (
                        <span>
                          {fmtCurrency(listing.spot_value)}
                          {multiplier && <span style={{ color: '#666', marginLeft: '4px' }}>({multiplier}×)</span>}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {listing.walt_type === 'other' 
                        ? (listing.walt_comment || '—')
                        : (listing.walt ? `${listing.walt} yrs` : '—')}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px' }}>
                      {isSingleTenant ? (
                        <span style={{ 
                          padding: '3px 8px', 
                          borderRadius: '4px',
                          background: '#fff3e0',
                          color: '#e65100'
                        }}>
                          Single
                        </span>
                      ) : (
                        <span style={{ 
                          padding: '3px 8px', 
                          borderRadius: '4px',
                          background: '#e8f5e9',
                          color: '#2e7d32'
                        }}>
                          Multi ({listing.tenant_count})
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <button
                        onClick={(e) => openEditModal(listing, e)}
                        style={{
                          padding: '5px 10px',
                          background: '#f5f5f5',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        ✏️ Edit
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Quick Stats */}
        {listings.length > 0 && (
          <div style={{ 
            marginTop: '20px', 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '15px'
          }}>
            <div style={{ background: 'white', padding: '20px', borderRadius: '8px' }}>
              <div style={{ color: '#666', fontSize: '13px', marginBottom: '5px' }}>Total Assets</div>
              <div style={{ fontSize: '24px', fontWeight: '700' }}>{listings.length}</div>
            </div>
            <div style={{ background: 'white', padding: '20px', borderRadius: '8px' }}>
              <div style={{ color: '#666', fontSize: '13px', marginBottom: '5px' }}>Total GLA</div>
              <div style={{ fontSize: '24px', fontWeight: '700' }}>
                {fmt(listings.reduce((s, l) => s + (l.gla || 0), 0))} m²
              </div>
            </div>
            <div style={{ background: 'white', padding: '20px', borderRadius: '8px' }}>
              <div style={{ color: '#666', fontSize: '13px', marginBottom: '5px' }}>Total Rent p.a.</div>
              <div style={{ fontSize: '24px', fontWeight: '700' }}>
                {fmtCurrency(listings.reduce((s, l) => s + (l.rent_annual || 0), 0))}
              </div>
            </div>
            <div style={{ background: 'white', padding: '20px', borderRadius: '8px' }}>
              <div style={{ color: '#666', fontSize: '13px', marginBottom: '5px' }}>Multi-Tenant</div>
              <div style={{ fontSize: '24px', fontWeight: '700' }}>
                {listings.filter(l => (l.tenant_count || 0) >= 2).length} / {listings.length}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingListing ? (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setEditingListing(null)}
        >
          <div 
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '30px',
              width: '90%',
              maxWidth: '800px',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 5px 0', fontSize: '22px' }}>
              Edit {editingListing.code} - {editingListing.city}
            </h2>
            <p style={{ color: '#666', fontSize: '14px', marginBottom: '25px' }}>
              Key metrics and Investment Highlights content
            </p>
            
            {/* Key Metrics Section */}
            <div style={{ 
              marginBottom: '25px', 
              padding: '20px', 
              background: '#f0f7ff', 
              borderRadius: '8px',
              border: '1px solid #cce0ff'
            }}>
              <div style={{ fontWeight: '600', marginBottom: '15px', fontSize: '15px', color: '#1a56db' }}>
                📊 Key Metrics
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                {/* Spot Value */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                    Spot Value (€)
                  </label>
                  <input
                    type="number"
                    value={editForm.spot_value}
                    onChange={(e) => setEditForm({ ...editForm, spot_value: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px'
                    }}
                    placeholder="e.g. 50000000"
                  />
                  <span style={{ fontSize: '11px', color: '#888' }}>
                    Will display as "€ 50m (15×) [2.1k €/m²]"
                  </span>
                </div>
                
                {/* WALT */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                    WALT (years)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={editForm.walt}
                    onChange={(e) => setEditForm({ ...editForm, walt: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px'
                    }}
                    placeholder="e.g. 5.2"
                    disabled={editForm.walt_type === 'other'}
                  />
                </div>
              </div>
              
              {/* WALT Type Toggle */}
              <div style={{ marginTop: '15px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editForm.walt_type === 'other'}
                    onChange={(e) => setEditForm({ 
                      ...editForm, 
                      walt_type: e.target.checked ? 'other' : 'walt',
                      walt: e.target.checked ? '' : editForm.walt
                    })}
                    style={{ width: '16px', height: '16px' }}
                  />
                  <span style={{ fontSize: '13px' }}>Use custom label instead of WALT</span>
                </label>
                
                {editForm.walt_type === 'other' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '15px', marginTop: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                        Custom Label
                      </label>
                      <input
                        type="text"
                        value={editForm.walt_label}
                        onChange={(e) => setEditForm({ ...editForm, walt_label: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '14px'
                        }}
                        placeholder="e.g. Lease Structure"
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                        Custom Value
                      </label>
                      <input
                        type="text"
                        value={editForm.walt_comment}
                        onChange={(e) => setEditForm({ ...editForm, walt_comment: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '14px'
                        }}
                        placeholder="e.g. Triple Net"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Investment Highlights Section */}
            <div style={{ fontWeight: '600', marginBottom: '15px', fontSize: '15px' }}>
              📝 Investment Highlights (for single-tenant display)
            </div>
            
            {[1, 2, 3].map(i => (
              <div key={i} style={{ 
                marginBottom: '20px', 
                padding: '15px', 
                background: '#f8f8f8', 
                borderRadius: '8px' 
              }}>
                <div style={{ fontWeight: '600', marginBottom: '10px', fontSize: '14px' }}>
                  Section {i}
                </div>
                <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1', minWidth: '150px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                      Title
                    </label>
                    <input
                      type="text"
                      value={editForm[`titre${i}` as keyof typeof editForm] as string}
                      onChange={(e) => setEditForm({ ...editForm, [`titre${i}`]: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontSize: '14px'
                      }}
                      placeholder={`e.g. ${i === 1 ? 'Re-letting potential' : i === 2 ? 'Acquisition appetite' : 'Alternative use'}`}
                    />
                  </div>
                  <div style={{ flex: '2', minWidth: '250px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                      Text
                    </label>
                    <input
                      type="text"
                      value={editForm[`texte${i}` as keyof typeof editForm] as string}
                      onChange={(e) => setEditForm({ ...editForm, [`texte${i}`]: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontSize: '14px'
                      }}
                      placeholder="Description text..."
                    />
                  </div>
                </div>
              </div>
            ))}
            
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                onClick={() => setEditingListing(null)}
                style={{
                  padding: '10px 20px',
                  background: '#f5f5f5',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                style={{
                  padding: '10px 20px',
                  background: '#6D7C60',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}