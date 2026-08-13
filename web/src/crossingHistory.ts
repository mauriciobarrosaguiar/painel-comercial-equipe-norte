export const historicalCorrection = (value: string) => {
  let t = value
  const one = (drug: string, rx: RegExp, to: string) => { if (t.includes(drug)) t = t.replace(rx, to) }
  one('APIXABANA', /\b25\s*MG\b/g, '2.5 MG')
  one('BISOPROLOL', /\b25\s*MG\b/g, '2.5 MG')
  one('CARVEDILOL', /\b625\s*MG\b/g, '6.25 MG')
  one('INDAPAMIDA', /\b15\s*MG\b/g, '1.5 MG')
  one('LEVANLODIPINO', /\b25\s*MG\b/g, '2.5 MG')
  one('CLORTALIDONA', /\b125\s*MG\b/g, '12.5 MG')
  one('ALPRAZOLAM', /\b05\s*MG\b/g, '0.5 MG')
  one('IPRATROPIO', /\b025\s*MG\s*\/\s*ML\b/g, '0.25 MG/ML')
  one('CLOBETASOL', /\b05\s*MG\s*\/\s*G\b/g, '0.5 MG/G')
  if (t.includes('ATENOLOL') && t.includes('CLORTALIDONA')) t = t.replace(/50\s*\+\s*125\s*MG/g, '50 + 12.5 MG')
  if (t.includes('OLMESARTANA') && t.includes('HIDROCLOROTIAZIDA')) {
    t = t.replace(/20\s*\+\s*125\s*MG/g, '20 + 12.5 MG')
      .replace(/\b40\s*\/\s*12\b/g, '40 + 12.5 MG')
      .replace(/\b40\s*\/\s*25\b/g, '40 + 25 MG')
      .replace(/\b20\s*\/\s*12\.5\b/g, '20 + 12.5 MG')
  }
  if (t.includes('DROSPIRENONA') && t.includes('ETINILESTRADIOL')) {
    t = t.replace(/3\s*\+\s*002\s*MG/g, '3 + 0.02 MG').replace(/3\s*\+\s*003\s*MG/g, '3 + 0.03 MG')
  }
  if (t.includes('AZITROMICINA') && t.includes('1500 MG')) t = t.replace(/\b375\s*ML\b/g, '37.5 ML')
  return t
}

const hints: Array<{ rx: RegExp; ean: string }> = [
  { rx: /\bORLISTATE\b.*\b42\b/, ean: '7896004737218' },
  { rx: /\bORLISTATE\b.*\b84\b/, ean: '7896004737225' },
  { rx: /\bDIPIRONA\b.*\bXAROPE\b/, ean: '7896004715674' },
  { rx: /\bACEBROFILINA\b.*\bADULTO\b/, ean: '7896004710471' },
  { rx: /\bACEBROFILINA\b.*\bINFANTIL\b/, ean: '7896004710464' },
  { rx: /\bCETOROLACO\b.*\bCOLIRIO\b/, ean: '7896004706900' },
  { rx: /\bCLOBETASOL\b.*\bCREME\b/, ean: '7896004712413' },
  { rx: /\bTERBINAFINA\b.*\bCREME\b/, ean: '7896004701035' },
  { rx: /\bTIMOLOL\b.*\bCOLIRIO\b/, ean: '7896004715711' },
  { rx: /\bNISTATINA\b.*\bOXIDO\b.*\bZINCO\b/, ean: '7896004711195' },
]

export const historicalEan = (normalized: string) => hints.find(item => item.rx.test(normalized))?.ean || ''
