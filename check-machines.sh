#!/usr/bin/env bash
# 檢查各台機器的 claude-mods 是否和 GitHub 一致，以及 settings.json 載入了哪些 mod。
# 用法：./check-machines.sh [主機 ...]
#   不給主機就檢查本機，加上 ~/.ssh/config 裡的每個 Host（萬用字元除外）。
#   只做唯讀檢查：git fetch 更新遠端分支資訊，不改任何檔案。

set -u

# 在每台機器上執行：讀 settings.json 的 CLAUDE_CODE_PLUGIN_DIRS，找出 mod 所在的 repo，
# 回報 repo 的提交、是否落後 GitHub、有沒有未提交的修改，以及設定裡指到但不存在的路徑。
PROBE=$(cat <<'PY'
import json, os, subprocess

def git(repo, *args):
    run = subprocess.run(['git', '-C', repo, *args], capture_output=True, text=True, encoding='utf-8', timeout=30)
    return run.stdout.strip() if run.returncode == 0 else None

try:
    env = json.load(open(os.path.expanduser('~/.claude/settings.json'))).get('env', {})
except Exception:
    env = {}
# 路徑之間的分隔符號跟著系統走：Windows 是分號，其他是冒號。
paths = [os.path.expanduser(p.rstrip('/\\')) for p in env.get('CLAUDE_CODE_PLUGIN_DIRS', '').split(os.pathsep) if p]
mods = ','.join(os.path.basename(p) for p in paths) or '-'
missing = ','.join(os.path.basename(p) for p in paths if not os.path.isdir(p)) or '-'
repos = sorted({os.path.dirname(p) for p in paths if os.path.isdir(os.path.dirname(p))})
if not repos:
    print('\t'.join(['-', '-', '-', '-', mods, missing]))
for repo in repos:
    head = git(repo, 'rev-parse', '--short', 'HEAD') or '-'
    git(repo, 'fetch', '-q', 'origin')
    behind = git(repo, 'rev-list', '--count', 'HEAD..origin/main') or '?'
    ahead = git(repo, 'rev-list', '--count', 'origin/main..HEAD') or '?'
    # 只看已追蹤檔案的修改；系統或編輯器產生的未追蹤檔不算。
    dirty = 'yes' if git(repo, 'status', '--porcelain', '--untracked-files=no') else 'no'
    print('\t'.join([repo.replace(os.path.expanduser('~'), '~'), head, f'{behind}/{ahead}', dirty, mods, missing]))
PY
)

if [ $# -gt 0 ]; then
  HOSTS=("$@")
else
  HOSTS=(本機)
  while read -r host; do HOSTS+=("$host"); done < <(awk '{gsub(/\r/, "")} tolower($1)=="host"{for(i=2;i<=NF;i++) if ($i !~ /[*?!]/) print $i}' ~/.ssh/config 2>/dev/null)
fi

# 同一台機器、同一個帳號的別名只檢查一次。
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=6 -o RemoteCommand=none -o RequestTTY=no)
declare -a SKIPPED=()
seen=$'\n'

latest=$(git ls-remote https://github.com/TCcodemaster/claude-mods refs/heads/main 2>/dev/null | cut -c1-7)
echo "GitHub main 最新提交：${latest:-無法取得}"
echo
printf '%-22s %-10s %-8s %-6s %s\n' 機器 提交 落後/超前 未提交 結果
for host in "${HOSTS[@]}"; do
  if [ "$host" = 本機 ]; then
    out=$(python3 -c "$PROBE" 2>&1)
  else
    target=$(ssh -G "$host" 2>/dev/null | awk '$1=="user"{u=$2} $1=="hostname"{h=$2} $1=="port"{p=$2} END{print u"@"h":"p}')
    first=$(printf '%s' "$seen" | grep -F "|$target" | head -1 | cut -d'|' -f1)
    if [ -n "$first" ]; then
      SKIPPED+=("$host（同 $first）")
      continue
    fi
    seen+="$host|$target"$'\n'
    # Windows 的預設殼層是 PowerShell，指令是 python；其他系統用 python3。
    if [ "$("${SSH[@]}" "$host" 'echo $env:OS' 2>/dev/null | tr -d '\r' | tail -1)" = Windows_NT ]; then
      out=$("${SSH[@]}" "$host" '$env:PYTHONIOENCODING="utf-8"; python -' <<< "$PROBE" 2>&1 | tr -d '\r')
    else
      out=$("${SSH[@]}" "$host" python3 - <<< "$PROBE" 2>&1)
    fi
  fi
  if ! printf '%s' "$out" | grep -q $'\t'; then
    case "$out" in
      *"timed out"*|*"No route"*|*"Could not resolve"*|*"Connection refused"*) reason='連不上' ;;
      *"Permission denied"*) reason='需要密碼或金鑰' ;;
      *"python3"*"not found"*) reason='沒有 python3，無法檢查' ;;
      *) reason="無法檢查：$(printf '%s' "$out" | tail -1 | cut -c1-60)" ;;
    esac
    printf '%-22s %-10s %-8s %-6s %s\n' "$host" - - - "$reason"
    continue
  fi
  while IFS=$'\t' read -r repo head counts dirty mods missing; do
    [ -z "$mods" ] && continue
    if [ "$head" = - ]; then
      verdict="沒有安裝 claude-mods（載入：$mods）"
    elif [ "$counts" != 0/0 ] || [ "$dirty" = yes ] || [ "$missing" != - ]; then
      verdict="不一致：$repo"
      [ "$counts" != 0/0 ] && verdict+="，落後/超前 $counts"
      [ "$dirty" = yes ] && verdict+="，有未提交修改"
      [ "$missing" != - ] && verdict+="，找不到 $missing"
    else
      verdict="一致（載入：$mods）"
    fi
    printf '%-22s %-10s %-8s %-6s %s\n' "$host" "$head" "$counts" "$dirty" "$verdict"
  done <<< "$(printf '%s\n' "$out" | grep $'\t')"
done
[ ${#SKIPPED[@]} -gt 0 ] && echo && echo "略過重複的別名：${SKIPPED[*]}"
