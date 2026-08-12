# -*- coding: utf-8 -*-
"""
초 카구야 공주 갤러리 (chokaguyahime) - 번역 탭 크롤러
=====================================================
- 대상 말머리: search_head=60 (💬번역)
- 태그 체계: [이미지] (첫 번째 사진 첨부 시) / [글자] (텍스트 전용)
- 사진 저장: 각 게시글의 맨 첫 번째 사진을 '번역 사진/{차수}/{게시글ID}_1.{확장자}'로 다운로드
- 본문 링크: 본문 내 외부 출처, 트위터/X, 픽시브, 유튜브, 관련 링크 추출 및 메타데이터 기록 (한글/불필요 문자 정제)
- 마크다운 정리: '번역 정리/크롤링 파일/1.md' ~ '29.md' (10,000 단위 ID 분할 수록)

사용법:
  python crawl_translations.py                  # 전체 번역 글(1~29차) 자동 수집 및 정리
  python crawl_translations.py --batches 1 2 3   # 특정 배치만 지정 수집
  python crawl_translations.py --index          # 목록 인덱싱 및 배치별 분포만 확인
"""

import os
import sys
import re
import time
import json
import argparse
import requests
from bs4 import BeautifulSoup

sys.stdout.reconfigure(encoding='utf-8')

# 디렉토리 경로 설정
WORKSPACE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE_DIR = os.path.join(WORKSPACE, "번역 정리")
CRAWL_DIR = os.path.join(BASE_DIR, "크롤링 파일")
PHOTO_ROOT = os.path.join(BASE_DIR, "번역 사진")
CACHE_FILE = os.path.join(BASE_DIR, "translation_posts_index.json")

SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
})

URL_REGEX = re.compile(r'https?://[a-zA-Z0-9\-._~:/?#\[\]@!$&\'()*+,;=%]+')

def fetch_html(url, retries=3, delay=1.2):
    """HTML 요청 (재시도 및 백오프 포함)"""
    for attempt in range(retries):
        try:
            resp = SESSION.get(url, timeout=15)
            if resp.status_code == 200 and len(resp.text) > 0:
                return resp.text
        except Exception as e:
            if attempt == retries - 1:
                raise e
        time.sleep(delay * (attempt + 1))
    return ""

def download_image(img_url, referer, save_path):
    """첫 번째 이미지 원본 다운로드"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': referer
    }
    try:
        resp = requests.get(img_url, headers=headers, timeout=20)
        if resp.status_code == 200 and len(resp.content) > 0:
            with open(save_path, 'wb') as f:
                f.write(resp.content)
            return len(resp.content)
    except Exception as e:
        print(f"   [!] 이미지 다운로드 실패: {img_url} ({e})")
    return 0

def clean_url(raw_url):
    """URL 끝에 붙은 한글, 구두점 등 비표준 문자 정제"""
    if not raw_url:
        return None
    m = URL_REGEX.search(raw_url)
    if m:
        u = m.group(0)
        u = re.sub(r'[.,;:!?)>\]]+$', '', u)
        return u
    return None

def extract_body_links(body_el):
    """본문 내부의 링크(출처, 트위터, 픽시브, 유튜브, 임베드 등) 추출"""
    if not body_el:
        return []
    
    links = []
    seen = set()
    
    # 1. <a> 태그 href 추출
    for a in body_el.select('a'):
        href = a.get('href', '').strip()
        if href.startswith('http'):
            if 'viewimage.php' in href or 'download.php' in href or 'javascript:' in href:
                continue
            cleaned = clean_url(href)
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                links.append(cleaned)
                
    # 2. <embed>, <iframe> 태그 src 추출 (유튜브 등)
    for tag in body_el.select('embed, iframe'):
        src = tag.get('src', '').strip()
        if src.startswith('http'):
            cleaned = clean_url(src)
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                links.append(cleaned)
                
    # 3. 본문 텍스트 내 정규식 URL 추출
    body_text = body_el.get_text()
    for m in URL_REGEX.finditer(body_text):
        cleaned = clean_url(m.group(0))
        if cleaned and ('viewimage.php' in cleaned or 'download.php' in cleaned):
            continue
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            links.append(cleaned)
            
    return links

def scan_all_translation_posts(max_pages=30, force_refresh=False):
    """번역 탭의 모든 게시글 기본 정보 인덱싱 (캐시 지원)"""
    os.makedirs(BASE_DIR, exist_ok=True)
    if not force_refresh and os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                posts = json.load(f)
                if posts:
                    print(f"[*] 캐시된 번역 목록 로드 완료: 총 {len(posts):,d}건 ({CACHE_FILE})")
                    return posts
        except Exception:
            pass

    print("=== [1단계] 번역 탭(search_head=60) 전체 게시글 인덱싱 시작 ===")
    posts = []
    seen_ids = set()
    
    desktop_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    for page in range(1, max_pages + 1):
        url = f"https://gall.dcinside.com/mgallery/board/lists/?id=chokaguyahime&search_head=60&page={page}"
        try:
            resp = requests.get(url, headers=desktop_headers, timeout=15)
            soup = BeautifulSoup(resp.text, 'html.parser')
            rows = soup.select('tr.ub-content.us-post')
            new_count = 0
            for r in rows:
                num_td = r.select_one('td.gall_num')
                tit_td = r.select_one('td.gall_tit a')
                writer_td = r.select_one('td.gall_writer')
                if num_td and tit_td:
                    num_txt = num_td.get_text(strip=True)
                    if num_txt.isdigit():
                        pid = int(num_txt)
                        if pid not in seen_ids:
                            seen_ids.add(pid)
                            new_count += 1
                            posts.append({
                                'id': pid,
                                'title': tit_td.get_text(strip=True),
                                'writer': writer_td.get_text(strip=True) if writer_td else '',
                                'page': page
                            })
            print(f"  페이지 {page:2d}: {len(rows):2d}개 행 스캔 (신규 {new_count:2d}건, 누적 {len(posts):4d}건)")
            if new_count == 0 and len(rows) > 0 and page > 15:
                print("  => 마지막 페이지 도달 확인.")
                break
        except Exception as e:
            print(f"  [!] 페이지 {page} 스캔 오류: {e}")
        time.sleep(1.0)
        
    print(f"=== [1단계 완료] 총 {len(posts):,d}건의 번역 게시글 인덱싱 완료 ===\n")
    
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(posts, f, ensure_ascii=False, indent=2)
        
    return posts

def get_batch_number(post_id):
    """게시글 ID에 따른 배치 파일 번호 (1.md ~ 29.md)"""
    return ((post_id - 1) // 10000) + 1

def parse_and_save_batch(batch_num, batch_posts):
    """특정 배치의 게시글 본문 파싱, 대표 사진 다운로드, 본문 링크 추출 및 마크다운 저장"""
    min_id = (batch_num - 1) * 10000 + 1
    max_id = batch_num * 10000
    
    os.makedirs(CRAWL_DIR, exist_ok=True)
    photo_dir = os.path.join(PHOTO_ROOT, str(batch_num))
    os.makedirs(photo_dir, exist_ok=True)
    
    out_file = os.path.join(CRAWL_DIR, f"{batch_num}.md")
    print(f"\n==================================================")
    print(f"=== [2단계] 배치 {batch_num}.md 수집 시작 ({min_id:,} ~ {max_id:,}번 / 총 {len(batch_posts)}건) ===")
    print(f"==================================================")
    
    parsed_entries = []
    
    for idx, p in enumerate(batch_posts, 1):
        post_id = p['id']
        desktop_link = f"https://gall.dcinside.com/mgallery/board/view/?id=chokaguyahime&no={post_id}"
        mobile_url = f"https://m.dcinside.com/board/chokaguyahime/{post_id}"
        print(f"[{idx:3d}/{len(batch_posts):3d}] [{post_id}] {p['title'][:35]}...")
        
        try:
            html = fetch_html(mobile_url)
            soup = BeautifulSoup(html, 'html.parser')
            
            # 본문 추출 (div.thum-txt 또는 div.writing_view_box)
            body_el = soup.select_one('div.thum-txt') or soup.select_one('div.writing_view_box')
            body_text = body_el.get_text(strip=True) if body_el else ""
            char_count = len(body_text)
            
            # 본문 내부 링크 추출 (출처, 트위터, 유튜브 등)
            body_links = extract_body_links(body_el)
            
            # 본문 첫 번째 이미지 추출 (data-original or src)
            first_img_url = None
            first_img_ext = "jpg"
            for img in soup.select('div.writing_view_box img, div.thum-txt img'):
                src = img.get('data-original') or img.get('src')
                if src and 'gallview_loading' not in src:
                    first_img_url = src
                    # 확장자 추정
                    alt = img.get('alt', '')
                    if '.' in alt:
                        e = alt.split('.')[-1].lower()
                        if e in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                            first_img_ext = e
                    break
            
            photo_path_str = "없음"
            tag = "글자"
            
            if first_img_url:
                tag = "이미지"
                save_filename = f"{post_id}_1.{first_img_ext}"
                save_path = os.path.join(photo_dir, save_filename)
                rel_path = f"번역 사진/{batch_num}/{save_filename}"
                
                if not os.path.exists(save_path) or os.path.getsize(save_path) == 0:
                    sz = download_image(first_img_url, mobile_url, save_path)
                    if sz > 0:
                        photo_path_str = rel_path
                        print(f"   📸 첫 번째 사진 저장: {rel_path} ({sz:,} bytes)")
                    else:
                        photo_path_str = "없음"
                else:
                    photo_path_str = rel_path
                    print(f"   📸 기존 사진 확인: {rel_path}")
            
            if body_links:
                print(f"   🔗 본문 링크 {len(body_links)}개: {', '.join(body_links[:2])}")
                
            parsed_entries.append({
                'id': post_id,
                'title': p['title'],
                'url': desktop_link,
                'author': p.get('writer', ''),
                'tag': tag,
                'char_count': char_count,
                'photo': photo_path_str,
                'body_links': body_links
            })
            
        except Exception as e:
            print(f"   [!] 파싱 실패 [{post_id}]: {e}")
            parsed_entries.append({
                'id': post_id,
                'title': p['title'],
                'url': desktop_link,
                'author': p.get('writer', ''),
                'tag': "글자",
                'char_count': 0,
                'photo': "없음",
                'body_links': []
            })
            
        time.sleep(1.2)
        
    # 최신순(ID 역순) 정렬
    parsed_entries.sort(key=lambda x: x['id'], reverse=True)
    
    # 마크다운 포맷 생성
    md_lines = [f"# 💬 번역 {batch_num}차 수집 목록 ({min_id:,} ~ {max_id:,}번)", ""]
    for entry in parsed_entries:
        md_lines.append(f"### [{entry['id']}] {entry['title']}")
        md_lines.append(f"- **게시물 링크**: {entry['url']}")
        md_lines.append(f"- **작성자**: {entry['author']}")
        md_lines.append(f"- **태그**: [{entry['tag']}]")
        md_lines.append(f"- **글자 수**: {entry['char_count']:,}자")
        md_lines.append(f"- **첨부 사진**: {entry['photo']}")
        
        # 본문 링크가 있는 경우 추가 기록
        if entry['body_links']:
            links_str = ", ".join(entry['body_links'])
            md_lines.append(f"- **본문 링크**: {links_str}")
            
        md_lines.append("")
        md_lines.append("---")
        md_lines.append("")
        
    with open(out_file, 'w', encoding='utf-8') as f:
        f.write("\n".join(md_lines))
        
    print(f"[+] ✨ 마크다운 생성 완료: {out_file} (총 {len(parsed_entries)}건 기록)")

def main():
    parser = argparse.ArgumentParser(description="초카구야공주 갤러리 번역 탭 크롤러")
    parser.add_argument("--batches", nargs="+", type=int, help="수집할 배치 번호들 (예: --batches 1 2 3)")
    parser.add_argument("--index", action="store_true", help="목록 인덱싱 및 배치별 분포만 확인")
    parser.add_argument("--refresh", action="store_true", help="인덱스 캐시를 새로고침")
    args = parser.parse_args()

    all_posts = scan_all_translation_posts(max_pages=25, force_refresh=args.refresh)
    
    batch_map = {}
    for p in all_posts:
        b = get_batch_number(p['id'])
        batch_map.setdefault(b, []).append(p)
        
    print("\n📊 === [배치별 번역 글 분포 현황] ===")
    total_posts = 0
    for b in sorted(batch_map.keys()):
        cnt = len(batch_map[b])
        total_posts += cnt
        min_id = (b - 1) * 10000 + 1
        max_id = b * 10000
        print(f"  - 번역 {b:2d}.md ({min_id:>7,d} ~ {max_id:>7,d}번): {cnt:4d}건")
    print(f"  👉 총 {len(batch_map)}개 배치 파일 / 전체 {total_posts:,d}건")
    print("======================================\n")
    
    if args.index:
        return
        
    batches_to_run = args.batches if args.batches else sorted(batch_map.keys())
    for b in batches_to_run:
        if b in batch_map:
            parse_and_save_batch(b, batch_map[b])
            time.sleep(1.5)
            
    print("\n🎉 모든 번역 크롤링 및 1~29.md 마크다운 정리가 완료되었습니다!")

if __name__ == "__main__":
    main()
