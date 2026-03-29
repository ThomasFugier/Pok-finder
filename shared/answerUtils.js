export function normalizeAnswer(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\-\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a, b) {
  const s = a ?? "";
  const t = b ?? "";
  const rows = s.length + 1;
  const cols = t.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[s.length][t.length];
}

export function similarityScore(input, expected) {
  const normalizedInput = normalizeAnswer(input);
  const normalizedExpected = normalizeAnswer(expected);

  if (!normalizedInput || !normalizedExpected) return 0;
  if (normalizedInput === normalizedExpected) return 100;

  const distance = levenshtein(normalizedInput, normalizedExpected);
  const maxLength = Math.max(normalizedInput.length, normalizedExpected.length);
  const ratio = Math.max(0, 1 - distance / maxLength);
  return Math.round(ratio * 100);
}

export function buildAnswerMaskTemplate(targetName) {
  if (!targetName) return "__________";
  return Array.from(targetName)
    .map((char) => (/[0-9A-Za-zÀ-ÿ]/.test(char) ? "_" : char))
    .join("");
}

export function buildAnswerMaskTokens(template, typedValue) {
  let typedIndex = 0;
  const typedChars = Array.from(typedValue || "");
  const activeSlotIndex = typedChars.length;
  let slotIndex = 0;

  return Array.from(template).map((slot) => {
    if (slot !== "_") {
      return {
        char: slot,
        isCurrent: false
      };
    }

    const nextChar = typedChars[typedIndex];
    const token = {
      char: nextChar ? nextChar.toUpperCase() : "_",
      isCurrent: !nextChar && slotIndex === activeSlotIndex
    };

    typedIndex += 1;
    slotIndex += 1;
    return token;
  });
}

export function countAnswerSlots(template) {
  return Array.from(template).filter((slot) => slot === "_").length;
}

export function hydrateAnswerFromTemplate(template, typedValue) {
  let typedIndex = 0;
  const typedChars = Array.from(typedValue || "");
  let output = "";

  for (const slot of Array.from(template)) {
    if (slot === "_") {
      if (typedIndex >= typedChars.length) break;
      output += typedChars[typedIndex];
      typedIndex += 1;
      continue;
    }

    if (typedIndex > 0) {
      output += slot;
    }
  }

  return output.trim();
}
