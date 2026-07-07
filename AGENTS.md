# Project Agent Instructions

## Automatic Push Workflow

For this MTG Deck Analyzer project, each decently sized completed update should automatically trigger the `git-clean-merge` skill to publish the work to `main`.

Treat an update as decently sized when it includes one or more of the following:

- A user-facing feature or workflow change.
- Meaningful UI, analysis, import, parser, or API behavior changes.
- Test additions or updates paired with implementation changes.
- Multi-file edits or any change that would reasonably deserve its own commit.

Do not trigger the push workflow for tiny incremental edits, exploratory changes, comments-only tweaks, formatting-only changes, or unfinished work.

Before triggering the push workflow:

- Verify the work with the relevant tests or build checks for the touched area.
- Review `git status` and include only intentional project changes.
- Preserve unrelated user changes.

When the update qualifies, use the `git-clean-merge` skill and proceed through its normal clean commit, merge, and push-to-main workflow without waiting for an extra user prompt.
