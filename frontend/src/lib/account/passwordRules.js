/**
 * What a new password must be when one is chosen by resetting. The server checks the same
 * rules (backend PasswordRules.java), so the advice here matches what it will accept.
 */

export const MIN_PASSWORD = 8;
/** BCrypt only uses the first 72 bytes, so longer passwords are refused, not cut short. */
export const MAX_PASSWORD_BYTES = 72;

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'qwerty123', '1q2w3e4r', 'iloveyou', '11111111', '00000000', 'abc12345', 'abcd1234',
  'letmein1', 'welcome1', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'keepsake', 'keepsake1',
]);

const byteLength = (text) => new TextEncoder().encode(text).length;

/** How many of letters, digits, and anything else (spaces and symbols) appear. */
export function characterKinds(password) {
  let letter = false;
  let digit = false;
  let other = false;
  for (const c of String(password ?? '')) {
    if (/\p{L}/u.test(c)) letter = true;
    else if (/\p{Nd}/u.test(c)) digit = true;
    else other = true;
  }
  return Number(letter) + Number(digit) + Number(other);
}

/** Null if the password is acceptable, otherwise what to change, said plainly. */
export function passwordProblem(password) {
  const text = String(password ?? '');
  if (text.length < MIN_PASSWORD) return `Please choose a password of at least ${MIN_PASSWORD} characters.`;
  if (byteLength(text) > MAX_PASSWORD_BYTES) return `That password is too long. Please keep it under ${MAX_PASSWORD_BYTES} characters.`;
  if (text.trim() === '' || new Set(text).size === 1) return "Please choose a password that isn't one character repeated.";
  if (COMMON.has(text.toLowerCase())) return 'That password is too easy to guess. Please choose another.';
  if (characterKinds(text) < 2) return 'Please mix letters with numbers, spaces or symbols.';
  return null;
}

/**
 * A rough measure for the meter beside the field: 0 is nothing typed, 1 is not yet
 * acceptable, and 2 to 4 are acceptable, from fair to strong.
 */
export function passwordStrength(password) {
  const text = String(password ?? '');
  if (!text) return { score: 0, label: '' };
  if (passwordProblem(text)) return { score: 1, label: 'Too weak' };
  const kinds = characterKinds(text);
  if (text.length >= 16 || (text.length >= 12 && kinds === 3)) return { score: 4, label: 'Strong' };
  if (text.length >= 12 || kinds === 3) return { score: 3, label: 'Good' };
  return { score: 2, label: 'Fair' };
}
