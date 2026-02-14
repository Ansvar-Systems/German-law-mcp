# Auto Update

Use `scripts/auto_update_german_law.py` for realistic continuous refresh.

It runs incremental updates for:

- statutes (`gesetze-im-internet`)
- case law (`rechtsprechung-im-internet`)
- preparatory works (`dip-bundestag`)

The runner uses a lock file so concurrent jobs do not overlap.

## One-shot run

```bash
npm run auto-update
```

## Dry run

```bash
npm run auto-update:dry-run
```

## Daemon mode (every 30 minutes)

```bash
npm run auto-update:daemon
```

## Cron example

Run every 2 hours:

```cron
0 */2 * * * cd /Users/jeffreyvonrotz/Projects/German-law-mcp && /usr/bin/env python3 scripts/auto_update_german_law.py --quiet >> data/auto_update.log 2>&1
```

## Useful flags

- `--cases-max <n>`: maximum case-law records per cycle
- `--cases-stop-after-existing <n>`: stop case-law scan after N consecutive existing records
- `--prep-max <n>`: maximum preparatory-works records per cycle
- `--prep-stop-after-existing <n>`: stop DIP scan after N consecutive existing records
- `--wahlperiode <n>`: DIP wahlperiode filter (repeatable)
- `--loop-minutes <n>`: repeat mode
- `--max-cycles <n>`: stop after N cycles in loop mode
- `--source-retries <n>`: retries per source on transient upstream/network errors
