#!/usr/bin/env bash
# Port zzci/bun-tpl commits onto worker/.
#
#   scripts/tpl/sync.sh list            template commits since the last sync
#   scripts/tpl/sync.sh check           how each of them applies (clean / conflict per file)
#   scripts/tpl/sync.sh port <commit>   3-way apply one commit; conflicts are left in the files
#
# The last synced commit is read from README.md ("zzci/bun-tpl@<sha>");
# update it after a sync. Paths in scripts/tpl/skip.txt are never ported,
# and files worker/ does not have are skipped unless the commit adds them.
# The template is cloned to <repo>/.tmp/bun-tpl (TPL_DIR overrides).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
WORKER=$(cd "$HERE/../.." && pwd)
REPO=$(git -C "$WORKER" rev-parse --show-toplevel)
PREFIX=${WORKER#"$REPO"/}
TPL=${TPL_DIR:-$REPO/.tmp/bun-tpl}
BASE=$(grep -oE 'zzci/bun-tpl@[0-9a-f]+' "$WORKER/README.md" | head -1 | cut -d@ -f2)
SKIP=$(grep -vE '^\s*(#|$)' "$HERE/skip.txt" | paste -sd'|')

if [ -d "$TPL/.git" ]; then
  git -C "$TPL" fetch -q origin
else
  git clone -q https://github.com/zzci/bun-tpl.git "$TPL"
fi
HEAD_REF=origin/HEAD
git -C "$TPL" rev-parse -q --verify "$HEAD_REF" >/dev/null || HEAD_REF=origin/main

# Files of commit $1 worth porting, one per line.
portable() {
  git -C "$TPL" diff-tree --no-commit-id -r --name-status "$1" | while IFS=$'\t' read -r st a b; do
    f=${b:-$a}
    if [[ "$f" =~ $SKIP ]]; then
      echo "skip   $f" >&2
    elif [ -e "$WORKER/$f" ] || [[ "$st" == A* ]]; then
      echo "$f"
    else
      echo "absent $f" >&2
    fi
  done
}

case "${1:-}" in
  list)
    echo "last synced: $BASE"
    git -C "$TPL" log --reverse --format='%h %ad %s' --date=short "$BASE..$HEAD_REF"
    ;;
  check)
    for c in $(git -C "$TPL" rev-list --reverse "$BASE..$HEAD_REF"); do
      ok=0; bad=0; conflicts=()
      while read -r f; do
        if git -C "$TPL" diff "$c^" "$c" -- "$f" | git -C "$REPO" apply --check --directory="$PREFIX" - 2>/dev/null; then
          ok=$((ok + 1))
        else
          bad=$((bad + 1)); conflicts+=("$f")
        fi
      done < <(portable "$c" 2>/dev/null)
      printf '%s clean=%-3s conflict=%-3s %s\n' "$(git -C "$TPL" log -1 --format=%h "$c")" "$ok" "$bad" "$(git -C "$TPL" log -1 --format=%s "$c")"
      for f in "${conflicts[@]}"; do echo "    conflict: $f"; done
    done
    ;;
  port)
    c=${2:?usage: sync.sh port <commit>}
    mapfile -t files < <(portable "$c")
    [ ${#files[@]} -eq 0 ] && { echo "nothing to apply"; exit 0; }
    # A non-zero exit means conflicts were written into the files.
    git -C "$TPL" diff "$c^" "$c" -- "${files[@]}" | git -C "$REPO" apply -3 --directory="$PREFIX" - || true
    echo "applied ${#files[@]} file(s) from $(git -C "$TPL" log -1 --format='%h %s' "$c")"
    git -C "$REPO" diff --name-only --diff-filter=U
    ;;
  *)
    sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
