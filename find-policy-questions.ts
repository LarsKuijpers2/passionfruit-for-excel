#!/usr/bin/env tsx

import * as fs from 'fs';

// Read the exported answers
const answers = JSON.parse(fs.readFileSync('./doehler-svz-all-answers.json', 'utf8'));

// Specific patterns we're looking for
const targetPatterns = [
  /do you have.*policy.*on/i,
  /do you have.*procedure.*on/i,
  /do you have.*policy.*for/i,
  /do you have.*procedure.*for/i,
  /do you have.*policy/i,
  /do you have.*procedure/i
];

// Related patterns that might be similar
const relatedPatterns = [
  /do you have.*manual/i,
  /do you have.*system/i,
  /do you have.*program/i,
  /do you have.*plan.*for/i,
  /do you have.*training.*on/i,
  /do you have.*training.*for/i,
  /are there.*procedure/i,
  /is there.*policy/i,
  /is there.*procedure/i
];

const targetQuestions: any[] = [];
const relatedQuestions: any[] = [];

answers.forEach((answer: any) => {
  const question = answer.question;

  // Check for target patterns
  const matchesTarget = targetPatterns.some(pattern => pattern.test(question));
  if (matchesTarget) {
    targetQuestions.push({...answer, matchType: 'target'});
    return; // Don't also add to related
  }

  // Check for related patterns
  const matchesRelated = relatedPatterns.some(pattern => pattern.test(question));
  if (matchesRelated) {
    relatedQuestions.push({...answer, matchType: 'related'});
  }
});

console.log(`=== TARGET QUESTIONS: "Do you have a policy/procedure on/for..." (${targetQuestions.length}) ===\n`);

targetQuestions.forEach((q, index) => {
  console.log(`${index + 1}. "${q.question}"`);
  console.log(`   Answer: "${q.answer}"`);
  console.log(`   Topic: ${q.topic} | Section: ${q.section}`);
  console.log(`   Sources: ${q.sourceCount} questionnaire(s)\n`);
});

console.log(`\n=== RELATED QUESTIONS: Similar patterns (${relatedQuestions.length}) ===\n`);

relatedQuestions.forEach((q, index) => {
  console.log(`${index + 1}. "${q.question}"`);
  console.log(`   Answer: "${q.answer}"`);
  console.log(`   Topic: ${q.topic} | Section: ${q.section}`);
  console.log(`   Sources: ${q.sourceCount} questionnaire(s)\n`);
});

// Save all questions to file
const allFoundQuestions = [...targetQuestions, ...relatedQuestions];
fs.writeFileSync('./doehler-svz-policy-questions.json', JSON.stringify(allFoundQuestions, null, 2));

console.log(`\nSaved ${allFoundQuestions.length} questions to: doehler-svz-policy-questions.json`);
console.log(`(${targetQuestions.length} target questions + ${relatedQuestions.length} related questions)`);
console.log(`\nNext steps: Review these questions and identify which ones need statements and entities added.`);