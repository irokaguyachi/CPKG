# -*- coding: utf-8 -*-
"""
메인 페이지 데이터 생성 스크립트 (8_build_recent_page_data.py)
- Novel.json 의 앞 10건만 뽑아 Recent.json 을 만듭니다.
- 메인 페이지(mainPage.js)는 "최신 등록 문학 10장" 카드만 그리는데,
  예전엔 그걸 위해 Novel.json(약 600KB)을 통째로 받아 slice(0, 10)만
  썼습니다. 랜딩 페이지라 방문자당 무조건 발생하는 요청이어서, 사이트
  전체에서 투자 대비 절감폭이 가장 큰 자리였습니다(TRAFFIC_SECURITY_AUDIT.md T1).
- 엔트리는 **필드를 깎지 않고 원본 그대로** 담습니다. 카드가 name/image/
  tags/charCount 를, 상세 모달(PostDetailSeries)이 posts[] 의 id/title/
  episode/link 를 그대로 쓰기 때문입니다.
- 시리즈는 카드 배열로 담지 않습니다 — mainPage.js 의 시리즈 섹션은
  "랜덤 시리즈"로 바뀌어(5초마다 자동 전환) Series.json 전체를 직접
  fetch하므로, 여기서 앞 10건을 잘라 넣어봤자 아무도 읽지 않는 죽은
  데이터였습니다(과거엔 "최신 등록 시리즈" 카드였을 때 쓰였던 필드).
  개수만 totals.series 로 남겨둡니다 — "N개의 게시물이 있습니다!" 통계에
  여전히 필요합니다.
- totals 는 mainPage.js 가 그 통계에 쓰던 novels.length + series.length 를
  대신합니다 — 전체 배열을 안 받으니 길이를 셀 수가 없어서 빌드 시점에
  미리 넣어둡니다.

⚠️ 이 스크립트는 Novel.json / Series.json 을 읽기만 합니다. 두 파일에
   사용자가 수동으로 매핑해 둔 image 경로도 그대로 복사되므로
   커스텀 에셋이 바뀌지 않습니다 (CLAUDE.md 최우선 규칙).
⚠️ 반드시 5_build_series_page_data.py / 7_build_novel_page_data.py 를
   먼저 돌린 뒤에 실행하세요. 그리고 결과를 배포에 반영하려면
   src/js/cdnConfig.js 의 DATA_VERSION 을 올려야 브라우저 캐시가 깨집니다.
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))

page_data_dir = os.path.join(HERE, "..", "data", "PageData")
novel_path = os.path.join(page_data_dir, "Novel.json")
series_path = os.path.join(page_data_dir, "Series.json")
out_path = os.path.join(page_data_dir, "Recent.json")

# mainPage.js 의 slice(0, 10) 과 같은 값 — 한쪽만 바꾸면 카드 수가 어긋납니다.
RECENT_COUNT = 10


def load_list(path):
    """PageData JSON 하나를 리스트로 읽습니다. 없거나 깨졌으면 빈 리스트."""
    if not os.path.exists(path):
        print("  ! 없음:", os.path.normpath(path))
        return []
    try:
        data = json.load(open(path, encoding="utf-8"))
    except ValueError:
        print("  ! 깨진 JSON:", os.path.normpath(path))
        return []
    return data if isinstance(data, list) else []


def main():
    novels = load_list(novel_path)
    series = load_list(series_path)

    recent = {
        "totals": {"novel": len(novels), "series": len(series)},
        "novels": novels[:RECENT_COUNT],
    }

    os.makedirs(page_data_dir, exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(recent, f, ensure_ascii=False, indent=2)

    out_kb = os.path.getsize(out_path) / 1024
    src_kb = (
        (os.path.getsize(novel_path) if os.path.exists(novel_path) else 0)
        + (os.path.getsize(series_path) if os.path.exists(series_path) else 0)
    ) / 1024
    print("wrote", os.path.normpath(out_path))
    print("  문학 %d건 중 %d건 수록 (시리즈는 개수 %d건만 totals 에 포함 — 카드는 mainPage.js 가 랜덤으로 직접 뽑음)"
          % (len(novels), len(recent["novels"]), len(series)))
    print("  메인 페이지 전송량 %.1fKB → %.1fKB (%.1fKB 절감)"
          % (src_kb, out_kb, src_kb - out_kb))
    print("  ※ 배포 반영하려면 src/js/cdnConfig.js 의 DATA_VERSION 을 올리세요.")


if __name__ == "__main__":
    main()
