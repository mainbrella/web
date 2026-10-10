#!/bin/zsh
# Render the shipping AppKit views; pass the path to a TabDance checkout.
set -euo pipefail
asset_dir="${0:A:h}"
checkout="${1:?Usage: capture.sh /path/to/TabDance}"
cd "$checkout"
swift build
product_dir="$(swift build --show-bin-path)"
capture_executable="$(mktemp -t tabdance-article-capture)"
trap 'rm -f "$capture_executable"' EXIT
swiftc -I "$product_dir" "$asset_dir/capture.swift" \
  Sources/TerminalLab/TerminalSession.swift \
  Sources/TerminalLab/TerminalWindowController.swift \
  Sources/TerminalLab/WorkspaceViews.swift \
  "$product_dir/TerminalCore.o" "$product_dir/SwiftTerm.o" \
  -o "$capture_executable"
"$capture_executable" "$asset_dir/workspaces.png"
"$capture_executable" "$asset_dir/workspaces-mobile.png" --narrow
