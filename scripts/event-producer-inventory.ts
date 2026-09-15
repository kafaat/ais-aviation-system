import path from "node:path";
import ts from "typescript";

export interface EventProducer {
  file: string;
  line: number;
  eventTypes: string[];
}

/** Resolve the actual writer signature, including renamed imports and aliases.
 * Unbounded names are an error: a wildcard is not evidence of payload coverage.
 */
export function collectEventProducers(
  program: ts.Program,
  root: string
): EventProducer[] {
  const checker = program.getTypeChecker();
  const writer = path.resolve(root, "server/services/outbox.service.ts");
  const result: EventProducer[] = [];
  function literalValues(type: ts.Type): string[] | null {
    if (type.isStringLiteral()) return [type.value];
    if (type.isUnion()) {
      const parts = type.types.map(literalValues);
      return parts.every((part): part is string[] => part !== null)
        ? parts.flat()
        : null;
    }
    return null;
  }
  function names(expression: ts.Expression): string[] | null {
    const values = literalValues(checker.getTypeAtLocation(expression));
    if (values) return values;
    if (ts.isTemplateExpression(expression)) {
      let expanded = [expression.head.text];
      for (const span of expression.templateSpans) {
        const choices = names(span.expression);
        if (!choices) return null;
        expanded = expanded.flatMap(prefix =>
          choices.map(value => prefix + value + span.literal.text)
        );
      }
      return expanded;
    }
    return null;
  }
  for (const source of program.getSourceFiles()) {
    const file = path.relative(root, source.fileName).split(path.sep).join("/");
    if (
      !file.startsWith("server/") ||
      source.isDeclarationFile ||
      /(?:^|\/)(?:__tests__|test)\//.test(file) ||
      /\.(?:test|spec)\.tsx?$/.test(file)
    )
      continue;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const declaration = checker.getResolvedSignature(node)?.declaration;
        if (
          declaration &&
          ts.isFunctionDeclaration(declaration) &&
          path.resolve(declaration.getSourceFile().fileName) === writer &&
          declaration.name?.getText() === "recordEvent"
        ) {
          const arg = node.arguments[1];
          const property =
            arg && ts.isObjectLiteralExpression(arg)
              ? arg.properties.find(
                  p =>
                    p.name &&
                    (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
                    p.name.text === "eventType"
                )
              : undefined;
          const expression =
            property &&
            (ts.isPropertyAssignment(property)
              ? property.initializer
              : ts.isShorthandPropertyAssignment(property)
                ? property.name
                : undefined);
          const member =
            arg && checker.getTypeAtLocation(arg).getProperty("eventType");
          const eventTypes = expression
            ? names(expression)
            : member
              ? literalValues(checker.getTypeOfSymbolAtLocation(member, arg))
              : null;
          const line =
            source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          if (!eventTypes?.length)
            throw new Error(
              `Unbounded domain event producer at ${file}:${line}; declare a finite event-name union`
            );
          result.push({
            file,
            line,
            eventTypes: [...new Set(eventTypes)].sort(),
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return result.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function assertProducerContracts(
  producers: EventProducer[],
  contracts: object
) {
  if (producers.length === 0)
    throw new Error("No transactional domain event producers found");
  for (const producer of producers) {
    for (const eventType of producer.eventTypes) {
      if (!Object.hasOwn(contracts, eventType))
        throw new Error(
          `Missing payload contract for ${eventType} at ${producer.file}:${producer.line}`
        );
    }
  }
}

export function readEventProducers(root: string): EventProducer[] {
  const filename = path.resolve(root, "tsconfig.json");
  const config = ts.readConfigFile(filename, ts.sys.readFile);
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n")
    );
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length)
    throw new Error(
      ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, "\n")
    );
  return collectEventProducers(
    ts.createProgram(parsed.fileNames, parsed.options),
    root
  );
}
