# File search

Registers `fd` for path discovery and `rg` for content search.

Resolution order is system `fd`/`fdfind` and `rg`, then existing binaries in `~/.pi/agent/bin`, then pinned official GitHub release archives for macOS/Linux arm64/x64. Downloads use HTTPS, a 25 MB cap, hard-coded SHA-256 verification, and atomic installation.

Model output is bounded to pi's normal limits. Larger requested result sets are written to private temporary spill files.
