#!/bin/zsh
# Generate one reference image with the local Codex CLI (image_generation tool).
#   tools/genref.sh <name> <prompt-file> [anchor-image ...]   → refs/<name>.png (1672x941)
set -e
cd "$(dirname "$0")/.."
NAME=$1; PROMPT_FILE=$2; shift 2
CODEX=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
IMGS=(); for a in "$@"; do IMGS+=(-i "$a"); done
ANCHOR_NOTE=""
[ $# -gt 0 ] && ANCHOR_NOTE="The attached image(s) are references for the SAME city: keep its architecture, materials and palette consistent with them, but follow the composition described here."
mkdir -p refs/_log
"$CODEX" exec -s workspace-write --skip-git-repo-check "Use your image generation tool to create exactly ONE image (landscape 16:9). $ANCHOR_NOTE
Image description: $(cat $PROMPT_FILE)
After generating, copy the image file to refs/$NAME.png and resize it to exactly 1672x941 pixels with: sips -z 941 1672 refs/$NAME.png. Reply only with the saved path." "${IMGS[@]}" < /dev/null > refs/_log/$NAME.log 2>&1
ls -la refs/$NAME.png
