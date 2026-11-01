# /kc-promote

Scan private memories (`~/.gemini/knowledge-capture/private/`), generalize team-relevant knowledge, and move or split files into the Team Global layer (`~/.gemini/knowledge-capture/team/`).

1. Scan all `.md` files in `~/.gemini/knowledge-capture/private/`.
2. Generalize candidates by stripping personal paths, usernames, or credentials.
3. If pure team knowledge: Move file to `team/` (delete from `private/`).
   If mixed: Split file (publish team rules to `team/`, retain personal context in `private/`).
4. Display proposed diffs and ask for confirmation.
5. Execute filesystem and Git changes upon approval.
