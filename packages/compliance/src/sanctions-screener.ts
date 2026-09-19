import { AmlScreeningResult } from './kyc-provider-interface.js';
import { NameMatcher } from './name-matcher.js';

export interface SanctionedEntity {
  id: string;
  fullName: string;
  aliases: string[];
  type: 'INDIVIDUAL' | 'ENTITY';
  listName: string; // e.g. OFAC_SDN, UN_SECURITY_COUNCIL, EU_SANCTIONS
  designation: string;
  isPep?: boolean;
}

export class SanctionsScreener {
  private static readonly SANCTIONS_DATABASE: SanctionedEntity[] = [
    {
      id: 'UN-001',
      fullName: 'OSAMA BIN LADEN',
      aliases: ['USAMA BIN LADEN', 'ABU ABDALLAH'],
      type: 'INDIVIDUAL',
      listName: 'UN_SECURITY_COUNCIL_SANCTIONS',
      designation: 'Terrorist Leader'
    },
    {
      id: 'OFAC-002',
      fullName: 'VIKTOR BOUT',
      aliases: ['VICTOR BOUT', 'THE MERCHANT OF DEATH'],
      type: 'INDIVIDUAL',
      listName: 'OFAC_SPECIALLY_DESIGNATED_NATIONALS',
      designation: 'Illicit Arms Trafficker'
    },
    {
      id: 'UN-003',
      fullName: 'JOSEPH KONY',
      aliases: ['JOSEPH KONYI', 'KONY'],
      type: 'INDIVIDUAL',
      listName: 'UN_SECURITY_COUNCIL_SANCTIONS',
      designation: 'LRA Commander'
    },
    {
      id: 'UN-004',
      fullName: 'FELICIEN KABUGA',
      aliases: ['KABUGA FELICIEN'],
      type: 'INDIVIDUAL',
      listName: 'UN_SECURITY_COUNCIL_SANCTIONS',
      designation: 'Genocide Financier'
    },
    {
      id: 'OFAC-005',
      fullName: 'DAWOOD IBRAHIM',
      aliases: ['SHEIKH DAWOOD HASSAN', 'DAWOOD KASKAR'],
      type: 'INDIVIDUAL',
      listName: 'OFAC_SPECIALLY_DESIGNATED_NATIONALS',
      designation: 'Organized Crime & Narcotics'
    },
    {
      id: 'OFAC-006',
      fullName: 'SEMEN MOGILEVICH',
      aliases: ['SEMYON MOGILEVICH', 'DON SIMEON'],
      type: 'INDIVIDUAL',
      listName: 'OFAC_SPECIALLY_DESIGNATED_NATIONALS',
      designation: 'Transnational Organized Crime'
    },
    {
      id: 'UN-007',
      fullName: 'SLOBODAN MILOSEVIC',
      aliases: [],
      type: 'INDIVIDUAL',
      listName: 'UN_SECURITY_COUNCIL_SANCTIONS',
      designation: 'War Crimes'
    },
    {
      id: 'OFAC-008',
      fullName: 'EVGENY PRIGOZHIN',
      aliases: ['YEVGENY PRIGOZHIN'],
      type: 'INDIVIDUAL',
      listName: 'OFAC_SPECIALLY_DESIGNATED_NATIONALS',
      designation: 'Private Military Company & Sanctions Evasion'
    },
    {
      id: 'OFAC-009',
      fullName: 'BASHAR AL-ASSAD',
      aliases: ['BASHAR ASSAD'],
      type: 'INDIVIDUAL',
      listName: 'OFAC_SPECIALLY_DESIGNATED_NATIONALS',
      designation: 'State Sanctions'
    },
    {
      id: 'OFAC-010',
      fullName: 'KIM JONG UN',
      aliases: ['KIM JONG-UN'],
      type: 'INDIVIDUAL',
      listName: 'OFAC_SPECIALLY_DESIGNATED_NATIONALS',
      designation: 'DPRK Sanctions'
    },
    {
      id: 'PEP-011',
      fullName: 'CABINET SECRETARY',
      aliases: ['MINISTER OF STATE'],
      type: 'INDIVIDUAL',
      listName: 'KENYA_PEP_REGISTER',
      designation: 'Politically Exposed Person',
      isPep: true
    },
    {
      id: 'PEP-012',
      fullName: 'SENATOR NYAMWEYA',
      aliases: ['SENATOR'],
      type: 'INDIVIDUAL',
      listName: 'KENYA_PEP_REGISTER',
      designation: 'Politically Exposed Person',
      isPep: true
    }
  ];

  /**
   * Soundex phonetic encoding (Russell & Odell Soundex).
   * Maps words to 4-character phonetic signature (e.g. "ROBERT" -> "R163").
   */
  public static toSoundex(word: string): string {
    const clean = word.toUpperCase().replace(/[^A-Z]/g, '');
    if (clean.length === 0) return '0000';

    const firstLetter = clean[0]!;
    const charCodes: Record<string, string> = {
      B: '1', F: '1', P: '1', V: '1',
      C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
      D: '3', T: '3',
      L: '4',
      M: '5', N: '5',
      R: '6'
    };

    let result = firstLetter;
    let prevCode = charCodes[firstLetter] || '0';

    for (let i = 1; i < clean.length; i++) {
      const ch = clean[i]!;
      const code = charCodes[ch] || '0';

      if (code !== '0' && code !== prevCode) {
        result += code;
      }
      prevCode = code;

      if (result.length === 4) break;
    }

    return result.padEnd(4, '0');
  }

  /**
   * Screens an individual name against the offline sanctions database and PEP register.
   */
  public static screen(fullName: string): AmlScreeningResult {
    const query = fullName.trim().toUpperCase();
    if (!query) {
      return { isPep: false, isSanctioned: false, riskScore: 0.0 };
    }

    const queryTokens = query.split(/\s+/).filter(Boolean);
    const querySoundex = queryTokens.map(this.toSoundex);

    for (const entity of this.SANCTIONS_DATABASE) {
      const candidates = [entity.fullName, ...entity.aliases];

      for (const candidate of candidates) {
        // 1. Exact match
        if (query === candidate) {
          return {
            isPep: !!entity.isPep,
            isSanctioned: !entity.isPep,
            riskScore: entity.isPep ? 0.60 : 1.0,
            matchedLists: [entity.listName]
          };
        }

        // 2. High-confidence fuzzy match (threshold >= 0.85)
        const similarity = NameMatcher.calculateSimilarity(query, candidate);
        if (similarity >= 0.85) {
          return {
            isPep: !!entity.isPep,
            isSanctioned: !entity.isPep,
            riskScore: entity.isPep ? 0.50 : 0.95,
            matchedLists: [entity.listName]
          };
        }

        // 3. Phonetic Soundex match
        const candTokens = candidate.split(/\s+/).filter(Boolean);
        const candSoundex = candTokens.map(this.toSoundex);

        if (querySoundex.length === candSoundex.length && querySoundex.length >= 2) {
          const soundexMatch = querySoundex.every((code, idx) => code === candSoundex[idx]);
          if (soundexMatch) {
            return {
              isPep: !!entity.isPep,
              isSanctioned: !entity.isPep,
              riskScore: entity.isPep ? 0.45 : 0.90,
              matchedLists: [entity.listName]
            };
          }
        }
      }
    }

    return {
      isPep: false,
      isSanctioned: false,
      riskScore: 0.02
    };
  }
}
