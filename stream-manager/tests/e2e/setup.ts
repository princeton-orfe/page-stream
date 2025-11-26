/**
 * E2E Test Setup
 *
 * This file configures the E2E test environment.
 */

import { beforeAll, afterAll } from 'vitest';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const MAX_RETRIES = 30;
const RETRY_DELAY = 1000;

async function waitForService(): Promise<void> {
  console.log(`Waiting for service at ${API_BASE_URL}...`);

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/health`);
      if (response.ok) {
        console.log('Service is ready!');
        return;
      }
    } catch {
      // Service not ready yet
    }

    console.log(`Attempt ${i + 1}/${MAX_RETRIES} - service not ready, waiting...`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
  }

  throw new Error(`Service at ${API_BASE_URL} did not become ready in time`);
}

beforeAll(async () => {
  await waitForService();
});

afterAll(() => {
  console.log('E2E tests completed');
});
