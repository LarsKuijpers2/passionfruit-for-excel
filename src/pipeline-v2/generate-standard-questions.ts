/**
 * Generate standard questions JSON with exact questions from template
 * Then match against the library
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { generateStandardQuestionsWithIds } from './standard-questions-template.js';

interface LibraryItem {
  label: string;
  value: string;
  sources?: string[];
}

interface LibraryMatch {
  label: string;
  value: string;
  sources: string[];
}

// Normalize Yes/No values
function normalizeYesNo(value: string): string {
  const v = value.toLowerCase().trim();
  if (v === 'yes' || v === 'ja' || v === 'oui' || v === 'si' || v === 'y') return 'Yes';
  if (v === 'no' || v === 'nee' || v === 'non' || v === 'nein' || v === 'n' || v === 'nee-no') return 'No';
  return value;
}

// Check if a match is relevant (not just keyword overlap)
function isRelevantMatch(question: string, match: LibraryItem): boolean {
  const q = question.toLowerCase();
  const label = match.label.toLowerCase();
  const value = match.value.toLowerCase();

  // Contact info patterns
  const isContactInfo = label.includes('phone') || label.includes('fax') ||
    label.includes('email') || label.includes('telefoon') || label.includes('e-mail') ||
    label.includes('contact name') || label.includes('contactpersoon') ||
    value.includes('@') || /^\+?\d[\d\s\-\(\)]+$/.test(match.value.trim());

  // System/procedure questions should NOT match contact info
  const isSystemQuestion = q.includes('manual') || q.includes('procedure') ||
    q.includes('plan') || q.includes('system') || q.includes('program') ||
    q.includes('documented') || q.includes('conducted') || q.includes('established') ||
    q.includes('ccp') || (q.includes('haccp') && !q.includes('contact'));

  if (isContactInfo && isSystemQuestion) return false;

  // CCP questions should not match HACCP contacts
  if (q.includes('ccp') && (label.includes('referent') || label.includes('contact'))) return false;

  // Product info shouldn't match site questions
  if ((label.includes('product name') || label.includes('article number')) &&
      !q.includes('product')) return false;

  return true;
}

// Find relevant library matches for a question
function findMatches(question: string, libraryItems: LibraryItem[]): LibraryItem[] {
  const q = question.toLowerCase();
  const matches: LibraryItem[] = [];

  // Keywords to search for based on question content
  const keywords: string[] = [];

  // Quality Management
  if (q.includes('quality manual')) keywords.push('kwaliteitssysteem', 'quality system', 'quality manual');
  if (q.includes('procedures in place')) keywords.push('procedure', 'procedures');
  if (q.includes('internal audit')) keywords.push('internal audit', 'interne audit');
  if (q.includes('hygienic round')) keywords.push('hygiene', 'hygiënisch', 'visual inspection');
  if (q.includes('glass') && q.includes('plastic')) keywords.push('breuk', 'glass', 'breakage');
  if (q.includes('audits documented')) keywords.push('audit', 'documented', 'rapportage');

  // Buildings & Facilities
  if (q.includes('buildings') && q.includes('designed')) keywords.push('building', 'premises', 'facility', 'floors', 'walls');
  if (q.includes('pollution')) keywords.push('pollution', 'environment');
  if (q.includes('access') && q.includes('restricted')) keywords.push('access', 'toegang', 'restricted');
  if (q.includes('boundaries') || q.includes('terrain')) keywords.push('perimeter', 'boundary', 'terrain');

  // Facilities
  if (q.includes('laboratory facilities')) keywords.push('laboratory', 'lab', 'analysis');
  if (q.includes('washing') && q.includes('toilet')) keywords.push('toilet', 'washing', 'sanitary');
  if (q.includes('locker room')) keywords.push('locker', 'changing room', 'kleedkamer');
  if (q.includes('smoking')) keywords.push('smoking', 'roken');
  if (q.includes('canteen')) keywords.push('canteen', 'kantine');

  // Zoning
  if (q.includes('zoning')) keywords.push('zoning', 'zone', 'area');
  if (q.includes('temperature controlled')) keywords.push('temperature', 'temperatuur');
  if (q.includes('humidity')) keywords.push('humidity', 'vochtigheid');
  if (q.includes('contamination')) keywords.push('contamination', 'cross-contamination', 'besmetting');

  // Hygiene
  if (q.includes('hygiene procedure')) keywords.push('hygiene', 'hygiëne', 'personal hygiene');
  if (q.includes('eating') || q.includes('drinking') || q.includes('smoking')) keywords.push('eating', 'drinking', 'smoking');
  if (q.includes('jewellery')) keywords.push('jewellery', 'jewelry', 'sieraden');
  if (q.includes('hair') || q.includes('beard')) keywords.push('hair', 'beard', 'haar');
  if (q.includes('uniform')) keywords.push('uniform', 'clothing', 'kleding');

  // Training
  if (q.includes('training')) keywords.push('training', 'trained', 'opleiding');

  // Storage
  if (q.includes('raw materials stored')) keywords.push('raw material', 'grondstof', 'storage');
  if (q.includes('finished') && q.includes('stored')) keywords.push('finished', 'storage', 'warehouse');
  if (q.includes('warehouse')) keywords.push('warehouse', 'magazijn');
  if (q.includes('chemicals') || q.includes('hazardous')) keywords.push('chemical', 'hazardous', 'cleaning product');
  if (q.includes('fifo') || q.includes('fefo')) keywords.push('fifo', 'fefo', 'voorraad');

  // Transportation
  if (q.includes('transport')) keywords.push('transport', 'logistics', 'delivery');

  // Utilities
  if (q.includes('utilities')) keywords.push('utilities', 'water', 'energy', 'air');

  // Air/Water monitoring
  if (q.includes('air treatment') || q.includes('air quality')) keywords.push('air', 'lucht', 'ventilation');
  if (q.includes('water') && (q.includes('source') || q.includes('monitoring') || q.includes('quality')))
    keywords.push('water');
  if (q.includes('compressed air')) keywords.push('compressed air', 'perslucht');

  // Waste
  if (q.includes('waste')) keywords.push('waste', 'afval');

  // Supplier management
  if (q.includes('supplier') && (q.includes('approval') || q.includes('procedure')))
    keywords.push('supplier', 'leverancier', 'approval');
  if (q.includes('qualification') || q.includes('disqualification')) keywords.push('qualification', 'kwalificatie');

  // Raw materials
  if (q.includes('materials') && q.includes('receipt')) keywords.push('receipt', 'incoming', 'ingangscontrole');
  if (q.includes('quarantine')) keywords.push('quarantine', 'vrijgave');
  if (q.includes('sampler') || q.includes('sampling')) keywords.push('sampling', 'sample', 'monster');
  if (q.includes('certificate of analysis')) keywords.push('certificate', 'certificaat', 'CoA');
  if (q.includes('retained sample')) keywords.push('retained', 'bewaar', 'sample');
  if (q.includes('rejected')) keywords.push('rejected', 'afgekeurd', 'non-conforming');

  // Equipment
  if (q.includes('equipment') && q.includes('designed')) keywords.push('equipment', 'apparatuur');
  if (q.includes('contact surface')) keywords.push('contact', 'surface');
  if (q.includes('food contact')) keywords.push('food contact', 'EC 1935');
  if (q.includes('lubricant')) keywords.push('lubricant', 'smeermiddel');
  if (q.includes('maintenance')) keywords.push('maintenance', 'onderhoud');
  if (q.includes('calibrat')) keywords.push('calibration', 'kalibratie');

  // Production
  if (q.includes('reused') || q.includes('reuse')) keywords.push('reuse', 'hergebruik');
  if (q.includes('production shift')) keywords.push('shift', 'ploeg');

  // Allergen
  if (q.includes('allergen')) keywords.push('allergen', 'allergeen');

  // HACCP
  if (q.includes('haccp')) keywords.push('haccp');
  if (q.includes('hazard assessment')) keywords.push('hazard', 'gevaar', 'risico');
  if (q.includes('ccp') && !q.includes('haccp')) keywords.push('ccp', 'critical control');
  if (q.includes('microbiological hazard')) keywords.push('microbiological', 'microbiologisch');
  if (q.includes('chemical hazard')) keywords.push('chemical hazard', 'chemisch');
  if (q.includes('physical hazard')) keywords.push('physical hazard', 'fysiek');

  // Sampling
  if (q.includes('sampling plan')) keywords.push('sampling', 'analysis plan', 'analyseplan');

  // Cleaning
  if (q.includes('cleaning')) keywords.push('cleaning', 'reiniging', 'schoonmaak');
  if (q.includes('sanitization')) keywords.push('sanitization', 'desinfectie');

  // Environmental monitoring
  if (q.includes('environmental monitoring')) keywords.push('environmental', 'milieu', 'monitoring');
  if (q.includes('pathogen')) keywords.push('pathogen', 'pathogeen');

  // Pest control
  if (q.includes('pest control') || q.includes('pest')) keywords.push('pest', 'ongedierte');
  if (q.includes('fumigation')) keywords.push('fumigation');
  if (q.includes('pesticide')) keywords.push('pesticide');

  // Recall & Traceability
  if (q.includes('recall')) keywords.push('recall', 'terugroep', 'calamiteit');
  if (q.includes('traceability')) keywords.push('traceability', 'traceerbaarheid', 'traceer');
  if (q.includes('mock recall')) keywords.push('mock', 'test');
  if (q.includes('24/7') || q.includes('crisis')) keywords.push('24/7', 'crisis', 'emergency');

  // Food Defense & Fraud
  if (q.includes('food defense')) keywords.push('food defense', 'defense', 'protection');
  if (q.includes('food fraud')) keywords.push('fraud', 'fraude', 'authenticity');
  if (q.includes('threat')) keywords.push('threat', 'bedreiging');

  // Search library for matches
  for (const item of libraryItems) {
    const label = item.label.toLowerCase();
    const value = item.value.toLowerCase();

    for (const keyword of keywords) {
      if (label.includes(keyword.toLowerCase()) || value.includes(keyword.toLowerCase())) {
        if (isRelevantMatch(question, item) && !matches.includes(item)) {
          matches.push(item);
        }
        break;
      }
    }
  }

  return matches.slice(0, 5); // Max 5 matches per question
}

// Generate suggested answer from matches
function generateAnswer(question: string, matches: LibraryItem[]): string | null {
  if (matches.length === 0) return null;

  const q = question.toLowerCase();
  const firstMatch = matches[0];
  const normalized = normalizeYesNo(firstMatch.value);

  // Yes/No questions
  if (q.startsWith('is ') || q.startsWith('are ') || q.startsWith('do ') ||
      q.startsWith('does ') || q.startsWith('can ')) {
    if (normalized === 'Yes' || normalized === 'No') {
      return normalized;
    }
    // If we have content, it implies Yes
    if (firstMatch.value.trim().length > 0 && firstMatch.value.trim() !== '-') {
      return `Yes, ${firstMatch.value}`;
    }
  }

  // What/Which/How/Who questions - return actual value
  if (q.startsWith('what ') || q.startsWith('which ') || q.startsWith('how ') ||
      q.startsWith('who ') || q.includes('describe')) {
    return firstMatch.value;
  }

  return normalized;
}

async function main() {
  const customer = process.argv[2] || 'Taste Strik';
  console.log(`Generating standard questions for: ${customer}`);

  // Fetch library data
  const response = await fetch(`http://localhost:3456/api/aggregated-library/${encodeURIComponent(customer)}`);
  if (!response.ok) {
    console.error('Failed to fetch library data. Is the server running?');
    process.exit(1);
  }

  const data = await response.json();
  const libraryItems: LibraryItem[] = [
    ...data.groups.flatMap((g: any) => g.items.map((i: any) => ({ ...i, sources: i.sources || [] }))),
    ...data.company.items.map((i: any) => ({ ...i, sources: i.sources || [] })),
  ];

  console.log(`Found ${libraryItems.length} library items`);

  // Generate questions from template
  const template = generateStandardQuestionsWithIds();

  let totalQuestions = 0;
  let answeredQuestions = 0;

  const sections = template.map((section: { section: string; questions: { id: string; question: string }[] }) => ({
    section: section.section,
    questions: section.questions.map((q: { id: string; question: string }) => {
      totalQuestions++;

      const matches = findMatches(q.question, libraryItems);
      const answer = generateAnswer(q.question, matches);

      if (answer) answeredQuestions++;

      return {
        id: q.id,
        question: q.question,
        suggestedAnswer: answer,
        sources: [...new Set(matches.flatMap((m) => m.sources || []))],
        libraryMatches: matches.map((m) => ({
          label: m.label,
          value: m.value,
          sources: m.sources || [],
        })),
      };
    }),
  }));

  console.log(`\nResults:`);
  console.log(`  Total questions: ${totalQuestions}`);
  console.log(`  Answered: ${answeredQuestions} (${Math.round((answeredQuestions / totalQuestions) * 100)}%)`);

  // Save to file
  const output = {
    customer,
    generatedAt: new Date().toISOString().split('T')[0],
    totalQuestions,
    answeredQuestions,
    sections,
  };

  const outputPath = join('./customers', customer, 'standard-questions.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved to: ${outputPath}`);
}

main().catch(console.error);
