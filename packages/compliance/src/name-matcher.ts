/**
 * Name matching utility providing Levenshtein distance, token-aware comparison,
 * and fuzzy matching between identity documents and payment provider registered names.
 */
export class NameMatcher {
  /**
   * Computes classic Levenshtein edit distance between two strings.
   */
  public static levenshteinDistance(a: string, b: string): number {
    const s1 = a.trim().toUpperCase();
    const s2 = b.trim().toUpperCase();

    const m = s1.length;
    const n = s2.length;

    if (m === 0) return n;
    if (n === 0) return m;

    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i]![0] = i;
    for (let j = 0; j <= n; j++) dp[0]![j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i]![j] = Math.min(
          dp[i - 1]![j]! + 1,      // deletion
          dp[i]![j - 1]! + 1,      // insertion
          dp[i - 1]![j - 1]! + cost // substitution
        );
      }
    }

    return dp[m]![n]!;
  }

  /**
   * Calculates similarity score in range [0.0, 1.0].
   * Takes into account:
   * 1. Character-level normalized Levenshtein ratio
   * 2. Token-level matching (handling middle initials, middle names, and name permutations)
   */
  public static calculateSimilarity(nameA: string, nameB: string): number {
    const cleanA = this.normalizeName(nameA);
    const cleanB = this.normalizeName(nameB);

    if (cleanA === cleanB) return 1.0;
    if (cleanA.length === 0 || cleanB.length === 0) return 0.0;

    // 1. Direct character ratio
    const maxLen = Math.max(cleanA.length, cleanB.length);
    const dist = this.levenshteinDistance(cleanA, cleanB);
    const charRatio = 1.0 - dist / maxLen;

    // 2. Token-level analysis
    const tokensA = cleanA.split(/\s+/).filter(Boolean);
    const tokensB = cleanB.split(/\s+/).filter(Boolean);

    // Filter out single-letter middle initials
    const significantA = tokensA.filter(t => t.length > 1);
    const significantB = tokensB.filter(t => t.length > 1);

    // If significant words match completely (e.g. "JOHN DOE" vs "JOHN M. DOE")
    const joinedSigA = significantA.join(' ');
    const joinedSigB = significantB.join(' ');

    if (joinedSigA === joinedSigB && joinedSigA.length > 0) {
      return 0.95;
    }

    // Token overlap: count matching tokens
    let matchedTokens = 0;
    for (const tA of significantA) {
      if (significantB.some(tB => tA === tB || this.calculateTokenRatio(tA, tB) >= 0.85)) {
        matchedTokens++;
      }
    }

    const totalSig = Math.max(significantA.length, significantB.length);
    const tokenScore = totalSig > 0 ? matchedTokens / totalSig : 0.0;

    // Return the highest confidence representation
    return Math.max(charRatio, tokenScore);
  }

  /**
   * Asserts whether two names match within a given confidence threshold (default 0.80).
   */
  public static isMatch(nameA: string, nameB: string, threshold = 0.80): boolean {
    return this.calculateSimilarity(nameA, nameB) >= threshold;
  }

  private static normalizeName(str: string): string {
    return str
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ') // replace punctuation with spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static calculateTokenRatio(t1: string, t2: string): number {
    const maxLen = Math.max(t1.length, t2.length);
    if (maxLen === 0) return 1.0;
    return 1.0 - this.levenshteinDistance(t1, t2) / maxLen;
  }
}
