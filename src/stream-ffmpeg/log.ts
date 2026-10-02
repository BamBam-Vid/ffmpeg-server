/**
 * Writes one JSON log line to stdout. Railway shows `level`, `message`, and the other fields as searchable attributes.
 */
export const log = (
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, unknown> = {}
) => {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level, message, ...fields }));
};
