import type { CountryAdapter } from "../shell/types.js";
// scaffold-imports-start
import { germanyAdapter } from "./de.js";
// scaffold-imports-end

export const BUILTIN_ADAPTERS: CountryAdapter[] = [
  // scaffold-adapters-start
  germanyAdapter,
  // scaffold-adapters-end
];
