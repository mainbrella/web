import { initializeVoice } from './voice-view.ts';
import { API_ORIGIN, createAuthClient } from './auth.ts';

initializeVoice({ apiOrigin: API_ORIGIN, readSession: () => createAuthClient().readSession() });
