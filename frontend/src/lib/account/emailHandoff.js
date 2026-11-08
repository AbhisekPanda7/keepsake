/**
 * Carries the email typed on the sign-in screen over to the forgotten-password screen, in
 * memory only, so that it never appears in an address or in storage.
 */
let email = '';

export const handOverEmail = (value) => {
  email = String(value ?? '').trim();
};

export const takeEmail = () => {
  const value = email;
  email = '';
  return value;
};
