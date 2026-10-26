import crypto from 'node:crypto';

/**
 * ¿El token compartido que llegó es el esperado?
 *
 * Con `timingSafeEqual` y no con `===`: comparar un secreto con
 * cortocircuito deja adivinarlo carácter a carácter por lo que tarda. Se
 * comparan los SHA-256 de los dos para que la longitud tampoco se filtre
 * (timingSafeEqual exige dos buffers del mismo tamaño).
 *
 * Sin secreto configurado no entra nadie: un `undefined === undefined`
 * nunca debe abrir la puerta.
 */
export function tokenValido(recibido: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!recibido || !esperado) return false;
  const a = crypto.createHash('sha256').update(recibido, 'utf8').digest();
  const b = crypto.createHash('sha256').update(esperado, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}
