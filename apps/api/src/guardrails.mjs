const injection =
  /(ignore\s+(all|any|previous)|system\s+prompt|developer\s+message|reveal\s+(the\s+)?secret|jailbreak)/i;
export function guardInput(value, max) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Input is required.");
  if (value.length > max) throw new Error(`Input exceeds ${max} characters.`);
  if (injection.test(value))
    throw new Error("This request contains an unsafe instruction pattern.");
}
export function guardOutput(result) {
  if (result.grounded === false && result.summary)
    result.summary = "No supporting evidence was found in your uploaded material.";
  return result;
}
