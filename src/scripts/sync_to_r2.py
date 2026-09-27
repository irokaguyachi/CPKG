"""
Cloudflare R2 자동 동기화 스크립트 (sync_to_r2.py)
- 로컬의 src/assets 와 src/audioNovel 폴더 내 모든 파일을 Cloudflare R2 버킷에 초고속 병렬 업로드합니다.
- 이미 업로드되어 크기가 일치하는 파일은 자동으로 건너뛰어(Delta Sync), 새 파일만 1~2초 만에 빠르게 동기화합니다.
"""

import os
import sys
import json
import mimetypes
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import boto3
from botocore.config import Config

# Set stdout to UTF-8
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Root directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
CONFIG_FILE = os.path.join(PROJECT_ROOT, '.r2_config.json')

def load_config():
    if not os.path.exists(CONFIG_FILE):
        print(f"[Error] R2 설정 파일({CONFIG_FILE})을 찾을 수 없습니다.")
        sys.exit(1)
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def get_s3_client(cfg):
    return boto3.client(
        's3',
        endpoint_url=f"https://{cfg['account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=cfg['access_key_id'],
        aws_secret_access_key=cfg['secret_access_key'],
        region_name='auto',
        config=Config(
            max_pool_connections=50,
            retries={'max_attempts': 5, 'mode': 'standard'}
        )
    )

def fetch_existing_r2_objects(s3, bucket_name):
    print("[1/4] R2 버킷의 기존 파일 목록 조회 중...")
    existing = {}
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=bucket_name):
        for obj in page.get('Contents', []):
            existing[obj['Key']] = obj['Size']
    print(f"       -> 기존 R2 버킷에 저장된 파일 수: {len(existing):,}개")
    return existing

# (로컬 폴더 이름, R2 키 접두사) 쌍 — 둘 다 src/ 바로 밑에 있고, 키 접두사가
# 그대로 CDN 경로가 된다 (R2_CDN_BASE + '/' + 접두사 + '/...').
SYNC_ROOTS = [
    ('assets', 'assets'),
    ('audioNovel', 'audioNovel'),
]

def scan_local_files():
    print("[2/4] 로컬 src/assets, src/audioNovel 파일 스캔 중...")
    local_files = []

    for folder_name, key_prefix in SYNC_ROOTS:
        local_dir = os.path.join(PROJECT_ROOT, 'src', folder_name)
        if not os.path.isdir(local_dir):
            continue
        for root, _, files in os.walk(local_dir):
            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, local_dir).replace('\\', '/')
                key = f"{key_prefix}/{rel_path}"
                size = os.path.getsize(full_path)
                local_files.append({
                    'full_path': full_path,
                    'key': key,
                    'size': size
                })

    print(f"       -> 로컬 파일 총합: {len(local_files):,}개 ({sum(f['size'] for f in local_files)/(1024*1024):.1f} MB)")
    return local_files

def upload_single_file(s3, bucket_name, file_info):
    full_path = file_info['full_path']
    key = file_info['key']
    size = file_info['size']
    
    content_type, _ = mimetypes.guess_type(full_path)
    if not content_type:
        content_type = 'application/octet-stream'
        
    extra_args = {
        'ContentType': content_type,
        'CacheControl': 'public, max-age=31536000, immutable'
    }
    
    try:
        s3.upload_file(full_path, bucket_name, key, ExtraArgs=extra_args)
        return (True, key, size, None)
    except Exception as e:
        return (False, key, size, str(e))

def sync():
    cfg = load_config()
    s3 = get_s3_client(cfg)
    bucket_name = cfg['bucket_name']
    
    existing = fetch_existing_r2_objects(s3, bucket_name)
    local_files = scan_local_files()
    
    # Filter files that need upload
    to_upload = []
    for f in local_files:
        if f['key'] not in existing or existing[f['key']] != f['size']:
            to_upload.append(f)
            
    total_upload_count = len(to_upload)
    total_upload_size = sum(f['size'] for f in to_upload)
    
    if total_upload_count == 0:
        print("\n✨ [완료] R2와 로컬 파일이 완벽하게 일치합니다! 업로드할 새 파일이 없습니다.")
        print(f"🌐 Public CDN URL: {cfg['public_url']}/assets/ , {cfg['public_url']}/audioNovel/")
        return
        
    print(f"\n[3/4] 새 파일 동기화 시작 (총 {total_upload_count:,}개 / {total_upload_size/(1024*1024):.1f} MB)...")
    start_time = time.time()
    
    completed_count = 0
    uploaded_bytes = 0
    errors = []
    
    # Parallel upload using ThreadPoolExecutor
    max_workers = 30
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(upload_single_file, s3, bucket_name, f): f for f in to_upload}
        
        for future in as_completed(futures):
            success, key, size, err = future.result()
            completed_count += 1
            if success:
                uploaded_bytes += size
            else:
                errors.append((key, err))
                
            if completed_count % 100 == 0 or completed_count == total_upload_count:
                percent = (completed_count / total_upload_count) * 100
                mb = uploaded_bytes / (1024 * 1024)
                elapsed = time.time() - start_time
                speed = (mb / elapsed) if elapsed > 0 else 0
                print(f"       진행률: [{completed_count:,}/{total_upload_count:,}] ({percent:.1f}%) | {mb:.1f} MB 전송 완료 ({speed:.1f} MB/s)")
                
    elapsed = time.time() - start_time
    print(f"\n[4/4] ✨ 동기화 완료! (소요 시간: {elapsed:.1f}초)")
    print(f"       - 성공: {completed_count - len(errors):,}개")
    if errors:
        print(f"       - 실패: {len(errors)}개")
        for k, e in errors[:5]:
            print(f"         * {k}: {e}")
    print(f"\n🌐 R2 Public Base URL: {cfg['public_url']}/assets/ , {cfg['public_url']}/audioNovel/")

if __name__ == '__main__':
    sync()
