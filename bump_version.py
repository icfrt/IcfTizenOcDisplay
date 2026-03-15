"""Increments the patch segment of the version attribute in config.xml.
Prints the new version string to stdout so the caller can capture it."""
import re
import sys
from pathlib import Path

config_path = Path(__file__).parent / 'config.xml'
content = config_path.read_text(encoding='utf-8')

def bump(m):
    parts = m.group(1).split('.')
    parts[-1] = str(int(parts[-1]) + 1)
    return f'version="{".".join(parts)}"'

new_content, count = re.subn(r'version="(\d+\.\d+\.\d+)"', bump, content, count=1)
if count == 0:
    print('ERROR: version attribute not found in config.xml', file=sys.stderr)
    sys.exit(1)

config_path.write_text(new_content, encoding='utf-8')

version = re.search(r'version="(\d+\.\d+\.\d+)"', new_content).group(1)
print(version)
