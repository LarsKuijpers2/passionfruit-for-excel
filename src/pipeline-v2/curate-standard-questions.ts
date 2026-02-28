/**
 * Curate standard questions by carefully filtering matches
 *
 * Rules:
 * 1. Keep original questions exactly as provided
 * 2. Only match if the library item actually answers the question
 * 3. Format: "Yes, [details from actual data]" where appropriate
 * 4. Never make up information
 * 5. Flag uncertain matches for review
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface LibraryMatch {
  label: string;
  value: string;
  sources: string[];
}

interface StandardQuestion {
  id: string;
  question: string;
  suggestedAnswer: string | null;
  sources: string[];
  libraryMatches: LibraryMatch[];
  confidence?: 'high' | 'medium' | 'low' | 'none';
  needsReview?: boolean;
}

interface StandardQuestionSection {
  section: string;
  questions: StandardQuestion[];
}

interface StandardQuestionsData {
  customer: string;
  generatedAt: string;
  totalQuestions: number;
  sections: StandardQuestionSection[];
}

// Helper to normalize Yes/No values
function normalizeYesNo(value: string): string {
  const v = value.toLowerCase().trim();
  if (v === 'yes' || v === 'ja' || v === 'oui' || v === 'si' || v === 'y') {
    return 'Yes';
  }
  if (v === 'no' || v === 'nee' || v === 'non' || v === 'nein' || v === 'n' || v === 'nee-no') {
    return 'No';
  }
  return value;
}

// Check if a library match is actually relevant to a question
function isRelevantMatch(question: string, match: LibraryMatch): boolean {
  const q = question.toLowerCase();
  const label = match.label.toLowerCase();
  const value = match.value.toLowerCase();

  // Exclude contact info when asking about systems/procedures
  const isContactInfo = label.includes('phone') || label.includes('fax') ||
    label.includes('email') || label.includes('telefoon') ||
    label.includes('e-mail') || label.includes('contact name') ||
    label.includes('contactpersoon') || value.includes('@') ||
    /^\+?\d[\d\s\-\(\)]+$/.test(match.value.trim());

  // Questions that should NOT match contact info
  const isSystemQuestion = q.includes('manual') || q.includes('system') ||
    q.includes('procedure') || q.includes('plan') || q.includes('certified') ||
    q.includes('audit') || q.includes('conducted') || q.includes('documented') ||
    q.includes('implemented') || q.includes('ccp') || q.includes('haccp') && !q.includes('contact');

  if (isContactInfo && isSystemQuestion) {
    return false;
  }

  // Specific exclusion rules
  // "Which CCPs are identified" should not match HACCP contact info
  if (q.includes('ccp') && (label.includes('referent') || label.includes('contact'))) {
    return false;
  }

  // "Quality manual" should not match quality contact info
  if (q.includes('quality manual') && isContactInfo) {
    return false;
  }

  // Product-specific questions should not match general data for site questions
  if (label.includes('product name') && !q.includes('product')) {
    return false;
  }

  return true;
}

// Generate a proper suggested answer from relevant matches
function generateSuggestedAnswer(question: string, relevantMatches: LibraryMatch[]): string | null {
  if (relevantMatches.length === 0) {
    return null;
  }

  const q = question.toLowerCase();
  const firstMatch = relevantMatches[0];
  const normalizedValue = normalizeYesNo(firstMatch.value);

  // For Yes/No type questions
  if (q.includes('do you have') || q.includes('are there') ||
      q.includes('is there') || q.includes('are ') ||
      q.includes('does ') || q.includes('is the') ||
      q.includes('can you') || q.includes('has ')) {

    // If the library item is already a clear Yes/No
    if (normalizedValue === 'Yes' || normalizedValue === 'No') {
      // Add context if available from the match label
      return normalizedValue;
    }

    // If there's actual content, assume Yes with that content
    if (firstMatch.value.trim().length > 0 && firstMatch.value.trim() !== '-') {
      // Check if it looks like a certification or specific answer
      if (firstMatch.value.includes('BRC') || firstMatch.value.includes('IFS') ||
          firstMatch.value.includes('FSSC') || firstMatch.value.includes('ISO')) {
        return `Yes, ${firstMatch.value}`;
      }
      return normalizedValue !== 'No' ? firstMatch.value : 'No';
    }
  }

  // For "What/Which/Who/How" questions, return the actual value
  if (q.startsWith('what') || q.startsWith('which') ||
      q.startsWith('who') || q.startsWith('how') ||
      q.includes('name?') || q.includes('address?') ||
      q.includes('phone?') || q.includes('email?')) {
    return firstMatch.value;
  }

  return normalizedValue;
}

async function main() {
  const customer = process.argv[2] || 'Taste Strik';
  console.log(`Curating standard questions for: ${customer}`);

  // Read existing standard questions file
  const inputPath = join('./customers', customer, 'standard-questions.json');
  let existingData: StandardQuestionsData;

  try {
    existingData = JSON.parse(readFileSync(inputPath, 'utf-8'));
    console.log(`Loaded ${existingData.totalQuestions} questions from existing file`);
  } catch (e) {
    console.error(`Could not read ${inputPath}`);
    process.exit(1);
  }

  // Process each section and question
  let totalAnswered = 0;
  let totalReviewed = 0;
  let removedMatches = 0;

  const newSections: StandardQuestionSection[] = [];

  for (const section of existingData.sections) {
    const newQuestions: StandardQuestion[] = [];

    for (const q of section.questions) {
      // Filter to only relevant matches
      const relevantMatches = q.libraryMatches.filter(m => isRelevantMatch(q.question, m));
      const removedCount = q.libraryMatches.length - relevantMatches.length;
      removedMatches += removedCount;

      // Generate new suggested answer from relevant matches only
      const newAnswer = generateSuggestedAnswer(q.question, relevantMatches);

      // Determine confidence
      let confidence: 'high' | 'medium' | 'low' | 'none' = 'none';
      let needsReview = false;

      if (relevantMatches.length > 0 && newAnswer) {
        if (relevantMatches.length >= 2) {
          confidence = 'high';
        } else if (normalizeYesNo(newAnswer) === 'Yes' || normalizeYesNo(newAnswer) === 'No') {
          confidence = 'high';
        } else {
          confidence = 'medium';
        }
      } else if (q.libraryMatches.length > 0 && relevantMatches.length === 0) {
        // Had matches but all were filtered out - flag for review
        needsReview = true;
        confidence = 'none';
      }

      if (newAnswer) totalAnswered++;
      if (needsReview) totalReviewed++;

      newQuestions.push({
        id: q.id,
        question: q.question, // Keep original question exactly
        suggestedAnswer: newAnswer,
        sources: relevantMatches.flatMap(m => m.sources),
        libraryMatches: relevantMatches,
        confidence,
        needsReview,
      });
    }

    newSections.push({
      section: section.section, // Keep original section name
      questions: newQuestions,
    });
  }

  console.log(`\nResults:`);
  console.log(`  Total questions: ${existingData.totalQuestions}`);
  console.log(`  Answered: ${totalAnswered} (${Math.round(totalAnswered / existingData.totalQuestions * 100)}%)`);
  console.log(`  Needs review: ${totalReviewed}`);
  console.log(`  Removed irrelevant matches: ${removedMatches}`);

  // Save updated file
  const output = {
    customer,
    generatedAt: new Date().toISOString().split('T')[0],
    totalQuestions: existingData.totalQuestions,
    answeredQuestions: totalAnswered,
    needsReviewCount: totalReviewed,
    sections: newSections,
  };

  writeFileSync(inputPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved to: ${inputPath}`);

  // Show some examples of filtered questions
  console.log(`\n--- Sample filtered questions ---`);
  let shown = 0;
  for (const section of newSections) {
    for (const q of section.questions) {
      if (q.needsReview || (q.libraryMatches.length === 0 && q.suggestedAnswer === null)) {
        console.log(`\n[${q.id}] ${q.question}`);
        console.log(`  Answer: ${q.suggestedAnswer || '(no data)'}`);
        if (q.needsReview) console.log(`  ⚠️  Needs review`);
        shown++;
        if (shown >= 5) break;
      }
    }
    if (shown >= 5) break;
  }
}

main().catch(console.error);
