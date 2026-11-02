export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = "Please login (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

/**
 * Retention periods quoted in the public privacy policy. The server enforces
 * them; the client renders them, so keep both reading from here.
 */
/** A biometric boarding enrollment expires this many days after creation. */
export const BIOMETRIC_ENROLLMENT_VALIDITY_DAYS = 365;
/** Soft-deleted bookings stay recoverable this many days before purge. */
export const DELETED_BOOKING_RETENTION_DAYS = 90;
