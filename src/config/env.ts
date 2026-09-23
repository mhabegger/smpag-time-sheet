import { config } from "dotenv";
import { z } from "zod";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env"), quiet: true });

const envSchema = z.object({
  ZEP_INSTANCE: z.string().min(1),
  ZEP_TOKEN: z.string().min(1),
  ZEP_EMPLOYEE_ID: z.string().min(1),
  MANICTIME_SCREENSHOTS_PATH: z
    .string()
    .default("D:\\ManicTime\\Screenshots"),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => i.path.join("."))
      .join(", ");
    throw new Error(
      `Missing or invalid environment variables: ${missing}\nCopy .env.example to .env and fill in your values.`
    );
  }
  return {
    ...result.data,
    ZEP_BASE_URL: `https://www.zep-online.de/${result.data.ZEP_INSTANCE}/next/api/v1`,
  };
}

export type Env = ReturnType<typeof loadEnv>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) _env = loadEnv();
  return _env;
}
