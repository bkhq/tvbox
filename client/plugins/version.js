// @ts-check
// Plain CommonJS so the release workflow can run it with node before npm ci.

const TAG = /^v([0-9]+)\.([0-9]{1,2})\.([0-9]{1,2})$/;

/**
 * Release version from a vX.Y.Z tag, same formula as the Java app's
 * workflow: code = X*10000 + Y*100 + Z, so minor and patch stay below 100.
 *
 * @param {string} tag
 * @returns {{ name: string; code: number }}
 */
function versionFromTag(tag) {
  const match = TAG.exec(tag);
  if (!match) {
    throw new Error(`release tags must look like v1.2.3 (minor and patch below 100), got "${tag}"`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const code = major * 10000 + minor * 100 + patch;
  if (!Number.isSafeInteger(code) || code < 1) {
    throw new Error(`version code out of range for "${tag}"`);
  }
  return { name: `${major}.${minor}.${patch}`, code };
}

module.exports = { versionFromTag };

// CLI: `node plugins/version.js v1.0.5` prints GITHUB_OUTPUT lines.
if (require.main === module) {
  try {
    const { name, code } = versionFromTag(process.argv[2] ?? '');
    process.stdout.write(`code=${code}\nname=${name}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
