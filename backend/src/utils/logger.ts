type Level = "info" | "warn" | "error";

function ts(): string {
  return new Date().toISOString();
}

function log(level: Level, message: string, meta?: unknown): void {
  const line = `[${ts()}] ${level.toUpperCase()} ${message}`;
  if (meta !== undefined) {
    const payload = typeof meta === "string" ? meta : JSON.stringify(meta);
    console.log(`${line} ${payload}`);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, meta?: unknown) => log("info", message, meta),
  warn: (message: string, meta?: unknown) => log("warn", message, meta),
  error: (message: string, meta?: unknown) => log("error", message, meta),
};
