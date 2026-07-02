# /// script
# dependencies = [
#   "modelscope>=1.0.0",
# ]
# ///

"""
将 electron-builder 产出的 7z 包上传到 ModelScope (me9rez/code-lab)。

自动在 release/ 目录中查找 .7z 文件。

用法:
    uv run scripts/upload-ms/upload.py [--dry-run]

环境变量:
    MY_MODEL_SCOPE_TOKEN  访问令牌(必填,非 dry-run)
"""

import os
import sys
from pathlib import Path

from modelscope.hub.api import HubApi

MODEL_ID = "me9rez/code-lab"
REPO_PATH = "code-lab/openclaw-manager"
RELEASE_DIR = Path(__file__).resolve().parent.parent.parent / "release"


def main():
    dry_run = "--dry-run" in sys.argv

    z7_files = sorted(RELEASE_DIR.glob("*.7z"))
    if not z7_files:
        print(f"在 {RELEASE_DIR} 中未找到 .7z 文件", file=sys.stderr)
        sys.exit(1)

    seven_z_path = z7_files[-1]

    token = os.environ.get("MY_MODEL_SCOPE_TOKEN")
    if not token and not dry_run:
        print("MY_MODEL_SCOPE_TOKEN 环境变量未设置", file=sys.stderr)
        sys.exit(1)

    if not seven_z_path.exists():
        print(f"文件不存在: {seven_z_path}", file=sys.stderr)
        sys.exit(1)

    size_mb = seven_z_path.stat().st_size / (1024 * 1024)
    remote_path = f"{REPO_PATH}/{seven_z_path.name}"
    print(f"\n{'[DRY RUN] ' if dry_run else ''}{seven_z_path.name} ({size_mb:.1f} MB)")
    print(f"  -> {MODEL_ID}/{remote_path}")

    if dry_run:
        return

    api = HubApi(timeout=600, max_retries=4)
    api.login(token)

    api.upload_file(
        repo_id=MODEL_ID,
        path_or_fileobj=str(seven_z_path),
        path_in_repo=remote_path,
        token=token,
        commit_message=f"chore: upload {seven_z_path.name}",
    )
    print(f"  已上传 {seven_z_path.name}")


if __name__ == "__main__":
    main()
