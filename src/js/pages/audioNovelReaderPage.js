// ?chapter=1 / ?chapter=2 로 화를 고른다 (없으면 1장). 화가 늘어나면
// 이 표에 항목만 추가하면 된다.
var AN_CHAPTERS = {
  '1': {
    file: '1장.md',
    title: '초! 카구야 공주 공식 소설 1장',
    dcId: 267711,
    dcLabel: '초 카구야 공주! 서장 + 1장'
  },
  '2': {
    file: '2장.md',
    title: '초! 카구야 공주 공식 소설 2장',
    dcId: 267712, // 2장은 원문이 두 편으로 나뉘어 있어 앞 편(1/2)으로 잇는다
    dcLabel: '초 카구야 공주! 제2장 (1/2)'
  }
};

window.addEventListener('DOMContentLoaded', function () {
  var chapterParam = new URLSearchParams(location.search).get('chapter') || '1';
  var chapter = AN_CHAPTERS[chapterParam] || AN_CHAPTERS['1'];

  // HTML <title>("초카공 문학&번역 • 오디오 노벨") 뒤에 몇 장인지 붙인다
  document.title += ' — ' + chapter.title.slice(chapter.title.length - 2);
  document.getElementById('an-header-title').textContent = chapter.title;

  var link = document.getElementById('an-source-link-a');
  link.href = 'https://gall.dcinside.com/mgallery/board/view/?id=chokaguyahime&no=' + chapter.dcId;
  document.getElementById('an-source-link-chapter').textContent = chapter.dcLabel;

  // src/audioNovel 전체가 이제 R2 CDN(sync_to_r2.py)에 올라가 있으므로,
  // 로컬 상대경로 대신 그 주소를 그대로 쓴다 (cdnConfig.js 의 R2_CDN_BASE).
  var AN_CDN_BASE = window.R2_CDN_BASE + '/audioNovel';

  AudioNovelReader.init({
    containerId: 'an-content',
    sourceUrl: AN_CDN_BASE + '/novelData/official/' + chapter.file,
    audioDataUrl: AN_CDN_BASE + '/asset/sound/music/official/novel/AudioData.json',
    soundBase: AN_CDN_BASE + '/asset/sound/music/official/novel/',
    imgBase: AN_CDN_BASE + '/asset/img/',
    sfxBase: AN_CDN_BASE + '/asset/sound/sfx/official/'
  });
});
