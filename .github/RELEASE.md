# Release Setup

The [Release workflow](workflows/release.yml) runs after a push to `main`, or manually from **Actions > Release > Run workflow** with `main` selected. It verifies the module, calculates the version, packages the runtime files, commits the generated manifest, creates a tag, and publishes a GitHub release.

R2 uploads, Foundry Package API publication, and Discord announcements run when their secrets are configured. With none configured, GitHub releases still work.

## Repository Setup

1. Enable GitHub Actions and allow the actions used by the workflow: `actions/checkout`, `actions/setup-node`, and `ncipollo/release-action`.
2. Ensure repository or organization policies allow this job's declared permissions: `contents: write` and `pull-requests: read`. The workflow uses GitHub's automatic token; no personal access token is required. See [GitHub token authentication](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token).
3. If `main` is protected by a ruleset, allow the release automation to push its generated manifest commit. Otherwise the workflow stops at the push step.
4. Add the secrets below under **Settings > Secrets and variables > Actions > Secrets > New repository secret**, or grant this repository access to matching organization secrets.

## Secrets and Variables

**No custom repository Variables are required.** All six configured values are read from **Secrets**, including the R2 account ID and bucket name.

| Secret | Value | Used for |
| --- | --- | --- |
| `R2_ACCESS_KEY_ID` | R2 S3 Access Key ID | Upload authentication |
| `R2_SECRET_ACCESS_KEY` | Matching R2 S3 Secret Access Key | Upload authentication |
| `R2_ACCOUNT_ID` | Cloudflare account ID, without an endpoint URL | Builds the R2 S3 endpoint |
| `R2_BUCKET` | Existing bucket name, without `s3://` or a path | Upload destination |
| `FOUNDRY_RELEASE_TOKEN` | Package release token for `sc-venaerys-initiative` | Publishes the version in Foundry's package directory |
| `DISCORD_WEBHOOK_URL` | Complete webhook URL for the announcement channel | Announces the release, including `@everyone` |

Configure all four R2 secrets to enable uploads. Missing any one skips R2. The Foundry and Discord steps are independently skipped when their respective secrets are absent.

Create R2 S3 credentials with object write access to the destination bucket, following [Cloudflare's authentication guide](https://developers.cloudflare.com/r2/api/tokens/). Get the Foundry token from the package management page for this module; tokens are package-specific, as described in the [Package Release API guide](https://foundryvtt.com/article/package-release-api/).

| Automatic value | Source |
| --- | --- |
| `GH_TOKEN` | GitHub's `github.token`, supplied automatically to the job |
| `GITHUB_REPOSITORY`, `GITHUB_SHA`, `GITHUB_REF` | GitHub workflow context/environment |
| `MODULE_ID` | Repository name: `sc-venaerys-initiative` |
| `BUMP_TYPE`, `NOTIFY_DISCORD` | Merged branch name and Discord opt-out controls |
| `VERSION`, `TAG`, `PREVIOUS_TAG` | Calculated by the workflow |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Mapped from the R2 secrets for the upload step |
| `AWS_DEFAULT_REGION`, `AWS_EC2_METADATA_DISABLED` | Set to `auto` and `true` in the upload step |

Do not create these automatic values as repository secrets or variables. Keep the repository name equal to the manifest module ID.

## Versioning and Release Controls

The source branch of a merged pull request selects the semantic version increment:

| Branch prefix | Example | Increment |
| --- | --- | --- |
| `major/` | `major/new-combat-rules` | Major; resets minor and patch |
| `minor/` | `minor/new-phase-options` | Minor; resets patch |
| `patch/` | `patch/tracker-fix` | Patch |
| Other prefix or direct push | `fix/tracker-fix`, push to `main` | Patch |

The previous `vMAJOR.MINOR.PATCH` tag is the baseline. If there are no release tags, the workflow uses `module.json` as its baseline and increments it. For example, baseline `1.0.0` with a patch release becomes `v1.0.1`.

The workflow updates `module.json` automatically. Do not manually change its version or release download URL. The automation's own manifest commit does not start another release job.

To suppress a Discord announcement, add the **`skip-discord`** label to the pull request before merging, or select **Não anunciar esta versão no Discord** on a manual run. If the workflow cannot look up the merged PR, it suppresses the announcement while continuing the release.

Rerunning the same release uses its existing tag rather than creating another version. A new source commit creates a new release. GitHub releases can be updated by reruns; external integrations run again. On a release rerun, the workflow accepts Foundry's specific duplicate-version response as already published; other publication errors still fail. Select the Discord opt-out when repeating a manual run if another announcement is unwanted.

## Assets and Outputs

The module ZIP contains `module.json`, `module-tiers.json`, runtime folders (`assets`, `lang`, `scripts`, `styles`, `templates`), `README.md`, generated `CHANGELOG.md`, and `LICENSE` when present. Tests, tooling, local documents, and local instructions are excluded. Images under `assets/screenshots/` illustrate the GitHub README and stay out of the installable ZIP; branding remains included. The cover uses its remote URL and is not bundled.

The workflow validates ZIP integrity, manifest references, and package contents before publishing. The Discord announcement uses the HTTPS URL of the `cover` entry in `module.json` as its embed image. No cover file is downloaded, attached, or packaged. Releases also work without a cover entry.

GitHub release assets:

- `module.json`
- `sc-venaerys-initiative.zip`
- `CHANGELOG.md`
- `module-tiers.json`

R2 upload paths:

```text
modules/sc-venaerys-initiative/v<version>/module.json
modules/sc-venaerys-initiative/v<version>/module-tiers.json
modules/sc-venaerys-initiative/v<version>/sc-venaerys-initiative.zip
```

The Foundry directory receives the version-specific GitHub manifest URL. Foundry installations use this stable manifest URL to discover the latest release:

```text
https://github.com/Shattered-Codex/sc-venaerys-initiative/releases/latest/download/module.json
```

## Verification

Run `npm run verify` before pushing. A local verification does not publish a release or exercise authenticated integrations. The first GitHub run should confirm the generated ZIP, branch push permissions, and any enabled external integrations in the Actions log.
