import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** Self-contained signed agreement PDF: full terms snapshot, signer, timestamp, IP, drawn signature. */
export async function agreementPdf(a: {
  rental_number: string; signer_name: string; signed_at: string; ip?: string | null; user_agent?: string | null;
  terms_snapshot: string; signature_png?: Uint8Array | null; terms_version: number;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 54, size = 10, lh = 13;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const line = (t: string, f = font, s = size) => {
    if (y < M + lh) { page = doc.addPage([W, H]); y = H - M; }
    page.drawText(t, { x: M, y, size: s, font: f, color: rgb(0.1, 0.1, 0.1) });
    y -= lh * (s / size);
  };
  const wrap = (t: string, f = font, s = size) => {
    for (const para of t.split('\n')) {
      let cur = '';
      for (const w of para.split(' ')) {
        const test = cur ? `${cur} ${w}` : w;
        if (f.widthOfTextAtSize(test, s) > W - 2 * M) { line(cur, f, s); cur = w; } else cur = test;
      }
      line(cur, f, s);
    }
  };
  line('Sanchez Junk & Haul Co. — Tote Rental Agreement', bold, 16); y -= 6;
  line(`Rental ${a.rental_number}  ·  Terms v${a.terms_version}`, font, 11); y -= 10;
  wrap(a.terms_snapshot); y -= 16;
  line('Signed', bold, 12);
  line(`Name: ${a.signer_name}`);
  line(`Signed at: ${new Date(a.signed_at).toLocaleString('en-US', { timeZone: 'America/Detroit' })} (Detroit)`);
  if (a.ip) line(`IP: ${a.ip}`);
  if (a.user_agent) wrap(`Device: ${a.user_agent}`);
  if (a.signature_png?.length) {
    const img = await doc.embedPng(a.signature_png);
    const w = 220, h = (img.height / img.width) * w;
    if (y < M + h + 10) { page = doc.addPage([W, H]); y = H - M; }
    page.drawImage(img, { x: M, y: y - h, width: w, height: h });
    y -= h + 8;
  }
  line('Electronic signature accepted under the U.S. E-SIGN Act. This document is the evidence of the card authorization described above.', font, 8);
  return doc.save();
}
