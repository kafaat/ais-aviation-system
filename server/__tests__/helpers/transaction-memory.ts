import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName, SQL } from "drizzle-orm";

/** Relational boundary double with rollback and SQL predicates; not a MySQL lock simulator. */
export function transactionMemory(seed: Record<string, any[]>) {
  let data = structuredClone(seed);
  const dialect = new MySqlDialect();
  const rows = (table: any) => (data[getTableName(table)] ||= []);
  function filter(predicate: any, row: any) {
    if (!predicate) return true;
    const query = dialect.sqlToQuery(predicate);
    let index = 0;
    const conditions = [
      ...query.sql.matchAll(
        /`[^`]+`\.`([^`]+)`\s*(=|!=|<>|>=|>|<|in)\s*(\?|\([^)]*\))/g
      ),
    ];
    return conditions
      .map(([, column, op, expr]) => {
        const count = (expr.match(/\?/g) || []).length;
        const params = query.params.slice(index, (index += count));
        const actual = row[column];
        const expected = params[0];
        if (op === "in") return params.includes(actual);
        if (op === "=")
          return actual === expected || Number(actual) === expected;
        if (op === "!=" || op === "<>") return actual !== expected;
        const comparable = (value: any) =>
          value instanceof Date
            ? value.getTime()
            : typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
              ? new Date(
                  value.includes("T") ? value : value.replace(" ", "T") + "Z"
                ).getTime()
              : value;
        if (op === ">=") return comparable(actual) >= comparable(expected);
        if (op === ">") return comparable(actual) > comparable(expected);
        return comparable(actual) < comparable(expected);
      })
      .every(Boolean);
  }
  let failTable: string | null = null;
  const lockedTables: string[] = [];
  const db: any = {
    transaction: async (fn: any) => {
      const before = structuredClone(data);
      try {
        return await fn(db);
      } catch (e) {
        data = before;
        throw e;
      }
    },
    select: (projection?: any) => {
      let table: any;
      let predicate: any;
      let limit = Infinity;
      const result = () => {
        const found = rows(table)
          .filter(row => filter(predicate, row))
          .slice(0, limit);
        if (
          projection &&
          Object.values(projection).some(v => v instanceof SQL)
        ) {
          const key = Object.keys(projection)[0];
          return [
            { [key]: found.reduce((n, row) => n + row.numberOfSeats, 0) },
          ];
        }
        return structuredClone(found);
      };
      const chain: any = {
        from(t: any) {
          table = t;
          return chain;
        },
        where(p: any) {
          predicate = p;
          return chain;
        },
        limit(n: number) {
          limit = n;
          return chain;
        },
        for: () => {
          lockedTables.push(getTableName(table));
          return chain;
        },
        orderBy: () => chain,
        then: (resolve: any, reject: any) =>
          Promise.resolve().then(result).then(resolve, reject),
      };
      return chain;
    },
    insert: (table: any) => ({
      values: async (values: any) => {
        if (failTable === getTableName(table))
          throw new Error("Injected insert failure");
        const list = rows(table);
        const insertId = list.length
          ? Math.max(...list.map(r => r.id || 0)) + 1
          : 1;
        for (const [index, value] of (Array.isArray(values)
          ? values
          : [values]
        ).entries())
          list.push({
            id: insertId + index,
            refundedAmount: 0,
            settlementStatus: "applied",
            seatsReserved: false,
            status: "pending",
            paymentStatus: "pending",
            ...structuredClone(value),
          });
        return [{ insertId }];
      },
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: async (predicate: any) => {
          const affected = rows(table).filter(row => filter(predicate, row));
          for (const row of affected)
            for (const [key, value] of Object.entries(values)) {
              if (value instanceof SQL) {
                const query = dialect.sqlToQuery(value);
                const amount = Number(query.params[0]);
                row[key] += query.sql.includes(" + ") ? amount : -amount;
              } else row[key] = structuredClone(value);
            }
          return [{ affectedRows: affected.length }];
        },
      }),
    }),
  };
  return {
    db,
    lockedTables,
    rows: (name: string) => data[name] || [],
    failInsert: (name: string) => {
      failTable = name;
    },
  };
}
