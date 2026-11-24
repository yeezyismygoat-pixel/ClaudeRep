# Velvet

만화 · 영상 · 사진 · 숏폼을 한 곳에서 보는 안드로이드 앱입니다.
VidShelf 10.6(영상·사진 보관함)을 바탕으로 Manga Viewer 의 만화(e-hentai) 기능을 합치고, Velvet 디자인(밤 테마 기본, 장미색·금색)을 입혔습니다.

## 받기

https://github.com/yeezyismygoat-pixel/ClaudeRep/releases/download/velvet-apk/Velvet.apk

`manga-viewer` 브랜치에 `velvet/` 아래 파일이 바뀌면 GitHub Actions(`.github/workflows/velvet-apk.yml`)가 새로 만들어 위 주소에 올립니다.

## 화면

| 탭 | 내용 |
| --- | --- |
| 홈 | 인사, 이어 읽는 만화, 이어 보는 영상, 즐겨찾기, 최근 사진 등 (홈 편집으로 순서·보이기 변경) |
| 만화 | 한국어 · 즐겨찾기 · 저장. 만화 정보(미리보기·태그·댓글), 세로 스크롤 / 한 장씩 보기 |
| 미디어 | 휴대폰의 동영상·사진 (VidShelf 와 같음) |
| 숏폼 | 2분 이하 영상 |
| 탐색 | 사람 · 태그 · 폴더, 오른쪽 위 톱니바퀴 → 보관함(정리·기록·클라우드·설정) |

## 다른 앱과의 관계

- 앱 이름 `app.velvet`, 앱 안 서버 포트 8929. VidShelf · VidVault · Manga Viewer 와 함께 설치할 수 있습니다.
- VidShelf 의 태그·사람·즐겨찾기는 VidShelf 설정 → 백업 파일을 Velvet 설정 → 백업 / 복원에서 불러오면 옮겨집니다.
- 만화는 e-hentai 에 다시 로그인해야 합니다 (만화 → 톱니바퀴). 국내에서는 보안 폴더 안에서 VPN 을 켜야 연결됩니다.

## 구조

- `android/` — 앱 (WebView + 앱 안 HTTP 서버). `Library.java` 는 VidShelf 그대로, 만화는 `Comics.java`(`/api/eh/*`, `/eh/*`) · `EHentai.java` · `SecretBox.java`(로그인 쿠키 암호화).
- `static/` — 화면. `app.js`(VidShelf 화면), `comics.js`(만화 탭), `style.css`(VidShelf 스타일), `velvet.css`(Velvet 디자인 층).
