#!/usr/bin/env python3
"""Assemble the private Qt/libmpv runtime; graphics drivers remain host-owned."""
import os, re, shutil, subprocess, sys
from pathlib import Path
qt, stage, output = [Path(value).resolve() for value in sys.argv[1:]]
if output.exists():
    raise SystemExit('Refusing to overwrite an existing runtime: '+str(output))
output.mkdir(parents=True)
shutil.copytree(stage, output, dirs_exist_ok=True, symlinks=True)
lib = output / 'lib'
lib.mkdir(exist_ok=True)
# Qt modules, plugins and WebEngine resources must come from the same SDK.
for source in (qt/'lib').glob('lib*.so*'):
    if source.is_file(): shutil.copy2(source, lib/source.name, follow_symlinks=True)
for folder in ['plugins', 'qml', 'libexec', 'resources', 'translations']:
    if (qt/folder).is_dir(): shutil.copytree(qt/folder, output/folder, symlinks=False, dirs_exist_ok=True)
# Resolve the ELF dependency closure against this runtime before any AppImage
# environment is inherited. Do not bundle the kernel/driver-facing graphics stack.
exclude = re.compile(r'^(linux-vdso|ld-linux|libstdc\+\+\.so|libgcc_s\.so|lib(c|m|pthread|dl|rt|resolv|nss_[^.]*)\.so|lib(GL[^.]*|EGL[^.]*|GLES[^.]*|OpenGL|glapi|gbm|drm[^.]*|vulkan|xshmfence)\.so)')
env = dict(os.environ, LD_LIBRARY_PATH=str(lib)+':'+str(qt/'lib'))
seen = set()
while True:
    candidates = []
    for path in output.rglob('*'):
        if path.is_file() and not path.is_symlink() and path not in seen:
            with path.open('rb') as f:
                if f.read(4) == b'\x7fELF': candidates.append(path)
            seen.add(path)
    if not candidates: break
    for path in candidates:
        result = subprocess.run(['ldd', str(path)], env=env, text=True, capture_output=True)
        if result.returncode and 'not a dynamic executable' not in result.stderr:
            raise SystemExit('Cannot inspect runtime ELF: '+str(path))
        if 'not found' in result.stdout:
            raise SystemExit('Unresolved runtime dependencies in '+str(path)+'\n'+result.stdout)
        for line in result.stdout.splitlines():
            match = re.match(r'\s*(\S+) => (/\S+) \(', line)
            if not match: continue
            name, source = match.groups()
            if exclude.match(name) or (lib/name).exists(): continue
            shutil.copy2(source, lib/name)
# Keep license documents and precise package provenance beside bundled libraries.
notices = output/'share/zenith-qt-player/licenses/system'
notices.mkdir(parents=True, exist_ok=True)
packages = set()
for path in lib.glob('*.so*'):
    lookup = subprocess.run(['dpkg-query','-S',str(path.name)],text=True,capture_output=True)
    for line in lookup.stdout.splitlines():
        if ': ' in line: packages.add(line.split(': ',1)[0])
records = []
for package in sorted(packages):
    info = subprocess.run(['dpkg-query','-W','-f=${binary:Package} ${Version} ${source:Package} ${source:Version}\n',package],capture_output=True,text=True)
    if info.returncode == 0: records.append(info.stdout.strip())
    source = Path('/usr/share/doc')/package.split(':')[0]/'copyright'
    if source.exists(): shutil.copy2(source, notices/(package.replace(':','_')+'.copyright'))
(notices/'PACKAGES.txt').write_text('\n'.join(records)+'\n')
(notices/'SOURCE.txt').write_text('System libraries: exact package/source versions are in PACKAGES.txt. Ubuntu source archives: https://archive.ubuntu.com/ubuntu/pool/ . Qt SDK sources: https://download.qt.io/archive/qt/6.8/6.8.3/single/ and https://download.qt.io/archive/qt/6.8/6.8.3/submodules/ . Upstream MpvQt source and licenses are included in this runtime. Shared libraries can be replaced without modifying Zenith.\n')
# Include the installed SDK license material when available.
for source in [qt/'LICENSES',qt/'Licenses',qt/'licenses']:
    if source.is_dir(): shutil.copytree(source, notices/'Qt', dirs_exist_ok=True)
launcher = output/'run-player'
launcher.write_text("""#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Never mix Tauri's bundled GTK libraries with this separate Qt runtime.
export LD_LIBRARY_PATH="$HERE/lib"
export QT_PLUGIN_PATH="$HERE/plugins"
export QML_IMPORT_PATH="$HERE/qml"
export QML2_IMPORT_PATH="$HERE/qml"
export QTWEBENGINEPROCESS_PATH="$HERE/libexec/QtWebEngineProcess"
export QTWEBENGINE_RESOURCES_PATH="$HERE/resources"
export QTWEBENGINE_LOCALES_PATH="$HERE/translations/qtwebengine_locales"
exec "$HERE/bin/zenith-qt-player" "$@"
""")
launcher.chmod(0o755)
if not (output/'bin/zenith-qt-player').is_file() or not (output/'libexec/QtWebEngineProcess').is_file():
    raise SystemExit('Incomplete Qt player runtime')
print('Bundled Qt/libmpv runtime:', output)
