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
} catch (_) { /* fallback fonts optional */ }

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
 * data: { name, completedAt (ms), number, org, signatory (name), signatoryTitle, signature (Buffer PNG/JPEG or null), logo (Buffer or null) }
 * returns a PDFDocument stream (call .pipe(res)).
 */
function renderCertificate(data) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: true,
    info: { Title: 'Certificate of Completion: Fire Safety Awareness', Author: data.org, Keywords: data.number } });
  const W = doc.page.width, H = doc.page.height, cx = W / 2;
  const unicode = /[^\u0000-ÿ]/.test(data.name) && UNICODE_BOLD;
  if (unicode) { doc.registerFont('NameFont', UNICODE_BOLD); doc.registerFont('NameFontReg', UNICODE_REG); }

  // ----- borders -----
  doc.rect(0, 0, W, H).fill('#fffdf9');
  doc.lineWidth(5).strokeColor(NAVY).rect(22, 22, W - 44, H - 44).stroke();
  doc.lineWidth(1.2).strokeColor(GOLD).rect(32, 32, W - 64, H - 64).stroke();
  doc.lineWidth(0.5).strokeColor(GOLD_LIGHT).rect(38, 38, W - 76, H - 76).stroke();
  for (const [x, y] of [[32, 32], [W - 32, 32], [32, H - 32], [W - 32, H - 32]]) {
    doc.save().fillColor(NAVY).rect(x - 6, y - 6, 12, 12).fill().restore();
    doc.save().fillColor(GOLD).rect(x - 3, y - 3, 6, 6).fill().restore();
  }

  // ----- logo + heading -----
  let y = 54;
  let logoDrawn = false;
  if (data.logo && data.logo.length) { // custom logo uploaded by a Super Admin
    try { doc.image(data.logo, cx - 60, y, { fit: [120, 68], align: 'center', valign: 'center' }); logoDrawn = true; y += 68 + 12; } catch (_) { /* fall back to the default logo */ }
  }
  if (!logoDrawn && fs.existsSync(LOGO)) { const lh = 68, lw = lh * (205 / 223); doc.image(LOGO, cx - lw / 2, y, { height: lh }); y += lh + 12; }
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GOLD).text('F I R E   S A F E T Y   A C A D E M Y', 0, y, { width: W, align: 'center' });
  y += 17;
  doc.font('Times-Bold').fontSize(32).fillColor(NAVY).text('CERTIFICATE OF COMPLETION', 0, y, { width: W, align: 'center', characterSpacing: 2.2 });
  y += 48;
  // divider with diamond
  doc.lineWidth(0.8).strokeColor(GOLD).moveTo(cx - 140, y + 5).lineTo(cx - 12, y + 5).stroke().moveTo(cx + 12, y + 5).lineTo(cx + 140, y + 5).stroke();
  doc.save().fillColor(GOLD).moveTo(cx, y).lineTo(cx + 6, y + 5).lineTo(cx, y + 10).lineTo(cx - 6, y + 5).closePath().fill().restore();
  y += 30;

  // ----- body -----
  doc.font('Times-Italic').fontSize(13.5).fillColor(MUTED).text('This is to certify that', 0, y, { width: W, align: 'center' });
  y += 28;
  let size = 38;
  const nameFont = unicode ? 'NameFont' : 'Times-Bold';
  doc.font(nameFont);
  while (size > 18 && (doc.fontSize(size), doc.widthOfString(data.name)) > W - 220) size -= 1;
  doc.fillColor(NAVY).fontSize(size).text(data.name, 60, y, { width: W - 120, align: 'center', lineBreak: false });
  y += size + 14;
  doc.lineWidth(0.8).strokeColor(GOLD).moveTo(cx - 200, y).lineTo(cx + 200, y).stroke();
  y += 14;
  doc.font('Times-Italic').fontSize(13.5).fillColor(MUTED).text('has successfully completed all required modules and passed every assessment of the', 0, y, { width: W, align: 'center' });
  y += 26;
  doc.font('Times-Bold').fontSize(22).fillColor(NAVY).text('Fire Safety Awareness Training Programme', 0, y, { width: W, align: 'center' });
  y += 31;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Fire hazards  |  Fire prevention  |  Emergency response  |  Fire extinguishers  |  Fire drills and evacuation', 0, y, { width: W, align: 'center' });
  y += 21;
  // ----- footer: date, seal, signature -----
  const baseY = H - 110;
  const lineW = 190;
  const leftX = 96, rightX = W - 96 - lineW;
  doc.font('Times-Bold').fontSize(13).fillColor(NAVY).text(longDate(data.completedAt), leftX, baseY - 20, { width: lineW, align: 'center' });
  doc.lineWidth(0.8).strokeColor(INK).moveTo(leftX, baseY).lineTo(leftX + lineW, baseY).stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('DATE OF COMPLETION', leftX, baseY + 6, { width: lineW, align: 'center', characterSpacing: 1 });

  // signature (uploaded by a Super Admin). Falls back to a typed name if no image, or if the image cannot be read.
  let signed = false;
  if (data.signature && data.signature.length) {
    try {
      doc.image(data.signature, rightX + 10, baseY - 58, { fit: [lineW - 20, 54], align: 'center', valign: 'bottom' });
      signed = true;
    } catch (_) { /* unreadable image: ignore */ }
  }
  if (!signed && data.signatory) doc.font('Times-Italic').fontSize(15).fillColor(NAVY).text(data.signatory, rightX, baseY - 22, { width: lineW, align: 'center' });
  doc.lineWidth(0.8).strokeColor(INK).moveTo(rightX, baseY).lineTo(rightX + lineW, baseY).stroke();
  let sy2 = baseY + 6;
  if (data.signatory) { doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(data.signatory, rightX, sy2, { width: lineW, align: 'center', lineBreak: false, ellipsis: true }); sy2 += 14; }
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text((data.signatoryTitle || 'AUTHORISED SIGNATORY').toUpperCase(), rightX, sy2, { width: lineW, align: 'center', characterSpacing: 1, lineBreak: false, ellipsis: true });
  sy2 += 12;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text(data.org.toUpperCase(), rightX, sy2, { width: lineW, align: 'center', lineBreak: false, ellipsis: true });

  // seal
  const sy = baseY - 6;
  doc.save();
  doc.circle(cx, sy, 37).fill(GOLD);
  doc.circle(cx, sy, 33).lineWidth(1).strokeColor('#fff7dc').stroke();
  doc.circle(cx, sy, 27).fill(NAVY);
  star(doc, cx, sy - 6, 13.5, 5.8, 5); doc.fill(GOLD_LIGHT);
  doc.font('Helvetica-Bold').fontSize(6.4).fillColor('#fff7dc').text('COMPLETED', cx - 30, sy + 11, { width: 60, align: 'center', characterSpacing: 0.8 });
  doc.restore();

  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text(`Certificate no. ${data.number}   |   Issued by ${data.org}`,
      60, H - 56, { width: W - 120, align: 'center', lineBreak: false });
  doc.end();
  return doc;
}

module.exports = { renderCertificate, certificateNumber };
