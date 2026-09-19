# KaziBet Compliance, KYC & Sanctions Screening Architecture

## 1. Overview

KaziBet provides production-grade compliance tooling (`packages/compliance`) tailored for African regulatory environments, with first-class support for Kenyan identity formats, automated Safaricom M-Pesa registered name reconciliation, and AML/PEP sanctions screening.

---

## 2. Document Format Validation

Identity documents are validated using strict Kenyan regulatory patterns prior to third-party verification dispatch:

| Document Type | Regex Pattern | Format Specification |
|---|---|---|
| **Kenya National ID** | `^\d{7,8}$` | Exactly 7 or 8 digits (e.g. `29876543`) |
| **Kenya Alien ID** | `^\d{9}$` | Exactly 9 digits (e.g. `123456789`) |
| **East African / International Passport** | `^[A-Za-z]\d{7,8}$` | 1 letter followed by 7 or 8 digits (e.g. `A1234567`) |
| **Driving License** | `^[A-Za-z0-9]{7,9}$` | 7 to 9 alphanumeric characters |

---

## 3. Name Matching & M-Pesa Reconciliation

To prevent identity theft, bonus farming, and illicit third-party deposits/withdrawals, the `NameMatcher` performs fuzzy string distance and token-aware evaluation between document names and the M-Pesa account name:

1. **Normalized Levenshtein Ratio**: Evaluates edit distance against character length.
2. **Token-Aware Initial Filtering**: Handles middle initials and abbreviations (e.g., `'JOHN DOE'` vs `'JOHN M. DOE'`) yielding $\ge 0.80$ similarity.
3. **Threshold Enforcement**: A minimum similarity score of $0.80$ (80%) is required; otherwise verification is rejected.

---

## 4. AML Sanctions & PEP Screening

The `SanctionsScreener` inspects applicants against an offline register of UN Security Council, OFAC Specially Designated Nationals (SDN), and Politically Exposed Persons (PEPs):
- **Exact Match**: Direct equality check.
- **Fuzzy Match**: Levenshtein similarity $\ge 0.85$.
- **Phonetic Encoding (Russell & Odell Soundex)**: Maps name tokens to 4-character phonetic codes (e.g. `VICTOR BOUT` and `VIKTOR BOUT` both encode to `V236`), preventing evasion via phonetic misspelling.

### Immediate Sanctions Freeze Workflow
When an applicant matches a sanctioned record:
1. User account is immediately transitioned to `status = 'SUSPENDED'`.
2. A critical `RiskCaseEntity` (`severity: 'CRITICAL'`, `score: 1.0`, `signalType: 'AML_SANCTIONS_MATCH'`) is generated.
3. System audit log entry is recorded with matched sanctions lists.
