import { configureLinuxWeb } from './linux-view.ts';
import { API_ORIGIN } from './auth.ts';
import { formatBalance } from './prepaid-billing.ts';

configureLinuxWeb({ apiOrigin: API_ORIGIN, formatBalance });
