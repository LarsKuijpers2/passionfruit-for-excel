/**
 * Token Manager for Passionfruit API
 *
 * Handles automatic token refresh using Keycloak refresh tokens.
 * Tokens are refreshed 30 seconds before expiry to avoid failures.
 */

import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// =============================================================================
// CONSTANTS
// =============================================================================

const AUTH_URL = 'https://auth.passionfruit.earth/realms/passionfruit/protocol/openid-connect/token';
const CLIENT_ID = 'passionfruit';
const REFRESH_BUFFER_SECONDS = 30; // Refresh 30 seconds before expiry

// =============================================================================
// TYPES
// =============================================================================

interface TokenPayload {
  exp: number;
  iat: number;
  [key: string]: unknown;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
}

// =============================================================================
// TOKEN MANAGER
// =============================================================================

let cachedAccessToken: string | null = null;
let cachedRefreshToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Decode JWT payload without verification
 */
function decodeJwtPayload(token: string): TokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payload = Buffer.from(parts[1], 'base64').toString('utf8');
  return JSON.parse(payload);
}

/**
 * Check if access token is expired or about to expire
 */
function isTokenExpired(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token);
    const now = Math.floor(Date.now() / 1000);
    return payload.exp <= now + REFRESH_BUFFER_SECONDS;
  } catch {
    return true;
  }
}

/**
 * Get refresh token from environment
 */
function getRefreshToken(): string | null {
  return process.env.PASSIONFRUIT_REFRESH_TOKEN || null;
}

/**
 * Get access token from environment
 */
function getAccessToken(): string | null {
  return process.env.PASSIONFRUIT_API_KEY || null;
}

/**
 * Update .env file with new tokens
 */
function updateEnvFile(accessToken: string, refreshToken: string): void {
  try {
    // Find project root by looking for .env file
    let envPath = join(process.cwd(), '.env');

    let envContent = readFileSync(envPath, 'utf8');

    // Update access token
    envContent = envContent.replace(
      /^PASSIONFRUIT_API_KEY=.*/m,
      `PASSIONFRUIT_API_KEY=${accessToken}`
    );

    // Update refresh token (add if not present)
    if (envContent.includes('PASSIONFRUIT_REFRESH_TOKEN=')) {
      envContent = envContent.replace(
        /^PASSIONFRUIT_REFRESH_TOKEN=.*/m,
        `PASSIONFRUIT_REFRESH_TOKEN=${refreshToken}`
      );
    } else {
      // Add after PASSIONFRUIT_API_KEY line
      envContent = envContent.replace(
        /^(PASSIONFRUIT_API_KEY=.*)$/m,
        `$1\nPASSIONFRUIT_REFRESH_TOKEN=${refreshToken}`
      );
    }

    writeFileSync(envPath, envContent);
    console.log('  ✓ Updated .env with new tokens');
  } catch (error) {
    console.warn('  ⚠ Could not update .env file:', error);
  }
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidAccessToken(): Promise<string> {
  // Check cached token first
  if (cachedAccessToken && !isTokenExpired(cachedAccessToken)) {
    return cachedAccessToken;
  }

  // Try to use token from environment
  const envAccessToken = getAccessToken();
  if (envAccessToken && !isTokenExpired(envAccessToken)) {
    cachedAccessToken = envAccessToken;
    return envAccessToken;
  }

  // Token is expired or missing, try to refresh
  const refreshToken = cachedRefreshToken || getRefreshToken();

  if (!refreshToken) {
    throw new Error(
      'Access token expired and no refresh token available.\n' +
      'Set PASSIONFRUIT_REFRESH_TOKEN in your .env file.'
    );
  }

  console.log('  🔄 Access token expired, refreshing...');

  try {
    const tokenResponse = await refreshAccessToken(refreshToken);

    // Update cache
    cachedAccessToken = tokenResponse.access_token;
    cachedRefreshToken = tokenResponse.refresh_token;

    // Update process.env so other parts of the app see the new token
    process.env.PASSIONFRUIT_API_KEY = tokenResponse.access_token;
    process.env.PASSIONFRUIT_REFRESH_TOKEN = tokenResponse.refresh_token;

    // Persist to .env file
    updateEnvFile(tokenResponse.access_token, tokenResponse.refresh_token);

    const payload = decodeJwtPayload(tokenResponse.access_token);
    const expiresIn = payload.exp - Math.floor(Date.now() / 1000);
    console.log(`  ✓ Token refreshed (valid for ${expiresIn}s)`);

    return tokenResponse.access_token;
  } catch (error) {
    throw new Error(
      `Failed to refresh token: ${error}\n` +
      'You may need to log in again and update PASSIONFRUIT_REFRESH_TOKEN.'
    );
  }
}

/**
 * Check if token refresh is available
 */
export function hasRefreshToken(): boolean {
  return Boolean(getRefreshToken());
}

/**
 * Get token status for debugging
 */
export function getTokenStatus(): {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  accessTokenExpired: boolean;
  expiresIn: number | null;
} {
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();

  let expiresIn: number | null = null;
  let expired = true;

  if (accessToken) {
    try {
      const payload = decodeJwtPayload(accessToken);
      const now = Math.floor(Date.now() / 1000);
      expiresIn = payload.exp - now;
      expired = expiresIn <= 0;
    } catch {
      // Invalid token
    }
  }

  return {
    hasAccessToken: Boolean(accessToken),
    hasRefreshToken: Boolean(refreshToken),
    accessTokenExpired: expired,
    expiresIn,
  };
}
