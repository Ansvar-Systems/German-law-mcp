import { ShellError } from "./errors.js";
import type { CountryAdapter, CountryCode } from "./types.js";

export class AdapterRegistry {
  private readonly adapters = new Map<CountryCode, CountryAdapter>();

  register(adapter: CountryAdapter): void {
    const code = adapter.country.code.toLowerCase();

    if (this.adapters.has(code)) {
      throw new ShellError(
        "duplicate_country",
        `Country adapter is already registered: ${code}`,
      );
    }

    this.adapters.set(code, adapter);
  }

  registerMany(adapters: CountryAdapter[]): void {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  get(countryCode: string): CountryAdapter {
    const adapter = this.adapters.get(countryCode.toLowerCase());

    if (!adapter) {
      throw new ShellError(
        "unknown_country",
        `No adapter found for country: ${countryCode}`,
      );
    }

    return adapter;
  }

  list(): CountryAdapter[] {
    return [...this.adapters.values()].sort((a, b) =>
      a.country.code.localeCompare(b.country.code),
    );
  }
}
