import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def generate_sssp_config(wgt_path):
    wgt_file = Path(wgt_path)
    if not wgt_file.exists():
        print(f"Error: {wgt_path} not found.")
        sys.exit(1)

    file_size = wgt_file.stat().st_size

    try:
        with zipfile.ZipFile(wgt_file, 'r') as z:
            with z.open('config.xml') as f:
                root = ET.parse(f).getroot()

        ns = {'w': 'http://www.w3.org/ns/widgets'}
        version = root.get('version', '')
    except Exception as e:
        print(f"Error reading WGT: {e}")
        sys.exit(1)

    widget = ET.Element('widget')
    ET.SubElement(widget, 'ver').text = version
    ET.SubElement(widget, 'size').text = str(file_size)
    ET.SubElement(widget, 'widgetname').text = wgt_file.stem
    ET.SubElement(widget, 'webtype').text = 'tizen'

    output_path = wgt_file.parent / 'sssp_config.xml'
    output_path.write_text(ET.tostring(widget, encoding='unicode'))
    print(f"Written: {output_path}")


if __name__ == '__main__':
    wgt = sys.argv[1] if len(sys.argv) > 1 else 'Debug/IcfTizenOcDisplay.wgt'
    generate_sssp_config(wgt)
