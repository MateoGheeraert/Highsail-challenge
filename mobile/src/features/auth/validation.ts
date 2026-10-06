export type AuthValues = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};
export type AuthErrors = Partial<Record<keyof AuthValues, string>>;

export function validateAuth(
  values: AuthValues,
  register: boolean,
): AuthErrors {
  const errors: AuthErrors = {};
  if (register && !values.name.trim()) errors.name = "Enter your full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()))
    errors.email = "Enter a valid email address.";
  if (!values.password) errors.password = "Enter your password.";
  else if (register && values.password.length < 12)
    errors.password = "Use at least 12 characters.";
  else if (register && values.password.length > 128)
    errors.password = "Use no more than 128 characters.";
  if (register && values.password !== values.confirmPassword)
    errors.confirmPassword = "Your passwords do not match.";
  return errors;
}
