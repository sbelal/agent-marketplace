# /kc-commit

Commit and push uncommitted memory files in the Local Global Private layer (`~/.gemini/knowledge-capture/private/`) to Git.

1. Check `git status --porcelain` in `~/.gemini/knowledge-capture/private/`.
2. Propose a structured commit message based on modified slugs.
3. Ask the user for approval.
4. Execute `git add -A` and `git commit -m "<message>"`.
5. If a remote origin is configured, execute `git push origin HEAD`.
