/**
 * Property: every crew assignment path is gated by the legality engine.
 *
 * The single writer of crew_assignments is assignCrewWithRulesTx, which calls
 * enforceCrewLegality before inserting. Every other path (manual, bulk roster,
 * standby activation) must route through that writer, and the recovery
 * feasibility check (crew swaps) must call the gate directly. Checked on the
 * source so that a new path cannot bypass the engine unnoticed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

function functionBodies(file: string): Map<string, string> {
  const source = ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.Latest,
    true
  );
  const bodies = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body)
      bodies.set(node.name.text, node.body.getText(source));
    if (ts.isVariableStatement(node))
      for (const decl of node.declarationList.declarations)
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) ||
            ts.isFunctionExpression(decl.initializer))
        )
          bodies.set(decl.name.text, decl.initializer.body.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bodies;
}

describe("crew assignment paths are gated by the legality engine", () => {
  const ruleService = functionBodies("server/services/crew-rule.service.ts");
  const assignmentService = functionBodies(
    "server/services/crew-assignment.service.ts"
  );
  const feasibility = functionBodies(
    "server/services/recovery-feasibility.service.ts"
  );

  it("the assignment writer calls enforceCrewLegality before inserting", () => {
    const writer = ruleService.get("assignCrewWithRulesTx");
    expect(writer).toBeDefined();
    const gate = writer!.indexOf("enforceCrewLegality(");
    const insert = writer!.indexOf(".insert(crewAssignments)");
    expect(gate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(gate);
    expect(writer).toContain("legalityVerdictId: legality.verdictId");
  });

  it("the engine is the single authority for cumulative flight time: every gate call hands it the signed operator limits", () => {
    expect(ruleService.get("assignCrewWithRulesTx")).toContain(
      "operatorLimits: check.operatorLimits"
    );
    expect(feasibility.get("readRecoveryFeasibility")).toContain(
      "operatorLimits: check.operatorLimits"
    );
    expect(assignmentService.get("previewAssignmentLegality")).toContain(
      "operatorLimits: profile.operatorLimits"
    );
    expect(assignmentService.get("findReplacementCrew")).toContain(
      "operatorLimits: checks[0].operatorLimits"
    );
    // The operator profile no longer evaluates the limits it carries.
    expect(read("server/services/crew-duty-policy.ts")).not.toMatch(
      /flight-time limit exceeded/
    );
  });

  it("manual, bulk roster and standby activation route through the gated writer", () => {
    expect(assignmentService.get("assignCrewToFlight")).toContain(
      "assignCrewWithRules("
    );
    expect(assignmentService.get("assignCrewToFlight")).toContain(
      'path: "manual"'
    );
    expect(assignmentService.get("bulkAssignRoster")).toContain(
      "assignCrewWithRules("
    );
    expect(assignmentService.get("bulkAssignRoster")).toContain(
      'path: "bulk_roster"'
    );
    expect(assignmentService.get("activateStandby")).toContain(
      "assignCrewWithRulesTx("
    );
    expect(assignmentService.get("activateStandby")).toContain(
      'path: "standby_activation"'
    );
  });

  it("recovery crew swaps call the gate on the recovery_swap path", () => {
    const body = feasibility.get("readRecoveryFeasibility");
    expect(body).toContain("enforceCrewLegality(");
    expect(body).toContain('path: "recovery_swap"');
  });

  it("no other module inserts crew assignments", () => {
    const dir = resolve(root, "server");
    const offenders: string[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = resolve(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
          const text = readFileSync(path, "utf8");
          if (/\.insert\(\s*crewAssignments\s*\)/.test(text))
            offenders.push(path.slice(root.length + 1));
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual(["server/services/crew-rule.service.ts"]);
  });

  it("the gate is wired to the pure engine and persists before deciding", () => {
    const gate = functionBodies("server/services/crew-legality.service.ts").get(
      "enforceCrewLegality"
    );
    expect(gate).toContain("evaluateLegality(");
    const persist = gate!.indexOf("deps.persistVerdict(");
    const throwAt = gate!.indexOf("throw new CrewLegalityError");
    expect(persist).toBeGreaterThan(-1);
    expect(throwAt).toBeGreaterThan(persist);
  });
});
