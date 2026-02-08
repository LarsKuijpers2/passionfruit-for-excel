/**
 * Passionfruit API Client
 *
 * HTTP client for interacting with the Passionfruit API.
 * Supports entities, answers, and evidence endpoints.
 */

import { getApiBaseUrl, getApiKey, getEnvironment, validateConfig } from '../config/environments.js';
import type {
  APIEntity,
  APIAnswer,
  APIEvidence,
  ExtractedEntityData,
} from '../api-types.js';

// =============================================================================
// TYPES
// =============================================================================

export interface APIResponse<T> {
  data: T;
  status: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EntityResponse {
  id: number;
  name: string;
  data: ExtractedEntityData;
  createdAt: string;
  updatedAt: string;
}

export interface AnswerResponse {
  id: number;
  question: string;
  answer: string;
  note?: string;
  entities: number[];
  evidences: number[];
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceResponse {
  id: number;
  uuid: string;
  name: string;
  status: string;
  classification?: string;
  filekey?: string;
  metadata?: Record<string, any>;
  extractedMetadata?: Record<string, any>;
  entities: number[];
  createdAt: string;
  updatedAt: string;
}

export interface UploadResponse {
  filekey: string;
  filename: string;
  size: number;
}

// =============================================================================
// API CLIENT
// =============================================================================

export class PassionfruitAPIClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    // Validate configuration
    const { valid, errors } = validateConfig();
    if (!valid) {
      throw new Error(`API configuration error: ${errors.join(', ')}`);
    }

    this.baseUrl = getApiBaseUrl();
    this.apiKey = getApiKey()!;
  }

  /**
   * Get the current environment name
   */
  get environment(): string {
    return getEnvironment();
  }

  /**
   * Get the API base URL
   */
  get url(): string {
    return this.baseUrl;
  }

  // ===========================================================================
  // HTTP METHODS
  // ===========================================================================

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
    };

    if (body && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text);
  }

  // ===========================================================================
  // ENTITY METHODS
  // ===========================================================================

  /**
   * List all entities
   */
  async listEntities(): Promise<EntityResponse[]> {
    const response = await this.request<PaginatedResponse<EntityResponse> | EntityResponse[]>(
      'GET',
      '/api/v2/entities/'
    );

    // Handle both paginated and array responses
    return Array.isArray(response) ? response : response.items;
  }

  /**
   * Get a single entity by ID
   */
  async getEntity(id: number): Promise<EntityResponse> {
    return this.request('GET', `/api/v2/entities/${id}`);
  }

  /**
   * Create a new entity
   *
   * Entity structure for Passionfruit API:
   * - Top-level: name, email, phone, website, street, city, zipCode, country
   * - data: Additional key-value pairs (contacts, activities, egNumber, etc.)
   */
  async createEntity(entity: APIEntity, parentId: number | null = null): Promise<EntityResponse> {
    // Build the payload with top-level fields
    const payload: Record<string, any> = {
      name: entity.name,
      parentId,
    };

    // Add top-level company info fields if present
    if (entity.email) payload.email = entity.email;
    if (entity.phone) payload.phone = entity.phone;
    if (entity.website) payload.website = entity.website;
    if (entity.street) payload.street = entity.street;
    if (entity.city) payload.city = entity.city;
    if (entity.zipCode) payload.zipCode = entity.zipCode;
    if (entity.country) payload.country = entity.country;

    // Add data object for additional fields
    if (entity.data && Object.keys(entity.data).length > 0) {
      payload.data = entity.data;
    }

    return this.request('POST', '/api/v2/entities/', payload);
  }

  /**
   * Update an existing entity
   */
  async updateEntity(id: number, entity: Partial<APIEntity>): Promise<EntityResponse> {
    // Ensure parentId is included (required by API)
    const payload = {
      parentId: entity.parentId ?? null,
      ...entity,
    };
    return this.request('PUT', `/api/v2/entities/${id}`, payload);
  }

  /**
   * Delete an entity
   */
  async deleteEntity(id: number): Promise<void> {
    await this.request('DELETE', `/api/v2/entities/${id}`);
  }

  /**
   * Find entity by name
   */
  async findEntityByName(name: string): Promise<EntityResponse | null> {
    const entities = await this.listEntities();
    return entities.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
  }

  // ===========================================================================
  // ANSWER METHODS
  // ===========================================================================

  /**
   * List all answers
   */
  async listAnswers(): Promise<AnswerResponse[]> {
    const response = await this.request<PaginatedResponse<AnswerResponse> | AnswerResponse[]>(
      'GET',
      '/api/v2/answers/'
    );

    return Array.isArray(response) ? response : response.items;
  }

  /**
   * Search answers by query (minimum 5 characters)
   */
  async searchAnswers(query: string): Promise<AnswerResponse[]> {
    if (query.length < 5) {
      console.warn('Search query must be at least 5 characters');
      return [];
    }

    const response = await this.request<PaginatedResponse<AnswerResponse> | AnswerResponse[]>(
      'GET',
      `/api/v2/answers/search?q=${encodeURIComponent(query)}`
    );

    return Array.isArray(response) ? response : response.items;
  }

  /**
   * Get a single answer by ID
   */
  async getAnswer(id: number): Promise<AnswerResponse> {
    return this.request('GET', `/api/v2/answers/${id}`);
  }

  /**
   * Create a new answer
   */
  async createAnswer(answer: {
    question: string;
    answer: string;
    note?: string;
    entities?: number[];
    evidences?: number[];
  }): Promise<AnswerResponse> {
    return this.request('POST', '/api/v2/answers/', answer);
  }

  /**
   * Update an existing answer
   */
  async updateAnswer(id: number, answer: Partial<{
    question: string;
    answer: string;
    note?: string;
    entities?: number[];
    evidences?: number[];
  }>): Promise<AnswerResponse> {
    return this.request('PUT', `/api/v2/answers/${id}`, answer);
  }

  /**
   * Delete an answer
   */
  async deleteAnswer(id: number): Promise<void> {
    await this.request('DELETE', `/api/v2/answers/${id}`);
  }

  // ===========================================================================
  // EVIDENCE METHODS
  // ===========================================================================

  /**
   * List all evidences
   */
  async listEvidences(): Promise<EvidenceResponse[]> {
    const response = await this.request<PaginatedResponse<EvidenceResponse> | EvidenceResponse[]>(
      'GET',
      '/api/v2/evidences/'
    );

    return Array.isArray(response) ? response : response.items;
  }

  /**
   * Search evidences by query
   */
  async searchEvidences(query: string): Promise<EvidenceResponse[]> {
    if (query.length < 5) {
      console.warn('Search query must be at least 5 characters');
      return [];
    }

    const response = await this.request<PaginatedResponse<EvidenceResponse> | EvidenceResponse[]>(
      'GET',
      `/api/v2/evidences/search?q=${encodeURIComponent(query)}`
    );

    return Array.isArray(response) ? response : response.items;
  }

  /**
   * Get a single evidence by ID
   */
  async getEvidence(id: number): Promise<EvidenceResponse> {
    return this.request('GET', `/api/v2/evidences/${id}`);
  }

  /**
   * Create a new evidence record
   */
  async createEvidence(evidence: {
    name: string;
    classification?: string;
    metadata?: Record<string, any>;
    extractedMetadata?: Record<string, any>;
    entities?: number[];
  }): Promise<EvidenceResponse> {
    return this.request('POST', '/api/v2/evidences/', evidence);
  }

  /**
   * Update an existing evidence
   */
  async updateEvidence(id: number, evidence: Partial<{
    name: string;
    classification?: string;
    metadata?: Record<string, any>;
    extractedMetadata?: Record<string, any>;
    entities?: number[];
  }>): Promise<EvidenceResponse> {
    return this.request('PUT', `/api/v2/evidences/${id}`, evidence);
  }

  /**
   * Upload a file and get a filekey
   */
  async uploadFile(file: Buffer, filename: string): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', new Blob([file]), filename);

    const response = await fetch(`${this.baseUrl}/api/v2/upload/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Upload error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<UploadResponse>;
  }

  /**
   * Find evidence by name
   */
  async findEvidenceByName(name: string): Promise<EvidenceResponse | null> {
    // Try search first
    if (name.length >= 5) {
      const results = await this.searchEvidences(name.substring(0, 20));
      const match = results.find(e => e.name === name);
      if (match) return match;
    }

    // Fall back to listing all
    const evidences = await this.listEvidences();
    return evidences.find(e => e.name === name) || null;
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.listEntities();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get API stats
   */
  async getStats(): Promise<{ entities: number; answers: number; evidences: number }> {
    const [entities, answers, evidences] = await Promise.all([
      this.listEntities(),
      this.listAnswers(),
      this.listEvidences(),
    ]);

    return {
      entities: entities.length,
      answers: answers.length,
      evidences: evidences.length,
    };
  }
}
