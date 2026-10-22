![Calagopus Logo](https://calagopus.com/fulllogo.svg)

# Benchmarking

> **MythicalLTD fork.** This is a fork of [calagopus/benchmarking](https://github.com/calagopus/benchmarking) (MIT, © Calagopus),
> maintained by MythicalSystems to publish weekly results on [featherpanel.com/benchmarks](https://featherpanel.com/benchmarks).
> Differences from upstream: the PufferPanel target is removed, a `daemon:featherwings` target is added, and the
> [`Weekly benchmarks`](.github/workflows/weekly-benchmarks.yml) workflow runs every target on GitHub-hosted runners each Monday and
> pushes the JSON to the [`results`](https://github.com/MythicalLTD/benchmarking/tree/results) branch. All credit for the suite goes to the Calagopus authors.

[![TypeScript](https://img.shields.io/badge/typescript-7-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/github/license/calagopus/benchmarking?color=blue)](https://github.com/calagopus/benchmarking/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/calagopus/benchmarking)](https://github.com/calagopus/benchmarking/issues)
[![GitHub stars](https://img.shields.io/github/stars/calagopus/benchmarking)](https://github.com/calagopus/benchmarking/stargazers)
[![Discord](https://img.shields.io/discord/1429911351777824892?label=discord&logo=discord&color=5865F2)](https://discord.gg/uSM8tvTxBV)

benchmarking is the benchmarking suite for the Calagopus platform and various other Game panels, written in TypeScript. It is used to measure and
track the performance of Calagopus services under load.

## Usage

Each target has its images pulled (`--no-pull` skips this and uses whatever is cached locally), is booted from its own Docker Compose stack, swept across a set of CPU-quota variants, and
measured while container CPU and heap (anonymous + shared-anonymous memory, excluding page cache) are sampled. The version of the software under test is read from the running target and shown
in the report header (and included in `--json` output as `version`). Requires `docker`, the `docker compose` plugin, and
[`oha`](https://github.com/hatoo/oha) on `PATH`.

There are two kinds of targets:

- **Panels** (`panel:<name>`) are driven with `oha` HTTP load against their client API (settings, account, server list).
- **Daemons** (`daemon:<name>`) are the Wings node agents. They boot against a tiny in-process mock of the panel remote API, so
  the numbers isolate the daemon. Load scenarios (system info, small directory listing, file download, chmod) run through `oha`;
  task scenarios (large directory listings, compress tree, decompress archive, delete tree, upload file) are timed operations on
  a generated dataset, repeated a few times with the first run discarded as warmup. Each variant also records an idle CPU/heap
  baseline, sampled while the daemon is up but taking no requests.

Directory listings straddle the two kinds. A 50-entry listing is a hot path with a tiny response, so `oha` measures the thing
that matters there: per-request fixed overhead under concurrency. The 5000- and 50000-entry listings are not a sustained load -
nobody issues them back to back - and their responses run into the megabytes, so driving them with a load generator mostly
measures the generator buffering response bodies. Those run as tasks instead, one listing at a time, which also makes the
sampled heap figure mean "what one large listing costs" rather than "what N concurrent ones cost". The listing fixtures are
flat directories of 256 B files:

| Listing | Shape               | Runs as            |
| ------- | ------------------- | ------------------ |
| 50      | 50 × 256 B files    | load (`oha`, c=32) |
| 5000    | 5000 × 256 B files  | task, 10 runs      |
| 50000   | 50000 × 256 B files | task, 10 runs      |

Archive and delete tasks run against named tree fixtures rather than a single size axis, so throughput and per-file overhead can
be told apart:

| Tree   | Shape                                                | What it measures                       |
| ------ | ---------------------------------------------------- | -------------------------------------- |
| `100m` | ~2k files, mostly 1 MiB region files plus a 32 MiB jar | codec and IO throughput                |
| `1g`   | ~22k files, 1 GiB total                               | throughput at a realistic server size  |
| `many` | 50k × 256 B files, ~13 MiB total                      | per-file syscall and archive-entry cost |

Pick a target as the first argument (defaults to `panel:calagopus`):

```sh
pnpm run bench panel:calagopus    # bench the Calagopus panel
pnpm run bench panel:pterodactyl  # bench the Pterodactyl panel
pnpm run bench panel:pelican      # bench the Pelican panel
pnpm run bench panel:featherpanel # bench the FeatherPanel panel
pnpm run bench panel:hydrodactyl  # bench the Hydrodactyl panel

pnpm run bench daemon:calagopus   # bench Calagopus Wings
pnpm run bench daemon:pterodactyl # bench Pterodactyl Wings
pnpm run bench daemon:pelican     # bench Pelican Wings
pnpm run bench daemon:featherwings # bench FeatherWings

pnpm run bench panel:all          # bench every panel in series
pnpm run bench daemon:all         # bench every daemon in series
pnpm run bench all                # bench everything in series

pnpm run bench panel:pterodactyl --compare panel:calagopus   # bench both in series, then compare results
pnpm run bench daemon:pterodactyl --compare daemon:calagopus # same for the daemons

pnpm run bench daemon:all --trees many --repetitions 10      # only the small-file tree, more measured runs per task
pnpm run bench daemon:calagopus --formats tar.gz             # skip the zip archive tasks
pnpm run bench all --output-dir results                      # write results/<kind>-<name>.json for each target
pnpm run bench daemon:all --no-pull                          # skip the image pull (offline, or to pin to cached images)
pnpm run bench all --prune                                   # free each daemon's fixtures once it is done, not just its outputs
```

With `--output-dir <dir>` (short `-o`) each suite report is written to `<dir>/<target>.json` (with the `:` replaced by `-`),
pretty-printed, as soon as that suite finishes. The directory is created if it does not exist. This works for single, `--compare`,
and group runs. When running a group, a failing target does not abort the sweep: the remaining targets still run, the failure is
reported at the end, and the process exits non-zero.

## Disk use

Daemon targets generate their fixtures under `.bench/daemon-<name>/` and cache them across runs, keyed by a spec
marker, so a rerun of the same target skips the ~40s of generation. The fixtures are around 3.7 GB per daemon, and a
group run holds every daemon's set at once - so `all` needs roughly 15 GB, on top of the images it pulls.

Transient outputs (the extracted tree, the restored delete fixture, the uploaded file and any produced archive) are
always freed once a target finishes, as is the daemon log at the start of each variant: wings never rotates its log,
and Calagopus Wings writes a line per request, so an unattended sweep otherwise grows a log larger than the fixtures
it is measuring. Pass `--prune` to also drop each daemon's fixtures and logs as soon as that target is done, which
keeps only one daemon's set on disk at a time and costs a regeneration on the next run.

## Weekly results (this fork)

`.github/workflows/weekly-benchmarks.yml` runs on a cron (Mondays 03:17 UTC) and on manual dispatch, as two jobs on
`ubuntu-latest`:

- **panels**: every panel target runs one after another on the same runner (`pnpm run bench panel:all --prune`), and the
  whole group is repeated for 3 rounds by default (A, B, C, A, B, C, ...). The published numbers are the median across rounds.
- **daemons**: every daemon target runs one after another on one runner (`pnpm run bench daemon:all --prune`), 1 round by
  default because a daemon sweep takes hours; each task is already repeated inside the suite and reported as a median.

Panels are only compared with panels and daemons with daemons, so every comparison on the site is between numbers taken on
identical hardware in the same job. Each job records its runner's CPU model, core count, memory, kernel, Docker and `oha`
versions and the pulled image digests (`runner.json`). A final job merges everything into `latest/benchmarks.json` on the
`results` branch, keeps the raw per-round reports under `latest/raw/`, and stores a dated copy under `history/<date>/`.

GitHub-hosted runners are shared VMs, so treat differences of a few
percent between weeks as noise: the runner's CPU model can differ from one week to the next. The `cpus: 4` variant also uses the whole 4 vCPU runner, so it competes with `oha` itself.

## Contributing

You are free to contribute new panels, daemons, benchmarks, and improvements to the benchmarking suite. Please try to follow the existing code style and structure, and ensure that your contributions are tested.
