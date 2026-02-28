# Tagging Schema

This document defines the standardized topics and evidence types used for categorizing questionnaire data.

**Key distinction:**
- **Topics** = WHAT is the subject matter? (the content area being discussed)
- **Evidence Types** = WHAT kind of document is it? (the nature/format of the evidence)

---

## Topics

Topics categorize the SUBJECT MATTER of a question or answer. A single document may contain multiple topics.

| Topic | Description |
|-------|-------------|
| `company_information` | Company identity and legal structure. Includes: legal name, registration numbers (KvK, VAT), company ownership and structure, site addresses, contact details (phone, email, website), number of employees, production capacity, business activities, insurance coverage (product liability, public liability), and financial information. |
| `certifications.food_safety` | GFSI-recognized food safety certifications. Includes: IFS Food, BRCGS (BRC), FSSC 22000, SQF, Global GAP. Certificate numbers, COID numbers, certification levels (Foundation, Higher, etc.), expiry dates, and certification bodies. These are the primary food safety standards recognized by retailers. |
| `certifications.iso` | ISO management system certifications. Includes: ISO 9001 (Quality Management), ISO 14001 (Environmental Management), ISO 22000 (Food Safety Management), ISO 45001 (Occupational Health & Safety), ISO 50001 (Energy Management). Certificate numbers, scope, expiry dates, and accredited certification bodies. |
| `certifications.religious` | Religious dietary certifications. Includes: Halal certification (various bodies: HQC, IFANCA, etc.), Kosher certification (OU, OK, Star-K, etc.). Certificate numbers, supervising body, scope of products covered, and expiry dates. Product-specific - different products may have different certification status. |
| `certifications.organic` | Organic and natural certifications. Includes: EU Organic, USDA Organic, Naturland, Demeter, Bio Suisse, Soil Association. Control body numbers (e.g., NL-BIO-01), certificate numbers, scope of organic products, and annual inspection dates. |
| `certifications.social` | Social compliance and ethical trade certifications. Includes: SMETA (2-pillar, 4-pillar), SEDEX membership, BSCI, SA8000, Amfori, EcoVadis ratings. Membership numbers (e.g., SEDEX ZC number), audit dates, audit scores/ratings, and corrective action status. |
| `certifications.sustainability` | Sustainability and supply chain certifications. Includes: RSPO (IP, SG, MB, Book & Claim), Rainforest Alliance, UTZ, FSC, PEFC, MSC, ASC. Membership numbers, chain of custody certificates, mass balance records, and supply chain certification levels. |
| `certifications.product` | Product-specific certifications and labels. Includes: VLOG/Non-GMO, Weidegang (pasture milk), V-Label (vegetarian/vegan), Planet Proof, Beter Leven, On the way to PlanetProof. License numbers, product scope, and label usage rights. |
| `quality_systems` | Internal quality and food safety management systems. Includes: HACCP plans and team composition, prerequisite programs (PRPs), Good Manufacturing Practices (GMP), internal audits, supplier audits, validation and verification activities, hygiene and sanitation programs, cleaning schedules, pest control programs, equipment maintenance, calibration programs, staff training and competency, and document control. |
| `complaints` | Customer feedback and incident management. Includes: complaint handling procedures, complaint statistics and trends, root cause analysis, corrective and preventive actions (CAPA), product recall procedures, mock recall exercises, crisis management procedures, emergency contacts, and communication protocols. |
| `traceability` | Product identification and tracking throughout the supply chain. Includes: batch/lot numbering systems, traceability procedures, one-up-one-down traceability, mass balance systems, recall capability (4-hour requirement), sample retention policies, and chain of custody documentation. |
| `shelf_life` | Product stability and shelf life determination. Includes: shelf life studies, accelerated shelf life testing, challenge studies, use-by and best-before date determination, storage condition validation, and open shelf life (after opening). |
| `food_fraud` | Food fraud prevention and vulnerability assessment. Includes: TACCP (Threat Assessment Critical Control Points), vulnerability assessments, fraud mitigation measures, authenticity testing, supplier verification for fraud risks, and economically motivated adulteration (EMA) controls. |
| `food_defense` | Intentional contamination prevention and site security. Includes: VACCP (Vulnerability Assessment Critical Control Points), site security measures, access control systems, visitor management, personnel security, transport security, and tamper-evident packaging. |
| `foreign_bodies` | Physical contamination prevention and detection. Includes: metal detection (ferrous, non-ferrous, stainless steel sensitivities), X-ray inspection, glass and hard plastic policies, sieve and filter programs, visual inspection procedures, glass and brittle plastic registers, and wood and cardboard policies. |
| `raw_materials` | Incoming materials and supplier management. Includes: approved supplier lists, supplier approval procedures, supplier performance monitoring, incoming goods inspection, raw material specifications, certificates of analysis (CoA), and ingredient declarations. |
| `coding` | Product identification codes and labeling formats. Includes: date code formats (production date, best before, use by), lot/batch number formats and location on packaging, EAN/GTIN codes, internal product codes, and label verification procedures. |
| `packaging` | Packaging materials and food contact compliance. Includes: primary, secondary, and tertiary packaging specifications, packaging material composition, food contact materials (FCM) compliance, migration testing, MOSH/MOAH controls, PFAS compliance, packaging supplier approval, and sustainability of packaging (recyclability, recycled content). |
| `allergens` | Allergen management and declarations. Includes: allergen declarations (contains/may contain), allergen control procedures, cross-contamination prevention, allergen cleaning validation, allergen labeling compliance, precautionary allergen labeling (PAL), and allergen-free product lines. |
| `nutritional` | Nutritional composition and labeling. Includes: nutritional values (energy, fat, saturated fat, carbohydrates, sugars, protein, salt), vitamins and minerals, front-of-pack nutrition labeling, nutritional claims, and analytical methods for nutritional testing. |
| `gmo` | Genetically modified organism status and controls. Includes: GMO status declarations, non-GMO/GMO-free certifications (VLOG), IP (Identity Preserved) handling, below 0.9% threshold compliance (EU), bioengineered food disclosure (US), and GMO testing. |
| `origin` | Geographic origin and provenance. Includes: country of origin declarations, place of provenance per ingredient, origin of animal feed, EU/non-EU origin, protected designations (PDO, PGI), and supply chain mapping for origin. |
| `sustainability` | Environmental and social responsibility. Includes: environmental management, carbon footprint (Scope 1, 2, 3), Science Based Targets (SBTi), EcoVadis ratings, water and energy usage, waste reduction and recycling, deforestation-free commitments (EUDR), and corporate social responsibility (CSR) policies. |
| `animal_welfare` | Animal welfare standards and compliance. Includes: farm assurance schemes (Red Tractor, Bord Bia), animal welfare certifications, healthy animals requirements, antibiotic usage policies, animal transport conditions, pasture/grazing requirements (Weidegang), and cage-free/free-range status. |
| `logistics` | Storage, transport, and distribution. Includes: storage conditions and temperature control, cold chain management, warehouse certifications (GFSI for storage/distribution), transport vehicle requirements, cleaning of transport vehicles, third-party logistics providers, and distribution network. |
| `compliance` | Regulatory conformity and formal statements. Includes: declarations of conformity, regulatory compliance statements, legal compliance confirmations, export certifications, country-specific regulatory requirements, and formal compliance commitments. |

---

## Evidence Types

Evidence types categorize the NATURE or FORMAT of a document. A single document has one evidence type but may cover multiple topics.

| Evidence Type | Description |
|---------------|-------------|
| `specification` | Product technical data sheet. The core document describing a specific product. Contains: product name and codes, ingredient list, nutritional information, allergen declarations, physical/chemical parameters, microbiological criteria, shelf life, storage conditions, and packaging details. Typically product-specific and updated when product changes. |
| `certificate` | Third-party verified document with formal certification. Contains: certificate number, certification body name, scope of certification, issue date, expiry date, and certification standard. Examples: IFS certificate, ISO certificate, Organic certificate, Halal certificate, RSPO certificate. Always issued by an external certification body. |
| `procedure` | Internal process description document. Describes HOW something is done within the company. Contains: step-by-step instructions, responsibilities, frequencies, records to be kept. Examples: HACCP procedure, allergen control procedure, recall procedure, cleaning procedure. Owned and maintained by the company. |
| `policy` | High-level commitment document. Describes WHAT the company commits to and the principles it follows. Contains: policy statement, scope, commitments, responsibilities. Examples: quality policy, environmental policy, food safety policy, allergen policy, anti-fraud policy. Sets direction but not detailed steps. |
| `statement` | Formal position or declaration on a specific topic. A company's official stance or confirmation. Contains: clear position statement, scope, and sometimes signature. Examples: GMO statement, allergen statement, animal welfare statement, sustainability statement. Often requested by customers for specific topics. |
| `declaration` | Formal conformity confirmation document. Legal or regulatory compliance confirmation. Contains: declaration text, reference to regulations/standards, signature, date. Examples: declaration of conformity, supplier declaration, compliance declaration. Often has legal weight. |
| `report` | Results, findings, or analysis document. Contains: test results, audit findings, analysis outcomes, conclusions. Examples: laboratory test report, audit report, complaint analysis report, shelf life study report. Documents outcomes rather than processes. |
| `questionnaire` | Previously completed supplier questionnaire. Historical reference document showing answers given to another customer. Contains: questions and answers, date completed, customer name. Useful as reference for consistency but answers may need updating. |
| `reference` | External information document for context. Not created or owned by the company. Contains: external standards, regulations, guidance documents, industry benchmarks. Examples: EU regulations, Codex standards, customer requirements documents. Used for reference but not company evidence. |

---

## Examples

**Example 1: IFS Food Certificate**
- Evidence Type: `certificate`
- Topic: `certifications.food_safety`

**Example 2: Halal Certificate**
- Evidence Type: `certificate`
- Topic: `certifications.religious`

**Example 3: RSPO Certificate**
- Evidence Type: `certificate`
- Topic: `certifications.sustainability`

**Example 4: ISO 14001 Certificate**
- Evidence Type: `certificate`
- Topic: `certifications.iso`

**Example 5: HACCP Manual**
- Evidence Type: `procedure`
- Topics: `quality_systems`, `foreign_bodies`, `allergens`

**Example 6: Product Specification Sheet**
- Evidence Type: `specification`
- Topics: `nutritional`, `allergens`, `packaging`, `coding`, `shelf_life`

**Example 7: Supplier Questionnaire (filled)**
- Evidence Type: `questionnaire`
- Topics: (multiple - depends on questions covered)

**Example 8: GMO-Free Statement**
- Evidence Type: `statement`
- Topic: `gmo`

**Example 9: Environmental Policy**
- Evidence Type: `policy`
- Topic: `sustainability`

**Example 10: SMETA Audit Report**
- Evidence Type: `report`
- Topic: `certifications.social`
