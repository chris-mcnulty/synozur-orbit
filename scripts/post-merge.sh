#!/bin/bash
set -e

npm install --ignore-scripts 2>/dev/null || true

npx drizzle-kit push --force 2>/dev/null || true
