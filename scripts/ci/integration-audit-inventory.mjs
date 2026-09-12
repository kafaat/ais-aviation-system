import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const root = path.resolve(process.argv[2] || process.cwd());
const out = path.resolve(process.argv[3] || path.join(root, "audit-output"));
fs.mkdirSync(out, { recursive: true });
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n");
const sourceFiles = files.filter(
  f =>
    /^(server|client\/src|shared)\//.test(f) &&
    /\.tsx?$/.test(f) &&
    !/\.(test|spec)\.|\/(__tests__|tests|test)\/|\.d\.ts$/.test(f)
);
const procedures = [],
  mounts = [],
  usages = [],
  events = [],
  writers = [],
  routerImports = new Map();
for (const file of sourceFiles) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const loc = node => ({
    file,
    line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
  });
  const pname = node => node?.getText(ast).replace(/^['"]|['"]$/g, "");
  const visit = node => {
    if (
      file === "server/routers.ts" &&
      ts.isImportDeclaration(node) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const item of node.importClause.namedBindings.elements)
        routerImports.set(
          item.name.text,
          path.posix.normalize(
            path.posix.join("server", node.moduleSpecifier.text)
          ) + ".ts"
        );
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(ast) === "router" &&
      ts.isObjectLiteralExpression(node.initializer.arguments[0])
    ) {
      for (const prop of node.initializer.arguments[0].properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        if (
          file === "server/routers.ts" &&
          node.name.getText(ast) === "appRouter"
        )
          mounts.push({
            domain: pname(prop.name),
            symbol: prop.initializer.getText(ast),
            ...loc(prop),
          });
        const expr = prop.initializer.getText(ast);
        const auth = expr.match(/\b([A-Za-z]*Procedure)\b/);
        const kind = expr.match(/\.(query|mutation|subscription)\s*\(/);
        if (auth && kind)
          procedures.push({
            router: node.name.getText(ast),
            name: pname(prop.name),
            guard: auth[1],
            kind: kind[1],
            ...loc(prop),
          });
      }
    }
    if (ts.isCallExpression(node)) {
      const expr = node.expression.getText(ast);
      if (file.startsWith("client/")) {
        const use = expr.match(
          /^(?:trpc|utils|trpcUtils)\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\.(useQuery|useMutation|useInfiniteQuery|fetch|prefetch|invalidate|setData|getData)$/
        );
        if (use)
          usages.push({
            domain: use[1],
            procedure: use[2],
            operation: use[3],
            ...loc(node),
          });
      }
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ["insert", "update", "delete"].includes(node.expression.name.text) &&
        node.arguments.length
      ) {
        const table = node.arguments[0].getText(ast);
        if (/^[A-Za-z_$][\w$]*(?:\.[\w$]+)?$/.test(table))
          writers.push({
            table,
            operation: node.expression.name.text,
            ...loc(node),
          });
      }
      if (
        expr === "recordEvent" &&
        ts.isObjectLiteralExpression(node.arguments[1])
      ) {
        const obj = node.arguments[1];
        const val = key =>
          obj.properties
            .find(p => ts.isPropertyAssignment(p) && pname(p.name) === key)
            ?.initializer?.getText(ast);
        events.push({
          eventType: val("eventType"),
          aggregateType: val("aggregateType"),
          ...loc(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
const catalog = JSON.parse(
  fs.readFileSync(
    path.join(root, "docs/architecture/service-catalog.json"),
    "utf8"
  )
);
const domains = mounts.map(m => ({
  ...m,
  routerFile: routerImports.get(m.symbol),
  procedures: procedures.filter(p => p.router === m.symbol),
  frontendConsumers: usages.filter(u => u.domain === m.domain),
}));
const method =
  "Independent static AST inventory of tracked non-test TypeScript. Literal tRPC consumers and recordEvent calls only; aliases/dynamic dispatch may be omitted. DB writer arguments require manual validation. Import reachability does not certify execution.";
const summary = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  sourceModules: sourceFiles.length,
  services: catalog.services.length,
  lifecycle: catalog.services.reduce(
    (o, s) => ((o[s.lifecycle] = (o[s.lifecycle] ?? 0) + 1), o),
    {}
  ),
  accountableOwnersAssigned: catalog.services.filter(s => s.accountableOwner)
    .length,
  mountedDomains: domains.length,
  literalProcedureDefinitions: procedures.length,
  literalFrontendCalls: usages.length,
  domainsWithLiteralFrontendCalls: domains.filter(
    d => d.frontendConsumers.length
  ).length,
  literalRecordEventCallSites: events.length,
  migrations: JSON.parse(
    fs.readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8")
  ).entries.length,
  tables: Object.keys(
    JSON.parse(
      fs.readFileSync(
        path.join(root, "drizzle/meta/0031_snapshot.json"),
        "utf8"
      )
    ).tables
  ).length,
};
fs.writeFileSync(
  path.join(out, "inventory.json"),
  JSON.stringify(
    {
      method,
      summary,
      domains,
      procedures,
      usages,
      events,
      writers,
      services: catalog.services,
    },
    null,
    2
  )
);
const quote = x => '"' + String(x ?? "").replaceAll('"', '""') + '"';
const csv = rows => rows.map(r => r.map(quote).join(",")).join("\n") + "\n";
fs.writeFileSync(
  path.join(out, "service-map.csv"),
  csv([
    [
      "service",
      "lifecycle",
      "accountableOwner",
      "directConsumers",
      "dependencies",
      "readExpressions",
      "writeExpressions",
    ],
    ...catalog.services.map(s => [
      s.file,
      s.lifecycle,
      s.accountableOwner,
      s.consumers.join(";"),
      s.dependencies.join(";"),
      s.tableExpressions.reads.join(";"),
      s.tableExpressions.writes.join(";"),
    ]),
  ])
);
fs.writeFileSync(
  path.join(out, "api-map.csv"),
  csv([
    [
      "domain",
      "routerFile",
      "literalProcedures",
      "frontendCallSites",
      "frontendFiles",
    ],
    ...domains.map(d => [
      d.domain,
      d.routerFile,
      d.procedures.map(p => `${p.name}:${p.guard}`).join(";"),
      d.frontendConsumers.length,
      [...new Set(d.frontendConsumers.map(u => u.file))].join(";"),
    ]),
  ])
);
console.info(
  JSON.stringify(
    {
      summary,
      domainsWithoutLiteralFrontendCalls: domains
        .filter(d => !d.frontendConsumers.length)
        .map(d => d.domain),
    },
    null,
    2
  )
);
