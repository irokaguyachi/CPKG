const acorn = require('acorn');

function stripJsComments(source) {
  const comments = [];
  acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    onComment: (_block, _text, start, end) => comments.push({ start, end }),
  });
  // 줄바꿈과 토큰 경계를 유지해 자동 세미콜론 삽입 및 연산자 의미를 보존한다.
  let cursor = 0;
  let result = '';
  for (const { start, end } of comments) {
    result += source.slice(cursor, start);
    result += source.slice(start, end).replace(/[^\r\n\u2028\u2029]+/g, ' ');
    cursor = end;
  }
  return result + source.slice(cursor);
}

module.exports = { stripJsComments };
