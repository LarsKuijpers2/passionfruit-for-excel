import * as fs from 'fs';
import * as path from 'path';

const customerDir = 'customers/beneo';

// Read existing pipeline
const pipeline = JSON.parse(fs.readFileSync(path.join(customerDir, 'pipeline.json'), 'utf-8'));

// Get all files
const incoming = fs.readdirSync(path.join(customerDir, 'incoming'))
  .filter(f => !f.startsWith('.'));
const structure = fs.readdirSync(path.join(customerDir, 'structure'))
  .filter(f => f.endsWith('.json'));
const indexed = fs.existsSync(path.join(customerDir, 'indexed'))
  ? fs.readdirSync(path.join(customerDir, 'indexed')).filter(f => f.endsWith('.json'))
  : [];

// Extract product variant from filename
function detectProduct(filename: string): string | null {
  const upper = filename.toUpperCase();

  // Check specific patterns
  if (upper.includes('ST-F') && !upper.includes('ST-PF')) return 'ISOMALT ST-F';
  if (upper.includes('ST-PF')) return 'ISOMALT ST-PF';
  if (upper.includes('ST-M')) return 'ISOMALT ST-M';
  if (upper.includes('LM-PF')) return 'ISOMALT LM-PF';
  if (upper.includes('GS_LIQUID') || upper.includes('GS LIQUID')) return 'ISOMALT GS liquid';
  if (upper.includes('ST_LIQUID') || upper.includes('ST LIQUID')) return 'ISOMALT ST liquid';
  if (upper.includes('HC_LIQUID') || upper.includes('HC LIQUID')) return 'ISOMALT HC liquid';
  if (upper.includes('_GS_') || upper.includes(' GS ') || upper.includes('GS_25KG')) return 'ISOMALT GS';

  return null;
}

// Detect questionnaire type from filename
function detectType(filename: string): 'product' | 'supplier' {
  const lower = filename.toLowerCase();
  if (lower.includes('supplier') || lower.includes('lieferant') ||
      lower.includes('audit') || lower.includes('assessment') ||
      lower.includes('selbstauskunft') || lower.includes('fragebogen')) {
    return 'supplier';
  }
  return 'product';
}

// Normalize filename for matching
function normalize(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 30);
}

// Build questionnaire list
const questionnaires = incoming.map(file => {
  const norm = normalize(file);
  const isStored = structure.some(s => normalize(s).includes(norm.substring(0, 20)));
  const isIndexed = indexed.some(s => normalize(s).includes(norm.substring(0, 20)));

  return {
    originalFile: file,
    type: detectType(file),
    productVariant: detectProduct(file),
    customer: file.split('_')[0],
    status: isIndexed ? 'indexed' : (isStored ? 'stored' : 'incoming')
  };
});

pipeline.questionnaires = questionnaires;
fs.writeFileSync(path.join(customerDir, 'pipeline.json'), JSON.stringify(pipeline, null, 2));

console.log(`Updated pipeline.json with ${questionnaires.length} questionnaires`);
console.log('By status:');
console.log('  incoming:', questionnaires.filter(q => q.status === 'incoming').length);
console.log('  stored:', questionnaires.filter(q => q.status === 'stored').length);
console.log('  indexed:', questionnaires.filter(q => q.status === 'indexed').length);
console.log('By type:');
console.log('  product:', questionnaires.filter(q => q.type === 'product').length);
console.log('  supplier:', questionnaires.filter(q => q.type === 'supplier').length);
console.log('Product variants:');
const variants = new Map<string, number>();
questionnaires.forEach(q => {
  const v = q.productVariant || 'unknown';
  variants.set(v, (variants.get(v) || 0) + 1);
});
variants.forEach((count, variant) => {
  console.log(`  ${variant}: ${count}`);
});
