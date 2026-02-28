/**
 * Fetch ALL API answers using different pagination approaches
 */
import 'dotenv/config';

const API_URL = 'https://production.passionfruitapi.com';

async function getToken(): Promise<string> {
  const token = process.env.PASSIONFRUIT_API_KEY;
  if (!token) throw new Error('No API key');
  return token;
}

async function fetchWithAuth(endpoint: string): Promise<any> {
  const token = await getToken();
  const url = `${API_URL}${endpoint}`;
  console.log(`Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function main() {
  console.log('Testing different pagination approaches...\n');

  // Try 1: Default endpoint
  console.log('=== Try 1: Default /api/v2/answers/ ===');
  try {
    const r1 = await fetchWithAuth('/api/v2/answers/');
    console.log('Response type:', Array.isArray(r1) ? 'array' : typeof r1);
    console.log('Count:', Array.isArray(r1) ? r1.length : r1.count || r1.total || 'unknown');
    if (r1.results) console.log('Results count:', r1.results.length);
    if (r1.items) console.log('Items count:', r1.items.length);
    console.log('Keys:', Object.keys(r1).slice(0, 10));
  } catch (e) {
    console.log('Error:', e);
  }

  // Try 2: With limit parameter
  console.log('\n=== Try 2: With limit=1000 ===');
  try {
    const r2 = await fetchWithAuth('/api/v2/answers/?limit=1000');
    console.log('Response type:', Array.isArray(r2) ? 'array' : typeof r2);
    console.log('Count:', Array.isArray(r2) ? r2.length : r2.count || r2.total || 'unknown');
    if (r2.results) console.log('Results count:', r2.results.length);
    if (r2.items) console.log('Items count:', r2.items.length);
  } catch (e) {
    console.log('Error:', e);
  }

  // Try 3: With page_size parameter
  console.log('\n=== Try 3: With page_size=1000 ===');
  try {
    const r3 = await fetchWithAuth('/api/v2/answers/?page_size=1000');
    console.log('Response type:', Array.isArray(r3) ? 'array' : typeof r3);
    console.log('Count:', Array.isArray(r3) ? r3.length : r3.count || r3.total || 'unknown');
    if (r3.results) console.log('Results count:', r3.results.length);
    if (r3.items) console.log('Items count:', r3.items.length);
  } catch (e) {
    console.log('Error:', e);
  }

  // Try 4: Check if there's pagination info in response
  console.log('\n=== Try 4: Check pagination info ===');
  try {
    const r4 = await fetchWithAuth('/api/v2/answers/?page=1&page_size=10');
    console.log('Full response structure:');
    console.log(JSON.stringify(r4, null, 2).substring(0, 1500));
  } catch (e) {
    console.log('Error:', e);
  }

  // Try 5: Different endpoint format
  console.log('\n=== Try 5: /api/v2/answers (no trailing slash) ===');
  try {
    const r5 = await fetchWithAuth('/api/v2/answers?limit=1000');
    console.log('Response type:', Array.isArray(r5) ? 'array' : typeof r5);
    console.log('Count:', Array.isArray(r5) ? r5.length : r5.count || r5.total || 'unknown');
  } catch (e) {
    console.log('Error:', e);
  }
}

main().catch(console.error);
