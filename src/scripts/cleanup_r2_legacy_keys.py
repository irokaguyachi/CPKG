"""
R2 옛 대문자 키 정리 스크립트 (cleanup_r2_legacy_keys.py)

2026-09-27 에 폴더 이름을 camelCase 로 바꾸면서(assets/Image -> assets/image,
AudioNovel -> audioNovel 등) R2 에는 새 키를 올렸지만, 이미 배포된 사이트가
계속 옛 키를 읽고 있어서 옛 키도 임시로 남겨 두었다. 새 경로를 쓰는 코드가
release(cpkg.cloud)와 dev(cpkg-dev)에 모두 배포된 **뒤에** 이 스크립트로 옛 키를
지운다. 배포 전에 지우면 실서버 이미지와 오디오 노벨이 전부 404 가 된다.

- 대상은 assets/Image/ 와 AudioNovel/ 접두사뿐이다. 같은 버킷에 있는 북마크
  라이브러리 등 Worker 데이터는 건드리지 않는다.
- 대응하는 새 키가 버킷에 실제로 있는 옛 키만 지운다. 새 키가 없는 옛 키(로컬에
  원본이 없는 R2 전용 파일, CLAUDE.md 보존 대상 로고 포함)는 목록만 출력하고
  남긴다 — 이것들은 사용자가 따로 결정한다.

사용법 (저장소 루트에서):
  python src/scripts/cleanup_r2_legacy_keys.py          # dry-run, 삭제 안 함
  python src/scripts/cleanup_r2_legacy_keys.py --apply  # 실제 삭제
"""
import json
import os
import sys

import boto3
from botocore.config import Config

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
CONFIG_FILE = os.path.join(PROJECT_ROOT, '.r2_config.json')

APPLY = '--apply' in sys.argv
OLD_PREFIXES = ('assets/Image/', 'AudioNovel/')

IMAGE_SUB = {'Icon': 'icon', 'LoadingIcon': 'loadingIcon', 'Logo': 'logo'}
AUDIO_SEG = {'NovelData': 'novelData', 'Official': 'official', 'Music': 'music',
             'Novel': 'novel', 'Sfx': 'sfx', 'OriginalSound': 'originalSound'}


def new_key(old):
    """옛 키 -> 폴더 이름을 camelCase 로 바꾼 새 키."""
    parts = old.split('/')
    if old.startswith('assets/Image/'):
        parts[1] = 'image'
        if len(parts) > 3 and parts[2] in IMAGE_SUB:
            parts[2] = IMAGE_SUB[parts[2]]
            if parts[2] == 'loadingIcon' and len(parts) > 4 and parts[3] == 'Old':
                parts[3] = 'old'
        return '/'.join(parts)
    if old.startswith('AudioNovel/'):
        parts[0] = 'audioNovel'
        # 마지막 조각은 파일명이므로 폴더 조각만 바꾼다
        for i in range(1, len(parts) - 1):
            parts[i] = AUDIO_SEG.get(parts[i], parts[i])
        return '/'.join(parts)
    return None


def main():
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        cfg = json.load(f)
    s3 = boto3.client(
        's3',
        endpoint_url=f"https://{cfg['account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=cfg['access_key_id'],
        aws_secret_access_key=cfg['secret_access_key'],
        region_name='auto',
        config=Config(retries={'max_attempts': 5, 'mode': 'standard'}),
    )
    bucket = cfg['bucket_name']

    existing = {}
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket):
        for obj in page.get('Contents', []):
            existing[obj['Key']] = obj['Size']

    old_keys = sorted(k for k in existing if k.startswith(OLD_PREFIXES))
    deletable = [k for k in old_keys if new_key(k) in existing]
    orphan = [k for k in old_keys if new_key(k) not in existing]

    print(f'버킷 전체 키: {len(existing):,}')
    print(f'옛 키(assets/Image/, AudioNovel/): {len(old_keys):,}')
    print(f'  새 키가 있어 삭제 가능: {len(deletable):,}')
    print(f'  새 키가 없음(삭제 보류, 사용자 결정 필요): {len(orphan):,}')
    for k in orphan:
        print('    -', k)

    if not APPLY:
        print('\n[dry-run] 삭제하지 않았습니다. 실제 삭제는 --apply')
        return

    deleted, errors = 0, []
    for i in range(0, len(deletable), 1000):
        batch = deletable[i:i + 1000]
        resp = s3.delete_objects(Bucket=bucket, Delete={'Objects': [{'Key': k} for k in batch], 'Quiet': True})
        errors.extend(resp.get('Errors', []))
        deleted += len(batch) - len(resp.get('Errors', []))
    print(f'\n삭제 완료: {deleted:,}개, 실패 {len(errors)}개')
    for e in errors[:10]:
        print('   !', e.get('Key'), e.get('Message'))


if __name__ == '__main__':
    main()
