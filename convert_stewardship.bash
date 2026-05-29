#!/bin/bash
# Convert stewardship.json to stewardship.jsonl for dataset loading
# Usage: ./convert_stewardship.sh

jq -c 'to_entries[] | {key: .key, object: .value}' stewardship.json > stewardship.jsonl

echo "Converted stewardship.json to stewardship.jsonl"
echo "Lines generated: $(wc -l < stewardship.jsonl)"
