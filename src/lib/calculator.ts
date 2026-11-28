type Operator = "+" | "-" | "*" | "/" | "%";
type Token = { kind: "number"; value: number } | { kind: "operator"; value: Operator } | { kind: "left" | "right" };

/** Evaluates simple arithmetic without executing user-provided JavaScript. Invalid input returns null. */
export function evaluateCalculatorExpression(source: string): number | null {
  if (!source.trim() || source.length > 256) return null;
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (/[0-9.]/.test(char)) {
      const start = index;
      let dots = 0;
      let digits = 0;
      while (index < source.length && /[0-9.]/.test(source[index])) {
        if (source[index] === ".") dots += 1;
        else digits += 1;
        index += 1;
      }
      if (dots > 1 || digits === 0) return null;
      const value = Number(source.slice(start, index));
      if (!Number.isFinite(value)) return null;
      tokens.push({ kind: "number", value });
      continue;
    }
    const operator = ({ "×": "*", "÷": "/", "−": "-" } as Record<string, Operator>)[char] ?? char;
    if (["+", "-", "*", "/", "%"].includes(operator)) tokens.push({ kind: "operator", value: operator as Operator });
    else if (char === "(") tokens.push({ kind: "left" });
    else if (char === ")") tokens.push({ kind: "right" });
    else return null;
    index += 1;
    if (tokens.length > 128) return null;
  }
  if (!tokens.length) return null;

  let cursor = 0;
  const current = () => tokens[cursor];
  const consume = () => tokens[cursor++];
  const parseExpression = (): number => {
    let value = parseTerm();
    while (current()?.kind === "operator" && ["+", "-"].includes((current() as Extract<Token, { kind: "operator" }>).value)) {
      const op = (consume() as Extract<Token, { kind: "operator" }>).value;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
      if (!Number.isFinite(value)) throw new Error("Invalid result");
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parseUnary();
    while (current()?.kind === "operator" && ["*", "/"].includes((current() as Extract<Token, { kind: "operator" }>).value)) {
      const op = (consume() as Extract<Token, { kind: "operator" }>).value;
      const rhs = parseUnary();
      if (op === "/" && rhs === 0) throw new Error("Division by zero");
      value = op === "*" ? value * rhs : value / rhs;
      if (!Number.isFinite(value)) throw new Error("Invalid result");
    }
    return value;
  };
  const parseUnary = (): number => {
    const token = current();
    if (token?.kind === "operator" && (token.value === "+" || token.value === "-")) {
      consume();
      const value = parseUnary();
      return token.value === "-" ? -value : value;
    }
    return parsePrimary();
  };
  const parsePrimary = (): number => {
    const token = consume();
    let value: number;
    if (token?.kind === "number") value = token.value;
    else if (token?.kind === "left") {
      value = parseExpression();
      if (current()?.kind !== "right") throw new Error("Missing closing parenthesis");
      consume();
    } else throw new Error("Expected a number");

    while (current()?.kind === "operator" && (current() as Extract<Token, { kind: "operator" }>).value === "%") {
      consume();
      value /= 100;
    }
    return value;
  };

  try {
    const result = parseExpression();
    return cursor === tokens.length && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

/** Shortens floating-point noise while preserving useful precision for accounting entry. */
export function formatCalculatorValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toPrecision(12)));
}
