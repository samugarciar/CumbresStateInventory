// Teléfono de un cliente listo para mostrar y para tocar en el celular.
// +573000000106 → «+57 300 000 0106» y tel:+573000000106.
// Si no parece un número colombiano (p. ej. el sintético «kommo-123»), se
// muestra tal cual y sin enlace.
export function telefonoLegible(tel: string | null | undefined): { texto: string; href: string | null } {
  const original = (tel || '').trim();
  if (!original || /[a-z]/i.test(original)) return { texto: original, href: null };
  const dig = original.replace(/\D/g, '');
  const nacional = dig.length === 12 && dig.startsWith('57') ? dig.slice(2) : dig.length === 10 ? dig : null;
  if (!nacional) return { texto: original, href: dig.length >= 7 ? `tel:${original.startsWith('+') ? '+' : ''}${dig}` : null };
  return {
    texto: `+57 ${nacional.slice(0, 3)} ${nacional.slice(3, 6)} ${nacional.slice(6)}`,
    href: `tel:+57${nacional}`,
  };
}
