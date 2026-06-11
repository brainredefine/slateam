import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

// Allow longer execution for PDF generation with image compression
export const maxDuration = 120;

// Chromium binary URL from official Sparticuz releases
// See: https://github.com/Sparticuz/chromium/releases
const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar';

// Supabase Storage base URL - adjust to your project
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const STORAGE_BUCKET = 'images'; // Your bucket name

// Image compression cache to avoid re-compressing the same image
const imageCache = new Map<string, string>();

// Tenant type
interface Tenant {
  id: string;
  tenant_name: string;
  gla: number;
  monthly_rent: number;
  walt: number;
  options: string | null;
}

// Compress and convert image to base64
async function compressImage(url: string, width = 800, quality = 70): Promise<string> {
  if (!url) return '';
  
  // Check cache first
  const cacheKey = `${url}-${width}-${quality}`;
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
  }
  
  try {
    const response = await fetch(url);
    if (!response.ok) return '';
    
    const buffer = Buffer.from(await response.arrayBuffer());
    
    const compressed = await sharp(buffer)
      .resize(width, Math.round(width * 0.75), { fit: 'cover' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    
    const base64 = `data:image/jpeg;base64,${compressed.toString('base64')}`;
    imageCache.set(cacheKey, base64);
    return base64;
  } catch (error) {
    console.error('Image compression failed:', url, error);
    return '';
  }
}

// Compress logo (PNG with transparency)
async function compressLogo(url: string): Promise<string> {
  if (!url) return '';
  
  if (imageCache.has(url)) {
    return imageCache.get(url)!;
  }
  
  try {
    const response = await fetch(url);
    if (!response.ok) return '';
    
    const buffer = Buffer.from(await response.arrayBuffer());
    
    const compressed = await sharp(buffer)
      .resize(300, null, { fit: 'inside' })
      .png({ quality: 65, compressionLevel: 9 })
      .toBuffer();
    
    const base64 = `data:image/png;base64,${compressed.toString('base64')}`;
    imageCache.set(url, base64);
    return base64;
  } catch (error) {
    console.error('Logo compression failed:', error);
    return '';
  }
}

// Build image URL from code
function getImageUrl(code: string | null, type: 'photo' | 'catchment'): string | null {
  if (!code || !SUPABASE_URL) return null;
  const filename = type === 'photo' ? `${code}.jpg` : `c-${code}.png`;
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${filename}`;
}

// Get logo URL
function getLogoUrl(): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/logo.png`;
}

// Format number with thousands separator
function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return '—';
  return num.toLocaleString('en-US');
}

// Format currency
function formatCurrency(num: number | null | undefined): string {
  if (num === null || num === undefined) return '—';
  return `€ ${num.toLocaleString('en-US')}`;
}

// Format large numbers in short form (e.g., 50M, 2.12k)
function formatShort(num: number | null | undefined): string {
  if (num === null || num === undefined) return '—';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(2) + 'k';
  return num.toFixed(0);
}

// Format €/m² with full number (no 'k' abbreviation)
function formatFullNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return '—';
  return num.toLocaleString('en-US');
}

// Format Spot Value - only values: "€ 50M · 15.0× · € 1,891"
function formatSpotValue(spotValue: number | null | undefined, rentAnnual: number | null | undefined, gla: number | null | undefined): string {
  if (!spotValue) return '—';
  const parts = [`€ ${formatShort(spotValue)}`];
  if (rentAnnual && rentAnnual > 0) {
    const multiplier = spotValue / rentAnnual;
    parts.push(`${multiplier.toFixed(1)}×`);
  }
  if (gla && gla > 0) {
    const valuePerSqm = spotValue / gla;
    parts.push(`€ ${formatFullNumber(Math.round(valuePerSqm))}`);
  }
  return parts.join(' · ');
}

// Generate Cover Page HTML
function generateCoverPageHTML(title: string, subtitle: string, photoUrls: string[], logoUrl: string): string {
  // Use first 4 photos for the grid
  const photos = photoUrls.slice(0, 4);
  const photoCount = photos.length;
  
  // Title logic: if no |, add "Asset Overview" as second line
  let titleLines: string[];
  if (title.includes('|')) {
    titleLines = title.split('|').map(line => line.trim());
  } else {
    titleLines = [title.trim(), 'Asset Overview'];
  }
  
  // Get current month and year
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const now = new Date();
  const monthYear = `${months[now.getMonth()]} ${now.getFullYear()}`;
  
  // Footer content: subtitle replaces default if provided
  const hasSubtitle = subtitle && subtitle.trim().length > 0;
  const subtitleLines = hasSubtitle ? subtitle.split('|').map(line => line.trim()) : [];
  
  // Generate photo grid based on count
  // 0-1: no photos, 2: 1 top + 1 bottom, 3: 2 top + 1 bottom, 4+: 2x2 grid
  let photosGridHTML = '';
  let photosGridClass = 'photos-grid';
  
  if (photoCount <= 1) {
    // No photo grid for 0-1 assets
    photosGridHTML = '';
    photosGridClass = 'photos-grid photos-none';
  } else if (photoCount === 2) {
    // 2 photos: stacked vertically
    photosGridClass = 'photos-grid photos-two';
    photosGridHTML = `
      <div class="photo-cell photo-top">
        ${photos[0] ? `<img src="${photos[0]}" alt="Property">` : ''}
      </div>
      <div class="photo-cell photo-bottom">
        ${photos[1] ? `<img src="${photos[1]}" alt="Property">` : ''}
      </div>
    `;
  } else if (photoCount === 3) {
    // 3 photos: 2 top + 1 bottom
    photosGridClass = 'photos-grid photos-three';
    photosGridHTML = `
      <div class="photo-row-top">
        <div class="photo-cell">
          ${photos[0] ? `<img src="${photos[0]}" alt="Property">` : ''}
        </div>
        <div class="photo-cell">
          ${photos[1] ? `<img src="${photos[1]}" alt="Property">` : ''}
        </div>
      </div>
      <div class="photo-cell photo-bottom-full">
        ${photos[2] ? `<img src="${photos[2]}" alt="Property">` : ''}
      </div>
    `;
  } else {
    // 4+ photos: 2x2 grid
    photosGridHTML = photos.map(url => `
      <div class="photo-cell">
        ${url ? `<img src="${url}" alt="Property">` : ''}
      </div>
    `).join('');
  }
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700;800&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    html, body {
      width: 1280px;
      height: 960px;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Inter', sans-serif;
      background: #6D7C60;
    }
    
    .page {
      width: 1280px;
      height: 960px;
      padding: 20px 44px 45px 51px;
      display: flex;
      flex-direction: column;
      background: #6D7C60;
    }
    
    .content {
      flex: 1;
      display: flex;
      gap: 15px;
      align-items: flex-start;
      padding-top: 25px;
    }
    
    .title-section {
      width: 52%;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      padding-top: 18px;
      border-top: 1px solid rgba(255, 255, 255, 0.8);
    }
    
    .title-content {
      padding-bottom: 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.8);
    }
    
    .title {
      font-size: 48px;
      font-weight: 475;
      color: white;
      line-height: 1.15;
      letter-spacing: -0.02em;
    }
    
    .title-line2 {
      display: block;
      padding-top: 4px;
    }
    
    .title-footer {
      padding-top: 20px;
    }
    
    .company-name {
      font-size: 26px;
      font-weight: 300;
      color: rgba(255, 255, 255, 0.9);
      margin-bottom: 5px;
      letter-spacing: -0.02em;
    }
    
    .date {
      font-size: 24px;
      font-weight: 300;
      color: rgba(255, 255, 255, 0.9);
      letter-spacing: -0.02em;
    }
    
    .custom-subtitle {
      font-size: 26px;
      font-weight: 200;
      color: rgba(255, 255, 255, 0.9);
      line-height: 1.5;
      letter-spacing: -0.02em;
    }
    
    .custom-subtitle-line2 {
      font-size: 20px;
      font-weight: 200;
      color: rgba(255, 255, 255, 0.9);
      line-height: 1.5;
      letter-spacing: -0.02em;
      display: inline;
    }
    
    /* Default 2x2 grid for 4 photos */
    .photos-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      gap: 25px;
      width: 600px;
      height: 600px;
      margin-left: auto;
      margin-top: -3px;
    }
    
    /* No photos (0-1 assets) */
    .photos-grid.photos-none {
      display: none;
    }
    
    /* 2 photos: stacked vertically */
    .photos-grid.photos-two {
      display: flex;
      flex-direction: column;
      gap: 25px;
    }
    
    .photos-grid.photos-two .photo-cell {
      flex: 1;
      width: 100%;
    }
    
    /* 3 photos: 2 top + 1 bottom */
    .photos-grid.photos-three {
      display: flex;
      flex-direction: column;
      gap: 25px;
    }
    
    .photos-grid.photos-three .photo-row-top {
      display: flex;
      gap: 25px;
      flex: 1;
    }
    
    .photos-grid.photos-three .photo-row-top .photo-cell {
      flex: 1;
      height: 100%;
    }
    
    .photos-grid.photos-three .photo-bottom-full {
      flex: 1;
      width: 100%;
    }
    
    .photo-cell {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    
    .photo-cell img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: grayscale(100%);
    }
    
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding-top: 15px;
    }
    
    .footer-left {
      display: flex;
      align-items: center;
    }
    
    .logo {
      height: 170px;
      width: auto;
    }
    
    .footer-center {
      flex: 1;
      text-align: center;
    }
    
    .confidential {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 300;
      font-style: italic;
    }
    
    .footer-right {
      width: 170px;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="content">
      <div class="title-section">
        <div class="title-content">
          <h1 class="title">${titleLines[0]}${titleLines.length > 1 ? '<span class="title-line2">' + titleLines.slice(1).join('<br>') + '</span>' : ''}</h1>
        </div>
        <div class="title-footer">
          ${hasSubtitle 
            ? `<p class="custom-subtitle">${subtitleLines[0]}${subtitleLines.length > 1 ? '<br><span class="custom-subtitle-line2">' + subtitleLines.slice(1).join('<br>') + '</span>' : ''}</p>`
            : `<p class="company-name">Slate Asset Management</p>
               <p class="date">${monthYear}</p>`
          }
        </div>
      </div>
      <div class="${photosGridClass}">
        ${photosGridHTML}
      </div>
    </div>
    <div class="footer">
      <div class="footer-left">
        <img src="${logoUrl}" alt="Slate" class="logo">
      </div>
      <div class="footer-center">
        <p class="confidential">Confidential; Not for Distribution; For Institutional Use Only</p>
      </div>
      <div class="footer-right"></div>
    </div>
  </div>
</body>
</html>`;
}

// Generate End Page HTML (Disclaimer)
function generateEndPageHTML(pageNumber: number, logoUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700;800&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    :root {
      --text-black: #000000;
      --text-gray: #555555;
      --divider: #888888;
    }
    
    html, body {
      width: 1280px;
      height: 960px;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Inter', sans-serif;
      background: white;
    }
    
    .page {
      width: 1280px;
      height: 960px;
      padding: 40px 55px 35px 55px;
      display: flex;
      flex-direction: column;
      background: white;
    }
    
    .header {
      margin-bottom: 15px;
    }
    
    .header h1 {
      font-size: 25px;
      font-weight: 500;
      letter-spacing: 0em;
      color: var(--text-black);
      margin-bottom: 8px;
      margin-left: 5px;
    }
    
    .main-content {
      flex: 1;
      border-top: 0.5px solid var(--divider);
      border-bottom: 0.5px solid var(--divider);
      padding: 25px 10px;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
    }
    
    .disclaimer-text {
      font-size: 12px;
      line-height: 1.8;
      color: var(--text-gray);
      font-weight: 300;
    }
    
    .disclaimer-text p {
      margin-bottom: 14px;
      text-align: justify;
    }
    
    .disclaimer-text p:last-child {
      margin-bottom: 0;
    }
    
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 12px;
      padding-top: 10px;
    }
    
    .footer-left {
      display: flex;
      align-items: center;
      gap: 15px;
    }
    
    .logo {
      height: 60px;
      width: auto;
    }
    
    .footer-right {
      font-size: 15px;
      color: var(--text-black);
      font-weight: 200;
      letter-spacing: 0em;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>Disclaimer</h1>
    </div>
    
    <div class="main-content">
      <div class="disclaimer-text">
        <p>This document and the information set forth herein, is confidential and has been prepared for informational and discussion purposes only. Any reproduction or distribution of this presentation, in whole or in part, or the disclosure of its contents, without the prior written consent of Slate Asset Management L.P., its affiliates and managed investment vehicles (collectively, "Slate") is prohibited. All recipients of this presentation agree they will keep confidential all information contained herein that is not already in the public domain. By accepting this presentation, each reader agrees to the foregoing.</p>
        
        <p>The information provided herein is not intended to be a complete summary of all available data and includes assumptions and opinions of Slate, which are subject to change without notice. Certain information is based on third-party sources, which information, although believed to be accurate, has not been independently verified, may be subject to change without notice to Slate and no warranty is made with respect thereto.</p>
        
        <p>The performance figures set forth in these materials are provided to you with the understanding that, as a sophisticated investor, you understand the inherent limitations and assumptions of such illustrations, will not rely on them in making any investment decision, and will use them only for the purpose of evaluating your preliminary interest in investing in a transaction of the type described in these materials. Performance data represents past performance. Past performance of investments described herein is provided for illustrative purposes only and is not necessarily indicative of future results. No representation or guarantee is made that Slate will or is likely to achieve its investment objectives or be able to avoid losses. Although we believe that all statements and expectations are based upon reasonable assumptions, we cannot assure you that our goals will be achieved.</p>
        
        <p>Unless otherwise noted, performance is expressed in Euros.</p>
        
        <p>Transactions and investments of the type described herein may involve a high degree of risk, and the value of such investments may be highly volatile. Such risks may include, without limitation, risk to adverse or unanticipated market developments, risk of counterparty of issuer default, and risk of liquidity. Investors should have the financial ability and willingness to accept the risk characteristics of Slate's investments. Investors may lose some or all of their investment. This presentation does not disclose all of the significant aspects in connection with investments of the types set forth herein, including all relevant risk factors and any legal, tax, and accounting considerations applicable to them. Investors should make their own investigations and evaluations of an investment in Slate. Please refer to a confidential private placement memorandum, or most recent reporting issuer public disclosures, as applicable, of the relevant entity described in the Select Company Profile for a full description of the relevant risks and other important information relating to an investment discussed herein.</p>
        
        <p>This presentation is neither an offer to sell nor a solicitation of an offer to purchase securities. This presentation is not, and may not be used as, a recommendation of any investment program or vehicle.</p>
        
        <p>Any time-sensitive representations and warranties in this presentation are made as of the date set forth on the cover, unless stated otherwise. Each prospective investor should consult with its own attorneys, business advisors and tax advisors as to legal, business, tax and related matters concerning the information contained herein.</p>
        
        <p>The views expressed herein represent the opinions of Slate and are not intended as a forecast or guarantee of future results.</p>
        
        <p>Certain information contained in this presentation constitutes "forward-looking statements" as defined in applicable securities legislation, which can be identified by the use of forward-looking terminology such as, but not limited to, "may", "might" "will", "should", "expect", "anticipate", "plan", "project", "estimate", "intend", "continue", "target", "believe", "potential", the negatives thereof, other variations thereon or comparable terminology. Due to various risks and uncertainties, including changes to financial, market, economic or legal conditions, actual events or results or the actual performance of the Slate may differ materially from those reflected or contemplated in such forward-looking statements.</p>
      </div>
    </div>
    
    <div class="footer">
      <div class="footer-left">
        <img src="${logoUrl}" alt="Slate" class="logo">
      </div>
      <div class="footer-right">
        Slate Asset Management | ${pageNumber}
      </div>
    </div>
  </div>
</body>
</html>`;
}

// Process tenants: top 5 + Sonstige if more than 5
function processTenantsForDisplay(tenants: Tenant[]): Tenant[] {
  // Always sort by monthly_rent descending (highest first)
  const sorted = [...tenants].sort((a, b) => (b.monthly_rent || 0) - (a.monthly_rent || 0));
  
  if (sorted.length <= 5) return sorted;
  
  const top5 = sorted.slice(0, 5);
  const rest = sorted.slice(5);
  
  // Calculate Sonstige (others) aggregated values
  const sonstigeGla = rest.reduce((sum, t) => sum + (t.gla || 0), 0);
  const sonstigeRent = rest.reduce((sum, t) => sum + (t.monthly_rent || 0), 0);
  
  // Weighted average WALT for Sonstige
  const totalRentForWalt = rest.reduce((sum, t) => sum + (t.monthly_rent || 0), 0);
  const sonstigeWalt = totalRentForWalt > 0 
    ? rest.reduce((sum, t) => sum + (t.walt || 0) * (t.monthly_rent || 0), 0) / totalRentForWalt
    : 0;
  
  const sonstige: Tenant = {
    id: 'sonstige',
    tenant_name: 'Sonstige',
    gla: sonstigeGla,
    monthly_rent: sonstigeRent,
    walt: sonstigeWalt,
    options: `${rest.length} tenants`
  };
  
  return [...top5, sonstige];
}

// Generate rent roll HTML table
function generateRentRollHTML(tenants: Tenant[]): string {
  const displayTenants = processTenantsForDisplay(tenants);
  
  // Calculate totals
  const totalGla = tenants.reduce((sum, t) => sum + (t.gla || 0), 0);
  const totalRent = tenants.reduce((sum, t) => sum + (t.monthly_rent || 0), 0);
  const totalRentForWalt = tenants.reduce((sum, t) => sum + (t.monthly_rent || 0), 0);
  const avgWalt = totalRentForWalt > 0
    ? tenants.reduce((sum, t) => sum + (t.walt || 0) * (t.monthly_rent || 0), 0) / totalRentForWalt
    : 0;
  
  const rows = displayTenants.map(t => `
    <tr class="${t.id === 'sonstige' ? 'sonstige-row' : ''}">
      <td>${t.tenant_name}</td>
      <td>${formatNumber(t.gla)} m²</td>
      <td>€ ${formatNumber(Math.round(t.monthly_rent))}</td>
      <td>${t.walt > 0 ? t.walt.toFixed(1) : '—'}</td>
      <td>${t.options || '—'}</td>
    </tr>
  `).join('');
  
  return `
    <div class="section-title">Rent Roll</div>
    <div class="rentroll-wrapper">
      <table class="rentroll-table">
        <thead>
          <tr>
            <th>Tenant</th>
            <th>GLA</th>
            <th>Monthly Net Rent</th>
            <th>WALT</th>
            <th>Options</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot>
          <tr>
            <td><strong>Total</strong></td>
            <td><strong>${formatNumber(totalGla)} m²</strong></td>
            <td><strong>€ ${formatNumber(Math.round(totalRent))}</strong></td>
            <td><strong>${avgWalt.toFixed(1)}</strong></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

// Generate Alternative Use Scenarios HTML
function generateAlternativeUseHTML(asset: Record<string, unknown>): string {
  // Use new flexible fields: titre1/2/3, texte1/2/3
  const sections = [
    { title: asset.titre1, text: asset.texte1 },
    { title: asset.titre2, text: asset.texte2 },
    { title: asset.titre3, text: asset.texte3 },
  ].filter(s => s.title || s.text);
  
  if (sections.length === 0) {
    return `<div class="section-title">Investment Highlights</div>
            <div class="use-scenario"><span class="use-scenario-text">No information available</span></div>`;
  }
  
  return `
    <div class="section-title">Investment Highlights</div>
    ${sections.map(s => `
      <div class="use-scenario">
        ${s.title ? `<span class="use-scenario-title">${s.title}:</span>` : ''}
        ${s.text ? `<span class="use-scenario-text"> ${s.text}</span>` : ''}
      </div>
    `).join('')}
  `;
}

// Generate HTML for a single asset
function generateAssetHTML(asset: Record<string, unknown>, tenants: Tenant[], pageNumber: number, logoUrl: string): string {
  const address = [asset.street, `${asset.postal_code} ${asset.city}`].filter(Boolean).join(', ');
  
  // Auto-construct image URLs if not provided
  const photoUrl = asset.photo_url || getImageUrl(asset.code as string, 'photo');
  const catchmentUrl = asset.catchment_map_url || getImageUrl(asset.code as string, 'catchment');
  
  // Bottom-right content: Rent Roll if 2+ tenants, otherwise Alternative Use Scenarios
  const showRentRoll = tenants.length >= 2;
  const bottomRightContent = showRentRoll 
    ? generateRentRollHTML(tenants)
    : generateAlternativeUseHTML(asset);
  const bottomRightClass = showRentRoll ? 'quadrant bottom-right rentroll-mode' : 'quadrant bottom-right';
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600;700;800&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    :root {
      --text-black: #000000;
      --border-light: #cccccc;
      --divider: #888888;
      --header-green: #6D7C60;
    }
    
    html, body {
      width: 1280px;
      height: 960px;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      font-weight: 300;
      letter-spacing: 0em;
      line-height: 1.4;
      color: var(--text-black);
      background: white;
    }
    
    .page {
      width: 1280px;
      height: 960px;
      padding: 40px 55px 35px 55px;
      display: flex;
      flex-direction: column;
      background: white;
    }
    
    .header { 
      margin-bottom: 15px;
      flex-shrink: 0;
    }
    
    .header h1 {
      font-size: 48px;
      font-weight: 550;
      letter-spacing: -0.02em;
      color: var(--text-black);
    }
    
    .content {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 52% 48%;
      min-height: 0;
      border-top: 0.1px solid var(--divider);
      border-bottom: 0.1px solid var(--divider);
    }
    
    /* Ultra thin lines using pseudo-elements */
    .content::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: var(--divider);
      transform: scaleY(0.3);
    }
    
    .quadrant { 
      padding: 15px 0; 
      min-height: 0; 
      overflow: hidden; 
      display: flex; 
      flex-direction: column;
      position: relative;
    }
    
    .top-left { 
      border-right: 0.5px solid var(--divider); 
      border-bottom: 0.5px solid var(--divider); 
      padding: 5px 25px 15px 0;
    }
    .top-right { 
      border-bottom: 0.5px solid var(--divider); 
      padding: 5px 5px 15px 20px;
    }
    .bottom-left { 
      border-right: 0.5px solid var(--divider); 
      padding: 20px 25px 15px 0;
    }
    .bottom-right {
      padding: 10px 0 15px 20px;
    }
    
    .bottom-right.rentroll-mode {
      padding: 5px 0 10px 15px;
    }
    
    .rentroll-wrapper {
      flex: 1;
      display: flex;
      align-items: flex-start;
    }
    
    .rentroll-wrapper .rentroll-table {
      width: 100%;
    }
    
    /* Scale down borders to make them thinner */
    .top-left::after,
    .top-right::after,
    .bottom-left::after {
      content: '';
      position: absolute;
    }
    
    .section-title {
      font-size: 25px;
      font-weight: 500;
      letter-spacing: 0em;
      color: var(--text-black);
      margin-bottom: 8px;
      margin-left: 5px;
      flex-shrink: 0;
    }
    
    .metrics-table { width: 100%; border-collapse: collapse; flex: 1; }
    .metrics-table tr { border-bottom: 1px solid var(--border-light); }
    .metrics-table tr:last-child { border-bottom: none; }
    .metrics-table td { padding: 5px 0; font-size: 15px; font-weight: 300; letter-spacing: -0.03em; color: var(--text-black); }
    .metrics-table td:first-child { width: 45%; padding-left: 10px; }
    .metrics-table td:last-child { text-align: right; white-space: nowrap; }
    
    /* Rent Roll Table */
    .rentroll-table { width: calc(100% - 15px); border-collapse: collapse; font-size: 13px; margin-left: 5px; }
    .rentroll-table thead { background: var(--header-green); color: white; }
    .rentroll-table th { padding: 6px 8px; text-align: left; font-weight: 400; font-size: 12px; }
    .rentroll-table th:nth-child(2), .rentroll-table th:nth-child(3), .rentroll-table th:nth-child(4) { text-align: right; }
    .rentroll-table td { padding: 5px 8px; border-bottom: 1px solid var(--border-light); font-weight: 300; font-size: 13px; }
    .rentroll-table td:nth-child(2), .rentroll-table td:nth-child(3), .rentroll-table td:nth-child(4) { text-align: right; }
    .rentroll-table tbody tr:last-child td { border-bottom: none; }
    .rentroll-table tfoot { border-top: 1.5px solid var(--divider); }
    .rentroll-table tfoot td { padding: 6px 8px; font-weight: 400; }
    .rentroll-table .sonstige-row { background: #f5f5f5; font-style: italic; }
    .rentroll-table .sonstige-row td { color: #666; }
    
    .catchment-content { 
      position: relative;
      flex: 1; 
      min-height: 0; 
      margin-left: 10px; 
      margin-right: 5px;
      border: 1px solid var(--border-light);
      border-radius: 2px;
      overflow: hidden;
    }
    .catchment-map {
      width: 100%;
      height: 100%;
    }
    .catchment-map img { width: 100%; height: 100%; object-fit: cover; }
    .catchment-map-placeholder {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      color: var(--text-black); font-size: 15px;
      background: #fafafa;
    }
    
    .catchment-stats { 
      position: absolute;
      top: 10px;
      right: 10px;
      width: 165px;
      background: rgba(255, 255, 255, 0.95);
      border-radius: 3px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.15);
    }
    .catchment-table { width: 100%; border-collapse: collapse; font-size: 13px; letter-spacing: 0em; }
    .catchment-table thead { background: var(--header-green); color: white; }
    .catchment-table th { padding: 5px 8px; text-align: left; font-weight: 300; font-size: 12px; }
    .catchment-table th:last-child { text-align: right; }
    .catchment-table td { padding: 4px 8px; border-bottom: 1px solid var(--border-light); font-weight: 300; color: var(--text-black); font-size: 13px; }
    .catchment-table td:last-child { text-align: right; }
    .catchment-table tbody tr:last-child td { border-bottom: none; }
    
    .photo-container {
      width: calc(100% - 10px); 
      flex: 1;
      border: 1px solid var(--border-light);
      border-radius: 2px;
      overflow: hidden;
      margin-left: 10px;
    }
    .photo-container img { width: 100%; height: 100%; object-fit: cover; }
    .photo-placeholder {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      color: var(--text-black); font-size: 15px;
      background: #fafafa;
    }
    
    .use-scenario { margin-bottom: 10px; line-height: 1.5; font-size: 17px; letter-spacing: -0.03em; color: var(--text-black); margin-left: 10px; margin-right: 5px; }
    .use-scenario:last-child { margin-bottom: 0; }
    .use-scenario-title { font-weight: 420; }
    .use-scenario-text { font-weight: 300; }
    
    .footer {
      display: flex; 
      justify-content: space-between; 
      align-items: flex-end;
      margin-top: 12px; 
      padding-top: 10px;
      flex-shrink: 0;
    }
    .footer-left { display: flex; align-items: center; gap: 15px; }
    .logo {
      height: 60px;
      width: auto;
    }
    .sources { font-size: 12px; color: var(--text-black); max-width: 500px; line-height: 1.4; font-weight: 200; letter-spacing: 0em; }
    .footer-right { font-size: 15px; color: var(--text-black); font-weight: 200; letter-spacing: 0em; }
    .company-name { font-weight: 200; }
    sup { font-size: 0.65em; vertical-align: super; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>${asset.code} ${asset.city} – Asset Overview</h1>
    </div>
    
    <div class="content">
      <div class="quadrant top-left">
        <div class="section-title">Key Metrics</div>
        <table class="metrics-table">
          <tr><td>Address</td><td>${address}</td></tr>
          <tr><td>Year Built</td><td>${asset.year_built || '—'}</td></tr>
          <tr><td>Spot Value · Mult. · €/m²</td><td>${formatSpotValue(asset.spot_value as number, asset.rent_annual as number, asset.gla as number)}</td></tr>
          <tr><td>Plot Size</td><td>${formatNumber(asset.plot_size as number)} m<sup>2</sup></td></tr>
          <tr><td>Parking Stalls</td><td>${asset.parking_stalls || '—'}</td></tr>
          <tr><td>GLA</td><td>${formatNumber(asset.gla as number)} m<sup>2</sup></td></tr>
          <tr><td>Anchor Tenant</td><td>${asset.anchor_tenant || '—'}</td></tr>
          <tr><td>Total Annual Net Rent</td><td>${formatCurrency(asset.rent_annual as number)}</td></tr>
          <tr><td>Monthly Net Rent (€/m<sup>2</sup>)</td><td>€ ${(asset.rent_per_sqm as number)?.toFixed(2) || '—'}</td></tr>
          <tr><td>${asset.walt_type === 'other' && asset.walt_label ? asset.walt_label : 'WALT'}</td><td>${asset.walt_type === 'other' && asset.walt_comment ? asset.walt_comment : (asset.walt ? `${(asset.walt as number).toFixed(1)} years` : '—')}</td></tr>
        </table>
      </div>
      
      <div class="quadrant top-right">
        <div class="section-title">Catchment Area</div>
        <div class="catchment-content">
          <div class="catchment-map">
            ${catchmentUrl 
              ? `<img src="${catchmentUrl}" alt="Catchment Map">`
              : '<div class="catchment-map-placeholder">Catchment Map Image</div>'
            }
          </div>
          <div class="catchment-stats">
            <table class="catchment-table">
              <thead><tr><th>Duration</th><th>Pop.<sup>1</sup></th></tr></thead>
              <tbody>
                <tr><td>20 min</td><td>${formatNumber(asset.catchment_20min as number)}</td></tr>
                <tr><td>10 min</td><td>${formatNumber(asset.catchment_10min as number)}</td></tr>
                <tr><td>5 min</td><td>${formatNumber(asset.catchment_5min as number)}</td></tr>
                <tr><td>PP-Index<sup>2</sup></td><td>${asset.pp_index || '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <div class="quadrant bottom-left">
        <div class="photo-container">
          ${photoUrl 
            ? `<img src="${photoUrl}" alt="${asset.city} Property">`
            : '<div class="photo-placeholder">Asset Photo</div>'
          }
        </div>
      </div>
      
      <div class="${bottomRightClass}">
        ${bottomRightContent}
      </div>
    </div>
    
    <div class="footer">
      <div class="footer-left">
        <img src="${logoUrl}" alt="Slate" class="logo">
        <div class="sources">
          <sup>1</sup> Source for Catchment Population: Statistical Offices of the Federation and the Federal States Census 2022<br>
          <sup>2</sup> Source for Purchasing Power Index: Bundesinstituts für Bau-, Stadt- und Raumforschung 2023
        </div>
      </div>
      <div class="footer-right">
        <span class="company-name">Slate Asset Management</span> | ${pageNumber}
      </div>
    </div>
  </div>
</body>
</html>`;
}

// GET - Generate PDF for all or selected sale listings
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');           // Single listing (optional)
    const ids = searchParams.get('ids');         // Multiple listings (optional)
    const title = searchParams.get('title') || 'Project Overview';
    const subtitle = searchParams.get('subtitle') ?? '';
    
    let listings;
    let error;
    
    if (id) {
      // Single listing
      const result = await supabaseAdmin
        .from('sale_listings')
        .select('*')
        .eq('id', id);
      listings = result.data;
      error = result.error;
    } else if (ids) {
      // Multiple listings
      const listingIds = ids.split(',');
      const result = await supabaseAdmin
        .from('sale_listings')
        .select('*')
        .in('id', listingIds)
        .order('code');
      listings = result.data;
      error = result.error;
    } else {
      // ALL listings (default)
      const result = await supabaseAdmin
        .from('sale_listings')
        .select('*')
        .order('code');
      listings = result.data;
      error = result.error;
    }
    
    if (error || !listings || listings.length === 0) {
      return NextResponse.json({ error: 'Listings not found' }, { status: 404 });
    }
    
    // Fetch tenants for all listings
    const listingIds = listings.map(l => l.id);
    const { data: allTenants } = await supabaseAdmin
      .from('sale_tenants')
      .select('*')
      .in('sale_listing_id', listingIds)
      .order('monthly_rent', { ascending: false });
    
    // Group tenants by listing
    const tenantsByListing: Record<string, Tenant[]> = {};
    (allTenants || []).forEach(tenant => {
      const listingId = tenant.sale_listing_id;
      if (!tenantsByListing[listingId]) {
        tenantsByListing[listingId] = [];
      }
      tenantsByListing[listingId].push(tenant as Tenant);
    });
    
    // Collect photo URLs for cover page (first 4 listings with photos)
    const coverPhotoUrls = listings
      .map(l => l.photo_url || getImageUrl(l.code, 'photo'))
      .filter(Boolean)
      .slice(0, 4) as string[];
    
    // Get logo URL
    const logoUrl = getLogoUrl();
    
    // === COMPRESS ALL IMAGES ===
    console.log('Compressing images...');
    
    // Compress logo once
    const compressedLogo = await compressLogo(logoUrl);
    
    // Compress cover photos - 95% quality for all
    const compressedCoverPhotos = await Promise.all(
      coverPhotoUrls.map(url => compressImage(url, 600, 95))
    );
    
    // Prepare compressed images for each listing
    const compressedAssetImages: Record<string, { photo: string; catchment: string }> = {};
    
    await Promise.all(listings.map(async (listing) => {
      const photoUrl = listing.photo_url || getImageUrl(listing.code, 'photo');
      const catchmentUrl = listing.catchment_map_url || getImageUrl(listing.code, 'catchment');
      
      // Compress photo at 95%, keep catchment map original (no compression)
      const photo = photoUrl ? await compressImage(photoUrl, 700, 95) : '';
      
      compressedAssetImages[listing.id] = { 
        photo, 
        catchment: catchmentUrl || '' // Keep original URL
      };
    }));
    
    console.log('Images compressed successfully');
    // === END IMAGE COMPRESSION ===
    
    // Generate all HTML pages
    const allHtmlPages: string[] = [];
    
    // 1. Cover Page (page 1)
    allHtmlPages.push(generateCoverPageHTML(title, subtitle, compressedCoverPhotos, compressedLogo));
    
    // 2. Asset Pages (pages 2, 3, 4...)
    listings.forEach((listing, index) => {
      const tenants = tenantsByListing[listing.id] || [];
      // Override image URLs with compressed base64
      const listingWithCompressedImages = {
        ...listing,
        photo_url: compressedAssetImages[listing.id]?.photo || '',
        catchment_map_url: compressedAssetImages[listing.id]?.catchment || ''
      };
      allHtmlPages.push(generateAssetHTML(listingWithCompressedImages, tenants, index + 2, compressedLogo));
    });
    
    // 3. End Page (Disclaimer) - last page
    const endPageNumber = listings.length + 2;
    allHtmlPages.push(generateEndPageHTML(endPageNumber, compressedLogo));
    
    // Launch Puppeteer with serverless chromium
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_URL),
      headless: true,
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 960, deviceScaleFactor: 1 });
    
    // Generate PDF for each page and merge
    const pdfBuffers: Buffer[] = [];
    
    for (const html of allHtmlPages) {
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      // Wait a bit for fonts to load
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const pdf = await page.pdf({
        width: '1280px',
        height: '960px',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      });
      pdfBuffers.push(Buffer.from(pdf));
    }
    
    await browser.close();
    
    // Merge PDFs if multiple pages
    let finalPdf: Uint8Array;
    
    if (pdfBuffers.length === 1) {
      finalPdf = pdfBuffers[0];
    } else {
      const mergedPdf = await PDFDocument.create();
      
      for (const pdfBuffer of pdfBuffers) {
        const pdf = await PDFDocument.load(pdfBuffer);
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach(page => mergedPdf.addPage(page));
      }
      
      finalPdf = await mergedPdf.save();
    }
    
    // Convert Uint8Array to Buffer for NextResponse
    const pdfBuffer = Buffer.from(finalPdf);
    
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${title.replace(/\s+/g, '_')}.pdf"`
      }
    });
    
  } catch (error) {
    console.error('PDF generation error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json({ 
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined 
    }, { status: 500 });
  }
}

// POST - Create a new sale listing
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const { data, error } = await supabaseAdmin
      .from('sale_listings')
      .insert(body)
      .select()
      .single();
    
    if (error) throw error;
    return NextResponse.json({ success: true, data });
    
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH - Update a sale listing
export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    
    const body = await req.json();
    
    const { data, error } = await supabaseAdmin
      .from('sale_listings')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return NextResponse.json({ success: true, data });
    
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE - Delete a sale listing
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    
    const { error } = await supabaseAdmin
      .from('sale_listings')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    return NextResponse.json({ success: true });
    
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}