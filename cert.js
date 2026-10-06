'use strict';
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const NAVY = '#13294b';
const GOLD = '#b08d3c';
const GOLD_LIGHT = '#d9c48a';
const INK = '#2b3440';
const MUTED = '#6b7480';
const LOGO = path.join(__dirname, 'public', 'logo.png');
let UNICODE_BOLD = null, UNICODE_REG = null;
try {
  const dir = path.dirname(require.resolve('dejavu-fonts-ttf/package.json'));
  UNICODE_BOLD = path.join(dir, 'ttf', 'DejaVuSerif-Bold.ttf');
  UNICODE_REG = path.join(dir, 'ttf', 'DejaVuSerif.ttf');
} catch (_) { /* optional */ }

const pad = (n, w) => String(n).padStart(w, '0');
function certificateNumber(userId, ms) {
  const d = new Date(ms);
  return `FSA-${pad(userId, 5)}-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`;
}
const longDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

function star(doc, cx, cy, outer, inner, points) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  doc.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach((p) => doc.lineTo(p[0], p[1]));
  doc.closePath();
}

/**
 * data: { name, completedAt (ms), number, org, signatory, signatoryTitle, logo (Buffer), signature (Buffer), sample }
 * The certificate carries no score summary. Extra fields (average, sections...) are ignored.
 */
function renderCertificate(data) {
  const org = data.org || 'City of Refuge';
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: true,
    info: { Title: 'Certificate of Completion: Fire Safety Awareness', Author: org, Subject: 'Fire Safety Awareness training certificate', Keywords: data.number } });
  const W = doc.page.width, H = doc.page.height, cx = W / 2;
  const unicode = /[^\u0000-ÿ]/.test(data.name) && UNICODE_BOLD;
  if (unicode) { doc.registerFont('NameFont', UNICODE_BOLD); doc.registerFont('NameFontReg', UNICODE_REG); }

  // borders
  doc.rect(0, 0, W, H).fill('#fffdf9');
  doc.lineWidth(5).strokeColor(NAVY).rect(22, 22, W - 44, H - 44).stroke();
  doc.lineWidth(1.2).strokeColor(GOLD).rect(32, 32, W - 64, H - 64).stroke();
  doc.lineWidth(0.5).strokeColor(GOLD_LIGHT).rect(38, 38, W - 76, H - 76).stroke();
  for (const [x, y] of [[32, 32], [W - 32, 32], [32, H - 32], [W - 32, H - 32]]) {
    doc.save().fillColor(NAVY).rect(x - 6, y - 6, 12, 12).fill().restore();
    doc.save().fillColor(GOLD).rect(x - 3, y - 3, 6, 6).fill().restore();
  }

  if (data.sample) {
    doc.save().rotate(-28, { origin: [cx, H / 2] }).font('Helvetica-Bold').fontSize(110).fillColor('#e8e2d2').opacity(0.45)
      .text('SAMPLE', 0, H / 2 - 60, { width: W, align: 'center', lineBreak: false }).restore();
  }

  // logo + heading
  let y = 56;
  const logoSrc = data.logo || (fs.existsSync(LOGO) ? LOGO : null);
  if (logoSrc) { try { doc.image(logoSrc, cx - 90, y, { fit: [180, 80], align: 'center' }); y += 90; } catch (_) { /* bad image */ } }
  doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD).text('F I R E   S A F E T Y   A C A D E M Y', 0, y, { width: W, align: 'center' });
  y += 24;
  doc.font('Times-Bold').fontSize(34).fillColor(NAVY).text('CERTIFICATE OF COMPLETION', 0, y, { width: W, align: 'center', characterSpacing: 2.2 });
  y += 50;
  doc.lineWidth(0.8).strokeColor(GOLD).moveTo(cx - 140, y + 5).lineTo(cx - 12, y + 5).stroke().moveTo(cx + 12, y + 5).lineTo(cx + 140, y + 5).stroke();
  doc.save().fillColor(GOLD).moveTo(cx, y).lineTo(cx + 6, y + 5).lineTo(cx, y + 10).lineTo(cx - 6, y + 5).closePath().fill().restore();
  y += 30;

  // body (more generous spacing now the score summary is gone)
  doc.font('Times-Italic').fontSize(15).fillColor(MUTED).text('This is to certify that', 0, y, { width: W, align: 'center' });
  y += 32;
  let size = 42;
  doc.font(unicode ? 'NameFont' : 'Times-Bold');
  while (size > 18 && (doc.fontSize(size), doc.widthOfString(data.name)) > W - 220) size -= 1;
  doc.fillColor(NAVY).fontSize(size).text(data.name, 60, y, { width: W - 120, align: 'center', lineBreak: false });
  y += size + 8;
  doc.lineWidth(0.8).strokeColor(GOLD).moveTo(cx - 210, y).lineTo(cx + 210, y).stroke();
  y += 16;
  doc.font('Times-Italic').fontSize(15).fillColor(MUTED).text('has successfully completed all required modules and passed every assessment of the', 0, y, { width: W, align: 'center' });
  y += 28;
  doc.font('Times-Bold').fontSize(25).fillColor(NAVY).text('Fire Safety Awareness Training Programme', 0, y, { width: W, align: 'center' });
  y += 38;
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text('Fire hazards  |  Fire prevention  |  Emergency response  |  Fire extinguishers  |  Fire drills and evacuation', 0, y, { width: W, align: 'center' });

  // footer
  const baseY = H - 98;
  const lineW = 190, leftX = 96, rightX = W - 96 - lineW;
  doc.font('Times-Bold').fontSize(13).fillColor(NAVY).text(longDate(data.completedAt), leftX, baseY - 20, { width: lineW, align: 'center' });
  doc.lineWidth(0.8).strokeColor(INK).moveTo(leftX, baseY).lineTo(leftX + lineW, baseY).stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('DATE OF COMPLETION', leftX, baseY + 6, { width: lineW, align: 'center', characterSpacing: 1 });

  if (data.signature) { try { doc.image(data.signature, rightX + (lineW - 160) / 2, baseY - 46, { fit: [160, 42], align: 'center', valign: 'bottom' }); } catch (_) {} }
  else if (data.signatory) doc.font('Times-Italic').fontSize(15).fillColor(NAVY).text(data.signatory, rightX, baseY - 22, { width: lineW, align: 'center' });
  doc.lineWidth(0.8).strokeColor(INK).moveTo(rightX, baseY).lineTo(rightX + lineW, baseY).stroke();
  let ry = baseY + 6;
  if (data.signatory && data.signature) { doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(data.signatory, rightX, ry, { width: lineW, align: 'center', lineBreak: false }); ry += 12; }
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text((data.signatoryTitle || 'AUTHORISED SIGNATORY').toUpperCase(), rightX, ry, { width: lineW, align: 'center', characterSpacing: 0.6, lineBreak: false });
  ry += 12;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text(org.toUpperCase(), rightX, ry, { width: lineW, align: 'center', lineBreak: false });

  // seal
  const sy = baseY - 8;
  doc.save();
  doc.circle(cx, sy, 37).fill(GOLD);
  doc.circle(cx, sy, 33).lineWidth(1).strokeColor('#fff7dc').stroke();
  doc.circle(cx, sy, 27).fill(NAVY);
  star(doc, cx, sy - 6, 14, 6, 5); doc.fill(GOLD_LIGHT);
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#fff7dc').text('COMPLETED', cx - 27, sy + 12, { width: 54, align: 'center', characterSpacing: 0.8, lineBreak: false });
  doc.restore();

  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text(`Certificate no. ${data.number}   |   Issued by ${org}`, 60, H - 56, { width: W - 120, align: 'center', lineBreak: false });
  doc.end();
  return doc;
}

module.exports = { renderCertificate, certificateNumber };