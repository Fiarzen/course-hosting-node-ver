// Strip every secret-bearing column from a User row before it is serialized
// into a response. The session token is only ever returned through the
// dedicated `token` field of login/change-password responses.
export function toSafeUser<T extends Record<string, any>>(user: T) {
  const {
    password,
    authToken,
    authTokenExpiry,
    passwordResetToken,
    passwordResetTokenExpiry,
    emailVerificationToken,
    emailVerificationTokenExpiry,
    ...safe
  } = user;
  return safe;
}
