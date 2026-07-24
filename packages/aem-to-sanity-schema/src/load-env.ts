/**
 * Side-effect module: load .env before any other import runs. Imported first
 * by every CLI entry so downstream modules see the populated process.env —
 * same ordering `import "dotenv/config"` gave, but with dotenv v17's startup
 * log line silenced (CLI stdout is consumed by operators and scripts).
 */
import { config } from "dotenv";

config({ quiet: true });
