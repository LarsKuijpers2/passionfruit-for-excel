/**
 * Environment Configuration for Passionfruit API
 *
 * Supports development and production environments.
 * Set PASSIONFRUIT_ENV to switch between them.
 */

// =============================================================================
// TYPES
// =============================================================================

export type Environment = 'development' | 'production';

export interface EnvironmentConfig {
  /** Environment name */
  name: Environment;
  /** Base URL for the Passionfruit API */
  apiBaseUrl: string;
  /** Whether authentication is required */
  requiresAuth: boolean;
  /** Display name for CLI output */
  displayName: string;
}

// =============================================================================
// ENVIRONMENT DEFINITIONS
// =============================================================================

export const ENVIRONMENTS: Record<Environment, EnvironmentConfig> = {
  development: {
    name: 'development',
    apiBaseUrl: 'https://dev.passionfruitapi.com',
    requiresAuth: true,
    displayName: 'Development',
  },
  production: {
    name: 'production',
    apiBaseUrl: 'https://production.passionfruitapi.com',
    requiresAuth: true,
    displayName: 'Production',
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the current environment from PASSIONFRUIT_ENV
 * Defaults to 'development' if not set
 */
export function getEnvironment(): Environment {
  const env = process.env.PASSIONFRUIT_ENV || 'development';

  if (env !== 'development' && env !== 'production') {
    console.warn(`Invalid PASSIONFRUIT_ENV: "${env}". Using 'development'.`);
    return 'development';
  }

  return env;
}

/**
 * Get the configuration for the current environment
 */
export function getConfig(): EnvironmentConfig {
  return ENVIRONMENTS[getEnvironment()];
}

/**
 * Get the API base URL (respects PASSIONFRUIT_API_URL override)
 */
export function getApiBaseUrl(): string {
  return process.env.PASSIONFRUIT_API_URL || getConfig().apiBaseUrl;
}

/**
 * Get the API key from environment
 */
export function getApiKey(): string | undefined {
  return process.env.PASSIONFRUIT_API_KEY;
}

/**
 * Check if API key is configured
 */
export function hasApiKey(): boolean {
  return Boolean(process.env.PASSIONFRUIT_API_KEY);
}

/**
 * Get the refresh token from environment
 */
export function getRefreshToken(): string | undefined {
  return process.env.PASSIONFRUIT_REFRESH_TOKEN;
}

/**
 * Check if refresh token is configured
 */
export function hasRefreshToken(): boolean {
  return Boolean(process.env.PASSIONFRUIT_REFRESH_TOKEN);
}

/**
 * Validate that all required configuration is present
 * Either an API key or a refresh token is required (token can be auto-refreshed)
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Either API key or refresh token is valid (token manager can auto-refresh)
  if (!hasApiKey() && !hasRefreshToken()) {
    errors.push('PASSIONFRUIT_API_KEY or PASSIONFRUIT_REFRESH_TOKEN is not set');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Print environment info for CLI
 */
export function printEnvironmentInfo(): void {
  const config = getConfig();
  const apiUrl = getApiBaseUrl();
  const hasKey = hasApiKey();

  console.log(`\nPassionfruit API Configuration`);
  console.log(`${'─'.repeat(40)}`);
  console.log(`Environment:  ${config.displayName}`);
  console.log(`API URL:      ${apiUrl}`);
  console.log(`Auth:         ${hasKey ? '✓ Configured' : '✗ Missing PASSIONFRUIT_API_KEY'}`);
  console.log();

  if (config.name === 'production') {
    console.log('⚠️  Warning: You are configured for PRODUCTION');
    console.log();
  }
}
