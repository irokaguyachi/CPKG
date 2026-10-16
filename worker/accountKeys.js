// 개인 코드에서 파생하는 저장소 키·소유 증명 해시. 계정 삭제(accountDelete.js)와
// 서재·계정 API(favoritesShareWorker.js)가 같은 공식을 쓰도록 한곳에 모았다.
// 공식을 바꾸면 이미 저장된 데이터에 닿을 수 없게 되므로 바꾸지 않는다.

async function sha256Hex(str) {
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  var bytes = new Uint8Array(digest);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// 계정 본체. 공개 라이브러리와 분리된 프라이빗 저장소 키다.
export async function userStoreKey(personalCode) {
  return 'user/' + (await sha256Hex('user-v2:' + personalCode)) + '.json';
}

// 개인 코드 → 소유한 공개 코드 목록을 담은 인덱스 오브젝트 키.
export async function ownerIndexKey(personalCode) {
  return 'owners/' + (await sha256Hex('owner-index:' + personalCode)) + '.json';
}

// 서재 레코드의 ownerHash. code(공개 코드)를 섞어 서재마다 값이 다르다.
export async function ownerHashFor(personalCode, code) {
  return sha256Hex('owner:' + code + ':' + personalCode);
}

// profiles.owner_hash 와 deleted_accounts.owner_hash.
export async function profileOwnerHash(personalCode) {
  return sha256Hex('profile:' + personalCode);
}
