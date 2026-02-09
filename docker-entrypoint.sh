#!/bin/bash
set -e
exec tsx cli.ts "${1:-serve}" "${@:2}"
