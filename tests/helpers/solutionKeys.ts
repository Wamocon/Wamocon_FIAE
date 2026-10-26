// Scan of a JSON value for the keys that carry a solution of a quiz (the
// marker of the correct option, the reasoning, the correct answer, the expected
// answer of a text question, a hint, a model solution). A trainee answer to a
// question route must contain none of them before the answer is submitted.

const SOLUTION_KEY =
  /^(is_?correct|correct|correct_?(answer|answers|option|options|index|option_?id|answer_?text)|explanation|rationale|hint|hint_?text|expected_?answer|solution|solutions|solution_?text|model_?solution|sample_?solution|answer_?key)$/i;

/** Paths of every key in `value` (recursive, arrays included) that is a solution key. */
export function findSolutionKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findSolutionKeys(item, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => [
        ...(SOLUTION_KEY.test(key) ? [`${path}.${key}`] : []),
        ...findSolutionKeys(child, `${path}.${key}`),
      ]
    );
  }
  return [];
}
