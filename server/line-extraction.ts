export type LineItemCandidate = {
  description: string;
  tariffNo: string;
  quantity: number;
  unit: string;
  value: number;
  countryOrigin: string;
};

const money = '(?:USD\\s*)?\\$?([\\d,]+(?:\\.\\d{1,4})?)';
const units = '(PCS|PC|PCE|EA|EACH|SET|SETS|DOZ|DZ|PAIR|PR|KG|M|YDS?)';

function amount(value: string) {
  return Number(value.replace(/,/g, ''));
}

/**
 * Conservative one-line table parser. A row is suggested only when quantity,
 * unit, and an extended currency value appear together; tariff is retained only
 * when a six-to-ten digit code is present in that same row.
 */
export function extractLineItemCandidates(text: string): LineItemCandidate[] {
  const candidates: LineItemCandidate[] = [];
  const seen = new Set<string>();
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map(rawLine => rawLine.replace(/\s+/g, ' ').trim());
  const compactUnits = 'PCS|PC|PCE|EA|EACH|SET|SETS|DOZ|DZ|PAIR|PR|KG|M|YDS?';
  const countryCodes: Record<string, string> = {
    BANGLADESH: 'BD', CAMBODIA: 'KH', CHINA: 'CN', INDIA: 'IN', INDONESIA: 'ID',
    MALAYSIA: 'MY', PAKISTAN: 'PK', PHILIPPINES: 'PH', THAILAND: 'TH', TURKEY: 'TR',
    TÜRKIYE: 'TR', TURKIYE: 'TR', UNITED: 'US', USA: 'US', 'UNITED STATES': 'US',
    VIETNAM: 'VN', 'VIET NAM': 'VN',
  };
  const globalOrigin = text.match(/\bgoods\s+are\s+of\s+([A-Za-z]{2,30}(?:\s+[A-Za-z]{2,30})?)\s+origin\b/i)?.[1]?.trim().toUpperCase();
  const fallbackOrigin = globalOrigin ? countryCodes[globalOrigin] || (/^[A-Z]{2}$/.test(globalOrigin) ? globalOrigin : '') : '';

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.length < 12 || line.length > 280) continue;

    // Text extraction from table PDFs often removes cell spacing. Handle compact
    // rows such as "6109.102,400PCS2.856,480.00" while retaining the six-digit
    // invoice HS heading as source evidence, not as a U.S. classification.
    const compact = line.match(new RegExp(`^\\s*(\\d{4})\\.?\\s*(\\d{2})([\\d,]+)\\s*(${compactUnits})\\s*\\(?([\\d,]+\\.\\d{2})\\)?\\s*\\*?\\s*\\(?([\\d,]+\\.\\d{2})\\)?\\s*$`, 'i'));
    if (compact) {
      const [, hsA, hsB, quantity, unit, _unitPrice, total] = compact;
      const description = findDescription(lines, lineIndex);
      if (description) add({ description, tariffNo: `${hsA}${hsB}`, quantity: amount(quantity), unit, value: amount(total), countryOrigin: findOrigin(lines, lineIndex) || fallbackOrigin });
      continue;
    }

    const withTariff = line.match(new RegExp(`^\\s*(?:\\d{1,3}[.)]?\\s+)?(.{3,}?)\\s+(\\d{6,10})\\s+([\\d,]+)\\s*${units}\\s+${money}\\s+${money}\\s*([A-Z]{2})?\\s*$`, 'i'));
    if (withTariff) {
      const [, description, tariffNo, quantity, unit, _unitPrice, total, origin] = withTariff;
      add({ description, tariffNo, quantity: amount(quantity), unit, value: amount(total), countryOrigin: origin || findOrigin(lines, lineIndex) || fallbackOrigin });
      continue;
    }

    const withoutTariff = line.match(new RegExp(`^\\s*(?:\\d{1,3}[.)]?\\s+)?(.{3,}?)\\s+([\\d,]+)\\s*${units}\\s+${money}\\s*$`, 'i'));
    if (withoutTariff) {
      const [, description, quantity, unit, total] = withoutTariff;
      add({ description, tariffNo: '', quantity: amount(quantity), unit, value: amount(total), countryOrigin: findOrigin(lines, lineIndex) || fallbackOrigin });
    }
  }
  return candidates;

  function findDescription(rows: string[], index: number) {
    for (let i = index - 1; i >= Math.max(0, index - 10); i -= 1) {
      const candidate = rows[i];
      if (candidate.length < 8 || candidate.length > 180) continue;
      if (/^(?:no\.?\s*style|style\s*no|continued|subtotal|total|brought forward|\(?origin\s*:|value for customs|foc samples|cmt price|colou?rs?\s*:|size ratio|waist\s)/i.test(candidate)) continue;
      if (/^(?:\d{1,3}[.)]?)?\s*[A-Z0-9-]{3,}$/.test(candidate)) continue;
      if (/\b(?:\d{1,3}(?:\.\d+)?\s*%|\d+\s*GSM|knitted|woven|pique|jersey|twill|crepe de chine)\b/i.test(candidate)) continue;
      if (/^(?:invoice|page\s+\d|commercial invoice|shipping marks)/i.test(candidate)) continue;
      const baseDescription = candidate.replace(/^\d+\s*/, '').trim();
      // Preserve composition and construction details printed on wrapped rows;
      // they are useful classification evidence, but do not turn them into a
      // tariff decision.
      const materialDetail = rows.slice(i + 1, index).find(detail =>
        /\b\d{1,3}(?:\.\d+)?\s*%/.test(detail) &&
        /\b(?:cotton|polyester|elastane|nylon|wool|silk|knit(?:ted)?|woven|jersey|fleece|twill|pique|crepe)\b/i.test(detail),
      );
      return materialDetail ? `${baseDescription}, ${materialDetail}` : baseDescription;
    }
    return '';
  }

  function findOrigin(rows: string[], index: number) {
    const nearby = rows.slice(Math.max(0, index - 8), index + 1).reverse().join(' ');
    const explicit = nearby.match(/\b(?:country\s+of\s+)?origin\s*[:=]\s*([A-Za-z]{2,30}(?:\s+[A-Za-z]{2,30})?)\b/i)?.[1]?.trim().toUpperCase();
    if (!explicit) return '';
    return countryCodes[explicit] || (/^[A-Z]{2}$/.test(explicit) ? explicit : '');
  }

  function add(candidate: LineItemCandidate) {
    const cleaned: LineItemCandidate = {
      ...candidate,
      description: candidate.description.replace(/^\s*[\d.)-]+\s*/, '').replace(/[|,;\s]+$/, '').trim(),
      tariffNo: candidate.tariffNo.replace(/\D/g, ''),
      unit: candidate.unit.toUpperCase(),
    };
    if (cleaned.description.length < 3 || !cleaned.quantity || !cleaned.value) return;
    const key = `${cleaned.description.toLowerCase()}|${cleaned.quantity}|${cleaned.value}`;
    if (!seen.has(key)) { seen.add(key); candidates.push(cleaned); }
  }
}

