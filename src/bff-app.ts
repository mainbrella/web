import { initializeBff } from './bff/app.ts';
import { createAuthClient } from './auth.ts';
import { API_ORIGIN } from './api-origin.ts';

initializeBff({ readSession: () => createAuthClient().readSession(), apiOrigin: API_ORIGIN });
