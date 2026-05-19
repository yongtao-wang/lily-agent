export type LogSource = 'upload' | 'files';

export type LogLevel = 'warn' | 'error';

export type LogReason =
  | 'form_parse_failed'
  | 'session_id_missing'
  | 'no_files'
  | 'unsupported_type'
  | 'oversize'
  | 'arraybuffer_failed'
  | 'put_failed'
  | 'meta_put_failed'
  | 'list_ok'
  | 'list_failed'
  | 'get_failed'
  | 'delete_failed'
  | 'delete_path_traversal'
  | 'list_sidecar_synthesis_failed'
  // Deprecated since the storage migration; kept for one release so log readers
  // built against the old vocabulary don't crash.
  | 'mkdir_failed'
  | 'writefile_failed'
  | 'sidecar_failed';

const MAX_MESSAGE_CHARS = 240;

export function logFileEvent(
  source: LogSource,
  level: LogLevel,
  reason: LogReason,
  ctx: Record<string, unknown> = {},
): void {
  const message = typeof ctx.message === 'string' ? ctx.message.slice(0, MAX_MESSAGE_CHARS) : ctx.message;
  const line = JSON.stringify({ source, level, reason, ...ctx, message });
  if (level === 'error') console.error(line);
  else console.warn(line);
}
