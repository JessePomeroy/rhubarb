import { createHash, randomUUID } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);
const FD_VERSION = "10.4.2";
const FD_INTEL_MAC_VERSION = "10.3.0";
const RG_VERSION = "15.2.0";
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;

const FD_HASHES: Record<string, string> = {
  "aarch64-apple-darwin":
    "623dc0afc81b92e4d4606b380d7bc91916ba7b97814263e554d50923a39e480a",
  "x86_64-apple-darwin":
    "50d30f13fe3d5914b14c4fff5abcbd4d0cdab4b855970a6956f4f006c17117a3",
  "aarch64-unknown-linux-musl":
    "f32d3657473fba74e2600babc8db0b93420d51169223b7e8143b2ed55d8fd9e8",
  "x86_64-unknown-linux-musl":
    "e3257d48e29a6be965187dbd24ce9af564e0fe67b3e73c9bdcd180f4ec11bdde",
};
const RG_HASHES: Record<string, string> = {
  "aarch64-apple-darwin":
    "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4",
  "x86_64-apple-darwin":
    "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1",
  "aarch64-unknown-linux-musl":
    "800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915",
  "x86_64-unknown-linux-musl":
    "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c",
};

export interface SearchBinaries {
  fd: string;
  rg: string;
  downloaded: string[];
}

export async function resolveSearchBinaries(): Promise<SearchBinaries> {
  const downloaded: string[] = [];
  const fd = await resolveOne("fd", ["fd", "fdfind"], downloaded);
  const rg = await resolveOne("rg", ["rg"], downloaded);
  return { fd, rg, downloaded };
}

async function resolveOne(
  tool: "fd" | "rg",
  commands: string[],
  downloaded: string[],
) {
  for (const command of commands) if (await usable(command)) return command;
  const destination = join(getAgentDir(), "bin", tool);
  if (await usable(destination)) return destination;
  const asset = releaseAsset(tool);
  if (!asset)
    throw new Error(
      `No verified ${tool} build is available for ${process.platform}/${process.arch}. Install it with your package manager.`,
    );
  await install(asset, destination);
  if (!(await usable(destination)))
    throw new Error(`${tool} was installed but failed its version check.`);
  downloaded.push(`${tool} ${asset.version}`);
  return destination;
}

async function usable(command: string) {
  try {
    await execFileAsync(command, ["--version"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

interface Asset {
  url: string;
  hash: string;
  archiveDir: string;
  binary: string;
  version: string;
}
function releaseAsset(tool: "fd" | "rg"): Asset | undefined {
  const cpu =
    process.arch === "arm64"
      ? "aarch64"
      : process.arch === "x64"
        ? "x86_64"
        : undefined;
  if (!cpu) return undefined;
  const triple =
    process.platform === "darwin"
      ? `${cpu}-apple-darwin`
      : process.platform === "linux"
        ? `${cpu}-unknown-linux-musl`
        : undefined;
  if (!triple) return undefined;
  if (tool === "fd") {
    const hash = FD_HASHES[triple];
    if (!hash) return undefined;
    const version =
      triple === "x86_64-apple-darwin" ? FD_INTEL_MAC_VERSION : FD_VERSION;
    const archiveDir = `fd-v${version}-${triple}`;
    return {
      url: `https://github.com/sharkdp/fd/releases/download/v${version}/${archiveDir}.tar.gz`,
      hash,
      archiveDir,
      binary: "fd",
      version,
    };
  }
  const hash = RG_HASHES[triple];
  if (!hash) return undefined;
  const archiveDir = `ripgrep-${RG_VERSION}-${triple}`;
  return {
    url: `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/${archiveDir}.tar.gz`,
    hash,
    archiveDir,
    binary: "rg",
    version: RG_VERSION,
  };
}

async function install(asset: Asset, destination: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(asset.url, {
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok || !response.body)
      throw new Error(`Download failed with HTTP ${response.status}.`);
    if (new URL(response.url).protocol !== "https:")
      throw new Error("Refusing a non-HTTPS download redirect.");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES)
      throw new Error("Release archive exceeds 25 MB.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_ARCHIVE_BYTES)
      throw new Error("Release archive exceeds 25 MB.");
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== asset.hash)
      throw new Error(`SHA-256 mismatch for ${asset.url}.`);

    const work = await mkdtemp(join(tmpdir(), "rhubarb-search-"));
    try {
      const archive = join(work, "release.tar.gz");
      await writeFile(archive, bytes, { mode: 0o600 });
      await execFileAsync("tar", ["-xzf", archive, "-C", work], {
        timeout: 60_000,
      });
      const extracted = join(work, asset.archiveDir, asset.binary);
      await access(extracted, constants.R_OK);
      await mkdir(dirname(destination), { recursive: true });
      const staged = `${destination}.${randomUUID()}.tmp`;
      await copyFile(extracted, staged);
      await chmod(staged, 0o755);
      await rename(staged, destination);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  } finally {
    clearTimeout(timer);
  }
}
