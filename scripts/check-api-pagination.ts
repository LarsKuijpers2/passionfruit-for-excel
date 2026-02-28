/**
 * Check API pagination and get all answers
 */

import 'dotenv/config';
import { getApiBaseUrl, getApiKey } from '../src/config/environments.js';
import { getValidAccessToken, hasRefreshToken } from '../src/config/token-manager.js';

async function checkAnswers() {
  const baseUrl = getApiBaseUrl();
  let token = getApiKey();

  if (hasRefreshToken()) {
    token = await getValidAccessToken();
  }

  console.log('Base URL:', baseUrl);

  // Try with pagination params
  const response = await fetch(`${baseUrl}/api/v2/answers/?page=1&pageSize=1000`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const data = await response.json();
  console.log('\nResponse type:', Array.isArray(data) ? 'array' : typeof data);

  if (data.items) {
    console.log('Items count:', data.items.length);
    console.log('Total:', data.total);
    console.log('Page:', data.page);
    console.log('PageSize:', data.pageSize);

    // Show first and last few
    console.log('\nFirst 3 answers:');
    for (const a of data.items.slice(0, 3)) {
      console.log(`  [${a.id}] ${a.question?.slice(0, 50)}...`);
    }
    console.log('\nLast 3 answers:');
    for (const a of data.items.slice(-3)) {
      console.log(`  [${a.id}] ${a.question?.slice(0, 50)}...`);
    }
  } else if (Array.isArray(data)) {
    console.log('Array length:', data.length);

    console.log('\nFirst 3 answers:');
    for (const a of data.slice(0, 3)) {
      console.log(`  [${a.id}] ${a.question?.slice(0, 50)}...`);
    }
    console.log('\nLast 3 answers:');
    for (const a of data.slice(-3)) {
      console.log(`  [${a.id}] ${a.question?.slice(0, 50)}...`);
    }
  } else {
    console.log('Unexpected response:', JSON.stringify(data).slice(0, 200));
  }
}

checkAnswers().catch(console.error);
