export function disposableDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (
    !value ||
    process.env.NODE_ENV !== "test" ||
    process.env.AIS_DISPOSABLE_DATABASE !== "true"
  )
    throw new Error(
      "E2E setup requires NODE_ENV=test and AIS_DISPOSABLE_DATABASE=true"
    );
  const url = new URL(value);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^\/[A-Za-z0-9_]+_test$/.test(url.pathname)
  )
    throw new Error("E2E fixtures require a loopback database ending in _test");
  return value;
}
