export const navigation = [
  { label: '', items: [['overview', 'Overview'], ['connect', 'Connect app']] },
  { label: 'Build', items: [['database', 'Database'], ['sql', 'SQL editor'], ['auth', 'Authentication'], ['permissions', 'Permissions'], ['storage', 'Storage'], ['functions', 'Functions']] },
  { label: 'Run', items: [['realtime', 'Realtime & live objects'], ['automations', 'Automations'], ['notifications', 'Notifications'], ['search', 'Search & AI'], ['payments', 'Payments']] },
  { label: 'Manage', items: [['logs', 'Logs'], ['usage', 'Usage'], ['templates', 'Templates'], ['settings', 'Settings']] },
];

export const deferred: Record<string, { title: string; headers: string[]; empty: string }> = {
  storage: { title: 'Storage', headers: ['Bucket', 'Files', 'Size'], empty: 'No storage buckets.' },
  realtime: { title: 'Realtime & live objects', headers: ['Channel', 'Connections', 'Status'], empty: 'No channels or live objects.' },
  automations: { title: 'Automations', headers: ['Automation', 'Trigger', 'Status'], empty: 'No automations.' },
  notifications: { title: 'Notifications', headers: ['Notification', 'Recipient', 'Status'], empty: 'No notifications.' },
  search: { title: 'Search & AI', headers: ['Index', 'Documents', 'Status'], empty: 'No search indexes.' },
  payments: { title: 'Payments', headers: ['Payment', 'Customer', 'Amount'], empty: 'No payments.' },
  templates: { title: 'Templates', headers: ['Template', 'Version', 'Installed'], empty: 'No templates installed.' },
};

export type Project = { id: string; name: string; state: 'pending' | 'ready' | 'error'; suspended: boolean; created_at: string };
export type Column = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };
export type Table = { name: string; sql: string; count: number; columns: Column[] };
export type Migration = { sequence: number; name: string; sql: string; checksum: string; applied_at: string };
export type SavedFunction = { name: string; version: number; database_access: 'none' | 'read' | 'write'; checksum: string; created_at: string; source?: string };
export type QueryResult = { success: boolean; results: Record<string, unknown>[]; meta?: Record<string, unknown> };
export type Execution = { id: string; function_name: string; version: number; status: string; error: string | null; duration_ms: number | null; created_at: string };
export type TablePolicy = { table: string; select: 'none' | 'public'; insert: 'none' | 'own'; update: 'none' | 'own'; delete: 'none' | 'own'; ownerColumn: string | null };
