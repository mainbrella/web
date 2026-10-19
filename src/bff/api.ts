const messages: Record<string, string> = {
  unauthorized: 'Your session has expired. Sign in again.',
  bff_unavailable: 'BFF is unavailable. Check the server configuration or try again.',
  database_unavailable: 'The database service is unavailable. Try again.',
  database_query_failed: 'SQLite could not run this statement. Check table names, columns, and constraints.',
  database_not_ready: 'Provision this project’s database first.',
  project_paused: 'This project is paused. Resume it in Settings.',
  project_blocked: 'This project has been disabled by Mainbrella. Contact support.',
  project_limit: 'You have reached the limit of 5 projects.',
  api_key_limit: 'This project has 20 browser keys. Revoke an unused key before creating another.',
  table_policy_limit: 'This project has reached its limit of 100 table policies.',
  provision_in_progress: 'Database provisioning is already running. Wait a minute and retry.',
  migration_conflict: 'This migration number or name already exists with different SQL.',
  migration_out_of_order: 'Apply the next migration number in order.',
  function_version_conflict: 'The function changed since you opened it, or its version limit was reached. Reopen it before saving.',
  function_runtime_unavailable: 'The isolated function runtime is unavailable.',
  function_timeout: 'The function exceeded its 5-second time limit. Earlier database writes may have completed.',
  function_failed: 'The function could not run. Check its JavaScript syntax, default export, and resource usage.',
  function_result_too_large: 'The function result exceeds 64 KiB.',
  daily_budget_exceeded: 'This project reached its daily budget. Budgets reset at midnight UTC.',
  concurrency_limit: 'Three functions are already running. Try again shortly.',
  use_migration_for_schema_changes: 'Run one SELECT, INSERT, UPDATE, or DELETE statement. Use a migration for schema changes.',
  unsupported_migration: 'Use CREATE TABLE, CREATE INDEX, ALTER TABLE, DROP TABLE, DROP INDEX, INSERT, UPDATE, or DELETE.',
  reserved_sql_name: 'Names beginning with _bff_, _cf_, or sqlite_ are reserved.',
  invalid_statement_count: 'Run one query, or up to 50 statements in a migration.',
  invalid_request: 'Check the form values and try again.',
  request_too_large: 'This request is too large.',
  source_too_large: 'Function source must fit within 32 KiB.',
};

export function createBffApi(origin: string, onUnauthorized: () => void = () => {}) {
  return async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${origin}/bff${path}`, {
        method, credentials: 'include', headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('Could not reach BFF. Check your connection and try again.'); }
    const data = await response.json().catch(() => null);
    if (response.status === 401) onUnauthorized();
    if (!response.ok) throw new Error(messages[data?.error] || 'The operation failed. Check your input and try again.');
    if (!data) throw new Error('BFF returned an invalid response. Try again.');
    return data as T;
  };
}
