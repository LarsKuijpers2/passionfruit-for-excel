# Curation Rules

Rules for processing and curating questionnaire answers into reusable library entries.

## Split List Answers

When a field like "Other (Please state)" or "Other certifications" contains a comma-separated list (e.g., "BRCGS, IFS, VLOG, Weidegang"), split into SEPARATE questions:

- "Is your company BRCGS certified?" → Yes/No
- "Is your company IFS certified?" → Yes/No
- "Is your company VLOG certified?" → Yes/No

Nobody asks "What other certifications do you have?" - they ask about specific certifications individually.

## Skip Meta-Information

Filter out questionnaire metadata that isn't reusable company information:

- Document creation/revision dates
- Page numbers
- Document codes/references
- Version numbers
- Questionnaire titles

## Skip Non-Reusable Questions

Filter out questions that are about the questionnaire process, not company facts:

- "Are you required to complete the full questionnaire if..."
- "Please attach a copy of..." (attachment requests)
- "Is a change answer report available?"
- "Is an actual score report available?"
- Questions about questionnaire system features (download, export, etc.)
- Questions conditional on previous answers ("If not accredited...")

## Skip Invalid Answers

Filter out answers that are not actual company information:

- **Internal notes**: "will be added by [name]", "[company] already added", "see above"
- **Questions back**: Answers that are questions ("Which law are you referring to?")
- **Skip markers**: "Ethical Skip", "ethically skipped", "N/A", "Not applicable"
- **Vague non-answers**: "We are certified" (without specifying what)
- **References only**: "See attached", "Confidential" (unless it's clear the document exists)

## Verify Facts

When curating, verify consistency:

- If company is IFS certified, don't say "BRC certified" elsewhere
- Check that certification names match across answers
- Flag any factual inconsistencies for review

## Answer Format

- Start with "Yes" or "No" followed by natural explanation
- Example: "Yes, our responsible purchasing policy covers environmental issues and social practices."
- Example: "No, we do not have ISO 14001 certification."
- Do NOT repeat the question in the answer
- NEVER mention customer names (Dairygold, TIPPAGRAL, F+S, etc.) - these are generic reusable answers

## Grouping Rules

### When to Group
- Same certification with multiple details (number, expiry, scope) → ONE question with all details
- Same exact question asked in multiple questionnaires → ONE answer
- Contact details (name, phone, email) for the same person/role → ONE question with all details
  - Example: Emergency contact name + phone + email → "What are the emergency contact details?"

### When NOT to Group
- Different raw materials (milk vs soy deforestation) → SEPARATE questions
- Different certifications → SEPARATE questions
- SEDEX membership vs SMETA audit → SEPARATE questions (see food-industry.md)

### Split Bundled Certifications for Similarity Matching

When a questionnaire asks about multiple certifications in one question (e.g., "Do you have ProTerra, RTRS, or ISCC certification?"), split into SEPARATE questions:

- "Is your company ProTerra certified?" → No
- "Is your company RTRS certified?" → No
- "Is your company ISCC certified for soy?" → No

**Why split:**
- Similarity matching works better with specific questions
- If someone asks "Are you ProTerra certified?", it won't match "Do you have soy certification (ProTerra/RTRS/ISCC)?"
- Each certification is a distinct, searchable fact

**When to keep bundled:**
- Questions about the SAME topic with different aspects are fine to bundle
- Example: "Is PCF data available?" + "Are you planning to calculate PCF?" → Both about carbon footprint, OK to bundle
- Rule: Same topic = bundle OK. Different certifications/standards = split

### Remove Customer-Specific Language

Questions and answers should be generic and reusable. Remove references to specific customers:

**Bad:**
- "Is your company a SEDEX member and linked to your site?" (the "linked to your site" was Dairygold-specific)
- "Do you supply products to Dairygold?"

**Good:**
- "Is your company a SEDEX member?"
- Generic question about the company's capabilities, not a specific customer relationship

### Expand Abbreviations

Always write abbreviations in full (with abbreviation in parentheses) for better similarity matching and clarity. Different questionnaires may use full names or abbreviations inconsistently.

**Bad:**
- "Is your company GMP certified?"
- "Is your company BSCI certified?"

**Good:**
- "Is your company GMP (Good Manufacturing Practice) certified?"
- "Is your company BSCI (Business Social Compliance Initiative) certified?"

This ensures questions match whether someone searches for "GMP" or "Good Manufacturing Practice".

## Conflict Handling

- If same question has DIFFERENT answers from different sources → Flag as conflict
- For entity-level items (certifications, etc.): conflicts are likely errors, not product variation
- Set `status: "needs_review"` and describe the conflict in the answer
- **Typos still need review**: If two sources have the same value but one has a typo (e.g., "NL Z 015- EG" vs "NL-Z-0159-EG"), flag it for review. We can correct it after human confirmation.

## Don't Interpret Questionnaire Questions as Facts

Questionnaire questions often contain assumptions, thresholds, or regulatory references that we cannot verify. Only include what the supplier actually stated in their answer.

**Example - EUDR question:**
- Question asked: "Products contain 5% critical raw material or animal materials fed with critical raw material"
- Supplier answered: "No"

**Bad curated answer:**
```
"No, EUDR is not applicable. Our products do not contain 5% critical raw materials or animal materials fed with critical raw materials."
```
This repeats the "5% threshold" from the question as if it's a verified regulatory fact.

**Good curated answer:**
```
"No, EUDR is not applicable to our products."
```
This only states what the supplier confirmed, without adding unverified regulatory details.

**Why this matters:**
- The "5%" might be incorrect or outdated regulatory information
- The supplier answered the question, but didn't necessarily verify the regulatory context
- We don't want to state facts that the supplier didn't actually claim

## Knowledge is Context Only

The domain knowledge (food-industry.md) is for the curation agent's understanding only:

- **DO NOT** add explanations from knowledge to answers
- **DO NOT** explain what a certification or term means in the answer
- Answers should contain **only factual data** from the questionnaires
- Keep answers concise - just the facts

**Bad example:**
```
"answer": "NL-Z-0159-EG. This is an EU health mark required under Regulation 853/2004 for establishments handling animal products."
```

**Good example:**
```
"answer": "NL-Z-0159-EG"
```
