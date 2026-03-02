import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('customers/numidia/curated-library-consolidated.json', 'utf-8'));

// Map of role -> full person info (to merge role-only entries with named entries)
const roleToName: Record<string, { name: string; title: string; email?: string; phone?: string }> = {
  'CEO': { name: 'Han van Hagen', title: 'CEO', email: 'h.vanhagen@numidia.nl', phone: 'M:+31 6 51521155/T:+31 475729120' },
  'Operations Manager': { name: 'Lucia Romero Figari', title: 'Operations Manager', email: 'l.romero@numidia.nl', phone: '+59826262649' },
  'Commercial Manager': { name: 'Conor Handley', title: 'Commercial Manager', email: 'c.handley@numidia.nl', phone: '+001 2149280248' },
  'Quality Manager': { name: 'Kristy Heesen', title: 'Quality Manager', email: 'k.heesen@numidia.nl', phone: '+31 639079707' },
  'QA department': { name: 'QA Department', title: 'QA Department', email: 'qa@numidia.nl', phone: '+31 475 729 100' },
};

// Final cleanup - keep best version of each contact
const finalItems: any[] = [];
const contactsByPerson = new Map<string, any>();

for (const item of data.items) {
  if (!item._consolidated) {
    finalItems.push(item);
    continue;
  }

  // Find person identifier
  let personKey: string | null = null;
  for (const [role, info] of Object.entries(roleToName)) {
    if (item.question.toLowerCase().includes(info.name.toLowerCase())) {
      personKey = info.name;
      break;
    }
    if (item.question.toLowerCase().includes(role.toLowerCase())) {
      personKey = info.name;
      break;
    }
  }

  if (!personKey) {
    // Unknown contact (like "contact person"), skip
    continue;
  }

  // Keep the one with more info (more _originalEntries)
  const existing = contactsByPerson.get(personKey);
  if (!existing || item._originalEntries > existing._originalEntries) {
    contactsByPerson.set(personKey, item);
  }
}

// Add deduplicated contacts
for (const contact of contactsByPerson.values()) {
  finalItems.push(contact);
}

console.log(`\nFinal contact consolidation:`);
console.log(`- Original items: ${data.items.length}`);
console.log(`- After dedup: ${finalItems.length}`);
console.log(`- Removed: ${data.items.length - finalItems.length} duplicates`);

// Show final contacts
const finalContacts = finalItems.filter((i: any) => i._consolidated);
console.log(`\nFinal ${finalContacts.length} consolidated contacts:`);
for (const c of finalContacts) {
  console.log(`\nQ: ${c.question}`);
  console.log(`A: ${c.answer.replace(/\n/g, ' | ')}`);
}

// Save
const output = {
  ...data,
  generatedAt: new Date().toISOString(),
  totalItems: finalItems.length,
  items: finalItems
};

writeFileSync('customers/numidia/curated-library-final.json', JSON.stringify(output, null, 2));
console.log(`\nSaved to: customers/numidia/curated-library-final.json`);
