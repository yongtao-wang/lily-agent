export type LogSource = 'upload' | 'files';

export type LogLevel = 'warn' | 'error';

export type LogReason =
  | 'form_parse_failed'
  | 'session_id_missing'
  | 'no_files'
  | 'unsupported_type'
  | 'oversize'
  | 'mkdir_failed'
  | 'arraybuffer_failed'
  | 'writefile_failed'
  | 'sidecar_failed'
  | 'delete_failed'
  | 'delete_path_traversal'
  | 'list_sidecar_synthesis_failed';

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
