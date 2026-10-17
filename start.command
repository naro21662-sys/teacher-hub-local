#!/bin/zsh
cd "${0:A:h}"
launchctl bootstrap "gui/$(id -u)" "${PWD}/com.deok.teacher-hub-local.plist" 2>/dev/null || launchctl kickstart "gui/$(id -u)/com.deok.teacher-hub-local"
open "http://127.0.0.1:4173"
