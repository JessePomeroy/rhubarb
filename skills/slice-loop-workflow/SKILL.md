---
name: slice-loop-workflow
description: Execute specification-driven development one ordered slice at a time through implementation, PR review/fix, safe merge, required Obsidian closeout, and selection of the next slice. Use when the user asks for the slice loop, loop-slice workflow, roadmap loop, or autonomous spec-to-PR iteration.
---

# Slice Loop Workflow

Use this workflow for roadmap-driven projects whose canonical specification defines the order of work. One **slice** is the next incomplete, prerequisite-ready task in that specification—not an arbitrary convenient change.

## Operating rules

- Read all applicable `AGENTS.md` files before editing.
- Read the canonical specification and current handoff completely before selecting work.
- Follow roadmap order unless the specification itself identifies a dependency that must land first.
- Keep one slice narrow enough to implement, validate, review, and merge coherently.
- Preserve unrelated work and use each repository's package manager.
- Use ordinary subagents for independent review. Use the `workflow` tool only when the user explicitly requests a workflow or says **ultracode**.
- Prefer background workflows for long, multi-agent loops so user messages do not abort foreground work.
- Never interpret repository authorization as approval for production deployments, billing changes, secrets, releases, package publication, or live mutations.

## The six-step loop

### 1. Select and define the next slice

1. Read the canonical specification, roadmap, and current handoff.
2. Identify the next incomplete task in strict specification order.
3. Verify prerequisites and cross-repository dependencies.
4. Define:
   - task ID and title;
   - repositories and files likely involved;
   - acceptance criteria;
   - explicit non-goals;
   - validation commands;
   - production, billing, secret, release, and live-mutation gates.
5. Record partial prerequisite work honestly; do not mark the slice complete before its acceptance criteria are satisfied.

For cross-repository contracts, plan ordered PRs. Land consumers before producers begin emitting a new contract.

### 2. Implement and validate locally

1. Create or use focused feature branches.
2. Inspect relevant existing code and tests before editing.
3. Implement the smallest complete slice while preserving backward compatibility and unrelated behavior.
4. Add focused regression, integration, concurrency, and failure-path tests appropriate to the risk.
5. Run repository-required formatting, lint, type checks, tests, builds, and local runtime/container checks.
6. Report every failed or skipped check accurately. Do not imply success when an environment prerequisite is missing.
7. Do not commit until the intended diff and validation results have been inspected.

### 3. Commit, push, and open the PR

Proceed only under explicit or standing repository-mutation authorization.

1. Inspect the complete diff and worktree hygiene.
2. Inspect CI, hosting integrations, and main-branch automation before pushing or merging.
3. Configure the required repository-local Git identity.
4. Create focused commits without AI co-author trailers.
5. Push the feature branch and open a PR containing:
   - specification task and rationale;
   - behavior and compatibility notes;
   - validation evidence;
   - rollout/dependency order;
   - explicit non-goals and gated effects.
6. Do not merge yet.

### 4. Run the independent PR review/fix loop

The review starts **after the PR is open** and examines the remote PR diff against its base.

1. Spawn an independent high-reasoning reviewer that did not implement the change.
2. Require findings ranked `blocker`, `high`, `medium`, or `low`, with paths and concrete fixes.
3. Review correctness, security, compatibility, integrity, concurrency, resource bounds, configuration, dependency changes, and test quality.
4. Fix every blocker/high finding and every in-scope medium finding.
5. Revalidate, commit, and push fixes to the same PR.
6. Spawn a fresh rereviewer.
7. Repeat until there are no blocker/high/medium findings and all required CI checks are green.

A reviewer must not approve merely because tests pass. Adversarial runtime checks—such as real Docker execution—are required when the changed boundary depends on that runtime.

### 5. Merge safely and verify effects

1. Recheck that the reviewed commit is unchanged, current, mergeable, and green.
2. Enumerate everything a main-branch merge triggers, including:
   - production application or database deployment;
   - hosting deployment;
   - package publication or release PR creation;
   - infrastructure or billing changes;
   - secret use or live data mutation.
3. Obtain separate explicit approval for each gated production or live effect not already approved.
4. If an effect is unapproved, leave the PR open and report the exact gate.
5. Otherwise merge using the repository's required strategy and delete the remote branch when appropriate.
6. Monitor CI and every approved deployment to terminal success or failure.
7. Do not merge release PRs, publish packages, deploy producers, or perform follow-up live mutations unless separately approved.

### 6. Update Obsidian and start the next slice

This closeout is mandatory, not optional documentation cleanup.

1. Update the canonical Obsidian specification and current handoff after the final repository/deployment state is known.
2. Record:
   - task status (`partial`, `blocked`, or `complete`);
   - PR, merge commit, CI, and deployment links;
   - validation evidence and runtime versions;
   - decisions, compatibility guarantees, and known limitations;
   - production/billing/secret/release gates still outstanding;
   - rollback or rollout constraints;
   - the next task in strict roadmap order.
3. Never mark a slice complete while a required PR, deployment, migration, or acceptance criterion remains pending.
4. Re-read the updated roadmap, select the next prerequisite-ready task, and return to step 1.

## Stop conditions

Pause the loop and ask for one clear approval or decision when:

- merging would trigger an unapproved production or hosting deployment;
- a secret, billing plan, Cloudflare resource, release, publication, or live mutation is required;
- specification ordering or acceptance criteria are ambiguous;
- CI remains failing or an independent reviewer retains a blocker/high/medium finding;
- a required runtime cannot be validated locally;
- the next slice depends on an unresolved external decision.

## Completion report

At the end of each slice, report concisely:

- task ID/title and final status;
- PR and merge links;
- validation and review results;
- approved deployment outcomes;
- open release or production gates;
- Obsidian files updated;
- next slice selected.
