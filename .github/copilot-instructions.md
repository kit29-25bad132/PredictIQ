# PredictIQ Git Commit Policy

AI agents may inspect the repository, analyze code, propose changes, edit files when explicitly instructed, run tests, and prepare patches.

AI agents must never create Git commits or push changes unless the human owner explicitly requests it. When the human requests a commit, the commit must use the human owner's configured Git identity and must not contain any AI/Copilot co-author trailer.

Before any commit, inspect the staged commit message and remove any `Co-authored-by` trailer referring to an AI, Copilot, bot, or automated agent.

AI agents must not force-push automatically. Any force-push requires explicit human approval and must use `--force-with-lease` where possible.
