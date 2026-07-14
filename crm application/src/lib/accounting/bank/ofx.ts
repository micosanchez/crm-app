/**
 * OFX / QFX bank source. OFX is SGML-ish; we don't need a full parser — every
 * <STMTTRN> block carries the fields we want. Works for both OFX 1.x (SGML)
 * and OFX 2.x (XML) exports.
 */
import type { BankSource, Direction, NormalizedBankTxn } from './source';
import { normalizeDate } from './source';

function tag(block: string, name: string): string | undefined {
  // matches <NAME>value  (value ends at next < or newline) and <NAME>value</NAME>
  const re = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : undefined;
}

function ofxDate(v: string | undefined): string {
  if (!v) return '';
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : normalizeDate(v);
}

export class OfxBankSource implements BankSource {
  readonly id = 'bluevine_ofx';
  readonly label = 'Bluevine OFX/QFX';

  constructor(private text: string) {}

  async getTransactions(): Promise<NormalizedBankTxn[]> {
    const blocks = this.text.split(/<STMTTRN>/i).slice(1);
    const out: NormalizedBankTxn[] = [];
    for (const b of blocks) {
      const block = b.split(/<\/STMTTRN>/i)[0];
      const amtRaw = tag(block, 'TRNAMT');
      if (amtRaw == null) continue;
      const signed = parseFloat(amtRaw.replace(/[^0-9.\-]/g, ''));
      if (isNaN(signed) || signed === 0) continue;
      const direction: Direction = signed < 0 ? 'debit' : 'credit';
      const description =
        tag(block, 'NAME') || tag(block, 'MEMO') || tag(block, 'PAYEE') || '(no description)';
      const externalId = tag(block, 'FITID') || `ofx-${ofxDate(tag(block, 'DTPOSTED'))}-${Math.abs(signed)}`;
      out.push({
        postedDate: ofxDate(tag(block, 'DTPOSTED')),
        description: description.trim(),
        amount: Math.abs(signed),
        direction,
        externalId,
        raw: {
          TRNTYPE: tag(block, 'TRNTYPE'),
          DTPOSTED: tag(block, 'DTPOSTED'),
          TRNAMT: amtRaw,
          FITID: tag(block, 'FITID'),
          NAME: tag(block, 'NAME'),
          MEMO: tag(block, 'MEMO'),
        },
      });
    }
    return out;
  }
}
